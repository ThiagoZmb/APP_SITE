// Ajustar o desconto adicional de um Pedido já feito (menu do botão direito): contas puras e POST /ped_orc/Pedido/:numero/desconto.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../calculo/desconto_pedido');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');

test('forma 1 (percentual): total = subtotal × (100 − %) ÷ 100 em 2 casas', () => {
  assert.deepEqual(D.calcular({ subTotal: 1000, descontoPct: 5 }), { ok: true, descontoPct: 5, total: 950, modo: 'percentual' });
  assert.equal(D.calcular({ subTotal: 1000, descontoPct: '7,5' }).total, 925);
  assert.equal(D.calcular({ subTotal: 1217.39, descontoPct: 3 }).total, 1180.87);
  assert.equal(D.calcular({ subTotal: 1000, descontoPct: 0 }).total, 1000);
  assert.equal(D.calcular({ subTotal: 1000, descontoPct: 100 }).total, 0);
  assert.equal(D.calcular({ subTotal: 1000, descontoPct: 5.123456 }).descontoPct, 5.1235, 'até 4 casas');
});

test('percentual inválido: vazio, texto, negativo ou acima de 100', () => {
  for (const descontoPct of ['', 'abc', -1, 100.01, undefined, null]) assert.equal(D.calcular({ subTotal: 1000, descontoPct }).ok, false, String(descontoPct));
});

test('forma 2 (valor final): o % é calculado e o total bate ao centavo', () => {
  assert.deepEqual(D.calcular({ subTotal: 1000, totalFinal: '950,00' }), { ok: true, descontoPct: 5, total: 950, modo: 'valor_final' });
  for (const [sub, alvo] of [[1217.39, 1100], [1217.39, 1180.87], [999.99, 900.01], [602.55, 580], [3333.33, 3000], [1000, 1000], [1000, 0], [77.77, 66.66]]) {
    const r = D.calcular({ subTotal: sub, totalFinal: alvo });
    assert.equal(r.ok, true, `${sub} → ${alvo}`);
    assert.equal(r.total, alvo);
    assert.equal(D.totalComDesconto(sub, r.descontoPct), alvo, `o % ${r.descontoPct} devolve ${alvo}`);
  }
  assert.equal(D.calcular({ subTotal: 1000, totalFinal: 1000 }).descontoPct, 0);
});

test('valor final: acima do subtotal, negativo, inválido ou subtotal zero são recusados', () => {
  assert.match(D.calcular({ subTotal: 1000, totalFinal: 1000.01 }).erro, /não pode passar do subtotal/);
  assert.equal(D.calcular({ subTotal: 1000, totalFinal: -5 }).ok, false);
  assert.equal(D.calcular({ subTotal: 1000, totalFinal: 'abc' }).ok, false);
  assert.match(D.calcular({ subTotal: 0, descontoPct: 5 }).erro, /não tem subtotal/);
});

test('valor final tem prioridade sobre o percentual quando os dois vêm', () => {
  assert.equal(D.calcular({ subTotal: 1000, descontoPct: 50, totalFinal: 900 }).modo, 'valor_final');
});

// ---------- rota ----------
const doc = (banco, extra = {}) => banco.pedOrc.push({ id: 105, TIPO: 'Pedido', NUMERO: 5, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Em Produção', FINANCEIRO: 'A Receber',
  SUB_TOTAL: 1000, DESCONTO: 2, TOTAL: 980, DATA: '2026-10-01 10:00:00', DATA_PRONTO: '2026-11-10', DATA_ENTREGA: null, ...extra });
const URL = (n = 5, tipo = 'Pedido') => `/ped_orc/${tipo}/${n}/desconto`;
const conf = { descontoPct: 2, total: 980 };

test('rota: percentual grava só DESCONTO e TOTAL, e audita antes e depois', async t => {
  const banco = bancoPedOrc(); doc(banco);
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar(URL(), 'POST', { descontoPct: 5, conferencia: conf });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(await r.json(), { ok: true, subTotal: 1000, descontoPct: 5, total: 950, totalAnterior: 980, tipo: 'Pedido', numero: 5 });
  const p = banco.pedOrc[0];
  assert.deepEqual([p.DESCONTO, p.TOTAL, p.SUB_TOTAL, p.SITUACAO, p.FINANCEIRO, p.DATA_PRONTO], [5, 950, 1000, 'Em Produção', 'A Receber', '2026-11-10']);
  assert.equal(banco.auditoria.length, 1);
  assert.equal(banco.auditoria[0].acao, 'desconto_adicional_alterado');
  assert.deepEqual(JSON.parse(banco.auditoria[0].detalhe), { cliente: 'CLIENTE TESTE', modo: 'percentual', subTotal: 1000,
    de: { descontoPct: 2, total: 980 }, para: { descontoPct: 5, total: 950 } });
});

test('rota: valor final grava o total exato digitado e o % calculado', async t => {
  const banco = bancoPedOrc(); doc(banco, { SUB_TOTAL: 1217.39, DESCONTO: 0, TOTAL: 1217.39 });
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar(URL(), 'POST', { totalFinal: '1.100,00', conferencia: { descontoPct: 0, total: 1217.39 } });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(banco.pedOrc[0].TOTAL, 1100);
  assert.equal(D.totalComDesconto(1217.39, banco.pedOrc[0].DESCONTO), 1100);
  assert.equal(JSON.parse(banco.auditoria[0].detalhe).modo, 'valor_final');
});

test('rota: pedido Recebido ou Cancelado é recusado (409) e nada é gravado', async t => {
  for (const extra of [{ FINANCEIRO: 'Recebido' }, { FINANCEIRO: ' recebido ' }, { SITUACAO: 'Cancelado' }]) {
    const banco = bancoPedOrc(); doc(banco, extra);
    const { chamar } = await prepararPedOrc(t, { banco });
    const r = await chamar(URL(), 'POST', { descontoPct: 5, conferencia: conf });
    assert.equal(r.status, 409, JSON.stringify(extra));
    assert.equal(banco.pedOrc[0].TOTAL, 980);
    assert.equal(banco.auditoria.length, 0);
  }
});

test('rota: Atrasado passa; pedido alterado desde a abertura = 409; mesmo desconto = 409', async t => {
  let banco = bancoPedOrc(); doc(banco, { FINANCEIRO: 'Atrasado' });
  let c = await prepararPedOrc(t, { banco });
  assert.equal((await c.chamar(URL(), 'POST', { descontoPct: 5, conferencia: conf })).status, 200);
  banco = bancoPedOrc(); doc(banco, { DESCONTO: 3, TOTAL: 970 });
  c = await prepararPedOrc(t, { banco });
  const r = await c.chamar(URL(), 'POST', { descontoPct: 5, conferencia: conf });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).erro, 'alterado');
  assert.equal(banco.pedOrc[0].TOTAL, 970);
  banco = bancoPedOrc(); doc(banco);
  c = await prepararPedOrc(t, { banco });
  assert.equal((await c.chamar(URL(), 'POST', { descontoPct: 2, conferencia: conf })).status, 409);
});

test('rota: entradas inválidas = 400 (sem conferência, orçamento, % fora da faixa, total acima do subtotal)', async t => {
  const banco = bancoPedOrc(); doc(banco);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar(URL(), 'POST', { descontoPct: 5 })).status, 400);
  assert.equal((await chamar(URL(5, 'Orçamento'), 'POST', { descontoPct: 5, conferencia: conf })).status, 400);
  assert.equal((await chamar(URL(), 'POST', { descontoPct: 101, conferencia: conf })).status, 400);
  assert.equal((await chamar(URL(), 'POST', { descontoPct: 'x', conferencia: conf })).status, 400);
  assert.equal((await chamar(URL(), 'POST', { totalFinal: 1001, conferencia: conf })).status, 400);
  assert.equal((await chamar(URL(), 'POST', { conferencia: conf })).status, 400);
  assert.equal((await chamar(URL(99), 'POST', { descontoPct: 5, conferencia: conf })).status, 404);
  assert.equal(banco.pedOrc[0].TOTAL, 980);
  assert.equal(banco.auditoria.length, 0);
});

test('rota: exige orcamentos.criar + valores.ver (Estoquista e "sem valores" = 403)', async t => {
  for (const perfil of ['Estoquista', 'Monta sem valores']) {
    const banco = bancoPedOrc(); doc(banco);
    const { chamar } = await prepararPedOrc(t, { banco, perfil });
    assert.equal((await chamar(URL(), 'POST', { descontoPct: 5, conferencia: conf })).status, 403, perfil);
    assert.equal(banco.pedOrc[0].TOTAL, 980);
  }
  const banco = bancoPedOrc(); doc(banco);
  const { chamar } = await prepararPedOrc(t, { banco, perfil: 'Monta sem salvar' });
  assert.equal((await chamar(URL(), 'POST', { descontoPct: 5, conferencia: conf })).status, 200);
});

test('rota GET: devolve subtotal, desconto, total e situações atuais; orçamento = 400; inexistente = 404; sem permissão = 403', async t => {
  const banco = bancoPedOrc(); doc(banco);
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar(URL());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { numero: 5, cliente: 'CLIENTE TESTE', subTotal: 1000, descontoPct: 2, total: 980, financeiro: 'A Receber', situacao: 'Em Produção' });
  assert.equal((await chamar(URL(5, 'Orçamento'))).status, 400);
  assert.equal((await chamar(URL(99))).status, 404);
  const sem = await prepararPedOrc(t, { banco, perfil: 'Estoquista' });
  assert.equal((await sem.chamar(URL())).status, 403);
  assert.equal(banco.pedOrc[0].TOTAL, 980, 'a leitura não grava nada');
  assert.equal(banco.auditoria.length, 0);
});
