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

  // Decide o que a tela faz com a resposta de POST /regras/verificar_item. resposta = { rede: true } (fetch falhou) ou { status, json }.
  // Devolve { ok, confirmacoes, mensagem, login }: mensagem = texto do alert (vazio = nada a mostrar); login = true no 401 (vai para o login).
  function decidirConsulta(resposta, confirmar) {
    const falha = mensagem => ({ ok: false, confirmacoes: [], mensagem, login: false });
    const r = resposta || {};
    if (r.rede) return falha('Sem conexão com o servidor para conferir as regras do item. O item NÃO foi adicionado; tente de novo.');
    if (r.status === 401) return { ok: false, confirmacoes: [], mensagem: '', login: true };
    const json = r.json && typeof r.json === 'object' ? r.json : {};
    const okHttp = r.status >= 200 && r.status < 300;
    if (!okHttp || !Array.isArray(json.regras)) {
      return falha((r.status === 403 ? 'Sem permissão para conferir as regras do item. ' : 'Não foi possível conferir as regras do item. ') +
        (json.error ? json.error + ' ' : '(HTTP ' + r.status + ') ') + 'O item NÃO foi adicionado.');
    }
    const a = avaliar(json.regras, confirmar);
    return { ok: a.ok, confirmacoes: a.confirmacoes, mensagem: a.bloqueios.length ? 'Corrija antes de adicionar o item:\n\n- ' + a.bloqueios.join('\n- ') : '', login: false };
  }

  // Item com SÓ as confirmações dadas agora: nunca herda as do item antigo (na edição a confirmação é pedida de novo)
  function comConfirmacoes(item, aceitas) {
    return Object.assign({}, item, { confirmacoes: Array.isArray(aceitas) ? aceitas.slice() : [] });
  }

  return { soDigitos, camposComNaoDigito, textoNaoInteiro, textoConfirmacao, avaliar, decidirConsulta, comConfirmacoes };
});
