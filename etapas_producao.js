// ==========================================================================
// etapas_producao.html — etapas de produção por pedido (Perfil cortado, Vidro cortado, Perfil pintado, Vidro pintado, Portas montadas, Pedido finalizado).
// Rotas: GET /etapas/fila (ao abrir a página e no botão "Atualizar"; a página NÃO se recarrega sozinha), PUT /etapas/pedido/:n/:etapa, GET /etapas/pedido/:n/historico.
// Cada célula é um botão-estado: clicar alterna pendente <-> OK (desfazer pede confirmação); botão direito / Shift+F10 / "⋯" abrem o menu.
// "Pedido finalizado" marca o pedido como Pronto (o servidor usa a mesma regra do menu de situação). Funções puras exportadas para os testes.
// Regras: docs/regras/etapas-producao.md
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.EtapasProducao = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const esc = C.esc;
  const CHAVE_FILTROS = 'etapas_producao_filtros';
  const FINAL = 'finalizado';
  const ETAPAS_PADRAO = [
    { codigo: 'perfil_cortado', nome: 'Perfil cortado', curto: 'Perfil cort.' }, { codigo: 'vidro_cortado', nome: 'Vidro cortado', curto: 'Vidro cort.' },
    { codigo: 'perfil_pintado', nome: 'Perfil pintado', curto: 'Perfil pint.' }, { codigo: 'vidro_pintado', nome: 'Vidro pintado', curto: 'Vidro pint.' },
    { codigo: 'portas_montadas', nome: 'Portas montadas', curto: 'Montadas' }, { codigo: 'finalizado', nome: 'Pedido finalizado', curto: 'Finalizado' }
  ];
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const nomeDe = (etapas, c) => ((etapas || ETAPAS_PADRAO).find(e => e.codigo === c) || {}).nome || c;
  const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || '';
  const dataBR = C.dataBR;
  const dataHoraBR = q => C.dataHoraBR(q) || '';

  // ---------- funções puras ----------
  // aparência de uma célula: { classe, texto, sub, titulo, bloqueado }
  function celula(nome, ef, pode) {
    let classe, texto, sub = '', detalhe;
    if (ef.estado === 'ok') {
      classe = ef.origem === 'corte' ? 'est-auto' : 'est-ok'; texto = '✓ OK';
      sub = ef.origem === 'corte' ? 'pelo corte' : primeiroNome(ef.usuario);
      detalhe = `OK${ef.usuario ? ' por ' + ef.usuario : ''}${ef.quando ? ' em ' + dataHoraBR(ef.quando) : ''}${ef.origem === 'corte' ? ' (marcado sozinho pela confirmação do corte)' : ''}`;
    } else if (ef.estado === 'na') {
      classe = 'est-na inerte'; texto = 'N/A';   // inerte: não clicável, sem reação ao mouse
      sub = ef.origem === 'auto' ? 'não se aplica' : primeiroNome(ef.usuario);
      detalhe = ef.origem === 'auto' ? 'não se aplica (o pedido não tem peças deste tipo)' : `N/A${ef.usuario ? ' por ' + ef.usuario : ''}${ef.quando ? ' em ' + dataHoraBR(ef.quando) : ''}`;
    } else {
      classe = 'est-pendente'; texto = '○ Pendente';
      detalhe = ef.origem === 'corte' ? 'pendente (o corte foi desfeito)' : 'pendente';
    }
    if (ef.observacao) detalhe += ` — ${ef.observacao}`;
    const bloqueado = !pode;
    return { classe: classe + (bloqueado ? ' bloq' : ''), texto, sub, bloqueado, inerte: ef.estado === 'na', titulo: `${nome}: ${detalhe}${bloqueado ? ' (só leitura: sem permissão para esta etapa)' : ''}` };
  }

  // o que o clique faz: 'ok' (pendente -> OK), 'desfazer' (OK -> pendente, com confirmação) ou null (N/A: a célula não é clicável,
  // pois a etapa não se aplica ao pedido; reverter um N/A marcado à mão é pelo menu do botão direito/⋯: "Desfazer")
  const acaoDoClique = ef => (ef.estado === 'ok' ? 'desfazer' : ef.estado === 'na' ? null : 'ok');

  // etapas anteriores ao finalizado que ainda não estão OK nem N/A
  const pendentesAntes = p => (p.etapas || []).filter(e => e.codigo !== FINAL && e.estado !== 'ok' && e.estado !== 'na').map(e => e.codigo);

  // filtros da tela (no navegador; o servidor já mandou só a fila do filtro de situação)
  function filtrar(pedidos, { busca = '', falta = '', minha = false, minhas = [] } = {}) {
    const q = norm(busca);
    return (pedidos || []).filter(p => {
      if (q && !(String(p.numero).includes(q) || norm(p.cliente).includes(q) || norm(p.clienteFinal).includes(q))) return false;
      if (falta && !(p.etapas || []).some(e => e.codigo === falta && e.estado === 'pendente')) return false;
      if (minha && !(p.etapas || []).some(e => minhas.includes(e.codigo) && e.estado === 'pendente')) return false;
      return true;
    });
  }

  // "Atualizado às HH:MM" (hora do navegador da última leitura da fila); sem leitura ainda = "carregando…"
  function textoAtualizado(quando) {
    if (!quando) return 'carregando…';
    const d = new Date(quando);
    if (Number.isNaN(d.getTime())) return 'carregando…';
    return `Atualizado às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // itens do menu de uma célula (etapa): marcar OK, desfazer, N/A, histórico
  function itensMenuCelula(p, etapa, pode) {
    const ef = (p.etapas || []).find(e => e.codigo === etapa) || { estado: 'pendente' };
    const L = [];
    // finalizado OK com o pedido de volta em produção (menu de situação ou VB): "Marcar OK" fica ativo para marcar Pronto de novo
    const reaplicar = etapa === FINAL && ef.estado === 'ok' && !norm(p.situacao).includes('pronto');
    if (pode) {
      // etapa N/A não vira OK: ela não se aplica ao pedido (para mudar, "Desfazer" volta a pendente)
      L.push({ acao: 'ok', icone: '✓', rotulo: reaplicar ? 'Marcar OK de novo (o pedido volta a Pronto)' : 'Marcar OK', desativado: (ef.estado === 'ok' && !reaplicar) || ef.estado === 'na' });
      L.push({ acao: 'desfazer', icone: '↺', rotulo: 'Desfazer (voltar a pendente)', desativado: ef.estado === 'pendente' });
      if (etapa !== FINAL) L.push({ acao: 'na', icone: '–', rotulo: 'Marcar N/A (não se aplica)', desativado: ef.estado === 'na' });
    }
    L.push({ acao: 'historico', icone: '🕘', rotulo: 'Ver histórico da etapa' });
    return L;
  }
  // menu da linha ("⋯" no celular): ações das etapas que o usuário pode mexer + histórico do pedido
  function itensMenuLinha(p, etapas, podeEtapa) {
    const L = [];
    for (const e of etapas || ETAPAS_PADRAO) {
      if (!podeEtapa(e.codigo)) continue;
      L.push({ titulo: e.nome });
      for (const it of itensMenuCelula(p, e.codigo, true).filter(i => i.acao !== 'historico')) L.push({ ...it, etapa: e.codigo });
    }
    L.push({ acao: 'historico', icone: '🕘', rotulo: 'Ver histórico do pedido', etapa: '' });
    return L;
  }

  function htmlNumero(p, link) {
    const n = esc(p.numero);
    if (link === 'pdf') return `<button type="button" data-guia="${n}" title="Abrir a guia de produção (PDF sem valores)">${n}</button>`;
    if (link === 'editar') return `<a href="orcamentos.html?abrir=Pedido/${encodeURIComponent(p.numero)}&amp;voltar=etapas_producao.html" title="Abrir o pedido">${n}</a>`;
    return n;
  }

  // uma linha (tr) por pedido. ctx: { etapas, podeEtapa(codigo), minhas:Set, destacar:bool, link, salvando:Set('n|etapa') }
  function htmlLinha(p, ctx) {
    const etapas = ctx.etapas || ETAPAS_PADRAO;
    const celulas = etapas.map(e => {
      const ef = (p.etapas || []).find(x => x.codigo === e.codigo) || { estado: 'pendente' };
      const pode = ctx.podeEtapa(e.codigo);
      const c = celula(e.nome, ef, pode);
      const salvando = ctx.salvando && ctx.salvando.has(`${p.numero}|${e.codigo}`);
      const minha = ctx.destacar && ctx.minhas && ctx.minhas.has(e.codigo);
      return `<td class="etp-c${minha ? ' etp-minha' : ''}"><button type="button" class="etp-cel ${c.classe}${salvando ? ' salvando' : ''}" data-numero="${esc(p.numero)}" data-etapa="${e.codigo}" data-nome="${esc(e.curto || e.nome)}"`
        + ` title="${esc(c.titulo)}" aria-label="${esc(`Pedido ${p.numero}, ${c.titulo}`)}"${c.bloqueado || c.inerte ? ' aria-disabled="true"' : ''}${salvando ? ' aria-busy="true"' : ''}>`
        + `<span>${esc(c.texto)}</span>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</button></td>`;
    }).join('');
    const atraso = p.atrasado ? '<span class="selo perigo">Atrasado</span>' : '';
    const prog = `${p.qtdConcluidas}/${p.qtdEtapas}`;
    // barra por classes (sem estilo inline): etp-t{1..6} = quantas etapas se aplicam, etp-f{0..t} = quantas estão OK
    const total = Math.max(1, Math.min(6, Number(p.qtdEtapas) || 1));
    const feitas = Math.max(0, Math.min(total, Number(p.qtdConcluidas) || 0));
    return `<tr data-numero="${esc(p.numero)}">`
      + `<td class="etp-num">${htmlNumero(p, ctx.link)}</td>`
      + `<td class="etp-acoes"><button type="button" class="etp-mais" data-mais="${esc(p.numero)}" aria-label="Ações do pedido ${esc(p.numero)}" aria-haspopup="menu">⋯</button></td>`
      + `<td class="etp-cli" title="${esc(p.cliente)}">${esc(p.cliente)}</td>`
      + `<td class="etp-final" title="${esc(p.clienteFinal)}">${esc(p.clienteFinal)}</td>`
      + `<td class="etp-pronto">${p.prontoEm ? esc(dataBR(p.prontoEm)) : '—'}${atraso}</td>`
      + celulas
      + `<td class="etp-prog" aria-label="${esc(`${p.qtdConcluidas} de ${p.qtdEtapas} etapas concluídas`)}">${esc(prog)}<span class="etp-barra" aria-hidden="true"><i class="etp-t${total} etp-f${feitas}"></i></span></td>`
      + '</tr>';
  }

  function htmlCabecalho(etapas, minhas, destacar) {
    return '<tr><th scope="col">Nº</th><th scope="col" class="etp-acoes"><span class="cinza">Ações</span></th><th scope="col">Cliente</th><th scope="col">Cliente final</th><th scope="col">Pronto em</th>'
      + (etapas || ETAPAS_PADRAO).map(e => `<th scope="col" class="etp-col-etapa${destacar && minhas.has(e.codigo) ? ' etp-minha' : ''}">${esc(e.nome)}</th>`).join('')
      + '<th scope="col">Progresso</th></tr>';
  }

  // estado otimista de uma célula enquanto o servidor responde
  function aplicarOtimista(p, etapa, estado, usuario) {
    const etapas = (p.etapas || []).map(e => (e.codigo === etapa ? { ...e, estado, origem: 'manual', usuario: usuario || e.usuario, quando: null, automatico: false } : e));
    // mesma conta do servidor (calculo/etapas_producao.js progresso): OK sobre as etapas que se aplicam (N/A fora)
    const qtdConcluidas = etapas.filter(e => e.estado === 'ok').length;
    const qtdEtapas = etapas.filter(e => e.estado !== 'na').length;
    return { ...p, etapas, qtdConcluidas, qtdEtapas };
  }

  const lerFiltros = win => { try { return JSON.parse(win.localStorage.getItem(CHAVE_FILTROS) || '{}') || {}; } catch { return {}; } };
  const gravarFiltros = (win, f) => { try { win.localStorage.setItem(CHAVE_FILTROS, JSON.stringify(f)); } catch { /* sem armazenamento: vale só nesta visita */ } };

  // ---------- navegador ----------
  function iniciar(win) {
    const doc = win.document, $ = id => doc.getElementById(id);
    const { getAuth, chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const auth = getAuth();
    if (!auth) { win.location.href = C.LOGIN_URL; return; }
    $('user-empresa').textContent = auth.user.empresa || 'Elegance';
    $('user-name').textContent = auth.user.nome || '';
    $('user-cargo').textContent = auth.user.cargo || '';
    $('user-avatar').textContent = (auth.user.nome || 'E').charAt(0).toUpperCase();
    if (win.Acesso && !win.Acesso.paginaLiberada()) return;
    const pode = c => !!(win.Acesso && win.Acesso.pode(c));

    const salvo = lerFiltros(win);
    const estado = { pedidos: [], etapas: ETAPAS_PADRAO, podeMarcar: [], versao: '', atualizadoEm: null, consulta: 0, salvando: new Set(), menuAberto: false, janela: false,
      pendenteDesenho: false, filtros: { busca: '', falta: typeof salvo.falta === 'string' ? salvo.falta : '', minha: salvo.minha === true, abertos: salvo.abertos === true } };
    const link = pode('pedidos.pdf') ? 'pdf' : pode('orcamentos.criar') && pode('valores.ver') ? 'editar' : null;
    const podeEtapa = c => estado.podeMarcar.includes(c);
    const doNumero = n => estado.pedidos.find(p => String(p.numero) === String(n));

    // controles
    $('etp-falta').innerHTML = '<option value="">Qualquer etapa</option>' + ETAPAS_PADRAO.map(e => `<option value="${e.codigo}">Falta: ${esc(e.nome)}</option>`).join('');
    $('etp-falta').value = estado.filtros.falta;
    $('etp-abertos').checked = estado.filtros.abertos;
    const marcarMinha = () => { const b = $('etp-minha'); b.setAttribute('aria-pressed', String(estado.filtros.minha)); b.classList.toggle('btn-primary', estado.filtros.minha); b.classList.toggle('btn-secondary', !estado.filtros.minha); };
    marcarMinha();

    // desenha sem piscar: só troca a linha cujo HTML mudou; devolve o foco ao mesmo botão
    function desenhar() {
      if (estado.menuAberto || estado.janela) { estado.pendenteDesenho = true; return; }
      estado.pendenteDesenho = false;
      const minhas = new Set(estado.podeMarcar);
      const destacar = estado.filtros.minha;
      const ctx = { etapas: estado.etapas, podeEtapa, minhas, destacar, link, salvando: estado.salvando };
      const cab = htmlCabecalho(estado.etapas, minhas, destacar);
      const thead = $('etp-thead');
      if (thead.dataset.h !== cab) { thead.innerHTML = cab; thead.dataset.h = cab; }
      const lista = filtrar(estado.pedidos, { ...estado.filtros, minhas: estado.podeMarcar });
      const corpo = $('etp-corpo');
      const ativo = doc.activeElement && doc.activeElement.closest ? doc.activeElement.closest('[data-numero][data-etapa], [data-mais], [data-guia]') : null;
      const foco = ativo ? { numero: ativo.dataset.numero || ativo.dataset.mais || ativo.dataset.guia, etapa: ativo.dataset.etapa || '', mais: !!ativo.dataset.mais, guia: !!ativo.dataset.guia } : null;
      const existentes = new Map([...corpo.querySelectorAll('tr[data-numero]')].map(tr => [tr.dataset.numero, tr]));
      const tmp = doc.createElement('tbody');
      let anterior = null;
      for (const p of lista) {
        const h = htmlLinha(p, ctx);
        let tr = existentes.get(String(p.numero));
        if (tr) existentes.delete(String(p.numero));
        if (!tr || tr.dataset.h !== h) {
          tmp.innerHTML = h;
          const novo = tmp.firstElementChild;
          novo.dataset.h = h;
          if (tr) tr.replaceWith(novo); else corpo.appendChild(novo);
          tr = novo;
        }
        // mantém a ordem do servidor
        const esperado = anterior ? anterior.nextElementSibling : corpo.firstElementChild;
        if (esperado !== tr) corpo.insertBefore(tr, esperado);
        anterior = tr;
      }
      for (const tr of existentes.values()) tr.remove();
      corpo.querySelectorAll('tr.etp-vazio-linha').forEach(x => x.remove());
      if (!lista.length) corpo.insertAdjacentHTML('beforeend', `<tr class="etp-vazio-linha"><td class="etp-vazio" colspan="${6 + estado.etapas.length}">${estado.pedidos.length ? 'Nenhum pedido com esse filtro.' : 'Nenhum pedido em produção.'}</td></tr>`);
      if (foco && !(doc.activeElement && corpo.contains(doc.activeElement))) {
        const sel = foco.mais ? `[data-mais="${foco.numero}"]` : foco.guia ? `[data-guia="${foco.numero}"]` : `[data-numero="${foco.numero}"][data-etapa="${foco.etapa}"]`;
        const alvo = corpo.querySelector(sel);
        if (alvo) alvo.focus({ preventScroll: true });
      }
      const qtd = estado.pedidos.length, vis = lista.length;
      $('etp-resumo').textContent = `${vis === qtd ? qtd : `${vis} de ${qtd}`} pedido(s)${estado.limitado ? ' (lista limitada: refine a busca)' : ''}`;
      $('etp-legenda').hidden = false;
    }

    function tique() { $('etp-atualizado').textContent = textoAtualizado(estado.atualizadoEm); }

    async function carregar({ forcar = false } = {}) {
      const minha = ++estado.consulta;
      const situacao = estado.filtros.abertos ? 'abertos' : 'producao';
      estado.carregando = true;
      try {
        const versao = forcar ? '' : estado.versao;
        const d = await chamar(`/etapas/fila?situacao=${situacao}${versao ? '&versao=' + encodeURIComponent(versao) : ''}`);
        if (minha !== estado.consulta) return;
        estado.atualizadoEm = Date.now();
        if (!d.inalterado) {
          estado.pedidos = d.pedidos || []; estado.etapas = d.etapas && d.etapas.length ? d.etapas : ETAPAS_PADRAO; estado.podeMarcar = d.podeMarcar || [];
          estado.limitado = !!d.limitado; estado.versao = d.versao || '';
          desenhar();
        }
        $('etp-erro').hidden = true;
      } catch (err) {
        if (minha === estado.consulta) { $('etp-erro').hidden = false; $('etp-erro').textContent = `Não foi possível atualizar: ${err.message}`; }
      } finally {
        if (minha === estado.consulta) estado.carregando = false;
        tique();
        $('etp-corpo-painel').removeAttribute('aria-busy');
      }
    }

    // ---------- janelas (classes .dp-* do tema.css) ----------
    function janela({ titulo, sub, corpo, textoOk = 'Confirmar', perigo = false }) {
      return new Promise(resolver => {
        estado.janela = true;
        const fundo = doc.createElement('div'); fundo.className = 'dp-fundo';
        const caixa = doc.createElement('div'); caixa.className = 'dp-caixa etp-larga';
        caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', titulo);
        caixa.innerHTML = `<div class="dp-titulo">${esc(titulo)}</div>${sub ? `<div class="dp-sub">${esc(sub)}</div>` : ''}<div class="etp-jcorpo">${corpo || ''}</div>`
          + `<div class="dp-acoes"><button type="button" class="dp-btn" data-j="nao">Cancelar</button>${textoOk ? `<button type="button" class="dp-btn${perigo ? '' : ' dp-btn-ok'}" data-j="sim">${esc(textoOk)}</button>` : ''}</div>`;
        const voltar = doc.activeElement;
        const fecha = valor => {
          doc.removeEventListener('keydown', teclas, true); fundo.remove(); estado.janela = false;
          if (voltar && voltar.focus) voltar.focus({ preventScroll: true });
          if (estado.pendenteDesenho) desenhar();
          resolver(valor);
        };
        const ler = () => { const r = {}; caixa.querySelectorAll('input').forEach(i => { r[i.name] = i.type === 'checkbox' ? i.checked : i.type === 'radio' ? (i.checked ? i.value : r[i.name]) : i.value; }); return r; };
        const teclas = e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(null); }
          else if (e.key === 'Tab') {
            const itens = [...caixa.querySelectorAll('button, input')].filter(x => !x.disabled), i = itens.indexOf(doc.activeElement);
            e.preventDefault(); itens[(i + (e.shiftKey ? itens.length - 1 : 1) + itens.length) % itens.length].focus();
          }
        };
        caixa.addEventListener('click', e => { const b = e.target.closest('[data-j]'); if (b) fecha(b.dataset.j === 'sim' ? ler() : null); });
        fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(null); });
        doc.addEventListener('keydown', teclas, true);
        fundo.append(caixa); doc.body.append(fundo);
        (caixa.querySelector('[data-j="sim"]') || caixa.querySelector('[data-j="nao"]')).focus();
      });
    }

    // ---------- gravar ----------
    async function gravar(p, etapa, corpo, { otimista = true } = {}) {
      const chave = `${p.numero}|${etapa}`;
      if (estado.salvando.has(chave)) return;
      ++estado.consulta; estado.carregando = false;   // uma consulta da fila que já estava a caminho (botão Atualizar) traria o estado de antes do clique: é descartada
      const antes = doNumero(p.numero);
      if (otimista && antes && corpo.estado) {
        const i = estado.pedidos.indexOf(antes);
        estado.pedidos[i] = aplicarOtimista(antes, etapa, corpo.estado, auth.user.nome);
      }
      estado.salvando.add(chave); desenhar();
      try {
        const d = await chamar(`/etapas/pedido/${encodeURIComponent(p.numero)}/${encodeURIComponent(etapa)}`, { metodo: 'PUT', corpo });
        const atual = doNumero(p.numero);
        if (atual) Object.assign(atual, { etapas: d.etapas, qtdConcluidas: d.qtdConcluidas, qtdEtapas: d.qtdEtapas, situacao: d.situacao, prontoEm: d.dataPronto || atual.prontoEm });
        estado.versao = '';   // a próxima consulta traz a fila inteira de novo
        if (d.situacaoMudou) {
          toast(`Pedido nº ${p.numero}: situação agora é "${d.situacao}".`, 'ok');
          if (!estado.filtros.abertos && d.situacao !== 'Em Produção') estado.pedidos = estado.pedidos.filter(x => String(x.numero) !== String(p.numero));
        }
      } catch (err) {
        const i = estado.pedidos.findIndex(x => String(x.numero) === String(p.numero));
        if (i >= 0 && antes) estado.pedidos[i] = antes;   // desfaz a mudança otimista
        toast(err.message, 'erro');
      } finally {
        estado.salvando.delete(chave);
        desenhar();
      }
    }

    async function finalizar(p) {
      const pendentes = pendentesAntes(p);
      const gerir = pode('etapas.gerir');
      if (pendentes.length && !gerir) { toast(`Faltam etapas antes de finalizar: ${pendentes.map(c => nomeDe(estado.etapas, c)).join(', ')}.`, 'erro'); return; }
      const jaPronto = norm(p.situacao).includes('pronto');
      const opcoesData = jaPronto ? '' : `<p class="dp-sub">O pedido passa para a situação <b>Pronto</b>, sai desta fila e entra na fila de Entregas.</p>
        <div class="etp-opcoes" role="radiogroup" aria-label="Data de pronto">
          <label><input type="radio" name="dataPronto" value="manter" checked> <span>Manter a data de pronto${p.prontoEm ? ` (${esc(dataBR(p.prontoEm))})` : ''}</span></label>
          <label><input type="radio" name="dataPronto" value="hoje"> <span>Atualizar a data de pronto para hoje (${esc(new Date().toLocaleDateString('pt-BR'))})</span></label>
        </div>`;
      const forcar = pendentes.length ? `<div class="etp-aviso">Etapas ainda pendentes: ${esc(pendentes.map(c => nomeDe(estado.etapas, c)).join(', '))}.</div>
        <div class="etp-opcoes"><label><input type="checkbox" name="forcar"> <span>Forçar o finalizado mesmo assim (fica registrado no histórico)</span></label></div>` : '';
      const r = await janela({ titulo: 'Pedido finalizado', sub: `Pedido nº ${p.numero}${p.cliente ? ' · ' + p.cliente : ''}`, corpo: opcoesData + forcar, textoOk: jaPronto ? 'Marcar OK' : 'Marcar como Pronto' });
      if (!r) return;
      if (pendentes.length && !r.forcar) { toast('Marque "Forçar" para finalizar com etapas pendentes.', 'erro'); return; }
      await gravar(p, FINAL, { estado: 'ok', ...(r.dataPronto === 'hoje' ? { dataPronto: 'hoje' } : {}), ...(r.forcar ? { forcar: true } : {}) });
    }

    async function desfazer(p, etapa) {
      const nome = nomeDe(estado.etapas, etapa);
      if (etapa === FINAL) {
        const podeVoltar = pode('pedidos.situacao') && norm(p.situacao).includes('pronto');
        const corpo = podeVoltar ? '<div class="etp-opcoes"><label><input type="checkbox" name="voltar"> <span>Voltar também a situação do pedido para <b>Em Produção</b></span></label></div>'
          : '<p class="dp-sub">A situação do pedido não muda (use "Mudar situação" na lista de pedidos, se precisar).</p>';
        const r = await janela({ titulo: `Desfazer "${nome}"`, sub: `Pedido nº ${p.numero}${p.cliente ? ' · ' + p.cliente : ''}`, corpo, textoOk: 'Desfazer', perigo: true });
        if (!r) return;
        await gravar(p, etapa, { estado: 'pendente', ...(r.voltar ? { voltarParaProducao: true } : {}) });
        return;
      }
      const r = await janela({ titulo: `Desfazer "${nome}"?`, sub: `Pedido nº ${p.numero}${p.cliente ? ' · ' + p.cliente : ''}: a etapa volta a pendente.`, textoOk: 'Desfazer', perigo: true });
      if (r) await gravar(p, etapa, { estado: 'pendente' });
    }

    async function executar(acao, p, etapa) {
      if (acao === 'historico') return historico(p, etapa);
      if (!podeEtapa(etapa)) { toast('Sem permissão para esta etapa.', 'erro'); return; }
      if (acao === 'desfazer') return desfazer(p, etapa);
      if (acao === 'na') {
        const r = await janela({ titulo: `Marcar "${nomeDe(estado.etapas, etapa)}" como N/A?`, sub: `Pedido nº ${p.numero}: a etapa não se aplica a este pedido e não trava o finalizado.`, textoOk: 'Marcar N/A' });
        if (r) await gravar(p, etapa, { estado: 'na' });
        return;
      }
      if (etapa === FINAL) return finalizar(p);
      await gravar(p, etapa, { estado: 'ok' });
    }

    async function historico(p, etapa) {
      try {
        const d = await chamar(`/etapas/pedido/${encodeURIComponent(p.numero)}/historico${etapa ? '?etapa=' + encodeURIComponent(etapa) : ''}`);
        const rot = { ok: 'OK', pendente: 'pendente', na: 'N/A' };
        const origem = { manual: '', corte: ' (pelo corte)', sistema: ' (sistema)' };
        const itens = (d.eventos || []).map(e => `<li><b>${esc(e.nome)}</b>: ${esc(rot[e.estadoAntes] || '—')} → ${esc(rot[e.estadoDepois] || e.estadoDepois)}${esc(origem[e.origem] || '')}`
          + `${e.detalhe && e.detalhe.forcado ? ' · <b>forçado</b>' : ''}${e.detalhe && e.detalhe.situacao ? ` · situação: ${esc(e.detalhe.situacao)}` : ''}`
          + `<small>${esc(e.usuario || '—')} · ${esc(dataHoraBR(e.quando))}${e.observacao ? ' · ' + esc(e.observacao) : ''}${e.detalhe && e.detalhe.motivo ? ' · ' + esc(e.detalhe.motivo) : ''}</small></li>`).join('');
        await janela({ titulo: etapa ? `Histórico: ${nomeDe(estado.etapas, etapa)}` : 'Histórico das etapas', sub: `Pedido nº ${p.numero}${p.cliente ? ' · ' + p.cliente : ''}`,
          corpo: itens ? `<ul class="etp-hist">${itens}</ul>` : '<p class="dp-sub">Nenhuma mudança registrada ainda.</p>', textoOk: '' });
      } catch (err) { toast(err.message, 'erro'); }
    }

    // ---------- menu (botão direito, Shift+F10, "⋯") ----------
    let menu = null, origemMenu = null;
    function fecharMenu(devolverFoco) {
      if (menu) { menu.remove(); menu = null; }
      estado.menuAberto = false;
      if (devolverFoco && origemMenu && origemMenu.isConnected) origemMenu.focus({ preventScroll: true });
      origemMenu = null;
      if (estado.pendenteDesenho) desenhar();
    }
    function abrirMenu(el, x, y) {
      const numero = el.dataset.numero || el.dataset.mais;
      const p = doNumero(numero);
      if (!p) return;
      fecharMenu();
      const etapa = el.dataset.etapa || null;
      const itens = etapa ? itensMenuCelula(p, etapa, podeEtapa(etapa)).map(i => ({ ...i, etapa })) : itensMenuLinha(p, estado.etapas, podeEtapa);
      const m = doc.createElement('div');
      m.id = 'etp-menu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', `Ações do pedido ${p.numero}`);
      m.innerHTML = `<div class="mc-cab">Pedido nº ${esc(p.numero)}${etapa ? ' · ' + esc(nomeDe(estado.etapas, etapa)) : ''}</div>` + itens.map((it, i) => it.titulo
        ? `<div class="mc-tit">${esc(it.titulo)}</div>`
        : `<button type="button" role="menuitem" data-i="${i}"${it.desativado ? ' disabled' : ''}><span class="mc-ic">${esc(it.icone || '')}</span>${esc(it.rotulo)}</button>`).join('');
      m.addEventListener('click', e => {
        const b = e.target.closest('button[data-i]'); if (!b) return;
        const it = itens[Number(b.dataset.i)];
        fecharMenu(true);
        if (it) executar(it.acao, p, it.etapa);
      });
      m.addEventListener('keydown', e => {
        const bs = [...m.querySelectorAll('button:not([disabled])')], i = bs.indexOf(doc.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); fecharMenu(true); }
        else if (!bs.length) return;
        else if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); bs[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); bs[bs.length - 1].focus(); }
        else if (e.key === 'Tab') { e.preventDefault(); fecharMenu(true); }
      });
      doc.body.appendChild(m);
      menu = m; origemMenu = el; estado.menuAberto = true;
      const r = el.getBoundingClientRect();
      const px = x ?? r.left, py = y ?? r.bottom;
      const w = m.offsetWidth, h = m.offsetHeight;
      m.style.left = Math.max(8, Math.min(px, win.innerWidth - w - 8)) + 'px';
      m.style.top = Math.max(8, Math.min(py, win.innerHeight - h - 8)) + 'px';
      const primeiro = m.querySelector('button:not([disabled])');
      if (primeiro) primeiro.focus();
    }

    // ---------- eventos ----------
    const corpo = $('etp-corpo');
    corpo.addEventListener('click', e => {
      const guia = e.target.closest('[data-guia]');
      if (guia) { win.abrirPdfAutenticado(`${C.API_BASE}/dados_pdf?numero=${encodeURIComponent(guia.dataset.guia)}&tipo=Pedido&producao=1`); return; }
      const mais = e.target.closest('[data-mais]');
      if (mais) { abrirMenu(mais); return; }
      const b = e.target.closest('.etp-cel');
      if (!b) return;
      const p = doNumero(b.dataset.numero); if (!p) return;
      const etapa = b.dataset.etapa;
      if (!podeEtapa(etapa)) { toast(`Sem permissão para "${nomeDe(estado.etapas, etapa)}" (só leitura).`, 'info'); return; }
      const ef = (p.etapas || []).find(x => x.codigo === etapa) || { estado: 'pendente' };
      const acao = acaoDoClique(ef);
      if (!acao) return;   // N/A não é clicável
      executar(acao, p, etapa);
    });
    // botão direito; a tecla de menu e Shift+F10 disparam "contextmenu" no botão focado
    corpo.addEventListener('contextmenu', e => {
      const b = e.target.closest('.etp-cel, [data-mais]');
      if (!b) return;
      e.preventDefault();
      const teclado = e.clientX === 0 && e.clientY === 0;
      abrirMenu(b, teclado ? null : e.clientX, teclado ? null : e.clientY);
    });
    doc.addEventListener('mousedown', e => { if (menu && !menu.contains(e.target)) fecharMenu(false); });
    win.addEventListener('resize', () => fecharMenu(false));
    win.addEventListener('scroll', e => { if (menu && !(e.target && e.target.nodeType === 1 && menu.contains(e.target))) fecharMenu(false); }, true);

    const salvarFiltros = () => gravarFiltros(win, { falta: estado.filtros.falta, minha: estado.filtros.minha, abertos: estado.filtros.abertos });
    $('etp-busca').addEventListener('input', e => { estado.filtros.busca = e.target.value; desenhar(); });
    $('etp-falta').addEventListener('change', e => { estado.filtros.falta = e.target.value; salvarFiltros(); desenhar(); });
    $('etp-minha').addEventListener('click', () => { estado.filtros.minha = !estado.filtros.minha; marcarMinha(); salvarFiltros(); desenhar(); });
    $('etp-abertos').addEventListener('change', e => { estado.filtros.abertos = e.target.checked; salvarFiltros(); estado.versao = ''; carregar({ forcar: true }); });
    // sem atualização automática (decisão do dono): a fila só é lida ao abrir a página, ao trocar "Mostrar todos em aberto" e no botão "Atualizar";
    // cada clique numa etapa já mostra a mudança na hora (otimista) e fica com a resposta do servidor
    $('etp-recarregar').addEventListener('click', () => { if (!estado.carregando && !estado.salvando.size) carregar(); });
    $('etp-corpo-painel').setAttribute('aria-busy', 'true');
    carregar({ forcar: true });
  }

  return { ETAPAS_PADRAO, celula, acaoDoClique, pendentesAntes, filtrar, textoAtualizado, itensMenuCelula, itensMenuLinha, htmlLinha, htmlCabecalho, aplicarOtimista, iniciar };
});
