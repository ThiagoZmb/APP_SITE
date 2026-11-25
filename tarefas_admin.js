// ==========================================================================
// tarefas_admin.html — "Semana compartilhada": o mesmo caderno, compartilhado por quem tem tarefas_admin.usar.
// Cópia de tarefas.js (escolha do dono): ajuste de tela feito lá precisa ser repetido aqui.
// Rotas: GET /semana_admin?inicio=, POST /semana_admin, PUT e DELETE /semana_admin/:id (com a versão que se está vendo).
// Funções puras testadas no Node (test/semana_admin_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Texto de tarefa e nome de pessoa só entram na tela pelo value do campo ou por textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.SemanaAdmin = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;

  const MIN_LINHAS = 8;
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
    const chaveDe = 'semana_admin_rascunho:' + usuario;
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
  // `dados` = o que o servidor tem (na versão que a pessoa está vendo); `alvo` = o que a pessoa quer. As operações entram numa
  // fila (uma por vez). Se outra pessoa mudou a linha (409) ou apagou (404), nada mais é enviado até a pessoa decidir.
  const CAMPOS = ['texto', 'feita', 'alarme'];
  const copiar = l => ({ id: l.id ?? null, quadro: l.quadro, data: l.data ?? null, texto: l.texto || '', feita: !!l.feita, alarme: doAlarme(l.alarme),
    versao: l.versao ?? null, criadaPor: l.criadaPor || '', feitaPor: l.feitaPor || null });

  const autoria = d => (!d.id || !d.criadaPor ? '' : d.criadaPor + (d.feita && d.feitaPor ? ' · feita por ' + d.feitaPor : ''));

  function criarLinha(chamar, inicial, { rascunhos, chave, aoExcluir } = {}) {
    const dados = copiar(inicial);
    const alvo = { texto: dados.texto, feita: dados.feita, alarme: dados.alarme };
    let fila = Promise.resolve();
    let naFila = 0;
    const escrito = { texto: dados.texto, feita: dados.feita, alarme: dados.alarme };   // o último digitado/marcado, antes mesmo de entrar na fila
    let enviado = null;   // texto de um POST sem resposta: pode ter chegado ao servidor

    const resolvida = () => !linha.conflito && !linha.apagada;
    function guardar() {
      if (!rascunhos) return;
      if (resolvida() && !enviado && escrito.texto === dados.texto && (!dados.id || (escrito.feita === dados.feita && escrito.alarme === dados.alarme))) return rascunhos.remover(chave);
      rascunhos.gravar(chave, { id: dados.id, quadro: dados.quadro, data: dados.data, texto: escrito.texto, feita: escrito.feita, alarme: escrito.alarme,
        // a versão e o conteúdo que a pessoa via: na volta, se outra pessoa mudou a linha, vira conflito em vez de gravar por cima
        ...(dados.id ? { versao: dados.versao, base: { texto: dados.texto, feita: dados.feita, alarme: dados.alarme } } : {}),
        ...(enviado ? { enviado } : {}) });
    }
    function anotar(texto, feita) {
      if (texto !== undefined) escrito.texto = limpar(texto);
      if (feita !== undefined) escrito.feita = !!feita;
      guardar();
    }
    // o conteúdo passa a ser o do servidor, descartando o que havia aqui
    function adotar(l) {
      Object.assign(dados, copiar(l));
      for (const f of CAMPOS) { alvo[f] = dados[f]; escrito[f] = dados[f]; }
      linha.conflito = null; linha.apagada = false;
      linha.adotada = true;   // a tela precisa redesenhar o campo
      guardar();
    }
    function zerar() {
      adotar({ quadro: dados.quadro, data: dados.data });
    }

    function colidiu(atual) {
      const meus = CAMPOS.filter(f => alvo[f] !== dados[f]);
      // o que eu queria mudar já está lá (resposta perdida, ou os dois fizeram o mesmo): não há o que perguntar
      if (meus.every(f => alvo[f] === copiar(atual)[f]) && escrito.texto === alvo.texto) return adotar(atual);
      linha.conflito = copiar(atual);
    }

    async function excluir() {
      const id = dados.id;
      try { await chamar('/semana_admin/' + id, { metodo: 'DELETE', corpo: { versao: dados.versao } }); } catch (e) {
        if (e.status === 409 && e.dados?.atual) return colidiu(e.dados.atual);
        if (e.status !== 404) throw e;
      }
      aoExcluir?.(id);
      Object.assign(dados, { id: null, texto: '', feita: false, alarme: null, versao: null, criadaPor: '', feitaPor: null });
      alvo.feita = false;
      alvo.alarme = null;   // o alarme era da tarefa apagada
      if (!escrito.texto) { escrito.feita = false; escrito.alarme = null; }
      guardar();
    }
    async function criar() {
      const texto = alvo.texto;
      enviado = texto;
      guardar();   // antes de enviar: se a página sair sem a resposta, dá para reconhecer a linha depois
      let r;
      try {
        r = await chamar('/semana_admin', { metodo: 'POST', corpo: { quadro: dados.quadro, data: dados.data, texto } });
      } catch (e) {
        if (e.status) enviado = null;   // o servidor respondeu com erro: não criou
        throw e;
      }
      enviado = null;
      Object.assign(dados, copiar({ ...dados, ...r, texto }));
      guardar();
    }
    async function mudar() {
      const corpo = {};
      for (const f of CAMPOS) if (alvo[f] !== dados[f]) corpo[f] = alvo[f];
      if (!Object.keys(corpo).length) return;
      let r;
      try {
        r = await chamar('/semana_admin/' + dados.id, { metodo: 'PUT', corpo: { ...corpo, versao: dados.versao } });
      } catch (e) {
        if (e.status === 404) { linha.apagada = true; return; }   // apagada por outra pessoa: NÃO recria sozinho
        if (e.status === 409 && e.dados?.atual) return colidiu(e.dados.atual);
        throw e;
      }
      Object.assign(dados, copiar({ ...dados, ...corpo, ...r }));
      guardar();
    }
    async function sincronizar() {
      if (linha.apagada && !alvo.texto) return zerar();   // a pessoa também apagou: não sobra nada
      if (!resolvida()) return;
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
      conflito: null,   // a linha como está no servidor, quando outra pessoa mudou antes
      apagada: false,   // outra pessoa apagou
      adotada: false,
      get texto() { return alvo.texto; },
      get feita() { return alvo.feita; },
      get alarme() { return alvo.alarme; },
      get enviado() { return enviado; },
      ocupada: () => naFila > 0,
      // há algo que o servidor ainda não tem?
      pendente: () => naFila > 0 || !resolvida() || alvo.texto !== dados.texto || (!!dados.id && (alvo.feita !== dados.feita || alvo.alarme !== dados.alarme)),
      // nada digitado nem marcado além do que o servidor já tem
      limpa: () => !linha.pendente() && !linha.erro && escrito.texto === dados.texto && escrito.feita === dados.feita && escrito.alarme === dados.alarme,
      anotar,
      adotar,
      zerar,
      salvarTexto: t => { anotar(t); return enfileirar(() => { alvo.texto = limpar(t); }); },
      marcar: b => { anotar(undefined, b); return enfileirar(() => { alvo.feita = !!b; }); },
      salvar: (t, b, q = alvo.alarme) => { escrito.alarme = doAlarme(q); anotar(t, b); return enfileirar(() => { alvo.texto = limpar(t); alvo.feita = !!b; alvo.alarme = doAlarme(q); }); },
      alarmar: q => { escrito.alarme = doAlarme(q); guardar(); return enfileirar(() => { alvo.alarme = doAlarme(q); }); },
      // conflito: grava o meu sobre a versão nova; o que eu não mudei fica como a outra pessoa deixou
      manterMeu: () => enfileirar(() => {
        const atual = linha.conflito;
        if (!atual) return;
        for (const f of CAMPOS) if (alvo[f] === dados[f]) { if (escrito[f] === dados[f]) escrito[f] = atual[f]; alvo[f] = atual[f]; }
        Object.assign(dados, copiar(atual));
        linha.conflito = null;
        linha.adotada = true;
      }),
      usarAtual: () => enfileirar(() => { if (linha.conflito) adotar(linha.conflito); }),
      recriar: () => enfileirar(() => {
        if (!linha.apagada) return;
        Object.assign(dados, { id: null, texto: '', feita: false, alarme: null, versao: null, criadaPor: '', feitaPor: null });
        linha.apagada = false;
      }),
      descartar: () => enfileirar(() => { if (linha.apagada) zerar(); })
    };
    function enfileirar(aplicar) {
      naFila++;
      fila = fila.then(async () => {
        aplicar();
        try {
          await sincronizar();
          linha.erro = !resolvida();
          linha.mensagem = linha.conflito ? 'Alterada por outra pessoa.' : linha.apagada ? 'Apagada por outra pessoa.' : '';
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
  // saiu mas não teve resposta adota a linha de mesmo quadro, data e texto, MAS só se foi `eu` quem a criou.
  function casarRascunhos(entradas, servidor, inicio, eu) {
    const fim = somarDias(inicio, 6);
    const daSemana = Object.entries(entradas).filter(([, e]) => e.quadro !== 'dia' || (e.data >= inicio && e.data <= fim));
    const usados = new Set(daSemana.map(([, e]) => e.id).filter(Boolean));
    return daSemana.map(([chave, entrada]) => {
      let base = null;
      if (entrada.id) {
        base = servidor.find(l => l.id === entrada.id)
          || { id: entrada.id, quadro: entrada.quadro, data: entrada.data, texto: '', feita: false, sumiu: true };
      } else if (entrada.enviado) {
        base = servidor.find(l => !usados.has(l.id) && l.criadaPor === eu && l.quadro === entrada.quadro && (l.data ?? null) === (entrada.data ?? null) && l.texto === entrada.enviado) || null;
        if (base) usados.add(base.id);
      }
      // nada escrito e nada no servidor para apagar, ou nada diferente do que a pessoa já via
      const semMudanca = !!entrada.base && entrada.texto === entrada.base.texto && entrada.feita === entrada.base.feita && doAlarme(entrada.alarme) === doAlarme(entrada.base.alarme);
      return { chave, entrada, base, descartar: semMudanca || (!entrada.texto && (!base || !!base.sumiu)) };
    });
  }

  // recria a linha de um rascunho, pela mesma fila de sempre, e manda salvar
  function retomar(chamar, { chave, entrada, base }, rascunhos, opcoes) {
    let inicial = base || { quadro: entrada.quadro, data: entrada.data, texto: '', feita: false };
    // a versão e o conteúdo que a pessoa via ao digitar: se mudou desde então, o servidor devolve 409
    if (entrada.id && entrada.base) inicial = { ...inicial, id: entrada.id, texto: entrada.base.texto, feita: entrada.base.feita, alarme: entrada.base.alarme, versao: entrada.versao };
    const linha = criarLinha(chamar, inicial, { ...opcoes, rascunhos, chave });
    const feita = entrada.quadro === 'notas' ? false : entrada.feita;
    const alarme = entrada.quadro === 'notas' || !entrada.texto ? null : entrada.alarme ?? null;
    const pronto = linha.salvar(entrada.texto, entrada.texto ? feita : linha.dados.feita, alarme);
    return { linha, pronto };
  }

  // dias de semanas que não são a aberta: salva sem desenhar. O que falhar continua guardado e aparece naquela semana.
  async function recuperarFora(chamar, herdados, rascunhos, inicioAberto, eu) {
    const fora = e => e.quadro === 'dia' && semanaDe(e.data) !== inicioAberto;
    const falhas = [];
    for (const inicio of [...new Set(Object.values(herdados).filter(fora).map(e => semanaDe(e.data)))]) {
      const dela = Object.fromEntries(Object.entries(herdados).filter(([, e]) => e.quadro === 'dia' && semanaDe(e.data) === inicio));
      let falhou = false;
      try {
        const r = await chamar('/semana_admin?inicio=' + inicio);
        for (const c of casarRascunhos(dela, r.linhas || [], inicio, eu)) {
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

  // ---------- atualização automática: o que muda na tela a partir de uma resposta do servidor ----------
  // `itens` = linhas da tela ({ linha, livre() }); `conhecidos` = ids que a tela já tinha quando o pedido saiu;
  // `removidos` = ids apagados aqui. Só linha livre (sem foco e sem pendência) é mexida. null = tente na próxima.
  function planejarAtualizacao(itens, servidor, conhecidos, removidos) {
    if (itens.some(i => !i.linha.dados.id && i.linha.ocupada())) return null;   // criando uma linha: evita duplicar
    const porId = new Map(servidor.map(l => [l.id, l]));
    const naTela = new Set();
    const plano = { atualizar: [], remover: [], incluir: [] };
    for (const item of itens) {
      const d = item.linha.dados;
      if (!d.id) continue;
      naTela.add(d.id);
      const s = porId.get(d.id);
      if (!s) { if (conhecidos.has(d.id) && item.livre()) plano.remover.push(item); }
      else if (s.versao > d.versao && item.livre()) plano.atualizar.push([item, s]);
    }
    // texto de um POST sem resposta (aqui) não aparece uma segunda vez como se fosse de outra pessoa
    const emDuvida = itens.filter(i => !i.linha.dados.id && i.linha.enviado).map(i => i.linha);
    plano.incluir = servidor.filter(l => !naTela.has(l.id) && !removidos.has(l.id)
      && !emDuvida.some(x => x.enviado === l.texto && x.dados.quadro === l.quadro && x.dados.data === (l.data ?? null)));
    return plano;
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
    if (win.Acesso && !win.Acesso.podePagina('tarefas_admin.html')) return;
    const toast = C.criarToast(doc, win);
    // outro usuário entrou em outra aba: o texto desta tela não pode ir para o caderno dele
    const quemSou = () => idDoToken(api.getAuth()?.token);
    const dono = idDoToken(auth.token);
    const chamar = async (caminho, opcoes) => {
      const agora = quemSou();
      if (agora !== null && agora !== dono) { win.location.reload(); throw new Error('Outro usuário entrou neste navegador.'); }
      try {
        const resposta = await api.chamar(caminho, opcoes);
        gravou(opcoes?.metodo);
        return resposta;
      } catch (e) {
        if (e.status === 403) proibir();   // perdeu a permissão com a página aberta
        throw e;
      }
    };
    const eu = auth.user.nome || '';
    const gravou = metodo => { if (metodo === 'PUT' || metodo === 'DELETE') win.dispatchEvent(new win.CustomEvent('alarmes-mudou')); };
    const rascunhos = criarRascunhos(() => win.localStorage, dono);
    // só o que já estava guardado ao abrir é retomado (o que nasce depois pertence às linhas da tela)
    const estado = { mostrada: null, alvo: segundaDe(new Date()), geracao: 0, linhas: [], herdados: rascunhos.ler(), recuperacao: null,
      quadros: [], removidos: new Set(), atualizando: false, proibido: false, relogio: null };
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
      if (linha.adotada) {   // o conteúdo passou a ser o do servidor (ou o que a pessoa escolheu)
        linha.adotada = false;
        if (!item.digitou) input.value = linha.texto;
        if (caixa) caixa.checked = linha.feita;
        ajustar(input);
      }
      pintarSino(item);
      const quem = autoria(linha.dados);
      item.autor.textContent = quem;
      item.autor.hidden = !quem;
      pintarDuvida(item);
      li.classList.toggle('erro', linha.erro);
      msg.hidden = !linha.erro || !!linha.conflito || linha.apagada;
      msg.textContent = linha.erro ? `Não salvou: ${linha.mensagem.replace(/\.$/, '')}. Aperte Enter na linha para tentar de novo.` : '';
      if (!caixa) return;
      caixa.disabled = input.readOnly || !input.value.trim();
      if (!input.value.trim() && !linha.dados.id) caixa.checked = false;
      li.classList.toggle('feita', caixa.checked);
    }
    function pintarDuvida(item) {
      const { linha, duvida } = item;
      const c = linha.conflito;
      duvida.caixa.hidden = !c && !linha.apagada;
      if (duvida.caixa.hidden) return;
      const hora = c && (c.alarme || linha.alarme !== linha.dados.alarme) ? (c.alarme ? `, alarme ${horaCurta(c.alarme)}` : ', sem alarme') : '';
      duvida.texto.textContent = c
        ? `${linha.texto ? 'Alterada por outra pessoa.' : 'Você apagou, mas outra pessoa alterou.'} Está assim agora: “${c.texto}”${c.feita ? ' (concluída)' : ''}${hora}.`
        : 'Esta linha foi apagada por outra pessoa.';
      duvida.manter.hidden = duvida.usar.hidden = !c;
      duvida.recriar.hidden = duvida.descartar.hidden = !!c;
    }
    function criarDuvida(item) {
      const caixa = criar('div', 'linha-duvida');
      caixa.setAttribute('role', 'alert');
      caixa.hidden = true;
      const texto = criar('p');
      const botao = (rotulo, acao) => {
        const b = criar('button', 'btn btn-secondary btn-mini', rotulo);
        b.type = 'button';
        b.addEventListener('click', () => { item.digitou = false; item.linha[acao]().then(() => pintar(item)); });
        return b;
      };
      const d = { caixa, texto, manter: botao('Manter o meu', 'manterMeu'), usar: botao('Usar o atual', 'usarAtual'),
        recriar: botao('Criar de novo', 'recriar'), descartar: botao('Descartar', 'descartar') };
      caixa.append(texto, d.manter, d.usar, d.recriar, d.descartar);
      return d;
    }
    const salvar = item => item.linha.salvarTexto(item.input.value).then(() => pintar(item));
    // ---------- alarme da linha ----------
    function criarSino(item) {
      const botao = criar('button', 'sino');
      botao.type = 'button';
      botao.title = 'Alarme';
      const SVG = 'http://www.w3.org/2000/svg';
      const icone = doc.createElementNS(SVG, 'svg');
      for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icone.setAttribute(k, v);
      const traco = doc.createElementNS(SVG, 'path');
      traco.setAttribute('d', 'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8M10 21h4');
      icone.append(traco);
      botao.append(icone);
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

    // o campo cresce com o texto, para ele aparecer inteiro em coluna estreita
    const ajustar = campo => { campo.style.height = 'auto'; campo.style.height = campo.scrollHeight + 'px'; };
    const ajustarTodos = () => { for (const item of estado.linhas) ajustar(item.input); };

    function novaLinha(q, dados, rascunho) {
      const opcoes = { aoExcluir: id => estado.removidos.add(id) };
      const volta = rascunho ? retomar(chamar, rascunho, rascunhos, opcoes) : null;
      const linha = volta ? volta.linha
        : criarLinha(chamar, { quadro: q.quadro, data: q.data, texto: '', feita: false, ...dados }, { ...opcoes, rascunhos, chave: novaChave() });
      const li = criar('li', 'linha');
      const item = { linha, li, quadro: q, input: criar('textarea'), caixa: null, aviso: criar('p', 'linha-aviso'), autor: criar('p', 'linha-autor') };
      item.duvida = criarDuvida(item);
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
      if (alarmesAtivos() && q.quadro !== 'notas') item.sino = criarSino(item);
      const input = item.input;
      input.rows = 1;
      input.maxLength = 300;
      input.autocomplete = 'off';
      input.enterKeyHint = 'next';
      input.value = volta ? rascunho.entrada.texto : linha.dados.texto;
      input.setAttribute('aria-label', q.rotulo);
      input.addEventListener('input', () => {
        item.digitou = true;
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
      input.addEventListener('blur', () => { salvar(item); });
      // Enter salva e vai para a próxima linha; nunca entra uma quebra no texto
      const enter = () => {
        if (input.readOnly) return;
        salvar(item);
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
      li.append(input, ...(item.sino ? [item.sino.botao, item.sino.hora] : []), item.autor, item.aviso, item.duvida.caixa);
      q.lista.append(li);
      estado.linhas.push(item);
      pintar(item);
      ajustar(input);
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
      estado.quadros = quadros;
      const porId = new Map(), soltos = [];
      for (const c of casarRascunhos(estado.herdados, linhas, inicio, eu)) {
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
      ajustarTodos();   // com a página inteira montada a largura é a final (barra de rolagem)
      // no celular os quadros ficam um embaixo do outro: a semana atual abre em hoje
      if (win.matchMedia('(max-width: 700px)').matches) semana.querySelector('.quadro.hoje')?.scrollIntoView({ block: 'start' });
    }

    // ---------- atualização automática: só linhas sem foco, sem nada pendente e sem o alarme aberto ----------
    const livre = item => item.linha.limpa() && !item.editor && !item.li.contains(doc.activeElement) && limpar(item.input.value) === item.linha.dados.texto;
    // linha livre: o campo recebe o que veio do servidor
    function trocar(item, l) {
      item.digitou = false;
      if (l) item.linha.adotar(l); else item.linha.zerar();
      pintar(item);
    }
    function incluir(l) {
      const q = estado.quadros.find(x => x.quadro === l.quadro && (x.quadro !== 'dia' || x.data === l.data));
      if (!q) return;
      const doQuadro = estado.linhas.filter(i => i.quadro === q);
      let ultima = -1;
      doQuadro.forEach((i, n) => { if (i.linha.dados.id || i.input.value.trim()) ultima = n; });
      const vaga = doQuadro.slice(ultima + 1).find(i => !i.linha.dados.id && livre(i));
      if (vaga) trocar(vaga, l); else novaLinha(q, l);
      if (q.lista.lastElementChild.querySelector('textarea').value) novaLinha(q);   // sempre uma vazia no fim
    }
    async function atualizar() {
      if (estado.proibido || estado.atualizando || doc.visibilityState === 'hidden') return;
      if (estado.mostrada !== estado.alvo || semana.getAttribute('aria-busy') === 'true') return;
      const geracao = estado.geracao;
      const conhecidos = new Set(estado.linhas.map(i => i.linha.dados.id).filter(Boolean));
      estado.atualizando = true;
      try {
        // &auto=1: o layout.js não mostra o indicador de carregamento nesta consulta
        const r = await chamar(`/semana_admin?inicio=${estado.mostrada}&auto=1`);
        if (geracao !== estado.geracao || !Array.isArray(r.linhas)) return;
        const plano = planejarAtualizacao(estado.linhas.map(item => ({ item, linha: item.linha, livre: () => livre(item) })), r.linhas, conhecidos, estado.removidos);
        if (!plano) return;
        for (const [{ item }, l] of plano.atualizar) trocar(item, l);
        for (const { item } of plano.remover) trocar(item, null);
        for (const l of plano.incluir) incluir(l);
      } catch { /* sem rede: tenta no próximo minuto */ } finally { estado.atualizando = false; }
    }
    // sem a permissão nada compartilhado fica na tela; o rascunho continua sob a chave própria (nunca vira linha pessoal)
    function proibir() {
      if (estado.proibido) return;
      estado.proibido = true;
      estado.geracao++;
      win.clearInterval(estado.relogio);
      estado.linhas.forEach(fecharEditor);   // a janela do alarme mostra o texto da linha
      estado.linhas = [];
      semana.replaceChildren();
      semana.setAttribute('aria-busy', 'false');
      $('barra-semana').hidden = true;
      $('btn-tentar').hidden = true;
      $('aviso-texto').textContent = 'Você não tem mais acesso à Semana compartilhada.';
      aviso.hidden = false;
    }

    function travar(sim) {
      semana.setAttribute('aria-busy', String(sim));
      for (const item of estado.linhas) { item.input.readOnly = sim; pintar(item); }
    }

    async function irPara(inicio) {
      if (estado.proibido) return;
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
      estado.recuperacao ||= recuperarFora(chamar, estado.herdados, rascunhos, inicio, eu).then(falhas => {
        if (falhas.length) toast(`Há texto não salvo na semana ${falhas.map(rotuloSemana).join(', ')}. Abra a semana para tentar de novo.`, 'erro');
      });
      await estado.recuperacao;
      if (geracao !== estado.geracao) return;
      let resposta;
      try {
        resposta = await chamar('/semana_admin?inicio=' + inicio);
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
    win.addEventListener('resize', ajustarTodos);   // mudou a largura da coluna, mudam as quebras
    doc.fonts?.ready.then(ajustarTodos);
    ligarSaida(win, () => { for (const item of estado.linhas) if (!item.input.readOnly) salvar(item); });
    estado.relogio = win.setInterval(atualizar, 60000);
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') atualizar(); });
    irPara(estado.alvo);
  }

  return { segundaDe, somarDias, rotuloSemana, semQuebra, horaCurta, sugestaoDeAlarme, autoria, criarLinha, idDoToken, criarRascunhos, casarRascunhos, retomar, recuperarFora, planejarAtualizacao, ligarSaida, iniciar };
});
