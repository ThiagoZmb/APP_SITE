// Menu do botão direito em painel_inicial.html: conferência estática (a tela não tem testes de DOM)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8');

test('painel_inicial: menu de contexto nas linhas com PDF, guia de produção, situação, entrega, copiar, cancelar e excluir', () => {
  assert.match(h, /addEventListener\('contextmenu'/);
  assert.match(h, /producao=1/);
  for (const perm of ['pedidos.pdf', 'pedidos.situacao', 'entregas.ver', 'pedidos.cancelar', 'pedidos.excluir', 'orcamentos.criar valores.ver']) assert.ok(h.includes("'" + perm + "'"), perm);
  assert.ok(h.includes('/situacao'));
  for (const s of ['Em Produção', 'Pronto', 'Entregue', 'Retirado']) assert.ok(h.includes("'" + s + "'") || h.includes(': ' + "'" + s + "'"), s);
});

test('painel_inicial: api() mantém o Authorization e aceita cabeçalhos extras (JSON do POST de situação)', () => {
  assert.ok(h.includes("headers: { ...(opcoes.headers || {}), 'Authorization'"));
});

test('painel_inicial: nomes do menu escapados (esc) e sem handlers inline novos', () => {
  const bloco = h.slice(h.indexOf('menu do botão direito: ações'), h.indexOf("$('chips-sit').addEventListener"));
  assert.ok(bloco.length > 500);
  assert.ok(bloco.includes('esc(it.rotulo)'));
  assert.doesNotMatch(bloco, /onclick=|onerror=/);
});
