// Padrão de cores das situações (docs/padrao-cores-situacoes.md): mapa único em situacoes.js.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../situacoes.js');

test('só existem as cinco cores do tema', () => {
  for (const [g, mapa] of Object.entries(S.GRUPOS)) for (const [k, c] of Object.entries(mapa)) assert.ok(S.CORES.includes(c), `${g}.${k} = ${c}`);
});

test('normalizar: acento, caixa e separadores', () => {
  assert.equal(S.normalizar('Em Produção'), 'em_producao');
  assert.equal(S.normalizar(' A Receber '), 'a_receber');
  assert.equal(S.normalizar('Aguardando resposta'), 'aguardando_resposta');
  assert.equal(S.normalizar(null), '');
});

test('decisões do dono: Pronto aviso, Entregue/Retirado ok, Em Produção info, Cancelado neutro, Atrasado perigo', () => {
  assert.equal(S.cor('pedido', 'Pronto'), 'aviso');
  assert.equal(S.cor('pedido', 'Entregue'), 'ok');
  assert.equal(S.cor('pedido', 'Retirado'), 'ok');
  assert.equal(S.cor('pedido', 'Em Produção'), 'info');
  assert.equal(S.cor('pedido', 'Cancelado'), 'neutro');
  assert.equal(S.cor('pedido', 'Atrasado'), 'perigo');
  assert.equal(S.cor('entrega', 'cancelada'), 'neutro');
  assert.equal(S.cor('entrega', 'ocorrencia'), 'perigo');
});

test('"Inativo" é sempre neutro e Bloqueado/Suspensa são perigo', () => {
  for (const g of ['cadastro', 'estoque_item']) assert.equal(S.cor(g, 'Inativo'), 'neutro', g);
  assert.equal(S.cor('estoque_saldo', 'Inativo'), 'neutro');
  assert.equal(S.cor('cadastro', 'Bloqueado'), 'perigo');
  assert.equal(S.cor('cadastro', 'Suspensa'), 'perigo');
});

test('financeiro, estoque e movimento', () => {
  assert.equal(S.cor('financeiro', 'A Receber'), 'aviso');
  assert.equal(S.cor('financeiro', 'Faturado'), 'info');
  assert.equal(S.cor('financeiro', 'Protestado'), 'perigo');
  assert.equal(S.cor('estoque_movimento', 'ajuste'), 'info');
  assert.equal(S.cor('estoque_movimento', 'estorno'), 'neutro');
  assert.equal(S.cor('estoque_saldo', 'No mínimo'), 'aviso');
});

test('desconhecido ou grupo inexistente = neutro; selo escapa o texto', () => {
  assert.equal(S.cor('pedido', 'Coisa nova'), 'neutro');
  assert.equal(S.cor('nao_existe', 'ok'), 'neutro');
  assert.equal(S.selo('pedido', 'Pronto'), '<span class="selo aviso">Pronto</span>');
  assert.equal(S.selo('pedido', 'Pronto', '<b>x</b>', 'grande'), '<span class="selo aviso grande">&lt;b&gt;x&lt;/b&gt;</span>');
});

test('tema.css tem UM .selo com as cinco cores e o DESIGN.md registra o padrão', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'tema.css'), 'utf8');
  for (const c of S.CORES) assert.match(css, new RegExp(`\\.selo\\.${c}\\b`), c);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'DESIGN.md'), 'utf8'), /Cores das situações/);
});
