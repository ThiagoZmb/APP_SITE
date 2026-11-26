// ==========================================================================
// Seleção múltipla e ações em lote da aba PEDIDOS de painel_inicial.html: "Alterar data de pronto" e "Mudar situação".
// Nenhuma regra de negócio aqui: seleção, perguntas, execução (um pedido por vez, rotas individuais) e resumo vêm de calendario_lote.js.
// A coluna de seleção é só da tela (não está em COLUNAS, então não sai na impressão nem no Salvar PDF).
// Testes: test/painel_lote.test.js. Regras: docs/regras/outras-regras.md
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.PainelLote = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLUNAS_DA_TABELA = 10;

  // cfg = { win, esc, api(url, opções), tipo() = aba atual, nomes() = Map número -> cliente, recarregar(), aoPronto?(números) = lote de "Pronto" gravado }
  function criar(cfg) {
    const { win, api } = cfg, doc = win.document, L = win.CalendarioLote;
    const $ = id => doc.getElementById(id);
    const tabela = $('orders-table'), corpo = $('orders-tbody'), barra = $('lote-barra'), resumo = $('lote-resumo');
    const pode = { dataPronto: !!(win.Acesso && win.Acesso.pode('pedidos.data_pronto')), situacao: !!(win.Acesso && win.Acesso.pode('pedidos.situacao')) };
    let sel = { marcados: new Set(), ancora: '' }, ordem = [];
    let ocupado = false;   // perguntando ou enviando: não aceita outra ação
    let emLote = false;    // enviando: seleção e barra travadas
    let corrente = Promise.resolve();

    const ligado = () => cfg.tipo() === 'Pedido' && (pode.dataPronto || pode.situacao);
    const selecionados = () => L.manterVisiveis(sel.marcados, ordem);

    // põe ou tira a coluna de seleção (col + th); as células vêm de celula() no desenho da lista
    function ajustarColuna(mostrar) {
      const existentes = tabela.querySelectorAll('col.col-sel, th.col-sel');
      tabela.classList.toggle('com-sel', mostrar);
      if (!mostrar) { for (const el of existentes) el.remove(); return; }
      if (existentes.length) return;
      const col = doc.createElement('col'); col.className = 'col-sel';
      const colgroup = tabela.querySelector('colgroup'); colgroup.insertBefore(col, colgroup.firstChild);
      const th = doc.createElement('th'); th.className = 'col-sel';
      th.innerHTML = '<input type="checkbox" id="sel-todos" aria-label="Selecionar todos os pedidos da lista">';
      const cabecalho = tabela.querySelector('thead tr'); cabecalho.insertBefore(th, cabecalho.firstChild);
    }

    function atualizarBarra() {
      const n = sel.marcados.size, mostrar = ligado() && n > 0;
      barra.hidden = !mostrar;
      doc.body.classList.toggle('com-barra-lote', mostrar);
      if (!mostrar) return;
      barra.innerHTML = L.htmlBarra(n, pode);
      barra.setAttribute('aria-busy', emLote ? 'true' : 'false');
      for (const el of barra.querySelectorAll('button, select')) el.disabled = emLote;
    }

    // marca/desmarca o que já está desenhado (sem redesenhar a lista) e atualiza a caixa do cabeçalho e a barra
    function pintar() {
      for (const tr of corpo.querySelectorAll('tr[data-numero]')) {
        const marcado = sel.marcados.has(tr.dataset.numero), caixa = tr.querySelector('.sel-pedido');
        tr.classList.toggle('selecionado', marcado);
        if (caixa) { caixa.checked = marcado; caixa.disabled = emLote; }
      }
      const todos = $('sel-todos');
      if (todos) {
        const n = selecionados().length;
        todos.checked = n > 0 && n === ordem.length;
        todos.indeterminate = n > 0 && n < ordem.length;
        todos.disabled = emLote || !ordem.length;
      }
      atualizarBarra();
    }

    // antes de desenhar a lista: `numeros` = as linhas que vão para a tela, na ordem
    function preparar(numeros) {
      const on = ligado();
      ordem = on ? numeros.map(String) : [];
      sel = { marcados: new Set(L.manterVisiveis(sel.marcados, ordem)), ancora: on ? sel.ancora : '' };   // quem saiu da tela é desmarcado
      ajustarColuna(on);
    }
    const colunas = () => COLUNAS_DA_TABELA + (ligado() ? 1 : 0);
    const celula = numero => (ligado() ? `<td class="col-sel"><input type="checkbox" class="sel-pedido" aria-label="Selecionar o pedido ${cfg.esc(numero)}"></td>` : '');

    function limpar() { sel = { marcados: new Set(), ancora: '' }; pintar(); }
    function trocouAba() { sel = { marcados: new Set(), ancora: '' }; ordem = []; ajustarColuna(false); atualizarBarra(); }

    // clique numa linha; true = era de seleção (a tela NÃO abre o PDF)
    function clique(ev) {
      if (!ligado()) return false;
      const alvo = ev.target, tr = alvo.closest && alvo.closest('tr[data-numero]');
      if (!tr) return false;
      if (!alvo.closest('.col-sel') && !(ev.ctrlKey || ev.metaKey || ev.shiftKey)) return false;
      if (emLote) { ev.preventDefault(); pintar(); return true; }
      const n = tr.dataset.numero;
      const marcar = alvo.closest('.sel-pedido') ? alvo.checked : !sel.marcados.has(n);
      sel = L.aplicarSelecao(sel, ordem, n, { marcar, faixa: !!ev.shiftKey });
      pintar();
      return true;
    }

    // Esc limpa a seleção (menu, janelas e o texto da busca têm o Esc deles)
    function tecla(ev) {
      if (ev.key !== 'Escape' || !sel.marcados.size || emLote || ev.defaultPrevented) return false;
      if ((ev.target && ev.target.id === 'search-input' && ev.target.value) || doc.getElementById('menu-ctx') || doc.querySelector('.dp-fundo, [role="dialog"], dialog[open]')) return false;
      limpar();
      return true;
    }

    // POST na rota individual do pedido (permissão, estados, validação e auditoria são os dela)
    const enviar = (rota, dados) => n => api(`/ped_orc/Pedido/${encodeURIComponent(n)}/${rota}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });

    async function executar(descricao, numeros, chamarUm) {
      emLote = true; pintar();
      resumo.hidden = false; resumo.className = 'cal-lote-resumo'; resumo.textContent = `Aplicando… 0 de ${numeros.length}`;
      let r;
      try { r = await L.rodarLote(numeros, chamarUm, { descricao, nomes: cfg.nomes(), painel: resumo, esc: cfg.esc }); } finally { emLote = false; }
      // os que falharam continuam selecionados; se o usuário já saiu da aba Pedidos, nada fica marcado
      sel = { marcados: new Set(ligado() ? r.numerosFalha : []), ancora: '' };
      await cfg.recarregar();   // como na ação individual; o desenho da lista desmarca o que saiu da tela
      pintar();
      resumo.scrollIntoView({ block: 'nearest' });
      resumo.focus({ preventScroll: true });
      return r;
    }

    // uma ação por vez, da pergunta ao fim do envio
    function acao(fn) {
      if (ocupado) return;
      const numeros = selecionados();
      if (!numeros.length) return;
      ocupado = true;
      corrente = Promise.resolve(fn(numeros)).catch(err => win.alert(err.message)).finally(() => { ocupado = false; });
    }
    const loteDataPronto = () => pode.dataPronto && acao(async numeros => {
      const nova = await L.perguntarData(win, numeros.length);
      if (nova) await executar('data de pronto', numeros, enviar('data_pronto', { dataPronto: nova }));
    });
    const loteSituacao = nome => pode.situacao && acao(async numeros => {
      const dados = await L.perguntarSituacao(win, nome, numeros.length);
      if (!dados) return;
      const r = await executar(`situação ${nome}`, numeros, enviar('situacao', dados));
      // uma pergunta só, no fim, com os que passaram a Pronto (o servidor recusa quem já estava)
      const prontos = nome === 'Pronto' ? L.numerosAlterados(numeros, r) : [];
      if (prontos.length && cfg.aoPronto) await cfg.aoPronto(prontos);
    });

    tabela.addEventListener('change', ev => {   // caixa do cabeçalho: todos os visíveis
      if (!ev.target || ev.target.id !== 'sel-todos' || emLote) return;
      sel = { marcados: new Set(ev.target.checked ? ordem : []), ancora: '' };
      pintar();
    });
    corpo.addEventListener('mousedown', ev => { if (ev.shiftKey && ligado()) ev.preventDefault(); });   // Shift+clique não seleciona texto
    barra.addEventListener('click', ev => {
      const b = ev.target.closest('[data-lote]');
      if (!b || emLote) return;
      if (b.dataset.lote === 'limpar') limpar(); else if (b.dataset.lote === 'data_pronto') loteDataPronto();
    });
    barra.addEventListener('change', ev => {
      const s = ev.target.closest('[data-lote-sit]');
      if (!s || !s.value) return;
      const nome = s.value; s.value = '';
      loteSituacao(nome);
    });
    resumo.addEventListener('click', ev => { if (ev.target.closest('[data-lote-fechar-resumo]')) resumo.hidden = true; });

    return { preparar, depoisDeDesenhar: pintar, colunas, celula, clique, tecla, limpar, trocouAba, emAndamento: () => corrente };
  }

  return { criar };
});
