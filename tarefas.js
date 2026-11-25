// ==========================================================================
// tarefas.html — "Minha semana": caderno pessoal de tarefas (sete dias, Tarefas e Notas). Cada um vê só o seu.
// Rotas: GET /minha_semana?inicio=, POST /minha_semana, PUT e DELETE /minha_semana/:id.
// Funções puras testadas no Node (test/minha_semana_tela.test.js); o desenho da tela fica no fim (só no navegador).
// O texto da tarefa só entra na tela por input.value; o resto, por textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Tarefas = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;

  const MIN_LINHAS = 8;
  // ordem do celular (e do teclado); no computador o CSS põe em 3 colunas: Seg Ter Qua | Qui Sex Sáb | Tarefas Notas Domingo
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
  function criarLinha(chamar, inicial, { rascunhos, chave } = {}) {
    const dados = { id: inicial.id ?? null, quadro: inicial.quadro, data: inicial.data ?? null, texto: inicial.texto || '', feita: !!inicial.feita };
    const alvo = { texto: dados.texto, feita: dados.feita };
    let fila = Promise.resolve();
    let naFila = 0;
    const escrito = { texto: dados.texto, feita: dados.feita };   // o último digitado/marcado, antes mesmo de entrar na fila
    let enviado = null;   // texto de um POST sem resposta: pode ter chegado ao servidor

    function guardar() {
      if (!rascunhos) return;
      if (!enviado && escrito.texto === dados.texto && (!dados.id || escrito.feita === dados.feita)) return rascunhos.remover(chave);
      rascunhos.gravar(chave, { id: dados.id, quadro: dados.quadro, data: dados.data, texto: escrito.texto, feita: escrito.feita, ...(enviado ? { enviado } : {}) });
    }
    function anotar(texto, feita) {
      if (texto !== undefined) escrito.texto = limpar(texto);
      if (feita !== undefined) escrito.feita = !!feita;
      guardar();
    }

    const esquecer = () => { dados.id = null; dados.texto = ''; dados.feita = false; };
    async function excluir() {
      try { await chamar('/minha_semana/' + dados.id, { metodo: 'DELETE' }); } catch (e) { if (e.status !== 404) throw e; }
      esquecer();
      alvo.feita = false;
      if (!escrito.texto) escrito.feita = false;
      guardar();
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
      if (!Object.keys(corpo).length) return;
      try {
        await chamar('/minha_semana/' + dados.id, { metodo: 'PUT', corpo });
      } catch (e) {
        if (e.status !== 404) throw e;
        esquecer();   // apagada em outro aparelho: o que está escrito aqui vira uma linha nova
        return sincronizar();
      }
      Object.assign(dados, corpo);
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
      // há algo que o servidor ainda não tem?
      pendente: () => naFila > 0 || alvo.texto !== dados.texto || (!!dados.id && alvo.feita !== dados.feita),
      anotar,
      salvarTexto: t => { anotar(t); return enfileirar(() => { alvo.texto = limpar(t); }); },
      marcar: b => { anotar(undefined, b); return enfileirar(() => { alvo.feita = !!b; }); }
    };
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

  // recria a linha de um rascunho, pela mesma fila de sempre, e manda salvar
  function retomar(chamar, { chave, entrada, base }, rascunhos) {
    const linha = criarLinha(chamar, base || { quadro: entrada.quadro, data: entrada.data, texto: '', feita: false }, { rascunhos, chave });
    linha.anotar(entrada.texto, entrada.feita);
    let pronto = linha.salvarTexto(entrada.texto);
    if (entrada.texto && entrada.quadro !== 'notas' && !!entrada.feita !== !!base?.feita) pronto = linha.marcar(entrada.feita);
    return { linha, pronto };
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
          const { linha, pronto } = retomar(chamar, c, rascunhos);
          await pronto;
          if (!linha.erro) { delete herdados[c.chave]; continue; }
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
      return api.chamar(caminho, opcoes);
    };
    const rascunhos = criarRascunhos(() => win.localStorage, dono);
    // só o que já estava guardado ao abrir é retomado (o que nasce depois pertence às linhas da tela)
    const estado = { mostrada: null, alvo: segundaDe(new Date()), geracao: 0, linhas: [], herdados: rascunhos.ler(), recuperacao: null };
    let sequencia = 0;
    const novaChave = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${++sequencia}`;
    const semana = $('semana');
    const aviso = $('aviso-semana');

    const criar = (tag, classe, texto) => {
      const e = doc.createElement(tag);
      if (classe) e.className = classe;
      if (texto !== undefined) e.textContent = texto;
      return e;
    };

    function pintar(item) {
      const { linha, li, aviso: msg, input, caixa } = item;
      li.classList.toggle('erro', linha.erro);
      msg.hidden = !linha.erro;
      msg.textContent = linha.erro ? `Não salvou: ${linha.mensagem.replace(/\.$/, '')}. Aperte Enter na linha para tentar de novo.` : '';
      if (!caixa) return;
      caixa.disabled = input.readOnly || !input.value.trim();
      if (!input.value.trim() && !linha.dados.id) caixa.checked = false;
      li.classList.toggle('feita', caixa.checked);
    }
    const salvar = item => item.linha.salvarTexto(item.input.value).then(() => pintar(item));

    function novaLinha(q, dados, rascunho) {
      const volta = rascunho ? retomar(chamar, rascunho, rascunhos) : null;
      const linha = volta ? volta.linha
        : criarLinha(chamar, { quadro: q.quadro, data: q.data, texto: '', feita: false, ...dados }, { rascunhos, chave: novaChave() });
      const li = criar('li', 'linha');
      const item = { linha, li, quadro: q, input: criar('input'), caixa: null, aviso: criar('p', 'linha-aviso') };
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
        li.append(item.caixa);
      }
      const input = item.input;
      input.type = 'text';
      input.maxLength = 300;
      input.autocomplete = 'off';
      input.enterKeyHint = 'next';
      input.value = volta ? rascunho.entrada.texto : linha.dados.texto;
      input.setAttribute('aria-label', q.rotulo);
      input.addEventListener('input', () => {
        linha.anotar(input.value, item.caixa ? item.caixa.checked && !!input.value.trim() : undefined);
        if (item.caixa) item.caixa.disabled = !input.value.trim();
        if (input.value.trim() && q.lista.lastElementChild === li) novaLinha(q);   // sempre uma vazia no fim
      });
      input.addEventListener('blur', () => { salvar(item); });
      input.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter' || ev.isComposing || input.readOnly) return;
        ev.preventDefault();
        salvar(item);
        if (input.value.trim() && q.lista.lastElementChild === li) novaLinha(q);
        li.nextElementSibling?.querySelector('input[type="text"]').focus();
      });
      li.append(input, item.aviso);
      q.lista.append(li);
      estado.linhas.push(item);
      pintar(item);
      if (volta) {
        li.classList.add('erro');
        item.aviso.textContent = 'Texto que não tinha sido salvo. Salvando…';
        item.aviso.hidden = false;
        volta.pronto.then(() => pintar(item));
      }
    }

    function desenhar(inicio, linhas) {
      const hoje = isoLocal(new Date());
      const quadros = DIAS.map(([area, nome], i) => {
        const data = somarDias(inicio, i);
        return { area, nome, quadro: 'dia', data, dia: diaMes(data), rotulo: `${nome} ${diaMes(data)}`, hoje: data === hoje };
      });
      quadros.push({ area: 'tar', nome: 'Tarefas', quadro: 'tarefas', data: null, rotulo: 'Tarefas' });
      quadros.push({ area: 'not', nome: 'Notas', quadro: 'notas', data: null, rotulo: 'Notas' });
      semana.replaceChildren();
      estado.linhas = [];
      const porId = new Map(), soltos = [];
      for (const c of casarRascunhos(estado.herdados, linhas, inicio)) {
        delete estado.herdados[c.chave];
        if (c.descartar) rascunhos.remover(c.chave);
        else if (c.base && !c.base.sumiu) porId.set(c.base.id, c);
        else soltos.push(c);
      }
      for (const q of quadros) {
        const sec = criar('section', `quadro q-${q.area}${q.hoje ? ' hoje' : ''}`);
        const titulo = criar('h2', '', q.nome);
        if (q.dia) titulo.append(' ', criar('span', 'q-data', q.dia));
        if (q.hoje) titulo.append(' ', criar('span', 'q-hoje', 'Hoje'));
        q.lista = criar('ul', 'linhas');
        sec.append(titulo, q.lista);
        semana.append(sec);
        const minhas = linhas.filter(l => l.quadro === q.quadro && (q.quadro !== 'dia' || l.data === q.data));
        for (const l of minhas) novaLinha(q, l, porId.get(l.id));
        const extras = soltos.filter(c => c.entrada.quadro === q.quadro && (q.quadro !== 'dia' || c.entrada.data === q.data));
        for (const c of extras) novaLinha(q, null, c);
        const usadas = minhas.length + extras.length;
        for (let n = usadas; n < Math.max(MIN_LINHAS, usadas + 1); n++) novaLinha(q);
      }
      estado.mostrada = inicio;
      // no celular os quadros ficam um embaixo do outro: a semana atual abre em hoje
      if (win.matchMedia('(max-width: 700px)').matches) semana.querySelector('.quadro.hoje')?.scrollIntoView({ block: 'start' });
    }

    function travar(sim) {
      semana.setAttribute('aria-busy', String(sim));
      for (const item of estado.linhas) { item.input.readOnly = sim; pintar(item); }
    }

    async function irPara(inicio) {
      const geracao = ++estado.geracao;
      estado.alvo = inicio;
      $('rotulo-semana').textContent = rotuloSemana(inicio);
      travar(true);
      aviso.hidden = true;
      // antes de trocar: grava o que está escrito e espera as filas
      await Promise.all(estado.linhas.map(salvar));
      if (geracao !== estado.geracao) return;
      if (estado.linhas.some(i => i.linha.erro)) {
        travar(false);
        estado.alvo = estado.mostrada;
        $('rotulo-semana').textContent = rotuloSemana(estado.mostrada);
        toast('Há texto que não foi salvo. A semana não foi trocada.', 'erro');
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
      desenhar(inicio, Array.isArray(resposta.linhas) ? resposta.linhas : []);
    }

    $('btn-anterior').addEventListener('click', () => irPara(somarDias(estado.alvo, -7)));
    $('btn-proxima').addEventListener('click', () => irPara(somarDias(estado.alvo, 7)));
    $('btn-hoje').addEventListener('click', () => irPara(segundaDe(new Date())));
    $('btn-tentar').addEventListener('click', () => irPara(estado.alvo));
    win.addEventListener('beforeunload', ev => {
      if (!estado.linhas.some(i => i.linha.pendente() || limpar(i.input.value) !== i.linha.dados.texto)) return;
      ev.preventDefault();
      ev.returnValue = '';
    });
    ligarSaida(win, () => { for (const item of estado.linhas) if (!item.input.readOnly) salvar(item); });
    irPara(estado.alvo);
  }

  return { segundaDe, somarDias, rotuloSemana, criarLinha, idDoToken, criarRascunhos, casarRascunhos, retomar, recuperarFora, ligarSaida, iniciar };
});
