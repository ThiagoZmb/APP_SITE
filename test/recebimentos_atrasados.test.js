process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { marcarRecebimentosAtrasados, criarDisparador, SQL_MARCAR } = require('../rotas/recebimentos_atrasados');

// fluxo_de_caixa em memória; o UPDATE aplica a mesma regra do SQL (situação sem caixa/acento, como o MySQL ci)
const canon = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
function banco(linhas, { falhaUpdate = false } = {}) {
  const f = criarPoolFalso([
    [/^UPDATE fluxo_de_caixa SET SITUACAO = 'Atrasado'/, (sql, [hoje]) => {
      if (falhaUpdate) { const e = new Error('banco caiu'); e.code = 'ECONNRESET'; throw e; }
      let n = 0;
      for (const l of linhas) {
        if (canon(l.SITUACAO) === 'a receber' && l.DATA < hoje && (l.RAZAO_SOCIAL || '') !== '' && (l.RAZAO_FABRICANTE || '') === '') { l.SITUACAO = 'Atrasado'; n++; }
      }
      return { affectedRows: n };
    }]
  ]);
  return { f, linhas };
}
const auditorias = f => f.chamadas.filter(c => /INSERT INTO web_auditoria/.test(c.sql));
const L = (SITUACAO, DATA, cli, forn) => ({ SITUACAO, DATA, RAZAO_SOCIAL: cli, RAZAO_FABRICANTE: forn });

test('SQL: só A Receber, DATA estritamente menor e sentido entrada', () => {
  assert.match(SQL_MARCAR, /SITUACAO = 'A Receber' AND DATA < \?/);
  assert.doesNotMatch(SQL_MARCAR, /A Pagar|Recebido|Pago|Protestado/);
});

test('só entradas A Receber vencidas mudam; o resto fica', async () => {
  const { f, linhas } = banco([
    L('A Receber', '2026-11-03', 'Cli', ''),      // vencida -> muda
    L('a receber', '2026-01-10', 'Cli', null),    // caixa diferente -> muda
    L('A Receber', '2026-11-04', 'Cli', ''),      // hoje -> fica
    L('A Receber', '2026-12-01', 'Cli', ''),      // futuro -> fica
    L('A Pagar', '2026-01-01', '', 'Forn'),       // saída -> fica
    L('A Receber', '2026-01-01', '', 'Forn'),     // saída com situação A Receber -> fica
    L('Recebido', '2026-01-01', 'Cli', ''),
    L('Pago', '2026-01-01', '', 'Forn'),
    L('Protestado', '2026-01-01', 'Cli', ''),
    L('Faturado', '2026-01-01', 'Cli', '')
  ]);
  const r = await marcarRecebimentosAtrasados(f, { hoje: '2026-11-04' });
  assert.deepEqual(r, { marcados: 2 });
  assert.deepEqual(linhas.map(l => l.SITUACAO), ['Atrasado', 'Atrasado', 'A Receber', 'A Receber', 'A Pagar', 'A Receber', 'Recebido', 'Pago', 'Protestado', 'Faturado']);
  const a = auditorias(f);
  assert.equal(a.length, 1);
  assert.equal(a[0].params[1], 'recebimentos_atrasados_marcados');
  assert.equal(a[0].params[3], '{"qtd":2}');
  const sql = f.chamadas.map(c => c.sql);
  assert.equal(sql.filter(s => /^UPDATE/.test(s)).length, 1);
  assert.ok(sql.includes('BEGIN') && sql.includes('COMMIT'));
});

test('idempotente e sem auditoria quando nada muda', async () => {
  const { f, linhas } = banco([L('A Receber', '2026-01-01', 'Cli', '')]);
  await marcarRecebimentosAtrasados(f, { hoje: '2026-11-04' });
  const r2 = await marcarRecebimentosAtrasados(f, { hoje: '2026-11-04' });
  assert.deepEqual(r2, { marcados: 0 });
  assert.equal(linhas[0].SITUACAO, 'Atrasado');
  assert.equal(auditorias(f).length, 1);
});

test('disparador: no máximo 1 execução por hora; falha libera nova tentativa e nunca lança', async t => {
  t.mock.method(console, 'error', () => {});
  let agora = 1_000_000;
  const { f } = banco([L('A Receber', '2026-01-01', 'Cli', '')]);
  const d = criarDisparador(f, { agora: () => agora, hoje: () => '2026-11-04' });
  const updates = () => f.chamadas.filter(c => /^UPDATE/.test(c.sql)).length;
  assert.deepEqual(await d(), { marcados: 1 });
  assert.equal(await d(), null);
  agora += 59 * 60 * 1000; await d();
  assert.equal(updates(), 1);
  agora += 2 * 60 * 1000; await d();
  assert.equal(updates(), 2);

  const ruim = banco([], { falhaUpdate: true });
  const d2 = criarDisparador(ruim.f, { agora: () => agora, hoje: () => '2026-11-04' });
  assert.equal(await d2(), null); // não lançou
  await d2();
  assert.equal(ruim.f.chamadas.filter(c => /^UPDATE/.test(c.sql)).length, 2); // falha não prende por 1 hora
});

test('login continua funcionando mesmo se a marcação falhar', async t => {
  t.mock.method(console, 'error', () => {});
  const { app, pool, acesso } = require('../index.js');
  const s = await subir(app); t.after(s.fechar); acesso.limpar();
  t.mock.method(acesso, 'carregar', async () => ({ codigo: 7, nome: 'Caio', cargo: 'X', empresa: 'E', perfil: { id: 1, nome: 'P' }, estados: [], ativo: true, permissoes: new Set(['estoque.ver']) }));
  const f = criarPoolFalso([[/FROM cliente_usuarios WHERE NOME/, [{ CODIGO: 901, NOME: 'Caio', RAZAO_SOCIAL: 'E', CARGO: 'X', SENHA: bcrypt.hashSync('segredo123', 4) }]]]);
  pool.execute = f.execute;
  pool.getConnection = async () => { throw Object.assign(new Error('sem conexão'), { code: 'ECONNREFUSED' }); };
  const r = await fetch(s.url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.77.0.1' },
    body: JSON.stringify({ username: 'Caio', password: 'segredo123' }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).success, true);
});
