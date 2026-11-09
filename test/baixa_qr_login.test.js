// Baixa de estoque por QR: destino do login do Estoquista e itens de menu/páginas em layout.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// layout.js real, num contexto simulado
function carregarLayout() {
  const ctx = {
    window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { pathname: '/x.html' }, fetch: async () => ({}), URL, console, setTimeout, clearTimeout,
    document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } }
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(ler('layout.js'), ctx);
  return ctx;
}

test('Estoquista (estoque.ver + estoque.movimentar, só isso) entra na baixa por QR', () => {
  const { Acesso } = carregarLayout();
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['estoque.ver', 'estoque.movimentar'] }), 'baixa_qr.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['estoque.movimentar', 'estoque.ver'] }), 'baixa_qr.html');
});

test('qualquer permissão a mais ou a menos mantém o comportamento de sempre', () => {
  const { Acesso } = carregarLayout();
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['estoque.ver'] }), 'estoque.html');
  assert.notEqual(Acesso.primeiraPaginaDe({ permissoes: ['estoque.movimentar'] }), 'baixa_qr.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['estoque.movimentar'] }), null);
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['estoque.ver', 'estoque.movimentar', 'pedidos.ver'] }), 'painel_inicial.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['estoque.ver', 'estoque.movimentar', 'entregas.baixar'] }), 'estoque.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: [] }), null);
});

test('PAGINAS: páginas novas com as permissões e minhas_entregas.html continua a última', () => {
  const { ACESSO_PAGINAS } = carregarLayout();
  assert.deepEqual([...ACESSO_PAGINAS['baixa_qr.html']], ['estoque.ver', 'estoque.movimentar']);
  assert.deepEqual([...ACESSO_PAGINAS['etiquetas_qr.html']], ['estoque.ver', 'estoque.editar']);
  assert.equal(Object.keys(ACESSO_PAGINAS).pop(), 'minhas_entregas.html');
});

test('MENU: subitens do Estoque', () => {
  const l = ler('layout.js');
  assert.match(l, /\{ href: 'baixa_qr\.html', texto: 'Baixa por QR', icone: 'estoque', sub: true \}/);
  assert.match(l, /\{ href: 'etiquetas_qr\.html', texto: 'Etiquetas de QR', icone: 'estoque', sub: true \}/);
});
