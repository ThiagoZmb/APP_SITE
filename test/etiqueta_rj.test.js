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
const textos = zpl => [...zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),(\d+)\^FD([^^]*)\^FS/g)].map(m => ({ x: +m[1], y: +m[2], h: +m[3], w: +m[4], texto: m[5] }));
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

test('RJ: nada passa da largura nem da altura da etiqueta e as linhas não se sobrepõem', () => {
  const grande = 'W'.repeat(200);
  const { zpl } = rj({ numero: '1234567890', cliente: grande, clienteFinal: grande, oc: 'W'.repeat(30), consultor: 'W'.repeat(30), nfe: 'W'.repeat(20), volumes: 100 });
  for (const b of [blocos(zpl)[0], blocos(zpl)[199]]) {
    const ts = textos(b);
    for (const t of ts) {
      assert.equal(ts.filter(o => o.y === t.y).length, 2, 'um texto por linha (duas passadas do negrito)');
      assert.ok(t.x + t.texto.length * 0.6 * t.w <= 782, t.texto);
      assert.ok(t.y + t.h + 5 <= 480, t.texto);
    }
    const ys = [...new Set(ts.map(t => t.y))].sort((a, z) => a - z);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i - 1] + ts.find(t => t.y === ys[i - 1]).h + 5 <= ys[i], 'sem sobreposição');
    assert.ok(ys.filter(y => y !== 30).every(y => y >= 108), 'abaixo da caixa do logo');
  }
  assert.ok(zpl.includes('^FDVolume 100/100^FS'));
});

// ---------- nomes sempre completos (Cliente e Cliente Final) ----------
// linhas impressas de um campo: do rótulo até o próximo campo, sem repetir a passada do negrito
function campo(bloco, rotulo, proximo) {
  const ts = textos(bloco).filter((t, i) => i % 2 === 0);
  const ini = ts.findIndex(t => t.texto.startsWith(rotulo));
  const fim = ts.findIndex(t => t.texto.startsWith(proximo));
  assert.ok(ini >= 0 && fim > ini, rotulo);
  return ts.slice(ini, fim);
}
const semEspacos = s => s.replace(/ /g, '');
function conferirEtiqueta1(cliente, clienteFinal) {
  const b = blocos(rj({ cliente, clienteFinal }).zpl)[0];
  assert.ok(!b.includes('...'), 'nunca reticências');
  for (const [rotulo, proximo, valor] of [['Cliente:', 'Cliente Final:', cliente], ['Cliente Final:', 'OC:', clienteFinal]]) {
    const ls = campo(b, rotulo, proximo);
    assert.ok(ls.length <= 2, 'no máximo duas linhas');
    assert.ok(ls[0].texto.startsWith(rotulo + ' '));
    assert.equal(semEspacos(ls.map(l => l.texto).join(' ')), semEspacos(`${rotulo} ${valor}`), 'nome completo');
    assert.equal(new Set(ls.map(l => `${l.h},${l.w}`)).size, 1, 'mesma fonte nas duas linhas');
    const filete = filetes(b).find(f => f.y === ls[0].y + ls[0].h + 2);
    assert.ok(filete && filete.w <= rotulo.length * 0.6 * ls[0].w, 'rótulo sublinhado na linha 1');
    if (ls[1]) assert.ok(!filetes(b).some(f => f.y === ls[1].y + ls[1].h + 2));
  }
  for (const t of textos(b)) assert.ok(t.x + t.texto.length * 0.6 * t.w <= 782, 'cabe na largura: ' + t.texto);
  const caixas = [
    ...textos(b).filter((t, i) => i % 2 === 0 && t.y !== 30).map(t => [t.y, t.y + t.h]),
    ...filetes(b).map(f => [f.y, f.y + 3])
  ].sort((a, z) => a[0] - z[0]);
  assert.ok(caixas[0][0] >= 108, 'abaixo do logo');
  for (let i = 1; i < caixas.length; i++) assert.ok(caixas[i - 1][1] <= caixas[i][0], `sem sobreposição em y ${caixas[i][0]}`);
  assert.ok(caixas[caixas.length - 1][1] < 480);
  return b;
}

test('RJ: nome que não cabe numa linha vai para duas, quebrando entre palavras', () => {
  const nome = 'Thiago Fernandes de Oliveira Esquadrias Ltda';
  const b = conferirEtiqueta1(nome, nome);
  for (const [rotulo, proximo] of [['Cliente:', 'Cliente Final:'], ['Cliente Final:', 'OC:']]) {
    const ls = campo(b, rotulo, proximo);
    assert.equal(ls.length, 2);
    assert.ok(ls[0].h >= 36 && ls[0].w === ls[0].h, 'sem condensar');
    assert.equal(ls.map(l => l.texto).join(' '), `${rotulo} ${nome}`, 'nenhuma palavra partida');
  }
});

test('RJ: nomes muito longos (até 255 caracteres) saem completos, condensados na largura', () => {
  for (const tamanho of [100, 150, 200, 255]) {
    const nome = 'Construtora Incorporadora Participacoes '.repeat(10).slice(0, tamanho).trim();
    const b = conferirEtiqueta1(nome, nome);
    const l = campo(b, 'Cliente:', 'Cliente Final:')[0];
    assert.ok(l.h === 36 || l.h === 40);
    if (tamanho >= 100) assert.ok(l.h === 36 && l.w < 36, 'condensado');
  }
});

test('RJ: palavra maior que a linha é partida sem perder caracteres', () => {
  conferirEtiqueta1('X'.repeat(60), 'Ana ' + 'Y'.repeat(190));
  conferirEtiqueta1('W'.repeat(200), 'W'.repeat(200));
});

test('RJ: posições fixas; os campos de baixo não mudam com o tamanho do nome', () => {
  const longo = 'Nome Muito Comprido '.repeat(9).trim();
  const ys = b => textos(b).filter(t => /^(Cliente:|Cliente Final:|OC:|Consultor:|Volumes)/.test(t.texto)).map(t => t.y);
  assert.deepEqual(ys(blocos(rj().zpl)[0]), ys(blocos(rj({ cliente: longo, clienteFinal: longo }).zpl)[0]));
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
  const grande = 'Ç'.repeat(255); // 2 bytes por caractere em UTF-8; 255 = teto do cadastro
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

test('Consultor sai sempre inteiro, mesmo no limite de 30 caracteres (nunca "...")', () => {
  const consultor = 'Maria Aparecida dos Santos Lim'; // 30
  const { zpl } = rj({ consultor });
  assert.ok(unicos(zpl).includes('Consultor: ' + consultor));
  assert.ok(!unicos(zpl).some(t => t.includes('...')));
});
