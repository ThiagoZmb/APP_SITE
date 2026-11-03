process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { criarLimiteLogin, HASH_FALSO } = require('../seguranca/login_limite');
const { app, pool, acesso } = require('../index.js');

const HASH = bcrypt.hashSync('segredo123', 4);
const MSG = 'Usuário ou senha inválidos.';
const acessoOk = { codigo: 7, nome: 'Caio', cargo: 'Produção', empresa: 'ELEGANCE', perfil: { id: 4, nome: 'Estoquista' },
  estados: [], ativo: true, permissoes: new Set(['estoque.ver']) };

// Cada requisição vem de um IP novo (trust proxy = 1): o limite por IP do index.js
// nunca interfere, então cada afirmação testa só o limite por conta.
let seqIp = 0;
const proximoIp = () => `10.9.${Math.floor(seqIp / 250)}.${(seqIp++ % 250) + 1}`;

// Sobe o servidor com um banco falso em que só existe o usuário `nome` (sem diferenciar caixa, como o MySQL).
async function preparar(t, nome, { auditoriaFalha = false } = {}) {
  const s = await subir(app); t.after(s.fechar); acesso.limpar();
  t.mock.method(acesso, 'carregar', async () => acessoOk);
  const f = criarPoolFalso([
    [/INSERT INTO web_auditoria/, () => { if (auditoriaFalha) throw new Error('banco caiu'); return []; }],
    [/FROM cliente_usuarios WHERE NOME/, (sql, p) => String(p[0]).toLowerCase() === nome.toLowerCase()
      ? [{ CODIGO: 7, NOME: nome, RAZAO_SOCIAL: 'ELEGANCE', CARGO: 'Produção', SENHA: HASH }] : []]
  ]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  const post = (body, ip = proximoIp()) => fetch(s.url + '/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
  return { s, f, post };
}
const auditorias = f => f.chamadas.filter(c => /INSERT INTO web_auditoria/.test(c.sql));

test('limite: 5 falhas bloqueiam, a janela libera e limpar zera', () => {
  let agora = 1000;
  const l = criarLimiteLogin({ agora: () => agora });
  for (let i = 0; i < 4; i++) l.falhou('caio');
  assert.equal(l.bloqueado('caio').bloqueado, false);
  l.falhou('caio');
  const b = l.bloqueado('caio');
  assert.equal(b.bloqueado, true);
  assert.ok(b.segundos > 0);
  assert.equal(l.bloqueado('outro').bloqueado, false);
  agora += 15 * 60 * 1000 + 1;
  assert.equal(l.bloqueado('caio').bloqueado, false);
  for (let i = 0; i < 5; i++) l.falhou('ana');
  assert.equal(l.bloqueado('ana').bloqueado, true);
  l.limpar('ana');
  assert.equal(l.bloqueado('ana').bloqueado, false);
});

test('HASH_FALSO é um hash bcrypt válido', async () => {
  assert.match(HASH_FALSO, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare('qualquer', HASH_FALSO), false);
});

test('usuário inexistente também executa bcrypt.compare e responde igual à senha errada', async t => {
  const { post } = await preparar(t, 'Existente');
  const espiao = t.mock.method(bcrypt, 'compare');
  const r1 = await post({ username: 'Fantasma', password: 'qualquer' });
  assert.equal(espiao.mock.callCount(), 1);
  assert.equal(r1.status, 401);
  const r2 = await post({ username: 'Existente', password: 'errada' });
  assert.equal(r2.status, 401);
  assert.deepEqual(await r1.json(), await r2.json());
  assert.deepEqual(await (await post({ username: 'Fantasma', password: 'x' })).json(), { success: false, message: MSG });
});

test('5 senhas erradas de IPs diferentes: a 6ª, mesmo com a senha certa, é 429', async t => {
  const { post, f } = await preparar(t, 'Caio');
  for (let i = 0; i < 5; i++) assert.equal((await post({ username: 'Caio', password: 'errada' })).status, 401);
  const r = await post({ username: 'Caio', password: 'segredo123' });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  // a chave ignora caixa e espaços das pontas
  assert.equal((await post({ username: '  CAIO ', password: 'segredo123' })).status, 429);
  // outra conta não é afetada
  assert.equal((await post({ username: 'Outro', password: 'x' })).status, 401);
  assert.equal(auditorias(f).filter(c => c.params[1] === 'login_bloqueado').length, 2);
});

test('login certo limpa a contagem da conta', async t => {
  const { post } = await preparar(t, 'Limpa');
  for (let i = 0; i < 4; i++) await post({ username: 'Limpa', password: 'errada' });
  assert.equal((await post({ username: 'Limpa', password: 'segredo123' })).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await post({ username: 'Limpa', password: 'errada' })).status, 401);
  assert.equal((await post({ username: 'Limpa', password: 'segredo123' })).status, 200);
});

test('auditoria: login_ok e login_falha com ip no detalhe, sem senha', async t => {
  const { post, f } = await preparar(t, 'AudUser');
  assert.equal((await post({ username: 'AudUser', password: 'segredo123' }, '10.1.1.1')).status, 200);
  assert.equal((await post({ username: 'AudUser', password: 'senhaErrada999' }, '10.1.1.2')).status, 401);
  const a = auditorias(f);
  assert.equal(a.length, 2);
  assert.deepEqual(a.map(c => c.params[1]), ['login_ok', 'login_falha']);
  assert.deepEqual(a.map(c => c.params[0]), ['AudUser', 'AudUser']);
  assert.deepEqual(a.map(c => c.params[2]), ['', '']);
  assert.deepEqual(a.map(c => JSON.parse(c.params[3])), [{ ip: '10.1.1.1' }, { ip: '10.1.1.2' }]);
  const tudo = JSON.stringify(f.chamadas.filter(c => /web_auditoria/.test(c.sql)));
  assert.ok(!tudo.includes('segredo123'));
  assert.ok(!tudo.includes('senhaErrada999'));
});

test('falha ao gravar a auditoria não derruba o login', async t => {
  const { post } = await preparar(t, 'SemAud', { auditoriaFalha: true });
  const erros = t.mock.method(console, 'error', () => {});
  assert.equal((await post({ username: 'SemAud', password: 'segredo123' })).status, 200);
  assert.equal((await post({ username: 'SemAud', password: 'errada' })).status, 401);
  const texto = erros.mock.calls.map(c => c.arguments.join(' ')).join('\n');
  assert.match(texto, /banco caiu/);
  assert.ok(!texto.includes('segredo123'));
});

test('usuário enorme, Unicode e aspas dão 400/401 uniforme, nunca 500', async t => {
  const { post, f } = await preparar(t, 'Existente2');
  const maus = ['a'.repeat(5000), '😀'.repeat(60), "x' OR '1'='1", 'ünï"cødé\\', '\u0000'];
  for (const username of maus) {
    const r = await post({ username, password: 'segredo123' });
    assert.ok([400, 401].includes(r.status), `status ${r.status} para ${username.slice(0, 10)}`);
    assert.equal((await r.json()).message, MSG);
  }
  const longo = auditorias(f).map(c => c.params[0]);
  assert.ok(longo.every(q => q.length <= 100));
});
