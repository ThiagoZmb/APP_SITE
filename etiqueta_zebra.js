// Imprime as etiquetas de um Pedido na Zebra. Fluxo: confere o serviço local do PC (127.0.0.1:3917, local/zebra.js) ->
// busca os itens e as sugestões no servidor (GET /etiquetas/pedido/:n/itens) -> abre a janela de ajustes (volumes, medidas,
// estado de destino) -> o servidor monta o ZPL com esses ajustes (POST /etiquetas/pedido/:n) -> o serviço local o envia RAW
// à impressora. Os ajustes valem só para esta impressão: nada é gravado. O texto digitado vai ao servidor, que valida e
// monta o ZPL; a tela nunca manda texto para a impressora. Sem o serviço local não há plano B pelo navegador.
// EtiquetaZebra.imprimir(numero, { apiBase, loginUrl, token })
(function () {
  'use strict';
  const LOCAL = 'http://127.0.0.1:3917';
  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  const QTD_MAX = 999;
  const MEDIDAS_MAX = 30;

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

  // Abre a janela. aoImprimir(escolha) devolve null (deu certo: fecha) ou um texto de erro (a janela fica aberta e mostra).
  // Devolve uma Promise que resolve quando a janela fecha.
  function janela(numero, dados, aoImprimir) {
    return new Promise(resolver => {
      const fundo = el('div', 'dp-fundo');
      const caixa = el('div', 'dp-caixa ez-caixa');
      caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-labelledby', 'ez-titulo');
      const titulo = el('div', 'dp-titulo', 'Imprimir etiquetas (Zebra)'); titulo.id = 'ez-titulo';
      const itens = dados.itens || [];
      const sub = el('div', 'dp-sub', `Pedido nº ${numero} · ${itens.length} etiqueta(s). Os ajustes valem só para esta impressão; nada é gravado.`);

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
        const ufItem = selectUf(`ez-uf-${it.item}`, 'Igual ao geral', '');
        const cMed = el('div', 'ez-campo');
        const lMed = el('label', '', 'Medidas do item'); lMed.htmlFor = med.id;
        cMed.append(lMed, med, ligaRotulo);
        const campos = el('div', 'ez-campos');
        campos.append(campo('Qtd de volumes', qtd), cMed, campo('Estado deste item', ufItem));
        ficha.append(t, campos);
        lista.append(ficha);
        return { item: it.item, qtd, med, liga, ufItem };
      });

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
        for (const f of fichas) {
          const n = Number(f.qtd.value);
          if (!/^\d{1,3}$/.test(String(f.qtd.value).trim()) || !Number.isInteger(n) || n < 1 || n > QTD_MAX) {
            return mostrarErro(`Item ${f.item}: a quantidade de volumes deve ser um número inteiro de 1 a ${QTD_MAX}.`, f.qtd);
          }
        }
        mostrarErro('');
        const escolha = {
          uf: ufGeral.value,
          itens: fichas.map(f => ({ item: f.item, qtd: Number(f.qtd.value), incluirMedidas: !!f.liga.checked, medidas: f.liga.checked ? f.med.value : '', uf: f.ufItem.value }))
        };
        enviando = true; bImprimir.disabled = true; bImprimir.textContent = 'Enviando...';
        let msg;
        try { msg = await aoImprimir(escolha); } catch (err) { msg = err.message || 'Não foi possível imprimir.'; }
        enviando = false; bImprimir.disabled = false; bImprimir.textContent = 'Imprimir';
        if (msg) mostrarErro(msg); else fecha();
      }

      const focaveis = () => [ufGeral, ...fichas.flatMap(f => [f.qtd, f.liga, f.med, f.ufItem]), bCancelar, bImprimir].filter(x => !x.disabled);
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
      caixa.append(titulo, sub, geral, lista, erro, acoes);
      fundo.append(caixa);
      document.body.append(fundo);
      (fichas[0] ? fichas[0].qtd : ufGeral).focus();
    });
  }

  async function lerResposta(r, cfg) {
    if (r.status === 401) { localStorage.removeItem('auth'); location.href = cfg.loginUrl; return null; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 403 ? 'Acesso restrito.' : (d.error || `Erro ${r.status} no servidor.`));
    return d;
  }

  async function imprimir(numero, cfg) {
    try {
      if (!(await servicoLocalAtivo())) {
        alert('Serviço local não encontrado neste PC. A impressão na Zebra só funciona no computador com o serviço do Elegance instalado e em execução.');
        return;
      }
      const base = `${cfg.apiBase}/etiquetas/pedido/${encodeURIComponent(numero)}`;
      const dados = await lerResposta(await fetch(base + '/itens', { headers: { Authorization: 'Bearer ' + cfg.token() } }), cfg);
      if (!dados) return;
      await janela(numero, dados, async escolha => {
        const r = await fetch(base, { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token(), 'Content-Type': 'application/json' }, body: JSON.stringify(escolha) });
        const d = await lerResposta(r, cfg).catch(err => ({ erro: err.message }));
        if (!d) return null; // 401: já foi para o login
        if (d.erro) return d.erro;
        const p = await fetch(LOCAL + '/etiqueta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zpl: d.zpl }) });
        const resp = await p.json().catch(() => ({}));
        if (!p.ok) return resp.error || `Erro ${p.status} no serviço local.`;
        alert(`${d.quantidade} etiqueta(s) enviada(s) para ${resp.impressora}${resp.porta ? ' (porta ' + resp.porta + ')' : ''}.`);
        return null;
      });
    } catch (err) { alert('Não foi possível imprimir as etiquetas: ' + err.message); }
  }

  window.EtiquetaZebra = { imprimir, qtdInicial };
})();
