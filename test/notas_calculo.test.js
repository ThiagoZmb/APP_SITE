// Validação pura das notas fiscais sem itens.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TIPOS_NOTA, chaveValida, normalizarNumero, validarNota, validarCancelamento } = require('../calculo/notas_fiscais');

// monta uma chave de 44 dígitos com o DV (módulo 11) calculado aqui, independente da implementação
function chaveCom(base43) {
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base43 + String(r < 2 ? 0 : 11 - r);
}
const BASE = '3326102345678900019055001000001234100000123';
const CHAVE = chaveCom(BASE);
const OK = { tipo: 'entrada', numero: '000123', serie: '', dataEmissao: '2026-10-20', contraparteCodigo: '5', valorTotal: '1500,50', observacao: 'x' };
const erros = (b, o = { podeValores: true, criando: true }) => validarNota(b, o).erros.join(' | ');

test('notas: tipos', () => assert.deepEqual(TIPOS_NOTA, ['entrada', 'saida']));

test('notas: chaveValida confere 44 dígitos e o DV', () => {
  assert.equal(CHAVE.length, 44);
  assert.equal(chaveValida(CHAVE), true);
  assert.equal(chaveValida(CHAVE.slice(0, 43) + String((Number(CHAVE[43]) + 1) % 10)), false);
  assert.equal(chaveValida(CHAVE.slice(0, 43)), false);
  assert.equal(chaveValida(CHAVE + '0'), false);
  assert.equal(chaveValida('abc'), false);
});

test('notas: normalizarNumero tira zeros à esquerda e recusa o inválido', () => {
  assert.equal(normalizarNumero('000123'), '123');
  for (const v of ['12-a', '12 3', '', '0', '000', 'a'.repeat(21), null]) assert.equal(normalizarNumero(v), '', String(v));
  // o VB usa números com letras (10M, 11L, 12888A): ficam em maiúsculas; só número puro perde os zeros à esquerda
  for (const [v, esperado] of [['10m', '10M'], ['86P ', '86P'], ['12888A', '12888A'], ['000123', '123'], ['0A', '0A'], ['1234567890', '1234567890']]) assert.equal(normalizarNumero(v), esperado, v);
});

test('notas: criando OK normaliza número, série e chave', () => {
  const { erros: e, dados } = validarNota(OK, { podeValores: true, criando: true });
  assert.deepEqual(e, []);
  assert.equal(dados.numero, '123');
  assert.equal(dados.serie, '1');
  assert.equal(dados.chave, null);
  assert.equal(dados.valorTotal, 1500.5);
  assert.equal(dados.contraparteCodigo, 5);
  assert.equal(validarNota({ ...OK, chave: ' ' + CHAVE + ' ' }, { podeValores: true, criando: true }).dados.chave, CHAVE);
});

test('notas: erros de cada campo', () => {
  const casos = [
    [{ tipo: 'x' }, 'Tipo'], [{ numero: 'a-c' }, 'Número'], [{ dataEmissao: '2026-02-30' }, 'Data'], [{ dataEmissao: '' }, 'Data'],
    [{ dataEmissao: '20/10/2026' }, 'Data'], [{ contraparteCodigo: 0 }, 'fornecedor'], [{ contraparteCodigo: 'a' }, 'fornecedor'],
    [{ valorTotal: '1.234,56' }, 'Valor'], [{ valorTotal: '1.500' }, 'Valor'], [{ valorTotal: '0' }, 'Valor'], [{ valorTotal: '-5' }, 'Valor'],
    [{ valorTotal: '' }, 'Valor'], [{ chave: CHAVE.slice(0, 43) + String((Number(CHAVE[43]) + 1) % 10) }, 'Chave'],
    [{ observacao: 'a'.repeat(501) }, 'Observação'], [{ serie: 'abcdef' }, 'Série']
  ];
  for (const [mudanca, trecho] of casos) assert.ok(erros({ ...OK, ...mudanca }).includes(trecho), JSON.stringify(mudanca) + ' → ' + erros({ ...OK, ...mudanca }));
  assert.ok(erros({ ...OK, tipo: 'saida', contraparteCodigo: 0 }).includes('cliente'));
});

test('notas: sem podeValores não lê nem valida o valor', () => {
  const r = validarNota({ ...OK, valorTotal: 'lixo' }, { podeValores: false, criando: true });
  assert.deepEqual(r.erros, []);
  assert.equal('valorTotal' in r.dados, false);
});

test('notas: editando valida só data, valor e observação', () => {
  const r = validarNota({ tipo: 'x', numero: 'abc', contraparteCodigo: 0, dataEmissao: '2026-10-21', valorTotal: '10', observacao: 'ok' }, { podeValores: true, criando: false });
  assert.deepEqual(r.erros, []);
  assert.deepEqual(Object.keys(r.dados).sort(), ['dataEmissao', 'observacao', 'valorTotal']);
  assert.ok(validarNota({ dataEmissao: '', valorTotal: '10' }, { podeValores: true, criando: false }).erros.join().includes('Data'));
});

test('notas: validarCancelamento', () => {
  assert.equal(validarCancelamento({ motivo: ' ' }).erros.length, 1);
  assert.equal(validarCancelamento({ motivo: 'a'.repeat(301) }).erros.length, 1);
  assert.deepEqual(validarCancelamento({ motivo: ' ok ' }), { erros: [], motivo: 'ok' });
});

test('notas: série normalizada ("01" = "1") e valor com no máximo 2 casas e teto do DECIMAL(14,2)', () => {
  const v = (m, o = { podeValores: true, criando: true }) => validarNota({ ...OK, ...m }, o);
  assert.equal(v({ serie: '001' }).dados.serie, '1');
  assert.equal(v({ serie: '0' }).dados.serie, '0');
  assert.equal(v({ serie: 'AB' }).dados.serie, 'AB');
  assert.deepEqual(v({ valorTotal: '10,99' }).erros, []);
  assert.deepEqual(v({ valorTotal: '999999999999,99' }).erros, []);
  for (const valorTotal of ['10,999', '10.9999', '1000000000000', '1000000000000,00']) assert.ok(v({ valorTotal }).erros.join().includes('Valor'), valorTotal);
});
