// Data da entrega opcional na baixa (2026-11-17): "Outra data" da pergunta depois da foto do checklist assinado. Mesmas rotas de baixa de sempre
// (retirada, comprovante, POST /minhas_entregas/:id/baixa); `dataEntrega` AAAA-MM-DD, nunca futura; ausente = hoje (comportamento anterior).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { hojeLocal } = require('../rotas/transacao');
const K = require('../camera_captura.js');
const M = require('../minhas_entregas.js');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PASSADA = '2026-11-10';

function cenario(banco, entrega = {}, pedido = {}) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto', ...pedido });
  return banco.semear.entrega({ numero: 501, status: 'agendada', tipo: 'retirada', ...entrega });
}
const post = (chamar, id, acao, corpo) => chamar(`/entregas/${id}/${acao}`, 'POST', corpo);

test('retirada com dataEntrega: DATA_ENTREGA do pedido usa a data escolhida e o evento/auditoria registram', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const r = await post(chamar, e.id, 'retirada', { entregueA: 'Joao', dataEntrega: PASSADA });
  assert.equal(r.status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Retirado');
  assert.equal(banco.pedidos[0].DATA_ENTREGA, PASSADA);
  assert.equal(JSON.parse(banco.eventos[0].detalhe).dataEntrega, PASSADA);
  assert.equal(JSON.parse(banco.auditoria[0].detalhe).dataEntrega, PASSADA);
});

test('retirada SEM dataEntrega (ou vazia): continua hoje, sem campo extra no evento', async t => {
  for (const extra of [{}, { dataEntrega: '' }, { dataEntrega: null }]) {
    const { banco, chamar } = await prepararEntregas(t);
    const e = cenario(banco);
    assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'Joao', ...extra })).status, 200);
    assert.equal(banco.pedidos[0].DATA_ENTREGA, hojeLocal());
    assert.ok(!('dataEntrega' in (JSON.parse(banco.eventos[0].detalhe || '{}'))));
  }
});

test('dataEntrega de hoje e aceita; futura, inexistente ou de outro tipo e recusada (400) sem gravar nada', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const amanha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  for (const ruim of [amanha, '2026-02-31', '10/11/2026', 20261110, {}]) {
    const r = await post(chamar, e.id, 'retirada', { entregueA: 'Joao', dataEntrega: ruim });
    assert.equal(r.status, 400, String(ruim));
  }
  assert.equal(e.status, 'agendada');
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
  assert.equal(banco.eventos.length, 0);
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'Joao', dataEntrega: hojeLocal() })).status, 200);
});

test('pedido nao Pronto continua recusando a baixa (409) mesmo com data; nada e gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, {}, { SITUACAO: 'Em Produção' });
  const r = await post(chamar, e.id, 'retirada', { entregueA: 'Joao', dataEntrega: PASSADA });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /não está Pronto/);
  assert.equal(e.status, 'agendada');
  assert.equal(banco.pedidos[0].DATA_ENTREGA ?? null, null);
});

test('comprovante com dataEntrega usa a data escolhida', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { status: 'enviada', tipo: 'outro_estado' });
  banco.anexos.push({ id: 1, entrega_id: e.id, evento_id: null, tipo: 'foto', mime: 'image/jpeg', dados: JPEG, criado_por: '7', criado_em: '2026-10-26 09:00:00' });
  const r = await post(chamar, e.id, 'comprovante', { anexoIds: [1], dataEntrega: PASSADA });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(banco.pedidos[0].DATA_ENTREGA, PASSADA);
});

test('baixa do administrativo (POST /minhas_entregas/:id/baixa) com dataEntrega: DATA_ENTREGA e evento; sem data = hoje', async t => {
  const a = await prepararEntregas(t, { perfil: 'Administrativo', usuario: { codigo: 7, nome: 'Caio' } });
  a.banco.semear.cliente();
  a.banco.semear.pedido({ NUMERO: 602, SITUACAO: 'Pronto' });
  a.banco.semear.entrega({ numero: 602, status: 'em_rota', tipo: 'motorista', motorista_codigo: 22, data_agendada: PASSADA });
  const r = await a.chamar('/minhas_entregas/1/baixa', 'POST', { entregueA: 'Maria', dataEntrega: PASSADA });
  assert.equal(r.status, 200);
  assert.equal(a.banco.pedidos[0].DATA_ENTREGA, PASSADA);
  assert.equal(JSON.parse(a.banco.eventos[0].detalhe).dataEntrega, PASSADA);
  assert.equal((await a.chamar('/minhas_entregas/1/baixa', 'POST', { entregueA: 'Maria', dataEntrega: '2099-01-01' })).status, 400);

  const b = await prepararEntregas(t, { perfil: 'Administrativo', usuario: { codigo: 7, nome: 'Caio' } });
  b.banco.semear.cliente();
  b.banco.semear.pedido({ NUMERO: 603, SITUACAO: 'Pronto' });
  b.banco.semear.entrega({ numero: 603, status: 'em_rota', tipo: 'motorista', motorista_codigo: 22, data_agendada: PASSADA });
  assert.equal((await b.chamar('/minhas_entregas/1/baixa', 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(b.banco.pedidos[0].DATA_ENTREGA, hojeLocal());
});

// ---- tela: a pergunta (camera_captura.js, pura) e o corpo enviado ----
test('escolherDataBaixa: Hoje = sem data; Outra data exige valor valido e nao futuro', () => {
  const hoje = '2026-11-17';
  assert.deepEqual(K.escolherDataBaixa('hoje', 'qualquer', hoje), { ok: true, dataEntrega: null });
  assert.deepEqual(K.escolherDataBaixa('outra', '2026-11-10', hoje), { ok: true, dataEntrega: '2026-11-10' });
  assert.deepEqual(K.escolherDataBaixa('outra', '2026-11-17', hoje), { ok: true, dataEntrega: '2026-11-17' });
  assert.equal(K.escolherDataBaixa('outra', '', hoje).ok, false);
  assert.equal(K.escolherDataBaixa('outra', '2026-02-30', hoje).ok, false);
  assert.equal(K.escolherDataBaixa('outra', '2026-11-18', hoje).ok, false);
  assert.match(K.escolherDataBaixa('outra', '2026-11-18', hoje).erro, /futura/);
  assert.equal(K.dataBR('2026-11-10'), '10/11/2026');
});

test('corpoBaixa do motorista: so leva dataEntrega quando ela foi escolhida', () => {
  assert.deepEqual(M.corpoBaixa({ entregueA: ' Ana ' }, [1]), { entregueA: 'Ana', anexoIds: [1] });
  assert.deepEqual(M.corpoBaixa({ entregueA: 'Ana' }, [1], null), { entregueA: 'Ana', anexoIds: [1] });
  assert.deepEqual(M.corpoBaixa({ entregueA: 'Ana' }, [1], '2026-11-10'), { entregueA: 'Ana', anexoIds: [1], dataEntrega: '2026-11-10' });
});
