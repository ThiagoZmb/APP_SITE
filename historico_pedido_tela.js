// Janela "Histórico do pedido" do menu do botão direito do Pedido (Pedidos, Início e Calendário).
// Mostra o que a web registrou sobre o pedido (situação, data de pronto, cancelamento, desconto, aviso de preço): data e hora, quem e o texto pronto do servidor
// (GET /ped_orc/Pedido/:numero/historico, somente leitura, sem dinheiro). Mudanças feitas no VB não aparecem.
// Visual: classes `dp-*` (janela) e `hp-*` (tabela) do tema.css, sem estilo na página. Todo texto entra por textContent, nunca como HTML.
// HistoricoPedido.abrir({ numero, apiBase, loginUrl, token: () => string })
(function () {
  'use strict';
  const VAZIO = 'Nenhuma alteração registrada na web para este pedido (mudanças feitas no VB não aparecem aqui).';

  // 'AAAA-MM-DD hh:mm:ss' → 'dd/mm/aaaa hh:mm'; formato inesperado volta como veio (nunca quebra)
  function dataHora(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v ?? ''));
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : String(v ?? '');
  }

  async function buscar(cfg) {
    const r = await fetch(`${cfg.apiBase}/ped_orc/Pedido/${encodeURIComponent(cfg.numero)}/historico`, { headers: { Authorization: 'Bearer ' + cfg.token() } });
    if (r.status === 401) { try { localStorage.removeItem('auth'); } catch { /* sem storage */ } window.location.href = cfg.loginUrl; throw new Error('Sessão expirada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 403 ? 'Acesso restrito.' : d.error || `Erro ${r.status} no servidor.`);
    return Array.isArray(d.eventos) ? d.eventos : [];
  }

  function abrir(cfg) {
    const mk = (tag, cls, txt) => { const el = document.createElement(tag); if (cls) el.className = cls; if (txt !== undefined) el.textContent = txt; return el; };
    const anterior = document.activeElement;

    const fundo = mk('div', 'dp-fundo');
    const caixa = mk('div', 'dp-caixa hp-caixa');
    caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', `Histórico do pedido ${cfg.numero}`);
    const corpo = mk('div', 'hp-corpo');
    corpo.setAttribute('aria-live', 'polite');
    const acoes = mk('div', 'dp-acoes');
    const bFechar = mk('button', 'dp-btn', 'Fechar'); bFechar.type = 'button';
    acoes.append(bFechar);
    caixa.append(mk('div', 'dp-titulo', 'Histórico do pedido'), mk('div', 'dp-sub', `Pedido nº ${cfg.numero}`), corpo, acoes);
    fundo.append(caixa);

    const fecha = () => {
      document.removeEventListener('keydown', teclas, true); fundo.remove();
      if (anterior && anterior.focus) { try { anterior.focus({ preventScroll: true }); } catch { /* elemento sumiu */ } }
    };
    const focaveis = () => [corpo.querySelector('.hp-rolagem'), bFechar].filter(Boolean);
    const teclas = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(); }
      else if (e.key === 'Tab') {
        const itens = focaveis(), i = itens.indexOf(document.activeElement);
        e.preventDefault(); itens[(i + (e.shiftKey ? itens.length - 1 : 1) + itens.length) % itens.length].focus();
      }
    };
    bFechar.addEventListener('click', fecha);
    fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(); });
    document.addEventListener('keydown', teclas, true);
    document.body.append(fundo);
    corpo.append(mk('div', 'hp-msg', 'Carregando...'));
    bFechar.focus();

    buscar(cfg).then(eventos => {
      corpo.textContent = '';
      if (!eventos.length) { corpo.append(mk('div', 'hp-msg', VAZIO)); return; }
      const quadro = mk('div', 'rolagem hp-rolagem'); quadro.tabIndex = 0;
      quadro.setAttribute('role', 'region'); quadro.setAttribute('aria-label', 'Lista de alterações do pedido');
      const tabela = mk('table', 'hp-tabela');
      const cab = mk('tr'); for (const t of ['Data e hora', 'Quem', 'O que mudou']) cab.append(mk('th', '', t));
      tabela.append(mk('thead')); tabela.tHead.append(cab);
      const tb = mk('tbody');
      for (const ev of eventos) {
        const tr = mk('tr');
        tr.append(mk('td', 'hp-quando', dataHora(ev.quando)), mk('td', '', ev.quem), mk('td', '', ev.resumo));
        tb.append(tr);
      }
      tabela.append(tb); quadro.append(tabela); corpo.append(quadro);
    }).catch(err => {
      corpo.textContent = '';
      const m = mk('div', 'hp-msg hp-erro', `Não foi possível carregar o histórico: ${err.message}`); m.setAttribute('role', 'alert');
      corpo.append(m);
    });
  }

  window.HistoricoPedido = { abrir, dataHora };
})();
