const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');

test('orçamento aberto pode virar pedido: o tipo só fica travado nos demais casos', () => {
  const m = html.match(/function mostrarNumero\(\) \{[\s\S]*?\n        \}/)[0];
  assert.match(m, /docAberto\.tipo === 'Orçamento'/);
  assert.match(m, /docAberto\.podeEditar/);
  assert.match(m, /disabled = !!docAberto && !podeVirarPedido/);
});

test('ao virar pedido o salvar cria um pedido novo, sem tratar os itens como cópia do orçamento', () => {
  assert.match(html, /const converte = !!docAberto && docAberto\.tipo !== tipo;/);
  assert.match(html, /docAberto\?\.impressao && !converte \? \{ impressao/);
  assert.match(html, /modo === 'novo' && docAberto\?\.impressao && !converte \? \{ origemDocumento/);
  assert.match(html, /it\.origem && !converte \? \{ origem: it\.origem \}/);
});
