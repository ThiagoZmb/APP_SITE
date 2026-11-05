// ==========================================================================
// ELEGANCE — comparativo "um item x todo o restante" do painel de ranking (ranking.js).
// Funções puras (testadas no Node, test/comparativo_ranking.test.js); o desenho fica em ranking.js.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Comparativo = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // sem caixa, sem acento, sem espaços nas pontas; "Metalon" e "Metalons" valem o mesmo
  function normalizar(t) {
    const n = String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    return n.length > 3 && n.endsWith('s') ? n.slice(0, -1) : n;
  }
  const arred1 = n => Math.round(n * 10) / 10;

  // itens: [{ nome, v }] (TODOS os itens, não só o top exibido). alvo: nome a destacar.
  // total = soma de todos; demais = total - alvo (inclui tipos fora do top). Percentuais com 1 casa somando 100.
  function calcular(itens, alvo) {
    const chave = normalizar(alvo);
    let total = 0, doAlvo = 0;
    for (const it of Array.isArray(itens) ? itens : []) {
      const v = Number(it && it.v);
      if (!isFinite(v) || v <= 0) continue;
      total += v;
      if (normalizar(it.nome) === chave) doAlvo += v;
    }
    const demais = Math.max(0, total - doAlvo);
    const pctAlvo = total > 0 ? arred1(doAlvo / total * 100) : 0;
    const pctDemais = total > 0 ? arred1(100 - pctAlvo) : 0;
    return { total, alvo: doAlvo, demais, pctAlvo, pctDemais, vazio: total <= 0 };
  }
  // posição do alvo na lista já ordenada (para usar a mesma cor da lista); -1 se ausente
  function posicao(ordenados, alvo) {
    const chave = normalizar(alvo);
    return (ordenados || []).findIndex(x => normalizar(x.it ? x.it.nome : x.nome) === chave);
  }
  return { normalizar, calcular, posicao };
});
