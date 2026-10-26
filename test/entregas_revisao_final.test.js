// Correções da revisão final do módulo Entregas (F1-F7). Um bloco por finding.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { hojeLocal } = require('../rotas/transacao');

const post = (chamar, id, acao, corpo) => chamar(`/entregas/${id}/${acao}`, 'POST', corpo);
function cenario(banco, { pedido = {}, entrega = {} } = {}) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto', ...pedido });
  return banco.semear.entrega({ numero: 501, status: 'agendada', tipo: 'retirada', ...entrega });
}

// ---- F1: como o VB (Pedido_Entregue/Pedido_Retirado), a baixa grava SITUACAO e DATA_ENTREGA ----
test('F1: baixa por retirada grava SITUACAO e DATA_ENTREGA = hoje (Brasília) no mesmo UPDATE', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { pedido: { DATA_ENTREGA: '2026-01-05' } });
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Retirado');
  assert.equal(banco.pedidos[0].DATA_ENTREGA, hojeLocal());
  const ups = banco.f.chamadas.filter(c => /^UPDATE ped_orc/.test(c.sql));
  assert.equal(ups.length, 1);
  assert.match(ups[0].sql, /SET SITUACAO = \?, DATA_ENTREGA = \?/);
});

// ---- F2: baixa não sobrescreve pedido Cancelado ----
test('F2: pedido Cancelado -> 409, nada gravado (evento, status, auditoria)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { pedido: { SITUACAO: 'Cancelado' } });
  const r = await post(chamar, e.id, 'retirada', { entregueA: 'Maria' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /cancelado ou excluído/);
  assert.equal(e.status, 'agendada');
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.auditoria.length, 0);
  assert.equal(banco.pedidos[0].SITUACAO, 'Cancelado');
});

test('F2: pedido inexistente -> 409 e nada gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = banco.semear.entrega({ numero: 999, status: 'agendada', tipo: 'retirada' });
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'Maria' })).status, 409);
  assert.equal(e.status, 'agendada');
  assert.equal(banco.eventos.length, 0);
});

test('F2: pedido que o VB já marcou com a situação de destino segue como sucesso', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { pedido: { SITUACAO: 'Retirado' } });
  // o MySQL pode reportar 0 linhas alteradas: o SELECT de desempate decide
  banco.regras.unshift([/^UPDATE ped_orc SET SITUACAO/, () => ({ affectedRows: 0 })]);
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'Maria' })).status, 200);
  assert.equal(e.status, 'retirado');
  assert.equal(banco.eventos.length, 1);
});

test('F2: varredura cancela a_programar/agendada/ocorrencia de pedido Cancelado, mas não em_rota', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  ['a_programar', 'agendada', 'ocorrencia', 'em_rota'].forEach((status, i) => {
    banco.semear.pedido({ NUMERO: 700 + i, SITUACAO: 'Cancelado' });
    banco.semear.entrega({ numero: 700 + i, status });
  });
  assert.equal((await chamar('/entregas')).status, 200);
  assert.deepEqual(banco.entregas.map(e => e.status), ['cancelada', 'cancelada', 'cancelada', 'em_rota']);
  const ev = banco.eventos.filter(v => v.tipo === 'cancelada');
  assert.equal(ev.length, 3);
  assert.ok(ev.every(v => v.usuario === 'sistema' && v.motivo === 'Pedido cancelado'));
  await chamar('/entregas');
  assert.equal(banco.eventos.filter(v => v.tipo === 'cancelada').length, 3);
});

// ---- F3: cancelada pela varredura por "saiu de Pronto" reabre quando o pedido volta a Pronto ----
const MOTIVO_SAIU = 'Pedido saiu de Pronto';
function canceladaPor(banco, { usuario, motivo, situacao = 'Pronto' }) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: situacao });
  const e = banco.semear.entrega({ numero: 501, status: 'cancelada' });
  banco.semear.evento({ entrega_id: e.id, tipo: 'criada' });
  banco.semear.evento({ entrega_id: e.id, tipo: 'cancelada', usuario, motivo });
  return e;
}

test('F3: cancelada pela varredura (saiu de Pronto) volta a a_programar com evento criada do sistema; idempotente', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = canceladaPor(banco, { usuario: 'sistema', motivo: MOTIVO_SAIU });
  assert.equal((await chamar('/entregas')).status, 200);
  assert.equal(e.status, 'a_programar');
  const ult = banco.eventos.at(-1);
  assert.deepEqual([ult.tipo, ult.usuario, ult.motivo], ['criada', 'sistema', 'Pedido voltou a Pronto']);
  const n = banco.eventos.length;
  await chamar('/entregas');
  assert.equal(banco.eventos.length, n);
});

test('F3: cancelada pela equipe, por Pedido cancelado, ou com pedido ainda fora de Pronto permanece cancelada', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const equipe = canceladaPor(banco, { usuario: 'Caio', motivo: 'Cliente desistiu' });
  banco.semear.pedido({ NUMERO: 502 }); const cancelado = banco.semear.entrega({ numero: 502, status: 'cancelada' });
  banco.semear.evento({ entrega_id: cancelado.id, tipo: 'cancelada', usuario: 'sistema', motivo: 'Pedido cancelado' });
  banco.semear.pedido({ NUMERO: 503, SITUACAO: 'Em Produção' }); const fora = banco.semear.entrega({ numero: 503, status: 'cancelada' });
  banco.semear.evento({ entrega_id: fora.id, tipo: 'cancelada', usuario: 'sistema', motivo: MOTIVO_SAIU });
  const antes = banco.eventos.length;
  await chamar('/entregas');
  assert.deepEqual([equipe.status, cancelado.status, fora.status], ['cancelada', 'cancelada', 'cancelada']);
  assert.equal(banco.eventos.length, antes);
});

test('F3: só reabre se o último evento é o da varredura (cancelada, reaberta e cancelada pela equipe fica cancelada)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = canceladaPor(banco, { usuario: 'sistema', motivo: MOTIVO_SAIU });
  banco.semear.evento({ entrega_id: e.id, tipo: 'cancelada', usuario: 'Caio', motivo: 'Cancelada pela equipe' });
  await chamar('/entregas');
  assert.equal(e.status, 'cancelada');
});

// ---- F6: varredura em lote ----
test('F6: varredura de 50 pedidos Pronto usa um INSERT de entregas e um de eventos (sem ler ped_orc por pedido)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  for (let i = 0; i < 50; i++) banco.semear.pedido({ NUMERO: 800 + i });
  assert.equal((await chamar('/entregas')).status, 200);
  assert.equal(banco.entregas.length, 50);
  assert.equal(banco.eventos.filter(v => v.tipo === 'criada' && v.usuario === 'sistema').length, 50);
  const sqls = banco.f.chamadas.map(c => c.sql);
  assert.equal(sqls.filter(s => /^INSERT IGNORE INTO web_entregas/.test(s)).length, 1);
  assert.equal(sqls.filter(s => /^INSERT INTO web_entrega_eventos/.test(s)).length, 1);
  assert.equal(sqls.filter(s => /^SELECT p\.NUMERO/.test(s)).length, 0);
});

// ---- F4: equipe reagenda/cancela entrega em_rota (destrava motorista que não conclui) ----
test('F4: reagendar em_rota -> agendada com evento reagendada; cancelar em_rota -> cancelada com motivo', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente(); banco.semear.pedido({ NUMERO: 501 });
  const a = banco.semear.entrega({ numero: 501, status: 'em_rota', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-10-26' });
  const r = await post(chamar, a.id, 'reagendar', { dataAgendada: '2026-10-28' });
  assert.equal(r.status, 200);
  assert.equal(a.status, 'agendada');
  assert.equal(a.data_agendada, '2026-10-28');
  assert.equal(banco.eventos.at(-1).tipo, 'reagendada');
  banco.pedidos.push({ NUMERO: 502, TIPO: 'Pedido', SITUACAO: 'Pronto', RAZAO_SOCIAL: 'CLIENTE TESTE LTDA', DATA_ENTREGA: null });
  const b = banco.semear.entrega({ numero: 502, status: 'em_rota', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-10-26' });
  assert.equal((await post(chamar, b.id, 'cancelar', { motivo: 'Motorista sumiu' })).status, 200);
  assert.equal(b.status, 'cancelada');
  assert.equal(banco.eventos.at(-1).motivo, 'Motorista sumiu');
});

test('F4: enviada continua sem reagendar/cancelar (409)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente(); banco.semear.pedido({ NUMERO: 501 });
  const e = banco.semear.entrega({ numero: 501, status: 'enviada', tipo: 'outro_estado' });
  assert.equal((await post(chamar, e.id, 'cancelar', { motivo: 'teste' })).status, 409);
  assert.equal((await post(chamar, e.id, 'reagendar', { dataAgendada: '2026-10-28' })).status, 409);
});

// ---- F5: excluir pedido apaga a entrega (anexos, eventos, entrega) na mesma transação e audita ----
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
function pedidoComEntrega(banco, numero = 5) {
  banco.pedOrc.push({ id: numero, TIPO: 'Pedido', NUMERO: numero, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Pronto', TOTAL: 100 });
  banco.entregas.push({ id: 40 + numero, numero });
  banco.entregaEventos.push({ id: 1, entrega_id: 40 + numero }, { id: 2, entrega_id: 99 });
  banco.entregaAnexos.push({ id: 1, entrega_id: 40 + numero }, { id: 2, entrega_id: 99 });
}

test('F5: excluir pedido com entrega remove anexos, eventos e entrega (só as dele) e audita', async t => {
  const banco = bancoPedOrc(); pedidoComEntrega(banco);
  banco.entregas.push({ id: 99, numero: 8 });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5', 'DELETE')).status, 200);
  assert.deepEqual(banco.entregas.map(e => e.id), [99]);
  assert.deepEqual(banco.entregaEventos.map(e => e.entrega_id), [99]);
  assert.deepEqual(banco.entregaAnexos.map(e => e.entrega_id), [99]);
  const a = banco.auditoria.find(x => x.acao === 'entrega_removida_com_pedido');
  assert.ok(a);
  assert.equal(a.alvo, '5');
});

test('F5: excluir pedido sem entrega não falha nem audita remoção de entrega', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ id: 6, TIPO: 'Pedido', NUMERO: 6, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Em Produção', TOTAL: 1 });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/6', 'DELETE')).status, 200);
  assert.equal(banco.auditoria.some(x => x.acao === 'entrega_removida_com_pedido'), false);
});

test('F5: excluir orçamento não mexe em entrega de pedido de mesmo número', async t => {
  const banco = bancoPedOrc(); pedidoComEntrega(banco);
  banco.pedOrc.push({ id: 7, TIPO: 'Orçamento', NUMERO: 5, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Aguardando resposta', TOTAL: 1 });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Orçamento/5', 'DELETE')).status, 200);
  assert.equal(banco.entregas.length, 1);
});

test('F5: falha ao excluir o pedido desfaz tudo e preserva a entrega', async t => {
  const banco = bancoPedOrc(); pedidoComEntrega(banco);
  banco.f.regras.unshift([/^DELETE FROM ped_orc WHERE/, () => { throw new Error('falha forçada'); }]);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5', 'DELETE')).status, 500);
  assert.equal(banco.entregas.length, 1);
  assert.equal(banco.entregaEventos.length, 2);
  assert.equal(banco.entregaAnexos.length, 2);
  assert.equal(banco.pedOrc.length, 1);
  assert.equal(banco.auditoria.length, 0);
});
