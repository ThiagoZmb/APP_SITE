// Menu do botão direito com SUBMENUS (Pedidos e Orçamentos, Início e Calendário). Compartilhado por inicio_menu.js e painel_inicial.html.
// Itens: { icone, rotulo, fn, desativado?, perigo? } | { sep: true } | { titulo } | folha com `grupo` (e `iconeGrupo`): folhas seguidas
// com o MESMO `grupo` viram um item principal ("Imprimir", "Mudar situação") que abre um submenu na mesma tela.
//   MenuContexto.montar(itens, esc)  -> { html, folhas }   (data-i = posição em `folhas`; o pai tem data-grupo)
//   MenuContexto.ligar(menu, { folhas, aoEscolher(item), fechar(devolverFoco) })  (clique, toque, mouse, teclado)
// Acessibilidade: pai com role=menuitem + aria-haspopup="menu" + aria-expanded; submenu com role=menu. Setas, Enter/Espaço, Esc, Home/End.
(function () {
  'use strict';

  function montar(itens, esc) {
    const folhas = [];
    let html = '', seq = 0;
    const botao = it => {
      const i = folhas.push(it) - 1;
      return `<button type="button" role="menuitem" data-i="${i}"${it.perigo ? ' class="mc-perigo"' : ''}${it.desativado ? ' disabled' : ''}><span class="mc-ic">${esc(it.icone || '')}</span>${esc(it.rotulo)}</button>`;
    };
    for (let k = 0; k < itens.length; k++) {
      const it = itens[k];
      if (it.sep) html += '<div class="mc-sep" role="separator"></div>';
      else if (it.titulo) html += `<div class="mc-tit">${esc(it.titulo)}</div>`;
      else if (it.grupo) {
        const nome = it.grupo, filhos = [];
        while (k < itens.length && itens[k].grupo === nome) filhos.push(itens[k++]);
        k--;
        const id = `mc-sub-${++seq}`;
        html += `<div class="mc-grupo"><button type="button" role="menuitem" class="mc-pai" data-grupo="${id}" aria-haspopup="menu" aria-expanded="false" aria-controls="${id}">`
          + `<span class="mc-ic">${esc(it.iconeGrupo || '')}</span>${esc(nome)}<span class="mc-seta" aria-hidden="true">›</span></button>`
          + `<div class="mc-sub" id="${id}" role="menu" aria-label="${esc(nome)}" hidden>${filhos.map(botao).join('')}</div></div>`;
      } else html += botao(it);
    }
    return { html, folhas };
  }

  function ligar(m, cfg) {
    const doc = m.ownerDocument || document;
    const subDoPai = pai => m.querySelector('#' + pai.getAttribute('aria-controls'));
    const pais = () => [...m.querySelectorAll('.mc-pai')];
    const habilitados = raiz => [...raiz.querySelectorAll('button:not([disabled])')];
    const topo = () => habilitados(m).filter(b => !b.closest('.mc-sub'));

    function posicionar(pai, sub) {
      const r = pai.getBoundingClientRect(), w = sub.offsetWidth, h = sub.offsetHeight;
      const L = window.innerWidth, A = window.innerHeight;
      let left = r.right - 4;                                  // à direita do item
      if (left + w > L - 8) left = r.left - w + 4;             // sem espaço: abre à esquerda
      left = Math.max(8, Math.min(left, L - w - 8));           // e nunca sai da tela
      const top = Math.max(8, Math.min(r.top - 6, A - h - 8));
      sub.style.left = left + 'px'; sub.style.top = top + 'px';
    }
    function fecharSub(pai) {
      const sub = subDoPai(pai);
      if (sub) sub.hidden = true;
      pai.setAttribute('aria-expanded', 'false');
    }
    function fecharSubs(exceto) { for (const p of pais()) if (p !== exceto) fecharSub(p); }
    function abrirSub(pai, focarPrimeiro) {
      fecharSubs(pai);
      const sub = subDoPai(pai);
      if (!sub) return;
      sub.hidden = false;
      pai.setAttribute('aria-expanded', 'true');
      posicionar(pai, sub);
      if (focarPrimeiro) { const b = habilitados(sub)[0]; if (b) b.focus({ preventScroll: true }); }
    }
    const algumAberto = () => pais().some(p => p.getAttribute('aria-expanded') === 'true');

    m.addEventListener('click', e => {
      const pai = e.target.closest('.mc-pai');
      if (pai) { abrirSub(pai, true); return; }            // toque ou clique: abre e vai para o primeiro item
      const b = e.target.closest('button[data-i]');
      if (!b || b.disabled) return;
      const it = cfg.folhas[Number(b.dataset.i)];
      cfg.fechar(true);
      if (it && cfg.aoEscolher) cfg.aoEscolher(it);
    });

    // mouse: passar o ponteiro abre o submenu; passar por outro item do menu principal fecha (toque não entra aqui: pointerType)
    m.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return;
      const b = e.target.closest && e.target.closest('button');
      if (!b || b.closest('.mc-sub')) return;
      if (b.classList.contains('mc-pai')) { if (b.getAttribute('aria-expanded') !== 'true') abrirSub(b, false); } else fecharSubs(null);
    });

    m.addEventListener('keydown', e => {
      const ativo = doc.activeElement;
      const subAtual = ativo && ativo.closest ? ativo.closest('.mc-sub') : null;
      const lista = subAtual ? habilitados(subAtual) : topo();
      if (!lista.length) return;
      const i = lista.indexOf(ativo);
      if (e.key === 'ArrowDown') { e.preventDefault(); lista[(i + 1) % lista.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); lista[(i - 1 + lista.length) % lista.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); lista[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); lista[lista.length - 1].focus(); }
      else if (e.key === 'ArrowRight' && ativo && ativo.classList.contains('mc-pai')) { e.preventDefault(); abrirSub(ativo, true); }
      else if (e.key === 'ArrowLeft' && subAtual) {
        e.preventDefault();
        const pai = pais().find(p => subDoPai(p) === subAtual);
        if (pai) { fecharSub(pai); pai.focus({ preventScroll: true }); }
      } else if (e.key === 'Escape' && algumAberto()) {
        // Esc fecha primeiro o submenu (e devolve o foco ao item principal); outro Esc fecha o menu todo
        e.preventDefault(); e.stopPropagation();
        const pai = subAtual ? pais().find(p => subDoPai(p) === subAtual) : pais().find(p => p.getAttribute('aria-expanded') === 'true');
        fecharSubs(null);
        if (pai) pai.focus({ preventScroll: true });
      } else if (e.key === 'Tab') { e.preventDefault(); cfg.fechar(true); }
    });
  }

  window.MenuContexto = { montar, ligar };
})();
