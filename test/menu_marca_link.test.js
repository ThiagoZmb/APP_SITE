// Logo "Elegance" do menu lateral (layout.js): link para o Início (ou, sem acesso a ele, a primeira página do login).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// elemento falso que aceita qualquer chamada/propriedade (o layout só precisa não quebrar)
function falso(extra = {}) {
  const store = { ...extra };
  const f = new Proxy(function () {}, {
    get(_, p) {
      if (p in store) return store[p];
      if (p === Symbol.iterator) return function* () {};
      if (p === 'then') return undefined;
      return falso();
    },
    set(_, p, v) { store[p] = v; return true; },
    apply() { return falso(); }
  });
  return f;
}

function montarMenu({ permissoes, arquivo = 'estoque.html' }) {
  const guardadoLocal = new Map([['auth', JSON.stringify({ token: 't', user: { nome: 'V' }, exp: Date.now() + 1e6, acesso: { permissoes } })]]);
  const local = { getItem: k => (guardadoLocal.has(k) ? guardadoLocal.get(k) : null), setItem: (k, v) => guardadoLocal.set(k, String(v)), removeItem: k => guardadoLocal.delete(k) };
  const sessao = new Map();
  const session = { getItem: k => (sessao.has(k) ? sessao.get(k) : null), setItem: (k, v) => sessao.set(k, String(v)), removeItem: k => sessao.delete(k) };
  const nav = falso({ querySelectorAll: () => [], querySelector: () => falso(), removeAttribute() {}, classList: falso() });
  const container = falso({ querySelector: sel => (/nav|sidebar/.test(sel) ? nav : null), querySelectorAll: () => [] });
  const listeners = {};
  const document = falso({
    readyState: 'loading',
    querySelector: sel => (sel === '.container' ? container : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: (ev, fn) => { listeners[ev] = fn; }
  });
  const window = { fetch: () => new Promise(() => {}), localStorage: local, sessionStorage: session, location: { pathname: '/' + arquivo, href: '' }, addEventListener() {}, matchMedia: () => ({ matches: false }) };
  window.window = window;
  const ctx = vm.createContext({ window, document, localStorage: local, sessionStorage: session, location: window.location, fetch: () => new Promise(() => {}), MutationObserver: class { observe() {} }, console, setTimeout, clearTimeout, URL, Intl, Date, JSON, Promise, CustomEvent: class {}, XMLHttpRequest: class {}, navigator: {}, Map, Set, Array, Object, String, Number, RegExp, Math, Error, Symbol });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'layout.js'), 'utf8'), ctx);
  listeners.DOMContentLoaded && listeners.DOMContentLoaded();
  return { html: nav.innerHTML, window };
}

function linkDaMarca(html) {
  const m = html.match(/<a class="sb-marca"[^>]*>/);
  assert.ok(m, 'o bloco da marca é um <a class="sb-marca">');
  return m[0];
}

const href = a => a.match(/href="([^"]*)"/)[1];

test('logo do menu: Administrador vai para o Início, com rótulo acessível e caminho relativo', () => {
  const { html } = montarMenu({ permissoes: ['pedidos.ver', 'paineis.ver', 'estoque.ver'] });
  const a = linkDaMarca(html);
  assert.ok(a.includes('aria-label="Ir para o Início"'), a);
  assert.equal(href(a), 'inicio.html');
  assert.ok(!/^(\/|https?:)/.test(href(a)), 'caminho relativo (o site roda em /APP_SITE/)');
});

test('logo do menu: sem acesso ao Início cai na primeira página dele', () => {
  const p = ['pedidos.ver', 'estoque.ver'];
  const { html, window } = montarMenu({ permissoes: p });
  const a = linkDaMarca(html);
  assert.equal(href(a), 'painel_inicial.html');
  assert.equal(href(a), window.Acesso.primeiraPaginaDe({ permissoes: p }));
  assert.ok(a.includes('aria-label="Ir para a tela principal"'), a);
});

test('logo do menu: com modo atendimento ligado o Início (escondido) é pulado; sem o modo volta', () => {
  const { html, window } = montarMenu({ permissoes: ['paineis.ver', 'pedidos.ver', 'atendimento.modo'] });
  assert.equal(href(linkDaMarca(html)), 'painel_inicial.html');
  assert.equal(window.Acesso.paginaDaMarcaDe({ permissoes: ['paineis.ver', 'pedidos.ver'] }), 'inicio.html');
});

test('o destino do login não mudou (primeiraPaginaDe segue a ordem de PAGINAS)', () => {
  const { window } = montarMenu({ permissoes: [] });
  const p = ['paineis.ver', 'pedidos.ver', 'estoque.ver'];
  assert.equal(window.Acesso.primeiraPaginaDe({ permissoes: p }), 'painel_inicial.html');
  assert.equal(window.Acesso.paginaDaMarcaDe({ permissoes: p }), 'inicio.html');
  assert.equal(window.Acesso.primeiraPaginaDe({ permissoes: ['paineis.ver', 'estoque.ver'] }), 'inicio.html');
});
