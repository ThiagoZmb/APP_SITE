// Página de etiquetas de QR (etiquetas_qr.html + etiquetas_qr.js): lógica pura e HTML estático.
// O desenho do QR e a impressão reais não são testáveis no Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../etiquetas_qr.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ITENS = [
  { codigo: 1, produto: 'Perfil 1036', unidade: 'BR', codBarras: 'ABC123' },
  { codigo: 2, produto: 'Vidro Incolor', unidade: 'M2', codBarras: 'XYZ999' },
  { codigo: 3, produto: 'Parafuso', unidade: 'UN', codBarras: 'PAR001' }
];

test('filtrarItens: por parte do nome ou do código, sem diferenciar caixa', () => {
  assert.deepEqual(E.filtrarItens(ITENS, 'perfil').map(i => i.codigo), [1]);
  assert.deepEqual(E.filtrarItens(ITENS, 'xyz').map(i => i.codigo), [2]);
  assert.deepEqual(E.filtrarItens(ITENS, '  VIDRO ').map(i => i.codigo), [2]);
  assert.equal(E.filtrarItens(ITENS, '').length, 3);
  assert.equal(E.filtrarItens(ITENS, 'nada').length, 0);
  assert.equal(E.filtrarItens(ITENS, undefined).length, 3);
});

test('dividirEmFolhas: 25 itens com 12 por folha = 12, 12 e 1', () => {
  const itens = Array.from({ length: 25 }, (_, i) => ({ codigo: i }));
  assert.deepEqual(E.dividirEmFolhas(itens, 12).map(f => f.length), [12, 12, 1]);
  assert.deepEqual(E.dividirEmFolhas(itens).map(f => f.length), [12, 12, 1]);
  assert.deepEqual(E.dividirEmFolhas([], 12), []);
});

test('textoDoQr devolve exatamente o código de barras', () => {
  assert.equal(E.textoDoQr(ITENS[0]), 'ABC123');
  assert.equal(E.textoDoQr({ codBarras: ' A B ' }), ' A B ');
});

test('HTML: CSP, biblioteca antes do script, tema por último, @media print, sem onclick', () => {
  const h = ler('etiquetas_qr.html');
  assert.match(h, /<meta http-equiv="Content-Security-Policy"/);
  const iLib = h.indexOf('vendor/qrcode.js'), iJs = h.indexOf('etiquetas_qr.js');
  assert.ok(iLib > 0 && iJs > iLib, 'qrcode.js antes de etiquetas_qr.js');
  assert.ok(h.indexOf('href="tema.css') > iJs, 'tema.css depois dos scripts');
  assert.match(h, /@media print/);
  assert.doesNotMatch(h, /\sonclick=/i);
  assert.doesNotMatch(ler('etiquetas_qr.js'), /innerHTML/);
  assert.ok(fs.statSync(path.join(__dirname, '..', 'vendor', 'qrcode.js')).size > 1000);
});

test('estoque.html tem o link para etiquetas_qr.html com data-perm estoque.editar', () => {
  assert.match(ler('estoque.html'), /<a[^>]*data-perm="estoque\.editar"[^>]*href="etiquetas_qr\.html"[^>]*>|<a[^>]*href="etiquetas_qr\.html"[^>]*data-perm="estoque\.editar"[^>]*>/);
});
