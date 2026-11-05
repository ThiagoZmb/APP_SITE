// Etapas de produção x corte: a confirmação do corte real marca "Perfil cortado" / "Vidro cortado" (origem corte) quando TODAS as peças
// do pedido foram cortadas; cancelar/excluir dados do corte e cancelar/excluir o pedido desmarcam só o que veio do corte.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoCorte, prepararCorte, corpoConfirmacao } = require('./apoio/bancoCorte');
const V = require('./apoio/bancoVidros');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const { regrasEtapas } = require('./apoio/bancoEtapas');
const etapasBanco = require('../rotas/etapas_banco');
const { criarPoolFalso } = require('./apoio/poolFalso');

const comEtapas = banco => { const est = { etapas: [], eventos: [] }; (banco.regras || banco.f.regras).unshift(...regrasEtapas(est)); return est; };
const etapa = (est, codigo, numero = 100) => est.etapas.find(e => e.numero === numero && e.etapa === codigo);

// ---------- perfis ----------
async function planoPerfil(chamar) {
  const p = await (await chamar('/corte/pedido/100')).json();
  const { id } = await (await chamar('/corte/pedido/100/salvar', 'POST', { impressao: p.impressao, retalhosUsados: p.retalhosUsados })).json();
  const plano = await (await chamar(`/corte/plano/${id}`)).json();
  const marcas = plano.plano.grupos.flatMap(g => g.barras.flatMap((b, bi) => b.pecas.map((_, pi) => ({ grupo: g.chave, barra: bi, peca: pi, cortada: true }))));
  return { id, marcas };
}
const marcar = (chamar, id, marcas) => chamar(`/corte/plano/${id}/pecas`, 'PUT', { marcas });
const confirmarPerfil = async (chamar, id) => chamar(`/corte/plano/${id}/confirmar`, 'POST', await corpoConfirmacao(chamar, id));

test('corte de perfil conferido com todas as peças marcadas: "Perfil cortado" OK automático (origem corte, quem confirmou), evento registrado', async t => {
  const b = bancoCorte(); b.semear.pedido(); b.semear.perfil(); b.semear.item();
  const est = comEtapas(b);
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id, marcas } = await planoPerfil(chamar);
  assert.equal((await marcar(chamar, id, marcas)).status, 200);
  const r = await confirmarPerfil(chamar, id);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).situacao, 'conferido', 'resposta do corte não mudou');
  const l = etapa(est, 'perfil_cortado');
  assert.deepEqual([l.estado, l.origem, l.usuario], ['ok', 'corte', 'Caio']);
  assert.equal(etapa(est, 'vidro_cortado'), undefined);
  assert.equal(est.eventos.length, 1);
  assert.equal(JSON.parse(est.eventos[0].detalhe).planoId, id);
});

test('corte de perfil conferido com peça sem marcar: etapa não é marcada', async t => {
  const b = bancoCorte(); b.semear.pedido(); b.semear.perfil(); b.semear.item();
  const est = comEtapas(b);
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id, marcas } = await planoPerfil(chamar);
  await marcar(chamar, id, marcas.slice(1));
  assert.equal((await confirmarPerfil(chamar, id)).status, 200);
  assert.equal(etapa(est, 'perfil_cortado'), undefined);
});

test('pedido com pendência de medida (peça nunca estimada): o corte conferido não marca a etapa', async t => {
  const b = bancoCorte(); b.semear.pedido(); b.semear.perfil(); b.semear.item();
  b.semear.perfil({ ITEM: 2, QTD_PORTAS: 1, PERFIL: 'P200', QTD_ALTURA: 1, TAM_ALTURA: 0, QTD_LARGURA: 1, TAM_LARGURA: 800 });   // sem altura
  b.semear.item({ ITEM_PEDIDO: 2, ITEM: 1, QTD: 1, PERFIL: 'P200', ALTURA: 1000, LARGURA: 800 });
  const est = comEtapas(b);
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id, marcas } = await planoPerfil(chamar);
  await marcar(chamar, id, marcas);
  assert.equal((await confirmarPerfil(chamar, id)).status, 200);
  assert.equal(etapa(est, 'perfil_cortado'), undefined);
});

test('excluir os dados do corte desmarca o OK automático; OK manual nunca é desmarcado nem sobrescrito', async t => {
  const b = bancoCorte(); b.semear.pedido(); b.semear.perfil(); b.semear.item();
  const est = comEtapas(b);
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id, marcas } = await planoPerfil(chamar);
  await marcar(chamar, id, marcas);
  await confirmarPerfil(chamar, id);
  assert.equal(etapa(est, 'perfil_cortado').estado, 'ok');
  assert.equal((await chamar('/corte/pedido/100', 'DELETE', { incluirConferidos: true })).status, 200);
  assert.deepEqual([etapa(est, 'perfil_cortado').estado, etapa(est, 'perfil_cortado').origem], ['pendente', 'corte']);
  // OK manual: excluir/conferir de novo não mexe
  Object.assign(etapa(est, 'perfil_cortado'), { estado: 'ok', origem: 'manual', usuario: 'Ana' });
  const outro = await planoPerfil(chamar);
  await marcar(chamar, outro.id, outro.marcas);
  await confirmarPerfil(chamar, outro.id);
  assert.equal(etapa(est, 'perfil_cortado').usuario, 'Ana');
  await chamar('/corte/pedido/100', 'DELETE', { incluirConferidos: true });
  assert.deepEqual([etapa(est, 'perfil_cortado').estado, etapa(est, 'perfil_cortado').origem], ['ok', 'manual']);
});

test('falha ao gravar a etapa não desfaz o corte confirmado (transação própria, depois do commit)', async t => {
  const b = bancoCorte(); b.semear.pedido(); b.semear.perfil(); b.semear.item();
  comEtapas(b);
  b.regras.unshift([/^INSERT INTO web_producao_etapas \(/, () => { throw new Error('tabela fora do ar'); }]);
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id, marcas } = await planoPerfil(chamar);
  await marcar(chamar, id, marcas);
  const r = await confirmarPerfil(chamar, id);
  assert.equal(r.status, 200);
  assert.equal(b.estado.planos.find(p => p.id === id).situacao, 'conferido');
});

test('pedido cancelado ou entregue: o corte conferido não marca etapa', async t => {
  const b = bancoCorte(); b.semear.pedido(); b.semear.perfil(); b.semear.item();
  const est = comEtapas(b);
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id, marcas } = await planoPerfil(chamar);
  await marcar(chamar, id, marcas);
  b.estado.pedidos[0].SITUACAO = 'Entregue';
  assert.equal((await confirmarPerfil(chamar, id)).status, 200);
  assert.equal(etapa(est, 'perfil_cortado'), undefined);
});

// ---------- vidros ----------
test('corte de vidros conferido com todas as peças marcadas: "Vidro cortado" OK automático; com peça sem marcar, não', async t => {
  for (const todas of [true, false]) {
    const b = V.bancoVidros();
    b.semear.pedido(); b.semear.item({ ITEM_PEDIDO: 1, REVESTIMENTO: 'Incolor 4mm' }); b.semear.vidro({ ITEM: 1, QTD: 2, MODELO: 'Incolor 4mm', TAMANHO: '1000 x 500' });
    const est = comEtapas(b);
    const { chamar } = await V.prepararVidros(t, { banco: b });
    const previa = await (await chamar('/corte_vidros/pedido/100')).json();
    const salvo = await (await chamar('/corte_vidros/pedido/100/salvar', 'POST', { impressao: previa.impressao, retalhosUsados: previa.retalhosUsados, escolhas: {} })).json();
    assert.ok(salvo.id, JSON.stringify(salvo));
    const plano = await (await chamar(`/corte_vidros/plano/${salvo.id}`)).json();
    const marcas = plano.plano.grupos.flatMap(g => g.chapas.flatMap((c, ci) => c.pecas.map((_, pi) => ({ grupo: g.chave, chapa: ci, peca: pi, cortada: true }))));
    assert.equal(marcas.length, 2);
    assert.equal((await chamar(`/corte_vidros/plano/${salvo.id}/pecas`, 'PUT', { marcas: todas ? marcas : marcas.slice(1) })).status, 200);
    const baixas = plano.plano.grupos.filter(g => g.chapas.some(c => c.tipo === 'chapa')).map(g => ({ chave: g.chave, produtoCodigo: g.produtoCodigo }));
    const r = await chamar(`/corte_vidros/plano/${salvo.id}/confirmar`, 'POST', await V.corpoConfirmacao(chamar, salvo.id, { baixas }));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    if (todas) assert.deepEqual([etapa(est, 'vidro_cortado').estado, etapa(est, 'vidro_cortado').origem], ['ok', 'corte']);
    else assert.equal(etapa(est, 'vidro_cortado'), undefined);
    assert.equal(etapa(est, 'perfil_cortado'), undefined);
  }
});

// ---------- cancelar / excluir o pedido ----------
const comDocumento = (banco, numero, extra = {}) => {
  banco.pedOrc.push({ id: numero, TIPO: 'Pedido', NUMERO: numero, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Em Produção', TOTAL: 100, ...extra });
  banco.listaItens.push({ id: 1, TIPO: 'Pedido', NUMERO: numero, ITEM: 1 });
};

test('cancelar o pedido: OK do corte volta a pendente (evento do sistema); OK manual fica', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 5);
  const est = comEtapas(banco);
  est.etapas.push({ id: 1, numero: 5, etapa: 'perfil_cortado', estado: 'ok', origem: 'corte', usuario: 'Caio', quando: '2026-11-01 08:00:00', observacao: null },
    { id: 2, numero: 5, etapa: 'perfil_pintado', estado: 'ok', origem: 'manual', usuario: 'Ana', quando: '2026-11-01 08:00:00', observacao: null });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5/cancelar', 'POST')).status, 200);
  assert.deepEqual(est.etapas.map(e => [e.etapa, e.estado, e.origem]), [['perfil_cortado', 'pendente', 'corte'], ['perfil_pintado', 'ok', 'manual']]);
  assert.deepEqual(est.eventos.map(e => [e.etapa, e.estado_antes, e.estado_depois, e.origem, JSON.parse(e.detalhe).motivo]), [['perfil_cortado', 'ok', 'pendente', 'sistema', 'Pedido cancelado']]);
});

test('excluir o pedido apaga as etapas e o histórico do número (reaproveitado) e audita', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 5); comDocumento(banco, 6);
  const est = comEtapas(banco);
  est.etapas.push({ id: 1, numero: 5, etapa: 'perfil_cortado', estado: 'ok', origem: 'manual' }, { id: 2, numero: 6, etapa: 'perfil_cortado', estado: 'ok', origem: 'manual' });
  est.eventos.push({ id: 1, numero: 5, etapa: 'perfil_cortado' }, { id: 2, numero: 6, etapa: 'perfil_cortado' });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5', 'DELETE')).status, 200);
  assert.deepEqual(est.etapas.map(e => e.numero), [6]);
  assert.deepEqual(est.eventos.map(e => e.numero), [6]);
  assert.ok(banco.auditoria.some(a => a.acao === 'etapas_removidas_com_pedido'));
});

test('reavaliarEtapaCorte nunca lança: erro de banco vira { erro: true } e vai para o log', async t => {
  t.mock.method(console, 'error', () => {});
  const pool = criarPoolFalso([[/FROM ped_orc/, () => { throw new Error('caiu'); }]]);
  const r = await etapasBanco.reavaliarEtapaCorte(pool, { numero: 1, grupo: 'perfil', quem: 'x', estadoCorte: async () => ({}) });
  assert.deepEqual(r, { mudou: false, erro: true });
  assert.ok(pool.chamadas.some(c => c.sql === 'ROLLBACK'));
  assert.equal(console.error.mock.calls.length, 1);
});
