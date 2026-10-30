// Funções puras do DANFE (calculo/danfe.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_PDF, lerChave, chaveDoNomeDoArquivo, numerosDeNotaFiscal, validarPdf } = require('../calculo/danfe');

const CHAVE = '32260608951388000118550010000112901000002850';

test('danfe: lerChave separa os campos da chave de exemplo', () => {
  const c = lerChave(CHAVE);
  assert.equal(c.valida, true);
  assert.deepEqual([c.uf, c.aamm, c.cnpj, c.modelo, c.serie, c.numeroNf, c.dv], ['32', '2606', '08951388000118', '55', 1, 11290, 0]);
});

test('danfe: lerChave recusa DV errado, tamanho errado e não dígitos', () => {
  assert.equal(lerChave(CHAVE.slice(0, 43) + '1').valida, false);
  assert.equal(lerChave(CHAVE.slice(0, 43)).valida, false);
  assert.equal(lerChave(CHAVE + '0').valida, false);
  assert.equal(lerChave('3226060895138800011855001000011290100000285X').valida, false);
  assert.equal(lerChave('').valida, false);
  assert.equal(lerChave(null).valida, false);
  assert.equal(lerChave(` ${CHAVE} `).valida, true); // espaços das pontas não atrapalham
});

test('danfe: chaveDoNomeDoArquivo exige chave válida e extensão .pdf', () => {
  assert.equal(chaveDoNomeDoArquivo(CHAVE + '.pdf'), CHAVE);
  assert.equal(chaveDoNomeDoArquivo(CHAVE + '.PDF'), CHAVE);
  assert.equal(chaveDoNomeDoArquivo('pasta/sub\\' + CHAVE + '.pdf'), CHAVE);
  assert.equal(chaveDoNomeDoArquivo(CHAVE + '.xml'), '');
  assert.equal(chaveDoNomeDoArquivo(CHAVE.slice(0, 43) + '1.pdf'), '');
  assert.equal(chaveDoNomeDoArquivo('NF 123.pdf'), '');
  assert.equal(chaveDoNomeDoArquivo('x' + CHAVE + '.pdf'), '');
});

test('danfe: numerosDeNotaFiscal divide, ignora lixo e tira zeros à esquerda', () => {
  assert.deepEqual(numerosDeNotaFiscal('8862/8887'), [8862, 8887]);
  assert.deepEqual(numerosDeNotaFiscal('8862, 8887;9000 9001'), [8862, 8887, 9000, 9001]);
  assert.deepEqual(numerosDeNotaFiscal('000123'), [123]);
  assert.deepEqual(numerosDeNotaFiscal('000123/123'), [123]); // sem repetição
  assert.deepEqual(numerosDeNotaFiscal('NF 55 / 10M / 0 / 000'), [55]); // lixo, letras e zero fora
  assert.deepEqual(numerosDeNotaFiscal('1234567890'), []); // mais de 9 dígitos
  assert.deepEqual(numerosDeNotaFiscal('123456789'), [123456789]);
  assert.deepEqual(numerosDeNotaFiscal(null), []);
  assert.deepEqual(numerosDeNotaFiscal(''), []);
});

test('danfe: validarPdf confere assinatura e tamanho', () => {
  assert.equal(validarPdf(Buffer.from('%PDF-1.4 x')).ok, true);
  assert.equal(validarPdf(Buffer.from('<html>')).ok, false);
  assert.equal(validarPdf(Buffer.alloc(0)).ok, false);
  assert.equal(validarPdf('%PDF-').ok, false); // texto, não bytes
  assert.equal(validarPdf(undefined).ok, false);
  const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_PDF)]);
  assert.equal(validarPdf(grande).ok, false);
  assert.equal(validarPdf(grande.subarray(0, MAX_PDF)).ok, true);
});
