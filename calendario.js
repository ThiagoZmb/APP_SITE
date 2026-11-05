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
    return { mes: K.mesValido(mes) ? mes : K.mesDe(hoje), situacao: K.situacaoValida(q.get('situacao')) };
  }

  function iniciar(win) {
    const base = K.iniciarComum(win);
    if (!base) return;
    const { doc, $, chamar, toast, getAuth } = base;
    const hoje = K.hojeISO(win);
    const estado = Object.assign({ pedidos: new Map(), consulta: 0 }, lerConsulta(win.location.search, hoje));

    function desenhar(d) {
      const semanas = K.montarGrade(d.dias, estado.mes, d.hoje || hoje);
      $('cal-titulo').textContent = K.nomeMes(estado.mes);
      $('cal-resumo').textContent = `${d.qtdPedidos} pedido(s) no mês${d.qtdAtrasados ? ` · ${d.qtdAtrasados} atrasado(s)` : ''}`;
      $('cal-situacao').innerHTML = K.htmlSituacao(estado.situacao);
      $('cal-grade').innerHTML = K.htmlGrade(semanas, estado.situacao);
      $('cal-lista').innerHTML = K.htmlListaDias(semanas, estado.situacao);
    }

    async function carregar() {
      const minha = ++estado.consulta;
      try { win.history.replaceState(null, '', K.urlMes(estado.mes, estado.situacao)); } catch { /* sem history: a tela segue */ }
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
