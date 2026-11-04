// ==========================================================================
// Modal "Alteração de valores" (orcamentos.html): composição sequencial das porcentagens. Funções puras
// (testadas em test/alteracao_valor.test.js).
// O usuário espera valor_base + % = x; x + % = y; y + % = z (composição sobre o valor ATUAL). Mas a string
// gravada em PORCENTAGEM é lida pelo VB e por fatorHistorico (calculo/precos.js) como percentuais SOBRE A
// BASE (soma: "+100;+10" = x2,1). Por isso, ao confirmar, o resultado composto é COLAPSADO num único
// percentual sobre o valor original que, lido pelo critério do VB, reproduz o mesmo valor ao centavo.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.AlteracaoValor = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const arred = (n, d) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };
  const arred2 = n => arred(n, 2);

  // "+21,374;-5" -> soma dos percentuais (igual a fatorHistorico / partesHistorico)
  function somaPercentuais(h) {
    return String(h || '').split(';').map(t => t.trim()).filter(Boolean).map(t => {
      const sinal = t.startsWith('-') ? -1 : 1;
      const n = parseFloat(t.replace(/[+\-\s%]/g, '').replace(',', '.'));
      return isNaN(n) ? null : sinal * n;
    }).filter(n => n !== null).reduce((s, p) => s + p, 0);
  }
  // valor que o VB / servidor calculam: base x (1 + soma/100), 2 casas
  const valorDoHistorico = (base, h) => arred2(base * (1 + somaPercentuais(h) / 100));

  // Um único percentual sobre a base que devolve exatamente `novo` (2 casas) no critério "sobre a base".
  function colapsar(base, novo) {
    if (!(base > 0) || !(novo >= 0)) return null;
    const alvo = arred2(novo);
    const bruto = (alvo / base - 1) * 100;
    for (let d = 4; d <= 10; d++) {
      const p = arred(bruto, d);
      if (arred2(base * (1 + p / 100)) === alvo) {
        if (p === 0) return '';
        return (p > 0 ? '+' : '-') + String(Math.abs(p));
      }
    }
    return null;
  }

  // base: valor original; historico: string gravada hoje; operacao: "+10" / "-5" desta abertura ('' = nenhuma);
  // alvo: valor final digitado (modo "Valor final"; substitui tudo) ou null.
  // Devolve { valor, historico, atual }: atual = valor antes desta operação.
  function compor({ base, historico, operacao, alvo }) {
    const hist = historico || '';
    const atual = valorDoHistorico(base, hist);
    const temAlvo = alvo !== null && alvo !== undefined && Number.isFinite(alvo);
    if (!temAlvo && !operacao) return { valor: atual, historico: hist, atual };
    const valor = temAlvo ? arred2(alvo) : arred2(atual * (1 + somaPercentuais(operacao) / 100));
    const colapsado = colapsar(base, valor);
    // sem como colapsar (base inválida): mantém o histórico e anexa, como antes
    const historicoNovo = colapsado !== null ? colapsado : (hist ? hist + ';' + operacao : operacao);
    return { valor, historico: historicoNovo, atual };
  }

  return { somaPercentuais, valorDoHistorico, colapsar, compor };
});
