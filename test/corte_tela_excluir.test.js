// Tela do plano de corte: botão de excluir os dados do pedido (texto de confirmação e ligação no HTML).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../corte.js');

test('texto de confirmação da exclusão: comum para rascunho, reforçado quando há plano conferido', () => {
  const comum = T.textoConfirmarExclusao({ pedido: { numero: 1234 }, qtdPlanosGravados: 2, qtdConferidos: 0 });
  assert.match(comum, /pedido nº 1234/);
  assert.match(comum, /2 plano/);
  assert.match(comum, /não pode ser desfeito/i);
  assert.doesNotMatch(comum, /conferido/i);
  const forte = T.textoConfirmarExclusao({ pedido: { numero: 1234 }, qtdPlanosGravados: 2, qtdConferidos: 1 });
  assert.match(forte, /JÁ CONFERIDO/);
  assert.match(forte, /continuam no estoque de retalhos/);
});

test('o botão existe no HTML, escondido até haver dado para excluir', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'corte.html'), 'utf8');
  assert.match(html, /id="btn-excluir-dados"[^>]*hidden/);
});
