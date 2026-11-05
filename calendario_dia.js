// ==========================================================================
// calendario_dia.html — pedidos de UM dia da previsão de finalização (ped_orc.DATA_PRONTO).
// Rota: GET /calendario/dia?data=AAAA-MM-DD&situacao=abertos|todos. Só leitura; as mudanças vêm do menu do botão direito (ou do botão "Ações").
// Funções puras de tela ficam em calendario_comum.js. Regras: docs/regras/calendario-pedidos.md
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.CalendarioDia = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const K = typeof module === 'object' && module.exports ? require('./calendario_comum.js') : raiz.CalendarioComum;

  // ?data=AAAA-MM-DD&situacao=...; data ausente/inválida = null (a tela avisa e oferece voltar ao calendário)
  function lerConsulta(search) {
    const q = new URLSearchParams(search || '');
    const data = q.get('data');
    return { data: K.dataValida(data) ? data : null, situacao: K.situacaoValida(q.get('situacao')) };
  }

  function iniciar(win) {
    const base = K.iniciarComum(win);
    if (!base) return;
    const { doc, $, chamar, toast, getAuth } = base;
    const hoje = K.hojeISO(win);
    const estado = Object.assign({ pedidos: new Map(), consulta: 0 }, lerConsulta(win.location.search));

    function cabecalho() {
      const d = estado.data;
      $('dia-titulo').textContent = d ? K.dataExtenso(d) : 'Data inválida';
      $('dia-voltar').href = K.urlMes(d ? K.mesDe(d) : K.mesDe(hoje), estado.situacao);
      $('dia-anterior').href = d ? K.urlDia(K.somarDias(d, -1), estado.situacao) : K.urlDia(hoje, estado.situacao);
      $('dia-proximo').href = d ? K.urlDia(K.somarDias(d, 1), estado.situacao) : K.urlDia(hoje, estado.situacao);
      $('dia-hoje').href = K.urlDia(hoje, estado.situacao);
      $('dia-situacao').innerHTML = K.htmlSituacao(estado.situacao);
    }

    function desenhar(d) {
      $('dia-resumo').textContent = `${d.qtdPedidos} pedido(s)${d.qtdAtrasados ? ` · ${d.qtdAtrasados} atrasado(s)` : ''}`;
      $('dia-lista').innerHTML = d.pedidos.length ? d.pedidos.map(K.htmlLinhaDia).join('')
        : `<li class="vazio">${estado.situacao === 'abertos' ? 'Nenhum pedido em aberto previsto para este dia.' : 'Nenhum pedido previsto para este dia.'}</li>`;
    }

    async function carregar() {
      cabecalho();
      if (!estado.data) {
        $('dia-lista').innerHTML = '<li class="vazio">Data inválida. Volte ao calendário e escolha um dia.</li>';
        $('dia-resumo').textContent = '';
        return;
      }
      const minha = ++estado.consulta;
      try { win.history.replaceState(null, '', K.urlDia(estado.data, estado.situacao)); } catch { /* sem history: a tela segue */ }
      try {
        const d = await chamar(`/calendario/dia?data=${encodeURIComponent(estado.data)}&situacao=${encodeURIComponent(estado.situacao)}`);
        if (minha !== estado.consulta) return; // resposta de uma consulta antiga
        estado.pedidos = new Map(d.pedidos.map(p => [String(p.numero), p]));
        desenhar(d);
      } catch (err) {
        if (minha === estado.consulta) toast(err.message, 'erro');
      }
    }

    doc.addEventListener('click', ev => {
      const sit = ev.target.closest('[data-sit]');
      if (sit) { estado.situacao = K.situacaoValida(sit.dataset.sit); carregar(); return; }
      const acoes = ev.target.closest('.ld-acoes');
      if (acoes) K.abrirMenuDaLinha(win, acoes.closest('li[data-numero]'));
    });
    K.ligarMenu(win, { auth: getAuth, recarregar: carregar, docDe: n => estado.pedidos.get(String(n)) });
    carregar();
  }

  return { lerConsulta, iniciar };
});
