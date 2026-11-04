process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { criarPoolFinanceiro } = require('./apoio/poolFinanceiroPortal');
const { criarSessoesPortal } = require('../portal/sessoes');
const { criarAcessoPortal } = require('../portal/acesso');
const { cabecalhosPortal } = require('../portal/cabecalhos');
const { criarRegistro } = require('../seguranca/rotas');
const { registrarPortalFinanceiro } = require('../rotas/portal_financeiro');

const HOJE = '2026-11-04';
const OBS = 'OBS FINANCEIRA SECRETA';
const FORN = 'FORNECEDOR SECRETO LTDA';
let proximoId = 70001;
const lan = (RAZAO_SOCIAL, DATA, SITUACAO, VALOR, extra = {}) => ({
  ID: proximoId++, RAZAO_SOCIAL, RAZAO_FABRICANTE: '', DATA, PEDIDO: null, NOTA_FISCAL: null, SITUACAO, VALOR,
  OBSERVACAO_GERAL: OBS, ...extra
});
function lancamentosPadrao() {
  return [
    lan('ACME LTDA', '2026-11-04', 'A Receber', 100, { PEDIDO: 12, NOTA_FISCAL: '555' }),
    lan('ACME LTDA', '2026-11-03', 'A Receber', 200.5),
    lan('ACME LTDA', '2026-10-01', 'Atrasado', 300),
    lan('ACME LTDA', '2026-09-01', 'Protestado', 400),
    lan('ACME LTDA', '2026-06-10', 'Recebido', 500),
    lan('ACME LTDA', '2025-11-04', 'Recebido', 11.11), // exatamente 12 meses: dentro do corte (>=)
    lan('ACME LTDA', '2025-11-03', 'Recebido', 22.22), // um dia antes do corte: fora
    lan('ACME LTDA', '2025-10-01', 'Recebido', 123.45), // 13 meses: fora do corte
    lan('ACME LTDA', '2026-10-15', 'Cancelado', 999),
    lan('ACME LTDA', '2026-10-20', 'A Receber', 888, { RAZAO_FABRICANTE: FORN }),
    lan('ACME LTDA', '2026-10-21', 'A Receber', null),
    lan('ACME LTDA', null, 'A Receber', 55),
    lan('BETA LTDA', '2026-10-10', 'A Receber', 77),
    lan('BETA LTDA', '2026-08-10', 'Recebido', 66)
  ];
}
const CHAVES = ['vencimento', 'pedido', 'notaFiscal', 'valor', 'situacao'].sort();

// Usuários: 1 Ana (admin_geral, ACME), 2 Caio ('usuario' de ACME com só pedidos.ver, SEM financeiro.ver),
// 3 Dora ('usuario' de ACME com financeiro.ver), 4 Bia (admin_geral, BETA), 5 Eva (admin_geral, GAMA, sem lançamentos).
// `mutar` troca "c.CODIGO = ?" por "1 = 1" no SQL antes do pool falso (prova de mutação).
async function montar(t, { lancamentos = lancamentosPadrao(), mutar = false, quebrarBanco = false, quebrarAuditoria = false } = {}) {
  const banco = criarBancoPortal();
  const d = banco.dados;
  d.clientes.push({ CODIGO: 40, RAZAO_SOCIAL: 'ACME LTDA' }, { CODIGO: 41, RAZAO_SOCIAL: 'BETA LTDA' }, { CODIGO: 42, RAZAO_SOCIAL: 'GAMA LTDA' });
  d.empresas.push({ cliente_codigo: 40, situacao: 'ativa' }, { cliente_codigo: 41, situacao: 'ativa' }, { cliente_codigo: 42, situacao: 'ativa' });
  const u = (id, email, cliente, papel) => ({ id, email, cliente_codigo: cliente, papel, situacao: 'ativo' });
  d.usuarios.push(u(1, 'ana@acme.com', 40, 'admin_geral'), u(2, 'caio@acme.com', 40, 'usuario'),
    u(3, 'dora@acme.com', 40, 'usuario'), u(4, 'bia@beta.com', 41, 'admin_geral'), u(5, 'eva@gama.com', 42, 'admin_geral'));
  d.permissoes.push({ usuario_id: 2, permissao: 'pedidos.ver' }, { usuario_id: 3, permissao: 'financeiro.ver' });

  const pool = criarPoolFinanceiro({ lancamentos, clientes: d.clientes });
  let poolUsado = pool;
  if (mutar) poolUsado = { execute: (sql, params) => pool.execute(sql.replace('c.CODIGO = ?', '1 = 1'), params) };
  if (quebrarBanco) poolUsado = { execute: async () => { throw { code: 'ER_X', sqlMessage: 'SEGREDO DO BANCO' }; } };
  if (quebrarAuditoria) {
    poolUsado = { execute: (sql, params) => {
      if (/web_portal_auditoria/.test(sql)) throw { code: 'ER_AUD' };
      return pool.execute(sql, params);
    } };
  }

  const config = { ativo: true, baseUrl: 'https://portal.exemplo.com', chaveCripto: '', termoVersao: 'T1' };
  const app = express();
  app.use(cabecalhosPortal);
  const sessoes = criarSessoesPortal({ pool: banco.pool });
  const { portalAtivo, portalAutenticar } = criarAcessoPortal({ pool: banco.pool, sessoes, config });
  const registro = criarRegistro(app, { autenticado: [], portalPublico: [portalAtivo], portalAutenticado: [portalAtivo, portalAutenticar] });
  registrarPortalFinanceiro({ portal: registro.portal, pool: poolUsado, hoje: () => HOJE });
  registro.verificar();
  const s = await subir(app);
  t.after(s.fechar);
  const cookieDe = async usuarioId => `__Host-portal=${await sessoes.criar(usuarioId, '1.2.3.4')}`;
  const get = (caminho, { cookie, headers = {} } = {}) => fetch(s.url + caminho, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  return { banco, d, registro, pool, get, cookieDe };
}

const consultas = pool => pool.chamadas.filter(c => /FROM fluxo_de_caixa/.test(c.sql));
const consultasTitulos = pool => consultas(pool).filter(c => !/SUM\(/.test(c.sql));
const consultaResumo = pool => consultas(pool).filter(c => /SUM\(/.test(c.sql));
const soma = ts => Math.round(ts.reduce((a, t) => a + t.valor, 0) * 100) / 100;

async function afirmarAbertosSoDeAcme(c) {
  const r = await c.get('/portal/api/financeiro', { cookie: await c.cookieDe(1) });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo.titulos.map(t => t.vencimento), ['2026-09-01', '2026-10-01', '2026-11-03', '2026-11-04']);
  return corpo;
}

test('abertos de ACME: 4 títulos na ordem de vencimento, rótulos certos, sem BETA, cancelado, fornecedor nem nulos', async t => {
  const c = await montar(t);
  const corpo = await afirmarAbertosSoDeAcme(c);
  assert.equal(corpo.titulos.length, 4);
  assert.deepEqual(corpo.titulos.map(x => x.situacao), ['Protestado', 'Em atraso', 'Em atraso', 'A receber']);
  assert.deepEqual(corpo.titulos.map(x => x.valor), [400, 300, 200.5, 100]);
  assert.equal(corpo.visao, 'abertos');
  assert.equal(corpo.pagina, 1);
  assert.equal(corpo.temMais, false);
  const ultimo = corpo.titulos[3];
  assert.equal(ultimo.pedido, 12);
  assert.equal(ultimo.notaFiscal, '555');
});

test('resumo de ACME: aReceber 1000.5, emAtraso 900.5, igual nas duas visões e igual à soma dos títulos abertos', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const abertos = await (await c.get('/portal/api/financeiro?visao=abertos', { cookie })).json();
  const pagos = await (await c.get('/portal/api/financeiro?visao=pagos', { cookie })).json();
  assert.equal(abertos.resumo.aReceber, 1000.5);
  assert.equal(abertos.resumo.emAtraso, 900.5);
  assert.deepEqual(pagos.resumo, abertos.resumo);
  assert.ok(abertos.titulos.length > 0);
  assert.equal(soma(abertos.titulos), abertos.resumo.aReceber);
  assert.equal(typeof abertos.resumo.aReceber, 'number');
  assert.equal(consultaResumo(c.pool).length, 2);
});

test('pagos: só o recebido dos últimos 12 meses; resumo continua o dos abertos', async t => {
  const c = await montar(t);
  const corpo = await (await c.get('/portal/api/financeiro?visao=pagos', { cookie: await c.cookieDe(1) })).json();
  // 2025-11-04 (exatamente 12 meses) entra; 2025-11-03 e 2025-10-01 ficam de fora.
  assert.deepEqual(corpo.titulos.map(x => x.vencimento), ['2026-06-10', '2025-11-04']);
  assert.deepEqual(corpo.titulos.map(x => x.valor), [500, 11.11]);
  assert.ok(corpo.titulos.every(x => x.situacao === 'Pago'));
  assert.equal(corpo.visao, 'pagos');
  assert.equal(corpo.resumo.aReceber, 1000.5);
  const q = consultasTitulos(c.pool)[0];
  assert.deepEqual(q.params, [40, '2025-11-04']);
});

test('lista fechada: cada título tem exatamente 5 chaves e nada sensível vaza na resposta', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  let total = 0;
  for (const visao of ['abertos', 'pagos']) {
    const r = await c.get('/portal/api/financeiro?visao=' + visao, { cookie });
    const texto = await r.text();
    const corpo = JSON.parse(texto);
    assert.ok(corpo.titulos.length > 0);
    for (const x of corpo.titulos) { assert.deepEqual(Object.keys(x).sort(), CHAVES); total++; }
    for (const proibido of [OBS, FORN, 'OBSERVACAO', 'RAZAO', 'ID', '7000', '7001', '999', '888', '123.45', '22.22', 'ACME', 'BETA', 'Cancelado']) {
      assert.ok(!texto.includes(proibido), `vazou ${proibido}`);
    }
  }
  assert.equal(total, 6);
});

test('SQL fixo: SELECT só com as 5 colunas, filtro de empresa, fornecedor vazio, sem OR nos títulos; empresa só da sessão', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const extras = { headers: { 'X-Empresa': '41', 'X-Cliente': 'BETA LTDA' } };
  for (const visao of ['abertos', 'pagos']) {
    await c.get(`/portal/api/financeiro?visao=${visao}&empresa=41&cliente=BETA%20LTDA&codigo=41`, { cookie, ...extras });
  }
  const titulos = consultasTitulos(c.pool);
  const resumos = consultaResumo(c.pool);
  assert.equal(titulos.length, 2);
  assert.equal(resumos.length, 2);
  for (const q of [...titulos, ...resumos]) {
    assert.match(q.sql, /c\.CODIGO = \?/);
    assert.match(q.sql, /COALESCE\(f\.RAZAO_FABRICANTE, ''\) = ''/);
    assert.equal(q.sql.match(/RAZAO_FABRICANTE/g).length, 1); // só dentro do COALESCE
    assert.match(q.sql, /f\.DATA IS NOT NULL/);
    assert.match(q.sql, /f\.VALOR IS NOT NULL/);
    const select = q.sql.slice(0, q.sql.search(/\bFROM\b/));
    assert.ok(select.length > 10);
    assert.doesNotMatch(select, /OBSERVACAO|CREDITO|TOTAL|f\.ID\b.*AS|RAZAO_SOCIAL AS|RAZAO_FABRICANTE|\bID\b/i);
  }
  for (const q of titulos) {
    assert.doesNotMatch(q.sql, /\bOR\b/i);
    const select = q.sql.slice(0, q.sql.search(/\bFROM\b/));
    for (const col of ['f.DATA', 'f.PEDIDO', 'f.NOTA_FISCAL', 'f.SITUACAO', 'f.VALOR']) assert.ok(select.includes(col), col);
    assert.match(q.sql, /ORDER BY f\.(DATA ASC, f\.ID ASC|DATA DESC, f\.ID DESC)/);
    assert.equal(q.params[0], 40);
  }
  for (const q of resumos) {
    assert.equal(q.params[1], 40); // [hoje, empresa]
    assert.equal(q.params[0], HOJE);
    assert.doesNotMatch(q.sql, /Recebido|Cancelado/);
    // Fora da lista do SELECT, o resumo não pode ter nenhum OR (um OR solto abriria o filtro de empresa).
    const resto = q.sql.slice(q.sql.search(/\bFROM\b/));
    assert.equal((resto.match(/\bOR\b/gi) || []).length, 0);
    // O único OR do resumo está dentro do IF() do SELECT, com este texto exato.
    assert.ok(q.sql.includes("SUM(IF(f.SITUACAO IN ('Atrasado','Protestado') OR f.DATA < ?, f.VALOR, 0))"));
  }
  const lista = await (await c.get('/portal/api/financeiro?empresa=41', { cookie, headers: { 'X-Empresa': '41' } })).json();
  assert.equal(lista.titulos.length, 4);
  assert.equal(lista.resumo.aReceber, 1000.5);
});

test('grafias do VB (caixa mista, espaços): a lista de abertos soma o mesmo que o resumo e RECEBIDO aparece em pagos', async t => {
  const lancamentos = [
    lan('ACME LTDA', '2026-11-10', 'A receber', 10),
    lan('ACME LTDA', '2026-10-05', ' Atrasado ', 20),
    lan('ACME LTDA', '2026-11-01', 'a RECEBER', 5), // vencido: Em atraso
    lan('ACME LTDA', '2026-07-01', 'RECEBIDO', 30)
  ];
  const c = await montar(t, { lancamentos });
  const cookie = await c.cookieDe(1);
  const ab = await (await c.get('/portal/api/financeiro', { cookie })).json();
  assert.equal(ab.titulos.length, 3);
  assert.equal(ab.resumo.aReceber, 35);
  assert.equal(soma(ab.titulos), ab.resumo.aReceber);
  assert.equal(ab.resumo.emAtraso, 25);
  assert.equal(soma(ab.titulos.filter(x => x.situacao === 'Em atraso')), ab.resumo.emAtraso);
  assert.deepEqual(ab.titulos.map(x => x.situacao), ['Em atraso', 'Em atraso', 'A receber']);
  const pg = await (await c.get('/portal/api/financeiro?visao=pagos', { cookie })).json();
  assert.deepEqual(pg.titulos.map(x => [x.valor, x.situacao]), [[30, 'Pago']]);
});

test('linha descartada pela projeção: console.warn só com a contagem, sem dados', async t => {
  const lancamentos = [
    lan('ACME LTDA', '2026-11-10', 'A Receber', 10),
    lan('ACME LTDA', 'SEGREDO-DATA', 'A Receber', 777.77, { PEDIDO: 'SEGREDO-PED' })
  ];
  const c = await montar(t, { lancamentos });
  const original = console.warn;
  const avisos = [];
  console.warn = (...a) => avisos.push(a.join(' '));
  let corpo;
  try {
    corpo = await (await c.get('/portal/api/financeiro', { cookie: await c.cookieDe(1) })).json();
  } finally { console.warn = original; }
  assert.equal(corpo.titulos.length, 1);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /\b1\b/);
  assert.doesNotMatch(avisos[0], /SEGREDO|777|ACME|2026/);
  // sem descarte, sem aviso
  const ok = await montar(t);
  console.warn = (...a) => avisos.push(a.join(' '));
  try { await ok.get('/portal/api/financeiro', { cookie: await ok.cookieDe(1) }); } finally { console.warn = original; }
  assert.equal(avisos.length, 1);
});

test('prova de mutação: sem "c.CODIGO = ?" (trocado por "1 = 1") o isolamento FALHA, logo o pool falso aplica o filtro de verdade', async t => {
  const bom = await montar(t);
  await afirmarAbertosSoDeAcme(bom); // controle
  const ruim = await montar(t, { mutar: true });
  const r = await ruim.get('/portal/api/financeiro', { cookie: await ruim.cookieDe(1) });
  const corpo = await r.json();
  assert.ok(corpo.titulos.some(x => x.valor === 77), 'a mutação deveria vazar o título de 77 de BETA');
  await assert.rejects(() => afirmarAbertosSoDeAcme(ruim), assert.AssertionError);
  assert.notEqual(corpo.resumo.aReceber, 1000.5);
});

test('BETA vê só o seu; empresa sem lançamentos recebe 200 vazio; página além do fim é vazia', async t => {
  const c = await montar(t);
  const beta = await c.cookieDe(4);
  const ab = await (await c.get('/portal/api/financeiro', { cookie: beta })).json();
  assert.equal(ab.titulos.length, 1);
  assert.equal(ab.resumo.aReceber, 77);
  assert.equal(ab.resumo.emAtraso, 77); // 2026-10-10 < hoje
  const pg = await (await c.get('/portal/api/financeiro?visao=pagos', { cookie: beta })).json();
  assert.equal(pg.titulos.length, 1);
  assert.equal(pg.titulos[0].valor, 66);

  const gama = await c.get('/portal/api/financeiro', { cookie: await c.cookieDe(5) });
  assert.equal(gama.status, 200);
  const g = await gama.json();
  assert.deepEqual({ resumo: g.resumo, titulos: g.titulos, temMais: g.temMais }, { resumo: { aReceber: 0, emAtraso: 0 }, titulos: [], temMais: false });

  const alem = await c.get('/portal/api/financeiro?pagina=2', { cookie: await c.cookieDe(1) });
  assert.equal(alem.status, 200);
  const a = await alem.json();
  assert.deepEqual(a.titulos, []);
  assert.equal(a.temMais, false);
  assert.equal(a.pagina, 2);
});

test('paginação: 51 em aberto = 50 + 1; pagina e visao inválidas dão 400 sem consultar o banco', async t => {
  const muitos = Array.from({ length: 51 }, (_, i) => lan('ACME LTDA', `2026-12-${String(1 + (i % 28)).padStart(2, '0')}`, 'A Receber', 10));
  const c = await montar(t, { lancamentos: muitos });
  const cookie = await c.cookieDe(1);
  const p1 = await (await c.get('/portal/api/financeiro', { cookie })).json();
  assert.equal(p1.titulos.length, 50);
  assert.equal(p1.temMais, true);
  assert.equal(p1.resumo.aReceber, 510);
  const p2 = await (await c.get('/portal/api/financeiro?pagina=2', { cookie })).json();
  assert.equal(p2.titulos.length, 1);
  assert.equal(p2.temMais, false);

  const antes = c.pool.chamadas.length;
  assert.ok(antes >= 4);
  const ruins = ['pagina=0', 'pagina=-1', 'pagina=1.5', 'pagina=abc', 'pagina=100001', 'pagina=1&pagina=2',
    'visao=todos', 'visao=abertos&visao=pagos', 'visao='];
  for (const q of ruins) {
    const r = await c.get('/portal/api/financeiro?' + q, { cookie });
    assert.equal(r.status, 400, q);
  }
  assert.equal(c.pool.chamadas.length, antes);
});

test('auditoria: 1 linha financeiro_visto por 200, sem valores; nenhuma em 400/401/403; falha de gravação não muda o 200', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const r = await c.get('/portal/api/financeiro', { cookie });
  assert.equal(r.status, 200);
  assert.equal(c.pool.auditoria.length, 1);
  const linha = c.pool.auditoria[0];
  assert.equal(linha.evento, 'financeiro_visto');
  assert.equal(linha.usuario_id, 1);
  assert.equal(linha.cliente_codigo, 40);
  assert.ok(typeof linha.ip === 'string' && linha.ip.length > 0);
  assert.equal(linha.detalhe, 'visao=abertos;pagina=1');
  assert.doesNotMatch(String(linha.detalhe), /\d+[.,]\d{2}|ACME|555/);

  await c.get('/portal/api/financeiro?visao=pagos&pagina=1', { cookie });
  assert.equal(c.pool.auditoria.length, 2);
  assert.equal(c.pool.auditoria[1].detalhe, 'visao=pagos;pagina=1');

  assert.equal((await c.get('/portal/api/financeiro?visao=todos', { cookie })).status, 400);
  assert.equal((await c.get('/portal/api/financeiro')).status, 401);
  assert.equal((await c.get('/portal/api/financeiro', { cookie: await c.cookieDe(2) })).status, 403);
  assert.equal(c.pool.auditoria.length, 2);

  const q = await montar(t, { quebrarAuditoria: true });
  const original = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const rq = await q.get('/portal/api/financeiro', { cookie: await q.cookieDe(1) });
    assert.equal(rq.status, 200);
    assert.equal((await rq.json()).titulos.length, 4);
  } finally { console.error = original; }
  assert.ok(logs.some(l => l.includes('ER_AUD')));
});

test('autenticação: sem cookie 401; JWT de funcionário 401; sem financeiro.ver 403 sem consulta; empresa suspensa 401', async t => {
  const c = await montar(t);
  assert.equal((await c.get('/portal/api/financeiro')).status, 401);
  const jwtFunc = jwt.sign({ id: 1, nome: 'Func', v: 2, tipo: 'funcionario', sid: 'a'.repeat(32) }, 'teste');
  assert.equal((await c.get('/portal/api/financeiro', { cookie: `__Host-portal=${jwtFunc}` })).status, 401);
  assert.equal((await c.get('/portal/api/financeiro', { cookie: await c.cookieDe(2) })).status, 403); // Caio: só pedidos.ver
  assert.equal(c.pool.chamadas.length, 0);
  assert.equal((await c.get('/portal/api/financeiro', { cookie: await c.cookieDe(3) })).status, 200); // Dora: financeiro.ver
  assert.ok(consultas(c.pool).length > 0);
  const cookie = await c.cookieDe(1);
  assert.equal((await c.get('/portal/api/financeiro', { cookie })).status, 200);
  c.d.empresas.find(e => e.cliente_codigo === 40).situacao = 'suspensa';
  assert.equal((await c.get('/portal/api/financeiro', { cookie })).status, 401);
});

test('erro de banco: 500 genérico e o log só leva o código', async t => {
  const c = await montar(t, { quebrarBanco: true });
  const original = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  let r; let corpo;
  try {
    r = await c.get('/portal/api/financeiro', { cookie: await c.cookieDe(1) });
    corpo = await r.json();
  } finally { console.error = original; }
  assert.equal(r.status, 500);
  assert.deepEqual(corpo, { error: 'Erro de servidor' });
  assert.ok(logs.length > 0);
  assert.ok(logs.some(l => l.includes('ER_X')));
  assert.ok(!logs.some(l => l.includes('SEGREDO')));
});

test('registro: get /portal/api/financeiro está em rotasPortal e verificar() não lança', async t => {
  const c = await montar(t);
  const lista = c.registro.rotasPortal().map(r => `${r.metodo} ${r.caminho}`);
  assert.ok(lista.includes('get /portal/api/financeiro'));
  assert.doesNotThrow(() => c.registro.verificar());
});
