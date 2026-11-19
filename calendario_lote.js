// ==========================================================================
// Ações em LOTE do calendário de pedidos (visão Lista de calendario.html): selecionar vários pedidos e aplicar "Alterar data de pronto" ou "Mudar situação".
// Funções puras (testadas no Node, test/calendario_lote.test.js). NENHUMA regra de negócio aqui: cada pedido é enviado, UM POR UM e em sequência,
// às rotas que já existem (POST /ped_orc/Pedido/:n/data_pronto e /situacao), então permissão, estados do usuário, validação e auditoria
// (web_auditoria, Histórico do pedido) são exatamente os da ação individual. Uma falha não impede os outros pedidos.
// Regras: docs/regras/calendario-pedidos.md
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.CalendarioLote = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SITUACOES_LOTE = ['Em Produção', 'Pronto', 'Entregue', 'Retirado'];   // as mesmas do menu do botão direito (Cancelado não entra)
  const MAX_FALHAS_VISIVEIS = 30;

  // números dos pedidos na ORDEM da lista da tela (dia a dia, como a visão Lista desenha); `semanas` = células de montarGrade/celulasDeBusca
  function numerosNaOrdem(semanas) {
    const saida = [], visto = new Set();
    for (const c of (Array.isArray(semanas) ? semanas : []).flat()) {
      if (!c || !c.doMes) continue;
      for (const p of c.pedidos || []) { const n = String(p.numero); if (!visto.has(n)) { visto.add(n); saida.push(n); } }
    }
    return saida;
  }

  // números entre `a` e `b` (inclusive, em qualquer sentido) na ordem da tela; se um dos dois não está na lista, só `b` (ou nada)
  function intervalo(ordem, a, b) {
    const i = ordem.indexOf(String(a)), j = ordem.indexOf(String(b));
    if (j < 0) return [];
    if (i < 0) return [ordem[j]];
    return ordem.slice(Math.min(i, j), Math.max(i, j) + 1);
  }

  // Clique de seleção. `sel` = { marcados: Set, ancora }. `marcar` = novo estado do pedido clicado; `faixa` (Shift) aplica o mesmo estado a todo o intervalo
  // da âncora até o clicado. Devolve um NOVO { marcados, ancora } (a âncora passa a ser o clicado). Número fora da ordem é ignorado.
  function aplicarSelecao(sel, ordem, numero, { marcar, faixa = false } = {}) {
    const n = String(numero), marcados = new Set(sel && sel.marcados ? sel.marcados : []);
    if (!ordem.includes(n)) return { marcados, ancora: (sel && sel.ancora) || '' };
    const alvo = faixa && sel && sel.ancora ? intervalo(ordem, sel.ancora, n) : [n];
    for (const x of alvo) { if (marcar) marcados.add(x); else marcados.delete(x); }
    return { marcados, ancora: n };
  }

  // depois de recarregar: só continuam selecionados os pedidos que ainda estão na tela (o resto saiu do mês/filtro); ordem da tela
  const manterVisiveis = (marcados, ordem) => ordem.filter(n => marcados.has(n));

  const textoSelecionados = n => (n === 1 ? '1 selecionado' : `${n} selecionados`);

  // Corpo do POST /situacao a partir da escolha de EscolhaDataEntrega ('hoje' | 'manter' | 'pronto' | 'data:AAAA-MM-DD'); só Entregue/Retirado levam data
  function corpoSituacao(nome, escolha) {
    const corpo = { situacao: nome };
    if (nome !== 'Entregue' && nome !== 'Retirado') return corpo;
    if (escolha === 'manter') corpo.manterData = true;
    else if (escolha === 'pronto') corpo.usarDataPronto = true;
    else { const m = /^data:(\d{4}-\d{2}-\d{2})$/.exec(String(escolha || '')); if (m) corpo.dataEntrega = m[1]; }
    return corpo;
  }

  // Mensagem curta de um erro de uma chamada. 409 `entregas_abertas` (pedido com entrega em aberto, que na ação individual pergunta) NÃO é confirmado às cegas no lote:
  // vira falha com o motivo, e o usuário resolve esse pedido pela ação individual (que mostra o que acontece com cada entrega).
  function motivoErro(err) {
    const d = err && err.dados;
    if (d && d.aviso === 'entregas_abertas') {
      const n = Number(d.entregasAbertas) || 0;
      return `tem ${n} entrega(s) em aberto; use a ação do próprio pedido (botão direito) para confirmar`;
    }
    const m = String((err && err.message) || 'Erro desconhecido').replace(/\s+/g, ' ').trim();
    return m.slice(0, 200);
  }

  // Roda `fn(numero)` para cada número, UM POR UM e em ordem. Nunca lança: devolve [{ numero, ok, erro? }] na mesma ordem.
  // `parar(err)` verdadeiro (ex.: sessão expirada) interrompe o resto, que volta como falha "não processado". `aoProgresso(feitos, total)` é opcional.
  async function executarLote(numeros, fn, { parar, aoProgresso } = {}) {
    const resultados = [];
    let interrompido = false;
    for (let i = 0; i < numeros.length; i++) {
      const numero = String(numeros[i]);
      if (interrompido) { resultados.push({ numero, ok: false, erro: 'não processado (a operação foi interrompida)' }); continue; }
      try { await fn(numero); resultados.push({ numero, ok: true }); } catch (err) {
        resultados.push({ numero, ok: false, erro: motivoErro(err) });
        if (typeof parar === 'function' && parar(err)) interrompido = true;
      }
      if (typeof aoProgresso === 'function') { try { aoProgresso(i + 1, numeros.length); } catch { /* só aviso de progresso */ } }
    }
    return resultados;
  }

  // Resumo: "N de M alterados" + a lista dos que falharam e por quê. `nomes` (opcional) = Map número -> cliente.
  function resumoLote(resultados, acao, nomes) {
    const lista = Array.isArray(resultados) ? resultados : [];
    const falhas = lista.filter(r => !r.ok).map(r => ({ numero: r.numero, cliente: (nomes && nomes.get && nomes.get(String(r.numero))) || '', erro: r.erro || 'Erro desconhecido' }));
    const qtdOk = lista.length - falhas.length;
    return { total: lista.length, qtdOk, qtdFalhas: falhas.length, falhas, todosOk: lista.length > 0 && !falhas.length,
      titulo: `${qtdOk} de ${lista.length} alterado${lista.length === 1 ? '' : 's'}${acao ? ` (${acao})` : ''}`,
      numerosFalha: falhas.map(f => f.numero) };
  }

  const esc0 = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // HTML do resumo (dado do servidor só entra por esc)
  function htmlResumo(r, esc = esc0) {
    const itens = r.falhas.slice(0, MAX_FALHAS_VISIVEIS).map(f => `<li><b>Pedido ${esc(f.numero)}</b>${f.cliente ? ` (${esc(f.cliente)})` : ''}: ${esc(f.erro)}</li>`).join('');
    const mais = r.falhas.length > MAX_FALHAS_VISIVEIS ? `<li>… e mais ${r.falhas.length - MAX_FALHAS_VISIVEIS} pedido(s) com falha.</li>` : '';
    return `<div class="cal-lote-res-cab"><strong>${esc(r.titulo)}</strong><button type="button" class="btn btn-mini btn-secondary" data-lote-fechar-resumo>Fechar</button></div>`
      + (r.qtdFalhas ? `<p>Não foram alterados (continuam selecionados para você tentar de novo):</p><ul>${itens}${mais}</ul>` : '<p>Tudo certo.</p>');
  }

  // Barra de ações em lote. `pode` = { dataPronto, situacao } (só aparece o que o usuário pode). Rótulos fixos; nada vindo do servidor.
  function htmlBarra(qtd, pode) {
    return `<span class="cal-lote-qtd" id="cal-lote-qtd" aria-live="polite">${textoSelecionados(qtd)}</span>`
      + (pode.dataPronto ? '<button type="button" class="btn btn-mini btn-primary" data-lote="data_pronto">Alterar data de pronto</button>' : '')
      + (pode.situacao ? `<label class="cal-lote-sit"><span class="sr-only">Mudar situação dos selecionados</span><select id="cal-lote-sit" data-lote-sit><option value="">Mudar situação…</option>${SITUACOES_LOTE.map(s => `<option value="${esc0(s)}">${esc0(s)}</option>`).join('')}</select></label>` : '')
      + '<button type="button" class="btn btn-mini btn-secondary" data-lote="limpar">Limpar seleção</button>';
  }

  return { SITUACOES_LOTE, MAX_FALHAS_VISIVEIS, numerosNaOrdem, intervalo, aplicarSelecao, manterVisiveis, textoSelecionados, corpoSituacao, motivoErro, executarLote, resumoLote, htmlResumo, htmlBarra };
});
