// ==========================================================================
// calendario.html — calendário mensal da previsão de finalização dos pedidos (ped_orc.DATA_PRONTO).
// Rota: GET /calendario/pedidos?mes=AAAA-MM&situacao=abertos|todos. Só leitura; as mudanças (data de pronto, situação) vêm do menu do botão direito.
// Funções puras de tela ficam em calendario_comum.js (testadas em test/calendario_tela.test.js). Regras: docs/regras/calendario-pedidos.md
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.CalendarioPedidos = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const K = typeof module === 'object' && module.exports ? require('./calendario_comum.js') : raiz.CalendarioComum;
  const L = typeof module === 'object' && module.exports ? require('./calendario_lote.js') : raiz.CalendarioLote;   // ações em lote (selecionar vários pedidos), regras em calendario_lote.js

  // ?mes=AAAA-MM&situacao=... da URL; mês ausente/inválido = mês de hoje
  function lerConsulta(search, hoje) {
    const q = new URLSearchParams(search || '');
    const mes = q.get('mes');
    return { mes: K.mesValido(mes) ? mes : K.mesDe(hoje), situacao: K.situacaoValida(q.get('situacao')), visao: K.visaoValida(q.get('visao')) };
  }

  function iniciar(win) {
    const base = K.iniciarComum(win);
    if (!base) return;
    const { doc, $, chamar, toast, getAuth } = base;
    const hoje = K.hojeISO(win);
    const estado = Object.assign({ pedidos: new Map(), consulta: 0, busca: '', termoRolado: '', semanas: [], atual: -1, seqBusca: 0, achadosSrv: null, dadosMes: null, sel: { marcados: new Set(), ancora: '' }, emLote: false }, lerConsulta(win.location.search, hoje));

    // Seleção em lote (só na visão Lista): liga para quem pode mudar data de pronto ou situação; as rotas conferem a permissão de novo a cada pedido.
    const podeLote = { dataPronto: !!(win.Acesso && win.Acesso.pode('pedidos.data_pronto')), situacao: !!(win.Acesso && win.Acesso.pode('pedidos.situacao')) };
    const loteLigado = podeLote.dataPronto || podeLote.situacao;
    const marcadosOuNulo = () => (loteLigado ? estado.sel.marcados : null);
    const ordemTela = () => L.numerosNaOrdem(estado.semanas);

    function desenhar(d) {
      estado.dadosMes = d;
      if (estado.achadosSrv) return desenharBusca();   // pesquisa ativa: o mês carregado só fica guardado para quando ela for limpa
      const semanas = K.montarGrade(d.dias, estado.mes, d.hoje || hoje);
      $('cal-titulo').textContent = K.nomeMes(estado.mes);
      $('cal-resumo').textContent = `${d.qtdPedidos} pedido(s) no mês${d.qtdAtrasados ? ` · ${d.qtdAtrasados} atrasado(s)` : ''}`;
      $('cal-visao').innerHTML = K.htmlVisao(estado.visao);
      $('cal-situacao').innerHTML = K.htmlSituacao(estado.situacao);
      $('cal-corpo').dataset.modo = estado.visao;   // não pode ser data-visao: é o atributo dos botões e o closest() pegaria o contêiner
      estado.semanas = semanas;
      $('cal-folha').innerHTML = K.htmlFolha(semanas, estado.situacao, estado.busca, marcadosOuNulo());
      $('cal-grade').innerHTML = K.htmlGrade(semanas, estado.situacao, estado.busca);
      $('cal-lista').innerHTML = K.htmlListaDias(semanas, estado.situacao, estado.busca);
      aposDesenho();
      atualizarBusca();
    }
    // Resultado da pesquisa no servidor (todas as datas): sempre em Lista (a grade é de um mês só); datas completas, agrupado por dia.
    function desenharBusca() {
      const d = estado.achadosSrv;
      const semanas = K.celulasDeBusca(d.dias, d.hoje || hoje);
      $('cal-titulo').textContent = 'Resultado da pesquisa';
      $('cal-resumo').textContent = `${d.qtdPedidos} pedido(s) em qualquer data${d.qtdAtrasados ? ` · ${d.qtdAtrasados} atrasado(s)` : ''}`;
      $('cal-visao').innerHTML = K.htmlVisao(estado.visao);
      $('cal-situacao').innerHTML = K.htmlSituacao(estado.situacao);
      $('cal-corpo').dataset.modo = 'lista';
      estado.semanas = semanas;
      estado.pedidos = new Map();
      for (const dia of d.dias || []) for (const p of dia.pedidos) estado.pedidos.set(String(p.numero), p);
      $('cal-folha').innerHTML = K.htmlFolha(semanas, estado.situacao, estado.busca, marcadosOuNulo());
      $('cal-grade').innerHTML = '';
      $('cal-lista').innerHTML = K.htmlListaDias(semanas, estado.situacao, estado.busca);
      aposDesenho();
      atualizarBusca();
    }

    // Pesquisa: com texto, vai ao servidor (todos os pedidos que casam, em qualquer data, respeitando "Em aberto | Todos") e destaca o que casou.
    // Os três desenhos (lista, grade, lista do celular) existem juntos no HTML; só o que está visível conta para anterior/próximo.
    const achados = () => [...doc.querySelectorAll('#cal-corpo li.achou')].filter(el => el.offsetParent !== null);
    function atualizarBusca() {
      const resultado = K.localizar(estado.semanas.flat(), estado.busca);
      const tem = !!K.normalizarBusca(estado.busca);
      $('cal-busca-resultado').textContent = estado.achadosSrv ? K.textoBuscaServidor({ qtdPedidos: estado.achadosSrv.qtdPedidos, qtdDias: (estado.achadosSrv.dias || []).length }, estado.situacao, estado.achadosSrv.limitado, estado.achadosSrv.limite) : K.textoBusca(estado.busca, resultado, estado.situacao);
      $('cal-busca-limpar').hidden = !estado.busca;
      for (const id of ['cal-busca-ant', 'cal-busca-prox']) { $(id).hidden = !tem; $(id).disabled = !resultado.qtdPedidos; }
      estado.atual = -1;
    }
    // Rola até o destaque (suave, ou instantâneo com prefers-reduced-motion). O CSS dá scroll-margin ao destaque por causa do topo fixo e da barra fixa.
    const reduzirMovimento = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Barra fixa (#cal-fixo, sticky): a altura real vai para --cal-fixo-altura, que o CSS soma ao scroll-margin do resultado (a barra quebra em duas linhas no celular)
    const barraFixa = $('cal-fixo');
    function medirBarraFixa() {
      const v = barraFixa ? K.alturaBarraFixa(barraFixa.getBoundingClientRect().height) : '';
      if (v) doc.documentElement.style.setProperty('--cal-fixo-altura', v);
    }
    if (barraFixa && typeof win.ResizeObserver === 'function') new win.ResizeObserver(medirBarraFixa).observe(barraFixa);
    win.addEventListener('resize', medirBarraFixa);
    medirBarraFixa();
    function marcarAtual(el) {
      medirBarraFixa();
      doc.querySelectorAll('#cal-corpo .achou.atual').forEach(x => x.classList.remove('atual'));
      el.classList.add('atual');
      el.scrollIntoView({ block: 'center', behavior: K.comportamentoRolagem(reduzirMovimento()) });
    }
    function irParaAchado(passo) {
      const lista = achados();
      if (!lista.length) return;
      estado.atual = (estado.atual + passo + lista.length) % lista.length;
      estado.termoRolado = K.normalizarBusca(estado.busca);   // quem já foi levado ao resultado não é levado de novo pela digitação
      const el = lista[estado.atual];
      marcarAtual(el);
      el.focus({ preventScroll: true });
      $('cal-busca-resultado').textContent = `Resultado ${estado.atual + 1} de ${lista.length}: pedido ${el.dataset.numero}.`;
    }
    // Depois da digitação: só rola se o termo é novo e há destaque visível (sem foco: a pessoa continua digitando no campo).
    function rolarSeTermoNovo() {
      const lista = achados();
      if (!K.deveRolarBusca(estado.termoRolado, estado.busca, lista.length)) {
        if (!K.normalizarBusca(estado.busca)) estado.termoRolado = '';
        return;
      }
      estado.termoRolado = K.normalizarBusca(estado.busca);
      estado.atual = 0;
      marcarAtual(lista[0]);
    }
    // Aplica o texto da pesquisa: vazio = volta ao mês normal (sem nova consulta se o mês carregado ainda vale); com texto = consulta o servidor.
    // Respostas antigas (digitou de novo antes de chegar) são descartadas por `seqBusca`.
    async function executarBusca(rolar) {
      const minha = ++estado.seqBusca;
      estado.busca = campo.value;
      if (!K.normalizarBusca(estado.busca)) {
        estado.achadosSrv = null; estado.termoRolado = '';
        const d = estado.dadosMes;
        if (d && d.mes === estado.mes && d.situacao === estado.situacao) desenhar(d); else await carregar();
        return;
      }
      $('cal-corpo').setAttribute('aria-busy', 'true');
      try {
        const d = await chamar(`/calendario/pedidos?busca=${encodeURIComponent(estado.busca.trim())}&situacao=${encodeURIComponent(estado.situacao)}`);
        if (minha !== estado.seqBusca) return;
        estado.achadosSrv = d;
        desenharBusca();
        if (rolar) rolarSeTermoNovo();
      } catch (err) {
        if (minha === estado.seqBusca) toast(err.message, 'erro');
      } finally {
        if (minha === estado.seqBusca) $('cal-corpo').removeAttribute('aria-busy');
      }
    }
    let espera = null;
    const campo = $('cal-busca');
    campo.addEventListener('input', () => { // espera de 300 ms para não consultar a cada tecla
      win.clearTimeout(espera);
      espera = win.setTimeout(() => { executarBusca(true); }, 300);
    });
    function limparBusca() { win.clearTimeout(espera); campo.value = ''; estado.termoRolado = ''; executarBusca(false); campo.focus(); }
    campo.addEventListener('keydown', async ev => {
      if (ev.key === 'Escape') { limparBusca(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); win.clearTimeout(espera); await executarBusca(false); irParaAchado(ev.shiftKey ? -1 : 1); }
    });
    $('cal-busca-limpar').addEventListener('click', limparBusca);
    $('cal-busca-ant').addEventListener('click', () => irParaAchado(-1));
    $('cal-busca-prox').addEventListener('click', () => irParaAchado(1));

    async function carregar() {
      if (estado.achadosSrv) return executarBusca(false);   // pesquisa ativa: recarregar (situação, menu) refaz a pesquisa
      const minha = ++estado.consulta;
      try { win.history.replaceState(null, '', K.urlMes(estado.mes, estado.situacao, estado.visao)); } catch { /* sem history: a tela segue */ }
      $('cal-corpo').setAttribute('aria-busy', 'true');
      try {
        const d = await chamar(`/calendario/pedidos?mes=${encodeURIComponent(estado.mes)}&situacao=${encodeURIComponent(estado.situacao)}`);
        if (minha !== estado.consulta) return; // resposta de uma consulta antiga
        estado.pedidos = new Map();
        for (const dia of d.dias || []) for (const p of dia.pedidos) estado.pedidos.set(String(p.numero), p);
        desenhar(d);
      } catch (err) {
        if (minha === estado.consulta) toast(err.message, 'erro');
      } finally {
        if (minha === estado.consulta) $('cal-corpo').removeAttribute('aria-busy');
      }
    }

    // ---------- ações em lote (visão Lista) ----------
    // Cada pedido selecionado vai, UM POR UM e em sequência, para a rota individual que já existe (calendario_lote.js); nada de regra nova aqui.
    const barraLote = $('cal-lote'), resumoLote = $('cal-lote-resumo');
    function pintarSelecao() {   // marca/desmarca as linhas já desenhadas sem redesenhar a lista
      for (const li of doc.querySelectorAll('#cal-folha li[data-numero]')) {
        const marcado = estado.sel.marcados.has(li.dataset.numero), cb = li.querySelector('.sel-pedido');
        li.classList.toggle('sel', marcado);
        if (cb) cb.checked = marcado;
      }
    }
    function atualizarBarraLote() {
      if (!barraLote) return;
      const n = estado.sel.marcados.size;
      barraLote.hidden = !loteLigado || n === 0 || $('cal-corpo').dataset.modo !== 'lista';
      if (barraLote.hidden) return;
      barraLote.innerHTML = L.htmlBarra(n, podeLote);
      barraLote.setAttribute('aria-busy', estado.emLote ? 'true' : 'false');
      for (const el of barraLote.querySelectorAll('button, select')) el.disabled = estado.emLote;
    }
    function aposDesenho() {   // pedido que saiu da tela (outro mês, filtro) deixa de estar selecionado
      estado.sel = { marcados: new Set(L.manterVisiveis(estado.sel.marcados, ordemTela())), ancora: estado.sel.ancora };
      pintarSelecao();
      atualizarBarraLote();
    }
    function limparSelecao() { estado.sel = { marcados: new Set(), ancora: '' }; pintarSelecao(); atualizarBarraLote(); }
    const numerosSelecionados = () => L.manterVisiveis(estado.sel.marcados, ordemTela());

    // Clique na caixa (ou Ctrl/Cmd+clique na linha); Shift marca a faixa desde o último clicado
    function aoSelecionar(ev) {
      if (!loteLigado || estado.emLote) return;
      const li = ev.target.closest && ev.target.closest('#cal-folha li[data-numero]');
      if (!li || ev.target.closest('a')) return;
      const caixa = ev.target.closest('.sel-pedido');
      if (!caixa && !(ev.ctrlKey || ev.metaKey || ev.shiftKey)) return;
      const n = li.dataset.numero;
      const marcar = caixa ? caixa.checked : !estado.sel.marcados.has(n);
      estado.sel = L.aplicarSelecao(estado.sel, ordemTela(), n, { marcar, faixa: ev.shiftKey });
      pintarSelecao(); atualizarBarraLote();
    }

    async function executarAcao(descricao, numeros, chamarUm) {
      estado.emLote = true; atualizarBarraLote();
      $('cal-corpo').setAttribute('aria-busy', 'true');
      const nomes = new Map([...estado.pedidos].map(([k, p]) => [k, p.cliente || '']));
      let r;
      try {
        r = await L.rodarLote(numeros, chamarUm, { descricao, nomes, painel: resumoLote, esc: K.esc });
      } finally { estado.emLote = false; }
      estado.sel = { marcados: new Set(r.numerosFalha), ancora: '' };   // os que falharam continuam selecionados, para tentar de novo
      toast(r.titulo, r.todosOk ? 'info' : 'erro');
      await carregar();   // recarrega o mês (ou a pesquisa) mantendo filtros; o pedido pode ter mudado de dia
      $('cal-corpo').removeAttribute('aria-busy');
      aposDesenho();
    }

    async function loteDataPronto() {
      const numeros = numerosSelecionados();
      if (!numeros.length || !podeLote.dataPronto) return;
      const nova = await L.perguntarData(win, numeros.length);
      if (!nova) return;
      await executarAcao('data de pronto', numeros, n => chamar(`/ped_orc/Pedido/${encodeURIComponent(n)}/data_pronto`, { metodo: 'POST', corpo: { dataPronto: nova } }));
    }
    async function loteSituacao(nome) {
      const numeros = numerosSelecionados();
      if (!numeros.length || !podeLote.situacao) return;
      const corpo = await L.perguntarSituacao(win, nome, numeros.length);
      if (!corpo) return;
      await executarAcao(`situação ${nome}`, numeros, n => chamar(`/ped_orc/Pedido/${encodeURIComponent(n)}/situacao`, { metodo: 'POST', corpo }));
    }

    doc.addEventListener('click', aoSelecionar);
    doc.addEventListener('mousedown', ev => { if (ev.shiftKey && ev.target.closest && ev.target.closest('#cal-folha li[data-numero]')) ev.preventDefault(); });   // Shift+clique não seleciona texto
    if (barraLote) {
      barraLote.addEventListener('click', ev => {
        const b = ev.target.closest('[data-lote]'); if (!b) return;
        if (b.dataset.lote === 'limpar') limparSelecao(); else if (b.dataset.lote === 'data_pronto') loteDataPronto();
      });
      barraLote.addEventListener('change', ev => {
        const sel = ev.target.closest('[data-lote-sit]'); if (!sel || !sel.value) return;
        const nome = sel.value; sel.value = ''; loteSituacao(nome);
      });
    }
    if (resumoLote) resumoLote.addEventListener('click', ev => { if (ev.target.closest('[data-lote-fechar-resumo]')) resumoLote.hidden = true; });
    doc.addEventListener('keydown', ev => {   // Esc limpa a seleção (a pesquisa, o menu do botão direito e as janelas têm o Esc deles)
      if (ev.key !== 'Escape' || !estado.sel.marcados.size || estado.emLote || ev.defaultPrevented) return;
      if (ev.target === campo || doc.getElementById('menu-ctx') || doc.querySelector('.dp-fundo, [role="dialog"]')) return;
      limparSelecao();
    });

    const irParaODia = el => { const cel = el.closest('.cel[data-dia]'); if (cel) win.location.href = K.urlDia(cel.dataset.dia, estado.situacao); };

    doc.addEventListener('click', ev => {
      const mes = ev.target.closest('[data-mes]');
      if (mes) { if (estado.achadosSrv) { win.clearTimeout(espera); campo.value = ''; estado.busca = ''; estado.termoRolado = ''; estado.achadosSrv = null; ++estado.seqBusca; } estado.mes = mes.dataset.mes === '0' ? K.mesDe(hoje) : K.somarMeses(estado.mes, Number(mes.dataset.mes)); carregar(); return; }
      const vis = ev.target.closest('[data-visao]');
      if (vis) { estado.visao = K.visaoValida(vis.dataset.visao); carregar(); return; }
      if (ev.target.closest('[data-imprimir]')) { win.print(); return; }
      const sit = ev.target.closest('[data-sit]');
      if (sit) { estado.situacao = K.situacaoValida(sit.dataset.sit); carregar(); return; }
      if (ev.target.closest('a')) return; // número do dia e "+N mais" são links
      irParaODia(ev.target); // clicar no dia (ou numa etiqueta) abre a página do dia
    });
    doc.addEventListener('keydown', ev => { // Enter numa etiqueta abre o dia; o menu abre por botão direito, tecla de menu ou Shift+F10
      if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('li.etq')) irParaODia(ev.target);
    });
    K.ligarMenu(win, { auth: getAuth, recarregar: carregar, docDe: n => estado.pedidos.get(String(n)) });
    carregar();
  }

  return { lerConsulta, iniciar };
});
