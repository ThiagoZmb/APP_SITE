// ==========================================================================
// ELEGANCE - alarmes das semanas, em qualquer tela do sistema (carregado pelo layout.js).
// Consulta GET /alarmes uma vez por minuto e dispara pelo relógio do aparelho: janela com som, uma por vez, "OK" e
// "Adiar 10 minutos". No modo atendimento o aviso fica retido. Erro na consulta (inclusive sessão vencida) é ignorado:
// quem cuida do login é a própria tela. Texto da tarefa só entra por textContent.
// Funções puras testadas no Node (test/alarmes_tela.test.js).
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else if (!raiz.Alarmes) { raiz.Alarmes = lib; lib.iniciar(raiz); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const API = 'https://elegance-backend-hrho.onrender.com';
  const MINUTO = 60000;
  const dois = n => String(n).padStart(2, '0');

  // 'AAAA-MM-DD HH:MM' pelo relógio do aparelho (o alarme é gravado como a hora de Brasília digitada)
  const quandoLocal = d => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
  const maisMinutos = (d, n) => quandoLocal(new Date(d.getTime() + n * MINUTO));
  const paraData = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
  const chaveDe = a => `${a.origem}:${a.id}:${a.alarme}:${a.quando}`;
  const vencidos = (lista, agora) => {
    const ja = quandoLocal(agora);
    return lista.filter(a => a.quando <= ja).sort((a, b) => (a.quando < b.quando ? -1 : a.quando > b.quando ? 1 : a.id - b.id));
  };

  // fila de avisos, sem DOM: quem desenha é `mostrar`/`fechar`
  function criarControle({ chamar, agora, retido, quem, mostrar, fechar, avisarOutras, agendar, cancelar }) {
    let lista = [], atual = null, dono, geracao = 0, relogio = null;
    const respondidos = new Set();   // respondidos aqui e ainda presentes numa resposta atrasada
    const enviando = new Set();

    function fecharAtual() {
      if (!atual) return;
      atual = null;
      fechar();
    }
    function avaliar() {
      if (relogio !== null) { cancelar(relogio); relogio = null; }
      const abertos = lista.filter(a => !respondidos.has(chaveDe(a)) && !enviando.has(chaveDe(a)));
      if (atual && (retido() || !abertos.some(a => chaveDe(a) === chaveDe(atual)))) fecharAtual();
      const hora = agora();
      if (!atual && !retido()) {
        const [proximo] = vencidos(abertos, hora);
        if (proximo) { atual = proximo; mostrar(proximo); }
      }
      const ja = quandoLocal(hora);
      const futuros = abertos.filter(a => a.quando > ja).map(a => a.quando).sort();
      if (futuros.length) relogio = agendar(avaliar, Math.min(paraData(futuros[0]) - hora + 200, MINUTO));
    }
    async function consultar() {
      const eu = quem();
      if (eu !== dono) { dono = eu; lista = []; respondidos.clear(); avaliar(); }   // saiu ou entrou outra pessoa
      if (eu === null) return;
      const minha = ++geracao;
      let r;
      try { r = await chamar('/alarmes'); } catch { avaliar(); return; }
      if (minha !== geracao || quem() !== eu) return;
      lista = Array.isArray(r?.alarmes) ? r.alarmes.filter(a => a && typeof a.quando === 'string') : [];
      const presentes = new Set(lista.map(chaveDe));
      for (const k of respondidos) if (!presentes.has(k)) respondidos.delete(k);
      avaliar();
    }
    // acao = 'ok' | 'adiar'
    async function responder(acao) {
      const a = atual;
      if (!a) return;
      const k = chaveDe(a);
      const corpo = { alarme: a.alarme, ...(acao === 'adiar' ? { ate: maisMinutos(agora(), 10) } : {}) };
      enviando.add(k);
      fecharAtual();
      avaliar();   // o próximo da fila já aparece
      try {
        await chamar(`/alarmes/${a.origem}/${a.id}/${acao}`, { metodo: 'POST', corpo });
        respondidos.add(k);
        avisarOutras();
      } catch {
        lista = lista.filter(x => chaveDe(x) !== k);   // volta na próxima consulta
        enviando.delete(k);
        return;
      }
      enviando.delete(k);
      await consultar();
    }
    // a janela foi fechada pelo navegador (Esc repetido): volta na próxima avaliação
    const fechada = () => { atual = null; };
    return { consultar, avaliar, responder, fechada };
  }

  // Os modais próprios das telas escutam keydown em `document` (captura): com o alarme por cima, Esc fecharia o de baixo e
  // Tab seria anulado. `window` em captura vem antes de `document`, não importa a ordem em que os scripts carregaram.
  // Parar a propagação não impede a ação do navegador: Tab anda entre os botões e Enter/Espaço os acionam.
  function blindarTeclado(win, janelaAtual) {
    win.addEventListener('keydown', ev => {
      const janela = janelaAtual();
      if (!janela?.open) return;
      const outra = ev.target?.closest?.('dialog[open]');
      if (outra && outra !== janela) return;   // outra janela aberta DEPOIS, por cima do alarme: o teclado é dela
      ev.stopImmediatePropagation();
      // Esc não fecha o alarme; F5 sozinho recarregaria a tela (as telas o usam para pesquisar)
      if (ev.key === 'Escape' || (ev.key === 'F5' && !ev.ctrlKey)) ev.preventDefault();
    }, true);
  }

  // ============ NAVEGADOR ============
  function iniciar(win) {
    const doc = win.document;
    if (/login\.html$/i.test(win.location?.pathname || '')) return;   // a tela de entrada não é lugar de aviso
    const montar = () => ligar(win);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', montar);
    else montar();
  }

  function ligar(win) {
    const doc = win.document;
    const auth = () => {
      try {
        const a = JSON.parse(win.localStorage.getItem('auth') || 'null');
        return a && a.token && Date.now() <= (a.exp || 0) ? a : null;
      } catch { return null; }
    };
    async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
      const a = auth();
      if (!a) throw new Error('sem login');
      const res = await win.fetch(API + caminho, { method: metodo, headers: { Authorization: 'Bearer ' + a.token, ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    let janela = null, partes = null, fechandoDaqui = false, audio = null, controle = null;
    // janela padrão do sistema (DESIGN.md / tema.css: dlg-padrao); aqui só largura, centro e o texto
    function criarJanela() {
      const css = doc.createElement('style');
      css.textContent = `.alarme-janela { margin: auto !important; width: min(420px, calc(100vw - 32px)); }
        .alarme-janela .alarme-texto { font-size: 15px; line-height: 1.45; margin: 0; overflow-wrap: anywhere; outline: none; }
        .alarme-janela .dlg-rodape button { min-height: 44px; margin: 0 !important; }`;
      doc.head.appendChild(css);
      const el = (tag, classe, texto) => { const e = doc.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };
      janela = el('dialog', 'dlg-padrao alarme-janela');
      const cab = el('div', 'dlg-cab'), titulo = el('h3', '', 'Alarme'), corpo = el('div', 'dlg-corpo'), rodape = el('div', 'dlg-rodape');
      titulo.id = 'alarme-titulo';
      janela.setAttribute('aria-labelledby', titulo.id);
      partes = { quando: el('p'), texto: el('p', 'alarme-texto') };
      // o foco inicial vai para o texto: um Enter de quem estava digitando não confirma o alarme sem querer
      partes.texto.tabIndex = -1;
      partes.texto.autofocus = true;
      const botao = (classe, rotulo, acao) => { const b = el('button', 'btn ' + classe, rotulo); b.type = 'button'; b.addEventListener('click', () => controle.responder(acao)); return b; };
      cab.append(titulo, partes.quando);
      corpo.append(partes.texto);
      rodape.append(botao('btn-secondary', 'Adiar 10 minutos', 'adiar'), botao('btn-primary', 'OK', 'ok'));
      janela.append(cab, corpo, rodape);
      janela.addEventListener('cancel', ev => ev.preventDefault());
      janela.addEventListener('close', () => { if (!fechandoDaqui && !janela.open) controle.fechada(); });
      doc.body.appendChild(janela);
    }
    // três bipes por WebAudio; se o navegador bloquear (ninguém clicou na página ainda), fica só a janela
    function tocar() {
      try {
        const Contexto = win.AudioContext || win.webkitAudioContext;
        if (!Contexto) return;
        audio ||= new Contexto();
        const bipar = () => {
          if (!janela.open) return;
          for (let i = 0; i < 3; i++) {
            const osc = audio.createOscillator(), vol = audio.createGain(), em = audio.currentTime + i * 0.35;
            osc.frequency.value = 880;
            vol.gain.setValueAtTime(0.15, em);
            vol.gain.exponentialRampToValueAtTime(0.001, em + 0.25);
            osc.connect(vol).connect(audio.destination);
            osc.start(em);
            osc.stop(em + 0.26);
          }
        };
        if (audio.state === 'running') bipar();
        else audio.resume().then(bipar).catch(() => {});
      } catch { /* sem som */ }
    }
    function mostrar(a) {
      if (!janela) criarJanela();
      const data = `${a.quando.slice(8, 10)}/${a.quando.slice(5, 7)} ${a.quando.slice(11)}`;
      partes.quando.textContent = `${data} · ${a.origem === 'admin' ? 'Semana compartilhada' : 'Minha semana'}`;
      partes.texto.textContent = a.texto;
      if (!janela.open) janela.showModal();
      tocar();
    }
    function fechar() {
      if (!janela?.open) return;
      fechandoDaqui = true;
      janela.close();
      // o evento `close` é entregue depois: só então volta a valer o fechamento pelo navegador
      win.setTimeout(() => { fechandoDaqui = false; }, 0);
    }

    controle = criarControle({
      chamar,
      agora: () => new Date(),
      retido: () => !!win.Atendimento?.ativo(),
      quem: () => auth()?.token ?? null,
      mostrar,
      fechar,
      avisarOutras: () => { try { win.localStorage.setItem('alarmes_resposta', String(Date.now())); } catch { /* as outras abas veem na próxima consulta */ } },
      agendar: (fn, ms) => win.setTimeout(fn, ms),
      cancelar: t => win.clearTimeout(t)
    });
    blindarTeclado(win, () => janela);
    win.addEventListener('atendimento-mudou', () => controle.avaliar());   // esconde ou mostra na hora
    win.setInterval(() => controle.consultar(), MINUTO);
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') controle.consultar(); });
    win.addEventListener('storage', ev => { if (ev.key === 'alarmes_resposta' || ev.key === 'auth') controle.consultar(); });
    win.addEventListener('alarmes-mudou', () => controle.consultar());   // a tela das semanas acabou de gravar
    controle.consultar();
  }

  return { quandoLocal, maisMinutos, vencidos, criarControle, blindarTeclado, iniciar };
});
