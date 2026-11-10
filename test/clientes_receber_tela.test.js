// Receber pela ficha do cliente: pedidos "Recebido" e crédito zerado só valem DEPOIS de salvar o lançamento no caixa.
// Cancelar a gaveta não pode deixar o pedido como Recebido sem o lançamento (bug relatado em 2026-11-10).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const h = fs.readFileSync(path.join(__dirname, '..', 'clientes.html'), 'utf8');
const ini = h.indexOf("$('cf-receber').addEventListener('click'");
const msg = h.indexOf("window.addEventListener('message'");
const fim = h.indexOf('// ---------- histórico', msg);
const clique = h.slice(ini, msg), mensagem = h.slice(msg, fim);

test('o clique em Receber não grava nada: só guarda as escolhas e abre a gaveta', () => {
  assert.ok(ini > 0 && msg > ini && fim > msg);
  assert.doesNotMatch(clique, /\/clientes\/receber/);
  assert.match(clique, /recebimentoPendente = \{ codigo: fichaAtual\.codigo, pedidos: nums, zerarCredito, marcarRecebido \}/);
  assert.match(clique, /frame\.src = 'financeiro\.html\?'/);
});

test('o /clientes/receber só roda quando o lançamento foi salvo, uma única vez', () => {
  assert.match(mensagem, /e\.data\.tipo === 'salvo' && pendente/);
  assert.match(mensagem, /api\('\/clientes\/receber'/);
  assert.equal((mensagem.match(/\/clientes\/receber/g) || []).length, 1);
  // o estado pendente é consumido antes da chamada, então "fechado" logo depois de "salvo" não repete
  assert.ok(mensagem.indexOf('recebimentoPendente = null') < mensagem.indexOf("api('/clientes/receber'"));
});

test('cancelar a gaveta (fechado) descarta o pendente sem gravar', () => {
  const trecho = mensagem.slice(mensagem.indexOf("if (e.data.tipo === 'fechado'"));
  assert.match(trecho, /recebimentoPendente = null;/);
  assert.match(trecho, /if \(e\.data\.tipo === 'salvo' && pendente\)/, 'só grava quando o tipo é salvo');
});

test('se a atualização dos pedidos falhar depois do lançamento salvo, o usuário é avisado', () => {
  assert.match(mensagem, /O lançamento foi salvo, mas não foi possível atualizar os pedidos\/crédito/);
});
