// Impressão direta de PDFs (sem abrir o PDF para o usuário) e janela "Imprimir documentos" do pedido.
//   ImpressaoPdf.imprimir(url, cfg)  baixa o PDF com o token e o imprime; devolve { ok, via, erro, semDocumento }.
//     via 'local'     = o serviço do PC (127.0.0.1:3917, POST /imprimir, local/impressao.js) enviou à impressora, SEM diálogo
//                       (só se o dono instalou o SumatraPDF e criou impressao.config.json; /ping informa imprimir:true);
//     via 'navegador' = fallback sempre disponível: o PDF vai para um iframe oculto e print() abre a caixa de impressão do sistema
//                       (o navegador não permite impressão 100% silenciosa; "ok" quer dizer que a caixa foi aberta).
//   ImpressaoPdf.preparar(url, cfg, {local})  como imprimir, mas SEM abrir a caixa do navegador: com o serviço do PC envia; sem ele devolve
//     { ok, via:'navegador', manual:true, blob } para o chamador imprimir num clique do usuário (ImpressaoPdf.imprimirBlob(blob)).
//   ImpressaoPdf.painel({ numero, cliente, titulo?, apiBase, loginUrl, token, pode })  janela com as opções (pedido, guia de produção,
//     vidros, checklist; cada uma só com a permissão), "Imprimir selecionados", resultado de cada uma e "Concluir"; resolve ao fechar.
//     Com o serviço do PC: envio em sequência, sem diálogo. Sem ele: o navegador só mostra UMA caixa de impressão por vez (print()
//     concorrente é ignorado), então "Imprimir selecionados" prepara os PDFs e cada documento ganha o seu botão "Imprimir" (um clique = uma caixa).
// cfg = { apiBase, loginUrl, token: () => string }. Nada aqui grava no banco nem navega para outra página.
(function () {
  'use strict';
  const LOCAL = 'http://127.0.0.1:3917';
  const OPCOES = [
    { id: 'pedido', rotulo: 'Imprimir o pedido', perm: 'pedidos.pdf' },
    { id: 'guia', rotulo: 'Guia de produção', perm: 'pedidos.pdf' },
    { id: 'vidros', rotulo: 'Vidros', perm: 'pedidos.pdf' },
    { id: 'checklist', rotulo: 'Checklist', perm: 'pedidos.checklist' }
  ];
  const opcoesDisponiveis = pode => OPCOES.filter(o => !pode || pode(o.perm));
  function urlDaOpcao(id, numero, apiBase) {
    const n = encodeURIComponent(numero);
    if (id === 'pedido') return `${apiBase}/dados_pdf?numero=${n}&tipo=Pedido`;
    if (id === 'guia') return `${apiBase}/dados_pdf?numero=${n}&tipo=Pedido&producao=1`;
    if (id === 'vidros') return `${apiBase}/dados_pdf_vidros?numero=${n}`;
    if (id === 'checklist') return `${apiBase}/checklist/pdf`;
    return '';
  }
  const ehPdf = async blob => { try { return (await blob.slice(0, 5).text()) === '%PDF-'; } catch { return false; } };

  async function localPronto() {
    try {
      const r = await fetch(LOCAL + '/ping', { signal: AbortSignal.timeout(800) });
      return r.ok && (await r.json().catch(() => ({}))).imprimir === true;
    } catch { return false; }
  }

  async function imprimirNoLocal(blob) {
    try {
      const r = await fetch(LOCAL + '/imprimir', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: blob });
      const j = await r.json().catch(() => ({}));
      return r.ok && j.ok ? { ok: true } : { ok: false, erro: j.error || `Erro ${r.status} no serviço do PC.` };
    } catch { return { ok: false, erro: 'O serviço do PC não respondeu.' }; }
  }

  function imprimirNoNavegador(blob) {
    return new Promise(resolver => {
      const link = URL.createObjectURL(blob);
      const quadro = document.createElement('iframe');
      quadro.setAttribute('aria-hidden', 'true'); quadro.className = 'ip-oculto';
      const limpar = () => { quadro.remove(); URL.revokeObjectURL(link); };
      const espera = setTimeout(() => { limpar(); resolver({ ok: false, erro: 'O navegador não carregou o PDF para imprimir.' }); }, 20000);
      quadro.addEventListener('load', () => {
        clearTimeout(espera);
        // o visualizador de PDF do navegador precisa de um instante depois do load
        setTimeout(() => {
          try { quadro.contentWindow.focus(); quadro.contentWindow.print(); resolver({ ok: true }); }
          catch { limpar(); resolver({ ok: false, erro: 'Não foi possível abrir a impressão do navegador. Abra o PDF e imprima por lá.' }); return; }
          setTimeout(limpar, 5 * 60 * 1000);
        }, 400);
      });
      quadro.src = link;
      document.body.appendChild(quadro);
    });
  }

  async function baixar(url, cfg) {
    let r;
    try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + cfg.token() } }); }
    catch { return { erro: 'Sem conexão com o servidor.' }; }
    if (r.status === 401) { try { localStorage.removeItem('auth'); } catch { /* sem storage */ } location.href = cfg.loginUrl; return { erro: 'Sessão expirada.' }; }
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).error || ''; } catch { /* sem corpo JSON */ }
      return r.status === 404 ? { erro: msg || 'Documento não encontrado.', semDocumento: true } : { erro: r.status === 403 ? 'Acesso restrito.' : `Erro ${r.status} no servidor.` };
    }
    const blob = await r.blob();
    return (await ehPdf(blob)) ? { blob } : { erro: 'O servidor não devolveu um PDF.' };
  }

  async function imprimir(url, cfg, { local } = {}) {
    const b = await baixar(url, cfg);
    if (!b.blob) return { ok: false, erro: b.erro, semDocumento: !!b.semDocumento };
    const usarLocal = local === undefined ? await localPronto() : local;
    if (usarLocal) {
      const l = await imprimirNoLocal(b.blob);
      if (l.ok) return { ok: true, via: 'local' };
      // o serviço falhou (impressora, SumatraPDF...): cai na impressão do navegador e conta o motivo
      const n = await imprimirNoNavegador(b.blob);
      return n.ok ? { ok: true, via: 'navegador', aviso: l.erro } : { ok: false, erro: l.erro + ' ' + n.erro };
    }
    const n = await imprimirNoNavegador(b.blob);
    return n.ok ? { ok: true, via: 'navegador' } : { ok: false, erro: n.erro };
  }

  // Prepara um documento para o lote do painel: o serviço do PC envia na hora; sem ele (ou se falhar) NÃO abre nada e
  // devolve o PDF para o botão "Imprimir" do documento (o navegador só aceita uma caixa de impressão por vez).
  async function preparar(url, cfg, { local } = {}) {
    const b = await baixar(url, cfg);
    if (!b.blob) return { ok: false, erro: b.erro, semDocumento: !!b.semDocumento };
    const usarLocal = local === undefined ? await localPronto() : local;
    if (usarLocal) {
      const l = await imprimirNoLocal(b.blob);
      if (l.ok) return { ok: true, via: 'local' };
      return { ok: true, via: 'navegador', manual: true, blob: b.blob, aviso: l.erro };
    }
    return { ok: true, via: 'navegador', manual: true, blob: b.blob };
  }

  // Abre a caixa de impressão de um PDF já baixado (chamar dentro do clique do usuário, um documento por vez).
  async function imprimirBlob(blob) {
    const n = await imprimirNoNavegador(blob);
    return n.ok ? { ok: true, via: 'navegador' } : { ok: false, erro: n.erro };
  }

  // item do menu do botão direito: imprime e só avisa se algo deu errado
  async function imprimirComAviso(url, cfg) {
    const r = await imprimir(url, cfg);
    if (!r.ok && !String(r.erro || '').startsWith('Sessão')) alert('Não foi possível imprimir: ' + r.erro);
    return r;
  }

  const textoResultado = r => !r.ok ? (r.semDocumento ? 'Nada a imprimir: ' + r.erro : 'Erro: ' + r.erro)
    : r.via === 'local' ? 'Enviado à impressora'
    : r.manual ? 'Pronto: clique em Imprimir' + (r.aviso ? ` (impressão automática falhou: ${r.aviso})` : '')
    : 'Caixa de impressão aberta' + (r.aviso ? ` (impressão automática falhou: ${r.aviso})` : '');

  function painel(cfg) {
    const opcoes = opcoesDisponiveis(cfg.pode);
    if (!opcoes.length) return Promise.resolve();
    return new Promise(resolver => {
      const fundo = document.createElement('div'); fundo.className = 'dp-fundo';
      const caixa = document.createElement('div'); caixa.className = 'dp-caixa ip-caixa';
      caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', cfg.titulo || 'Imprimir documentos');
      const t = document.createElement('div'); t.className = 'dp-titulo'; t.textContent = cfg.titulo || 'Imprimir documentos';
      const sub = document.createElement('div'); sub.className = 'dp-sub'; sub.textContent = `Pedido nº ${cfg.numero}${cfg.cliente ? ' · ' + cfg.cliente : ''}`;
      const modo = document.createElement('div'); modo.className = 'dp-sub ip-modo'; modo.textContent = 'Verificando a impressora do PC…';
      const lista = document.createElement('div'); lista.className = 'ip-lista';
      const linhas = {};
      for (const o of opcoes) {
        const l = document.createElement('label'); l.className = 'ip-linha'; l.htmlFor = 'ip-' + o.id;
        const c = document.createElement('input'); c.type = 'checkbox'; c.id = 'ip-' + o.id; c.checked = true;
        const n = document.createElement('span'); n.className = 'ip-nome'; n.textContent = o.rotulo;
        const s = document.createElement('span'); s.className = 'ip-estado'; s.setAttribute('role', 'status');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'dp-btn ip-botao'; b.textContent = 'Imprimir'; b.hidden = true;
        l.append(c, n, s, b); lista.append(l); linhas[o.id] = { c, s, b, blob: null };
      }
      const acoes = document.createElement('div'); acoes.className = 'dp-acoes';
      const bConcluir = document.createElement('button'); bConcluir.type = 'button'; bConcluir.className = 'dp-btn'; bConcluir.textContent = 'Concluir';
      const bImprimir = document.createElement('button'); bImprimir.type = 'button'; bImprimir.className = 'dp-btn dp-btn-ok'; bImprimir.textContent = 'Imprimir selecionados';
      let ocupado = false, abrindo = false, local;
      const marcados = () => opcoes.filter(o => linhas[o.id].c.checked);
      const pendentes = () => opcoes.filter(o => linhas[o.id].blob);
      const atualizar = () => {
        bImprimir.disabled = ocupado || abrindo || !marcados().length; bConcluir.disabled = ocupado || abrindo;
        for (const o of opcoes) { linhas[o.id].c.disabled = ocupado; linhas[o.id].b.disabled = ocupado || abrindo; }
      };
      const teclas = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(); } };
      const fecha = () => {
        if (ocupado || abrindo) return;
        if (pendentes().length && !confirm('Há documentos que ainda não foram impressos. Fechar mesmo assim?')) return;
        document.removeEventListener('keydown', teclas, true); fundo.remove(); resolver();
      };
      lista.addEventListener('change', atualizar);
      bConcluir.addEventListener('click', fecha);
      const mostrar = (id, r) => {
        const L = linhas[id];
        L.s.textContent = textoResultado(r);
        L.s.className = 'ip-estado ' + (r.ok && !r.manual ? 'ip-ok' : r.ok || r.semDocumento ? 'ip-neutro' : 'ip-erro');
        L.blob = r.manual ? r.blob : null; L.b.hidden = !r.manual;
      };
      for (const o of opcoes) {
        linhas[o.id].b.addEventListener('click', async e => {
          e.preventDefault(); e.stopPropagation();   // o botão está dentro do label: não pode marcar/desmarcar a caixa
          const L = linhas[o.id]; if (!L.blob || abrindo || ocupado) return;
          abrindo = true; atualizar(); L.s.textContent = 'Abrindo a caixa de impressão…'; L.s.className = 'ip-estado';
          let r;
          try { r = await imprimirBlob(L.blob); } catch (er) { r = { ok: false, erro: er.message }; }
          // print() foi chamado; o navegador não diz se o usuário confirmou, então o texto só afirma que a caixa abriu
          L.s.textContent = r.ok ? 'Caixa de impressão aberta. Para imprimir de novo, clique em Imprimir.' : 'Erro: ' + r.erro;
          L.s.className = 'ip-estado ' + (r.ok ? 'ip-ok' : 'ip-erro');
          abrindo = false; atualizar();
        });
      }
      bImprimir.addEventListener('click', async () => {
        const escolhidos = marcados();
        ocupado = true; atualizar();
        for (const o of opcoes) if (!escolhidos.includes(o)) { linhas[o.id].blob = null; linhas[o.id].b.hidden = true; linhas[o.id].s.textContent = ''; linhas[o.id].s.className = 'ip-estado'; }
        for (const o of escolhidos) { const L = linhas[o.id]; L.blob = null; L.b.hidden = true; L.s.className = 'ip-estado'; L.s.textContent = 'Aguardando'; }
        for (const o of escolhidos) {
          linhas[o.id].s.textContent = 'Preparando…';
          let r;
          try { r = await preparar(urlDaOpcao(o.id, cfg.numero, cfg.apiBase), cfg, { local }); } catch (e) { r = { ok: false, erro: e.message }; }
          mostrar(o.id, r);
        }
        ocupado = false; atualizar();
        const prim = escolhidos.find(o => linhas[o.id].blob);
        (prim ? linhas[prim.id].b : bConcluir).focus();
      });
      fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(); });
      document.addEventListener('keydown', teclas, true);
      acoes.append(bConcluir, bImprimir);
      caixa.append(t, sub, modo, lista, acoes);
      fundo.append(caixa); document.body.append(fundo);
      atualizar(); bImprimir.focus();
      localPronto().then(ok => {
        local = ok;
        modo.textContent = ok ? 'Impressão automática pelo PC: os documentos vão direto para a impressora.'
          : 'Neste computador o navegador abre uma caixa de impressão por vez: depois de preparar, use o botão Imprimir de cada documento.';
      });
    });
  }

  window.ImpressaoPdf = { imprimir, preparar, imprimirBlob, imprimirComAviso, painel, opcoesDisponiveis, urlDaOpcao, textoResultado, OPCOES };
})();
