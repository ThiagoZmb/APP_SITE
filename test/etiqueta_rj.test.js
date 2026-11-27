// Etiquetas "Rio de Janeiro": ZPL puro (par de etiquetas por volume) e validação dos campos digitados. Sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { montarEtiquetasRj, montarEtiquetas } = require('../calculo/etiqueta_zpl');
const { validarRj, RJ_MAX_VOLUMES, MAX_ETIQUETAS } = require('../calculo/etiqueta_edicao');
const { validarZpl } = require('../local/zebra');
const LOGO = require('../calculo/etiqueta_logo');

const BASE = { numero: '23425', cliente: 'ITAPLAN COMERCIO', clienteFinal: 'ALEX FABIANO', oc: 'OC-778', consultor: 'Marcos', nfe: '10234', volumes: 1 };
const rj = (extra = {}) => montarEtiquetasRj({ ...BASE, ...extra });
const blocos = zpl => zpl.split('^XZ').filter(b => b.includes('^XA'));
const textos = zpl => [...zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+\^FD([^^]*)\^FS/g)].map(m => ({ x: +m[1], y: +m[2], h: +m[3], texto: m[4] }));
const unicos = zpl => [...new Set(textos(zpl).map(t => t.texto))];
const filetes = zpl => [...zpl.matchAll(/\^FO(\d+),(\d+)\^GB(\d+),3,3\^FS/g)].map(m => ({ x: +m[1], y: +m[2], w: +m[3] }));

// desfaz a compactação ASCII do ^GFA usada aqui: "," completa a linha com zeros; ":" repete a linha anterior
function descompactar(dados, bytesPorLinha) {
  const n = bytesPorLinha * 2, linhas = [];
  let atual = '';
  for (const c of dados) {
    if (c === ':') linhas.push(linhas[linhas.length - 1]);
    else if (c === ',') { linhas.push(atual.padEnd(n, '0')); atual = ''; }
    else { atual += c; if (atual.length === n) { linhas.push(atual); atual = ''; } }
  }
  assert.equal(atual, '');
  return linhas.join('');
}

test('RJ: N volumes = N pares (etiqueta do pedido, etiqueta de destino), nessa ordem, 800x480 UTF-8', () => {
  const { zpl, quantidade } = rj({ volumes: 3 });
  assert.equal(quantidade, 6);
  const bs = blocos(zpl);
  assert.equal(bs.length, 6);
  for (const b of bs) for (const c of ['^XA^CI28^PW800^LL480', '^FO14,14^GB240,94,3,B,3^FS', '^FO22,20^GFA,']) assert.ok(b.includes(c), c);
  bs.forEach((b, i) => {
    if (i % 2 === 0) assert.ok(b.includes('Pedido: 23425') && !b.includes('Destino'), 'ímpar = pedido');
    else assert.ok(b.includes(`^FDVolume ${(i + 1) / 2}/3^FS`) && b.includes('Rio de Janeiro') && !b.includes('Pedido'), 'par = destino');
  });
});

test('RJ etiqueta 1: Pedido, Cliente (razão social), Cliente Final, OC, Consultor e Volumes totais', () => {
  const b = blocos(rj({ volumes: 4 }).zpl)[0];
  assert.deepEqual(unicos(b), ['Pedido: 23425', 'Cliente: ITAPLAN COMERCIO', 'Cliente Final: ALEX FABIANO', 'OC: OC-778', 'Consultor: Marcos', 'Volumes totais: 4']);
  assert.equal(filetes(b).length, 5, 'rótulos sublinhados; "Pedido:" não');
});

test('RJ etiqueta 2: Destino fixo, NFe e "Volume i/N" grande; Volume 1/1 com N = 1', () => {
  const b = blocos(rj().zpl)[1];
  assert.deepEqual(unicos(b), ['Destino: Rio de Janeiro', 'NFe: 10234', 'Volume 1/1']);
  assert.equal(filetes(b).length, 3);
  const vol = textos(b).find(t => t.texto === 'Volume 1/1');
  assert.ok(vol.h >= 80, 'grande e legível');
});

test('RJ: sem código de barras e sem dinheiro', () => {
  const { zpl } = rj({ volumes: 2 });
  assert.ok(!zpl.includes('^BC') && !zpl.includes('^BY') && !zpl.includes('R$'));
});

test('RJ: OC, Consultor e NFe vazios não imprimem linha nem filete; cliente final vazio vira —', () => {
  const [um, dois] = blocos(rj({ oc: '', consultor: '   ', nfe: undefined, clienteFinal: '' }).zpl);
  assert.deepEqual(unicos(um), ['Pedido: 23425', 'Cliente: ITAPLAN COMERCIO', 'Cliente Final: —', 'Volumes totais: 1']);
  assert.deepEqual(unicos(dois), ['Destino: Rio de Janeiro', 'Volume 1/1']);
  assert.equal(filetes(um).length, 3);
  assert.equal(filetes(dois).length, 2);
});

test('RJ: texto do banco e digitado é saneado (nada de ^ ~ \\ vira comando)', () => {
  const { zpl } = rj({ cliente: 'A^XZ~DG', oc: '1^XA', consultor: 'B\\^FS', nfe: '~JA' });
  assert.equal((zpl.match(/\^XZ/g) || []).length, 2);
  assert.equal((zpl.match(/\^XA/g) || []).length, 2);
  assert.ok(!zpl.includes('~'));
  assert.ok(zpl.includes('OC: 1XA') && zpl.includes('Consultor: B') && zpl.includes('NFe: JA'));
});

test('RJ: linha única; nada passa da largura nem da altura da etiqueta e as linhas não se sobrepõem', () => {
  const grande = 'W'.repeat(200);
  const { zpl } = rj({ numero: '1234567890', cliente: grande, clienteFinal: grande, oc: 'W'.repeat(30), consultor: 'W'.repeat(30), nfe: 'W'.repeat(20), volumes: 100 });
  for (const b of [blocos(zpl)[0], blocos(zpl)[199]]) {
    const ts = textos(b);
    for (const t of ts) {
      assert.equal(ts.filter(o => o.y === t.y).length, 2, 'uma linha só (duas passadas do negrito)');
      assert.ok(t.x + t.texto.length * 0.6 * t.h <= 782, t.texto);
      assert.ok(t.y + t.h + 5 <= 480, t.texto);
    }
    const ys = [...new Set(ts.map(t => t.y))].sort((a, z) => a - z);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i - 1] + ts.find(t => t.y === ys[i - 1]).h + 5 <= ys[i], 'sem sobreposição');
    assert.ok(ys.filter(y => y !== 30).every(y => y >= 108), 'abaixo da caixa do logo');
  }
  assert.ok(zpl.includes('^FDVolume 100/100^FS'));
});

test('RJ: o logo vai compactado, e descompactado é exatamente o mesmo bitmap da etiqueta de item', () => {
  const total = LOGO.bytesPorLinha * LOGO.altura;
  const m = new RegExp(`\\^GFA,${total},${total},${LOGO.bytesPorLinha},([0-9A-F,:]+)\\^FS`).exec(rj().zpl);
  assert.ok(m);
  assert.ok(m[1].length < LOGO.hex.length * 0.7);
  assert.equal(descompactar(m[1], LOGO.bytesPorLinha), LOGO.hex);
  // a etiqueta por item continua com o bitmap sem compactação
  assert.ok(montarEtiquetas({ numero: '1', cliente: 'a', clienteFinal: 'b', itens: [{ ITEM: '1' }] }).zpl.includes(LOGO.hex));
});

test('RJ: o caso máximo (100 volumes, textos no limite) cabe no limite do serviço local', () => {
  const grande = 'Ç'.repeat(200); // 2 bytes por caractere em UTF-8
  const { zpl, quantidade } = rj({ numero: '1234567890', cliente: grande, clienteFinal: grande, oc: 'Ç'.repeat(30), consultor: 'Ç'.repeat(30), nfe: 'Ç'.repeat(20), volumes: RJ_MAX_VOLUMES });
  assert.equal(quantidade, 200);
  assert.deepEqual(validarZpl(zpl), { ok: true });
  assert.ok(Buffer.byteLength(zpl, 'utf8') < 1024 * 1024);
});

test('validarRj: volumes inteiro de 1 a 100 (teto de 200 etiquetas); textos opcionais, saneados e com tamanho máximo', () => {
  assert.equal(RJ_MAX_VOLUMES * 2, MAX_ETIQUETAS);
  assert.deepEqual(validarRj({ volumes: 1 }), { ok: true, volumes: 1, oc: '', consultor: '', nfe: '' });
  assert.deepEqual(validarRj({ volumes: ' 100 ', oc: '  A ^ 1  ', consultor: null, nfe: '55' }), { ok: true, volumes: 100, oc: 'A 1', consultor: '', nfe: '55' });
  for (const volumes of [undefined, null, '', 0, 101, -1, 1.5, '1,5', 'abc', true, [2], {}]) {
    const v = validarRj({ volumes });
    assert.equal(v.ok, false, String(volumes));
    assert.match(v.erro, /Volumes totais.*1 a 100/);
  }
  for (const [campo, rotulo, max] of [['oc', 'OC', 30], ['consultor', 'Consultor', 30], ['nfe', 'NFe', 20]]) {
    assert.equal(validarRj({ volumes: 1, [campo]: 'x'.repeat(max) }).ok, true);
    assert.match(validarRj({ volumes: 1, [campo]: 'x'.repeat(max + 1) }).erro, new RegExp(`${rotulo}.*${max}`));
    assert.match(validarRj({ volumes: 1, [campo]: 12 }).erro, new RegExp(rotulo));
  }
  for (const corpo of [undefined, null, 'x', []]) assert.equal(validarRj(corpo).ok, false);
});
