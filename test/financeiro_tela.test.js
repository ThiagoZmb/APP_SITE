const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'financeiro.html'), 'utf8');

test('selecionar banco apenas marca o formulário como alterado; salvar é uma ação explícita', () => {
  const inicio = html.indexOf('<form class="gaveta-corpo" id="form"');
  const fim = html.indexOf('</form>', inicio);
  const formulario = html.slice(inicio, fim);
  assert.ok(inicio >= 0 && fim > inicio, 'formulário do movimento encontrado');
  assert.match(formulario, /<input id="f-banco" list="lista-bancos">/);
  assert.match(html, /\$\('form'\)\.addEventListener\('input', \(\) => marcarAlterado\(\)\)/);
  assert.match(html, /\$\('form'\)\.addEventListener\('submit', e => e\.preventDefault\(\)\)/);
  assert.match(html, /\$\('btn-salvar'\)\.addEventListener\('click', salvarMovimento\)/);
  assert.doesNotMatch(html, /addEventListener\(['"](?:input|change|blur)['"],\s*[^)]*salvarMovimento/);
  assert.doesNotMatch(html, /salvarMovimento\(\);\s*\}\s*\}\s*\);/);
});

test('o botão deixa claro quando está editando e não submete o formulário implicitamente', () => {
  assert.match(html, /<button type="button" class="btn btn-primary" id="btn-salvar"/);
  assert.match(html, /\$\('btn-salvar'\)\.textContent = '💾 Atualizar'/);
  assert.match(html, /btn\.textContent = \$\('f-id'\)\.value \? '💾 Atualizar' : '💾 Salvar'/);
});
