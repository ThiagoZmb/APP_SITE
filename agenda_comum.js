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
  // horário dos itens dos dias (a mesma conta do servidor): calculo/agenda_horario.js, carregado antes deste arquivo
  const AH = typeof module === 'object' && module.exports ? require('./calculo/agenda_horario.js') : self.AgendaHorario;

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
  // `destino.horario`: undefined = mantém o horário; null = dia todo; { inicio, fim } = novo horário (só nos dias)
  const corpoMover = destino => ({ quadro: destino.quadro, data: destino.quadro === 'dia' ? destino.data : null,
    ...(destino.quadro === 'dia' && destino.horario !== undefined ? { horario: destino.horario } : {}) });

  // ---------- horário e grade (tela larga) ----------
  const PX_HORA = 48;                 // altura de uma hora na grade (o CSS usa a mesma, --ag-hora)
  const PX_MIN = PX_HORA / 60;
  const ALTO_MIN = 20;                // item curto continua clicável
  const LARGURA_GRADE = 760;          // área da semana (sem o menu lateral e a coluna de categorias); ~99px por dia no mínimo
  const ALTO_GRADE_MIN = 320;         // janela baixa: a página rola
  const FOLGA_BAIXO = 12;
  const mesmoHorario = (a, b) => (!a && !b) || (!!a && !!b && a.inicio === b.inicio && a.fim === b.fim);
  // "Horário..." só em item salvo dos dias
  const podeHorario = d => !!(d && d.id) && d.quadro === 'dia';
  // grade só com largura e fora do celular; no estreito, lista por dia ("dia todo" primeiro, depois por horário)
  const querGrade = (largura, celular) => largura >= LARGURA_GRADE && !celular;
  // posição do item na coluna do dia: topo e altura pelo horário; sobrepostos dividem a largura (calculo/agenda_horario.js distribuir)
  function estiloGrade(h, { col = 0, cols = 1 } = {}) {
    const i = AH.paraMin(h.inicio), f = AH.paraMin(h.fim);
    const p = n => `${(n * 100).toFixed(4)}%`;
    return { top: `${i * PX_MIN}px`, height: `${Math.max((f - i) * PX_MIN, ALTO_MIN)}px`, left: `calc(${p(col / cols)} + 1px)`, width: `calc(${p(1 / cols)} - 3px)`, curto: f - i < 45 };
  }
  // a grade vai do topo dela (na página) até o fim da janela
  const alturaGrade = (janela, topo) => Math.max(ALTO_GRADE_MIN, Math.floor(janela - topo - FOLGA_BAIXO));
  // Abre a grade em `alvo` (perto das 07:00, ou onde a pessoa deixou). O navegador descarta o scrollTop pedido enquanto a grade
  // não tem layout: enquanto não pegar, tenta de novo (próximo quadro, quando ela ganhar tamanho ou quando a tela chamar
  // aplicar()). Depois que pega não mexe mais; `aoRolar(topo)` guarda a posição para a próxima montagem.
  function manterRolagem(el, win, { alvo, aoRolar }) {
    let pronta = false, observador = null;
    el.addEventListener('scroll', () => { if (pronta) aoRolar?.(el.scrollTop); });
    const aplicar = () => {
      if (pronta) return true;
      if (!el.clientHeight || el.scrollHeight <= el.clientHeight) return false;
      pronta = true;
      observador?.disconnect();
      el.scrollTop = alvo;
      return true;
    };
    if (!aplicar()) {
      if (win.ResizeObserver) {
        observador = new win.ResizeObserver(aplicar);
        observador.observe(el);
        if (el.firstElementChild) observador.observe(el.firstElementChild);
      }
      win.requestAnimationFrame?.(aplicar);
    }
    return { aplicar };
  }
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
  // ---------- repetição (série) ----------
  // a pergunta "só este / este e os próximos / todos" só aparece em item de série cujo texto mudou de verdade (apagar = texto vazio)
  const precisaEscopo = (dados, textoNovo) => !!(dados && dados.id && dados.serieId) && limparTexto(textoNovo) !== dados.texto;
  // "Repetir..." só para item salvo dos dias ou de Tarefas que ainda não está numa série
  const podeRepetir = dados => !!(dados && dados.id) && dados.quadro !== 'notas' && !dados.serieId;
  // resumo depois de uma mudança em série (a resposta do servidor: alteradas/apagadas, concluídas e diferentes)
  function resumoSerie(serie) {
    if (!serie) return '';
    const n = x => `${x} ${x === 1 ? 'item' : 'itens'}`;
    const partes = [];
    if (serie.apagadas) partes.push(`Apagado${serie.apagadas.length === 1 ? '' : 's'} ${n(serie.apagadas.length)} da série.`);
    else if (serie.alteradas) partes.push(`Mudou em ${n(serie.alteradas.length)} da série.`);
    if (serie.concluidas) partes.push(`${n(serie.concluidas)} já ${serie.concluidas === 1 ? 'concluído ficou' : 'concluídos ficaram'}.`);
    if (serie.diferentes) partes.push(`${n(serie.diferentes)} ${serie.diferentes === 1 ? 'ficou' : 'ficaram'} como ${serie.diferentes === 1 ? 'estava' : 'estavam'}, porque alguém ${serie.diferentes === 1 ? 'o deixou diferente' : 'os deixou diferentes'}.`);
    return partes.join(' ');
  }
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

    // ---------- janela padrão (DESIGN.md: dlg-padrao); Esc = Cancelar (menos enquanto `ocupada()`: gravação em andamento) ----------
    function janela({ titulo, subtitulo, aoCancelar, ocupada }) {
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
      dlg.addEventListener('cancel', ev => { ev.preventDefault(); if (ocupada?.()) return; fechar(); aoCancelar?.(); });
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

    // ---------- item de série: a mudança vale só para este, para este e os próximos ou para todos? ----------
    // Resolve 'este' | 'proximos' | 'todos', ou null (Cancelar ou Esc: nada é gravado e o texto digitado fica no campo).
    function perguntarEscopo({ titulo, texto, nota }) {
      return new Promise(resolve => {
        const j = janela({ titulo, aoCancelar: () => resolve(null) });
        j.corpo.append(criar('p', 'ag-texto', texto));
        if (nota) j.corpo.append(criar('p', 'ag-nota', nota));
        const opcoes = criar('div', 'ag-escopo');
        const op = (rotulo, valor) => botao(valor === 'este' ? 'btn btn-primary' : 'btn btn-secondary', rotulo, () => { j.fechar(); resolve(valor); });
        const so = op('Só este', 'este');
        opcoes.append(so, op('Este e os próximos', 'proximos'), op('Todos', 'todos'));
        j.corpo.append(opcoes);
        j.rodape.append(botao('btn btn-secondary', 'Cancelar', () => { j.fechar(); resolve(null); }));
        so.focus();
      });
    }

    // ---------- "Repetir...": todos os dias (de/até, pular fins de semana) ou todo mês (dia N, por X meses) ----------
    // `calcular(regra)` = datas da regra (calculo/agenda_repeticao.js, a mesma conta do servidor) para a prévia;
    // `aoConfirmar(regra)` devolve Promise: enquanto grava, o botão fica travado (sem clique duplo) e Esc não fecha.
    // `inicio`/`fim`: as datas que a janela já traz (o dia do item e uma semana depois), para abrir com uma prévia válida
    function abrirRepetir({ texto, inicio, fim, diaDoMes, calcular, resumo, maxMeses, aoConfirmar }) {
      let ocupado = false;
      const j = janela({ titulo: 'Repetir', subtitulo: texto, ocupada: () => ocupado });
      const nome = 'ag-rep-' + Math.random().toString(36).slice(2, 8);
      const campoData = (valor, rotulo) => { const c = criar('input', 'ag-mover-data'); c.type = 'date'; c.value = valor; c.setAttribute('aria-label', rotulo); return c; };
      const campoNum = (valor, min, max, rotulo) => { const c = criar('input', 'ag-mover-data ag-num'); c.type = 'number'; c.min = String(min); c.max = String(max); c.step = '1'; c.inputMode = 'numeric'; c.value = String(valor); c.setAttribute('aria-label', rotulo); return c; };
      const radio = (valor, marcado) => { const r = criar('input'); r.type = 'radio'; r.name = nome; r.value = valor; r.checked = marcado; return r; };
      // todos os dias
      const rDia = radio('diaria', true);
      const de = campoData(inicio, 'Repetir de'), ate = campoData(fim || inicio, 'Repetir até');
      const pular = criar('input'); pular.type = 'checkbox';
      const blocoDia = criar('div', 'ag-rep-op');
      const tituloDia = criar('label', 'ag-rep-titulo'); tituloDia.append(rDia, criar('span', '', 'Todos os dias'));
      const linhaDia = criar('div', 'ag-rep-campos');
      const l1 = criar('label', 'ag-rep-campo'); l1.append(criar('span', '', 'de'), de);
      const l2 = criar('label', 'ag-rep-campo'); l2.append(criar('span', '', 'até'), ate);
      linhaDia.append(l1, l2);
      const lPular = criar('label', 'ag-rep-check'); lPular.append(pular, criar('span', '', 'Pular fins de semana'));
      blocoDia.append(tituloDia, linhaDia, lPular);
      // todo mês
      const rMes = radio('mensal', false);
      const dia = campoNum(diaDoMes, 1, 31, 'Dia do mês'), meses = campoNum(Math.min(12, maxMeses), 2, maxMeses, 'Quantos meses');
      const blocoMes = criar('div', 'ag-rep-op');
      const tituloMes = criar('label', 'ag-rep-titulo'); tituloMes.append(rMes, criar('span', '', 'Todo mês'));
      const linhaMes = criar('div', 'ag-rep-campos');
      const l3 = criar('label', 'ag-rep-campo'); l3.append(criar('span', '', 'no dia'), dia);
      const l4 = criar('label', 'ag-rep-campo'); l4.append(criar('span', '', 'por'), meses, criar('span', '', 'meses'));
      linhaMes.append(l3, l4);
      blocoMes.append(tituloMes, linhaMes);
      const previa = criar('p', 'ag-previa');
      previa.setAttribute('aria-live', 'polite');
      const erro = criar('p', 'ag-erro');
      erro.setAttribute('role', 'alert');
      j.corpo.append(blocoDia, blocoMes, previa, erro);
      const inteiro = c => (/^\d+$/.test(c.value) ? Number(c.value) : NaN);
      const regra = () => (rDia.checked ? { tipo: 'diaria', de: de.value, ate: ate.value, pularFimDeSemana: pular.checked } : { tipo: 'mensal', dia: inteiro(dia), meses: inteiro(meses) });
      const avaliar = () => {
        blocoDia.classList.toggle('ag-rep-ativa', rDia.checked);
        blocoMes.classList.toggle('ag-rep-ativa', rMes.checked);
        const r = calcular(regra());
        previa.textContent = r.ok ? resumo(r.datas) : '';
        erro.textContent = r.ok ? '' : r.motivo;
        return r;
      };
      // mexer num campo escolhe a opção dele
      for (const c of [de, ate, pular]) c.addEventListener('input', () => { rDia.checked = true; avaliar(); });
      for (const c of [dia, meses]) c.addEventListener('input', () => { rMes.checked = true; avaliar(); });
      for (const r of [rDia, rMes]) r.addEventListener('change', avaliar);
      const cancelar = botao('btn btn-secondary', 'Cancelar', () => { if (!ocupado) j.fechar(); });
      const ok = botao('btn btn-primary', 'Repetir');
      const confirmarRepetir = () => {
        if (ocupado) return;
        const r = avaliar();
        if (!r.ok) return;
        ocupado = true;
        ok.disabled = cancelar.disabled = true;
        ok.textContent = 'Criando…';
        Promise.resolve().then(() => aoConfirmar(regra())).then(() => { ocupado = false; j.fechar(); }, e => {
          ocupado = false;
          ok.disabled = cancelar.disabled = false;
          ok.textContent = 'Repetir';
          erro.textContent = e?.message || 'Não foi possível repetir.';
        });
      };
      ok.addEventListener('click', confirmarRepetir);
      for (const c of [de, ate, dia, meses]) c.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); confirmarRepetir(); } });
      j.rodape.append(cancelar, ok);
      avaliar();
      rDia.focus();
      return { fechar: () => { ocupado = false; j.fechar(); } };
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
    function abrirMenu({ ancora, categorias, atual, aoEscolher, aoMover, aoHorario, aoRepetir, aoCategorias }) {
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
      if (aoHorario) opcao('Horário…', '', false, aoHorario, 'menuitem');   // só item salvo dos dias (podeHorario); teclado e celular
      if (aoRepetir) opcao('Repetir…', '', false, aoRepetir, 'menuitem');   // só item que ainda não se repete (podeRepetir)
      if (aoCategorias) opcao('Editar categorias…', '', false, aoCategorias, 'menuitem');   // só quem gere a lista única
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

    // ---------- "Horário...": dia todo (sem horário) ou das HH:MM às HH:MM; serve a teclado e celular ----------
    // `aoSalvar(horario | null)` devolve Promise: enquanto grava, os botões travam e Esc não fecha. 24:00 se escreve 00:00 no fim.
    function abrirHorario({ texto, horario, aoSalvar }) {
      let ocupado = false;
      const j = janela({ titulo: 'Horário', subtitulo: texto, ocupada: () => ocupado });
      const nome = 'ag-hor-' + Math.random().toString(36).slice(2, 8);
      const radio = (valor, marcado, rotulo) => {
        const l = criar('label', 'ag-rep-titulo');
        const r = criar('input'); r.type = 'radio'; r.name = nome; r.value = valor; r.checked = marcado;
        l.append(r, criar('span', '', rotulo));
        return { l, r };
      };
      const campo = (valor, rotulo) => { const c = criar('input', 'ag-mover-data ag-hora-campo'); c.type = 'time'; c.step = '900'; c.value = valor; c.setAttribute('aria-label', rotulo); return c; };
      const todo = radio('todo', !horario, 'Dia todo (sem horário)');
      const com = radio('hora', !!horario, 'Com horário');
      const ini = campo(horario ? horario.inicio : '09:00', 'Início');
      const fim = campo(horario ? (horario.fim === '24:00' ? '00:00' : horario.fim) : '10:00', 'Fim');
      const bloco = criar('div', 'ag-rep-op');
      const campos = criar('div', 'ag-rep-campos');
      const l1 = criar('label', 'ag-rep-campo'); l1.append(criar('span', '', 'das'), ini);
      const l2 = criar('label', 'ag-rep-campo'); l2.append(criar('span', '', 'às'), fim);
      campos.append(l1, l2);
      bloco.append(com.l, campos);
      const blocoTodo = criar('div', 'ag-rep-op');
      blocoTodo.append(todo.l);
      const erro = criar('p', 'ag-erro');
      erro.setAttribute('role', 'alert');
      j.corpo.append(blocoTodo, bloco, erro);
      const marcar = () => { blocoTodo.classList.toggle('ag-rep-ativa', todo.r.checked); bloco.classList.toggle('ag-rep-ativa', com.r.checked); };
      for (const c of [ini, fim]) c.addEventListener('input', () => { com.r.checked = true; marcar(); });
      for (const r of [todo.r, com.r]) r.addEventListener('change', marcar);
      marcar();
      const valor = () => {
        if (todo.r.checked) return { ok: true, valor: null };
        const f = fim.value === '00:00' ? '24:00' : fim.value;
        if (!ini.value || !fim.value) return { ok: false, motivo: 'Escolha o início e o fim.' };
        return AH.validarHorario({ inicio: ini.value, fim: f });
      };
      const cancelar = botao('btn btn-secondary', 'Cancelar', () => { if (!ocupado) j.fechar(); });
      const ok = botao('btn btn-primary', 'Salvar');
      const salvar = () => {
        if (ocupado) return;
        const v = valor();
        if (!v.ok) { erro.textContent = v.motivo; return; }
        ocupado = true;
        ok.disabled = cancelar.disabled = true;
        Promise.resolve().then(() => aoSalvar(v.valor)).then(() => { ocupado = false; j.fechar(); }, e => {
          ocupado = false;
          ok.disabled = cancelar.disabled = false;
          erro.textContent = e?.message || 'Não foi possível salvar o horário.';
        });
      };
      ok.addEventListener('click', salvar);
      for (const c of [ini, fim]) c.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); salvar(); } });
      j.rodape.append(cancelar, ok);
      (horario ? ini : todo.r).focus();
      return { fechar: () => { ocupado = false; j.fechar(); } };
    }

    // ---------- grade de horários (tela larga): horas na lateral esquerda e uma coluna por dia, 00:00 a 24:00 ----------
    // Devolve { el (o quadro que rola), colunas: [{ col, lista }], agora (linha da hora atual ou null) }. As faixas com horário
    // ficam em `lista` (ul) de cada coluna, posicionadas por estiloGrade.
    function montarGrade({ dias }) {
      const el = criar('div', 'ag-grade');
      const corpo = criar('div', 'ag-grade-corpo');
      const horas = criar('div', 'ag-horas');
      horas.setAttribute('aria-hidden', 'true');
      for (let h = 1; h < 24; h++) { const r = criar('span', 'ag-hora-rot', `${String(h).padStart(2, '0')}:00`); r.style.top = `${h * PX_HORA}px`; horas.append(r); }
      corpo.append(horas);
      let agora = null;
      const colunas = dias.map(d => {
        const col = criar('div', 'ag-col' + (d.hoje ? ' hoje' : ''));
        const lista = criar('ul', 'linhas');
        lista.setAttribute('aria-label', `${d.rotulo}, com horário`);
        col.append(lista);
        if (d.hoje) { agora = criar('div', 'ag-agora'); agora.setAttribute('aria-hidden', 'true'); col.append(agora); }
        corpo.append(col);
        return { col, lista };
      });
      el.append(corpo);
      return { el, colunas, agora };
    }
    // a linha da hora atual (relógio do aparelho)
    function marcarAgora(agora, quando = new Date()) {
      if (agora) agora.style.top = `${(quando.getHours() * 60 + quando.getMinutes()) * PX_MIN}px`;
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
              texto: `Excluir a categoria “${c.nome}”? Ela sai da lista das duas agendas, e os itens dela, na Minha semana de todos e na Semana compartilhada, ficam “Sem categoria”. Nenhum item é apagado.` });
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
        l.dataset.cor = cor || '';   // a própria caixa de marcar leva a cor da categoria
        l.title = nome;              // nome longo é cortado com "..."
        const c = criar('input');
        c.type = 'checkbox';
        c.checked = !legenda.ocultas().has(k);
        c.addEventListener('change', () => { legenda.mostrar(k, c.checked); aoMudar(); });
        l.append(c, criar('span', 'ag-leg-nome', nome));
        alvo.append(l);
      };
      for (const c of lista) item(String(c.id), c.nome, c.cor);
      item('sem', SEM, '');
    }

    // tela estreita: a coluna de categorias é um bloco recolhível, fechado ao abrir (na larga o botão não aparece)
    function ligarLateral({ botao: alternar, lateral }) {
      alternar.addEventListener('click', () => {
        const aberta = lateral.classList.toggle('aberta');
        alternar.setAttribute('aria-expanded', String(aberta));
      });
    }

    // ---------- arraste (Pointer Events): pela alça; mouse começa ao mover, toque ao segurar ou mover ----------
    // Esc, pointercancel ou soltar fora de um quadro desfazem. Durante o arraste a tela rola perto da borda.
    // `grade` (tela larga): { horarioDe(li), rolador() }. Sobre uma coluna da grade o destino é o dia + o horário que segue o
    // ponteiro em passos de 15 min (mesma duração; do "dia todo", 1h); uma sombra mostra onde vai cair. aoSoltar(li, alvo, { horario }).
    function ligarArraste({ raiz, podeArrastar: pode, aoNegar, aoSoltar, aoMudar, seletorAlca = '.alca', seletorAlvo = '.quadro', grade = null }) {
      let st = null;
      const sombra = criar('div', 'ag-sombra');
      sombra.setAttribute('aria-hidden', 'true');
      const esconderSombra = () => { sombra.remove(); };
      const fim = () => {
        if (!st) return;
        const s = st;
        st = null;
        win.clearTimeout(s.timer);
        win.cancelAnimationFrame(s.raf);
        s.fantasma?.remove();
        esconderSombra();
        s.li.classList.remove('arrastando');
        s.alvo?.classList.remove('alvo-soltar');
        try { s.alca.releasePointerCapture(s.id); } catch { /* já solta */ }
        doc.removeEventListener('keydown', s.tecla, true);
        if (s.ativo) aoMudar?.(false);
        return s;
      };
      const trocarAlvo = novo => {
        if (novo === st.alvo) return;
        st.alvo?.classList.remove('alvo-soltar');
        st.alvo = novo;
        novo?.classList.add('alvo-soltar');
      };
      const marcarAlvo = () => {
        const el = doc.elementFromPoint(st.x, st.y);
        const col = grade && el?.closest?.('.ag-col');
        if (col && raiz.contains(col)) {
          const r = col.getBoundingClientRect();
          st.horario = AH.mover(st.base, (st.y - r.top) / PX_MIN - st.agarre);
          trocarAlvo(col);
          const e = estiloGrade(st.horario);
          sombra.style.top = e.top;
          sombra.style.height = e.height;
          sombra.textContent = AH.rotulo(st.horario);
          if (sombra.parentNode !== col) col.append(sombra);
          if (st.fantasma) st.fantasma.hidden = true;
          return;
        }
        st.horario = null;
        esconderSombra();
        if (st.fantasma) st.fantasma.hidden = false;
        const q = el?.closest?.(seletorAlvo);
        trocarAlvo(q && raiz.contains(q) ? q : null);
      };
      const posicionar = () => { st.fantasma.style.transform = `translate(${st.x - st.dx}px, ${st.y - st.dy}px)`; };
      const rolar = () => {
        if (!st?.ativo) return;
        const v = velocidadeRolagem(st.y, win.innerHeight);
        if (v) { win.scrollBy(0, v); marcarAlvo(); }
        // dentro da grade (que rola sozinha): perto da borda de cima ou de baixo dela
        const sc = grade?.rolador?.();
        if (sc) {
          const r = sc.getBoundingClientRect();
          if (st.x >= r.left && st.x <= r.right && st.y >= r.top && st.y <= r.bottom + 24) {
            const w = velocidadeRolagem(st.y - r.top, r.height, 40, 14);
            if (w) { sc.scrollTop += w; marcarAlvo(); }
          }
        }
        st.raf = win.requestAnimationFrame(rolar);
      };
      const comecar = () => {
        if (!st || st.ativo) return;
        st.ativo = true;
        const r = st.li.getBoundingClientRect();
        st.dx = st.x0 - r.left; st.dy = st.y0 - r.top;
        // na grade: o horário de partida e onde, dentro do item, o ponteiro segurou (para o item não pular)
        const h = grade?.horarioDe?.(st.li) || null;
        st.base = h || { inicio: '00:00', fim: AH.paraHora(AH.DURACAO) };
        st.agarre = h && st.li.closest('.ag-col') ? Math.max(0, (st.y0 - r.top) / PX_MIN) : 0;
        const f = criar('div', 'ag-fantasma');
        f.dataset.cor = st.li.dataset.cor || '';
        f.style.width = Math.min(r.width, 260) + 'px';
        f.textContent = st.texto;
        f.setAttribute('aria-hidden', 'true');
        doc.body.append(f);
        st.fantasma = f;
        sombra.dataset.cor = st.li.dataset.cor || '';
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
        st = { li, alca, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, ativo: false, alvo: null, horario: null,
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
        if (s.ativo && s.alvo) aoSoltar(s.li, s.alvo, s.horario ? { horario: s.horario } : {});
      });
      raiz.addEventListener('pointercancel', ev => { if (st && ev.pointerId === st.id) fim(); });
      raiz.addEventListener('lostpointercapture', ev => { if (st && ev.pointerId === st.id && !st.ativo) fim(); });
      return { ativo: () => !!st?.ativo, cancelar: fim };
    }

    // ---------- puxar a borda de baixo de um item da grade: muda o fim (duração), em passos de 15 min ----------
    // `podeMudar(li)` (só item salvo e sem nada pendente); Esc ou pointercancel desfazem; aoFim(li, horario) só se mudou.
    function ligarRedimensionar({ raiz, podeMudar, aoNegar, horarioDe, aoMudar, aoFim, seletor = '.ag-puxar' }) {
      let st = null;
      const mostrar = (li, h) => {
        li.style.height = estiloGrade(h).height;
        li.style.setProperty('--alto', li.style.height);
        const rot = li.querySelector('.ag-hora');
        if (rot) rot.textContent = AH.rotulo(h);
      };
      const fim = desfazer => {
        if (!st) return null;
        const s = st;
        if (desfazer) mostrar(s.li, s.h0);
        st = null;
        s.li.classList.remove('puxando');
        try { s.alca.releasePointerCapture(s.id); } catch { /* já solta */ }
        doc.removeEventListener('keydown', s.tecla, true);
        aoMudar?.(false);
        return s;
      };
      raiz.addEventListener('pointerdown', ev => {
        const p = ev.target?.closest?.(seletor);
        if (!p || !raiz.contains(p) || st || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
        const li = p.closest('li');
        ev.preventDefault();
        ev.stopPropagation();
        const h0 = horarioDe(li);
        if (!h0 || !podeMudar(li)) { aoNegar?.(li); return; }
        st = { li, alca: p, id: ev.pointerId, col: li.closest('.ag-col'), h0, h: h0,
          tecla: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fim(true); } } };
        try { p.setPointerCapture(ev.pointerId); } catch { /* navegador antigo */ }
        doc.addEventListener('keydown', st.tecla, true);
        li.classList.add('puxando');
        aoMudar?.(true);
      });
      raiz.addEventListener('pointermove', ev => {
        if (!st || ev.pointerId !== st.id) return;
        ev.preventDefault();
        const r = st.col.getBoundingClientRect();
        st.h = AH.redimensionar(st.h0, (ev.clientY - r.top) / PX_MIN);
        mostrar(st.li, st.h);
      });
      raiz.addEventListener('pointerup', ev => {
        if (!st || ev.pointerId !== st.id) return;
        const s = fim(false);
        if (!mesmoHorario(s.h, s.h0)) aoFim(s.li, s.h);
      });
      raiz.addEventListener('pointercancel', ev => { if (st && ev.pointerId === st.id) fim(true); });
      return { ativo: () => !!st, cancelar: () => fim(true) };
    }

    return {
      confirmar, perguntarEscopo, abrirRepetir, abrirHorario, abrirMenu, fecharMenu, abrirMover, abrirCategorias, desenharLegenda, ligarArraste, ligarRedimensionar,
      montarGrade, marcarAgora, amostra, ligarLateral,
      menuAberto: () => !!menuAtual,
      janelaAberta: () => janelas > 0
    };
  }

  return { CORES, SEM, MAX_NOME, corValida, nomeDaCor, indexar, corDe, nomeDe, limparNome, conferirNome, chaveLegenda, criarLegenda,
    mesmoLugar, corpoMover, pedeConfirmacaoNotas, podeArrastar, podeAtualizar, precisaEscopo, podeRepetir, resumoSerie, velocidadeRolagem, rotuloMes, SEMANA_CURTA,
    PX_HORA, PX_MIN, LARGURA_GRADE, mesmoHorario, podeHorario, querGrade, estiloGrade, alturaGrade, manterRolagem, criarUi };
});
