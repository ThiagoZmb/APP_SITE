const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');

test('campos de materiais dividem o card em quatro colunas e se reorganizam em telas estreitas', () => {
  assert.match(html, /html body #quadro-serr-produto \.grid-form \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important; gap: 12px !important; \}/);
  assert.match(html, /@media \(max-width: 900px\) \{\s*html body #quadro-serr-produto \.grid-form \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important; \}/);
  assert.match(html, /@media \(max-width: 600px\) \{\s*html body #quadro-serr-produto \.grid-form \{ grid-template-columns: minmax\(0, 1fr\) !important; \}/);
});

test('combos de materiais expandem até a maior opção ao focar e restauram ao sair', () => {
  assert.match(html, /function expandirComboParaOpcoes\(sel\)/);
  assert.match(html, /contexto\.measureText\(texto\)\.width/);
  assert.match(html, /function restaurarLarguraCombo\(sel\)/);
  assert.match(html, /\['f-produto', 'f-material', 'f-acab-serr', 'f-cor-serr'\]\.forEach/);
  assert.match(html, /combo\.addEventListener\('focus', \(\) => expandirComboParaOpcoes\(combo\)\)/);
  assert.match(html, /combo\.addEventListener\('blur', \(\) => restaurarLarguraCombo\(combo\)\)/);
});
