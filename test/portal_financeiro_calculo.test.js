process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { visaoValida, dinheiro, docesMesesAtras, projetarTitulo, EM_ABERTO } = require('../calculo/portal_financeiro');
const pedidos = require('../calculo/portal_pedidos');

const HOJE = '2026-11-04';
const linha = { DATA: '2026-11-04', PEDIDO: '123', NOTA_FISCAL: '000123', SITUACAO: 'A Receber', VALOR: '100.50' };

test('visaoValida', () => {
  assert.strictEqual(visaoValida(undefined), 'abertos');
  assert.strictEqual(visaoValida('abertos'), 'abertos');
  assert.strictEqual(visaoValida('pagos'), 'pagos');
  for (const v of ['', 'Abertos', 'todos', ['abertos', 'pagos'], null]) assert.strictEqual(visaoValida(v), null);
});

test('dinheiro', () => {
  assert.strictEqual(dinheiro('1234.5'), 1234.5);
  assert.strictEqual(dinheiro('10.005'), 10.01);
  assert.strictEqual(dinheiro(0.1 + 0.2), 0.3);
  assert.strictEqual(dinheiro('0'), 0);
  assert.strictEqual(dinheiro('-5.20'), -5.2);
  for (const v of [null, '', 'abc', NaN, Infinity]) assert.strictEqual(dinheiro(v), null);
});

test('docesMesesAtras', () => {
  assert.strictEqual(docesMesesAtras('2027-03-31'), '2026-03-31');
  assert.strictEqual(docesMesesAtras('2028-02-29'), '2027-02-28');
  assert.strictEqual(docesMesesAtras('2026-11-04'), '2025-11-04');
  assert.strictEqual(docesMesesAtras('2026-01-01'), '2025-01-01');
});

test('projetarTitulo: situacao', () => {
  const sit = (s, d) => projetarTitulo({ ...linha, SITUACAO: s, DATA: d || linha.DATA }, HOJE);
  assert.strictEqual(sit('A Receber', '2026-11-04').situacao, 'A receber');
  assert.strictEqual(sit('A Receber', '2026-11-03').situacao, 'Em atraso');
  assert.strictEqual(sit('Atrasado', '2026-12-01').situacao, 'Em atraso');
  assert.strictEqual(sit('Protestado').situacao, 'Protestado');
  assert.strictEqual(sit('Recebido').situacao, 'Pago');
  assert.strictEqual(sit('Recebido', '2027-01-01').situacao, 'Pago');
  for (const s of ['Cancelado', null, 'constructor']) assert.strictEqual(sit(s), null);
  assert.deepStrictEqual(EM_ABERTO, ['A Receber', 'Atrasado', 'Protestado']);
});

test('projetarTitulo: campos invalidos e normalizacao', () => {
  for (const DATA of [null, '04/11/2026']) assert.strictEqual(projetarTitulo({ ...linha, DATA }, HOJE), null);
  for (const VALOR of [null, 'x']) assert.strictEqual(projetarTitulo({ ...linha, VALOR }, HOJE), null);
  assert.strictEqual(projetarTitulo({ ...linha, PEDIDO: '' }, HOJE).pedido, null);
  assert.strictEqual(projetarTitulo({ ...linha, PEDIDO: null }, HOJE).pedido, null);
  assert.strictEqual(projetarTitulo({ ...linha, PEDIDO: '123' }, HOJE).pedido, 123);
  assert.strictEqual(projetarTitulo({ ...linha, NOTA_FISCAL: '' }, HOJE).notaFiscal, null);
  assert.strictEqual(projetarTitulo({ ...linha, NOTA_FISCAL: '000123' }, HOJE).notaFiscal, '000123');
  const t = projetarTitulo(linha, HOJE);
  assert.strictEqual(t.vencimento, '2026-11-04');
  assert.strictEqual(t.valor, 100.5);
});

test('projetarTitulo: chaves fechadas', () => {
  const t = projetarTitulo({ ...linha, ID: 1, OBSERVACAO_GERAL: 'x', RAZAO_FABRICANTE: 'y', RAZAO_SOCIAL: 'z' }, HOJE);
  assert.deepStrictEqual(Object.keys(t).sort(), ['notaFiscal', 'pedido', 'situacao', 'valor', 'vencimento']);
});

test('PAGINA_MAXIMA exportado', () => {
  assert.strictEqual(pedidos.PAGINA_MAXIMA, 100000);
});
