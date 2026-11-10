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
    const estado = Object.assign({ pedidos: new Map(), consulta: 0, busca: '', termoRolado: '', semanas: [], atual: -1 }, lerConsulta(win.location.search, hoje));

    function desenhar(d) {
      const semanas = K.montarGrade(d.dias, estado.mes, d.hoje || hoje);
      $('cal-titulo').textContent = K.nomeMes(estado.mes);
      $('cal-resumo').textContent = `${d.qtdPedidos} pedido(s) no mês${d.qtdAtrasados ? ` · ${d.qtdAtrasados} atrasado(s)` : ''}`;
      $('cal-visao').innerHTML = K.htmlVisao(estado.visao);
      $('cal-situacao').innerHTML = K.htmlSituacao(estado.situacao);
      $('cal-corpo').dataset.modo = estado.visao;   // não pode ser data-visao: é o atributo dos botões e o closest() pegaria o contêiner
      estado.semanas = semanas;
      $('cal-folha').innerHTML = K.htmlFolha(semanas, estado.situacao, estado.busca);
      $('cal-grade').innerHTML = K.htmlGrade(semanas, estado.situacao, estado.busca);
      $('cal-lista').innerHTML = K.htmlListaDias(semanas, estado.situacao, estado.busca);
      atualizarBusca();
    }

    // Pesquisa: só destaca (dia e pedido); nada sai da tela. Roda sobre o mês já carregado, sem nova consulta.
    // Os três desenhos (lista, grade, lista do celular) existem juntos no HTML; só o que está visível conta para anterior/próximo.
    const achados = () => [...doc.querySelectorAll('#cal-corpo li.achou')].filter(el => el.offsetParent !== null);
    function atualizarBusca() {
      const resultado = K.localizar(estado.semanas.flat(), estado.busca);
      const tem = !!K.normalizarBusca(estado.busca);
      $('cal-busca-resultado').textContent = K.textoBusca(estado.busca, resultado, estado.situacao);
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
    function redesenharBusca(rolar) {
      if (!estado.semanas.length) return;
      $('cal-folha').innerHTML = K.htmlFolha(estado.semanas, estado.situacao, estado.busca);
      $('cal-grade').innerHTML = K.htmlGrade(estado.semanas, estado.situacao, estado.busca);
      $('cal-lista').innerHTML = K.htmlListaDias(estado.semanas, estado.situacao, estado.busca);
      atualizarBusca();
      if (rolar) rolarSeTermoNovo();
    }
    let espera = null;
    const campo = $('cal-busca');
    campo.addEventListener('input', () => { // pequena espera para não redesenhar a cada tecla
      win.clearTimeout(espera);
      espera = win.setTimeout(() => { estado.busca = campo.value; redesenharBusca(true); }, 200);
    });
    function limparBusca() { win.clearTimeout(espera); campo.value = ''; estado.busca = ''; estado.termoRolado = ''; redesenharBusca(); campo.focus(); }
    campo.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { limparBusca(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { win.clearTimeout(espera); estado.busca = campo.value; redesenharBusca(); irParaAchado(ev.shiftKey ? -1 : 1); ev.preventDefault(); }
    });
    $('cal-busca-limpar').addEventListener('click', limparBusca);
    $('cal-busca-ant').addEventListener('click', () => irParaAchado(-1));
    $('cal-busca-prox').addEventListener('click', () => irParaAchado(1));

    async function carregar() {
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

    const irParaODia = el => { const cel = el.closest('.cel[data-dia]'); if (cel) win.location.href = K.urlDia(cel.dataset.dia, estado.situacao); };

    doc.addEventListener('click', ev => {
      const mes = ev.target.closest('[data-mes]');
      if (mes) { estado.mes = mes.dataset.mes === '0' ? K.mesDe(hoje) : K.somarMeses(estado.mes, Number(mes.dataset.mes)); carregar(); return; }
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
