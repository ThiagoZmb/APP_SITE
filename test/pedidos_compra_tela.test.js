const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../pedidos_compra.js');
const Situacoes = require('../situacoes.js');

const ler = a => fs.readFileSync(path.join(__dirname, '..', a), 'utf8');

test('total em unidades e o texto das caixas', () => {
  assert.equal(P.totalUnidades('2', '50'), 100);
  assert.equal(P.totalUnidades('3', ''), 3);
  assert.equal(P.totalUnidades('', '50'), null);
  assert.equal(P.totalUnidades('1.5', '1'), null);
  assert.equal(P.textoTotal('2', '50', 'un'), '2 caixas × 50 = 100 un');
  assert.equal(P.textoTotal('1', '50', 'un'), '1 caixa × 50 = 50 un');
  assert.equal(P.textoTotal('7', '1', 'Barra'), '7 Barra');
  assert.equal(P.textoTotal('', '1', 'un'), '');
});

test('o que vai no pedido: só as linhas marcadas; marcada sem quantidade é erro com o nome', () => {
  const linha = (codigo, mudar) => ({ codigo, produto: 'P' + codigo, marcado: true, quantidade: '2', porCaixa: '1', ...mudar });
  assert.deepEqual(P.itensParaEnviar([linha(1, { porCaixa: '50' }), linha(2, { marcado: false, quantidade: '' })]),
    { itens: [{ produtoCodigo: 1, quantidade: 2, porCaixa: 50 }] });
  assert.match(P.itensParaEnviar([linha(1), linha(2, { quantidade: '' })]).erro, /P2/);
  assert.match(P.itensParaEnviar([linha(3, { porCaixa: '0' })]).erro, /P3/);
  assert.match(P.itensParaEnviar([linha(1, { marcado: false })]).erro, /pelo menos um item/);
});

test('sugestão em unidades vira caixas no campo', () => {
  assert.equal(P.caixasDe(100, 50), '2');
  assert.equal(P.caixasDe(8, 1), '8');
  assert.equal(P.caixasDe(null, 50), '');
});

test('situações do pedido têm rótulo e cor', () => {
  for (const s of ['rascunho', 'enviado', 'parcial', 'recebido', 'encerrado', 'cancelado']) {
    assert.ok(P.ROTULOS[s], s);
    assert.ok(Object.hasOwn(Situacoes.GRUPOS.compra, s), s);
  }
  assert.equal(P.ROTULOS.parcial, 'Chegou em parte');
  assert.equal(Situacoes.cor('compra', 'rascunho'), 'aviso');
});

test('ligações: aba no estoque, página no layout, entrada avisa, mesma versão do layout', () => {
  for (const arq of ['estoque.html', 'movimentacao_estoque.html']) {
    assert.match(ler(arq), /<a class="aba-est" data-perm="compras\.ver" href="pedidos_compra\.html">Pedidos a fornecedor<\/a>/, arq);
  }
  const l = ler('layout.js');
  assert.match(l, /'pedidos_compra\.html': \['estoque\.ver', 'compras\.ver'\]/);
  assert.match(l, /'pedidos_compra\.html': 'estoque\.html'/);
  assert.match(ler('movimentacao_estoque.html'), /pedidosAtualizados/);
  assert.match(ler('estoque.html'), /it\.aCaminho \|\| it\.aguardando/);
  const html = ler('pedidos_compra.html');
  assert.match(html, /Content-Security-Policy/);
  for (const id of ['btn-novo', 'btn-salvar', 'btn-enviar', 'btn-excluir', 'btn-cancelar', 'btn-encerrar']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-perm="compras\\.criar"`), id);
  }
  const versao = a => ler(a).match(/layout\.js\?v=(\d+)/)[1];
  assert.equal(versao('pedidos_compra.html'), versao('estoque.html'));
});
