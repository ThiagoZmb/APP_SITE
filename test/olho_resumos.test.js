'use strict';
// Olho dos resumos (olho_resumos.js + regras em tema.css): lógica pura e conferência do HTML das páginas.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Olho = require('../olho_resumos.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('o olho só aparece se algum resumo é permitido ao usuário', () => {
  assert.equal(Olho.algumResumoPermitido([], false), false);
  assert.equal(Olho.algumResumoPermitido(undefined, false), false);
  assert.equal(Olho.algumResumoPermitido([{ oculto: true, soGeral: false }], false), false, 'data-perm negado pelo layout.js');
  assert.equal(Olho.algumResumoPermitido([{ oculto: true }, { oculto: false }], false), true);
  assert.equal(Olho.algumResumoPermitido([{ oculto: false, soGeral: true }], true), false, 'modo atendimento esconde o so-geral');
  assert.equal(Olho.algumResumoPermitido([{ oculto: false, soGeral: true }], false), true);
  assert.equal(Olho.algumResumoPermitido([{ oculto: false, soGeral: true }, { oculto: false, soGeral: false }], true), true);
});

test('estado inicia escondido e a escolha não é lembrada (cada criação recomeça escondida)', () => {
  const a = Olho.criarEstado();
  assert.equal(a.visivel(), false);
  a.definir(true);
  assert.equal(a.visivel(), true);
  assert.equal(Olho.criarEstado().visivel(), false);
});

test('escondido: adiar anota a busca e devolve true; ao mostrar a busca roda uma vez só', () => {
  const e = Olho.criarEstado();
  let n = 0;
  const busca = () => { n++; };
  assert.equal(e.adiar(busca), true);
  assert.equal(e.adiar(busca), true, 'chamadas repetidas não duplicam');
  assert.equal(e.qtdPendentes(), 1);
  assert.equal(n, 0, 'nada roda enquanto escondido');
  const lista = e.definir(true);
  assert.deepEqual(lista, [busca]);
  assert.equal(e.qtdPendentes(), 0);
  assert.equal(e.definir(false).length, 0);
  assert.equal(e.definir(true).length, 0, 'esconder e mostrar de novo não refaz a busca sem pedido novo');
});

test('visível: adiar devolve false (a tela busca na hora, como antes)', () => {
  const e = Olho.criarEstado();
  e.definir(true);
  assert.equal(e.adiar(() => {}), false);
  assert.equal(e.qtdPendentes(), 0);
});

test('adiar ignora o que não é função', () => {
  const e = Olho.criarEstado();
  assert.equal(e.adiar(null), true);
  assert.equal(e.qtdPendentes(), 0);
});

test('tema.css: resumos escondidos por padrão e botão com alvo de toque', () => {
  const css = ler('tema.css');
  assert.match(css, /body:not\(\.resumos-on\) \[data-resumo\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.olho-resumos\[aria-pressed="true"\] \.olho-ico-off/);
  assert.match(css, /pointer:\s*coarse\)[^}]*min-height:\s*44px/);
  const bloco = css.slice(css.indexOf('OLHO DOS RESUMOS'));
  assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,6}\b/, 'só variáveis do tema, sem hexadecimal solto');
});

test('olho_resumos.js: sem inline, sem armazenamento e com o rótulo acessível', () => {
  const js = ler('olho_resumos.js');
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|document\.cookie/, 'decisão do dono: não persistir a escolha');
  assert.match(js, /aria-pressed/);
  assert.match(js, /Mostrar resumos/);
  assert.match(js, /Ocultar resumos/);
  assert.doesNotMatch(js, /\beval\(|new Function|\.innerHTML\s*=\s*[^'A-Z]*\+\s*\w+\s*\+\s*['"]<\//);
});

const PAGINAS = ['painel_inicial', 'inicio', 'financeiro', 'estoque', 'produtos', 'cliente_analise', 'gestao'];
for (const p of PAGINAS) {
  test(`${p}.html: carrega olho_resumos.js antes dos scripts, tem data-resumo e a CSP deixa o script próprio`, () => {
    const h = ler(`${p}.html`);
    assert.match(h, /<script src="olho_resumos\.js\?v=\d+"><\/script>/, 'sem defer: OlhoResumos existe antes do script da página');
    assert.ok(h.includes('data-resumo'));
    assert.ok(h.indexOf('olho_resumos.js') < h.indexOf('</head>'));
    const csp = (h.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    assert.match(csp, /script-src 'self'/);
    // nenhum resumo ficou visível por padrão por engano: todo data-resumo está num elemento de abertura (não é texto solto)
    for (const m of h.matchAll(/<[a-z0-9]+[^>]*\bdata-resumo\b[^>]*>/g)) assert.doesNotMatch(m[0], /\bstyle="[^"]*display\s*:\s*(block|grid|flex)/);
  });
}

test('páginas com busca separada dos resumos adiam a carga quando escondidos', () => {
  assert.match(ler('painel_inicial.html'), /OlhoResumos\.adiar\(carregarIndicadores\)/);
  assert.match(ler('financeiro.html'), /OlhoResumos\.adiar\(carregarResumo\)/);
  assert.match(ler('inicio.html'), /OlhoResumos\.adiar\(carregarFinanceiroMes\)/);
});

test('permissões continuam nos mesmos elementos (olho não as substitui)', () => {
  const pi = ler('painel_inicial.html');
  assert.equal([...pi.matchAll(/data-resumo data-perm="indicadores\.ver"/g)].length, 3);
  assert.match(ler('estoque.html'), /data-perm="administrativo\.ver" data-resumo/);
  assert.match(ler('inicio.html'), /data-resumo data-perm="pedidos\.ver"/);
  assert.match(ler('inicio.html'), /data-resumo data-perm="financeiro\.ver valores\.ver"/);
});

test('tema.css e todas as páginas internas usam a mesma versão do tema', () => {
  const versoes = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, '..')).filter(x => x.endsWith('.html'))) {
    const m = ler(f).match(/tema\.css\?v=(\d+)/);
    if (m) versoes.add(m[1]);
  }
  assert.equal(versoes.size, 1, [...versoes].join(','));
});
