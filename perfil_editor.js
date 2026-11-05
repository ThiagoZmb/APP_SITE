// ==========================================================================
// Editor do desenho 3D do perfil (aba "Desenho 3D" de produtos.html). Parte 2 da biblioteca de seções.
// Traçado sobre a imagem do perfil (calibração em mm, origem no canto inferior esquerdo externo, y para cima), tabela de pontos,
// configurações (parede, junta, canal do vidro, cores) e prévia 3D ao vivo (Desenho3D). Salva em PUT /perfil_secoes/:codigo.
// A lógica pura (calibração, ímã, cliques, validação) está em calculo/perfil_traco.js e é testada no Node; aqui só tela.
// Sem innerHTML com dado vindo da API ou do usuário (tudo por textContent/value). Cores do canvas lidas das variáveis do tema.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.PerfilEditor = lib;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';

  let T = raiz.PerfilTraco || null;
  if (!T && typeof require === 'function') { try { T = require('./calculo/perfil_traco.js'); } catch (_) { T = null; } }

  const ROTULO_JUNTA = { reta: 'Reta (esquadro)', meia_esquadria: 'Meia-esquadria (45°)' };
  const MODOS = ['contorno', 'vazado', 'canal'];

  // estado do módulo (um editor por página)
  let ctx = null;                 // { api, toast, confirmar, pode }
  let el = {};                    // referências do DOM
  let paleta = {};
  let produto = null;             // { codigo, modelo, classe, classeSalva, salvo, temImagem, acabamentos }
  let tokenCarga = 0;
  let carregado = false;          // a seção do produto atual foi lida do servidor (ou confirmada inexistente)
  let existe = false;             // já existe seção salva
  let somenteLeitura = true;
  let estado = null, hist = null, config = null, sujo = false;
  let modo = 'contorno', ima = true, sel = null;
  let img = null, cal = null, calEtapa = null, calP1 = null, calP2 = null;
  let vista = { zoom: 1, tx: 0, ty: 0 };
  let ptr = null, msgTimer = 0, prevTimer = 0, coresTimer = 0, ctl3d = null, imagemTentada = false, ultimaValidacao = null;

  const $ = id => document.getElementById(id);
  function h(tag, attrs, ...filhos) {
    const e = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) continue;
      if (k === 'texto') e.textContent = v;
      else if (k === 'classe') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos) if (f) e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
    return e;
  }

  // ----------------------------------------------------------------------------------------------------------------
  // visibilidade da aba e carga
  // ----------------------------------------------------------------------------------------------------------------
  const abaBotao = () => document.querySelector('.aba[data-aba="desenho3d"]');
  const abaAtiva = () => { const a = document.querySelector('.aba.ativa'); return !!a && a.dataset.aba === 'desenho3d'; };

  function mostrarAba(visivel) {
    const b = abaBotao();
    if (!b) return;
    b.classList.toggle('pe-oculta', !visivel);
    if (!visivel && abaAtiva()) { const d = document.querySelector('.aba[data-aba="dados"]'); if (d) d.click(); }
  }
  function aviso(texto) {
    el.aviso.textContent = texto || '';
    el.aviso.hidden = !texto;
    el.corpo.hidden = !!texto;
  }

  function reiniciarEditor() {
    estado = T.novoEstado();
    config = T.configPadrao();
    hist = T.criarHistorico(estado);
    sujo = false; sel = null; modo = 'contorno'; calEtapa = null; calP1 = calP2 = null;
    descartarImagem();
    cal = T.calibracaoPadrao();
    imagemTentada = false;
  }

  // Chamado pelo produtos.html quando o produto da ficha muda (abrir, novo, trocar a classe no select).
  // info: { codigo, modelo, classe (valor do select), classeSalva (classe gravada), salvo, temImagem, acabamentos, recarregar }
  async function produtoMudou(info) {
    if (!ctx) return;
    const tk = ++tokenCarga;
    const anterior = produto;
    produto = info;
    const editor = ctx.pode('perfis.desenho');
    if (info.classe !== 'Perfil') { mostrarAba(false); return; }
    if (!info.salvo) {
      carregado = false; existe = false;
      if (!anterior || anterior.salvo || anterior.codigo !== info.codigo || info.recarregar) reiniciarEditor();
      somenteLeitura = true;
      mostrarAba(editor);
      aviso('Salve o produto (classe Perfil) antes de cadastrar o desenho dele.');
      return;
    }
    if (info.classeSalva !== 'Perfil') {
      somenteLeitura = true;
      mostrarAba(editor);
      aviso('Este produto ainda não está gravado como classe Perfil. Salve o produto com a classe Perfil e volte aqui.');
      return;
    }
    const mesmo = anterior && anterior.codigo === info.codigo && anterior.salvo && !info.recarregar && carregado;
    if (mesmo) { // só o select de classe mudou de volta para Perfil: nada a recarregar
      mostrarAba(editor || existe);
      aviso('');
      return;
    }
    reiniciarEditor();
    carregado = false; existe = false;
    somenteLeitura = !editor;
    let r = null;
    try {
      r = await ctx.api('/perfil_secoes/' + encodeURIComponent(info.codigo));
    } catch (e) {
      if (tk !== tokenCarga) return;
      if (!/ainda n[aã]o tem desenho/i.test(e.message || '')) { // erro de verdade (não é "sem desenho"): nunca deixa gravar às cegas
        somenteLeitura = true;
        mostrarAba(editor);
        aviso('Não foi possível ler o desenho deste perfil agora: ' + (e.message || 'erro desconhecido') + '. Abra o produto de novo para tentar outra vez.');
        return;
      }
    }
    if (tk !== tokenCarga) return;
    carregado = true;
    if (r && r.secao) {
      existe = true;
      estado = T.estadoDaSecao(r.secao);
      config = T.configDaSecao(r.secao);
      hist = T.criarHistorico(estado);
      info.__atualizado = r.atualizadoEm ? `${r.atualizadoEm}${r.atualizadoPor ? ' por ' + r.atualizadoPor : ''}` : '';
    }
    mostrarAba(editor || existe);
    aviso('');
    prepararCampos();
    renderTudo();
    ajustarVista();
    if (abaAtiva()) aoAtivarAba();
  }

  const temAlteracao = () => !!(produto && carregado && !somenteLeitura && sujo);

  // ----------------------------------------------------------------------------------------------------------------
  // imagem e calibração
  // ----------------------------------------------------------------------------------------------------------------
  function descartarImagem() { img = null; }
  const chaveCal = () => 'elegance.perfilCal.' + (produto ? produto.codigo : '0');
  function lerCalSalva(im) {
    try {
      const v = JSON.parse(localStorage.getItem(chaveCal()) || 'null');
      if (v && v.w === im.naturalWidth && v.h === im.naturalHeight && T.calibracaoCompleta(v)) return { mmPorPx: v.mmPorPx, origem: { px: v.origem.px, py: v.origem.py } };
    } catch (_) { /* sem armazenamento: calibra de novo */ }
    return null;
  }
  function gravarCal() {
    if (!img || !T.calibracaoCompleta(cal)) return;
    try { localStorage.setItem(chaveCal(), JSON.stringify({ w: img.naturalWidth, h: img.naturalHeight, mmPorPx: cal.mmPorPx, origem: cal.origem })); } catch (_) { /* sem armazenamento */ }
  }
  function usarImagem(url) {
    return new Promise(resolve => {
      const im = new Image();
      im.onload = () => {
        URL.revokeObjectURL(url);
        img = im;
        cal = lerCalSalva(im) || { mmPorPx: 0, origem: null };
        calEtapa = null; calP1 = calP2 = null;
        ajustarVista();
        msg(T.calibracaoCompleta(cal) ? 'Imagem carregada com a calibração salva neste navegador.' : '');
        renderTudo();
        resolve(true);
      };
      im.onerror = () => { URL.revokeObjectURL(url); ctx.toast('Arquivo de imagem inválido (use PNG ou JPG).', 'erro'); resolve(false); };
      im.src = url;
    });
  }
  async function imagemDoProduto(silencioso) {
    if (!produto || !produto.salvo) return false;
    if (!produto.temImagem) { if (!silencioso) ctx.toast('Este produto não tem imagem. Use “Escolher arquivo…” (a imagem só serve para traçar e não é enviada).', 'info'); return false; }
    const tk = tokenCarga;
    try {
      const blob = await ctx.api('/produtos/imagem/' + encodeURIComponent(produto.codigo), {}, true);
      if (tk !== tokenCarga) return false;
      return await usarImagem(URL.createObjectURL(blob));
    } catch (e) { if (!silencioso) ctx.toast('Não foi possível carregar a imagem do produto: ' + e.message, 'erro'); return false; }
  }
  function semImagem() { descartarImagem(); cal = T.calibracaoPadrao(); calEtapa = null; calP1 = calP2 = null; ajustarVista(); renderTudo(); }

  function iniciarCalibracao() {
    if (!img) { msg('Carregue uma imagem para calibrar a escala.'); return; }
    calEtapa = 'p1'; calP1 = calP2 = null; el.calBox.hidden = true;
    msg('Clique em uma das pontas de uma cota conhecida (ex.: o começo da cota 45).');
    renderTudo();
  }
  function aplicarCalibracao() {
    const r = T.calibrar(calP1, calP2, el.calMm.value);
    if (!r.ok) { msg(r.erro); return; }
    cal = { mmPorPx: r.mmPorPx, origem: (cal && cal.origem) || null };
    el.calBox.hidden = true;
    calEtapa = 'origem';
    msg(`Escala: ${T.formatarMm(1 / r.mmPorPx)} px por mm. Agora clique no canto INFERIOR ESQUERDO externo da seção (origem 0,0).`);
    gravarCal();
    renderTudo();
  }
  function iniciarOrigem() {
    if (!img) { msg('Sem imagem, a origem já é o canto da grade.'); return; }
    if (!cal || !(cal.mmPorPx > 0)) { msg('Calibre a escala primeiro (botão 1).'); return; }
    calEtapa = 'origem';
    msg('Clique no canto inferior esquerdo externo da seção (origem 0,0).');
    renderTudo();
  }

  // ----------------------------------------------------------------------------------------------------------------
  // coordenadas: tela <-> mundo (pixels da imagem) <-> mm
  // ----------------------------------------------------------------------------------------------------------------
  const calOk = () => T.calibracaoCompleta(cal);
  const telaParaMundo = (sx, sy) => ({ px: (sx - vista.tx) / vista.zoom, py: (sy - vista.ty) / vista.zoom });
  const mundoParaTela = (px, py) => ({ x: px * vista.zoom + vista.tx, y: py * vista.zoom + vista.ty });
  function mmParaTela(x, y) { const w = T.mmParaPx(cal, x, y); return mundoParaTela(w.px, w.py); }
  const tolMm = () => (calOk() ? T.TOL_ALINHAR_PX / vista.zoom * cal.mmPorPx : 1);

  function limitesMundo() {
    if (img) return { x0: 0, y0: 0, x1: img.naturalWidth, y1: img.naturalHeight };
    const pts = estado ? estado.contorno.pontos.concat(...estado.vazados.map(v => v.pontos)) : [];
    const xs = pts.map(p => p[0]).concat([0, 60]), ys = pts.map(p => p[1]).concat([0, 60]);
    const a = T.mmParaPx(cal, Math.min(...xs) - 8, Math.max(...ys) + 8), b = T.mmParaPx(cal, Math.max(...xs) + 8, Math.min(...ys) - 8);
    return { x0: a.px, y0: a.py, x1: b.px, y1: b.py };
  }
  function ajustarVista() {
    if (!el.canvas) return;
    const W = el.canvas.clientWidth || 600, H = el.canvas.clientHeight || 400;
    const b = limitesMundo();
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    vista.zoom = Math.min(W / bw, H / bh) * 0.96;
    vista.tx = (W - bw * vista.zoom) / 2 - b.x0 * vista.zoom;
    vista.ty = (H - bh * vista.zoom) / 2 - b.y0 * vista.zoom;
    desenhar();
  }
  function zoomEm(fator, sx, sy) {
    const novo = Math.min(60, Math.max(0.03, vista.zoom * fator));
    const f = novo / vista.zoom;
    vista.tx = sx - (sx - vista.tx) * f; vista.ty = sy - (sy - vista.ty) * f; vista.zoom = novo;
    desenhar();
  }

  // ----------------------------------------------------------------------------------------------------------------
  // desenho no canvas
  // ----------------------------------------------------------------------------------------------------------------
  function lerPaleta() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim() || 'white';
    paleta = { fundo: v('--bg'), grade: v('--border-color'), gradeForte: v('--border-strong'), texto: v('--text-mid'), acento: v('--primary-color'), info: v('--info-color'), ok: v('--success-color'), erro: v('--danger-color'), aviso: v('--warning-color') };
  }
  function ajustarCanvas() {
    const dpr = raiz.devicePixelRatio || 1;
    const w = Math.max(200, el.palco.clientWidth), hh = Math.max(200, el.palco.clientHeight);
    if (el.canvas.width !== Math.round(w * dpr) || el.canvas.height !== Math.round(hh * dpr)) {
      el.canvas.width = Math.round(w * dpr); el.canvas.height = Math.round(hh * dpr);
    }
  }
  function desenhar() {
    if (!el.canvas || !paleta.fundo || !estado) return;
    ajustarCanvas();
    const dpr = raiz.devicePixelRatio || 1;
    const c = el.canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = el.canvas.width / dpr, H = el.canvas.height / dpr;
    c.fillStyle = paleta.fundo; c.fillRect(0, 0, W, H);
    if (img) {
      c.save(); c.translate(vista.tx, vista.ty); c.scale(vista.zoom, vista.zoom); c.drawImage(img, 0, 0); c.restore();
    } else if (calOk()) {
      desenharGrade(c, W, H);
    }
    if (calOk()) {
      desenharEixos(c, W, H);
      desenharCanal(c);
      desenharPoligono(c, estado.contorno, { tipo: 'contorno' }, paleta.acento);
      estado.vazados.forEach((v, i) => desenharPoligono(c, v, { tipo: 'vazado', i }, paleta.info));
      if (estado.canalPendente) { const p = mmParaTela(estado.canalPendente[0], estado.canalPendente[1]); ponto(c, p.x, p.y, 5, paleta.ok); }
    }
    desenharMarcasCalibracao(c);
  }
  function desenharGrade(c, W, H) {
    c.lineWidth = 1;
    for (let mm = -20; mm <= 400; mm += 5) {
      const forte = mm % 10 === 0;
      c.strokeStyle = forte ? paleta.gradeForte : paleta.grade;
      const a = mmParaTela(mm, -20), b = mmParaTela(mm, 400);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      const d = mmParaTela(-20, mm), e = mmParaTela(400, mm);
      c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(e.x, e.y); c.stroke();
    }
    c.fillStyle = paleta.texto; c.font = '11px sans-serif';
    for (let mm = 10; mm <= 100; mm += 10) { const p = mmParaTela(mm, 0); c.fillText(String(mm), p.x + 2, p.y + 12); const q = mmParaTela(0, mm); c.fillText(String(mm), q.x - 22, q.y + 4); }
  }
  function desenharEixos(c, W, H) {
    const o = mundoParaTela(cal.origem.px, cal.origem.py);
    c.save(); c.strokeStyle = paleta.erro; c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(0, o.y); c.lineTo(W, o.y); c.moveTo(o.x, 0); c.lineTo(o.x, H); c.stroke(); c.restore();
    c.fillStyle = paleta.erro; c.font = '11px sans-serif'; c.fillText('0,0', o.x + 4, o.y - 4);
  }
  function ponto(c, x, y, r, cor, anel) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = cor; c.fill();
    if (anel) { c.beginPath(); c.arc(x, y, r + 3, 0, Math.PI * 2); c.strokeStyle = cor; c.lineWidth = 1.5; c.stroke(); }
  }
  function desenharPoligono(c, poli, alvo, cor) {
    if (!poli.pontos.length) return;
    const pts = poli.pontos.map(p => mmParaTela(p[0], p[1]));
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    if (poli.fechado) c.closePath();
    if (poli.fechado) { c.save(); c.globalAlpha = 0.16; c.fillStyle = cor; c.fill(); c.restore(); }
    c.strokeStyle = cor; c.lineWidth = 2; c.stroke();
    pts.forEach((p, i) => {
      const ruim = poli.pontos[i][0] < 0 || poli.pontos[i][1] < 0;
      const ehSel = sel && sel.alvo.tipo === alvo.tipo && sel.alvo.i === alvo.i && sel.idx === i;
      ponto(c, p.x, p.y, i === 0 && !poli.fechado ? 6 : 4, ruim ? paleta.erro : cor, ehSel);
      c.fillStyle = paleta.texto; c.font = '11px sans-serif'; c.fillText(String(i + 1), p.x + 7, p.y - 6);
    });
  }
  function desenharCanal(c) {
    const cv = estado.canal;
    if (!cv || ![cv.x0, cv.x1, cv.y0].every(Number.isFinite)) return;
    const topo = Math.max(cv.y0 + 12, 12);
    const a = mmParaTela(cv.x0, cv.y0), b = mmParaTela(cv.x1, cv.y0), a2 = mmParaTela(cv.x0, topo), b2 = mmParaTela(cv.x1, topo);
    c.save(); c.strokeStyle = paleta.ok; c.lineWidth = 2; c.setLineDash([6, 3]);
    c.beginPath(); c.moveTo(a2.x, a2.y); c.lineTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(b2.x, b2.y); c.stroke(); c.restore();
    c.fillStyle = paleta.ok; c.font = '11px sans-serif'; c.fillText('canal do vidro (4 mm)', a.x + 4, a.y + 14);
  }
  function desenharMarcasCalibracao(c) {
    if (!img) return;
    const marca = (p, rotulo) => { const t = mundoParaTela(p.px, p.py); ponto(c, t.x, t.y, 5, paleta.aviso, true); c.fillStyle = paleta.aviso; c.font = '11px sans-serif'; c.fillText(rotulo, t.x + 8, t.y - 8); };
    if (calP1) marca(calP1, 'A');
    if (calP2) marca(calP2, 'B');
    if (calP1 && calP2) { const a = mundoParaTela(calP1.px, calP1.py), b = mundoParaTela(calP2.px, calP2.py); c.strokeStyle = paleta.aviso; c.lineWidth = 1.5; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
  }

  // ----------------------------------------------------------------------------------------------------------------
  // mensagens e dica
  // ----------------------------------------------------------------------------------------------------------------
  function msg(texto) {
    clearTimeout(msgTimer);
    el.msg.textContent = texto || '';
    if (texto) msgTimer = setTimeout(() => { el.msg.textContent = ''; }, 9000);
  }
  function textoDica() {
    if (somenteLeitura) return 'Somente leitura: você pode girar a prévia 3D e dar zoom no desenho, mas não alterar.';
    if (calEtapa === 'p1') return 'Calibração (1/3): clique em uma ponta da cota conhecida.';
    if (calEtapa === 'p2') return 'Calibração (2/3): clique na outra ponta da mesma cota.';
    if (calEtapa === 'mm') return 'Calibração (3/3): digite a distância real entre A e B, em mm, e aplique.';
    if (calEtapa === 'origem') return 'Origem: clique no canto inferior esquerdo EXTERNO da seção (será o ponto 0,0; y cresce para cima).';
    if (img && !calOk()) return 'Calibre a escala (botão 1) e marque a origem (botão 2) antes de traçar. Ou use “Sem imagem” e digite os pontos na tabela.';
    if (modo === 'contorno') return estado.contorno.fechado
      ? 'Contorno fechado. Arraste um ponto para ajustar; clique num ponto e use Delete para apagar; “Inserir” cria ponto no meio da aresta.'
      : 'Contorno externo: clique nos vértices em sequência. Clique no primeiro ponto (ou em “Fechar contorno”) para fechar.';
    if (modo === 'vazado') return !estado.contorno.fechado
      ? 'Feche o contorno externo antes de traçar os vazados.'
      : 'Vazado: clique os vértices do oco principal ou de uma nervura; feche no primeiro ponto. Cada novo polígono é outro vazado.';
    return estado.canalPendente ? 'Canal do vidro (2/2): clique na outra lateral do canal.' : 'Canal do vidro: clique na lateral esquerda do canal, na altura onde o vidro começa (x0 e y0); depois na lateral direita (x1).';
  }

  // ----------------------------------------------------------------------------------------------------------------
  // alterar o traçado
  // ----------------------------------------------------------------------------------------------------------------
  function mudar(novo, opcoes) {
    if (JSON.stringify(novo) === JSON.stringify(estado)) return false;
    estado = novo;
    if (!(opcoes && opcoes.semHistorico)) hist.registrar(estado);
    sujo = true;
    validarSelecao();
    renderTudo();
    return true;
  }
  function validarSelecao() {
    if (!sel) return;
    const poli = sel.alvo.tipo === 'contorno' ? estado.contorno : estado.vazados[sel.alvo.i];
    if (!poli || !poli.pontos[sel.idx]) sel = null;
  }
  function todosOsPontos(exceto) {
    const lista = [];
    const juntar = (poli, alvo) => poli.pontos.forEach((p, idx) => {
      if (exceto && exceto.alvo.tipo === alvo.tipo && exceto.alvo.i === alvo.i && exceto.idx === idx) return;
      lista.push(p);
    });
    juntar(estado.contorno, { tipo: 'contorno' });
    estado.vazados.forEach((v, i) => juntar(v, { tipo: 'vazado', i }));
    return lista;
  }
  function candidatos() {
    const lista = [];
    const juntar = (poli, alvo) => poli.pontos.forEach((p, idx) => { const t = mmParaTela(p[0], p[1]); lista.push({ alvo, idx, px: t.x, py: t.y }); });
    juntar(estado.contorno, { tipo: 'contorno' });
    estado.vazados.forEach((v, i) => juntar(v, { tipo: 'vazado', i }));
    return lista;
  }
  function apagarSelecionado(alvoIdx) {
    const s = alvoIdx || sel;
    if (!s || somenteLeitura) return;
    sel = null;
    mudar(T.apagarPonto(estado, s.alvo, s.idx));
  }
  function fecharAtual() {
    let alvo = { tipo: 'contorno' };
    if (modo === 'vazado' || (estado.contorno.fechado && modo !== 'contorno')) {
      const i = estado.vazados.length - 1;
      if (i >= 0 && !estado.vazados[i].fechado) alvo = { tipo: 'vazado', i };
      else if (modo === 'vazado') { msg('Não há vazado aberto para fechar.'); return; }
    }
    const r = T.fecharPoligono(estado, alvo);
    if (r.aviso) msg(r.aviso);
    mudar(r.estado);
  }
  function cliqueNoPalco(sx, sy) {
    const w = telaParaMundo(sx, sy);
    if (calEtapa === 'p1') { calP1 = { px: w.px, py: w.py }; calEtapa = 'p2'; msg(''); renderTudo(); return; }
    if (calEtapa === 'p2') { calP2 = { px: w.px, py: w.py }; calEtapa = 'mm'; el.calBox.hidden = false; el.calMm.value = ''; renderTudo(); el.calMm.focus(); return; }
    if (calEtapa === 'mm') return;
    if (calEtapa === 'origem') {
      cal = { mmPorPx: cal.mmPorPx, origem: { px: w.px, py: w.py } };
      calEtapa = null; gravarCal();
      msg('Origem marcada. Pode traçar o contorno externo.');
      renderTudo();
      return;
    }
    if (somenteLeitura) return;
    if (!calOk()) { msg(textoDica()); return; }
    const mm = T.pxParaMm(cal, w.px, w.py);
    const r = T.aplicarClique(estado, modo, mm, { tolMm: tolMm(), ima });
    if (r.aviso) msg(r.aviso);
    mudar(r.estado);
  }

  // ----------------------------------------------------------------------------------------------------------------
  // renderização dos painéis
  // ----------------------------------------------------------------------------------------------------------------
  function renderTudo(opcoes) {
    if (!el.canvas || !estado) return;
    renderErros(); // primeiro: os demais painéis mostram os erros da validação atual
    renderBarra();
    renderTabelas();
    renderConfig(opcoes);
    el.dica.textContent = textoDica();
    desenhar();
    agendarPrevia();
  }
  function renderBarra() {
    document.querySelectorAll('#pe-raiz [data-modo]').forEach(b => b.classList.toggle('ativo', b.dataset.modo === modo));
    el.desfazer.disabled = !hist.podeDesfazer();
    el.refazer.disabled = !hist.podeRefazer();
    el.apagar.disabled = !sel;
    el.sujo.hidden = !temAlteracao();
    el.calibrar.classList.toggle('ativo', calEtapa === 'p1' || calEtapa === 'p2' || calEtapa === 'mm');
    el.origem.classList.toggle('ativo', calEtapa === 'origem');
    el.palco.classList.toggle('pe-sem-escala', !!img && !calOk());
    el.corpo.classList.toggle('pe-leitura', somenteLeitura);
    el.info.textContent = existe
      ? `Desenho cadastrado${produto && produto.__atualizado ? ' · atualizado em ' + produto.__atualizado : ''}.`
      : 'Este perfil ainda não tem desenho cadastrado: no 3D dos orçamentos ele aparece como bloco liso.';
    el.remover.hidden = somenteLeitura || !existe;
    el.salvar.hidden = somenteLeitura;
  }

  function renderTabelas() {
    const alvo = el.tabelas;
    alvo.textContent = '';
    const bloco = (titulo, poli, a, podeRemover) => {
      const erros = ultimaValidacao ? T.errosDe(ultimaValidacao.erros, a.tipo, a.tipo === 'vazado' ? a.i : undefined) : [];
      const cab = h('div', { classe: 'pe-poli-cab' },
        h('b', { texto: titulo }),
        h('span', { classe: 'pe-selo ' + (poli.fechado ? 'ok' : 'aviso'), texto: poli.fechado ? '● fechado' : '● aberto' }),
        h('span', { classe: 'pe-poli-qtd', texto: `${poli.pontos.length} pontos` }));
      const acoes = h('span', { classe: 'pe-poli-acoes', 'data-pe-edita': true });
      if (!poli.fechado) acoes.appendChild(h('button', { type: 'button', classe: 'btn btn-mini', 'data-acao': 'fechar', texto: 'Fechar' }));
      acoes.appendChild(h('button', { type: 'button', classe: 'btn btn-mini', 'data-acao': 'refazer', texto: podeRemover ? 'Remover' : 'Refazer' }));
      cab.appendChild(acoes);
      const caixa = h('div', { classe: 'pe-poli', 'data-tipo': a.tipo, 'data-i': a.i === undefined ? '' : String(a.i) }, cab);
      erros.forEach(t => caixa.appendChild(h('div', { classe: 'pe-erro-linha', texto: '⚠ ' + t })));
      if (poli.pontos.length) {
        const corpo = h('tbody');
        poli.pontos.forEach((p, idx) => {
          const ehSel = sel && sel.alvo.tipo === a.tipo && sel.alvo.i === a.i && sel.idx === idx;
          const ruim = p[0] < 0 || p[1] < 0;
          const campo = eixo => h('input', { type: 'text', inputmode: 'decimal', classe: 'num' + (ruim ? ' ruim' : ''), value: T.formatarMm(p[eixo === 'x' ? 0 : 1]), 'data-eixo': eixo, 'aria-label': `${eixo} do ponto ${idx + 1}`, disabled: somenteLeitura });
          const linha = h('tr', { classe: ehSel ? 'selecionado' : '', 'data-idx': String(idx) },
            h('td', { classe: 'num', texto: String(idx + 1) }), h('td', {}, campo('x')), h('td', {}, campo('y')),
            h('td', { classe: 'pe-linha-acoes', 'data-pe-edita': true },
              h('button', { type: 'button', classe: 'btn btn-mini', 'data-acao': 'inserir', title: 'Inserir ponto no meio da aresta seguinte', texto: 'Inserir' }),
              h('button', { type: 'button', classe: 'btn btn-mini', 'data-acao': 'apagar', title: 'Apagar este ponto', texto: '×' })));
          corpo.appendChild(linha);
        });
        caixa.appendChild(h('table', { classe: 'pe-tabela' }, h('thead', {}, h('tr', {}, h('th', { classe: 'num', texto: '#' }), h('th', { texto: 'x (mm)' }), h('th', { texto: 'y (mm)' }), h('th', { texto: '' }))), corpo));
      }
      alvo.appendChild(caixa);
    };
    bloco('Contorno externo', estado.contorno, { tipo: 'contorno' }, false);
    estado.vazados.forEach((v, i) => bloco(`Vazado ${i + 1}`, v, { tipo: 'vazado', i }, true));
    if (!estado.vazados.length) alvo.appendChild(h('p', { classe: 'dica', texto: 'Nenhum vazado ainda. Use o modo “Vazado” (oco principal e nervuras internas).' }));
  }

  function renderConfig(opcoes) {
    const cx = T.caixaDoContorno(estado.contorno.pontos);
    el.largura.value = cx.largura ? T.formatarMm(cx.largura) : '';
    el.altura.value = cx.altura ? T.formatarMm(cx.altura) : '';
    if (document.activeElement !== el.parede) el.parede.value = T.formatarMm(config.parede);
    el.junta.value = config.junta;
    el.usarCor.checked = !!config.corPadrao;
    el.corPadrao.disabled = somenteLeitura || !config.corPadrao;
    el.corPadrao.value = config.corPadrao || T.COR_PADRAO_INICIAL;
    const cv = estado.canal || {};
    [['x0', el.canalX0], ['x1', el.canalX1], ['y0', el.canalY0]].forEach(([k, inp]) => { if (document.activeElement !== inp) inp.value = Number.isFinite(cv[k]) ? T.formatarMm(cv[k]) : ''; });
    // lista de cores por acabamento (não é refeita enquanto o usuário digita nela, para não perder o foco)
    if (!(opcoes && opcoes.semCores)) el.cores.textContent = '';
    if (!(opcoes && opcoes.semCores)) config.cores.forEach((cr, i) => {
      el.cores.appendChild(h('div', { classe: 'pe-cor-linha', 'data-i': String(i) },
        h('input', { type: 'text', list: 'pe-lista-acab', value: cr.nome, placeholder: 'Acabamento', classe: 'pe-cor-nome', 'aria-label': 'Nome do acabamento', maxlength: '60', disabled: somenteLeitura }),
        h('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(cr.cor) ? cr.cor : T.COR_PADRAO_INICIAL, classe: 'pe-cor-valor', 'aria-label': 'Cor do acabamento', disabled: somenteLeitura }),
        h('button', { type: 'button', classe: 'btn btn-mini', 'data-acao': 'remover-cor', 'data-pe-edita': true, 'aria-label': 'Remover esta cor', texto: '×' })));
    });
    if (!(opcoes && opcoes.semCores) && !config.cores.length) el.cores.appendChild(h('p', { classe: 'dica', texto: 'Sem cor por acabamento: vale a cor padrão (ou o cinza de sempre).' }));
    // estimados
    el.estimada.textContent = '';
    config.estimada.forEach((t, i) => el.estimada.appendChild(h('span', { classe: 'pe-chip-est' },
      `Estimado: ${t}`,
      h('button', { type: 'button', 'data-acao': 'conferido', 'data-i': String(i), 'data-pe-edita': true, title: 'Marcar como conferido', 'aria-label': 'Marcar como conferido: ' + t, texto: '✓' }))));
    el.estimadaBox.hidden = !config.estimada.length;
    el.canalErro.textContent = '';
    const ec = ultimaValidacao ? T.errosDe(ultimaValidacao.erros, 'canal') : [];
    el.canalErro.textContent = ec.length ? '⚠ ' + ec[0] : '';
    const campoErro = (tipo, inp) => { const e = ultimaValidacao ? T.errosDe(ultimaValidacao.erros, tipo) : []; inp.classList.toggle('ruim', !!e.length); inp.title = e[0] || ''; };
    campoErro('parede', el.parede);
    el.paredeErro.textContent = ultimaValidacao && T.errosDe(ultimaValidacao.erros, 'parede')[0] ? '⚠ ' + T.errosDe(ultimaValidacao.erros, 'parede')[0] : '';
    // prévia: acabamentos disponíveis
    const nomes = [];
    const vistos = new Set();
    config.cores.map(c => c.nome.trim()).concat((produto && produto.acabamentos) || []).forEach(n => { const k = n.toUpperCase(); if (n && !vistos.has(k)) { vistos.add(k); nomes.push(n); } });
    const atual = el.prevAcab.value;
    el.prevAcab.textContent = '';
    el.prevAcab.appendChild(h('option', { value: '', texto: '(sem acabamento: cor padrão)' }));
    nomes.forEach(n => el.prevAcab.appendChild(h('option', { value: n, texto: n })));
    el.prevAcab.value = nomes.includes(atual) ? atual : '';
    // datalist
    el.listaAcab.textContent = '';
    ((produto && produto.acabamentos) || []).forEach(n => el.listaAcab.appendChild(h('option', { value: n })));
    if (somenteLeitura) el.corpo.querySelectorAll('#pe-config input, #pe-config select').forEach(i => { i.disabled = true; });
    else { [el.parede, el.junta, el.usarCor, el.canalX0, el.canalX1, el.canalY0].forEach(i => { i.disabled = false; }); }
  }

  function renderErros() {
    const meta = { codigo: produto && Number(produto.codigo), modelo: produto && produto.modelo };
    ultimaValidacao = T.validarEditor(estado, config, meta);
    const erros = ultimaValidacao.erros;
    el.erros.textContent = '';
    el.erros.hidden = !erros.length;
    if (erros.length) {
      el.erros.appendChild(h('b', { texto: erros.length === 1 ? '1 problema para resolver antes de salvar:' : `${erros.length} problemas para resolver antes de salvar:` }));
      const ul = h('ul');
      erros.forEach(e => ul.appendChild(h('li', { texto: e.texto })));
      el.erros.appendChild(ul);
    }
    el.salvar.disabled = !!erros.length;
    el.salvar.title = erros.length ? 'Corrija os problemas listados para poder salvar.' : '';
  }

  // ----------------------------------------------------------------------------------------------------------------
  // prévia 3D
  // ----------------------------------------------------------------------------------------------------------------
  function agendarPrevia() { clearTimeout(prevTimer); prevTimer = setTimeout(atualizarPrevia, 150); }
  async function atualizarPrevia() {
    if (!abaAtiva() || !el.cena || !ultimaValidacao) return;
    if (!raiz.Desenho3D) { el.prevStatus.textContent = 'Prévia 3D indisponível: desenho3d.js não carregou.'; return; }
    if (!ctl3d) ctl3d = raiz.Desenho3D.criar(el.cena, { aoErro: m => { el.prevStatus.textContent = m + ' A tabela e o salvamento continuam funcionando.'; } });
    const ok = await ctl3d.mostrar();
    if (!ok) return;
    if (ultimaValidacao.erros.length) { el.prevStatus.textContent = 'Prévia parada: corrija os problemas do desenho para atualizá-la.'; return; }
    el.prevStatus.textContent = 'Moldura de 150 mm com cantos' + (config.junta === 'meia_esquadria' ? ' em meia-esquadria (45°)' : ' retos') + ' e vidro de 4 mm. Arraste para girar; roda do mouse dá zoom.';
    ctl3d.atualizar(T.geometriaPrevia(ultimaValidacao.secao, { acabamento: el.prevAcab.value }));
  }
  function aoAtivarAba() {
    document.querySelector('.workspace')?.classList.add('modo-desenho');
    document.querySelector('.ficha')?.classList.add('modo-desenho');
    lerPaleta();
    if (!somenteLeitura && !imagemTentada && produto && produto.temImagem && !img) { imagemTentada = true; imagemDoProduto(true); }
    setTimeout(() => { ajustarVista(); renderTudo(); }, 0);
  }
  function aoSairAba() {
    document.querySelector('.workspace')?.classList.remove('modo-desenho');
    document.querySelector('.ficha')?.classList.remove('modo-desenho');
    clearTimeout(prevTimer);
    if (ctl3d) ctl3d.esconder();
  }

  // ----------------------------------------------------------------------------------------------------------------
  // salvar / remover
  // ----------------------------------------------------------------------------------------------------------------
  async function salvar() {
    if (somenteLeitura || !produto) return false;
    renderErros();
    if (ultimaValidacao.erros.length) { ctx.toast('Há problemas no desenho. Veja a lista abaixo.', 'erro'); return false; }
    let gravou = false;
    el.salvar.disabled = true; const txt = el.salvar.textContent; el.salvar.textContent = 'Salvando...';
    try {
      const r = await ctx.api('/perfil_secoes/' + encodeURIComponent(produto.codigo), { method: 'PUT', body: JSON.stringify(ultimaValidacao.secao) });
      existe = true; sujo = false;
      if (r && r.secao) config = T.configDaSecao(r.secao);
      produto.__atualizado = r && r.atualizadoEm ? `${r.atualizadoEm}${r.atualizadoPor ? ' por ' + r.atualizadoPor : ''}` : '';
      gravou = true;
      el.erroApi.hidden = true;
      ctx.toast('Desenho do perfil salvo. O 3D dos orçamentos já usa esta seção.', 'ok');
    } catch (e) {
      ctx.toast(e.message || 'Não foi possível salvar o desenho.', 'erro');
      el.erroApi.textContent = e.message || '';
      el.erroApi.hidden = !e.message;
    } finally {
      el.salvar.textContent = txt;
      renderTudo();
    }
    return gravou;
  }
  async function remover() {
    if (somenteLeitura || !existe) return;
    if (!(await ctx.confirmar('Remover o desenho deste perfil?', 'O desenho cadastrado será apagado e o perfil volta a aparecer como bloco liso no 3D dos orçamentos. Isso não pode ser desfeito.'))) return;
    try {
      await ctx.api('/perfil_secoes/' + encodeURIComponent(produto.codigo), { method: 'DELETE' });
      existe = false;
      estado = T.novoEstado(); config = T.configPadrao(); hist = T.criarHistorico(estado); sujo = false; sel = null;
      ctx.toast('Desenho removido.', 'ok');
      el.erroApi.hidden = true;
      renderTudo();
    } catch (e) { ctx.toast(e.message || 'Não foi possível remover o desenho.', 'erro'); }
  }

  // ----------------------------------------------------------------------------------------------------------------
  // eventos
  // ----------------------------------------------------------------------------------------------------------------
  function ligarEventos() {
    const cv = el.canvas;
    const posicao = e => { const r = cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      cv.focus();
      const { sx, sy } = posicao(e);
      const hit = !somenteLeitura && calOk() && !calEtapa ? T.pontoMaisProximo(candidatos(), sx, sy, 9) : null;
      if (e.button === 2) { if (hit) apagarSelecionado(hit); return; }
      if (e.button !== 0 && e.button !== 1) return;
      ptr = { id: e.pointerId, sx0: sx, sy0: sy, hit: e.button === 0 ? hit : null, moved: false, tx0: vista.tx, ty0: vista.ty };
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* sem captura */ }
    });
    cv.addEventListener('pointermove', e => {
      const { sx, sy } = posicao(e);
      if (!ptr || ptr.id !== e.pointerId) {
        if (calOk()) { const w = telaParaMundo(sx, sy); const mm = T.pxParaMm(cal, w.px, w.py); el.coord.textContent = `x ${T.formatarMm(mm[0])} · y ${T.formatarMm(mm[1])} mm`; } else el.coord.textContent = '';
        return;
      }
      const dx = sx - ptr.sx0, dy = sy - ptr.sy0;
      if (!ptr.moved && Math.hypot(dx, dy) > 4) ptr.moved = true;
      if (!ptr.moved) return;
      if (ptr.hit) {
        const w = telaParaMundo(sx, sy);
        const mm = T.encaixar(T.pxParaMm(cal, w.px, w.py), todosOsPontos(ptr.hit), { tolMm: tolMm(), ima });
        estado = T.moverPonto(estado, ptr.hit.alvo, ptr.hit.idx, mm);
        sel = { alvo: ptr.hit.alvo, idx: ptr.hit.idx };
        desenhar();
      } else { vista.tx = ptr.tx0 + dx; vista.ty = ptr.ty0 + dy; desenhar(); }
    });
    const soltar = e => {
      if (!ptr || ptr.id !== e.pointerId) return;
      const p = ptr; ptr = null;
      const { sx, sy } = posicao(e);
      if (p.moved) {
        if (p.hit) { hist.registrar(estado); sujo = true; renderTudo(); }
        return;
      }
      if (p.hit && modo !== 'canal') { // (no modo canal o clique num vértice vale como ponto do canal: cai no cliqueNoPalco)
        // clicar no 1º ponto de um polígono ainda aberto (com 3 ou mais pontos) FECHA o polígono em vez de só selecionar
        const poli = p.hit.alvo.tipo === 'contorno' ? estado.contorno : estado.vazados[p.hit.alvo.i];
        if (poli && p.hit.idx === 0 && !poli.fechado && poli.pontos.length >= 3) {
          const r = T.fecharPoligono(estado, p.hit.alvo);
          mudar(r.estado);
          return;
        }
        sel = { alvo: p.hit.alvo, idx: p.hit.idx }; renderTudo(); return;
      }
      cliqueNoPalco(sx, sy);
    };
    cv.addEventListener('pointerup', soltar);
    cv.addEventListener('pointercancel', e => { if (ptr && ptr.id === e.pointerId) { if (ptr.moved && ptr.hit) { estado = hist.atual(); } ptr = null; renderTudo(); } });
    cv.addEventListener('wheel', e => { e.preventDefault(); const { sx, sy } = posicao(e); zoomEm(e.deltaY > 0 ? 1 / 1.15 : 1.15, sx, sy); }, { passive: false });
    cv.addEventListener('keydown', e => {
      if (somenteLeitura) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); apagarSelecionado(); }
      else if (e.key === 'Escape') { calEtapa = null; calP1 = calP2 = null; el.calBox.hidden = true; estado = Object.assign({}, estado, { canalPendente: null }); msg(''); renderTudo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? refazer() : desfazer(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); refazer(); }
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (abaAtiva()) { desenhar(); } }).observe(el.palco);

    const desfazer = () => { if (hist.podeDesfazer()) { estado = hist.desfazer(); sujo = true; validarSelecao(); renderTudo(); } };
    const refazer = () => { if (hist.podeRefazer()) { estado = hist.refazer(); sujo = true; validarSelecao(); renderTudo(); } };
    el.desfazer.addEventListener('click', desfazer);
    el.refazer.addEventListener('click', refazer);
    el.apagar.addEventListener('click', () => apagarSelecionado());
    el.fechar.addEventListener('click', fecharAtual);
    el.novoVazado.addEventListener('click', () => { if (!estado.contorno.fechado) { msg('Feche o contorno externo antes de criar vazados.'); return; } modo = 'vazado'; mudar(T.novoVazado(estado)); });
    el.encostar.addEventListener('click', () => mudar(T.encostarNaOrigem(estado)));
    el.limparCanalBtn.addEventListener('click', () => mudar(T.limparCanal(estado)));
    el.ima.addEventListener('change', () => { ima = el.ima.checked; });
    document.querySelectorAll('#pe-raiz [data-modo]').forEach(b => b.addEventListener('click', () => { if (MODOS.includes(b.dataset.modo)) { modo = b.dataset.modo; calEtapa = null; renderTudo(); } }));
    el.zoomMais.addEventListener('click', () => zoomEm(1.3, el.canvas.clientWidth / 2, el.canvas.clientHeight / 2));
    el.zoomMenos.addEventListener('click', () => zoomEm(1 / 1.3, el.canvas.clientWidth / 2, el.canvas.clientHeight / 2));
    el.ajustar.addEventListener('click', ajustarVista);
    el.imgProduto.addEventListener('click', () => { imagemTentada = true; imagemDoProduto(false); });
    el.imgArquivo.addEventListener('click', () => el.arq.click());
    el.imgNenhuma.addEventListener('click', semImagem);
    el.arq.addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (!/^image\/(png|jpeg)$/.test(f.type)) { ctx.toast('Escolha um arquivo PNG ou JPG.', 'erro'); return; }
      imagemTentada = true;
      await usarImagem(URL.createObjectURL(f)); // só no navegador: nada é enviado ao servidor
    });
    el.calibrar.addEventListener('click', iniciarCalibracao);
    el.origem.addEventListener('click', iniciarOrigem);
    el.calOk.addEventListener('click', aplicarCalibracao);
    el.calMm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); aplicarCalibracao(); } });
    el.salvar.addEventListener('click', salvar);
    el.remover.addEventListener('click', remover);

    // tabela de pontos (delegação): editar coordenada e botões por linha/polígono
    const alvoDe = elem => { const caixa = elem.closest('.pe-poli'); if (!caixa) return null; return caixa.dataset.tipo === 'contorno' ? { tipo: 'contorno' } : { tipo: 'vazado', i: Number(caixa.dataset.i) }; };
    el.tabelas.addEventListener('change', e => {
      const inp = e.target.closest('input[data-eixo]');
      if (!inp || somenteLeitura) return;
      const a = alvoDe(inp), idx = Number(inp.closest('tr').dataset.idx);
      const novo = T.editarCoordenada(estado, a, idx, inp.dataset.eixo, inp.value);
      if (!novo) { msg('Valor inválido. Use números em mm (ex.: 12,5).'); renderTudo(); return; }
      mudar(novo);
    });
    el.tabelas.addEventListener('click', e => {
      const bt = e.target.closest('button[data-acao]');
      const linha = e.target.closest('tr[data-idx]');
      const a = alvoDe(e.target);
      if (!bt) { if (linha && a) { sel = { alvo: a, idx: Number(linha.dataset.idx) }; renderTudo(); } return; }
      if (somenteLeitura || !a) return;
      const acao = bt.dataset.acao;
      if (acao === 'fechar') { const r = T.fecharPoligono(estado, a); if (r.aviso) msg(r.aviso); mudar(r.estado); }
      else if (acao === 'refazer') { sel = null; mudar(T.limparPoligono(estado, a)); }
      else if (acao === 'inserir') mudar(T.inserirDepois(estado, a, Number(linha.dataset.idx)));
      else if (acao === 'apagar') { sel = null; mudar(T.apagarPonto(estado, a, Number(linha.dataset.idx))); }
    });

    // configurações
    const marcar = () => { sujo = true; renderTudo(); };
    el.parede.addEventListener('change', () => {
      const v = T.lerMm(el.parede.value);
      if (!(v > 0)) { msg('Parede: informe um valor em mm maior que zero.'); el.parede.value = T.formatarMm(config.parede); return; }
      config.parede = v; config.estimada = config.estimada.filter(t => t !== 'parede'); marcar();
    });
    el.junta.addEventListener('change', () => { config.junta = el.junta.value === 'meia_esquadria' ? 'meia_esquadria' : 'reta'; config.estimada = config.estimada.filter(t => t !== 'junta'); marcar(); });
    el.usarCor.addEventListener('change', () => { config.corPadrao = el.usarCor.checked ? el.corPadrao.value : ''; marcar(); });
    el.corPadrao.addEventListener('input', () => { if (el.usarCor.checked) { config.corPadrao = el.corPadrao.value; sujo = true; renderTudo({ semCores: true }); } });
    [['x0', el.canalX0], ['x1', el.canalX1], ['y0', el.canalY0]].forEach(([k, inp]) => inp.addEventListener('change', () => {
      const novo = T.editarCanal(estado, k, inp.value);
      if (!novo) { msg('Valor inválido. Use números em mm.'); renderTudo(); return; }
      mudar(novo);
    }));
    el.cores.addEventListener('input', e => {
      const linha = e.target.closest('.pe-cor-linha'); if (!linha) return;
      const i = Number(linha.dataset.i), c = config.cores[i]; if (!c) return;
      if (e.target.classList.contains('pe-cor-nome')) c.nome = e.target.value; else c.cor = e.target.value;
      sujo = true;
      clearTimeout(coresTimer); coresTimer = setTimeout(() => renderTudo({ semCores: true }), 250);
    });
    el.cores.addEventListener('click', e => {
      const bt = e.target.closest('[data-acao="remover-cor"]'); if (!bt) return;
      config.cores.splice(Number(bt.closest('.pe-cor-linha').dataset.i), 1); marcar();
    });
    el.addCor.addEventListener('click', () => { config.cores.push({ nome: '', cor: config.corPadrao || T.COR_PADRAO_INICIAL }); marcar(); });
    el.addTodas.addEventListener('click', () => {
      const tem = new Set(config.cores.map(c => c.nome.trim().toUpperCase()));
      ((produto && produto.acabamentos) || []).forEach(n => { if (!tem.has(n.toUpperCase())) config.cores.push({ nome: n, cor: config.corPadrao || T.COR_PADRAO_INICIAL }); });
      marcar();
    });
    el.estimada.addEventListener('click', e => { const bt = e.target.closest('[data-acao="conferido"]'); if (!bt) return; config.estimada.splice(Number(bt.dataset.i), 1); marcar(); });
    el.prevAcab.addEventListener('change', agendarPrevia);
    // o traçador manual fica recolhido (desenho automático é o caminho principal); ao abrir, ajusta o canvas ao tamanho real
    el.manual.addEventListener('toggle', () => { if (el.manual.open) setTimeout(() => { ajustarVista(); renderTudo(); }, 0); });

    // troca de aba da ficha
    document.querySelectorAll('.aba').forEach(a => a.addEventListener('click', () => { if (a.dataset.aba === 'desenho3d') aoAtivarAba(); else aoSairAba(); }));
  }

  function prepararCampos() { /* campos fixos já existem no HTML; nada a montar */ }

  const IDS = {
    aviso: 'pe-aviso', corpo: 'pe-corpo', canvas: 'pe-canvas', palco: 'pe-palco', dica: 'pe-dica', msg: 'pe-msg', coord: 'pe-coord', info: 'pe-info', sujo: 'pe-sujo',
    imgProduto: 'pe-img-produto', imgArquivo: 'pe-img-arquivo', imgNenhuma: 'pe-img-nenhuma', arq: 'pe-arq',
    calibrar: 'pe-calibrar', origem: 'pe-origem', calBox: 'pe-cal-box', calMm: 'pe-cal-mm', calOk: 'pe-cal-ok',
    ima: 'pe-ima', desfazer: 'pe-desfazer', refazer: 'pe-refazer', fechar: 'pe-fechar', novoVazado: 'pe-novo-vazado', apagar: 'pe-apagar', encostar: 'pe-encostar',
    zoomMais: 'pe-zoom-mais', zoomMenos: 'pe-zoom-menos', ajustar: 'pe-ajustar',
    tabelas: 'pe-tabelas', largura: 'pe-largura', altura: 'pe-altura', parede: 'pe-parede', paredeErro: 'pe-parede-erro', junta: 'pe-junta',
    usarCor: 'pe-usar-cor', corPadrao: 'pe-cor-padrao', canalX0: 'pe-canal-x0', canalX1: 'pe-canal-x1', canalY0: 'pe-canal-y0', limparCanalBtn: 'pe-canal-limpar', canalErro: 'pe-canal-erro',
    cores: 'pe-cores', addCor: 'pe-add-cor', addTodas: 'pe-add-todas', listaAcab: 'pe-lista-acab', estimada: 'pe-estimada', estimadaBox: 'pe-estimada-box',
    manual: 'pe-manual', cena: 'pe-cena', prevAcab: 'pe-prev-acab', prevStatus: 'pe-prev-status', erros: 'pe-erros', erroApi: 'pe-erro-api', salvar: 'pe-salvar', remover: 'pe-remover'
  };

  function iniciar(contexto) {
    if (ctx || !T) return;
    ctx = contexto;
    for (const k of Object.keys(IDS)) {
      el[k] = $(IDS[k]);
      if (!el[k]) { console.error('PerfilEditor: elemento ausente no HTML:', IDS[k]); ctx = null; return; }
    }
    el.junta.textContent = '';
    Object.keys(ROTULO_JUNTA).forEach(k => el.junta.appendChild(h('option', { value: k, texto: ROTULO_JUNTA[k] })));
    lerPaleta();
    reiniciarEditor();
    ligarEventos();
    aviso('Abra um produto da classe Perfil para cadastrar o desenho.');
  }

  // ----------------------------------------------------------------------------------------------------------------
  // desenho automático (perfil_auto.js): carrega a PROPOSTA no editor (ainda não salva) e deixa salvar / ajustar à mão
  // ----------------------------------------------------------------------------------------------------------------
  // secao: seção v2 em mm. opcoes: { blob (a imagem lida), calibracao: { mmPorPx, origem:{px,py} } (para o traçador manual aparecer sobre a imagem) }
  async function carregarProposta(secao, opcoes) {
    if (!ctx || somenteLeitura || !produto || !carregado || !secao) return false;
    estado = T.estadoDaSecao(secao);
    config = T.configDaSecao(secao);
    hist = T.criarHistorico(estado);
    sujo = true; sel = null; modo = 'contorno'; calEtapa = null; calP1 = calP2 = null;
    el.erroApi.hidden = true;
    const o = opcoes || {};
    if (o.blob) await usarImagem(URL.createObjectURL(o.blob));
    if (img && o.calibracao && T.calibracaoCompleta(o.calibracao)) { cal = { mmPorPx: o.calibracao.mmPorPx, origem: { px: o.calibracao.origem.px, py: o.calibracao.origem.py } }; }
    imagemTentada = true;
    ajustarVista();
    renderTudo();
    return true;
  }
  // a pergunta "corte a 45° ou reto?" da conferência; escolher tira a marca de estimado da junta
  function definirJunta(junta) {
    if (somenteLeitura || !estado || (junta !== 'reta' && junta !== 'meia_esquadria')) return false;
    config.junta = junta;
    config.estimada = config.estimada.filter(t => t !== 'junta');
    sujo = true;
    renderTudo();
    return true;
  }
  const juntaAtual = () => (config ? config.junta : 'reta');
  const abrirManual = () => { if (el.manual) { el.manual.open = true; el.manual.scrollIntoView?.({ block: 'start' }); } };

  return { iniciar, produtoMudou, temAlteracao, carregarProposta, definirJunta, juntaAtual, salvar, abrirManual };
});
