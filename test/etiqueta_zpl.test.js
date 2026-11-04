// ZPL puro da etiqueta de pedido/produção (100 x 60 mm, Zebra). Sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanearZpl, medidasDoItem, montarEtiquetas } = require('../calculo/etiqueta_zpl');

const ITEM = (n, extra = {}) => ({ ITEM: String(n), QTD: '1', descricao: 'Porta de giro', v4: [{ ALTURA: '2100', LARGURA: '900' }], ...extra });
const PEDIDO = (itens, extra = {}) => ({ numero: '23425', cliente: 'Fulano Ltda', dataEntrega: '10/11/2026', itens, ...extra });
const blocos = zpl => zpl.split('^XZ').filter(b => b.includes('^XA'));

test('sanearZpl remove ^ ~ \\ e troca controle por espaço', () => {
  assert.equal(sanearZpl('A^B~C\\D\n'), 'ABCD ');
  assert.equal(sanearZpl(null), '');
});

test('medidasDoItem junta as folhas e usa — quando falta medida', () => {
  assert.equal(medidasDoItem([{ ALTURA: '2100', LARGURA: '900' }, { ALTURA: '2100', LARGURA: '800' }]), '2100x900 | 2100x800');
  assert.equal(medidasDoItem([]), '—');
  assert.equal(medidasDoItem([{ ALTURA: '', LARGURA: '900' }]), '—');
});

test('montarEtiquetas gera uma etiqueta por item com o layout 100x60', () => {
  const { zpl, quantidade } = montarEtiquetas(PEDIDO([ITEM(1), ITEM(2), ITEM(3)]));
  assert.equal(quantidade, 3);
  assert.equal((zpl.match(/\^XA/g) || []).length, 3);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 3);
  for (const b of blocos(zpl)) {
    for (const c of ['^PW800', '^LL480', '^CI28', '^BC', '23425']) assert.ok(b.includes(c), c);
  }
  assert.ok(blocos(zpl)[1].includes('Item 2 (2/3)'));
});

test('cliente malicioso não injeta comando e mantém acentos', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1)], { cliente: 'Ação ^XZ~DG' }));
  assert.ok(zpl.includes('Ação '));
  assert.ok(!zpl.includes('~DG'));
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
});

test('descrição enorme é truncada', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1, { descricao: 'x'.repeat(5000) })]));
  assert.ok(zpl.length < 2000, String(zpl.length));
});

test('sem dinheiro e sem medida vira —', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1, { v4: [] })]));
  assert.ok(!zpl.includes('R$'));
  assert.ok(zpl.includes('Medidas: —'));
});

test('descrição cabe no bloco de 5 linhas: no máximo 240 caracteres, terminando em …', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1, { descricao: 'x'.repeat(5000) })]));
  const marca = '^FB760,5,4,L,0^FD';
  const ini = zpl.indexOf(marca) + marca.length;
  const desc = zpl.slice(ini, zpl.indexOf('^FS', ini));
  assert.ok(desc.length <= 240, String(desc.length));
  assert.ok(desc.endsWith('…'));
});

test('o número do item é o ITEM do pedido, mesmo com buraco na numeração', () => {
  const { zpl } = montarEtiquetas(PEDIDO([ITEM(1), ITEM(3)]));
  assert.ok(blocos(zpl)[1].includes('Item 3 (2/2)'));
});
