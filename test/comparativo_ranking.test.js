const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../comparativo_ranking.js');

test('comparativo: demais = total - Metalons, incluindo tipos fora do top', () => {
  const itens = [{ nome: 'Metalons', v: 812345.22 }, { nome: 'Porta de correr', v: 900000 }];
  for (let i = 0; i < 12; i++) itens.push({ nome: 'Tipo ' + i, v: 47473.99 });
  const r = C.calcular(itens, 'Metalons');
  const total = itens.reduce((s, x) => s + x.v, 0);
  assert.ok(Math.abs(r.total - total) < 1e-6);
  assert.ok(Math.abs(r.alvo + r.demais - r.total) < 1e-6);
  assert.equal(r.alvo, 812345.22);
  assert.equal(r.pctAlvo + r.pctDemais, 100);
});

test('comparativo: percentuais do exemplo (35,6% x 64,4%)', () => {
  const r = C.calcular([{ nome: 'Metalons', v: 812345.22 }, { nome: 'Outros', v: 1469673.92 }], 'Metalons');
  assert.equal(r.pctAlvo, 35.6);
  assert.equal(r.pctDemais, 64.4);
});

test('comparativo: nome normalizado (caixa, acento, plural, espaços)', () => {
  for (const n of ['METALONS', ' metalons ', 'Metalon', 'Métalons']) {
    assert.equal(C.calcular([{ nome: n, v: 10 }, { nome: 'X', v: 30 }], 'Metalons').alvo, 10, n);
  }
  assert.equal(C.calcular([{ nome: 'Metalons', v: 5 }, { nome: 'metalon', v: 5 }, { nome: 'Z', v: 10 }], 'Metalons').alvo, 10);
});

test('comparativo: Metalons ausente (0) e lista vazia não quebram', () => {
  const a = C.calcular([{ nome: 'Porta', v: 100 }], 'Metalons');
  assert.equal(a.alvo, 0); assert.equal(a.demais, 100); assert.equal(a.pctAlvo, 0); assert.equal(a.pctDemais, 100); assert.equal(a.vazio, false);
  for (const v of [[], null, undefined, [{ nome: 'Metalons', v: 0 }], [{ nome: 'x', v: NaN }]]) {
    const r = C.calcular(v, 'Metalons');
    assert.equal(r.total, 0); assert.equal(r.vazio, true); assert.equal(r.pctAlvo, 0); assert.equal(r.pctDemais, 0);
  }
});

test('comparativo: só Metalons = 100% e demais 0', () => {
  const r = C.calcular([{ nome: 'Metalons', v: 50 }], 'Metalons');
  assert.equal(r.pctAlvo, 100); assert.equal(r.pctDemais, 0); assert.equal(r.demais, 0);
});

test('comparativo: posição na lista ordenada', () => {
  assert.equal(C.posicao([{ it: { nome: 'A' }, v: 2 }, { it: { nome: 'Metalons' }, v: 1 }], 'metalons'), 1);
  assert.equal(C.posicao([], 'Metalons'), -1);
});

test('painel_inicial/ranking: comparativo ligado só no card de tipos, dinheiro some sem valores.ver', () => {
  const raiz = path.join(__dirname, '..');
  const h = fs.readFileSync(path.join(raiz, 'painel_inicial.html'), 'utf8');
  const r = fs.readFileSync(path.join(raiz, 'ranking.js'), 'utf8');
  assert.match(h, /comparar:\s*\{\s*nome:\s*'Metalons'/);
  assert.ok(h.indexOf('comparativo_ranking.js') > -1 && h.indexOf('comparativo_ranking.js') < h.indexOf('ranking.js?'));
  assert.ok(r.includes("filter(m => verValores || !m.dinheiro)")); // métricas em dinheiro já somem sem valores.ver
  assert.ok(r.includes('Comparativo.calcular'));
});
