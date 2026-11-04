process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { projetarPedido, paginaValida, numeroValido, TAMANHO_PAGINA } = require('../calculo/portal_pedidos');

const base = { NUMERO: 10, DATA: '2026-10-01', SITUACAO: 'Em Produção', DATA_ENTREGA: null, ENTREGA_STATUS: null, DATA_AGENDADA: null };

test('rotulo de situacao', () => {
  assert.strictEqual(projetarPedido(base).situacao, 'Em produção');
  for (const s of ['Pronto', 'Entregue', 'Retirado', 'Cancelado']) {
    assert.strictEqual(projetarPedido({ ...base, SITUACAO: s }).situacao, s);
  }
  assert.strictEqual(projetarPedido({ ...base, SITUACAO: 'Qualquer' }).situacao, 'Em andamento');
  assert.strictEqual(projetarPedido({ ...base, SITUACAO: null }).situacao, 'Em andamento');
});

test('rotulo de entrega', () => {
  const esperado = {
    a_programar: 'Aguardando agendamento', agendada: 'Entrega agendada', em_rota: 'Saiu para entrega',
    ocorrencia: 'Entrega a reprogramar', entregue: 'Entregue', retirado: 'Retirado',
    enviada: 'Enviada', cancelada: 'Cancelada',
  };
  for (const [k, v] of Object.entries(esperado)) {
    assert.strictEqual(projetarPedido({ ...base, ENTREGA_STATUS: k }).entrega, v);
  }
  assert.strictEqual(projetarPedido({ ...base, ENTREGA_STATUS: null }).entrega, null);
  assert.strictEqual(projetarPedido({ ...base, ENTREGA_STATUS: 'xyz' }).entrega, null);
});

test('dataEntrega e dataAgendada condicionais', () => {
  assert.strictEqual(projetarPedido({ ...base, DATA_ENTREGA: '2026-10-20' }).dataEntrega, null);
  assert.strictEqual(projetarPedido({ ...base, SITUACAO: 'Entregue', DATA_ENTREGA: '2026-10-20' }).dataEntrega, '2026-10-20');
  assert.strictEqual(projetarPedido({ ...base, SITUACAO: 'Retirado', DATA_ENTREGA: '2026-10-20' }).dataEntrega, '2026-10-20');
  assert.strictEqual(projetarPedido({ ...base, SITUACAO: 'Entregue' }).dataEntrega, null);
  assert.strictEqual(projetarPedido({ ...base, ENTREGA_STATUS: 'agendada', DATA_AGENDADA: '2026-11-01' }).dataAgendada, '2026-11-01');
  assert.strictEqual(projetarPedido({ ...base, ENTREGA_STATUS: 'em_rota', DATA_AGENDADA: '2026-11-01' }).dataAgendada, '2026-11-01');
  assert.strictEqual(projetarPedido({ ...base, ENTREGA_STATUS: 'entregue', DATA_AGENDADA: '2026-11-01' }).dataAgendada, null);
  assert.strictEqual(projetarPedido({ ...base, ENTREGA_STATUS: null, DATA_AGENDADA: '2026-11-01' }).dataAgendada, null);
});

test('so repassa as chaves permitidas', () => {
  const p = projetarPedido({ ...base, TOTAL: 99, OBS_GERAL: 'x', CLIENTE_FINAL: 'y', FINANCEIRO: 'z', MOTIVO: 'm' });
  assert.deepStrictEqual(Object.keys(p).sort(), ['data', 'dataAgendada', 'dataEntrega', 'entrega', 'numero', 'situacao']);
  assert.strictEqual(p.numero, 10);
  assert.strictEqual(p.data, '2026-10-01');
});

test('paginaValida', () => {
  assert.strictEqual(paginaValida(undefined), 1);
  assert.strictEqual(paginaValida('3'), 3);
  for (const x of ['0', '-1', '1.5', 'abc', '', ['1', '2'], null, 3]) assert.strictEqual(paginaValida(x), null);
});

test('numeroValido', () => {
  assert.strictEqual(numeroValido('12'), 12);
  for (const x of ['12abc', '0', '-3', '1e3', '1234567890', undefined]) assert.strictEqual(numeroValido(x), null);
});

test('tamanho da pagina', () => {
  assert.strictEqual(TAMANHO_PAGINA, 50);
});
