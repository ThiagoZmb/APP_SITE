// Ajuste do DESCONTO ADICIONAL de um pedido já feito (menu do botão direito). Funções puras, usadas pelo servidor
// (POST /ped_orc/Pedido/:numero/desconto) e pela janela da tela (desconto_pedido.js), para as duas verem o mesmo número.
// Regra do pedido (rotas/ped_orc.js): TOTAL = SUB_TOTAL × (100 − DESCONTO) ÷ 100, 2 casas. Duas formas de informar, como no "Alterar valor":
//   (1) percentual  → o total é calculado;  (2) "valor final" → o % é calculado a partir do total digitado, com as casas necessárias
//   para o total bater ao centavo (mesma ideia do colapsar de alteracao_valor.js).
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.DescontoPedido = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const arred = (n, d) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };
  const arred2 = n => arred(n, 2);

  // "1.234,56" | "1234.56" | 1234.56 → número; vazio ou inválido → NaN
  function numeroBR(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    const t = String(v ?? '').trim().replace(/[R$\s%]/g, '');
    if (!t) return NaN;
    const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    return isFinite(n) ? n : NaN;
  }

  const totalComDesconto = (subTotal, pct) => arred2(subTotal * (100 - pct) / 100);

  // menor número de casas (2 a 10) em que o percentual devolve exatamente o total pedido; null se não existir
  function pctParaTotal(subTotal, alvo) {
    if (!(subTotal > 0) || !(alvo >= 0) || arred2(alvo) > arred2(subTotal)) return null;
    const meta = arred2(alvo);
    const bruto = (1 - meta / subTotal) * 100;
    for (let d = 2; d <= 10; d++) {
      const p = arred(bruto, d);
      if (p >= 0 && p <= 100 && totalComDesconto(subTotal, p) === meta) return p;
    }
    return null;
  }

  // entrada: { subTotal, descontoPct } (forma 1) ou { subTotal, totalFinal } (forma 2). Devolve { ok, descontoPct, total, modo } ou { ok: false, erro }.
  function calcular({ subTotal, descontoPct, totalFinal }) {
    const sub = Number(subTotal);
    if (!(sub > 0)) return { ok: false, erro: 'O pedido não tem subtotal para aplicar desconto.' };
    const temFinal = totalFinal !== undefined && totalFinal !== null && String(totalFinal).trim() !== '';
    if (temFinal) {
      const alvo = numeroBR(totalFinal);
      if (isNaN(alvo) || alvo < 0) return { ok: false, erro: 'Total final inválido. Digite apenas números.' };
      if (arred2(alvo) > arred2(sub)) return { ok: false, erro: 'O total final não pode passar do subtotal. Para acrescentar valor, abra o pedido para editar.' };
      const p = pctParaTotal(sub, alvo);
      if (p === null) return { ok: false, erro: 'Não foi possível chegar a esse total com um percentual de desconto.' };
      return { ok: true, descontoPct: p, total: arred2(alvo), modo: 'valor_final' };
    }
    const pct = numeroBR(descontoPct);
    if (isNaN(pct)) return { ok: false, erro: 'Desconto inválido. Digite apenas números.' };
    if (pct < 0 || pct > 100) return { ok: false, erro: 'O desconto deve ficar entre 0% e 100%.' };
    const p = arred(pct, 4);
    return { ok: true, descontoPct: p, total: totalComDesconto(sub, p), modo: 'percentual' };
  }

  return { arred2, numeroBR, totalComDesconto, pctParaTotal, calcular };
});
