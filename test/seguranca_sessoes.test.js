process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { criarSessoes } = require('../seguranca/sessoes');
const { app, pool, acesso, registro } = require('../index.js');

// Banco falso com a tabela web_sessoes em memória (interpreta os SQL do módulo).
function bancoSessoes(extras = []) {
  const linhas = [];
  const f = criarPoolFalso([
    [/INSERT INTO web_sessoes/, (sql, [id, usuario, criado, expira, ip]) => { linhas.push({ id, usuario, criado, expira, ip, revogada: 0 }); return {}; }],
    [/SELECT id FROM web_sessoes/, (sql, [id, usuario, agora]) =>
      linhas.filter(l => l.id === id && l.usuario === usuario && !l.revogada && l.expira > agora).map(l => ({ id: l.id }))],
    [/UPDATE web_sessoes SET revogada = 1 WHERE id = \?/, (sql, [id]) => { linhas.filter(l => l.id === id).forEach(l => { l.revogada = 1; }); return {}; }],
    [/UPDATE web_sessoes SET revogada = 1 WHERE usuario_codigo = \? AND revogada = 0 AND id <> \?/, (sql, [u, ex]) => { linhas.filter(l => l.usuario === u && l.id !== ex).forEach(l => { l.revogada = 1; }); return {}; }],
    [/UPDATE web_sessoes SET revogada = 1 WHERE usuario_codigo = \?/, (sql, [u]) => { linhas.filter(l => l.usuario === u).forEach(l => { l.revogada = 1; }); return {}; }],
    ...extras
  ]);
  return { f, linhas };
}

test('criar: id de 32 hex e expira_em = agora + 8 h', async () => {
  const { f, linhas } = bancoSessoes();
  const agora = new Date('2026-11-03T10:00:00Z');
  const s = criarSessoes({ pool: f, agora: () => agora });
  const id = await s.criar(7, '1.2.3.4');
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(linhas[0].usuario, 7);
  assert.equal(linhas[0].expira.getTime() - agora.getTime(), 8 * 3600 * 1000);
  assert.equal(linhas[0].ip, '1.2.3.4');
  assert.notEqual(await s.criar(7, null), id);
});

test('valida: false para revogada, expirada, de outro usuário, inexistente e sid malformado', async () => {
  const { f } = bancoSessoes();
  let agora = new Date('2026-11-03T10:00:00Z');
  const s = criarSessoes({ pool: f, agora: () => agora });
  const id = await s.criar(7, null);
  assert.equal(await s.valida(id, 7), true);
  assert.equal(await s.valida(id, 8), false);
  assert.equal(await s.valida('f'.repeat(32), 7), false);
  assert.equal(await s.valida(undefined, 7), false);
  assert.equal(await s.valida("x' OR '1'='1", 7), false);
  agora = new Date('2026-11-03T18:00:01Z');
  assert.equal(await s.valida(id, 7), false, 'expirada');
  agora = new Date('2026-11-03T10:30:00Z');
  await s.revogar(id);
  assert.equal(await s.valida(id, 7), false, 'revogada');
});

test('revogarTodas com exceto não revoga a sessão atual', async () => {
  const { f } = bancoSessoes();
  const s = criarSessoes({ pool: f });
  const a = await s.criar(7, null), b = await s.criar(7, null), c = await s.criar(9, null);
  await s.revogarTodas(7, { exceto: a });
  assert.equal(await s.valida(a, 7), true);
  assert.equal(await s.valida(b, 7), false);
  assert.equal(await s.valida(c, 9), true, 'outro usuário intacto');
  await s.revogarTodas(7);
  assert.equal(await s.valida(a, 7), false);
});

// ---------- HTTP ----------
const HASH = bcrypt.hashSync('segredo123', 4);
const acessoDe = () => ({ codigo: 7, nome: 'Caio', cargo: 'Produção', empresa: 'ELEGANCE', perfil: { id: 4, nome: 'X' },
  estados: [], ativo: true, permissoes: new Set(['estoque.ver']) });
const assinar = claims => jwt.sign(claims, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

// O app usa a instância real de sessões sobre o pool (trocado aqui): nenhum desvio na produção.
async function preparar(t, extras = []) {
  const banco = bancoSessoes([[/FROM cliente_usuarios WHERE NOME/, [{ CODIGO: 7, NOME: 'Caio', RAZAO_SOCIAL: 'ELEGANCE', CARGO: 'Produção', SENHA: HASH }]], ...extras]);
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  const s = await subir(app);
  t.after(s.fechar);
  acesso.limpar();
  return { s, banco };
}
const login = s => fetch(s.url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Caio', password: 'segredo123' }) });
const verify = (s, token) => fetch(s.url + '/auth/verify', { headers: { Authorization: 'Bearer ' + token } });
const logout = (s, token) => fetch(s.url + '/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });

test('login devolve token com sid e cria a sessão no banco', async t => {
  const { s, banco } = await preparar(t);
  t.mock.method(acesso, 'carregar', async () => acessoDe());
  const d = await (await login(s)).json();
  const claims = jwt.decode(d.token);
  assert.match(claims.sid, /^[0-9a-f]{32}$/);
  assert.equal(banco.linhas.length, 1);
  assert.equal(banco.linhas[0].id, claims.sid);
  assert.equal((await verify(s, d.token)).status, 200);
});

test('login recusado (403 de acesso negado) não cria sessão', async t => {
  const { s, banco } = await preparar(t);
  t.mock.method(acesso, 'carregar', async () => ({ ...acessoDe(), ativo: false }));
  assert.equal((await login(s)).status, 403);
  assert.equal(banco.linhas.length, 0);
});

test('logout revoga na hora, mesmo com o acesso em cache (60 s)', async t => {
  const { s } = await preparar(t);
  // acesso real (com cache), alimentado pelo banco falso: a segunda chamada vem do cache
  let cargas = 0;
  const original = acesso.carregar;
  t.mock.method(acesso, 'carregar', async id => { cargas++; return acessoDe(); });
  const { token } = await (await login(s)).json();
  assert.equal((await verify(s, token)).status, 200);
  assert.equal((await verify(s, token)).status, 200);
  const r = await logout(s, token);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const depois = await verify(s, token);
  assert.equal(depois.status, 401);
  assert.deepEqual(await depois.json(), { error: 'Sessão expirada. Faça login novamente.' });
  assert.ok(cargas >= 1 && original);
});

test('logout revoga na hora com o cache real do acesso preenchido', async t => {
  const { s, banco } = await preparar(t, [
    [/FROM cliente_usuarios WHERE CODIGO/, [{ CODIGO: 7, NOME: 'Caio', CARGO: 'Produção', RAZAO_SOCIAL: 'ELEGANCE', SITUACAO: 'ATIVO' }]],
    [/FROM web_usuario_acesso/, [{ perfil_id: 4, estados: '', ativo: 1, perfil_nome: 'X', perfil_ativo: 1 }]],
    [/FROM web_perfil_permissoes/, [{ permissao: 'estoque.ver' }]]
  ]);
  const { token } = await (await login(s)).json();
  assert.equal((await verify(s, token)).status, 200);
  const consultasAcesso = () => banco.f.chamadas.filter(c => /FROM cliente_usuarios WHERE CODIGO/.test(c.sql)).length;
  const antes = consultasAcesso();
  assert.equal((await verify(s, token)).status, 200);
  assert.equal(consultasAcesso(), antes, 'segunda chamada veio do cache de permissões');
  assert.equal((await logout(s, token)).status, 200);
  assert.equal((await verify(s, token)).status, 401);
});

// tokens com sessão criada direto no banco falso (o /login tem limite de 5 por IP)
const comSessao = (banco, id = 7) => {
  const sid = require('node:crypto').randomBytes(16).toString('hex');
  banco.linhas.push({ id: sid, usuario: id, expira: new Date(Date.now() + 1e6), revogada: 0 });
  return assinar({ id, nome: 'Caio', v: 2, tipo: 'funcionario', sid });
};

test('logout duas vezes: a segunda é 401 (sessão revogada), sem 5xx', async t => {
  const { s, banco } = await preparar(t);
  t.mock.method(acesso, 'carregar', async () => acessoDe());
  const token = comSessao(banco);
  assert.equal((await logout(s, token)).status, 200);
  assert.equal((await logout(s, token)).status, 401);
});

test('logout com token expirado, inválido ou sem token: 401, sem exceção', async t => {
  const { s } = await preparar(t);
  const expirado = jwt.sign({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario', sid: 'a'.repeat(32) }, 'teste', { issuer: 'elegance-api', expiresIn: -10 });
  assert.equal((await logout(s, expirado)).status, 401);
  assert.equal((await logout(s, 'lixo')).status, 401);
  assert.equal((await fetch(s.url + '/logout', { method: 'POST' })).status, 401);
});

test('token sem sid é recusado com a mensagem de sessão expirada', async t => {
  const { s } = await preparar(t);
  t.mock.method(acesso, 'carregar', async () => acessoDe());
  const r = await verify(s, assinar({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario' }));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'Sessão expirada. Faça login novamente.' });
});

test('sessão de outro usuário não vale para o id do token', async t => {
  const { s, banco } = await preparar(t);
  t.mock.method(acesso, 'carregar', async () => acessoDe());
  const token = comSessao(banco, 7);
  const forjado = assinar({ id: 8, nome: 'Outro', v: 2, tipo: 'funcionario', sid: jwt.decode(token).sid });
  assert.equal((await verify(s, forjado)).status, 401);
});

test('POST /admin/usuarios/:codigo/senha revoga todas as sessões do usuário alterado', async t => {
  const { s, banco } = await preparar(t, [
    [/SELECT CODIGO, NOME FROM cliente_usuarios WHERE CODIGO/, [{ CODIGO: 9, NOME: 'Ana' }]]
  ]);
  const admin = { ...acessoDe(), codigo: 1, nome: 'Adm', permissoes: new Set(['admin.usuarios']) };
  t.mock.method(acesso, 'carregar', async () => admin);
  banco.linhas.push({ id: 'b'.repeat(32), usuario: 1, expira: new Date(Date.now() + 1e6), revogada: 0 });
  banco.linhas.push({ id: 'c'.repeat(32), usuario: 9, expira: new Date(Date.now() + 1e6), revogada: 0 });
  const r = await fetch(s.url + '/admin/usuarios/9/senha', { method: 'POST',
    headers: { Authorization: 'Bearer ' + assinar({ id: 1, nome: 'Adm', v: 2, tipo: 'funcionario', sid: 'b'.repeat(32) }), 'Content-Type': 'application/json' },
    body: JSON.stringify({ senha: 'novasenha123' }) });
  assert.equal(r.status, 200);
  assert.ok(banco.f.chamadas.find(c => /UPDATE web_sessoes SET revogada = 1/.test(c.sql) && c.params[0] === 9), 'UPDATE de revogação do usuário 9');
  assert.equal(banco.linhas.find(l => l.usuario === 9).revogada, 1);
  assert.equal(banco.linhas.find(l => l.usuario === 1).revogada, 0, 'a do admin continua');
});

test('/admin/definir_senha busca o CODIGO pelo nome e revoga as sessões', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const trecho = fonte.slice(fonte.indexOf("'/admin/definir_senha'"), fonte.indexOf("'/migrar_senhas'"));
  assert.match(trecho, /SELECT CODIGO FROM cliente_usuarios WHERE NOME = \?/);
  assert.match(trecho, /sessoes\.revogarTodas\(/);
});

test('layout.js chama /logout antes de removeItem(auth) nos dois pontos de saída', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'layout.js'), 'utf8');
  assert.match(src, /function encerrarSessao\(\)[\s\S]*?API \+ '\/logout'[\s\S]*?method: 'POST'[\s\S]*?keepalive: true/);
  const pos = src.indexOf('function encerrarSessao');
  const pares = [...src.matchAll(/encerrarSessao\(\);\s*localStorage\.removeItem\('auth'\)/g)];
  assert.equal(pares.length, 2, 'os dois botões de saída');
  for (const m of pares) assert.ok(m.index > pos);
});

test('POST /logout é rota autenticada sem permissão exigida', () => {
  assert.ok(registro.rotasAutenticadas().some(r => r.metodo === 'post' && r.caminho === '/logout'));
});

// ---------- cache curto da validação (cada consulta custa ~190 ms entre o Render e o HostGator) ----------
const selecoes = f => f.chamadas.filter(c => /SELECT id FROM web_sessoes/.test(c.sql)).length;

test('cache: a 2ª validação dentro do prazo não vai ao banco; passado o prazo, confere de novo', async () => {
  const { f } = bancoSessoes();
  let agora = new Date('2026-11-03T10:00:00Z');
  const s = criarSessoes({ pool: f, agora: () => agora, cacheMs: 30000 });
  const id = await s.criar(7, null);
  assert.equal(await s.valida(id, 7), true); assert.equal(selecoes(f), 1);
  assert.equal(await s.valida(id, 7), true); assert.equal(selecoes(f), 1, 'veio do cache');
  agora = new Date('2026-11-03T10:00:29Z');
  assert.equal(await s.valida(id, 7), true); assert.equal(selecoes(f), 1);
  agora = new Date('2026-11-03T10:00:31Z');
  assert.equal(await s.valida(id, 7), true); assert.equal(selecoes(f), 2, 'passou de 30 s: confere no banco');
});

test('cache: só guarda o que deu CERTO e só vale para o mesmo usuário; cacheMs 0 desliga', async () => {
  const { f } = bancoSessoes();
  const s = criarSessoes({ pool: f, cacheMs: 30000 });
  const id = await s.criar(7, null);
  assert.equal(await s.valida(id, 8), false); assert.equal(await s.valida(id, 8), false);
  assert.equal(selecoes(f), 2, 'resultado falso nunca é guardado');
  assert.equal(await s.valida(id, 7), true);
  assert.equal(await s.valida(id, 8), false, 'sid guardado para o usuário 7 não vale para o 8');
  const { f: g } = bancoSessoes();
  const sem = criarSessoes({ pool: g, cacheMs: 0 });
  const id2 = await sem.criar(7, null);
  await sem.valida(id2, 7); await sem.valida(id2, 7);
  assert.equal(selecoes(g), 2, 'cacheMs 0 = confere no banco toda vez');
});

test('cache: logout (revogar) e troca de senha (revogarTodas) valem NA HORA, sem esperar o prazo', async () => {
  const { f } = bancoSessoes();
  const s = criarSessoes({ pool: f, cacheMs: 30000 });
  const a = await s.criar(7, null), b = await s.criar(7, null), c = await s.criar(9, null);
  for (const [id, u] of [[a, 7], [b, 7], [c, 9]]) assert.equal(await s.valida(id, u), true);
  await s.revogar(a);
  assert.equal(await s.valida(a, 7), false, 'logout vale na hora');
  assert.equal(await s.valida(b, 7), true);
  await s.revogarTodas(7, { exceto: b });
  assert.equal(await s.valida(b, 7), true, 'a sessão de quem trocou a senha continua');
  await s.revogarTodas(7);
  assert.equal(await s.valida(b, 7), false, 'troca de senha derruba as outras na hora');
  assert.equal(await s.valida(c, 9), true, 'outro usuário intacto');
});

test('cache: uma validação que estava no ar durante a revogação não guarda o resultado antigo', async () => {
  const { f, linhas } = bancoSessoes();
  const s = criarSessoes({ pool: f, cacheMs: 30000 });
  const id = await s.criar(7, null);
  // atrasa só o SELECT: ele lê "válida", a revogação acontece, e só então o SELECT devolve
  const original = f.execute.bind(f); let solta;
  const segurado = new Promise(r => { solta = r; });
  f.execute = async (sql, p) => { const r = await original(sql, p); if (/SELECT id FROM web_sessoes/.test(sql)) await segurado; return r; };
  const emVoo = s.valida(id, 7);
  await new Promise(r => setTimeout(r, 5));
  f.execute = original;
  await s.revogar(id);
  solta();
  assert.equal(await emVoo, true, 'quem já estava no ar recebe o resultado que leu');
  assert.equal(linhas[0].revogada, 1);
  assert.equal(await s.valida(id, 7), false, 'mas a revogação não foi desfeita pelo cache: a próxima já vê');
});
