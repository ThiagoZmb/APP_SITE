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
  assert.match(inserir, /else pecasSerr\.push\(p\)/);
  assert.match(inserir, /await precificarPecaSerr\(p\)/);
  assert.doesNotMatch(inserir, /calcularPrecoAutomatico\(\)/);
});
