// Plano de corte de vidros: salvar, ler, marcar peças e cancelar (banco simulado em test/apoio/bancoVidros.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoVidros, prepararVidros } = require('./apoio/bancoVidros');
const { REGEX_VALOR } = require('../seguranca/valores');

const ESC = { 'Extra Clear 4mm|': 11 };
const prever = async (chamar, escolhas = ESC) => (await chamar('/corte_vidros/pedido/100?escolhas=' + encodeURIComponent(JSON.stringify(escolhas)))).json();
const salvar = (chamar, previa, extra = {}) => chamar('/corte_vidros/pedido/100/salvar', 'POST',
  { impressao: previa.impressao, retalhosUsados: previa.retalhosUsados, escolhas: ESC, ...extra });
const nomesDeCampo = dados => {
  const nomes = new Set();
  const varrer = d => { if (Array.isArray(d)) d.forEach(varrer); else if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) { nomes.add(k); varrer(v); } };
  varrer(dados);
  return [...nomes];
};

// pedido 100: item 1 = 2 peças Incolor 4mm (2000x800); item 2 = 1 peça Extra Clear 4mm (1000x500)
function cenario(b = bancoVidros()) {
  b.semear.pedido();
  b.semear.item({ ITEM_PEDIDO: 1, REVESTIMENTO: 'Incolor 4mm' });
  b.semear.item({ ITEM_PEDIDO: 2, REVESTIMENTO: 'Extra Clear 4mm' });
  b.semear.vidro({ ITEM: 1, QTD: 2, MODELO: 'Incolor 4mm', TAMANHO: '2000 x 800' });
  b.semear.vidro({ ITEM: 2, QTD: 1, MODELO: 'Extra Clear 4mm', TAMANHO: '1000 x 500' });
  return b;
}
const retalhoExtra = b => b.semear.retalho({ produto_codigo: 11, produto_nome: 'Vidro Extra Clear 4mm - 2400mm', altura: 1500, largura: 1000 });

test('salvar: grava o plano, reserva o retalho, guarda parâmetros e audita', async t => {
  const b = cenario(); const ret = retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar);
  assert.deepEqual(previa.retalhosUsados, [ret.id]);
  const r = await salvar(chamar, previa);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j, { ok: true, id: 1, pedido: 100 });
  const p = b.estado.planos[0];
  assert.equal(p.situacao, 'gerado'); assert.equal(p.pedido, 100); assert.equal(p.impressao_pecas, previa.impressao); assert.equal(p.criado_por, 'Caio');
  assert.deepEqual(JSON.parse(p.parametros), { serra: 0, sobraMinima: 300 });
  assert.equal(p.progresso, '[]');
  const res = JSON.parse(p.resultado);
  assert.equal(res.qtdPecas, 3); assert.deepEqual(res.pendencias, []); assert.deepEqual(res.escolhas, ESC);
  assert.equal(res.plano.resumo.qtdRetalhosUsados, 1);
  assert.equal(b.estado.retalhos[0].situacao, 'reservado'); assert.equal(b.estado.retalhos[0].plano_reserva, 1);
  const a = b.estado.auditoria.find(x => x.acao === 'corte_vidros_plano_salvo');
  assert.ok(a); assert.equal(a.alvo, '1'); assert.equal(a.detalhe.pedido, 100); assert.equal(a.detalhe.qtdPecas, 3); assert.equal(a.detalhe.substituiu, null);
});

test('salvar usa os parâmetros efetivos (config gravada) em parametros', async t => {
  const b = cenario(); b.estado.config.push({ id: 1, serra: 3, sobra_minima: 250 });
  const { chamar } = await prepararVidros(t, { banco: b });
  assert.equal((await salvar(chamar, await prever(chamar))).status, 200);
  assert.deepEqual(JSON.parse(b.estado.planos[0].parametros), { serra: 3, sobraMinima: 250 });
});

test('salvar: impressão velha → 409 sem gravar nada', async t => {
  const b = cenario(); retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar);
  assert.equal((await salvar(chamar, previa, { impressao: 'velha' })).status, 409);
  assert.deepEqual(b.estado.planos, []);
  assert.equal(b.estado.retalhos[0].situacao, 'disponivel');
});

test('salvar: vidros do pedido alterados entre a pré-visualização e o salvar → 409', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar);
  b.estado.vidros[0].TAMANHO = '1900 x 800';
  const r = await salvar(chamar, previa);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /mudou/);
  assert.deepEqual(b.estado.planos, []);
});

test('salvar: retalho reservado por outro plano entre a pré-visualização e o salvar → 409 sem gravar nada', async t => {
  const b = cenario(); const ret = retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar);
  assert.deepEqual(previa.retalhosUsados, [ret.id]);
  ret.situacao = 'reservado'; ret.plano_reserva = 99;
  const r = await salvar(chamar, previa);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /retalhos/i);
  assert.deepEqual(b.estado.planos, []);
  assert.equal(ret.plano_reserva, 99);
  assert.equal(b.estado.auditoria.some(a => a.acao === 'corte_vidros_plano_salvo'), false);
});

test('salvar: reserva que falha no meio (retalho some entre a leitura e a reserva) → 409 e nada fica gravado', async t => {
  const b = cenario(); const ret = retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar);
  // simula a corrida: o retalho é pego por outro plano exatamente entre o INSERT do plano e a reserva
  const regraReserva = b.regras.find(([re]) => re.test("UPDATE web_vidro_retalhos SET situacao = 'reservado'"));
  const original = regraReserva[1];
  regraReserva[1] = (sql, params) => { ret.situacao = 'reservado'; ret.plano_reserva = 99; return original(sql, params); };
  t.after(() => { regraReserva[1] = original; });
  const r = await salvar(chamar, previa);
  assert.equal(r.status, 409);
  assert.deepEqual(b.estado.planos, []);
  assert.notEqual(ret.plano_reserva, 1);   // o rollback desfez também a reserva parcial
  assert.equal(b.estado.auditoria.some(a => a.acao === 'corte_vidros_plano_salvo'), false);
});

test('salvar: produto escolhido desativado entre a pré-visualização e o salvar → 409', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar);
  b.estado.estoque.find(e => e.CODIGO === 11).SITUACAO = 'Inativo';
  const r = await salvar(chamar, previa);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /produto/i);
  assert.deepEqual(b.estado.planos, []);
});

test('salvar: grupo sem produto escolhido → 409 pedindo para escolher o produto', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar, {});
  const r = await chamar('/corte_vidros/pedido/100/salvar', 'POST', { impressao: previa.impressao, retalhosUsados: previa.retalhosUsados, escolhas: {} });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /escolh/i);
  assert.deepEqual(b.estado.planos, []);
});

test('salvar: pedido cancelado, inexistente, sem peças e já conferido', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar);
  b.estado.pedidos[0].SITUACAO = 'Cancelado';
  assert.equal((await salvar(chamar, previa)).status, 409);
  b.estado.pedidos[0].SITUACAO = 'Em Produção';
  assert.equal((await chamar('/corte_vidros/pedido/999/salvar', 'POST', { impressao: 'x', retalhosUsados: [], escolhas: {} })).status, 404);
  assert.equal((await chamar('/corte_vidros/pedido/abc/salvar', 'POST', {})).status, 404);
  b.estado.planos.push({ id: 50, pedido: 100, situacao: 'conferido', impressao_pecas: 'x', criado_por: 'a', criado_em: '2026-10-01 10:00:00', conferido_em: '2026-10-02 10:00:00' });
  const r = await salvar(chamar, previa);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /conferido/);
  b.estado.planos.length = 0;
  b.estado.vidros.length = 0;
  const sem = await salvar(chamar, previa);
  assert.equal(sem.status, 409);
  assert.match((await sem.json()).error, /peças/);
  assert.deepEqual(b.estado.planos, []);
});

test('salvar: escolhas inválidas no corpo → 400', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar);
  for (const ruim of [[1, 2], 'x', { 'Incolor 4mm|': 'abc' }, { 'Incolor 4mm|': 0 }]) {
    assert.equal((await salvar(chamar, previa, { escolhas: ruim })).status, 400, JSON.stringify(ruim));
  }
  assert.deepEqual(b.estado.planos, []);
});

test('salvar de novo substitui o plano gerado anterior e libera as reservas dele', async t => {
  const b = cenario(); const ret = retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  assert.equal((await salvar(chamar, await prever(chamar))).status, 200);
  const previa2 = await prever(chamar);   // o retalho reservado pelo plano 1 conta como disponível para o plano que o substitui
  assert.deepEqual(previa2.retalhosUsados, [ret.id]);
  const r = await salvar(chamar, previa2);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).id, 2);
  assert.deepEqual(b.estado.planos.map(p => [p.id, p.situacao]), [[1, 'cancelado'], [2, 'gerado']]);
  assert.equal(ret.situacao, 'reservado'); assert.equal(ret.plano_reserva, 2);
  assert.equal(b.estado.auditoria.filter(a => a.acao === 'corte_vidros_plano_salvo').at(-1).detalhe.substituiu, 1);
});

test('GET plano: devolve o salvo (com escolhas, sem nomes de dinheiro) e calcula desatualizado pela impressão', async t => {
  const b = cenario(); retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  await salvar(chamar, await prever(chamar));
  const j = await (await chamar('/corte_vidros/plano/1')).json();
  assert.equal(j.id, 1); assert.equal(j.pedido, 100); assert.equal(j.situacao, 'gerado'); assert.equal(j.criadoPor, 'Caio');
  assert.equal(j.conferidoPor, ''); assert.equal(j.conferidoEm, null);
  assert.equal(j.qtdPecas, 3); assert.deepEqual(j.pendencias, []); assert.deepEqual(j.escolhas, ESC); assert.deepEqual(j.cortadas, []);
  assert.equal(j.plano.grupos.length, 2);
  assert.deepEqual(nomesDeCampo(j).filter(n => REGEX_VALOR.test(n)), []);
  b.estado.vidros[0].TAMANHO = '1900 x 800';
  assert.equal((await (await chamar('/corte_vidros/plano/1')).json()).situacao, 'desatualizado');
  assert.equal((await chamar('/corte_vidros/plano/99')).status, 404);
  assert.equal((await chamar('/corte_vidros/plano/abc')).status, 404);
});

test('GET plano: exige corte.ver', async t => {
  const { chamar } = await prepararVidros(t, { perfil: 'Sem acesso' });
  assert.equal((await chamar('/corte_vidros/plano/1')).status, 403);
});

test('marcar peças: lote, uma marca só, desmarcar; progresso guarda grupo/chapa/peca', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  await salvar(chamar, await prever(chamar));
  const plano = (await (await chamar('/corte_vidros/plano/1')).json()).plano;
  const g = plano.grupos.find(x => x.chave === 'Incolor 4mm|');
  assert.ok(g.chapas[0].pecas.length >= 1);
  let r = await chamar('/corte_vidros/plano/1/pecas', 'PUT', { marcas: [{ grupo: g.chave, chapa: 0, peca: 0, cortada: true }, { grupo: 'Extra Clear 4mm|', chapa: 0, peca: 0, cortada: true }] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, qtdCortadas: 2 });
  assert.deepEqual(JSON.parse(b.estado.planos[0].progresso), [{ grupo: g.chave, chapa: 0, peca: 0 }, { grupo: 'Extra Clear 4mm|', chapa: 0, peca: 0 }]);
  r = await chamar('/corte_vidros/plano/1/pecas', 'PUT', { grupo: g.chave, chapa: 0, peca: 0, cortada: false });
  assert.deepEqual(await r.json(), { ok: true, qtdCortadas: 1 });
  r = await chamar('/corte_vidros/plano/1/pecas', 'PUT', { grupo: g.chave, chapa: 0, peca: 0, cortada: true });
  r = await chamar('/corte_vidros/plano/1/pecas', 'PUT', { marcas: [{ grupo: g.chave, chapa: 0, peca: 0, cortada: true }] });   // repetir não duplica
  assert.equal((await r.json()).qtdCortadas, 2);
  assert.deepEqual((await (await chamar('/corte_vidros/plano/1')).json()).cortadas.length, 2);
});

test('marcar peças: marca inválida 400 (nada gravado), lista vazia/grande 400, plano não gerado 409, inexistente 404, sem planejar 403', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  await salvar(chamar, await prever(chamar));
  const marca = { grupo: 'Incolor 4mm|', chapa: 0, peca: 0, cortada: true };
  for (const ruim of [{ ...marca, grupo: 'nao existe' }, { ...marca, chapa: 9 }, { ...marca, chapa: 0.5 }, { ...marca, peca: 99 }, { ...marca, peca: -1 }, { ...marca, cortada: 'sim' }]) {
    assert.equal((await chamar('/corte_vidros/plano/1/pecas', 'PUT', { marcas: [marca, ruim] })).status, 400, JSON.stringify(ruim));
  }
  assert.equal(b.estado.planos[0].progresso, '[]');
  assert.equal((await chamar('/corte_vidros/plano/1/pecas', 'PUT', { marcas: [] })).status, 400);
  assert.equal((await chamar('/corte_vidros/plano/1/pecas', 'PUT', { marcas: Array(501).fill(marca) })).status, 400);
  assert.equal((await chamar('/corte_vidros/plano/99/pecas', 'PUT', marca)).status, 404);
  b.estado.planos[0].situacao = 'conferido';
  assert.equal((await chamar('/corte_vidros/plano/1/pecas', 'PUT', marca)).status, 409);
  const so = await prepararVidros(t, { banco: b, perfil: 'Só ver corte' });   // troca o perfil de todas as chamadas seguintes
  assert.equal((await so.chamar('/corte_vidros/plano/1/pecas', 'PUT', marca)).status, 403);
});

test('cancelar plano: solta as reservas, situacao cancelado, auditoria; de novo dá 409; inexistente 404; sem planejar 403', async t => {
  const b = cenario(); const ret = retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  await salvar(chamar, await prever(chamar));
  assert.equal(ret.situacao, 'reservado');
  const r = await chamar('/corte_vidros/plano/1/cancelar', 'POST');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: 1, situacao: 'cancelado' });
  assert.equal(b.estado.planos[0].situacao, 'cancelado');
  assert.equal(ret.situacao, 'disponivel'); assert.equal(ret.plano_reserva, null);
  const a = b.estado.auditoria.find(x => x.acao === 'corte_vidros_plano_cancelado');
  assert.ok(a); assert.equal(a.detalhe.pedido, 100);
  assert.equal((await chamar('/corte_vidros/plano/1/cancelar', 'POST')).status, 409);
  assert.equal((await chamar('/corte_vidros/plano/99/cancelar', 'POST')).status, 404);
  const so = await prepararVidros(t, { banco: b, perfil: 'Só ver corte' });   // troca o perfil de todas as chamadas seguintes
  assert.equal((await so.chamar('/corte_vidros/plano/1/cancelar', 'POST')).status, 403);
});

test('liberarPlanosVidroDoPedido: cancela os gerados, solta reservas, audita; excluindo marca excluido_em nos conferidos', async t => {
  const { liberarPlanosVidroDoPedido } = require('../rotas/corte_vidros');
  const b = bancoVidros(); const ret = b.semear.retalho({ situacao: 'reservado', plano_reserva: 1 });
  b.estado.planos.push({ id: 1, pedido: 100, situacao: 'gerado' }, { id: 2, pedido: 100, situacao: 'conferido' }, { id: 3, pedido: 101, situacao: 'gerado' });
  await prepararVidros(t, { banco: b });
  const conn = await b.f.getConnection();
  assert.equal(await liberarPlanosVidroDoPedido(conn, 100, 'Caio'), 1);
  assert.deepEqual(b.estado.planos.map(p => p.situacao), ['cancelado', 'conferido', 'gerado']);
  assert.equal(b.estado.planos[1].excluido_em, undefined);
  assert.equal(ret.situacao, 'disponivel');
  assert.equal(b.estado.auditoria[0].acao, 'corte_vidros_plano_cancelado_com_pedido');
  assert.equal(b.estado.auditoria[0].quem, 'Caio');
  await liberarPlanosVidroDoPedido(conn, 100, 'Caio', { excluindo: true });
  assert.ok(b.estado.planos[1].excluido_em);
  assert.equal(b.estado.planos[2].excluido_em, undefined);
});
