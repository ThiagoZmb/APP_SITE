const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');

test('cada peça de serralheria é precificada isoladamente e mantém seu próprio unitário', () => {
  const inicio = html.indexOf('async function precificarPecaSerr(peca)');
  const fim = html.indexOf('async function inserirPecaSerr()', inicio);
  const precificar = html.slice(inicio, fim);

  assert.ok(inicio >= 0 && fim > inicio, 'função de preço individual encontrada');
  assert.match(precificar, /pecas: \[pecaParaEnvio\(peca\)\]/);
  assert.match(precificar, /qtd: peca\.qtd/);
  assert.match(precificar, /complementos: \[\]/);
  assert.match(precificar, /peca\.valor = Number\(detalhe\.unitario\)/);
  assert.doesNotMatch(precificar, /pecasSerr\[i\]\.valor\s*=/);
  assert.match(html, /atualizarValorSerralheria\(\)[\s\S]*?precificarPecasSerrPendentes\(\)/);
  assert.match(html, /pecasSerr\.filter\(p => !Number\.isFinite\(p\.valor\)\)/);
});

test('ao inserir ou atualizar uma peça, apenas ela é precificada', () => {
  const inicio = html.indexOf('async function inserirPecaSerr()');
  const fim = html.indexOf('async function editarPecaSerr', inicio);
  const inserir = html.slice(inicio, fim);

  assert.match(inserir, /if \(atualizandoPeca\) \{ pecasSerr\[pecaEditando\] = p;/);
  assert.match(inserir, /qtd: qtdEfetiva\(\)/);
  assert.match(inserir, /else pecasSerr\.push\(p\)/);
  assert.match(inserir, /await precificarPecaSerr\(p\)/);
  assert.doesNotMatch(inserir, /calcularPrecoAutomatico\(\)/);
});

test('a tela mostra e soma quantidade e valor de cada peça separadamente', () => {
  assert.match(html, /Conjuntos/);
  assert.match(html, /formatCurrency\(p\.valor \* \(p\.qtd \|\| 1\)\)/);
  assert.match(html, /s \+ \(p\.valor \|\| 0\) \* \(p\.qtd \|\| 1\)/);
  assert.match(html, /quantidades\.every\(q => q === quantidades\[0\]\) \? quantidades\[0\] : 1/);
});

test('serralheria na tela: valor unitário = total do item ÷ quantidade (mesma conta do servidor); 3 conjuntos não multiplica duas vezes', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  const ini = h.indexOf('function valorUnitarioSerralheria(pecas, complementos, qtdItem) {');
  assert.ok(ini > 0, 'função presente');
  const corpo = /^function valorUnitarioSerralheria\(pecas, complementos, qtdItem\) \{[\s\S]*?\r?\n        \}/.exec(h.slice(ini))[0];
  const { valorUnitarioSerralheria: f } = vm.runInNewContext(corpo + '\n({ valorUnitarioSerralheria })');
  const peca = (valor, qtd) => ({ valor, qtd });
  // o caso real do pedido: 1 peça de R$ 857,31, quantidade 3 na peça e 3 no item => unitário 857,31 e total 2.571,93 (o PDF está certo)
  const unit3 = f([peca(857.31, 3)], [], 3);
  assert.equal(Math.round(unit3 * 100) / 100, 857.31);
  assert.equal(Math.round(unit3 * 3 * 100) / 100, 2571.93);
  // quantidade 1: igual ao valor da peça
  assert.equal(Math.round(f([peca(857.31, 1)], [], 1) * 100) / 100, 857.31);
  // quantidades diferentes entre as peças: o item vale 1 e o unitário é a soma de valor × quantidade
  assert.equal(Math.round(f([peca(100, 2), peca(50, 4)], [], 1) * 100) / 100, 400);
  // complementos entram no total do item e também são divididos pela quantidade do item
  assert.equal(Math.round(f([peca(100, 3)], [{ valorTotal: 30 }], 3) * 100) / 100, 110);
  assert.equal(Math.round(f([peca(18, 18)], [], 18) * 100) / 100, 18);
});
