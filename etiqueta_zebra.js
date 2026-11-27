// Imprime as etiquetas de um Pedido na Zebra. Fluxo: confere o serviço local do PC (127.0.0.1:3917, local/zebra.js) ->
// busca os itens e as sugestões no servidor (GET /etiquetas/pedido/:n/itens) -> abre a janela de ajustes (volumes = nº de etiquetas
// por item, medidas, estado de destino geral) -> o servidor monta o ZPL com esses ajustes (POST /etiquetas/pedido/:n) -> o serviço local o envia RAW
// à impressora. Os ajustes valem só para esta impressão: nada é gravado. O texto digitado vai ao servidor, que valida e
// monta o ZPL; a tela nunca manda texto para a impressora. Sem o serviço local não há plano B pelo navegador.
// EtiquetaZebra.imprimir(numero, { apiBase, loginUrl, token }) -> false se não dá para imprimir neste PC/sessão (sem serviço local ou 401).
// EtiquetaZebra.perguntarDepoisDePronto(numero ou [numeros], { apiBase, loginUrl, token, pode }): chamada pelas telas DEPOIS que o servidor
// confirmou a mudança para Pronto; só pergunta a quem tem pedidos.pdf. Com vários, uma pergunta só e depois uma janela por vez.
// EtiquetaZebra.imprimirRj(numero, cfg): etiquetas "Rio de Janeiro" (OC, Consultor, NFe, Volumes totais; um par por volume), pela mesma
// janela e pelo mesmo envio (POST /etiquetas/pedido/:n/rj). Não entra na pergunta depois de Pronto.
(function () {
  'use strict';
  const LOCAL = 'http://127.0.0.1:3917';
  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  const QTD_MAX = 999;
  const MEDIDAS_MAX = 30;
const MAX_ETIQUETAS = 200; // mesmo teto do servidor (calculo/etiqueta_edicao.js)
  const RJ_MAX_VOLUMES = MAX_ETIQUETAS / 2; // Rio de Janeiro: um par de etiquetas por volume
  const SEM_SERVICO = 'Serviço local não encontrado neste PC. A impressão na Zebra só funciona no computador com o serviço do Elegance instalado e em execução.';

  async function servicoLocalAtivo() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    try { return (await fetch(LOCAL + '/ping', { signal: ctl.signal })).ok; } catch { return false; } finally { clearTimeout(t); }
  }

  // volumes iniciais = QTD do item (arredondada para cima, entre 1 e 999)
  function qtdInicial(qtd) {
    const n = parseFloat(String(qtd ?? '').replace(',', '.'));
    return Number.isFinite(n) ? Math.min(QTD_MAX, Math.max(1, Math.ceil(n))) : 1;
  }

  const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };

  // total de etiquetas = soma dos volumes; campo vazio/inválido não entra na soma
  function totalEtiquetas(valores) {
    let t = 0;
    for (const v of valores) { const s = String(v ?? '').trim(); if (/^\d{1,3}$/.test(s)) t += Number(s); }
    return t;
  }

  function selectUf(id, vazioTexto, valor) {
    const s = el('select'); s.id = id;
    const o0 = el('option', '', vazioTexto); o0.value = ''; s.append(o0);
    for (const uf of UFS) { const o = el('option', '', uf); o.value = uf; s.append(o); }
    s.value = valor || '';
    return s;
  }

  function campo(rotulo, controle) {
    const c = el('div', 'ez-campo');
    const l = el('label', '', rotulo); l.htmlFor = controle.id;
    c.append(l, controle);
    return c;
  }

  // Moldura comum das duas janelas: diálogo com foco preso, Esc/Cancelar/clique fora fecham, Enter imprime e o erro fica na janela.
  // opcoes = { titulo, sub, corpo: [nós], focaveis: [campos], foco, escolher() -> { escolha } | { erro, foco }, aoImprimir }
  // aoImprimir(escolha) devolve null (deu certo: fecha) ou um texto de erro. Devolve uma Promise que resolve quando a janela fecha.
  function dialogo(opcoes) {
    return new Promise(resolver => {
      const fundo = el('div', 'dp-fundo');
      const caixa = el('div', 'dp-caixa ez-caixa');
      caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-labelledby', 'ez-titulo');
      const titulo = el('div', 'dp-titulo', opcoes.titulo); titulo.id = 'ez-titulo';
      const erro = el('div', 'ez-erro'); erro.setAttribute('role', 'alert'); erro.hidden = true;
      const acoes = el('div', 'dp-acoes');
      const bCancelar = el('button', 'dp-btn', 'Cancelar'); bCancelar.type = 'button';
      const bImprimir = el('button', 'dp-btn dp-btn-ok', 'Imprimir'); bImprimir.type = 'button';
      acoes.append(bCancelar, bImprimir);

      let enviando = false;
      const mostrarErro = (msg, foco) => { erro.textContent = msg; erro.hidden = !msg; if (foco) foco.focus(); };
      const fecha = () => { document.removeEventListener('keydown', teclas, true); fundo.remove(); resolver(); };

      async function imprimir() {
        if (enviando) return;
        const lido = opcoes.escolher();
        if (lido.erro) return mostrarErro(lido.erro, lido.foco);
        mostrarErro('');
        enviando = true; bImprimir.disabled = true; bImprimir.textContent = 'Enviando...';
        let msg;
        try { msg = await opcoes.aoImprimir(lido.escolha); } catch (err) { msg = err.message || 'Não foi possível imprimir.'; }
        enviando = false; bImprimir.disabled = false; bImprimir.textContent = 'Imprimir';
        if (msg) mostrarErro(msg); else fecha();
      }

      const focaveis = () => [...opcoes.focaveis, bCancelar, bImprimir].filter(x => !x.disabled);
      const teclas = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!enviando) fecha(); }
        else if (e.key === 'Enter' && e.target && String(e.target.tagName || e.target.tag).toLowerCase() === 'input' && e.target.type !== 'checkbox') { e.preventDefault(); imprimir(); }
        else if (e.key === 'Tab') {
          const itensFoco = focaveis(), i = itensFoco.indexOf(document.activeElement);
          e.preventDefault(); itensFoco[(i + (e.shiftKey ? itensFoco.length - 1 : 1) + itensFoco.length) % itensFoco.length].focus();
        }
      };
      bImprimir.addEventListener('click', imprimir);
      bCancelar.addEventListener('click', () => { if (!enviando) fecha(); });
      fundo.addEventListener('mousedown', e => { if (e.target === fundo && !enviando) fecha(); });
      document.addEventListener('keydown', teclas, true);
      caixa.append(titulo, opcoes.sub, ...opcoes.corpo, erro, acoes);
      fundo.append(caixa);
      document.body.append(fundo);
      opcoes.foco.focus();
    });
  }

  // Janela das etiquetas por item.
  function janela(numero, dados, aoImprimir) {
    const itens = dados.itens || [];
    const sub = el('div', 'dp-sub');
    const resumo = () => { sub.textContent = `Pedido nº ${numero} · ${totalEtiquetas(fichas.map(f => f.qtd.value))} etiqueta(s) vão sair (limite ${MAX_ETIQUETAS}). Os ajustes valem só para esta impressão; nada é gravado.`; };

    const geral = el('div', 'ez-geral');
    const ufGeral = selectUf('ez-uf-geral', 'Sem estado de destino', dados.ufSugerida);
    geral.append(campo('Estado de destino (todas as etiquetas)', ufGeral));

    const lista = el('div', 'ez-lista');
    const fichas = itens.map(it => {
      const ficha = el('div', 'ez-item');
      const t = el('p', 'ez-item-titulo', `Item ${it.item}`);
      if (it.descricao) t.append(el('small', '', it.descricao));
      const qtd = el('input'); qtd.type = 'number'; qtd.id = `ez-qtd-${it.item}`; qtd.min = '1'; qtd.max = String(QTD_MAX); qtd.step = '1'; qtd.value = String(qtdInicial(it.qtd));
      const med = el('input'); med.type = 'text'; med.id = `ez-med-${it.item}`; med.maxLength = MEDIDAS_MAX; med.value = it.medidasSugeridas || ''; med.disabled = true;
      med.setAttribute('placeholder', 'ex.: 2287 × 706');
      const liga = el('input'); liga.type = 'checkbox'; liga.id = `ez-inc-${it.item}`;
      const ligaRotulo = el('label', 'ez-liga'); ligaRotulo.htmlFor = liga.id;
      ligaRotulo.append(liga, el('span', '', 'Incluir medidas na etiqueta'));
      liga.addEventListener('change', () => { med.disabled = !liga.checked; });
      const cMed = el('div', 'ez-campo');
      const lMed = el('label', '', 'Medidas do item'); lMed.htmlFor = med.id;
      cMed.append(lMed, med, ligaRotulo);
      const campos = el('div', 'ez-campos');
      const cQtd = campo('Qtd de etiquetas (volumes)', qtd);
      cQtd.append(el('small', 'ez-ajuda', 'N etiquetas: VOL 1/N … VOL N/N'));
      qtd.addEventListener('input', resumo);
      campos.append(cQtd, cMed);
      ficha.append(t, campos);
      lista.append(ficha);
      return { item: it.item, qtd, med, liga };
    });

    resumo();
    return dialogo({
      titulo: 'Imprimir etiquetas (Zebra)', sub, corpo: [geral, lista],
      focaveis: [ufGeral, ...fichas.flatMap(f => [f.qtd, f.liga, f.med])], foco: fichas[0] ? fichas[0].qtd : ufGeral, aoImprimir,
      escolher() {
        for (const f of fichas) {
          const n = Number(f.qtd.value);
          if (!/^\d{1,3}$/.test(String(f.qtd.value).trim()) || !Number.isInteger(n) || n < 1 || n > QTD_MAX) {
            return { erro: `Item ${f.item}: a quantidade de etiquetas (volumes) deve ser um número inteiro de 1 a ${QTD_MAX}.`, foco: f.qtd };
          }
        }
        const total = totalEtiquetas(fichas.map(f => f.qtd.value));
        if (total > MAX_ETIQUETAS) return { erro: `Total de ${total} etiquetas passa do limite de ${MAX_ETIQUETAS} por impressão: reduza a quantidade de volumes.`, foco: fichas[0] ? fichas[0].qtd : null };
        return { escolha: {
          uf: ufGeral.value,
          itens: fichas.map(f => ({ item: f.item, qtd: Number(f.qtd.value), incluirMedidas: !!f.liga.checked, medidas: f.liga.checked ? f.med.value : '' }))
        } };
      }
    });
  }

  // Janela das etiquetas do Rio de Janeiro: quatro campos; Volumes totais = N dá N pares (2N etiquetas).
  function janelaRj(numero, aoImprimir) {
    const sub = el('div', 'dp-sub');
    const entrada = (id, rotulo, max) => {
      const i = el('input'); i.type = 'text'; i.id = id; i.maxLength = max;
      return { i, bloco: campo(rotulo, i) };
    };
    const oc = entrada('ez-rj-oc', 'OC', 30);
    const consultor = entrada('ez-rj-consultor', 'Consultor', 30);
    const nfe = entrada('ez-rj-nfe', 'NFe', 20);
    const volumes = el('input'); volumes.type = 'number'; volumes.id = 'ez-rj-volumes'; volumes.min = '1'; volumes.max = String(RJ_MAX_VOLUMES); volumes.step = '1'; volumes.value = '1';
    const lerVolumes = () => {
      const s = String(volumes.value).trim(), n = Number(s);
      return /^\d{1,3}$/.test(s) && n >= 1 && n <= RJ_MAX_VOLUMES ? n : null;
    };
    const resumo = () => {
      const n = lerVolumes();
      sub.textContent = `Pedido nº ${numero} · ` + (n ? `${2 * n} etiqueta(s) vão sair (${n} volume(s), 2 por volume).` : `informe os volumes totais (1 a ${RJ_MAX_VOLUMES}).`) + ' Nada é gravado.';
    };
    volumes.addEventListener('input', resumo);
    resumo();
    const campos = el('div', 'ez-campos');
    campos.append(oc.bloco, consultor.bloco, nfe.bloco, campo('Volumes totais', volumes));
    const lista = el('div', 'ez-lista'), ficha = el('div', 'ez-item');
    ficha.append(campos); lista.append(ficha);
    return dialogo({
      titulo: 'Etiquetas Rio de Janeiro (Zebra)', sub, corpo: [lista],
      focaveis: [oc.i, consultor.i, nfe.i, volumes], foco: oc.i, aoImprimir,
      escolher() {
        const n = lerVolumes();
        if (!n) return { erro: `Volumes totais deve ser um número inteiro de 1 a ${RJ_MAX_VOLUMES}.`, foco: volumes };
        return { escolha: { oc: oc.i.value, consultor: consultor.i.value, nfe: nfe.i.value, volumes: n } };
      }
    });
  }

  async function lerResposta(r, cfg) {
    if (r.status === 401) { localStorage.removeItem('auth'); location.href = cfg.loginUrl; return null; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 403 ? 'Acesso restrito.' : (d.error || `Erro ${r.status} no servidor.`));
    return d;
  }

  // POST ao servidor (que valida e monta o ZPL) e depois o ZPL pronto ao serviço local. -> null (enviado) ou texto de erro.
  async function enviar(url, escolha, cfg, aoPerderSessao) {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token(), 'Content-Type': 'application/json' }, body: JSON.stringify(escolha) });
    const d = await lerResposta(r, cfg).catch(err => ({ erro: err.message }));
    if (!d) { aoPerderSessao(); return null; } // 401: já foi para o login
    if (d.erro) return d.erro;
    const p = await fetch(LOCAL + '/etiqueta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zpl: d.zpl }) });
    const resp = await p.json().catch(() => ({}));
    if (!p.ok) return resp.error || `Erro ${p.status} no serviço local.`;
    alert(`${d.quantidade} etiqueta(s) enviada(s) para ${resp.impressora}${resp.porta ? ' (porta ' + resp.porta + ')' : ''}.`);
    return null;
  }
  const urlDoPedido = (numero, cfg) => `${cfg.apiBase}/etiquetas/pedido/${encodeURIComponent(numero)}`;

  async function imprimir(numero, cfg) {
    try {
      if (!(await servicoLocalAtivo())) { alert(SEM_SERVICO); return false; }
      const base = urlDoPedido(numero, cfg);
      const dados = await lerResposta(await fetch(base + '/itens', { headers: { Authorization: 'Bearer ' + cfg.token() } }), cfg);
      if (!dados) return false;
      let semSessao = false;
      await janela(numero, dados, escolha => enviar(base, escolha, cfg, () => { semSessao = true; }));
      return !semSessao;
    } catch (err) { alert('Não foi possível imprimir as etiquetas: ' + err.message); return true; } // erro deste pedido: o próximo do lote ainda pode sair
  }

  async function imprimirRj(numero, cfg) {
    try {
      if (!(await servicoLocalAtivo())) { alert(SEM_SERVICO); return false; }
      let semSessao = false;
      await janelaRj(numero, escolha => enviar(urlDoPedido(numero, cfg) + '/rj', escolha, cfg, () => { semSessao = true; }));
      return !semSessao;
    } catch (err) { alert('Não foi possível imprimir as etiquetas: ' + err.message); return false; }
  }

  async function oferecer(lista, cfg) {
    const texto = lista.length === 1 ? `Pedido ${lista[0]} marcado como Pronto.` : `Pedidos ${lista.join(', ')} marcados como Pronto.`;
    if (!confirm(`${texto} Imprimir as etiquetas agora?`)) return;
    for (let i = 0; i < lista.length; i++) {
      // o próximo só abre depois de a janela anterior fechar; Cancelar aqui para o resto
      if (i && !confirm(`Abrir agora as etiquetas do pedido ${lista[i]} (${i + 1} de ${lista.length})? Cancelar para parar.`)) return;
      if (await imprimir(lista[i], cfg) === false) return;
    }
  }

  let fila = Promise.resolve(); // duas mudanças quase juntas (ex.: etapas): uma pergunta/janela de cada vez
  function perguntarDepoisDePronto(numeros, cfg) {
    const pode = cfg.pode || (p => !!(window.Acesso && window.Acesso.pode(p)));
    const lista = [].concat(numeros).map(String).filter(Boolean);
    if (!lista.length || !pode('pedidos.pdf')) return Promise.resolve();
    fila = fila.then(() => oferecer(lista, cfg)).catch(err => alert('Não foi possível imprimir as etiquetas: ' + err.message));
    return fila;
  }

  window.EtiquetaZebra = { imprimir, imprimirRj, qtdInicial, perguntarDepoisDePronto };
})();
