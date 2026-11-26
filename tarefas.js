// ==========================================================================
// tarefas.html — "Minha semana": caderno pessoal de tarefas (sete dias, Tarefas e Notas). Cada um vê só o seu.
// Rotas: GET /minha_semana?inicio=, POST /minha_semana, PUT e DELETE /minha_semana/:id.
// Funções puras testadas no Node (test/minha_semana_tela.test.js); o desenho da tela fica no fim (só no navegador).
// O texto da tarefa só entra na tela pelo value do campo (textarea que cresce); o resto, por textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Tarefas = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  // categorias, legenda, menu, "Mover para" e arraste: a parte nova, igual nas duas agendas (agenda_comum.js)
  const AG = typeof module === 'object' && module.exports ? require('./agenda_comum.js') : raiz.AgendaComum;
  // datas da repetição (a mesma conta do servidor) para a prévia da janela "Repetir..."
  const R = typeof module === 'object' && module.exports ? require('./calculo/agenda_repeticao.js') : raiz.AgendaRepeticao;

  // ordem de leitura, do teclado e da tela: da esquerda para a direita (o CSS só decide quantas colunas cabem)
  const DIAS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];

  // ---------- datas: a conta é em UTC e a leitura é pelos campos, para o dia nunca voltar um por causa do fuso ----------
  const dois = n => String(n).padStart(2, '0');
  const isoDeUtc = d => `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
  const isoLocal = d => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  function somarDias(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    return isoDeUtc(new Date(Date.UTC(a, m - 1, d + n)));
  }
  function segundaDe(data) {
    const dia = new Date(Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()));
    return somarDias(isoDeUtc(dia), -((dia.getUTCDay() + 6) % 7));
  }
  const diaMes = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const rotuloSemana = inicio => `${diaMes(inicio)} a ${diaMes(somarDias(inicio, 6))}`;

  // mesma limpeza do servidor (calculo/minha_semana.js): uma linha só, sem espaços nas pontas
  const limpar = t => String(t ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

  // cada tarefa é uma linha só: o que for colado com quebras vira espaço (a quebra visual é do campo, não do texto)
  const semQuebra = t => String(t ?? '').replace(/\r\n|[\r\n\u2028\u2029]/g, ' ');

  // ---------- alarme: 'AAAA-MM-DD HH:MM', a hora como foi digitada ----------
  // Em stand by pela chave ALARMES_ATIVOS (layout.js). Desligada, a linha não lê nem envia alarme: aqui ele é sempre
  // null e o que está gravado no servidor não é tocado.
  const alarmesAtivos = () => globalThis.ALARMES_ATIVOS === true;
  const doAlarme = q => (alarmesAtivos() && q) || null;
  const horaCurta = q => `${q.slice(8, 10)}/${q.slice(5, 7)} ${q.slice(11, 16)}`;
  // valor inicial do campo: o dia da linha às 9h; hoje, dia passado ou quadro Tarefas: a próxima hora cheia
  function sugestaoDeAlarme(data, agora) {
    if (data && data > isoLocal(agora)) return data + ' 09:00';
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), agora.getHours() + 1);
    return `${isoLocal(d)} ${dois(d.getHours())}:00`;
  }

  // ---------- rascunho no navegador: SÓ o que o servidor ainda não confirmou ----------
  // Sessão expirada, aba descartada no celular ou rede caída não podem levar o texto junto. Uma chave por usuário (id do
  // login), uma entrada por linha; some quando o servidor confirma. Armazenamento bloqueado: a tela funciona sem rascunho.
  function idDoToken(token) {
    try { return JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id ?? null; } catch { return null; }
  }
  function criarRascunhos(armazem, usuario) {
    const chaveDe = 'minha_semana_rascunho:' + usuario;
    const valida = e => e && typeof e.texto === 'string' && ['dia', 'tarefas', 'notas'].includes(e.quadro);
    function ler() {
      if (usuario === null || usuario === undefined) return {};
      try { return Object.fromEntries(Object.entries(JSON.parse(armazem().getItem(chaveDe) || '{}')).filter(([, e]) => valida(e))); } catch { return {}; }
    }
    function mudar(fn) {
      if (usuario === null || usuario === undefined) return;
      try {
        const todos = ler();
        if (fn(todos) === false) return;
        if (Object.keys(todos).length) armazem().setItem(chaveDe, JSON.stringify(todos));
        else armazem().removeItem(chaveDe);
      } catch { /* sem armazenamento: vale só o que está na tela */ }
    }
    return {
      ler,
      gravar: (k, e) => mudar(todos => { todos[k] = e; }),
      remover: k => mudar(todos => { if (!(k in todos)) return false; delete todos[k]; })
    };
  }

  // ---------- uma linha do caderno ----------
  // `dados` = o que o servidor já tem; `alvo` = o que a pessoa quer. As operações entram numa fila (uma por vez), o que
  // impede dois POSTs da mesma linha; se uma falha, o alvo fica guardado e a próxima tentativa grava a diferença.
  // `temAlarme`: há alarme gravado no servidor (mesmo com os alarmes em stand by): ir para Notas o tira, então a tela pergunta antes
  // Série (repetição): `serieId` liga os itens; `escolha` = a quais itens da série vale o texto digitado ({ texto, escopo }), feita
  // pela pessoa na pergunta da tela; vale só para aquele texto e some quando o servidor confirma. `aoSerie(serie, id)` leva à tela o
  // que mudou nos outros itens da série (resposta do servidor).
  function criarLinha(chamar, inicial, { rascunhos, chave, aoSerie } = {}) {
    const dados = { id: inicial.id ?? null, quadro: inicial.quadro, data: inicial.data ?? null, texto: inicial.texto || '', feita: !!inicial.feita, alarme: doAlarme(inicial.alarme),
      categoriaId: inicial.categoriaId ?? null, temAlarme: inicial.temAlarme !== undefined ? !!inicial.temAlarme : !!inicial.alarme,
      serieId: inicial.serieId ?? null, seriePos: inicial.seriePos ?? null };
    const alvo = { texto: dados.texto, feita: dados.feita, alarme: dados.alarme };
    let fila = Promise.resolve();
    let naFila = 0;
    const escrito = { texto: dados.texto, feita: dados.feita, alarme: dados.alarme };   // o último digitado/marcado, antes mesmo de entrar na fila
    let enviado = null;   // texto de um POST sem resposta: pode ter chegado ao servidor
    let escolha = null;
    // o escopo a mandar com este texto ("este" = o PUT/DELETE de sempre)
    const escopoDe = texto => (escolha && escolha.texto === texto && escolha.escopo !== 'este' ? escolha.escopo : null);
    const cumprida = () => { if (escolha && escolha.texto === dados.texto) escolha = null; };

    function guardar() {
      if (!rascunhos) return;
      if (!enviado && escrito.texto === dados.texto && (!dados.id || (escrito.feita === dados.feita && escrito.alarme === dados.alarme))) return rascunhos.remover(chave);
      rascunhos.gravar(chave, { id: dados.id, quadro: dados.quadro, data: dados.data, texto: escrito.texto, feita: escrito.feita,
        ...(escrito.alarme !== dados.alarme ? { alarme: escrito.alarme } : {}), ...(enviado ? { enviado } : {}),
        ...(escolha && escolha.texto === escrito.texto ? { escopo: escolha.escopo } : {}) });
    }
    function anotar(texto, feita) {
      if (texto !== undefined) escrito.texto = limpar(texto);
      if (feita !== undefined) escrito.feita = !!feita;
      guardar();
    }

    const esquecer = () => { dados.id = null; dados.texto = ''; dados.feita = false; dados.alarme = null; dados.serieId = null; dados.seriePos = null; };
    async function excluir() {
      const id = dados.id, escopo = escopoDe('');
      let r = null;
      try { r = await chamar('/minha_semana/' + id + (escopo ? '?escopo=' + escopo : ''), { metodo: 'DELETE' }); } catch (e) { if (e.status !== 404) throw e; }
      esquecer();
      escolha = null;
      alvo.feita = false;
      alvo.alarme = null;   // o alarme era da tarefa apagada
      if (!escrito.texto) { escrito.feita = false; escrito.alarme = null; }
      guardar();
      if (r && r.serie) aoSerie?.(r.serie, id);
    }
    async function criar() {
      const texto = alvo.texto;
      enviado = texto;
      guardar();   // antes de enviar: se a página sair sem a resposta, dá para reconhecer a linha depois
      let r;
      try {
        r = await chamar('/minha_semana', { metodo: 'POST', corpo: { quadro: dados.quadro, data: dados.data, texto } });
      } catch (e) {
        if (e.status) enviado = null;   // o servidor respondeu com erro: não criou
        throw e;
      }
      enviado = null;
      dados.id = r.id; dados.texto = texto; dados.feita = !!r.feita;
      guardar();
    }
    async function mudar() {
      const corpo = {};
      if (alvo.texto !== dados.texto) corpo.texto = alvo.texto;
      if (alvo.feita !== dados.feita) corpo.feita = alvo.feita;
      if (alvo.alarme !== dados.alarme) corpo.alarme = alvo.alarme;
      if (!Object.keys(corpo).length) return;
      const sumiu = e => {
        if (e.status !== 404) throw e;
        esquecer();   // apagada em outro aparelho: o que está escrito aqui vira uma linha nova
        return sincronizar();
      };
      // texto para "este e os próximos" ou "todos": num PUT só dele (a série não leva caixinha nem alarme)
      const escopo = 'texto' in corpo ? escopoDe(corpo.texto) : null;
      if (escopo) {
        let r;
        try { r = await chamar('/minha_semana/' + dados.id, { metodo: 'PUT', corpo: { texto: corpo.texto, escopo } }); } catch (e) { return sumiu(e); }
        dados.texto = corpo.texto;
        cumprida();
        guardar();
        if (r && r.serie) aoSerie?.(r.serie, dados.id);
        delete corpo.texto;
        if (!Object.keys(corpo).length) return;
      }
      try {
        await chamar('/minha_semana/' + dados.id, { metodo: 'PUT', corpo });
      } catch (e) { return sumiu(e); }
      Object.assign(dados, corpo);
      if ('alarme' in corpo) dados.temAlarme = !!corpo.alarme;
      cumprida();
      guardar();
    }
    async function sincronizar() {
      if (!alvo.texto) {
        if (dados.id) await excluir();
        return;
      }
      if (!dados.id) await criar();
      await mudar();
    }

    const linha = {
      dados,
      erro: false,
      mensagem: '',
      get texto() { return alvo.texto; },
      get feita() { return alvo.feita; },
      get alarme() { return alvo.alarme; },
      get escolha() { return escolha; },
      // há algo que o servidor ainda não tem?
      pendente: () => naFila > 0 || alvo.texto !== dados.texto || (!!dados.id && (alvo.feita !== dados.feita || alvo.alarme !== dados.alarme)),
      anotar,
      // `escopo` (item de série): 'este' | 'proximos' | 'todos', escolhido na pergunta da tela; sem ele vale a escolha já feita para este texto
      salvarTexto: (t, escopo) => { if (escopo) escolha = { texto: limpar(t), escopo }; anotar(t); return enfileirar(() => { alvo.texto = limpar(t); }); },
      // a série mudou este item (texto/categoria) por outro item: só para linha sem nada pendente (a tela confere)
      adotar: l => {
        if (l.texto !== undefined) { dados.texto = l.texto; alvo.texto = l.texto; escrito.texto = l.texto; }
        if (l.categoriaId !== undefined) dados.categoriaId = l.categoriaId;
        guardar();
      },
      marcar: b => { anotar(undefined, b); return enfileirar(() => { alvo.feita = !!b; }); },
      alarmar: q => { escrito.alarme = doAlarme(q); guardar(); return enfileirar(() => { alvo.alarme = doAlarme(q); }); },
      // trocar a categoria e mover: pela mesma fila (nunca antes de o texto chegar ao servidor). Se falhar, nada muda aqui e a
      // tela avisa; não vira erro da linha (o texto está salvo). { ok } | { ok: false, mensagem } | { ok: false, sumiu } (apagada)
      // `escopo` 'proximos'/'todos': a categoria vale para a série (a tela perguntou antes)
      colorir: (id, escopo) => acao(async () => {
        if (!dados.id) return { ok: false, mensagem: 'Salve o item antes.' };
        if (id === dados.categoriaId && !(escopo && escopo !== 'este')) return { ok: true };
        const r = await chamar('/minha_semana/' + dados.id, { metodo: 'PUT', corpo: { categoriaId: id, ...(escopo && escopo !== 'este' ? { escopo } : {}) } });
        dados.categoriaId = id;
        if (r && r.serie) aoSerie?.(r.serie, dados.id);
        return { ok: true };
      }),
      mover: destino => acao(async () => {
        if (!dados.id || !semPendencia()) return { ok: false, mensagem: 'Espere o texto ser salvo antes de mover.' };
        const corpo = AG.corpoMover(destino);
        const r = await chamar('/minha_semana/' + dados.id, { metodo: 'PUT', corpo });
        const l = r && r.quadro ? r : { ...corpo, feita: corpo.quadro === 'notas' ? false : dados.feita, alarme: corpo.quadro === 'notas' ? null : undefined };
        dados.quadro = l.quadro; dados.data = l.data ?? null; dados.feita = !!l.feita;
        if (l.alarme !== undefined) { dados.alarme = doAlarme(l.alarme); dados.temAlarme = !!l.alarme; }
        // nota não se repete: o servidor tira da série
        if (l.serieId !== undefined) { dados.serieId = l.serieId; dados.seriePos = l.seriePos ?? null; } else if (corpo.quadro === 'notas') dados.serieId = dados.seriePos = null;
        for (const f of ['feita', 'alarme']) { alvo[f] = dados[f]; escrito[f] = dados[f]; }
        return { ok: true, linha: r && r.quadro ? r : null };   // a linha como o servidor gravou, para a tela refazer a faixa
      }),
      // "Repetir...": pela mesma fila, só com tudo salvo. O servidor devolve a série inteira ({ linha, linhas, qtd }).
      repetir: regra => acao(async () => {
        if (!dados.id || !semPendencia()) return { ok: false, mensagem: 'Espere o texto ser salvo antes de repetir.' };
        if (dados.serieId) return { ok: false, jaEmSerie: true, mensagem: 'Este item já se repete.' };
        let r;
        try { r = await chamar(`/minha_semana/${dados.id}/repetir`, { metodo: 'POST', corpo: regra }); } catch (e) {
          if (e.status === 409) return { ok: false, jaEmSerie: !!e.dados?.jaEmSerie, mensagem: e.message || 'Este item já se repete.' };
          throw e;
        }
        Object.assign(dados, { quadro: r.linha.quadro, data: r.linha.data ?? null, serieId: r.linha.serieId ?? null, seriePos: r.linha.seriePos ?? null });
        return { ok: true, resposta: r };
      })
    };
    // nada além do que o servidor já tem (o texto da tela é conferido pela tela, em AG.podeArrastar)
    const semPendencia = () => alvo.texto === dados.texto && escrito.texto === dados.texto && alvo.feita === dados.feita && escrito.feita === dados.feita
      && alvo.alarme === dados.alarme && escrito.alarme === dados.alarme;
    // uma ação que não muda o texto: entra na fila e devolve o resultado em vez de marcar erro na linha
    function acao(fazer) {
      naFila++;
      const feito = fila.then(async () => {
        try { return await fazer(); } catch (e) {
          if (e.status === 404) return { ok: false, sumiu: true };
          return { ok: false, mensagem: e.message || 'Erro ao salvar.' };
        } finally { naFila--; guardar(); }
      });
      fila = feito.then(() => {});
      return feito;
    }
    function enfileirar(aplicar) {
      naFila++;
      fila = fila.then(async () => {
        aplicar();
        try {
          await sincronizar();
          linha.erro = false; linha.mensagem = '';
        } catch (e) {
          linha.erro = true; linha.mensagem = e.message || 'Erro ao salvar.';
        }
        naFila--;
        guardar();
      });
      return fila;
    }
    return linha;
  }

  // ---------- retomar o que ficou no rascunho ----------
  const semanaDe = iso => { const [a, m, d] = iso.split('-').map(Number); return segundaDe(new Date(a, m - 1, d)); };

  // casa os rascunhos da semana `inicio` (e os de Tarefas/Notas) com o que o servidor devolveu. Rascunho sem id cujo POST
  // saiu mas não teve resposta adota a linha de mesmo quadro, data e texto, em vez de criar outra.
  function casarRascunhos(entradas, servidor, inicio) {
    const fim = somarDias(inicio, 6);
    const daSemana = Object.entries(entradas).filter(([, e]) => e.quadro !== 'dia' || (e.data >= inicio && e.data <= fim));
    const usados = new Set(daSemana.map(([, e]) => e.id).filter(Boolean));
    return daSemana.map(([chave, entrada]) => {
      let base = null;
      if (entrada.id) {
        base = servidor.find(l => l.id === entrada.id)
          || { id: entrada.id, quadro: entrada.quadro, data: entrada.data, texto: '', feita: false, sumiu: true };
      } else if (entrada.enviado) {
        base = servidor.find(l => !usados.has(l.id) && l.quadro === entrada.quadro && (l.data ?? null) === (entrada.data ?? null) && l.texto === entrada.enviado) || null;
        if (base) usados.add(base.id);
      }
      // nada escrito e nada no servidor para apagar
      return { chave, entrada, base, descartar: !entrada.texto && (!base || !!base.sumiu) };
    });
  }

  // recria a linha de um rascunho, pela mesma fila de sempre, e manda salvar.
  // Item de série com texto mudado e sem a escolha (só este / próximos / todos) guardada: o texto NÃO é enviado sozinho
  // (`decidir`: a tela mostra o texto e pede a escolha); caixinha e alarme seguem como sempre.
  function retomar(chamar, { chave, entrada, base }, rascunhos, opcoes = {}) {
    const linha = criarLinha(chamar, base || { quadro: entrada.quadro, data: entrada.data, texto: '', feita: false }, { ...opcoes, rascunhos, chave });
    const decidir = !!base?.serieId && !base.sumiu && limpar(entrada.texto) !== base.texto && !entrada.escopo;
    linha.anotar(entrada.texto, entrada.feita);
    let pronto = decidir ? Promise.resolve() : linha.salvarTexto(entrada.texto, entrada.escopo);
    if (entrada.texto && entrada.quadro !== 'notas' && !!entrada.feita !== !!base?.feita) pronto = linha.marcar(entrada.feita);
    if (entrada.texto && entrada.quadro !== 'notas' && entrada.alarme !== undefined) pronto = linha.alarmar(entrada.alarme);
    return { linha, pronto, decidir };
  }

  // dias de semanas que não são a aberta: salva sem desenhar. O que falhar continua guardado e aparece naquela semana.
  async function recuperarFora(chamar, herdados, rascunhos, inicioAberto) {
    const fora = e => e.quadro === 'dia' && semanaDe(e.data) !== inicioAberto;
    const falhas = [];
    for (const inicio of [...new Set(Object.values(herdados).filter(fora).map(e => semanaDe(e.data)))]) {
      const dela = Object.fromEntries(Object.entries(herdados).filter(([, e]) => e.quadro === 'dia' && semanaDe(e.data) === inicio));
      let falhou = false;
      try {
        const r = await chamar('/minha_semana?inicio=' + inicio);
        for (const c of casarRascunhos(dela, r.linhas || [], inicio)) {
          if (c.descartar) { rascunhos.remover(c.chave); delete herdados[c.chave]; continue; }
          const { linha, pronto, decidir } = retomar(chamar, c, rascunhos);
          await pronto;
          if (!linha.erro && !decidir) { delete herdados[c.chave]; continue; }   // série sem escolha: fica para quando a semana abrir
          falhou = true;
          herdados[c.chave] = rascunhos.ler()[c.chave] || c.entrada;
        }
      } catch { falhou = true; }
      if (falhou) falhas.push(inicio);
    }
    return falhas;
  }

  // no celular o aviso de saída não é confiável: ao esconder ou fechar a aba, salva o que falta (cada linha tem sua fila)
  function ligarSaida(win, salvarTudo) {
    win.document.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'hidden') salvarTudo(); });
    win.addEventListener('pagehide', () => salvarTudo());
  }

  // ============ TELA (só no navegador) ============
  const SVG = 'http://www.w3.org/2000/svg';
  function icone(doc, d, viewBox = '0 0 24 24', preenchido = false) {
    const svg = doc.createElementNS(SVG, 'svg');
    const attrs = preenchido ? { viewBox, fill: 'currentColor', 'aria-hidden': 'true' }
      : { viewBox, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    const p = doc.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
    return svg;
  }
  // seis pontinhos da alça e os três do marcador (menu), cheios e grandes o bastante para aparecer sobre qualquer cor de faixa
  const PONTOS_ALCA = 'M1.2 1.2h2.4v2.4H1.2zM5.4 1.2h2.4v2.4H5.4zM1.2 5.8h2.4v2.4H1.2zM5.4 5.8h2.4v2.4H5.4zM1.2 10.4h2.4v2.4H1.2zM5.4 10.4h2.4v2.4H5.4z';
  const PONTOS_MENU = 'M3 12a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0M9.8 12a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0M16.6 12a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0';

  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const api = C.criarApi(win);
    const auth = api.getAuth();
    if (!auth) { win.location.href = C.LOGIN_URL; return; }
    $('user-empresa').textContent = auth.user.empresa || 'Elegance';
    $('user-name').textContent = auth.user.nome || '';
    $('user-cargo').textContent = auth.user.cargo || '';
    $('user-avatar').textContent = (auth.user.nome || 'E').charAt(0).toUpperCase();
    // escondida (modo atendimento): não busca nem desenha as anotações
    if (win.Acesso && !win.Acesso.podePagina('tarefas.html')) return;
    const toast = C.criarToast(doc, win);
    // outro usuário entrou em outra aba: o texto desta tela não pode ir para o caderno dele
    const quemSou = () => idDoToken(api.getAuth()?.token);
    const dono = idDoToken(auth.token);
    const chamar = async (caminho, opcoes) => {
      const agora = quemSou();
      if (agora !== null && agora !== dono) { win.location.reload(); throw new Error('Outro usuário entrou neste navegador.'); }
      const resposta = await api.chamar(caminho, opcoes);
      gravou(opcoes?.metodo);
      return resposta;
    };
    const gravou = metodo => { if (metodo === 'PUT' || metodo === 'DELETE') win.dispatchEvent(new win.CustomEvent('alarmes-mudou')); };
    const rascunhos = criarRascunhos(() => win.localStorage, dono);
    // só o que já estava guardado ao abrir é retomado (o que nasce depois pertence às linhas da tela)
    const estado = { mostrada: null, alvo: segundaDe(new Date()), geracao: 0, linhas: [], herdados: rascunhos.ler(), recuperacao: null,
      quadros: [], categorias: new Map(), arrastando: false };
    let sequencia = 0;
    const novaChave = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${++sequencia}`;
    const semana = $('semana');
    const aviso = $('aviso-semana');
    const ui = AG.criarUi(doc, win);
    const legenda = AG.criarLegenda(() => win.localStorage, 'minha_semana_legenda:' + dono);
    const porLi = new WeakMap();

    const criar = (tag, classe, texto) => {
      const e = doc.createElement(tag);
      if (classe) e.className = classe;
      if (texto !== undefined) e.textContent = texto;
      return e;
    };

    // ---------- categorias: legenda no topo, cor de cada faixa ----------
    function aplicarCategorias(lista) {
      const ordem = [...(lista || [])].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' }) || a.id - b.id);
      estado.categorias = AG.indexar(ordem);
      legenda.podar(estado.categorias);
      ui.desenharLegenda($('legenda'), { categorias: estado.categorias, legenda, aoMudar: () => estado.linhas.forEach(pintar) });
      estado.linhas.forEach(pintar);
    }
    function pintarFaixa(item) {
      const { linha, li } = item;
      const salva = !!linha.dados.id;
      li.classList.toggle('salva', salva);
      li.dataset.cor = salva ? AG.corDe(linha.dados.categoriaId, estado.categorias) : '';
      item.alca.hidden = item.marcador.hidden = !salva;
      item.serie.hidden = !salva || !linha.dados.serieId;
      item.marcador.setAttribute('aria-label', `Opções do item (categoria: ${AG.nomeDe(linha.dados.categoriaId, estado.categorias)}${linha.dados.serieId ? '; repete' : ''})`);
      // a legenda esconde a categoria, mas nunca o que está sendo escrito, esperando a escolha da série ou deu erro
      li.hidden = salva && !legenda.visivel(linha.dados.categoriaId, estado.categorias) && !linha.erro && !item.decidir && !linha.pendente() && !li.contains(doc.activeElement);
    }

    function pintar(item) {
      const { linha, li, aviso: msg, input, caixa } = item;
      pintarFaixa(item);
      pintarSino(item);
      li.classList.toggle('erro', linha.erro || !!item.decidir);
      item.decisao.hidden = !item.decidir || linha.erro;
      msg.hidden = !linha.erro;
      msg.textContent = linha.erro ? `Não salvou: ${linha.mensagem.replace(/\.$/, '')}. Aperte Enter na linha para tentar de novo.` : '';
      if (!caixa) return;
      caixa.disabled = input.readOnly || !input.value.trim();
      if (!input.value.trim() && !linha.dados.id) caixa.checked = false;
      li.classList.toggle('feita', caixa.checked);
    }
    // linha que ficou vazia no meio do quadro (texto apagado e excluído) sai da tela; sempre sobra a vazia do fim
    function tirarVazia(item) {
      const { linha, li, input, quadro: q } = item;
      if (linha.dados.id || input.value.trim() || linha.pendente() || linha.erro || li.contains(doc.activeElement) || q.lista.lastElementChild === li || !li.isConnected) return;
      li.remove();
      estado.linhas = estado.linhas.filter(i => i !== item);
    }
    // Grava o texto da linha. Item de série com o texto mudado pergunta antes a quais itens vale, mas SÓ quando a pessoa termina
    // (Enter, ou sair da linha: `modo` 'enter'/'blur'); nunca a cada tecla nem quando nada mudou. Sem a escolha (troca de semana,
    // aba escondida, Cancelar) nada é enviado: o texto fica no campo e no rascunho, e a linha mostra o aviso com "Escolher"/"Desfazer".
    // Depois de um Cancelar, sair da linha de novo não pergunta outra vez pelo mesmo texto (só Enter ou "Escolher").
    function salvar(item, modo) {
      const { linha, input } = item;
      const novo = limpar(input.value);
      if (AG.precisaEscopo(linha.dados, novo) && linha.escolha?.texto !== novo) {
        if (item.perguntando) return Promise.resolve();
        if (modo === 'enter' || (modo === 'blur' && item.cancelado !== novo)) return perguntarSerie(item);
        item.decidir = true;
        pintar(item);
        return Promise.resolve();
      }
      item.decidir = false;
      item.cancelado = null;
      return linha.salvarTexto(input.value).then(() => { pintar(item); tirarVazia(item); });
    }
    async function perguntarSerie(item) {
      const { linha, input } = item;
      const novo = limpar(input.value);
      item.perguntando = true;
      const escopo = await ui.perguntarEscopo(novo
        ? { titulo: 'Mudar item que se repete', texto: `Mudar o texto para “${novo}”. Vale para quais repetições?` }
        : { titulo: 'Apagar item que se repete', texto: `Apagar “${linha.dados.texto}”. Vale para quais repetições?`, nota: 'Nos próximos e em todos, os itens já concluídos não são apagados.' });
      item.perguntando = false;
      if (!escopo) {   // Cancelar: nada é gravado; o texto digitado fica no campo
        item.decidir = true;
        item.cancelado = novo;
        pintar(item);
        return;
      }
      item.decidir = false;
      item.cancelado = null;
      pintar(item);
      await linha.salvarTexto(input.value, escopo);
      pintar(item);
      tirarVazia(item);
    }
    // aviso da linha de série esperando a escolha: "Escolher" pergunta de novo; "Desfazer" volta ao texto salvo
    function criarDecisao(item) {
      const caixa = criar('div', 'linha-duvida');
      caixa.setAttribute('role', 'status');
      caixa.hidden = true;
      const b = (rotulo, acao) => { const x = criar('button', 'btn btn-secondary btn-mini', rotulo); x.type = 'button'; x.addEventListener('click', acao); return x; };
      caixa.append(criar('p', '', 'Não salvo: falta escolher a quais repetições a mudança vale.'),
        b('Escolher', () => perguntarSerie(item)),
        b('Desfazer', () => {
          item.input.value = item.linha.dados.texto;
          item.linha.anotar(item.input.value);
          item.decidir = false;
          item.cancelado = null;
          ajustar(item.input);
          pintar(item);
          item.input.focus();
        }));
      return caixa;
    }
    // a série mudou outros itens (resposta do servidor): os que estão na tela e livres são atualizados; o resto aparece ao recarregar
    const livre = item => !item.linha.pendente() && !item.linha.erro && !item.decidir && !item.editor && !item.li.contains(doc.activeElement)
      && limpar(item.input.value) === item.linha.dados.texto;
    function aplicarSerie(serie, origem) {
      for (const l of serie.alteradas || []) {
        const it = l.id !== origem && estado.linhas.find(i => i.linha.dados.id === l.id);
        if (!it || !livre(it)) continue;
        it.linha.adotar(l);
        it.input.value = it.linha.dados.texto;
        ajustar(it.input);
        pintar(it);
      }
      for (const id of serie.apagadas || []) {
        const it = id !== origem && estado.linhas.find(i => i.linha.dados.id === id);
        if (it && livre(it)) remover(it);
      }
      const texto = AG.resumoSerie(serie);
      if (texto) toast(texto, 'ok');
    }
    // ---------- alarme da linha ----------
    function criarSino(item) {
      const botao = criar('button', 'sino');
      botao.type = 'button';
      botao.title = 'Alarme';
      botao.append(icone(doc, 'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8M10 21h4'));
      botao.addEventListener('click', () => { if (!item.editor) abrirEditor(item); });
      return { botao, hora: criar('p', 'linha-hora') };
    }
    function pintarSino(item) {
      const { sino, linha, input } = item;
      if (!sino) return;
      const vazia = !input.value.trim();
      if (vazia || input.readOnly) fecharEditor(item);
      sino.botao.classList.toggle('vazia', vazia);
      sino.botao.disabled = vazia || input.readOnly;
      const quando = vazia ? null : linha.alarme;
      sino.botao.classList.toggle('marcado', !!quando);
      sino.botao.setAttribute('aria-label', quando ? `Alarme em ${horaCurta(quando)}: trocar ou remover` : 'Pôr alarme');
      sino.hora.textContent = quando ? 'Alarme ' + horaCurta(quando) : '';
      sino.hora.hidden = !quando;
    }
    function fecharEditor(item) {
      const janela = item.editor;
      if (!janela) return;
      item.editor = null;
      janela.close();
      janela.remove();
    }
    // janela própria (DESIGN.md): nas colunas estreitas o campo de data e hora não cabe dentro da linha
    function abrirEditor(item) {
      const janela = criar('dialog', 'dlg-padrao alarme-escolha');
      const cab = criar('div', 'dlg-cab'), corpo = criar('div', 'dlg-corpo'), rodape = criar('div', 'dlg-rodape');
      const titulo = criar('h3', '', 'Alarme');
      titulo.id = 'alarme-escolha-titulo';
      janela.setAttribute('aria-labelledby', titulo.id);
      cab.append(titulo, criar('p', '', item.input.value));
      const campo = criar('input');
      campo.type = 'datetime-local';
      campo.setAttribute('aria-label', 'Data e hora do alarme');
      campo.value = (item.linha.alarme || sugestaoDeAlarme(item.quadro.data, new Date())).replace(' ', 'T');
      corpo.append(campo);
      const sair = () => { fecharEditor(item); item.sino.botao.focus(); };
      const gravar = quando => {
        fecharEditor(item);
        salvar(item);   // o texto vai primeiro (linha nova ainda não existe no servidor); o alarme entra na mesma fila
        item.linha.alarmar(quando).then(() => pintar(item));
        pintar(item);
        item.input.focus();
      };
      const confirmar = () => {
        const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(campo.value);
        if (!m) return toast('Escolha a data e a hora do alarme.', 'erro');
        gravar(m[1] + ' ' + m[2]);
      };
      const botao = (classe, rotulo, acao) => { const b = criar('button', 'btn ' + classe, rotulo); b.type = 'button'; b.addEventListener('click', acao); return b; };
      if (item.linha.alarme) rodape.append(botao('btn-secondary', 'Remover', () => gravar(null)));
      rodape.append(botao('btn-secondary', 'Cancelar', sair), botao('btn-primary', 'Salvar', confirmar));
      campo.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); } });
      janela.addEventListener('cancel', ev => { ev.preventDefault(); sair(); });   // Esc
      janela.append(cab, corpo, rodape);
      item.editor = janela;
      doc.body.append(janela);
      janela.showModal();
      campo.focus();
    }

    // ---------- menu da faixa, trocar a categoria e mover ----------
    const quadroDe = d => estado.quadros.find(q => q.quadro === d.quadro && (q.quadro !== 'dia' || q.data === d.data)) || null;
    // a posição em que o servidor devolve (ordem de criação), antes da linha vazia do fim
    function inserirNaOrdem(q, li, id) {
      const depois = [...q.lista.children].find(el => el !== li && (!porLi.get(el)?.linha.dados.id || porLi.get(el).linha.dados.id > id));
      q.lista.insertBefore(li, depois || null);
    }
    function remover(item) {
      ui.fecharMenu(false);
      fecharEditor(item);
      item.li.remove();
      estado.linhas = estado.linhas.filter(i => i !== item);
    }
    function sumiu(item) {
      remover(item);
      toast('Este item foi apagado em outro aparelho.', 'erro');
    }
    async function colorir(item, id) {
      if (id === (estado.categorias.has(item.linha.dados.categoriaId) ? item.linha.dados.categoriaId : null)) return;
      let escopo;
      if (item.linha.dados.serieId) {   // item de série: a quais repetições vale a categoria nova?
        escopo = await ui.perguntarEscopo({ titulo: 'Trocar a categoria do item que se repete', texto: `Trocar para “${AG.nomeDe(id, estado.categorias)}”. Vale para quais repetições?` });
        if (!escopo) return;
      }
      item.li.classList.add('movendo');
      item.linha.colorir(id, escopo).then(r => {
        item.li.classList.remove('movendo');
        if (r.sumiu) return sumiu(item);
        if (!r.ok) toast(`Não foi possível trocar a categoria. ${r.mensagem}`, 'erro');
        pintar(item);
      });
    }
    async function moverItem(item, destino) {
      const d = item.linha.dados;
      if (AG.mesmoLugar(d, destino)) return;
      if (!AG.podeArrastar(item)) { toast('Espere o texto ser salvo antes de mover.', 'erro'); return; }
      if (AG.pedeConfirmacaoNotas(d, destino) && !(await ui.confirmar({ titulo: 'Mover para Notas', sim: 'Mover',
        texto: 'Notas não têm alarme nem caixinha. Ao mover, o alarme deste item é apagado e ele deixa de estar concluído.' }))) return;
      const origem = { lista: item.li.parentNode, depois: item.li.nextSibling };
      const q = quadroDe(destino);
      if (q) inserirNaOrdem(q, item.li, d.id);
      item.li.classList.add('movendo');
      const r = await item.linha.mover(destino);
      item.li.classList.remove('movendo');
      if (r.sumiu) return sumiu(item);
      if (!r.ok) {
        origem.lista.insertBefore(item.li, origem.depois && origem.depois.parentNode === origem.lista ? origem.depois : origem.lista.lastElementChild);
        toast(`Não foi possível mover. ${r.mensagem.replace(/\.$/, '')}. O item voltou ao lugar.`, 'erro');
        return;
      }
      if (!q) { remover(item); toast(`Movido para ${diaMes(destino.data)}.`, 'ok'); return; }
      // caixinha e alarme dependem do quadro: a faixa é refeita no destino com o que o servidor devolveu
      novaLinha(q, r.linha || { ...item.linha.dados }, null, item.li);
      remover(item);
    }
    function abrirMenuDo(item) {
      ui.abrirMenu({ ancora: item.marcador, categorias: estado.categorias, atual: item.linha.dados.categoriaId,
        aoEscolher: id => colorir(item, id),
        aoMover: () => ui.abrirMover({ texto: item.input.value, atual: item.linha.dados, aoMover: d => moverItem(item, d),
          destinos: estado.quadros.map(q => ({ quadro: q.quadro, data: q.data, rotulo: q.rotulo })) }),
        aoRepetir: AG.podeRepetir(item.linha.dados) ? () => abrirRepetirDo(item) : null,
        aoCategorias: abrirCategorias });
    }
    // ---------- "Repetir...": cada data vira um item próprio; o item vai para a primeira data ----------
    function colocar(l) {
      const q = quadroDe(l);
      if (!q) return;
      const nova = novaLinha(q, l, null, q.lista.lastElementChild);
      inserirNaOrdem(q, nova.li, l.id);
    }
    function abrirRepetirDo(item) {
      if (!AG.podeArrastar(item)) { toast('Espere o texto ser salvo antes de repetir.', 'erro'); return; }
      const d = item.linha.dados;
      // referência da repetição mensal: a data do item; em Tarefas, hoje (o servidor faz a mesma conta)
      const inicio = d.quadro === 'dia' ? d.data : isoLocal(new Date());
      ui.abrirRepetir({ texto: item.input.value, inicio, fim: somarDias(inicio, 6), diaDoMes: Number(inicio.slice(8, 10)), maxMeses: R.MAX_MESES, resumo: R.resumo,
        calcular: regra => { const v = R.validarRegra(regra); return v.ok ? R.datasDaRegra(v.regra, inicio) : v; },
        aoConfirmar: async regra => {
          const r = await item.linha.repetir(regra);
          if (r.sumiu) { sumiu(item); return; }
          if (r.jaEmSerie) { toast('Este item já se repete. A semana foi recarregada.', 'erro'); irPara(estado.mostrada); return; }
          if (!r.ok) throw new Error(r.mensagem || 'Não foi possível repetir.');
          remover(item);
          for (const l of r.resposta.linhas) colocar(l);
          const ds = r.resposta.linhas.map(l => l.data);
          toast(`Repete em ${ds.length} dias, de ${R.dataBR(ds[0])} a ${R.dataBR(ds[ds.length - 1])}.`, 'ok');
        } });
    }
    // ---------- janela "Categorias" (só as desta pessoa) ----------
    const BASE_CAT = '/minha_semana/categorias';
    function abrirCategorias() {
      const lista = () => [...estado.categorias.values()];
      ui.abrirCategorias({ categorias: () => estado.categorias, subtitulo: 'Só você vê as suas categorias.', api: {
        criar: (nome, cor) => chamar(BASE_CAT, { metodo: 'POST', corpo: { nome, cor } }).then(c => aplicarCategorias([...lista(), c])),
        mudar: (id, campos) => chamar(`${BASE_CAT}/${id}`, { metodo: 'PUT', corpo: campos }).then(c => aplicarCategorias(lista().map(x => (x.id === id ? c : x)))),
        excluir: id => chamar(`${BASE_CAT}/${id}`, { metodo: 'DELETE' }).then(() => {
          for (const it of estado.linhas) if (it.linha.dados.categoriaId === id) it.linha.dados.categoriaId = null;   // o servidor já tirou
          aplicarCategorias(lista().filter(x => x.id !== id));
        })
      } });
    }

    // o campo cresce com o texto, para ele aparecer inteiro em coluna estreita
    const ajustar = campo => { campo.style.height = 'auto'; campo.style.height = campo.scrollHeight + 'px'; };
    const ajustarTodos = () => { for (const item of estado.linhas) ajustar(item.input); };

    function novaLinha(q, dados, rascunho, antesDe = null) {
      const opcoes = { aoSerie: aplicarSerie };
      const volta = rascunho ? retomar(chamar, rascunho, rascunhos, opcoes) : null;
      const linha = volta ? volta.linha
        : criarLinha(chamar, { quadro: q.quadro, data: q.data, texto: '', feita: false, ...dados }, { ...opcoes, rascunhos, chave: novaChave() });
      const li = criar('li', 'linha');
      const item = { linha, li, quadro: q, input: criar('textarea'), caixa: null, aviso: criar('p', 'linha-aviso'), alca: criar('span', 'alca'), marcador: criar('button', 'marcador'),
        serie: criar('span', 'ag-serie', '↻'), lado: criar('span', 'ag-lado'), decidir: !!volta?.decidir, perguntando: false, cancelado: null };
      porLi.set(li, item);
      // ↻ = item que se repete (o leitor de tela ouve "Item que se repete"); fica embaixo do "⋯" para não roubar largura do texto
      item.serie.setAttribute('role', 'img');
      item.serie.setAttribute('aria-label', 'Item que se repete');
      item.serie.title = 'Item que se repete';
      item.decisao = criarDecisao(item);
      // alça: segurar e arrastar para outro dia, Tarefas ou Notas (só a faixa já salva); pelo teclado, "Mover para..." no menu
      item.alca.title = 'Arrastar para outro dia';
      item.alca.setAttribute('aria-hidden', 'true');
      item.alca.append(icone(doc, PONTOS_ALCA, '0 0 9 14', true));
      // alça e caixinha numa coluna só (no computador ficam uma em cima da outra, para o texto ganhar largura; no toque, lado a lado)
      item.esq = criar('span', 'ag-esq');
      item.esq.append(item.alca);
      li.append(item.esq);
      item.marcador.type = 'button';
      item.marcador.setAttribute('aria-haspopup', 'menu');
      item.marcador.setAttribute('aria-expanded', 'false');
      item.marcador.append(icone(doc, PONTOS_MENU, '0 0 24 24', true));
      item.marcador.addEventListener('click', () => abrirMenuDo(item));
      if (q.quadro !== 'notas') {   // nota é anotação: sem caixinha
        item.caixa = criar('input');
        item.caixa.type = 'checkbox';
        item.caixa.checked = volta ? !!rascunho.entrada.feita : linha.dados.feita;
        item.caixa.setAttribute('aria-label', 'Concluída');
        item.caixa.addEventListener('change', () => {
          const marcada = item.caixa.checked;
          li.classList.toggle('feita', marcada);
          linha.anotar(input.value, marcada);
          salvar(item);   // o texto vai primeiro (no iPhone o toque na caixinha não tira o foco da linha)
          linha.marcar(marcada).then(() => pintar(item));
        });
        item.esq.append(item.caixa);
      }
      if (alarmesAtivos() && q.quadro !== 'notas') item.sino = criarSino(item);
      const input = item.input;
      input.rows = 1;
      input.maxLength = 300;
      input.autocomplete = 'off';
      input.enterKeyHint = 'next';
      input.placeholder = '+ Novo item';
      input.value = volta ? rascunho.entrada.texto : linha.dados.texto;
      input.setAttribute('aria-label', q.rotulo);
      input.addEventListener('input', () => {
        if (semQuebra(input.value) !== input.value) {   // colado com várias linhas
          const cursor = input.selectionStart;
          input.value = semQuebra(input.value).slice(0, 300);
          input.setSelectionRange(cursor, cursor);
        }
        ajustar(input);
        linha.anotar(input.value, item.caixa ? item.caixa.checked && !!input.value.trim() : undefined);
        if (item.caixa) item.caixa.disabled = !input.value.trim();
        pintarSino(item);
        if (input.value.trim() && q.lista.lastElementChild === li) novaLinha(q);   // sempre uma vazia no fim
      });
      input.addEventListener('blur', () => { salvar(item, 'blur'); });
      // Enter salva e vai para a próxima linha; nunca entra uma quebra no texto (item de série: a pergunta fica com o foco)
      const enter = () => {
        if (input.readOnly) return;
        salvar(item, 'enter');
        if (item.perguntando) return;
        if (input.value.trim() && q.lista.lastElementChild === li) novaLinha(q);
        li.nextElementSibling?.querySelector('textarea').focus();
      };
      input.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter' || ev.isComposing) return;
        ev.preventDefault();
        enter();
      });
      input.addEventListener('beforeinput', ev => {   // teclado de celular que não informa a tecla
        if ((ev.inputType !== 'insertLineBreak' && ev.inputType !== 'insertParagraph') || ev.isComposing) return;
        ev.preventDefault();
        enter();
      });
      item.lado.append(item.marcador, item.serie);
      li.append(input, item.lado, ...(item.sino ? [item.sino.botao, item.sino.hora] : []), item.aviso, item.decisao);
      q.lista.insertBefore(li, antesDe);
      estado.linhas.push(item);
      pintar(item);
      ajustar(input);
      if (volta && !volta.decidir) {
        li.classList.add('erro');
        item.aviso.textContent = 'Texto que não tinha sido salvo. Salvando…';
        item.aviso.hidden = false;
        volta.pronto.then(() => pintar(item));
      }
      return item;
    }

    function desenhar(inicio, linhas, categorias) {
      const hoje = isoLocal(new Date());
      const quadros = DIAS.map(([area, nome], i) => {
        const data = somarDias(inicio, i);
        return { area, nome, quadro: 'dia', data, dia: diaMes(data), rotulo: `${nome} ${diaMes(data)}`, hoje: data === hoje };
      });
      quadros.push({ area: 'tar', nome: 'Tarefas', quadro: 'tarefas', data: null, rotulo: 'Tarefas' });
      quadros.push({ area: 'not', nome: 'Notas', quadro: 'notas', data: null, rotulo: 'Notas' });
      semana.replaceChildren();
      estado.linhas = [];
      estado.quadros = quadros;
      aplicarCategorias(categorias);
      const porId = new Map(), soltos = [];
      for (const c of casarRascunhos(estado.herdados, linhas, inicio)) {
        delete estado.herdados[c.chave];
        if (c.descartar) rascunhos.remover(c.chave);
        else if (c.base && !c.base.sumiu) porId.set(c.base.id, c);
        else soltos.push(c);
      }
      for (const q of quadros) {
        const sec = criar('section', `quadro q-${q.area}${q.hoje ? ' hoje' : ''}`);
        q.sec = sec;
        let titulo;
        if (q.dia) {   // dia da semana curto e o número grande; hoje num círculo
          titulo = criar('h2', 'q-cab');
          const sem = criar('span', 'q-sem', AG.SEMANA_CURTA[q.area]), num = criar('span', 'q-num', q.data.slice(8, 10));
          sem.setAttribute('aria-hidden', 'true');
          num.setAttribute('aria-hidden', 'true');
          titulo.append(sem, num, criar('span', 'ag-sr', `${q.nome} ${q.dia}${q.hoje ? ', hoje' : ''}`));
        } else titulo = criar('h2', 'q-cab-fixo', q.nome);
        q.lista = criar('ul', 'linhas');
        sec.append(titulo, q.lista);
        semana.append(sec);
        const minhas = linhas.filter(l => l.quadro === q.quadro && (q.quadro !== 'dia' || l.data === q.data));
        for (const l of minhas) novaLinha(q, l, porId.get(l.id));
        const extras = soltos.filter(c => c.entrada.quadro === q.quadro && (q.quadro !== 'dia' || c.entrada.data === q.data));
        for (const c of extras) novaLinha(q, null, c);
        novaLinha(q);   // uma vazia no fim, para escrever (o item novo nasce sem categoria)
      }
      estado.mostrada = inicio;
      ajustarTodos();   // com a página inteira montada a largura é a final (barra de rolagem)
      // no celular os quadros ficam um embaixo do outro: a semana atual abre em hoje
      if (win.matchMedia('(max-width: 700px)').matches) semana.querySelector('.quadro.hoje')?.scrollIntoView({ block: 'start' });
    }

    function travar(sim) {
      semana.setAttribute('aria-busy', String(sim));
      for (const item of estado.linhas) { item.input.readOnly = sim; pintar(item); }
    }
    function mostrarSemana(inicio) {
      $('rotulo-mes').textContent = AG.rotuloMes(inicio);
      $('rotulo-semana').textContent = rotuloSemana(inicio);
    }

    async function irPara(inicio) {
      const geracao = ++estado.geracao;
      estado.alvo = inicio;
      mostrarSemana(inicio);
      ui.fecharMenu(false);
      travar(true);
      aviso.hidden = true;
      // antes de trocar: grava o que está escrito e espera as filas
      await Promise.all(estado.linhas.map(i => salvar(i)));
      if (geracao !== estado.geracao) return;
      if (estado.linhas.some(i => i.linha.erro || i.decidir)) {
        travar(false);
        estado.alvo = estado.mostrada;
        mostrarSemana(estado.mostrada);
        toast(estado.linhas.some(i => i.decidir && !i.linha.erro)
          ? 'Há item que se repete esperando você escolher se a mudança vale só para ele ou para as repetições. A semana não foi trocada.'
          : 'Há texto que não foi salvo. A semana não foi trocada.', 'erro');
        return;
      }
      estado.linhas = [];
      semana.replaceChildren(criar('p', 'vazio', 'Carregando…'));
      // uma vez só, antes do primeiro GET: o que ficou guardado de dias de outras semanas
      estado.recuperacao ||= recuperarFora(chamar, estado.herdados, rascunhos, inicio).then(falhas => {
        if (falhas.length) toast(`Há texto não salvo na semana ${falhas.map(rotuloSemana).join(', ')}. Abra a semana para tentar de novo.`, 'erro');
      });
      await estado.recuperacao;
      if (geracao !== estado.geracao) return;
      let resposta;
      try {
        resposta = await chamar('/minha_semana?inicio=' + inicio);
      } catch (e) {
        if (geracao !== estado.geracao) return;   // resposta de pedido antigo não vale
        semana.replaceChildren();
        semana.setAttribute('aria-busy', 'false');
        $('aviso-texto').textContent = 'Não foi possível carregar a semana. ' + e.message;
        aviso.hidden = false;
        return;
      }
      if (geracao !== estado.geracao) return;
      semana.setAttribute('aria-busy', 'false');
      desenhar(inicio, Array.isArray(resposta.linhas) ? resposta.linhas : [], Array.isArray(resposta.categorias) ? resposta.categorias : []);
    }

    // arraste pela alça: soltar num dia, em Tarefas ou em Notas (Esc ou pointercancel desfazem)
    ui.ligarArraste({ raiz: semana,
      podeArrastar: li => { const it = porLi.get(li); return !!it && AG.podeArrastar(it); },
      aoNegar: li => { if (porLi.get(li)?.linha.dados.id) toast('Espere o texto ser salvo antes de mover.', 'erro'); },
      aoSoltar: (li, sec) => { const it = porLi.get(li), q = estado.quadros.find(x => x.sec === sec); if (it && q) moverItem(it, { quadro: q.quadro, data: q.data }); },
      aoMudar: sim => { estado.arrastando = sim; if (sim) ui.fecharMenu(false); } });

    $('btn-anterior').addEventListener('click', () => irPara(somarDias(estado.alvo, -7)));
    $('btn-proxima').addEventListener('click', () => irPara(somarDias(estado.alvo, 7)));
    $('btn-hoje').addEventListener('click', () => irPara(segundaDe(new Date())));
    $('btn-tentar').addEventListener('click', () => irPara(estado.alvo));
    $('btn-categorias').addEventListener('click', abrirCategorias);
    win.addEventListener('beforeunload', ev => {
      if (!estado.linhas.some(i => i.linha.pendente() || limpar(i.input.value) !== i.linha.dados.texto)) return;
      ev.preventDefault();
      ev.returnValue = '';
    });
    win.addEventListener('resize', ajustarTodos);   // mudou a largura da coluna, mudam as quebras
    doc.fonts?.ready.then(ajustarTodos);
    ligarSaida(win, () => { for (const item of estado.linhas) if (!item.input.readOnly) salvar(item); });
    irPara(estado.alvo);
  }

  return { segundaDe, somarDias, rotuloSemana, semQuebra, horaCurta, sugestaoDeAlarme, criarLinha, idDoToken, criarRascunhos, casarRascunhos, retomar, recuperarFora, ligarSaida, iniciar };
});
