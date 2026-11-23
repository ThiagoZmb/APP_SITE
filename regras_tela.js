// ==========================================================================
// Livro de regras na tela de orçamentos: funções puras (testadas no Node, test/regras_tela.test.js).
// A chamada de rede (POST /regras/verificar_item), o alert/confirm e a leitura dos campos ficam em orcamentos.html.
// O servidor continua sendo a barreira final (rotas/ped_orc.js aplica as mesmas regras ao salvar).
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.RegrasTela = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Só dígitos: tira vírgula, ponto, sinal, letra e espaço (digitar e colar)
  function soDigitos(texto) {
    return String(texto == null ? '' : texto).replace(/\D/g, '');
  }

  // campos = [{ rotulo, valor }] com o TEXTO CRU digitado; devolve os rótulos que têm algo além de dígitos (vazio não conta)
  function camposComNaoDigito(campos) {
    const ruins = [];
    for (const c of Array.isArray(campos) ? campos : []) {
      const t = String(c && c.valor != null ? c.valor : '').trim();
      if (t !== '' && !/^\d+$/.test(t)) ruins.push(String((c && c.rotulo) || 'campo'));
    }
    return ruins;
  }

  function textoNaoInteiro(rotulos) {
    return 'Só números inteiros (sem vírgula, ponto, sinal ou letra) em: ' + rotulos.join(', ') + '.\nCorrija e adicione de novo.';
  }

  // Texto do confirm() nativo para uma regra confirma/avisa
  function textoConfirmacao(mensagem) {
    return String(mensagem || '') + '\n\nOK = continuar assim · Cancelar = corrigir';
  }

  // regras = resposta de POST /regras/verificar_item; confirmar(texto) => boolean (confirm do navegador).
  // Bloqueio: nada é perguntado. Confirma/avisa: pergunta uma a uma; recusa para tudo (ok false). Os códigos aceitos vão em confirmacoes.
  function avaliar(regras, confirmar) {
    const lista = Array.isArray(regras) ? regras : [];
    const bloqueios = lista.filter(r => r && r.nivel === 'bloqueia').map(r => String(r.mensagem || r.codigo || ''));
    if (bloqueios.length) return { ok: false, bloqueios, confirmacoes: [] };
    const confirmacoes = [];
    for (const r of lista) {
      if (!r || (r.nivel !== 'confirma' && r.nivel !== 'avisa')) continue;
      if (!confirmar(textoConfirmacao(r.mensagem))) return { ok: false, bloqueios: [], confirmacoes: [] };
      if (r.codigo) confirmacoes.push(String(r.codigo));
    }
    return { ok: true, bloqueios: [], confirmacoes };
  }

  return { soDigitos, camposComNaoDigito, textoNaoInteiro, textoConfirmacao, avaliar };
});
