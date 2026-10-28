// Modo atendimento (layout.js): quem tem atendimento.modo começa ligado, perde as telas gerais e pode desligar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function carregarLayout({ permissoes, sessao = {}, arquivo = 'painel_inicial.html' }) {
  const guarda = id => { const m = new Map(Object.entries(sessao)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
  const session = guarda(), local = guarda();
  local.m.set('auth', JSON.stringify({ token: 't', user: { nome: 'V' }, exp: Date.now() + 1e6, acesso: { permissoes } }));
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], style: {} });
  const document = { readyState: 'complete', body: el(), head: el(), documentElement: el(), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el, addEventListener() {} };
  const window = { document, localStorage: local, sessionStorage: session, location: { pathname: '/' + arquivo, href: '' }, fetch: () => new Promise(() => {}), addEventListener() {}, matchMedia: () => ({ matches: false }), indexedDB: undefined };
  window.window = window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'layout.js'), 'utf8'), { ...window, window, document, localStorage: local, sessionStorage: session, location: window.location, fetch: window.fetch, MutationObserver: class { observe() {} }, console, setTimeout, clearTimeout, URL, Intl, Date, JSON, Promise, CustomEvent: class {}, XMLHttpRequest: class {} });
  return { window, session };
}
const TODAS = ['paineis.ver', 'pedidos.ver', 'orcamentos.criar', 'valores.ver', 'financeiro.ver', 'precos.ver', 'gestao.ver', 'clientes.ver'];

test('com atendimento.modo: começa ligado, esconde Início/gráficos/Financeiro/Custos/Gestão e a primeira página é a de pedidos', () => {
  const { window } = carregarLayout({ permissoes: [...TODAS, 'atendimento.modo'] });
  assert.equal(window.Atendimento.ativo(), true);
  for (const p of ['inicio.html', 'graficos_pedidos.html', 'financeiro.html', 'custos.html', 'gestao.html']) assert.equal(window.Acesso.podePagina(p), false, p);
  for (const p of ['painel_inicial.html', 'orcamentos.html', 'clientes.html']) assert.equal(window.Acesso.podePagina(p), true, p);
  assert.equal(window.Acesso.primeiraPagina(), 'painel_inicial.html');
});

test('desligar o modo devolve as telas; ligar de novo esconde; cliente do atendimento fica guardado na sessão', () => {
  const { window } = carregarLayout({ permissoes: [...TODAS, 'atendimento.modo'] });
  window.Atendimento.alternar();
  assert.equal(window.Atendimento.ativo(), false);
  assert.equal(window.Acesso.podePagina('financeiro.html'), true);
  assert.equal(window.Acesso.primeiraPagina(), 'inicio.html');
  window.Atendimento.alternar();
  assert.equal(window.Atendimento.ativo(), true);
  window.Atendimento.definirCliente('  ACME LTDA ');
  assert.equal(window.Atendimento.cliente(), 'ACME LTDA');
  window.Atendimento.definirCliente('');
  assert.equal(window.Atendimento.cliente(), '');
});

test('sem atendimento.modo nada muda (Administrador)', () => {
  const { window } = carregarLayout({ permissoes: TODAS });
  assert.equal(window.Atendimento.disponivel(), false);
  assert.equal(window.Atendimento.ativo(), false);
  assert.equal(window.Acesso.podePagina('gestao.html'), true);
});

test('páginas: seções gerais marcadas, filtro de cliente travado e login recomeça no modo', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8');
  assert.equal((html.match(/so-geral/g) || []).length >= 7, true);
  assert.match(html, /atendimento\(\) \? \(cliente \? l\.filter/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'login.js'), 'utf8'), /removeItem\('atendimento'\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8'), /Atendimento\.definirCliente/);
});
