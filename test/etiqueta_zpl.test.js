// ZPL puro da etiqueta de pedido/produção (100 x 60 mm, Zebra). Sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanearZpl, montarEtiquetas } = require('../calculo/etiqueta_zpl');
const LOGO = require('../calculo/etiqueta_logo');

const ITEM = (n, extra = {}) => ({ ITEM: String(n), QTD: '1', ...extra });
const PEDIDO = (itens, extra = {}) => ({ numero: '23254', cliente: 'ITAPLAN COMERCIO', clienteFinal: 'ALEX FABIANO', itens, ...extra });
const blocos = zpl => zpl.split('^XZ').filter(b => b.includes('^XA'));
// textos impressos (^FD...^FS) sem o bitmap do logo
const textos = zpl => [...zpl.matchAll(/\^A0N,(\d+),\d+\^FD([^^]*)\^FS/g)].map(m => ({ altura: +m[1], texto: m[2] }));
const unicos = zpl => [...new Set(textos(zpl).map(t => t.texto))];

test('sanearZpl remove ^ ~ \\ e troca controle por espaço', () => {
  assert.equal(sanearZpl('A^B~C\\D\n'), 'ABCD ');
  assert.equal(sanearZpl(null), '');
});

test('uma etiqueta por item, em 800x480 dots (203 dpi) com UTF-8', () => {
  const { zpl, quantidade } = montarEtiquetas(PEDIDO([ITEM(1), ITEM(2), ITEM(3)]));
  assert.equal(quantidade, 3);
  assert.equal((zpl.match(/\^XA/g) || []).length, 3);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 3);
  for (const b of blocos(zpl)) for (const c of ['^PW800', '^LL480', '^CI28', '^BC', '^GFA']) assert.ok(b.includes(c), c);
});

test('layout: Pedido, Nome (razão social), Cliente (cliente final) e Qtd do item', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1, { QTD: '4' })]));
  assert.deepEqual(unicos(zpl), ['Pedido: 23254', 'Nome: ITAPLAN COMERCIO', 'Cliente: ALEX FABIANO', 'Qtd: 4']);
  assert.ok(!zpl.includes('Item '), 'não imprime mais "Item n"');
});

test('o Qtd é o de cada item', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1, { QTD: '2' }), ITEM(2, { QTD: '7' })]));
  assert.ok(blocos(zpl)[0].includes('Qtd: 2'));
  assert.ok(blocos(zpl)[1].includes('Qtd: 7'));
});

test('negrito: cada linha de texto sai duas vezes, deslocada 2 dots', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1)]));
  assert.ok(zpl.includes('^FO20,120^A0N,52,52^FDNome: ITAPLAN COMERCIO^FS'));
  assert.ok(zpl.includes('^FO22,120^A0N,52,52^FDNome: ITAPLAN COMERCIO^FS'));
});

test('sem endereço nem telefone da Elegance', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1)]));
  for (const proibido of ['Joventina', 'Marilândia', 'Marilandia', 'Vila Velha', '3326', 'Tel:']) assert.ok(!zpl.includes(proibido), proibido);
});

test('código de barras Code 128 do número do pedido, dentro da etiqueta e sem cobrir texto', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1)]));
  const m = zpl.match(/\^FO(\d+),(\d+)\^BY(\d+),\d+,\d+\^BCN,(\d+),N,N,N,A\^FD23254\^FS/);
  assert.ok(m, 'código de barras');
  const [x, y, modulo, altura] = m.slice(1).map(Number);
  assert.ok(modulo >= 2, 'módulo mínimo legível');
  assert.ok(altura >= 60);
  assert.ok(x >= 400 && x + 79 * modulo <= 800 - 10 * modulo, 'cabe à direita com zona de silêncio');
  assert.ok(y + altura <= 480);
  // pedido de 10 dígitos também cabe
  const g = montarEtiquetas(PEDIDO([ITEM(1)], { numero: '1234567890' })).zpl.match(/\^FO(\d+),\d+\^BY(\d+)/);
  assert.ok(+g[1] + 100 * +g[2] <= 800);
});

test('o logo vai como gráfico ^GFA 1-bit gerado do PNG, dentro de uma caixa arredondada', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1)]));
  const total = LOGO.bytesPorLinha * LOGO.altura;
  assert.equal(LOGO.hex.length, total * 2);
  assert.match(LOGO.hex, /^[0-9A-F]+$/);
  assert.ok(zpl.includes(`^GFA,${total},${total},${LOGO.bytesPorLinha},${LOGO.hex}^FS`));
  assert.equal(LOGO.largura, 224); // 28 mm
  assert.ok(/\^GB\d+,\d+,\d+,B,\d\^FS/.test(zpl));
  assert.ok(LOGO.hex.replace(/0/g, '').length > 100, 'o bitmap não está vazio');
});

test('cliente malicioso não injeta comando e mantém acentos', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1)], { cliente: 'Ação ^XZ~DG', clienteFinal: 'José\\^FS' }));
  assert.ok(zpl.includes('Nome: Ação XZDG'));
  assert.ok(zpl.includes('Cliente: José'));
  assert.ok(!zpl.includes('~DG'));
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
});

test('cliente final vazio ou ausente vira —', () => {
  for (const clienteFinal of ['', '   ', null, undefined]) {
    const { zpl } = montarEtiquetas(PEDIDO([ITEM(1)], { clienteFinal }));
    assert.ok(zpl.includes('Cliente: —'));
  }
});

test('nome curto cabe numa linha; nome longo quebra em até 2 linhas menores; enorme é truncado com …', () => {
  const curto = textos(montarEtiquetas(PEDIDO([ITEM(1)])).zpl).filter(t => t.texto.startsWith('Nome'));
  assert.equal(new Set(curto.map(t => t.texto)).size, 1);

  const longo = 'CONSTRUTORA E INCORPORADORA HORIZONTE NOVO LTDA';
  const l = textos(montarEtiquetas(PEDIDO([ITEM(1)], { cliente: longo })).zpl).filter(t => t.altura <= 52 && t.altura >= 36 && /^(Nome|CONSTRUTORA|HORIZONTE|[A-Z ]+$)/.test(t.texto));
  const linhas = [...new Set(l.map(t => t.texto))].filter(t => !t.startsWith('Cliente') && !t.startsWith('Pedido') && !t.startsWith('Qtd'));
  assert.equal(linhas.length, 2, linhas.join(' / '));
  assert.equal(linhas.join(' ').replace(/\s+/g, ' '), 'Nome: ' + longo);

  const enorme = montarEtiquetas(PEDIDO([ITEM(1)], { cliente: 'PALAVRA '.repeat(40) })).zpl;
  const texto = unicos(enorme).filter(t => !/^(Pedido|Cliente|Qtd)/.test(t));
  assert.ok(texto.length <= 2);
  assert.ok(texto[texto.length - 1].endsWith('…'));
});

test('nenhum texto passa da largura estimada de 760 dots', () => {
  for (const cliente of ['A', 'ITAPLAN COMERCIO', 'X'.repeat(200), 'CONSTRUTORA E INCORPORADORA HORIZONTE NOVO LTDA']) {
    for (const t of textos(montarEtiquetas(PEDIDO([ITEM(1)], { cliente, clienteFinal: cliente })).zpl)) {
      if (t.texto.startsWith('Pedido') || t.texto.startsWith('Qtd')) continue;
      assert.ok(t.texto.length * 0.6 * t.altura <= 760, `${t.texto.length} x ${t.altura}`);
    }
  }
});

test('Qtd longo é truncado e nunca fica vazio', () => {
  assert.ok(unicos(montarEtiquetas(PEDIDO([ITEM(1, { QTD: '' })])).zpl).includes('Qtd: 1'));
  assert.ok(unicos(montarEtiquetas(PEDIDO([ITEM(1, { QTD: '9'.repeat(40) })])).zpl).some(t => t.startsWith('Qtd: ') && t.length <= 5 + 12));
});

test('sem dinheiro', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1)]));
  assert.ok(!zpl.includes('R$'));
});
