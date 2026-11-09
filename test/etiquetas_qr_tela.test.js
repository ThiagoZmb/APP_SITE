// Página de etiquetas de QR (etiquetas_qr.html + etiquetas_qr.js): lógica pura e HTML estático.
// O desenho do QR e a impressão reais não são testáveis no Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../etiquetas_qr.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ITENS = [
  { codigo: 1, produto: 'Perfil 1036', unidade: 'BR', codBarras: 'ABC123' },
  { codigo: 2, produto: 'Vidro Incolor', unidade: 'M2', codBarras: 'XYZ999' },
  { codigo: 3, produto: 'Parafuso', unidade: 'UN', codBarras: 'PAR001' }
];

test('filtrarItens: por parte do nome ou do código, sem diferenciar caixa', () => {
  assert.deepEqual(E.filtrarItens(ITENS, 'perfil').map(i => i.codigo), [1]);
  assert.deepEqual(E.filtrarItens(ITENS, 'xyz').map(i => i.codigo), [2]);
  assert.deepEqual(E.filtrarItens(ITENS, '  VIDRO ').map(i => i.codigo), [2]);
  assert.equal(E.filtrarItens(ITENS, '').length, 3);
  assert.equal(E.filtrarItens(ITENS, 'nada').length, 0);
  assert.equal(E.filtrarItens(ITENS, undefined).length, 3);
});

test('dividirEmFolhas: 25 itens com 12 por folha = 12, 12 e 1', () => {
  const itens = Array.from({ length: 25 }, (_, i) => ({ codigo: i }));
  assert.deepEqual(E.dividirEmFolhas(itens, 12).map(f => f.length), [12, 12, 1]);
  assert.deepEqual(E.dividirEmFolhas(itens).map(f => f.length), [12, 12, 1]);
  assert.deepEqual(E.dividirEmFolhas([], 12), []);
});

test('textoDoQr devolve exatamente o código de barras', () => {
  assert.equal(E.textoDoQr(ITENS[0]), 'ABC123');
  assert.equal(E.textoDoQr({ codBarras: ' A B ' }), ' A B ');
});

test('HTML: CSP, biblioteca antes do script, tema por último, @media print, sem onclick', () => {
  const h = ler('etiquetas_qr.html');
  assert.match(h, /<meta http-equiv="Content-Security-Policy"/);
  const iLib = h.indexOf('vendor/qrcode.js'), iJs = h.indexOf('etiquetas_qr.js');
  assert.ok(iLib > 0 && iJs > iLib, 'qrcode.js antes de etiquetas_qr.js');
  assert.ok(h.indexOf('href="tema.css') > iJs, 'tema.css depois dos scripts');
  assert.match(h, /@media print/);
  assert.doesNotMatch(h, /\sonclick=/i);
  assert.doesNotMatch(ler('etiquetas_qr.js'), /innerHTML/);
  assert.ok(fs.statSync(path.join(__dirname, '..', 'vendor', 'qrcode.js')).size > 1000);
});

test('estoque.html tem o link para etiquetas_qr.html com data-perm estoque.editar', () => {
  assert.match(ler('estoque.html'), /<a[^>]*data-perm="estoque\.editar"[^>]*href="etiquetas_qr\.html"[^>]*>|<a[^>]*href="etiquetas_qr\.html"[^>]*data-perm="estoque\.editar"[^>]*>/);
});

// ---- desenho do QR (vendor/qrcode.js real e geradores falsos) ----
function noFalso(tag) {
  const n = {
    tag, attrs: {}, children: [], textContent: '', className: '',
    setAttribute(k, v) { n.attrs[k] = String(v); },
    appendChild(c) { n.children.push(c); return c; },
    cloneNode() {
      const c = noFalso(tag);
      c.attrs = { ...n.attrs }; c.textContent = n.textContent; c.className = n.className;
      c.children = n.children.map(x => x.cloneNode(true));
      return c;
    }
  };
  return n;
}
const docFalso = () => ({ createElementNS: (ns, tag) => noFalso(tag), createElement: tag => noFalso(tag) });
const contar = (no, tag) => (no.tag === tag ? 1 : 0) + no.children.reduce((a, c) => a + contar(c, tag), 0);

test('desenharQr com a biblioteca real: ABC123, EAN-13 e texto acentuado, em UTF-8 e com UM <path>', () => {
  const qrcode = require('../vendor/qrcode.js');
  for (const t of ['ABC123', '7891234567895', 'AÇÃO-é']) {
    const svg = E.desenharQr(docFalso(), qrcode, t);
    assert.equal(svg.tag, 'svg');
    assert.equal(contar(svg, 'path'), 1, 'um único path para todos os módulos');
    assert.ok(contar(svg, 'rect') <= 1, 'só o fundo pode ser rect');
  }
  // a codificação passou a ser UTF-8: 'é' = 2 bytes (com c & 0xff seria 1)
  assert.equal(qrcode.stringToBytes('é').length, 2);
  assert.equal(qrcode.stringToBytes('AÇÃO-é').length, 9);
});

function geradorFalso(falharEm) {
  const g = () => {
    g.chamadas++;
    return {
      addData(t) { if (t === falharEm) throw new Error('estourou'); },
      make() {}, getModuleCount: () => 3, isDark: (r, c) => (r + c) % 2 === 0
    };
  };
  g.chamadas = 0;
  g.stringToBytesFuncs = { 'UTF-8': s => Array.from(Buffer.from(s, 'utf8')) };
  return g;
}

test('criarFabricaQr: cache por código (o gerador roda uma vez) e cada etiqueta recebe um clone', () => {
  const g = geradorFalso();
  const fab = E.criarFabricaQr(docFalso(), g);
  const a = fab('ABC123'), b = fab('ABC123'), c = fab('XYZ999');
  assert.equal(g.chamadas, 2);
  assert.notEqual(a, b, 'clones distintos para poder entrar em etiquetas diferentes');
  assert.equal(contar(a, 'path'), 1);
  assert.equal(contar(b, 'path'), 1);
  assert.equal(c.tag, 'svg');
});

test('criarFabricaQr: um item cujo gerador lança vira "QR indisponível" e os outros seguem desenhados', () => {
  const g = geradorFalso('RUIM');
  const fab = E.criarFabricaQr(docFalso(), g);
  const ruim = fab('RUIM'), bom = fab('BOM');
  assert.equal(ruim.textContent, 'QR indisponível');
  assert.equal(bom.tag, 'svg');
});

test('iniciar: página não liberada não chama a API nem mexe na tela', () => {
  let chamadas = 0;
  const win = {
    Acesso: { paginaLiberada: () => false },
    document: { getElementById() { throw new Error('não deveria mexer na tela'); } },
    fetch() { chamadas++; return Promise.resolve({}); }
  };
  E.iniciar(win);
  assert.equal(chamadas, 0);
});

test('a busca redesenha só a lista: desenharLista não chama desenharFolhas', () => {
  const src = ler('etiquetas_qr.js');
  const corpo = src.slice(src.indexOf("$('vazio').hidden"), src.indexOf('function desenharFolhas'));   // fim de desenharLista (o clique na caixa chama desenharFolhas de propósito)
  assert.ok(corpo.length > 50);
  assert.doesNotMatch(corpo, /desenharFolhas\(/);
});
