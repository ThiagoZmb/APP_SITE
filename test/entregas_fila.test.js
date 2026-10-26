const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntregas } = require('./apoio/bancoEntregas');

function cenario(banco, { situacao = 'Pronto', dataEntrega = null } = {}) {
  banco.semear.cliente();
  return banco.semear.pedido({ NUMERO: 501, SITUACAO: situacao, DATA_ENTREGA: dataEntrega });
}

test('pedido Pronto sem registro vira 1 entrega a_programar, sem data nem endereço', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco);
  const r = await chamar('/entregas');
  assert.equal(r.status, 200);
  const { entregas } = await r.json();
  assert.equal(entregas.length, 1);
  assert.equal(entregas[0].numero, 501);
  assert.equal(entregas[0].status, 'a_programar');
  assert.equal(entregas[0].dataAgendada, null);
  assert.equal(banco.entregas.length, 1);
  const e = banco.entregas[0];
  assert.equal(e.data_agendada, null);
  for (const k of ['endereco_rua', 'endereco_numero', 'endereco_bairro', 'endereco_cidade', 'endereco_uf', 'endereco_cep']) assert.equal(e[k], null);
  assert.equal(banco.eventos.length, 1);
  assert.equal(banco.eventos[0].tipo, 'criada');
  assert.equal(banco.eventos[0].usuario, 'sistema');
});

test('duas chamadas seguidas não duplicam', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco);
  await chamar('/entregas');
  const r = await chamar('/entregas');
  assert.equal((await r.json()).entregas.length, 1);
  assert.equal(banco.entregas.length, 1);
  assert.equal(banco.eventos.length, 1);
});

test('pedido que não está Pronto não gera registro', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  ['Em Produção', 'Entregue', 'Orçamento'].forEach((SITUACAO, i) => banco.semear.pedido({ NUMERO: 600 + i, SITUACAO }));
  banco.semear.pedido({ NUMERO: 610, TIPO: 'Orçamento', SITUACAO: 'Pronto' });
  const r = await chamar('/entregas');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).entregas.length, 0);
  assert.equal(banco.entregas.length, 0);
});

test('a_programar cujo pedido virou Cancelado passa a cancelada, com evento', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, { situacao: 'Cancelado' });
  banco.semear.entrega({ numero: 501, status: 'a_programar' });
  const r = await chamar('/entregas');
  assert.equal(r.status, 200);
  assert.equal(banco.entregas[0].status, 'cancelada');
  const ev = banco.eventos.filter(v => v.tipo === 'cancelada');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].usuario, 'sistema');
  assert.equal(ev[0].entrega_id, banco.entregas[0].id);
  // idempotente: nova chamada não repete o evento
  await chamar('/entregas');
  assert.equal(banco.eventos.filter(v => v.tipo === 'cancelada').length, 1);
});

test('agendada cujo pedido saiu de Pronto não muda', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, { situacao: 'Em Produção' });
  banco.semear.entrega({ numero: 501, status: 'agendada', data_agendada: '2026-11-03' });
  await chamar('/entregas');
  assert.equal(banco.entregas[0].status, 'agendada');
  assert.equal(banco.eventos.length, 0);
});

test('perfil Somente ver lista (200)', async t => {
  const a = await prepararEntregas(t, { perfil: 'Somente ver' });
  assert.equal((await a.chamar('/entregas')).status, 200);
});

test('dataPrometida vem de DATA_ENTREGA e dataAgendada é texto AAAA-MM-DD', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, { situacao: 'Em Produção', dataEntrega: '2026-11-10' });
  banco.semear.entrega({ numero: 501, status: 'agendada', data_agendada: '2026-11-03', tipo: 'motorista', motorista_codigo: 21 });
  banco.semear.evento({ entrega_id: 1, tipo: 'ausente' });
  banco.semear.evento({ entrega_id: 1, tipo: 'agendada' });
  const [e] = (await (await chamar('/entregas')).json()).entregas;
  assert.deepEqual(Object.keys(e).sort(), ['cidade', 'cliente', 'dataAgendada', 'dataPrometida', 'id', 'motorista', 'numero', 'qtdOcorrencias', 'status', 'tipo', 'uf'].sort());
  assert.equal(e.dataPrometida, '2026-11-10');
  assert.equal(e.dataAgendada, '2026-11-03');
  assert.equal(e.motorista, 'Motorista Um');
  assert.equal(e.qtdOcorrencias, 1);
  assert.equal(e.cidade, 'Niterói');
  assert.equal(e.uf, 'RJ');
});

test('filtros status e busca; status inválido responde 400', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente(); banco.semear.cliente({ RAZAO_SOCIAL: 'OUTRA FIRMA SA' });
  banco.semear.pedido({ NUMERO: 501 }); banco.semear.pedido({ NUMERO: 502, RAZAO_SOCIAL: 'OUTRA FIRMA SA' });
  assert.equal((await (await chamar('/entregas')).json()).entregas.length, 2);
  assert.equal((await (await chamar('/entregas?busca=outra')).json()).entregas.length, 1);
  assert.equal((await (await chamar('/entregas?busca=501')).json()).entregas[0].numero, 501);
  assert.equal((await (await chamar('/entregas?status=a_programar')).json()).entregas.length, 2);
  assert.equal((await (await chamar('/entregas?status=entregue')).json()).entregas.length, 0);
  const r = await chamar('/entregas?status=xyz');
  assert.equal(r.status, 400);
});

test('perfil Motorista recebe 403', async t => {
  const { chamar } = await prepararEntregas(t, { perfil: 'Motorista' });
  assert.equal((await chamar('/entregas')).status, 403);
});

test('usuário com estados restritos não vê cliente de outro estado', async t => {
  const { banco, chamar } = await prepararEntregas(t, { estados: ['RJ'] });
  banco.semear.cliente(); banco.semear.cliente({ RAZAO_SOCIAL: 'PAULISTA LTDA', ESTADO: 'SP', CIDADE: 'Campinas' });
  banco.semear.pedido({ NUMERO: 501 }); banco.semear.pedido({ NUMERO: 502, RAZAO_SOCIAL: 'PAULISTA LTDA' });
  const { entregas } = await (await chamar('/entregas')).json();
  assert.deepEqual(entregas.map(e => e.numero), [501]);
});
