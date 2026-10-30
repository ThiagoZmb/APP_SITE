// Menu do botão direito nos pedidos das listas da página Início ("Entregas da semana" e "Últimos pedidos"):
// PDFs, imprimir, abrir para editar, cortes, mudar situação e ver entrega. Mesmas ações e permissões do menu da lista de
// Pedidos e Orçamentos (painel_inicial.html), sem as destrutivas (cancelar/excluir ficam só lá).
// iniciar({ apiBase, loginUrl, token, pode, docDe, recarregar, esc })
(function () {
  'use strict';
  const SITUACOES = ['Em Produção', 'Pronto', 'Entregue', 'Retirado'];
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const ROT_ENTREGA = { a_programar: 'A programar', agendada: 'Agendada', em_rota: 'Em rota', ocorrencia: 'Ocorrência', entregue: 'Entregue', retirado: 'Retirado', enviada: 'Enviada', cancelada: 'Cancelada' };

  function iniciar(cfg) {
    const enc = encodeURIComponent;
    let menu = null, linhaAberta = null;

    const urlPdf = (n, producao) => `${cfg.apiBase}/dados_pdf?numero=${enc(n)}&tipo=Pedido${producao ? '&producao=1' : ''}`;
    const urlVidros = n => `${cfg.apiBase}/dados_pdf_vidros?numero=${enc(n)}`;

    // baixa o PDF com o token, põe num iframe escondido (blob) e chama a impressão do navegador, sem abrir outra aba/página
    async function imprimirPdf(url) {
      let link = null, quadro = null;
      const limpar = () => { if (quadro) quadro.remove(); if (link) URL.revokeObjectURL(link); };
      try {
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + cfg.token() } });
        if (r.status === 401) { localStorage.removeItem('auth'); location.href = cfg.loginUrl; return; }
        if (!r.ok) {
          let msg = ''; try { msg = (await r.json()).error || ''; } catch { /* sem corpo JSON */ }
          throw new Error(r.status === 404 ? (msg || 'Documento não encontrado.') : r.status === 403 ? 'Acesso restrito.' : `Erro ${r.status} no servidor.`);
        }
        link = URL.createObjectURL(await r.blob());
        quadro = document.createElement('iframe');
        quadro.setAttribute('aria-hidden', 'true');
        quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
        quadro.addEventListener('load', () => {
          setTimeout(() => { try { quadro.contentWindow.focus(); quadro.contentWindow.print(); } catch { alert('Não foi possível abrir a impressão. Use "Abrir PDF" e imprima por lá.'); } }, 400);
        });
        quadro.src = link;
        document.body.appendChild(quadro);
        setTimeout(limpar, 5 * 60 * 1000);
      } catch (err) { limpar(); alert('Não foi possível imprimir: ' + err.message); }
    }

    async function mudarSituacao(x, nome) {
      let manterData = false;
      if (nome === 'Entregue' || nome === 'Retirado') {
        // escolha do usuário: atualizar a data de entrega para hoje ou manter a que já está gravada
        const escolha = await window.EscolhaDataEntrega.perguntar({ numero: x.numero, cliente: x.cliente, nome, dataAtual: x.dataEntrega });
        if (!escolha) return;
        manterData = escolha === 'manter';
      } else if (!confirm(`Mudar a situação do pedido nº ${x.numero}${x.cliente ? ' (' + x.cliente + ')' : ''} para "${nome}"?`)) return;
      try {
        const r = await fetch(`${cfg.apiBase}/ped_orc/Pedido/${enc(x.numero)}/situacao`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token() }, body: JSON.stringify({ situacao: nome, ...(manterData ? { manterData: true } : {}) }) });
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
      add('pedidos.pdf', '🏭', 'Guia de produção (PDF sem valores)', () => window.abrirPdfAutenticado(urlPdf(n, true)));
      add('pedidos.pdf', '🪟', 'Vidros (PDF)', () => window.abrirPdfAutenticado(urlVidros(n)));
      sep();
      add('pedidos.pdf', '🖨️', 'Imprimir PDF', () => imprimirPdf(urlPdf(n, false)));
      add('pedidos.pdf', '🖨️', 'Imprimir guia de produção', () => imprimirPdf(urlPdf(n, true)));
      add('pedidos.pdf', '🖨️', 'Imprimir vidros', () => imprimirPdf(urlVidros(n)));
      sep();
      add('orcamentos.criar valores.ver', '✏️', 'Abrir para editar', () => { location.href = `orcamentos.html?abrir=Pedido/${enc(n)}&voltar=inicio.html`; });
      if (!cancelado) {
        add('corte.ver', '✂️', 'Corte de perfil', () => { location.href = `corte.html?numero=${enc(n)}`; });
        add('corte.ver', '🔷', 'Corte de vidros', () => { location.href = `corte_vidros.html?numero=${enc(n)}`; });
      }
      if (!cancelado && cfg.pode('pedidos.situacao')) {
        sep(); L.push({ titulo: 'Mudar situação para' });
        for (const nome of SITUACOES) { const atual = norm(x.situacao) === norm(nome); L.push({ icone: atual ? '✔' : '', rotulo: nome, fn: () => mudarSituacao(x, nome), desativado: atual }); }
      }
      if (x.entregaStatus && cfg.pode('entregas.ver')) {
        sep(); L.push({ icone: '🚚', rotulo: `Ver entrega (${ROT_ENTREGA[x.entregaStatus] || x.entregaStatus})`, fn: () => { location.href = `entregas.html?pedido=${enc(n)}`; } });
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

  window.InicioMenu = { iniciar };
})();
