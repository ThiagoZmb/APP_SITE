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

  // Filtro dos campos de tamanho/quantidade (digitar e colar). Decisão I2: o PRIMEIRO separador (vírgula ou ponto) FICA no campo e tudo o que vem
  // depois dele é descartado ('2100,5' -> '2100,'); assim digitar tecla a tecla nunca vira '21005' (dez vezes maior) e a conferência do texto
  // cru em adicionarItem (camposComNaoDigito) recusa o item até a pessoa apagar o separador. Antes do separador, letra, sinal e espaço só são tirados.
  // Devolve { valor, removeu, decimal }: removeu = o texto mudou; decimal = há vírgula/ponto no campo (a tela avisa nos dois casos).
  function filtrarInteiro(texto) {
    const t = String(texto == null ? '' : texto);
    const corte = t.search(/[.,]/);
    const digitos = (corte >= 0 ? t.slice(0, corte) : t).replace(/\D/g, '');
    const valor = corte >= 0 ? digitos + t.charAt(corte) : digitos;
    return { valor, removeu: valor !== t, decimal: corte >= 0 };
  }
  function soDigitos(texto) {
    return filtrarInteiro(texto).valor.replace(/\D/g, '');
  }
  // Aviso curto (não bloqueia) quando há separador no campo ou o filtro mexeu no que foi digitado/colado; vazio = nada a avisar
  function textoFiltroInteiro(r) {
    if (!r) return '';
    if (r.decimal) return 'Só números inteiros: apague a vírgula/ponto.';
    return r.removeu ? 'Só números inteiros: letras, sinais e espaços foram tirados.' : '';
  }

  // Campos de origem do item no corpo de POST /ped_orc/salvar (gravar() em orcamentos.html).
  // Sem conversão: o item aberto do banco vai com `origem` (cópia/edição conferida pela impressão digital).
  // Conversão (tipo trocado, ex.: orçamento virando pedido): item do banco SEM edição (intacto ou só %) vai como `conversaoDe` e o servidor o
  // remonta do documento gravado (sem revalidar o livro de regras); `desenhoDe` leva o desenho. Editado ou novo: nada (é item novo).
  function origemNoCorpo(it, converte) {
    const o = it && it.origem;
    if (!o) return {};
    if (!converte) return { origem: o };
    if (o.estado === 'intacto' || o.estado === 'so_pct') return { conversaoDe: { item: o.item, estado: o.estado }, desenhoDe: o.item };
    return {};
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

  // Põe o item conferido na lista DEPOIS da consulta ao servidor. `antigo` = o objeto do item em edição capturado ANTES da consulta
  // (nunca o índice lido depois: durante a ida ao servidor a lista pode mudar). Novo (antigo null) entra no fim.
  // Editado: substitui o MESMO objeto onde ele estiver agora, herdando a origem dele como 'editado'; se ele saiu da lista, nada muda (false).
  function colocarNaLista(itens, item, antigo) {
    if (!antigo) { itens.push(item); return true; }
    const pos = itens.indexOf(antigo);
    if (pos < 0) return false;
    if (antigo.origem) item.origem = { item: antigo.origem.item, estado: 'editado' }; // o servidor recalcula com o preço de hoje
    itens[pos] = item;
    return true;
  }

  // Item com SÓ as confirmações dadas agora: nunca herda as do item antigo (na edição a confirmação é pedida de novo)
  function comConfirmacoes(item, aceitas) {
    return Object.assign({}, item, { confirmacoes: Array.isArray(aceitas) ? aceitas.slice() : [] });
  }

  return { filtrarInteiro, soDigitos, textoFiltroInteiro, origemNoCorpo, camposComNaoDigito, textoNaoInteiro, textoConfirmacao, avaliar, decidirConsulta, colocarNaLista, comConfirmacoes };
});
