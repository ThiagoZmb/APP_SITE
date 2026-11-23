// Página "Livro de regras" (somente leitura): conferência estática do HTML, do menu e do script
// (a tela no navegador real não tem teste automático) e a lógica pura de rótulos.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const semComentarios = js => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('regras.html: CSP, viewport, tema.css por último, sem script nem estilo inline', () => {
  const h = ler('regras.html');
  assert.match(h, /Content-Security-Policy/);
  assert.match(h, /connect-src 'self' https:\/\/elegance-backend-hrho\.onrender\.com/);
  assert.match(h, /name="viewport"/);
  assert.ok(h.includes('<script src="layout.js'));
  assert.ok(h.includes('<script src="entregas_comum.js'));
  assert.ok(h.includes('<script src="regras.js'));
  assert.ok(h.includes('<h1 class="welcome-title">Livro de regras</h1>'));
  for (const id of ['regras-corpo', 'limites', 'toasts']) assert.ok(h.includes(`id="${id}"`), id);
  // tema.css é o último stylesheet
  const folhas = [...h.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m => m[1]);
  assert.equal(folhas[folhas.length - 1], 'tema.css');
  assert.ok(folhas.includes('regras.css'));
  // sem estilo inline, sem handlers inline, sem script inline
  assert.doesNotMatch(h, /<style[\s>]/);
  assert.doesNotMatch(h, /\sstyle=/);
  assert.doesNotMatch(h, /\son[a-z]+=/);
  assert.doesNotMatch(h, /<script(?![^>]*\bsrc=)[^>]*>/);
  // leitura apenas: nada que grave
  assert.doesNotMatch(h, /<form|<button/);
  // tabela dentro do quadro com rolagem (cabeçalho fixo pelo tema.css)
  assert.match(h, /class="[^"]*\btabela-wrap\b/);
});

test('layout.js: Livro de regras no menu (subitem de Usuários) e em PAGINAS com administrativo.ver', () => {
  const l = ler('layout.js');
  assert.equal((l.match(/'regras\.html': \['administrativo\.ver'\]/g) || []).length, 1);
  assert.equal((l.match(/href: 'regras\.html', texto: 'Livro de regras'/g) || []).length, 1);
  assert.match(l, /href: 'regras\.html'[^}]*sub: true/);
  assert.ok(l.indexOf("href: 'regras.html'") > l.indexOf("href: 'usuarios.html'"));
});

test('regras.js: compila, chama /regras/livro e só usa textContent/esc para dados do servidor', () => {
  const js = ler('regras.js');
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'regras.js' }));
  const codigo = semComentarios(js);
  assert.match(codigo, /\/regras\/livro/);
  assert.doesNotMatch(codigo, /method:\s*'(PUT|POST|DELETE)'|metodo:\s*'(PUT|POST|DELETE)'/);
  assert.doesNotMatch(codigo, /localStorage\.setItem|eval\(/);
});

test('regras.js: rótulos de nível e escopo, linhas e limites', () => {
  process.env.NODE_ENV = 'test';
  const R = require('../regras.js');
  assert.equal(R.rotuloNivel('bloqueia').texto, 'Bloqueia');
  assert.equal(R.rotuloNivel('confirma').texto, 'Pergunta');
  assert.equal(R.rotuloNivel('avisa').texto, 'Avisa');
  assert.equal(R.rotuloNivel('bloqueia').classe, 'perigo');
  assert.equal(R.rotuloNivel('confirma').classe, 'aviso');
  assert.equal(R.rotuloNivel('avisa').classe, 'info');
  assert.equal(R.rotuloNivel('xyz').texto, 'xyz');   // desconhecido aparece como veio, nunca some
  assert.equal(R.rotuloEscopo('item'), 'Item');
  assert.equal(R.rotuloEscopo('documento'), 'Documento');
  const linhas = R.linhasDaTabela([{ codigo: 'a', nivel: 'avisa', escopo: 'item', titulo: 'T' }]);
  assert.deepEqual(linhas, [{ codigo: 'a', nivel: { texto: 'Avisa', classe: 'info' }, escopo: 'Item', titulo: 'T' }]);
  assert.deepEqual(R.linhasDaTabela(null), []);
  const lim = R.textosLimites({ portaMedidaAlertaMm: 300, puxadorEmbutidoMinMm: 40, puxadorEmbutidoMaxMm: 120 });
  assert.equal(lim.length, 3);
  assert.equal(lim[0], 'Porta com menos de 300 mm gera aviso');
  assert.match(lim[1], /40 mm/);
  assert.match(lim[2], /120 mm/);
  assert.deepEqual(R.textosLimites(null), []);
  assert.deepEqual(R.textosLimites({ portaMedidaAlertaMm: 'x' }), []);
});
