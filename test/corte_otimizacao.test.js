// Otimização do plano de corte (calculo/corte_otimizacao.js). Funções puras, sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { otimizar, resolverParametros } = require('../calculo/corte_otimizacao');

const P = { comprimentoVara: 6000, serra: 3, sobraMinima: 500 };
const parametrosDe = () => P;
const peca = (tamanho, o = {}) => ({ perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural', tamanho, item: 1, origem: 'porta-altura', ...o });
const retalho = (id, comprimento, o = {}) => ({ id, perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural', comprimento, ...o });
const plano = (pecas, retalhos = [], pd = parametrosDe) => otimizar({ pecas, retalhos, parametrosDe: pd });
const barras = r => r.grupos.flatMap(g => g.barras);

test('resolverParametros: perfil > padrão da tabela > padrão fixo, campo a campo', () => {
  const linhas = [{ perfil: null, comprimento_vara: 6200, serra: 4, sobra_minima: 400 }, { perfil: 'P7', comprimento_vara: 3000, serra: null, sobra_minima: null }];
  assert.deepEqual(resolverParametros(linhas, 'P7'), { comprimentoVara: 3000, serra: 4, sobraMinima: 400 });
  assert.deepEqual(resolverParametros(linhas, 'OUTRO'), { comprimentoVara: 6200, serra: 4, sobraMinima: 400 });
  assert.deepEqual(resolverParametros([], 'P7'), { comprimentoVara: 6000, serra: 3, sobraMinima: 500 });
});

test('peça do tamanho da vara cabe sozinha, sem sobra', () => {
  const r = plano([peca(6000)]);
  assert.deepEqual(r.erros, []);
  assert.equal(barras(r).length, 1);
  assert.equal(barras(r)[0].tipo, 'vara');
  assert.equal(barras(r)[0].sobra, 0);
  assert.equal(r.resumo.aproveitamentoPct, 100);
});

test('peça maior que a vara vai para erros e as demais continuam no plano', () => {
  const r = plano([peca(6001), peca(1000)]);
  assert.equal(r.erros.length, 1);
  assert.equal(r.erros[0].peca.tamanho, 6001);
  assert.match(r.erros[0].motivo, /maior/i);
  assert.equal(barras(r).flatMap(b => b.pecas).length, 1);
});

test('regra de encaixe do VB: n peças + (n-1) serras', () => {
  assert.equal(plano([peca(1998), peca(1998), peca(1998)]).resumo.qtdVarasNovas, 1);   // 5994 + 2×3 = 6000
  assert.equal(plano([peca(1999), peca(1999), peca(1999)]).resumo.qtdVarasNovas, 2);   // 5997 + 6 = 6003
});

test('sobra desconta as serras e o corte final', () => {
  const [b] = barras(plano([peca(1000), peca(1000)]));
  assert.equal(b.sobra, 6000 - 2000 - 3 - 3);   // 1 serra entre as peças + 1 do corte final
  assert.equal(b.destinoSobra, 'guardar');
});

test('destino da sobra: guardar a partir da sobra mínima, descartar abaixo', () => {
  assert.equal(barras(plano([peca(5000)]))[0].sobra, 997);
  assert.equal(barras(plano([peca(5000)]))[0].destinoSobra, 'guardar');
  assert.equal(barras(plano([peca(5500)]))[0].sobra, 497);
  assert.equal(barras(plano([peca(5500)]))[0].destinoSobra, 'descartar');
});

test('sobra mínima por perfil', () => {
  const pd = perfil => ({ ...P, sobraMinima: perfil === 'P100' ? 1000 : 500 });
  assert.equal(barras(plano([peca(5000)], [], pd))[0].destinoSobra, 'descartar');   // 997 < 1000
  assert.equal(barras(plano([peca(5000, { perfil: 'P200' })], [], pd))[0].destinoSobra, 'guardar');
});

test('retalho do mesmo grupo é usado antes de abrir vara nova', () => {
  const r = plano([peca(1000)], [retalho(7, 1500)]);
  assert.equal(r.resumo.qtdVarasNovas, 0);
  assert.equal(r.resumo.qtdRetalhosUsados, 1);
  const [b] = barras(r);
  assert.equal(b.tipo, 'retalho');
  assert.equal(b.retalhoId, 7);
  assert.equal(b.comprimento, 1500);
});

test('retalho que não comporta a peça é ignorado', () => {
  const r = plano([peca(1000)], [retalho(7, 900)]);
  assert.equal(r.resumo.qtdRetalhosUsados, 0);
  assert.equal(r.resumo.qtdVarasNovas, 1);
});

test('retalho de outra cor, acabamento ou perfil nunca é usado', () => {
  for (const outro of [{ cor: 'Preto' }, { acabamento: 'Pintado' }, { perfil: 'P200' }]) {
    const r = plano([peca(1000)], [retalho(7, 3000, outro)]);
    assert.equal(r.resumo.qtdRetalhosUsados, 0, JSON.stringify(outro));
    assert.equal(r.resumo.qtdVarasNovas, 1);
  }
});

test('grupos diferentes nunca dividem a mesma vara', () => {
  const r = plano([peca(1000), peca(1000, { cor: 'Preto' })]);
  assert.equal(r.grupos.length, 2);
  assert.equal(r.resumo.qtdVarasNovas, 2);
});

test('aproveitamento = soma das peças ÷ comprimento usado, 1 casa', () => {
  assert.equal(plano([peca(1000), peca(2000)]).resumo.aproveitamentoPct, 50);
  assert.equal(plano([peca(1000)]).resumo.aproveitamentoPct, 16.7);
});

test('mesmo pedido gera sempre o mesmo plano', () => {
  const pecas = [3100, 2900, 2100, 2100, 1800, 900, 900, 1200, 450, 2500].map((t, i) => peca(t, { item: i + 1 }));
  assert.deepEqual(plano(pecas, [retalho(1, 2200), retalho(2, 1300)]), plano(pecas, [retalho(1, 2200), retalho(2, 1300)]));
});

// PRNG com semente fixa (mulberry32)
function prng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// FFD do frm_aproveitamento_vara.vb (CalcularFFD), para comparação
function ffdVB(tamanhos, max, serra) {
  const bins = [];
  for (const t of [...tamanhos].sort((a, b) => b - a)) {
    const bin = bins.find(b => b.reduce((s, x) => s + x, 0) + b.length * serra + t <= max);
    if (bin) bin.push(t); else bins.push([t]);
  }
  return bins.length;
}

test('nunca usa mais varas que o FFD do VB, cada peça entra uma vez e cada barra cabe', () => {
  const rnd = prng(20261027);
  for (let rodada = 0; rodada < 40; rodada++) {
    const n = 5 + Math.floor(rnd() * 26);
    const tamanhos = Array.from({ length: n }, () => 300 + Math.floor(rnd() * 3200));
    const r = plano(tamanhos.map((t, i) => peca(t, { item: i + 1 })));
    assert.ok(r.resumo.qtdVarasNovas <= ffdVB(tamanhos, 6000, 3), `rodada ${rodada}`);
    const colocadas = barras(r).flatMap(b => b.pecas.map(p => p.tamanho)).sort((a, b) => a - b);
    assert.deepEqual(colocadas, [...tamanhos].sort((a, b) => a - b), `rodada ${rodada}`);
    for (const b of barras(r)) {
      const soma = b.pecas.reduce((s, p) => s + p.tamanho, 0);
      assert.ok(soma + (b.pecas.length - 1) * 3 <= b.comprimento, `rodada ${rodada}`);
      assert.ok(b.sobra >= 0);
    }
  }
});

test('sem peças: plano vazio', () => {
  const r = plano([]);
  assert.deepEqual(r.grupos, []);
  assert.equal(r.resumo.qtdVarasNovas, 0);
});
