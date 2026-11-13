// Menu do botão direito nos pedidos das listas da página Início ("Entregas da semana" e "Últimos pedidos"):
// PDFs, imprimir, abrir para editar, cortes, mudar situação e ver entrega. Mesmas ações e permissões do menu da lista de
// Pedidos e Orçamentos (painel_inicial.html), sem as destrutivas (cancelar/excluir ficam só lá).
// iniciar({ apiBase, loginUrl, token, pode, docDe, recarregar, esc, voltar? })  (voltar = página para onde "Abrir para editar" volta; padrão inicio.html)
(function () {
  'use strict';
  const SITUACOES = ['Em Produção', 'Pronto', 'Entregue', 'Retirado'];
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const ROT_ENTREGA = { a_programar: 'A programar', agendada: 'Agendada', em_rota: 'Em rota', ocorrencia: 'Ocorrência', entregue: 'Entregue', retirado: 'Retirado', enviada: 'Enviada', cancelada: 'Cancelada' };
  // várias entregas por pedido: "1 de 2 entregues" só quando o pedido tem mais de uma entrega não cancelada
  const andamentoEntregas = x => (Number(x && x.qtdEntregas) > 1 ? `${Number(x.qtdEntregasConcluidas) || 0} de ${Number(x.qtdEntregas)} entregues` : '');
  // pergunta do menu "Entregue/Retirado" com entrega aberta: diz o que acontece com cada uma (encerrar = A programar/Agendada/Ocorrência,
  // encerradas junto como o pedido; emCurso = Em rota/Enviada, que continuam abertas). Sem as contagens (servidor antigo) = texto curto.
  const avisoEntregasAbertas = (n, nome, encerrar, emCurso) => {
    const e = Number(encerrar) || 0, c = Number(emCurso) || 0;
    return `Este pedido tem ${Number(n) || 0} entrega(s) em aberto.`
      + (e ? ` ${e} (a programar, agendada ou com ocorrência) ${e === 1 ? 'será encerrada' : 'serão encerradas'} junto como ${nome}.` : '')
      + (c ? ` ${c} em rota/enviada ${c === 1 ? 'continua aberta' : 'continuam abertas'}: conclua ou cancele na tela de Entregas.` : '')
      + ` Marcar como ${nome} mesmo assim?`;
  };

  function iniciar(cfg) {
    const enc = encodeURIComponent;
    let menu = null, linhaAberta = null;

    const urlPdf = (n, producao) => `${cfg.apiBase}/dados_pdf?numero=${enc(n)}&tipo=Pedido${producao ? '&producao=1' : ''}`;
    const urlVidros = n => `${cfg.apiBase}/dados_pdf_vidros?numero=${enc(n)}`;

    // impressão direta (impressao_pdf.js): serviço do PC sem diálogo, ou iframe oculto + print() do navegador; nunca abre outra aba
    const imprimirPdf = url => window.ImpressaoPdf.imprimirComAviso(url, cfg);

    async function mudarSituacao(x, nome) {
      let manterData = false, usarDataPronto = false, dataEscolhida = '';
      if (nome === 'Entregue' || nome === 'Retirado') {
        // escolha do usuário: atualizar a data de entrega para hoje ou manter a que já está gravada
        const escolha = await window.EscolhaDataEntrega.perguntar({ numero: x.numero, cliente: x.cliente, nome, dataAtual: x.dataEntrega, dataPronto: x.prontoEm });
        if (!escolha) return;
        manterData = escolha === 'manter'; usarDataPronto = escolha === 'pronto';
        dataEscolhida = (/^data:(\d{4}-\d{2}-\d{2})$/.exec(escolha) || [])[1] || '';
      } else if (!confirm(`Mudar a situação do pedido nº ${x.numero}${x.cliente ? ' (' + x.cliente + ')' : ''} para "${nome}"?`)) return;
      try {
        // com entrega ainda aberta o servidor AVISA (409 + aviso 'entregas_abertas'); confirmado, reenvia com confirmarEntregasAbertas
        const enviar = confirmarAbertas => fetch(`${cfg.apiBase}/ped_orc/Pedido/${enc(x.numero)}/situacao`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token() }, body: JSON.stringify({ situacao: nome, ...(manterData ? { manterData: true } : {}), ...(usarDataPronto ? { usarDataPronto: true } : {}), ...(dataEscolhida ? { dataEntrega: dataEscolhida } : {}),
            ...(confirmarAbertas ? { confirmarEntregasAbertas: true } : {}) }) });
        let r = await enviar(false);
        if (r.status === 401) { localStorage.removeItem('auth'); location.href = cfg.loginUrl; return; }
        let d = await r.json().catch(() => ({}));
        if (r.status === 409 && d.aviso === 'entregas_abertas') {
          if (!confirm(avisoEntregasAbertas(d.entregasAbertas, nome, d.entregasEncerrar, d.entregasEmCurso))) return;
          r = await enviar(true);
          if (r.status === 401) { localStorage.removeItem('auth'); location.href = cfg.loginUrl; return; }
          d = await r.json().catch(() => ({}));
        }
        if (!r.ok) throw new Error(d.error || `Erro HTTP: ${r.status}`);
        cfg.recarregar();
      } catch (err) { alert(err.message); }
    }

    async function alterarDataPronto(x) {
      const nova = await window.AlterarDataPronto.perguntar({ tipo: 'Pedido', numero: x.numero, cliente: x.cliente, dataAtual: x.prontoEm });
      if (!nova) return;
      try {
        const r = await fetch(`${cfg.apiBase}/ped_orc/Pedido/${enc(x.numero)}/data_pronto`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token() }, body: JSON.stringify({ dataPronto: nova }) });
        if (r.status === 401) { localStorage.removeItem('auth'); location.href = cfg.loginUrl; return; }
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Erro HTTP: ${r.status}`);
        cfg.recarregar();
      } catch (err) { alert(err.message); }
    }

    function itensDoMenu(x) {
      const n = x.numero, L = [], cancelado = norm(x.situacao).includes('cancel');
      const add = (perm, icone, rotulo, fn, extra = {}) => { if (!perm || cfg.pode(perm)) L.push({ icone, rotulo, fn, ...extra }); };
      const sep = () => { if (L.length && !L[L.length - 1].sep) L.push({ sep: true }); };
      add('pedidos.pdf', '📄', 'Abrir PDF', () => window.abrirPdfAutenticado(urlPdf(n, false)));
      add('pedidos.pdf', '🏭', 'Guia de produção', () => window.abrirPdfAutenticado(urlPdf(n, true)));
      add('pedidos.pdf', '🪟', 'Vidros (PDF)', () => window.abrirPdfAutenticado(urlVidros(n)));
      // nota fiscal (DANFE) do pedido; o servidor confere a permissão e os estados do usuário
      add('danfe.ver', '🧾', 'Abrir nota fiscal (DANFE)', () => window.DanfePedido.abrir(n, { apiBase: cfg.apiBase, loginUrl: cfg.loginUrl, token: cfg.token, pode: cfg.pode }));
      sep();
      add('pedidos.pdf', '🖨️', 'Imprimir PDF', () => imprimirPdf(urlPdf(n, false)));
      add('pedidos.pdf', '🖨️', 'Imprimir guia de produção', () => imprimirPdf(urlPdf(n, true)));
      add('pedidos.pdf', '🖨️', 'Imprimir vidros', () => imprimirPdf(urlVidros(n)));
      add('pedidos.pdf', '🏷️', 'Imprimir etiquetas (Zebra)', () => window.EtiquetaZebra.imprimir(n, { apiBase: cfg.apiBase, loginUrl: cfg.loginUrl, token: cfg.token }));
      add('pedidos.checklist', '✅', 'Imprimir checklist', () => imprimirPdf(`${cfg.apiBase}/checklist/pdf`));
      sep();
      add('orcamentos.criar valores.ver', '✏️', 'Abrir para editar', () => { location.href = `orcamentos.html?abrir=Pedido/${enc(n)}&voltar=${enc(cfg.voltar || 'inicio.html')}`; });
      if (!cancelado) add('orcamentos.criar valores.ver', '💲', 'Ajustar desconto adicional', () => window.AjustarDesconto.abrir({ numero: n, apiBase: cfg.apiBase, loginUrl: cfg.loginUrl, token: cfg.token, recarregar: cfg.recarregar }));
      if (!cancelado) {
        add('corte.ver', '✂️', 'Corte de perfil', () => { location.href = `corte.html?numero=${enc(n)}`; });
        add('corte.ver', '🔷', 'Corte de vidros', () => { location.href = `corte_vidros.html?numero=${enc(n)}`; });
      }
      if (!cancelado && cfg.pode('pedidos.situacao')) {
        sep(); add(null, '📅', 'Alterar data de pronto', () => alterarDataPronto(x));
        sep(); L.push({ titulo: 'Mudar situação para' });
        for (const nome of SITUACOES) { const atual = norm(x.situacao) === norm(nome); L.push({ icone: atual ? '✔' : '', rotulo: nome, fn: () => mudarSituacao(x, nome), desativado: atual }); }
      }
      // histórico do pedido (web_auditoria): quem mudou a situação/data de pronto e quando; o servidor confere permissão e estados
      sep(); add('pedidos.ver', '🕘', 'Histórico do pedido', () => window.HistoricoPedido.abrir({ numero: n, apiBase: cfg.apiBase, loginUrl: cfg.loginUrl, token: cfg.token }));
      if (x.entregaStatus && cfg.pode('entregas.ver')) {
        // com várias entregas abre a lista de TODAS as entregas do pedido (entregas.html?pedido=N)
        const andamento = andamentoEntregas(x);
        sep(); L.push({ icone: '🚚', rotulo: andamento ? `Ver entregas (${andamento})` : `Ver entrega (${ROT_ENTREGA[x.entregaStatus] || x.entregaStatus})`, fn: () => { location.href = `entregas.html?pedido=${enc(n)}`; } });
      }
      // pedido Pronto ou Em Produção ainda sem entrega: cria e programa a partir daqui (regra do dono, 2026-11-11)
      if (!x.entregaStatus && ['pronto', 'em producao'].includes(norm(x.situacao)) && cfg.pode('entregas.programar')) {
        sep(); L.push({ icone: '🚚', rotulo: 'Programar entrega', fn: () => { location.href = `entregas.html?criar=${enc(n)}`; } });
      }
      while (L.length && L[L.length - 1].sep) L.pop();
      return L;
    }

    function fechar(devolverFoco) {
      if (menu) { menu.remove(); menu = null; }
      if (linhaAberta) { linhaAberta.classList.remove('ctx'); if (devolverFoco) linhaAberta.focus?.({ preventScroll: true }); linhaAberta = null; }
    }

    function abrir(ev, li) {
      const x = cfg.docDe(li.dataset.numero);
      if (!x) return;
      ev.preventDefault();
      fechar();
      const itens = itensDoMenu(x);
      if (!itens.length) return;
      const m = document.createElement('div');
      m.id = 'menu-ctx'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', `Ações do pedido ${x.numero}`);
      m.innerHTML = `<div class="mc-cab">Pedido nº ${cfg.esc(x.numero)} · ${cfg.esc(x.cliente || '')}</div>` + itens.map((it, i) =>
        it.sep ? '<div class="mc-sep" role="separator"></div>'
          : it.titulo ? `<div class="mc-tit">${cfg.esc(it.titulo)}</div>`
            : `<button type="button" role="menuitem" data-i="${i}"${it.desativado ? ' disabled' : ''}><span class="mc-ic">${cfg.esc(it.icone || '')}</span>${cfg.esc(it.rotulo)}</button>`).join('');
      m.addEventListener('click', e => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        const it = itens[Number(b.dataset.i)];
        fechar(true);
        if (it && it.fn) it.fn();
      });
      m.addEventListener('keydown', e => {
        const bs = [...m.querySelectorAll('button:not([disabled])')];
        const i = bs.indexOf(document.activeElement);
        if (!bs.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); bs[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); bs[bs.length - 1].focus(); }
        else if (e.key === 'Tab') { e.preventDefault(); fechar(true); }
      });
      document.body.appendChild(m);
      const ref = li.getBoundingClientRect();
      const x0 = ev.clientX || ref.left, y0 = ev.clientY || ref.top + 20;
      m.style.left = Math.max(8, Math.min(x0, window.innerWidth - m.offsetWidth - 8)) + 'px';
      m.style.top = Math.max(8, Math.min(y0, window.innerHeight - m.offsetHeight - 8)) + 'px';
      menu = m; linhaAberta = li; li.classList.add('ctx');
      const primeiro = m.querySelector('button:not([disabled])');
      if (primeiro) primeiro.focus({ preventScroll: true });
    }

    document.addEventListener('contextmenu', e => { const li = e.target.closest('li[data-numero]'); if (li) abrir(e, li); });
    document.addEventListener('mousedown', e => { if (menu && !menu.contains(e.target)) fechar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu) fechar(true); });
    document.addEventListener('scroll', () => fechar(), true);
    window.addEventListener('resize', () => fechar());
    window.addEventListener('blur', () => fechar());
    return { itensDoMenu, fechar };
  }

  window.InicioMenu = { iniciar, andamentoEntregas, avisoEntregasAbertas };
})();
