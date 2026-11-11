// Pedido Em Produção pode ter entrega criada à mão e agendada (decisão do dono, 2026-11-11); a baixa continua só com o pedido Pronto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntregas } = require('./apoio/bancoEntregas');

const criar = (chamar, numero) => chamar(`/entregas/pedido/${numero}/criar`, 'POST', {});

test('criação manual: pedido Em Produção sem entrega ganha A programar, sequencia 1, evento criada e auditoria', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Em Produção' });
  const r = await criar(chamar, 501);
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.entrega.status, 'a_programar');
  assert.equal(j.entrega.numero, 501);
  assert.equal(banco.entregas.length, 1);
  assert.equal(banco.entregas[0].sequencia, 1);
  assert.equal(banco.entregas[0].data_agendada, null);
  assert.equal(banco.eventos.length, 1);
  assert.equal(banco.eventos[0].tipo, 'criada');
  assert.equal(banco.eventos[0].usuario, 'Caio');
  assert.equal(banco.auditoria[0].acao, 'entrega_criada_manual');
  assert.equal(banco.auditoria[0].alvo, '501');
  // e pode ser agendada
  const a = await chamar(`/entregas/${j.entrega.id}/agendar`, 'POST', { tipo: 'retirada', dataAgendada: '2026-11-20' });
  assert.equal(a.status, 200);
  assert.equal(banco.entregas[0].status, 'agendada');
});

test('criação manual também vale para pedido Pronto sem entrega', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 502, SITUACAO: 'Pronto' });
  assert.equal((await criar(chamar, 502)).status, 201);
  assert.equal(banco.entregas.length, 1);
});

test('criação manual recusada (409) para Cancelado, Entregue, Retirado e outras situações; 404 para pedido inexistente', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  ['Cancelado', 'Entregue', 'Retirado', 'Orçamento'].forEach((SITUACAO, i) => banco.semear.pedido({ NUMERO: 600 + i, SITUACAO }));
  for (let i = 0; i < 4; i++) {
    const r = await criar(chamar, 600 + i);
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /Só pedido Pronto ou Em Produção/);
  }
  assert.equal((await criar(chamar, 999)).status, 404);
  assert.equal(banco.entregas.length, 0);
});

test('criação manual recusada (409) se o pedido já tem entrega, inclusive cancelada; nada é gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Em Produção' });
  banco.semear.pedido({ NUMERO: 502, SITUACAO: 'Em Produção' });
  banco.semear.entrega({ numero: 501, status: 'a_programar' });
  banco.semear.entrega({ numero: 502, status: 'cancelada' });
  const a = await criar(chamar, 501);
  assert.equal(a.status, 409);
  assert.match((await a.json()).error, /já tem entrega/);
  assert.equal((await criar(chamar, 502)).status, 409);
  assert.equal(banco.entregas.length, 2);
  assert.equal(banco.eventos.length, 0);
});

test('criação manual exige entregas.programar (Somente ver e Motorista recebem 403)', async t => {
  for (const perfil of ['Somente ver', 'Motorista']) {
    const { banco, chamar } = await prepararEntregas(t, { perfil });
    banco.semear.cliente();
    banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Em Produção' });
    assert.equal((await criar(chamar, 501)).status, 403);
    assert.equal(banco.entregas.length, 0);
  }
});

test('criação manual respeita o filtro de estados (outro estado = 404)', async t => {
  const { banco, chamar } = await prepararEntregas(t, { estados: ['RJ'] });
  banco.semear.cliente({ RAZAO_SOCIAL: 'PAULISTA LTDA', ESTADO: 'SP' });
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Em Produção', RAZAO_SOCIAL: 'PAULISTA LTDA' });
  assert.equal((await criar(chamar, 501)).status, 404);
  assert.equal(banco.entregas.length, 0);
});

test('varredura não cancela A programar nem muda Agendada de pedido Em Produção, e não cria entrega sozinha para ele', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Em Produção' });
  banco.semear.pedido({ NUMERO: 502, SITUACAO: 'Em Produção' });
  banco.semear.pedido({ NUMERO: 503, SITUACAO: 'Em Produção' });
  banco.semear.entrega({ numero: 501, status: 'a_programar' });
  banco.semear.evento({ entrega_id: 1, tipo: 'criada', usuario: 'Caio' });
  banco.semear.entrega({ numero: 502, status: 'agendada', data_agendada: '2026-11-20' });
  banco.semear.evento({ entrega_id: 2, tipo: 'agendada', usuario: 'Caio' });
  const r = await chamar('/entregas');
  assert.equal(r.status, 200);
  const { entregas } = await r.json();
  assert.deepEqual(banco.entregas.map(e => e.status), ['a_programar', 'agendada']);
  assert.equal(banco.entregas.length, 2); // o 503 (Em Produção, sem entrega) continua sem entrega
  assert.equal(banco.eventos.filter(v => v.tipo === 'cancelada').length, 0);
  assert.equal(entregas.find(e => e.numero === 501).situacaoPedido, 'Em Produção');
});

test('varredura continua cancelando A programar de pedido Cancelado e de situação fora de Pronto/Em Produção', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Cancelado' });
  banco.semear.pedido({ NUMERO: 502, SITUACAO: 'Orçamento' });
  banco.semear.entrega({ numero: 501, status: 'a_programar' });
  banco.semear.entrega({ numero: 502, status: 'a_programar' });
  await chamar('/entregas');
  assert.deepEqual(banco.entregas.map(e => e.status), ['cancelada', 'cancelada']);
});

function cenarioBaixa(banco, situacao) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: situacao });
  return banco.semear.entrega({ numero: 501, status: 'agendada', tipo: 'retirada', data_agendada: '2026-11-20' });
}

test('baixa pela equipe (retirada) recusada com 409 se o pedido está Em Produção: nada é gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenarioBaixa(banco, 'Em Produção');
  const r = await chamar(`/entregas/${e.id}/retirada`, 'POST', { entregueA: 'Maria' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /ainda não está Pronto/);
  assert.equal(e.status, 'agendada');
  assert.equal(banco.pedidos[0].SITUACAO, 'Em Produção');
  assert.equal(banco.eventos.length, 0);
});

test('baixa do motorista recusada com 409 se o pedido está Em Produção; com o pedido Pronto passa', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: { codigo: 21, nome: 'Motorista Um' } });
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Em Produção' });
  const e = banco.semear.entrega({ numero: 501, status: 'em_rota', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-20' });
  const r = await chamar(`/minhas_entregas/${e.id}/baixa`, 'POST', { entregueA: 'Maria' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /ainda não está Pronto/);
  assert.equal(e.status, 'em_rota');
  assert.equal(banco.pedidos[0].SITUACAO, 'Em Produção');
  banco.pedidos[0].SITUACAO = 'Pronto';
  const ok = await chamar(`/minhas_entregas/${e.id}/baixa`, 'POST', { entregueA: 'Maria' });
  assert.equal(ok.status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Entregue');
});

test('baixa com pedido Pronto segue funcionando como antes', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenarioBaixa(banco, 'Pronto');
  assert.equal((await chamar(`/entregas/${e.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Retirado');
});
