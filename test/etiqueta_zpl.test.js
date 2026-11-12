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

const linhaDe = (zpl, prefixo) => textos(zpl).filter(t => t.texto.startsWith(prefixo));
const todosTextos = zpl => [...zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+\^FD([^^]*)\^FS/g)].map(m => ({ x: +m[1], y: +m[2], h: +m[3], texto: m[4] }));
const filetes = zpl => [...zpl.matchAll(/\^FO(\d+),(\d+)\^GB(\d+),3,3\^FS/g)].map(m => ({ x: +m[1], y: +m[2], w: +m[3] }));
const ENORME = 'CONSTRUTORA E INCORPORADORA HORIZONTE NOVO LTDA COMERCIO DE ESQUADRIAS E SERRALHERIA DO ESPIRITO SANTO';

test('Nome e Cliente: SEMPRE uma linha só (nunca quebra); fonte cai até 36 e, se ainda não couber, trunca com "..."', () => {
  const curto = linhaDe(montarEtiquetas(PEDIDO([ITEM(1)])).zpl, 'Nome:');
  assert.equal(new Set(curto.map(t => t.texto)).size, 1);
  assert.equal(curto[0].altura, 52);

  // médio: cabe numa fonte menor, sem reticências
  const medio = 'CONSTRUTORA HORIZONTE LTDA';
  const m = linhaDe(montarEtiquetas(PEDIDO([ITEM(1)], { cliente: medio })).zpl, 'Nome:');
  assert.deepEqual([...new Set(m.map(t => t.texto))], ['Nome: ' + medio]);
  assert.ok(m[0].altura >= 36 && m[0].altura < 52);

  // gigante: uma única linha (duas passadas do negrito), altura 36, termina em "..." (três pontos, não "…")
  for (const campo of ['cliente', 'clienteFinal']) {
    const z = montarEtiquetas(PEDIDO([ITEM(1)], { [campo]: ENORME })).zpl;
    const rotulo = campo === 'cliente' ? 'Nome:' : 'Cliente:';
    const l = linhaDe(z, rotulo);
    assert.equal(l.length, 2, 'duas passadas do negrito = uma linha');
    assert.equal(new Set(l.map(t => t.texto)).size, 1);
    assert.equal(l[0].altura, 36);
    assert.ok(l[0].texto.endsWith('...') && !l[0].texto.includes('…'));
    assert.ok(l[0].texto.startsWith(rotulo + ' CONSTRUTORA'));
    assert.ok(l[0].texto.length * 0.6 * 36 <= 760);
    assert.ok(!unicos(z).some(t => t.includes('SERRALHERIA')), 'o resto do nome não vira outra linha');
  }
});

test('rótulos Nome, Cliente, Qtd e Destino ganham filete ^GB (espessura 3) logo abaixo da palavra, só no rótulo', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1, { QTD: '4' })], { uf: 'ES' }));
  const fs_ = filetes(zpl), ts = todosTextos(zpl);
  for (const rotulo of ['Nome:', 'Cliente:', 'Qtd:', 'Destino:']) {
    const t = ts.find(x => x.texto.startsWith(rotulo));
    assert.ok(t, rotulo);
    const f = fs_.find(x => x.x === t.x && x.y === t.y + t.h + 2);
    assert.ok(f, 'filete logo abaixo de ' + rotulo);
    assert.ok(f.w >= rotulo.length * 0.5 * t.h && f.w <= rotulo.length * 0.6 * t.h + 4, 'largura ~ a do rótulo: ' + f.w);
    assert.ok(f.w < t.texto.length * 0.6 * t.h, 'não cobre o valor');
  }
});

test('Pedido não tem filete; sem medidas nem destino há exatamente 3 filetes (Nome, Cliente, Qtd)', () => {
  assert.equal(filetes(montarEtiquetas(PEDIDO([ITEM(1)])).zpl).length, 3);
});

test('medidas ligadas viram "Medidas: ..." entre Cliente e Qtd; vazias não imprimem linha nem rótulo', () => {
  const com = montarEtiquetas(PEDIDO([ITEM(1, { MEDIDAS: '2287 × 706' })])).zpl;
  const ts = todosTextos(com);
  const y = rotulo => ts.find(t => t.texto.startsWith(rotulo)).y;
  assert.equal(ts.filter(t => t.texto === 'Medidas: 2287 × 706').length, 2);
  assert.ok(y('Cliente:') < y('Medidas:') && y('Medidas:') < y('Qtd:'));
  assert.equal(filetes(com).length, 4);
  for (const MEDIDAS of [undefined, '', '   ']) {
    const sem = montarEtiquetas(PEDIDO([ITEM(1, { MEDIDAS })])).zpl;
    assert.ok(!sem.includes('Medidas'));
    assert.equal(filetes(sem).length, 3);
  }
});

test('destino: "Destino: ES" embaixo à esquerda; UF do item vale mais que a geral; sem UF não imprime nada', () => {
  const geral = montarEtiquetas(PEDIDO([ITEM(1), ITEM(2, { UF: 'RJ' })], { uf: 'ES' })).zpl;
  assert.ok(blocos(geral)[0].includes('^FDDestino: ES^FS'));
  assert.ok(blocos(geral)[1].includes('^FDDestino: RJ^FS') && !blocos(geral)[1].includes('Destino: ES'));
  const d = todosTextos(blocos(geral)[0]).find(t => t.texto.startsWith('Destino:'));
  assert.equal(d.x, 20);
  assert.ok(d.y + d.h + 5 <= 480, 'filete incluído, cabe na etiqueta');
  assert.ok(!montarEtiquetas(PEDIDO([ITEM(1)])).zpl.includes('Destino'));
});

test('texto digitado (medidas/UF) também é saneado: nada de ^ ~ \ no ZPL', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1, { MEDIDAS: '12^XZ~DG\\34', UF: 'E^S' })]));
  assert.ok(zpl.includes('Medidas: 12XZDG34'));
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
  assert.ok(!zpl.includes('~DG'));
});

test('nenhum texto passa de 780 dots e nada invade o código de barras (x >= 500) nas linhas de baixo', () => {
  const z = montarEtiquetas(PEDIDO([ITEM(1, { QTD: '999', MEDIDAS: '9999,99 x 9999,99 mm - 99999 x 1' })], { cliente: ENORME, clienteFinal: ENORME, uf: 'MG', numero: '1234567890' })).zpl;
  for (const { x, y, h, texto } of todosTextos(z)) {
    if (texto.startsWith('Pedido')) continue;
    const fim = x + texto.length * 0.6 * h;
    assert.ok(fim <= 780, texto);
    if (y + h > 368) assert.ok(fim <= 490, 'não invade o código de barras: ' + texto);
  }
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
