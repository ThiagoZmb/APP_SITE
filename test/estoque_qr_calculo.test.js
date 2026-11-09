const test = require('node:test');
const assert = require('node:assert/strict');
const { codigoValido, projetarItem, projetarEtiquetas } = require('../calculo/estoque_qr');

test('codigoValido aceita texto simples e URL', () => {
  assert.equal(codigoValido('7890000000011'), '7890000000011');
  assert.equal(codigoValido('  123 '), '123');
  assert.equal(codigoValido('a'.repeat(20)), 'a'.repeat(20));
  assert.equal(codigoValido('https://x.com/a'), 'https://x.com/a');
});

test('codigoValido recusa vazio, longo e caractere de controle', () => {
  for (const v of ['', '   ', null, undefined, 'a'.repeat(21), '12\n34', '12\u0000', '12\u007f']) {
    assert.equal(codigoValido(v), null, JSON.stringify(v));
  }
});

test('projetarItem converte e devolve só 4 chaves', () => {
  const r = projetarItem({ CODIGO: 5, NOME_PRODUTO: 'Perfil', UNIDADE: 'UN', QTD_ESTOQUE: '10.000', EXTRA: 1 });
  assert.deepEqual(r, { codigo: 5, nome: 'Perfil', unidade: 'UN', qtd: 10 });
  assert.deepEqual(Object.keys(r), ['codigo', 'nome', 'unidade', 'qtd']);
});

test('projetarEtiquetas separa itens sem código de barras', () => {
  const r = projetarEtiquetas([
    { CODIGO: 1, NOME_PRODUTO: 'A', UNIDADE: 'UN', CODIGO_BARRA: '111' },
    { CODIGO: 2, NOME_PRODUTO: 'B', UNIDADE: 'UN', CODIGO_BARRA: null },
    { CODIGO: 3, NOME_PRODUTO: 'C', UNIDADE: 'UN', CODIGO_BARRA: '  ' }
  ]);
  assert.equal(r.semCodigo, 2);
  assert.deepEqual(r.itens, [{ codigo: 1, produto: 'A', unidade: 'UN', codBarras: '111' }]);
});
