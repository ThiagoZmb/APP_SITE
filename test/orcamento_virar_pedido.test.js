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

test('sistema de correr: campo do sistema 4/5 e transpasse 1/5 (regra com !important, pois o grid-form geral também usa)', () => {
  assert.match(html, /<div class="grid-form linha-sistema-correr">/);
  assert.match(html, /html body \.grid-form\.linha-sistema-correr \{ grid-template-columns: minmax\(0, 4fr\) minmax\(90px, 1fr\) !important; \}/);
});

test('serralheria: inserir uma peça NOVA devolve a quantidade de conjuntos a 1; atualizar peça ou editar item não mexe nela', () => {
  assert.ok(html.includes("const atualizandoPeca = pecaEditando >= 0;"));
  assert.ok(html.includes("if (!atualizandoPeca && editandoIndex < 0) document.getElementById('f-qtd').value = 1;"));
  const a = html.indexOf('function inserirPecaSerr()'), b = html.indexOf("document.getElementById('f-qtd').value = 1;", a);
  assert.ok(b > a && b < html.indexOf('calcularPrecoAutomatico();', a), 'a quantidade volta a 1 antes do recálculo do preço');
});
