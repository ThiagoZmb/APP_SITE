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

test('serralheria: inserir peça preserva a quantidade de conjuntos até adicionar o item', () => {
  assert.ok(html.includes("const atualizandoPeca = pecaEditando >= 0;"));
  const a = html.indexOf('function inserirPecaSerr()'), b = html.indexOf('\n        async function editarPecaSerr', a);
  const inserir = html.slice(a, b);
  assert.ok(inserir.includes('qtd: qtdEfetiva()'), 'captura a quantidade escolhida na própria peça');
  assert.ok(inserir.includes('await precificarPecaSerr(p)'), 'calcula somente o preço da peça inserida');
  assert.ok(!inserir.includes('calcularPrecoAutomatico()'), 'não recalcula as peças já inseridas');
  assert.ok(!inserir.includes("document.getElementById('f-qtd').value"), 'não altera a quantidade ao inserir/atualizar peça');
  assert.ok(html.includes("document.getElementById('f-qtd').value = 1;"), 'limpa a quantidade quando o item é adicionado');
});

test('botão Novo também limpa o campo do cliente (volta ao placeholder e avisa a tela, que trava os itens)', () => {
  const trecho = html.slice(html.indexOf('function novoDocumento()'), html.indexOf('function novoDocumento()') + 900);
  assert.ok(trecho.includes('limparDocumento();'));
  assert.ok(trecho.includes("const selCliente = $s('sel-cliente');") && trecho.includes('selCliente.selectedIndex = 0;') && trecho.includes("selCliente.dispatchEvent(new Event('change'));"));
  assert.ok(trecho.indexOf('limparDocumento();') < trecho.indexOf('selCliente.selectedIndex = 0;'), 'limpa o cliente depois do resto');
});
