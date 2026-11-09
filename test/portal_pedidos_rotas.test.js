process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { criarPoolPedidos } = require('./apoio/poolPedidosPortal');
const { criarSessoesPortal } = require('../portal/sessoes');
const { criarAcessoPortal } = require('../portal/acesso');
const { cabecalhosPortal } = require('../portal/cabecalhos');
const { criarRegistro } = require('../seguranca/rotas');
const { registrarPortalPedidos } = require('../rotas/portal_pedidos');

const SEGREDOS = { TOTAL: 99999.99, OBS_GERAL: 'OBS SECRETA DO PEDIDO', CLIENTE_FINAL: 'CLIENTE FINAL SECRETO' };
const ped = (NUMERO, RAZAO_SOCIAL, extra = {}) => ({
  NUMERO, TIPO: 'Pedido', RAZAO_SOCIAL, DATA: '2026-10-01', SITUACAO: 'Em Produção', DATA_ENTREGA: null, ...SEGREDOS, ...extra
});
const PEDIDOS = [
  ped(12, 'ACME LTDA', { SITUACAO: 'Entregue', DATA_ENTREGA: '2026-10-20' }),
  ped(120, 'ACME LTDA', { SITUACAO: 'Entregue', DATA_ENTREGA: '2026-10-25' }),
  ped(13, 'ACME LTDA'),
  ped(14, 'ACME LTDA', { SITUACAO: 'Pronto' }),
  ped(15, 'ACME LTDA', { TIPO: 'Orçamento' }),
  ped(99, 'BETA LTDA')
];
const ENTREGAS = [
  { numero: 12, status: 'entregue', data_agendada: null },
  { numero: 120, status: 'entregue', data_agendada: null },
  { numero: 14, status: 'agendada', data_agendada: '2026-11-10' }
];
const CHAVES = ['numero', 'data', 'situacao', 'dataEntrega', 'entrega', 'dataAgendada'].sort();

// Usuários do portal: 1 Ana (admin_geral, ACME), 2 Caio (papel 'usuario' de ACME, SEM permissões),
// 3 Dora (papel 'usuario' de ACME com pedidos.ver), 4 Bia (admin_geral, BETA).
// `mutar` troca "c.CODIGO = ?" por "1 = 1" no SQL antes de chegar ao pool falso (prova de mutação, teste 5).
async function montar(t, { pedidos = PEDIDOS, mutar = false, limite } = {}) {
  const banco = criarBancoPortal();
  const d = banco.dados;
  d.clientes.push({ CODIGO: 40, RAZAO_SOCIAL: 'ACME LTDA' }, { CODIGO: 41, RAZAO_SOCIAL: 'BETA LTDA' });
  d.empresas.push({ cliente_codigo: 40, situacao: 'ativa' }, { cliente_codigo: 41, situacao: 'ativa' });
  const u = (id, email, cliente, papel) => ({ id, email, cliente_codigo: cliente, papel, situacao: 'ativo' });
  d.usuarios.push(u(1, 'ana@acme.com', 40, 'admin_geral'), u(2, 'caio@acme.com', 40, 'usuario'),
    u(3, 'dora@acme.com', 40, 'usuario'), u(4, 'bia@beta.com', 41, 'admin_geral'));
  d.permissoes.push({ usuario_id: 3, permissao: 'pedidos.ver' }, { usuario_id: 2, permissao: 'financeiro.ver' });

  const poolPedidos = criarPoolPedidos({ pedidos, clientes: d.clientes, entregas: ENTREGAS });
  const poolUsado = mutar
    ? { execute: (sql, params) => poolPedidos.execute(sql.replace('c.CODIGO = ?', '1 = 1'), params) }
    : poolPedidos;

  const config = { ativo: true, baseUrl: 'https://portal.exemplo.com', chaveCripto: '', termoVersao: 'T1' };
  const app = express();
  app.use(cabecalhosPortal);
  const sessoes = criarSessoesPortal({ pool: banco.pool });
  const { portalAtivo, portalAutenticar } = criarAcessoPortal({ pool: banco.pool, sessoes, config });
  const registro = criarRegistro(app, { autenticado: [], portalPublico: [portalAtivo], portalAutenticado: [portalAtivo, portalAutenticar] });
  registrarPortalPedidos({ portal: registro.portal, pool: poolUsado, ...(limite ? { limite } : {}) });
  registro.verificar();
  const s = await subir(app);
  t.after(s.fechar);
  const cookieDe = async usuarioId => `__Host-portal=${await sessoes.criar(usuarioId, '1.2.3.4')}`;
  const get = (caminho, { cookie, headers = {} } = {}) => fetch(s.url + caminho, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  return { banco, d, registro, pool: poolPedidos, get, cookieDe };
}

const consultasPedidos = pool => pool.chamadas.filter(c => /FROM ped_orc/.test(c.sql));

// A asserção de isolamento do teste 1/5: a lista de ACME é exatamente [120, 14, 13, 12].
async function afirmarListaSoDeAcme(c) {
  const r = await c.get('/portal/api/pedidos', { cookie: await c.cookieDe(1) });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo.pedidos.map(p => p.numero), [120, 14, 13, 12]);
  return corpo;
}

test('lista de ACME: só os 4 pedidos de ACME, sem orçamento nem BETA, 6 chaves e nenhum dado sensível', async t => {
  const c = await montar(t);
  const corpo = await afirmarListaSoDeAcme(c);
  assert.equal(corpo.pedidos.length, 4);
  assert.equal(corpo.pagina, 1);
  assert.equal(corpo.temMais, false);
  for (const p of corpo.pedidos) assert.deepEqual(Object.keys(p).sort(), CHAVES);
  const texto = JSON.stringify(corpo);
  for (const proibido of ['TOTAL', 'OBS_GERAL', 'CLIENTE_FINAL', 'OBS SECRETA', 'CLIENTE FINAL SECRETO', '99999']) {
    assert.ok(!texto.includes(proibido), `vazou ${proibido}`);
  }
  const p14 = corpo.pedidos.find(p => p.numero === 14);
  assert.equal(p14.situacao, 'Pronto');
  assert.equal(p14.entrega, 'Entrega agendada');
  assert.equal(p14.dataAgendada, '2026-11-10');
});

test('limite de uso por usuário: passou do teto vira 429 só para ele, sem tocar o banco do VB; outro usuário segue normal', async t => {
  const c = await montar(t, { limite: { janelaMs: 60000, max: 3 } });
  const ana = await c.cookieDe(1), dora = await c.cookieDe(3);
  for (let i = 0; i < 3; i++) assert.equal((await c.get('/portal/api/pedidos', { cookie: ana })).status, 200, `ana ${i}`);
  const antes = consultasPedidos(c.pool).length;
  const r = await c.get('/portal/api/pedidos', { cookie: ana });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.equal(consultasPedidos(c.pool).length, antes, 'o 429 não pode consultar o banco');
  assert.equal((await c.get('/portal/api/pedidos/12', { cookie: ana })).status, 429, 'o teto vale para a lista e o detalhe juntos');
  assert.equal((await c.get('/portal/api/pedidos', { cookie: dora })).status, 200);
  // sem sessão continua o 401 de sempre: o limite vem depois da autenticação e não revela contagem
  assert.equal((await c.get('/portal/api/pedidos')).status, 401);
});

test('detalhe: 12 devolve só o 12; pedido de BETA, inexistente e 12abc dão 404 idêntico', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const r12 = await c.get('/portal/api/pedidos/12', { cookie });
  assert.equal(r12.status, 200);
  const corpo12 = await r12.json();
  assert.equal(corpo12.pedido.numero, 12);
  assert.deepEqual(Object.keys(corpo12.pedido).sort(), CHAVES);
  assert.ok(!JSON.stringify(corpo12).includes('OBS'));
  const r120 = await (await c.get('/portal/api/pedidos/120', { cookie })).json();
  assert.equal(r120.pedido.numero, 120);

  const lido = async caminho => {
    const r = await c.get(caminho, { cookie });
    const h = Object.fromEntries([...r.headers].filter(([k]) => k !== 'date'));
    return { status: r.status, corpo: await r.json(), h };
  };
  const beta = await lido('/portal/api/pedidos/99');
  const inexistente = await lido('/portal/api/pedidos/777');
  const sujo = await lido('/portal/api/pedidos/12abc');
  const orcamento = await lido('/portal/api/pedidos/15');
  assert.equal(beta.status, 404);
  assert.deepEqual(beta.corpo, { error: 'Pedido não encontrado.' });
  assert.deepEqual(inexistente, beta);
  assert.deepEqual(sujo, beta);
  assert.deepEqual(orcamento, beta);
});

test('pagina: 51 pedidos viram 50 + 1; página inválida dá 400 sem consultar o banco', async t => {
  const muitos = Array.from({ length: 51 }, (_, i) => ped(1000 + i, 'ACME LTDA'));
  const c = await montar(t, { pedidos: muitos });
  const cookie = await c.cookieDe(1);
  const p1 = await (await c.get('/portal/api/pedidos', { cookie })).json();
  assert.equal(p1.pedidos.length, 50);
  assert.equal(p1.temMais, true);
  assert.equal(p1.pagina, 1);
  assert.equal(p1.pedidos[0].numero, 1050);
  const p2 = await (await c.get('/portal/api/pedidos?pagina=2', { cookie })).json();
  assert.equal(p2.pedidos.length, 1);
  assert.equal(p2.temMais, false);
  assert.equal(p2.pagina, 2);
  assert.equal(p2.pedidos[0].numero, 1000);

  const antes = consultasPedidos(c.pool).length;
  assert.ok(antes >= 2);
  for (const q of ['pagina=0', 'pagina=-1', 'pagina=1.5', 'pagina=abc', 'pagina=1&pagina=2', 'pagina=99999999999999999999', 'pagina=1000000000']) {
    const r = await c.get('/portal/api/pedidos?' + q, { cookie });
    assert.equal(r.status, 400, q);
  }
  assert.equal(consultasPedidos(c.pool).length, antes);
});

test('SQL fixo e empresa só da sessão: texto sem colunas sensíveis, 1º parâmetro = 40 mesmo com ?empresa=41', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  await c.get('/portal/api/pedidos?empresa=41&cliente=BETA%20LTDA&codigo=41', { cookie, headers: { 'X-Empresa': '41', 'X-Cliente': 'BETA LTDA' } });
  await c.get('/portal/api/pedidos/12?empresa=41', { cookie, headers: { 'X-Empresa': '41' } });
  const consultas = consultasPedidos(c.pool);
  assert.equal(consultas.length, 2);
  for (const q of consultas) {
    assert.match(q.sql, /c\.CODIGO = \?/);
    assert.match(q.sql, /p\.TIPO = 'Pedido'/);
    assert.doesNotMatch(q.sql, /TOTAL|OBS_GERAL|CLIENTE_FINAL|FINANCEIRO|MOTIVO/i);
    assert.doesNotMatch(q.sql, /\bOR\b/i);
    assert.equal(q.params[0], 40);
  }
  const lista = await (await c.get('/portal/api/pedidos?empresa=41', { cookie, headers: { 'X-Empresa': '41' } })).json();
  assert.deepEqual(lista.pedidos.map(p => p.numero), [120, 14, 13, 12]);
  const semEntrega = lista.pedidos.find(p => p.numero === 13);
  assert.strictEqual(semEntrega.entrega, null);
  assert.strictEqual(semEntrega.dataAgendada, null);
});

test('prova de mutação: sem "c.CODIGO = ?" (trocado por "1 = 1") o teste de isolamento FALHA, logo o pool falso aplica o filtro de verdade', async t => {
  // controle: sem mutação a asserção passa
  const bom = await montar(t);
  await afirmarListaSoDeAcme(bom);
  // mutação: o pool recebe o SQL com o filtro de empresa trocado por "1 = 1" (ver `mutar` em montar)
  const ruim = await montar(t, { mutar: true });
  const r = await ruim.get('/portal/api/pedidos', { cookie: await ruim.cookieDe(1) });
  const numeros = (await r.json()).pedidos.map(p => p.numero);
  assert.ok(numeros.includes(99), 'a mutação deveria vazar o pedido 99 de BETA');
  await assert.rejects(() => afirmarListaSoDeAcme(ruim), assert.AssertionError);
});

test('autenticação: sem cookie 401; JWT de funcionário 401; sem pedidos.ver 403; empresa suspensa 401', async t => {
  const c = await montar(t);
  for (const caminho of ['/portal/api/pedidos', '/portal/api/pedidos/12']) {
    assert.equal((await c.get(caminho)).status, 401);
    const jwtFunc = jwt.sign({ id: 1, nome: 'Func', v: 2, tipo: 'funcionario', sid: 'a'.repeat(32) }, 'teste');
    assert.equal((await c.get(caminho, { cookie: `__Host-portal=${jwtFunc}` })).status, 401);
    assert.equal((await c.get(caminho, { cookie: await c.cookieDe(2) })).status, 403); // Caio: sem pedidos.ver
    assert.equal((await c.get(caminho, { cookie: await c.cookieDe(3) })).status, 200); // Dora: com pedidos.ver
  }
  assert.equal(consultasPedidos(c.pool).length, 2); // Dora (2 chamadas); nenhuma dos recusados
  const cookie = await c.cookieDe(1);
  assert.equal((await c.get('/portal/api/pedidos', { cookie })).status, 200);
  c.d.empresas.find(e => e.cliente_codigo === 40).situacao = 'suspensa';
  assert.equal((await c.get('/portal/api/pedidos', { cookie })).status, 401);
});

test('registro: as duas rotas estão em rotasPortal e verificar() não lança', async t => {
  const c = await montar(t);
  const lista = c.registro.rotasPortal().map(r => `${r.metodo} ${r.caminho}`);
  assert.ok(lista.includes('get /portal/api/pedidos'));
  assert.ok(lista.includes('get /portal/api/pedidos/:numero'));
  assert.doesNotThrow(() => c.registro.verificar());
});
