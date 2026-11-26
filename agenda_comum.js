// ==========================================================================
// agenda_comum.js — a parte NOVA das duas agendas (Minha semana e Semana compartilhada): categorias com cor, legenda,
// menu da faixa, janelas "Mover para" e "Categorias", confirmação e arraste com Pointer Events (mouse e toque).
// O resto de cada tela continua em tarefas.js e tarefas_admin.js (cópias separadas, escolha do dono).
// Nome de categoria e texto de tarefa só entram na tela por textContent ou value (nunca como HTML). Sem biblioteca externa.
// Funções puras testadas no Node (test/agendas_tela.test.js); as de DOM recebem `doc`/`win`.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.AgendaComum = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- paleta fixa (o banco guarda o código; as cores são variáveis --cat-* do tema.css) ----------
  const CORES = [['vermelho', 'Vermelho'], ['laranja', 'Laranja'], ['amarelo', 'Amarelo'], ['lima', 'Lima'], ['verde', 'Verde'],
    ['turquesa', 'Turquesa'], ['azul', 'Azul'], ['lavanda', 'Lavanda'], ['roxo', 'Roxo'], ['rosa', 'Rosa']].map(([codigo, nome]) => ({ codigo, nome }));
  const corValida = c => CORES.some(x => x.codigo === c);
  const nomeDaCor = c => CORES.find(x => x.codigo === c)?.nome || '';
  const SEM = 'Sem categoria';
  const MAX_NOME = 30;

  // id -> categoria; cor fora da paleta é ignorada (vira neutra)
  const indexar = lista => new Map((Array.isArray(lista) ? lista : []).filter(c => c && Number.isInteger(c.id)).map(c => [c.id, { id: c.id, nome: String(c.nome ?? ''), cor: corValida(c.cor) ? c.cor : '' }]));
  // categoria apagada (ou de outra lista) vale como "Sem categoria"
  const daLista = (id, mapa) => (id && mapa.has(id) ? mapa.get(id) : null);
  const corDe = (id, mapa) => daLista(id, mapa)?.cor || '';
  const nomeDe = (id, mapa) => daLista(id, mapa)?.nome || SEM;

  // mesma limpeza e mesma comparação do servidor (validarCategoria do servidor): uma linha, até 30, sem repetir (maiúsculas e acentos não contam)
  const limparNome = n => String(n ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chaveNome = n => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function conferirNome(nome, categorias, ignorarId = null) {
    const limpo = limparNome(nome);
    if (!limpo) return { ok: false, motivo: 'Escreva o nome da categoria.' };
    if ([...limpo].length > MAX_NOME) return { ok: false, motivo: `O nome pode ter até ${MAX_NOME} caracteres.` };
    if ((categorias || []).some(c => c.id !== ignorarId && chaveNome(c.nome) === chaveNome(limpo))) return { ok: false, motivo: 'Já existe uma categoria com este nome.' };
    return { ok: true, nome: limpo };
  }

  // ---------- legenda: o que está escondido fica guardado NAQUELE navegador (uma chave por página e usuário) ----------
  const chaveLegenda = (id, mapa) => (daLista(id, mapa) ? String(id) : 'sem');
  function criarLegenda(armazem, chave) {
    const ler = () => {
      try {
        const v = JSON.parse(armazem().getItem(chave) || '[]');
        return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
      } catch { return new Set(); }
    };
    let ocultas = ler();
    return {
      ocultas: () => new Set(ocultas),
      visivel: (id, mapa) => !ocultas.has(chaveLegenda(id, mapa)),
      mostrar(k, sim) {
        if (sim) ocultas.delete(k); else ocultas.add(k);
        try { if (ocultas.size) armazem().setItem(chave, JSON.stringify([...ocultas])); else armazem().removeItem(chave); } catch { /* sem armazenamento: vale só nesta visita */ }
      },
      // categoria apagada: a marca dela não fica sobrando no navegador
      podar(mapa) { for (const k of [...ocultas]) if (k !== 'sem' && !mapa.has(Number(k))) this.mostrar(k, true); }
    };
  }

  // ---------- mover ----------
  const lugar = d => `${d.quadro}|${d.quadro === 'dia' ? d.data : ''}`;
  const mesmoLugar = (dados, destino) => lugar(dados) === lugar(destino);
  const corpoMover = destino => ({ quadro: destino.quadro, data: destino.quadro === 'dia' ? destino.data : null });
  // Notas não têm caixinha nem alarme: havendo alarme gravado, a tela pergunta antes (o concluído sai sem perguntar)
  const pedeConfirmacaoNotas = (dados, destino) => destino.quadro === 'notas' && dados.quadro !== 'notas' && !!(dados.temAlarme || dados.alarme);
  // só linha salva e sem nada pendente se arrasta ou se move: o texto digitado nunca anda sem ter sido gravado
  function podeArrastar({ linha, input }) {
    const d = linha.dados;
    if (!d.id || linha.erro || linha.conflito || linha.apagada || input.readOnly) return false;
    if (linha.pendente()) return false;
    return limparTexto(input.value) === d.texto;
  }
  const limparTexto = t => String(t ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
  // a atualização automática da compartilhada espera: arraste em andamento, menu ou janela aberta
  const podeAtualizar = ({ arrastando, menuAberto, janelaAberta }) => !arrastando && !menuAberto && !janelaAberta;
  // rolagem automática perto da borda (celular): mais rápida quanto mais perto; 0 fora da faixa
  function velocidadeRolagem(y, altura, borda = 64, maximo = 18) {
    if (y < borda) return -Math.ceil(maximo * (borda - Math.max(y, 0)) / borda);
    if (y > altura - borda) return Math.ceil(maximo * (Math.min(y, altura) - (altura - borda)) / borda);
    return 0;
  }

  // ---------- rótulo do mês da semana ----------
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  function rotuloMes(inicio) {
    const [a, m, d] = inicio.split('-').map(Number);
    const fim = new Date(Date.UTC(a, m - 1, d + 6));
    const a2 = fim.getUTCFullYear(), m2 = fim.getUTCMonth() + 1;
    if (a === a2 && m === m2) return `${MESES[m - 1]} de ${a}`;
    if (a === a2) return `${MESES[m - 1]} – ${MESES[m2 - 1]} de ${a}`;
    return `${MESES[m - 1]} de ${a} – ${MESES[m2 - 1]} de ${a2}`;
  }
  const SEMANA_CURTA = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom' };

  // ============ DOM ============
  function criarUi(doc, win) {
    const criar = (tag, classe, texto) => {
      const e = doc.createElement(tag);
      if (classe) e.className = classe;
      if (texto !== undefined) e.textContent = texto;
      return e;
    };
    const botao = (classe, rotulo, acao) => { const b = criar('button', classe, rotulo); b.type = 'button'; if (acao) b.addEventListener('click', acao); return b; };
    const amostra = cor => { const s = criar('span', 'ag-amostra'); s.dataset.cor = cor || ''; s.setAttribute('aria-hidden', 'true'); return s; };
    let menuAtual = null;
    let janelas = 0;

    // ---------- janela padrão (DESIGN.md: dlg-padrao); Esc = Cancelar ----------
    function janela({ titulo, subtitulo, aoCancelar }) {
      const dlg = criar('dialog', 'dlg-padrao ag-janela');
      const cab = criar('div', 'dlg-cab'), corpo = criar('div', 'dlg-corpo'), rodape = criar('div', 'dlg-rodape');
      const h = criar('h3', '', titulo);
      h.id = 'ag-janela-' + Math.random().toString(36).slice(2, 8);
      dlg.setAttribute('aria-labelledby', h.id);
      cab.append(h);
      if (subtitulo) cab.append(criar('p', '', subtitulo));
      dlg.append(cab, corpo, rodape);
      let aberta = true;
      const fechar = () => { if (!aberta) return; aberta = false; janelas--; dlg.close(); dlg.remove(); };
      dlg.addEventListener('cancel', ev => { ev.preventDefault(); fechar(); aoCancelar?.(); });
      doc.body.append(dlg);
      janelas++;
      dlg.showModal();
      return { dlg, corpo, rodape, fechar };
    }

    function confirmar({ titulo, texto, sim = 'Confirmar', nao = 'Cancelar', perigo = false }) {
      return new Promise(resolve => {
        const j = janela({ titulo, aoCancelar: () => resolve(false) });
        j.corpo.append(criar('p', 'ag-texto', texto));
        const nb = botao('btn btn-secondary', nao, () => { j.fechar(); resolve(false); });
        const sb = botao(perigo ? 'btn ag-perigo' : 'btn btn-primary', sim, () => { j.fechar(); resolve(true); });
        j.rodape.append(nb, sb);
        nb.focus();
      });
    }

    // ---------- menu da faixa: categoria (escolha única) e "Mover para..." ----------
    function fecharMenu(devolverFoco = true) {
      const m = menuAtual;
      if (!m) return;
      menuAtual = null;
      m.el.remove();
      doc.removeEventListener('pointerdown', m.fora, true);
      win.removeEventListener('resize', m.sair);
      win.removeEventListener('scroll', m.sair, true);
      m.ancora.setAttribute('aria-expanded', 'false');
      if (devolverFoco && m.ancora.isConnected) m.ancora.focus();
    }
    function abrirMenu({ ancora, categorias, atual, aoEscolher, aoMover, aoCategorias }) {
      fecharMenu(false);
      const el = criar('div', 'ag-menu');
      el.setAttribute('role', 'menu');
      el.setAttribute('aria-label', 'Opções do item');
      const titulo = criar('p', 'ag-menu-titulo', 'Categoria');
      titulo.setAttribute('role', 'presentation');
      el.append(titulo);
      const itens = [];
      const opcao = (rotulo, cor, marcado, acao, papel = 'menuitemradio') => {
        const b = botao('ag-menu-item', undefined, () => { fecharMenu(); acao(); });
        b.setAttribute('role', papel);
        b.tabIndex = -1;
        if (papel === 'menuitemradio') { b.setAttribute('aria-checked', String(marcado)); b.append(amostra(cor)); }
        b.append(criar('span', 'ag-menu-rotulo', rotulo));
        if (marcado) b.append(criar('span', 'ag-menu-marca', '✓'));
        el.append(b);
        itens.push(b);
      };
      const lista = [...categorias.values()];
      opcao(SEM, '', !daLista(atual, categorias), () => aoEscolher(null));
      for (const c of lista) opcao(c.nome, c.cor, c.id === atual, () => aoEscolher(c.id));
      el.append(criar('hr', 'ag-menu-sep'));
      opcao('Mover para…', '', false, aoMover, 'menuitem');
      if (aoCategorias) opcao('Editar categorias…', '', false, aoCategorias, 'menuitem');
      doc.body.append(el);
      // posição: embaixo do marcador; sem espaço, em cima; nunca fora da tela
      const r = ancora.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      const x = Math.max(8, Math.min(r.right - w, win.innerWidth - w - 8));
      const y = r.bottom + 4 + h > win.innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      const m = { el, ancora, fora: ev => { if (!el.contains(ev.target) && ev.target !== ancora && !ancora.contains(ev.target)) fecharMenu(false); }, sair: () => fecharMenu(false) };
      menuAtual = m;
      ancora.setAttribute('aria-expanded', 'true');
      doc.addEventListener('pointerdown', m.fora, true);
      win.addEventListener('resize', m.sair);
      win.addEventListener('scroll', m.sair, true);
      el.addEventListener('keydown', ev => {
        const i = itens.indexOf(doc.activeElement);
        const ir = n => { ev.preventDefault(); itens[(n + itens.length) % itens.length].focus(); };
        if (ev.key === 'ArrowDown') ir(i + 1);
        else if (ev.key === 'ArrowUp') ir(i - 1);
        else if (ev.key === 'Home') ir(0);
        else if (ev.key === 'End') ir(itens.length - 1);
        else if (ev.key === 'Escape') { ev.preventDefault(); fecharMenu(); }
        else if (ev.key === 'Tab') fecharMenu(false);
      });
      (itens.find(b => b.getAttribute('aria-checked') === 'true') || itens[0]).focus();
    }

    // ---------- "Mover para...": os dias desta semana, Tarefas, Notas ou outra data ----------
    function abrirMover({ texto, destinos, atual, aoMover }) {
      const j = janela({ titulo: 'Mover para', subtitulo: texto });
      const grupo = criar('div', 'ag-mover');
      grupo.setAttribute('role', 'radiogroup');
      grupo.setAttribute('aria-label', 'Destino');
      const nome = 'ag-destino-' + Math.random().toString(36).slice(2, 8);
      const radios = [];
      const opcao = (rotulo, destino) => {
        const l = criar('label', 'ag-mover-op');
        const r = criar('input');
        r.type = 'radio'; r.name = nome;
        const aqui = destino && mesmoLugar(atual, destino);
        r.disabled = !!aqui;
        l.append(r, criar('span', '', rotulo + (aqui ? ' (aqui)' : '')));
        grupo.append(l);
        radios.push([r, destino]);
        return r;
      };
      for (const d of destinos) opcao(d.rotulo, d);
      const outra = opcao('Outra data', null);
      const campo = criar('input', 'ag-mover-data');
      campo.type = 'date';
      campo.setAttribute('aria-label', 'Outra data');
      campo.addEventListener('input', () => { outra.checked = true; });
      outra.parentNode.append(campo);
      const erro = criar('p', 'ag-erro');
      erro.setAttribute('role', 'alert');
      j.corpo.append(grupo, erro);
      const confirmarMover = () => {
        const escolhido = radios.find(([r]) => r.checked);
        if (!escolhido) { erro.textContent = 'Escolha para onde mover.'; return; }
        let destino = escolhido[1];
        if (!destino) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(campo.value)) { erro.textContent = 'Escolha a data.'; campo.focus(); return; }
          destino = { quadro: 'dia', data: campo.value };
          if (mesmoLugar(atual, destino)) { erro.textContent = 'O item já está nesta data.'; return; }
        }
        j.fechar();
        aoMover(destino);
      };
      j.rodape.append(botao('btn btn-secondary', 'Cancelar', () => j.fechar()), botao('btn btn-primary', 'Mover', confirmarMover));
      campo.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); confirmarMover(); } });
      (radios.find(([r]) => !r.disabled)?.[0] || campo).focus();
    }

    // ---------- "Categorias": criar, renomear, trocar a cor e excluir (com confirmação) ----------
    // `api`: { criar(nome, cor), mudar(id, campos), excluir(id) } devolvem Promise (rejeitam com Error de mensagem simples)
    function abrirCategorias({ categorias, api, subtitulo }) {
      const j = janela({ titulo: 'Categorias', subtitulo });
      const lista = criar('ul', 'ag-cats');
      const msg = criar('p', 'ag-erro');
      msg.setAttribute('role', 'alert');
      const atual = () => [...categorias().values()];
      const falhou = e => { msg.textContent = e?.message || 'Não foi possível salvar.'; };
      function seletorCor(cor, aoTrocar, rotulo) {
        const sel = criar('select', 'ag-cor');
        sel.setAttribute('aria-label', rotulo);
        for (const c of CORES) { const o = criar('option', '', c.nome); o.value = c.codigo; sel.append(o); }
        sel.value = cor || CORES[0].codigo;
        sel.addEventListener('change', () => aoTrocar(sel.value));
        return sel;
      }
      function desenhar() {
        lista.replaceChildren();
        if (!atual().length) lista.append(criar('li', 'ag-cats-vazio', 'Nenhuma categoria ainda.'));
        for (const c of atual()) {
          const li = criar('li', 'ag-cat');
          const pinta = amostra(c.cor);
          const nome = criar('input', 'ag-cat-nome');
          nome.value = c.nome;
          nome.maxLength = MAX_NOME;
          nome.setAttribute('aria-label', 'Nome da categoria');
          const salvarNome = () => {
            const v = conferirNome(nome.value, atual(), c.id);
            if (limparNome(nome.value) === c.nome) { nome.value = c.nome; return; }
            if (!v.ok) { msg.textContent = v.motivo; nome.value = c.nome; return; }
            api.mudar(c.id, { nome: v.nome }).then(() => { msg.textContent = ''; desenhar(); }, e => { falhou(e); desenhar(); });
          };
          nome.addEventListener('change', salvarNome);
          nome.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); nome.blur(); } });
          const sel = seletorCor(c.cor, cor => { pinta.dataset.cor = cor; api.mudar(c.id, { cor }).then(() => { msg.textContent = ''; }, e => { falhou(e); desenhar(); }); }, 'Cor de ' + c.nome);
          const apagar = botao('btn btn-mini ag-cat-excluir', 'Excluir', async () => {
            const ok = await confirmar({ titulo: 'Excluir categoria', sim: 'Excluir', perigo: true,
              texto: `Excluir a categoria “${c.nome}”? Os itens dela ficam “Sem categoria”; nenhum item é apagado.` });
            if (!ok) return;
            api.excluir(c.id).then(() => { msg.textContent = ''; desenhar(); }, e => { falhou(e); desenhar(); });
          });
          apagar.setAttribute('aria-label', 'Excluir ' + c.nome);
          li.append(pinta, nome, sel, apagar);
          lista.append(li);
        }
      }
      // nova categoria: nome e uma das 10 cores (amostras como botões de opção)
      const nova = criar('form', 'ag-cat-nova');
      nova.noValidate = true;
      const campo = criar('input', 'ag-cat-nome');
      campo.maxLength = MAX_NOME;
      campo.placeholder = 'Nome da nova categoria';
      campo.setAttribute('aria-label', 'Nome da nova categoria');
      const paleta = criar('div', 'ag-paleta');
      paleta.setAttribute('role', 'radiogroup');
      paleta.setAttribute('aria-label', 'Cor da nova categoria');
      const nomeGrupo = 'ag-cor-' + Math.random().toString(36).slice(2, 8);
      for (const [i, c] of CORES.entries()) {
        const l = criar('label', 'ag-paleta-op');
        const r = criar('input');
        r.type = 'radio'; r.name = nomeGrupo; r.value = c.codigo; r.checked = i === 0;
        r.setAttribute('aria-label', c.nome);
        l.title = c.nome;
        l.append(r, amostra(c.codigo));
        paleta.append(l);
      }
      const adicionar = botao('btn btn-primary', 'Adicionar');
      adicionar.type = 'submit';
      nova.append(campo, paleta, adicionar);
      nova.addEventListener('submit', ev => {
        ev.preventDefault();
        const v = conferirNome(campo.value, atual());
        if (!v.ok) { msg.textContent = v.motivo; campo.focus(); return; }
        const cor = paleta.querySelector('input:checked')?.value || CORES[0].codigo;
        adicionar.disabled = true;
        api.criar(v.nome, cor).then(() => { msg.textContent = ''; campo.value = ''; desenhar(); }, falhou).finally(() => { adicionar.disabled = false; campo.focus(); });
      });
      j.corpo.append(nova, msg, lista);
      j.rodape.append(botao('btn btn-secondary', 'Fechar', () => j.fechar()));
      desenhar();
      campo.focus();
    }

    // ---------- legenda: marcar e desmarcar mostra e esconde a categoria ----------
    function desenharLegenda(alvo, { categorias, legenda, aoMudar }) {
      alvo.replaceChildren();
      const lista = [...categorias.values()];
      alvo.hidden = !lista.length;
      if (!lista.length) return;
      const item = (k, nome, cor) => {
        const l = criar('label', 'ag-leg');
        const c = criar('input');
        c.type = 'checkbox';
        c.checked = !legenda.ocultas().has(k);
        c.addEventListener('change', () => { legenda.mostrar(k, c.checked); aoMudar(); });
        l.append(c, amostra(cor), criar('span', 'ag-leg-nome', nome));
        alvo.append(l);
      };
      for (const c of lista) item(String(c.id), c.nome, c.cor);
      item('sem', SEM, '');
    }

    // ---------- arraste (Pointer Events): pela alça; mouse começa ao mover, toque ao segurar ou mover ----------
    // Esc, pointercancel ou soltar fora de um quadro desfazem. Durante o arraste a tela rola perto da borda.
    function ligarArraste({ raiz, podeArrastar: pode, aoNegar, aoSoltar, aoMudar, seletorAlca = '.alca', seletorAlvo = '.quadro' }) {
      let st = null;
      const fim = () => {
        if (!st) return;
        const s = st;
        st = null;
        win.clearTimeout(s.timer);
        win.cancelAnimationFrame(s.raf);
        s.fantasma?.remove();
        s.li.classList.remove('arrastando');
        s.alvo?.classList.remove('alvo-soltar');
        try { s.alca.releasePointerCapture(s.id); } catch { /* já solta */ }
        doc.removeEventListener('keydown', s.tecla, true);
        if (s.ativo) aoMudar?.(false);
        return s;
      };
      const marcarAlvo = () => {
        const el = doc.elementFromPoint(st.x, st.y);
        const q = el?.closest?.(seletorAlvo);
        const novo = q && raiz.contains(q) ? q : null;
        if (novo === st.alvo) return;
        st.alvo?.classList.remove('alvo-soltar');
        st.alvo = novo;
        novo?.classList.add('alvo-soltar');
      };
      const posicionar = () => { st.fantasma.style.transform = `translate(${st.x - st.dx}px, ${st.y - st.dy}px)`; };
      const rolar = () => {
        if (!st?.ativo) return;
        const v = velocidadeRolagem(st.y, win.innerHeight);
        if (v) { win.scrollBy(0, v); marcarAlvo(); }
        st.raf = win.requestAnimationFrame(rolar);
      };
      const comecar = () => {
        if (!st || st.ativo) return;
        st.ativo = true;
        const r = st.li.getBoundingClientRect();
        st.dx = st.x0 - r.left; st.dy = st.y0 - r.top;
        const f = criar('div', 'ag-fantasma');
        f.dataset.cor = st.li.dataset.cor || '';
        f.style.width = r.width + 'px';
        f.textContent = st.texto;
        f.setAttribute('aria-hidden', 'true');
        doc.body.append(f);
        st.fantasma = f;
        st.li.classList.add('arrastando');
        posicionar();
        marcarAlvo();
        aoMudar?.(true);
        st.raf = win.requestAnimationFrame(rolar);
      };
      raiz.addEventListener('pointerdown', ev => {
        const alca = ev.target?.closest?.(seletorAlca);
        if (!alca || !raiz.contains(alca) || st || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
        const li = alca.closest('li');
        ev.preventDefault();   // sem seleção de texto nem foco roubado
        if (!pode(li)) { aoNegar?.(li); return; }
        st = { li, alca, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, ativo: false, alvo: null,
          texto: li.querySelector('textarea')?.value || '', timer: 0, raf: 0,
          tecla: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fim(); } } };
        try { alca.setPointerCapture(ev.pointerId); } catch { /* navegador antigo */ }
        doc.addEventListener('keydown', st.tecla, true);
        if (ev.pointerType !== 'mouse') st.timer = win.setTimeout(comecar, 180);   // toque: segurar a alça
      });
      raiz.addEventListener('pointermove', ev => {
        if (!st || ev.pointerId !== st.id) return;
        st.x = ev.clientX; st.y = ev.clientY;
        if (!st.ativo && Math.hypot(st.x - st.x0, st.y - st.y0) > 5) comecar();
        if (!st.ativo) return;
        ev.preventDefault();
        posicionar();
        marcarAlvo();
      });
      raiz.addEventListener('pointerup', ev => {
        if (!st || ev.pointerId !== st.id) return;
        const s = fim();
        if (s.ativo && s.alvo) aoSoltar(s.li, s.alvo);
      });
      raiz.addEventListener('pointercancel', ev => { if (st && ev.pointerId === st.id) fim(); });
      raiz.addEventListener('lostpointercapture', ev => { if (st && ev.pointerId === st.id && !st.ativo) fim(); });
      return { ativo: () => !!st?.ativo, cancelar: fim };
    }

    return {
      confirmar, abrirMenu, fecharMenu, abrirMover, abrirCategorias, desenharLegenda, ligarArraste, amostra,
      menuAberto: () => !!menuAtual,
      janelaAberta: () => janelas > 0
    };
  }

  return { CORES, SEM, MAX_NOME, corValida, nomeDaCor, indexar, corDe, nomeDe, limparNome, conferirNome, chaveLegenda, criarLegenda,
    mesmoLugar, corpoMover, pedeConfirmacaoNotas, podeArrastar, podeAtualizar, velocidadeRolagem, rotuloMes, SEMANA_CURTA, criarUi };
});
