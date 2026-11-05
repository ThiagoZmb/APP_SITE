// ==========================================================================
// Desenho AUTOMÁTICO do perfil a partir de uma imagem (topo da aba "Desenho 3D" de produtos.html).
// Três passos: (1) imagem do perfil (a do produto ou uma enviada), (2) "Gerar desenho automaticamente" (POST /perfil_secoes/:codigo/ler_imagem),
// (3) conferir: a imagem com o contorno/vazados/canal desenhados por cima, cotas lidas x desenho gerado, avisos, confiança e a pergunta da junta.
// "Aceitar e salvar" usa o salvar do editor (PUT /perfil_secoes/:codigo); "Tentar de novo" lê outra vez; "Ajustar manualmente" abre o
// traçador do perfil_editor.js já carregado com a proposta. A rota só PROPÕE: nada é gravado antes de "Aceitar e salvar".
// A imagem enviada é lida pelo servidor e descartada (não fica guardada). Sem innerHTML com dado vindo da API; cores do canvas vêm do tema.
// As funções puras (rótulos, linhas de cotas, estado dos botões) são testadas no Node; o resto só se vê no navegador.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.PerfilAuto = lib;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';

  const MAX_BYTES = 3 * 1024 * 1024;
  const TIPOS = ['image/png', 'image/jpeg'];

  // ----------------------------------------------------------------------------------------------------------------
  // funções puras
  // ----------------------------------------------------------------------------------------------------------------
  const fmtMm = v => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '—');

  function validarArquivo(arq) {
    if (!arq) return 'Escolha um arquivo.';
    if (!TIPOS.includes(arq.type)) return 'Escolha uma imagem PNG ou JPEG.';
    if (arq.size > MAX_BYTES) return 'A imagem passa de 3 MB. Reduza o tamanho e tente de novo.';
    if (arq.size <= 0) return 'O arquivo está vazio.';
    return '';
  }
  function rotuloConfianca(c) {
    if (!c || typeof c.valor !== 'number') return { texto: '', nivel: 'media' };
    const nome = { alta: 'alta', media: 'média', baixa: 'baixa' }[c.nivel] || 'média';
    return { texto: `Confiança da leitura: ${nome} (${Math.round(c.valor * 100)}%)`, nivel: ['alta', 'media', 'baixa'].includes(c.nivel) ? c.nivel : 'media' };
  }
  // linhas da tabela "cotas lidas x desenho gerado": verde se bate, âmbar se difere
  function linhasCotas(cotas) {
    return (Array.isArray(cotas) ? cotas : []).map(c => ({
      lida: `${c.texto || fmtMm(c.valor)} mm`,
      desenho: c.desenho === null || c.desenho === undefined ? '—' : `${fmtMm(c.desenho)} mm`,
      bate: !!c.bate,
      classe: c.bate ? 'bate' : 'difere',
      resultado: c.bate ? '✓ bate' : (c.desenho === null || c.desenho === undefined ? '⚠ não achei no desenho' : `⚠ difere ${fmtMm(Math.abs(c.desenho - c.valor))} mm`)
    }));
  }
  // o que cada controle deve fazer agora
  function estadoControles(e) {
    const editor = !!e.podeEditar, lendo = !!e.lendo;
    return {
      gerar: editor && !lendo && !!e.temImagem && e.disponivel !== false,
      escolher: editor && !lendo,
      conferir: !!e.temProposta,
      aceitar: editor && !lendo && !!e.temProposta,
      tentar: editor && !lendo && !!e.temProposta && !!e.temImagem,
      junta: editor && !!e.temProposta,
    };
  }
  // erro da API -> { titulo, itens[], achado }. 422 traz os motivos e o que foi achado.
  function mensagemErro(e) {
    const d = (e && e.dados) || {};
    const itens = Array.isArray(d.erros) ? d.erros.map(String).slice(0, 6) : [];
    let achado = '';
    if (d.achado) {
      const a = d.achado;
      achado = `O que a leitura achou: contorno com ${a.contornoPontos} ponto(s), ${a.vazados} vazado(s), ${(a.cotas || []).length} cota(s)${a.canalVidro ? ' e o canal do vidro' : ', sem canal do vidro'}.`;
    }
    const titulo = e && e.status === 422 && itens.length ? 'A leitura não resultou num desenho válido. Nada foi salvo.' : String((e && e.message) || 'Não foi possível ler a imagem.');
    return { titulo, itens, achado };
  }
  const DICAS = 'Dicas: envie só a seção transversal (o corte), limpa, com as cotas legíveis e em alta resolução; evite fotos inclinadas e imagens com muita coisa ao redor.';

  // ----------------------------------------------------------------------------------------------------------------
  // tela
  // ----------------------------------------------------------------------------------------------------------------
  let ctx = null, ed = null;
  let el = {};
  let produto = null;
  let imagem = null;            // { blob, tipo, origem:'produto'|'arquivo', url, el: HTMLImageElement|null }
  let proposta = null;
  let lendo = false, tempo = 0, relogio = 0, disponivel = true, juntaConfirmada = false, codigoImagem = null, tokenImg = 0;

  const $ = id => document.getElementById(id);
  function h(tag, attrs, ...filhos) {
    const e = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) continue;
      if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos) if (f) e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
    return e;
  }
  const podeEditar = () => !!(ctx && ctx.pode('perfis.desenho'));

  function atualizarControles() {
    if (!el.gerar) return;
    const s = estadoControles({ podeEditar: podeEditar(), lendo, temImagem: !!imagem, disponivel, temProposta: !!proposta });
    el.gerar.disabled = !s.gerar;
    el.usarProduto.disabled = !s.escolher || !(produto && produto.salvo && produto.temImagem);
    el.enviar.disabled = !s.escolher;
    el.passo3.hidden = !s.conferir;
    el.aceitar.disabled = !s.aceitar;
    el.tentar.disabled = !s.tentar;
    el.progresso.hidden = !lendo;
    el.junta45.disabled = el.juntaReta.disabled = !s.junta;
  }

  function soltarImagem() {
    if (imagem && imagem.url) URL.revokeObjectURL(imagem.url);
    imagem = null;
    el.mini.hidden = true; el.mini.removeAttribute('src'); el.miniVazio.hidden = false;
  }
  function limparResultado() {
    proposta = null; juntaConfirmada = false;
    el.erro.hidden = true; el.erro.textContent = '';
    atualizarControles();
  }
  function mostrarImagem(blob, tipo, origem) {
    if (imagem && imagem.url) URL.revokeObjectURL(imagem.url);
    const url = URL.createObjectURL(blob);
    imagem = { blob, tipo, origem, url, el: null };
    el.mini.onload = () => { imagem && imagem.url === url && (imagem.el = el.mini); };
    el.mini.onerror = () => { if (imagem && imagem.url === url) { soltarImagem(); erro({ titulo: 'Não foi possível exibir esta imagem (use PNG ou JPEG).', itens: [], achado: '' }); atualizarControles(); } };
    el.mini.src = url; el.mini.hidden = false; el.miniVazio.hidden = true;
    limparResultado();
  }
  function erro(m) {
    el.erro.textContent = '';
    el.erro.hidden = !m;
    if (!m) return;
    el.erro.appendChild(h('b', { texto: m.titulo }));
    if (m.itens && m.itens.length) { const ul = h('ul'); m.itens.forEach(t => ul.appendChild(h('li', { texto: t }))); el.erro.appendChild(ul); }
    if (m.achado) el.erro.appendChild(h('p', { classe: 'dica', texto: m.achado }));
    el.erro.appendChild(h('p', { classe: 'dica', texto: DICAS }));
  }

  async function carregarImagemDoProduto(silencioso) {
    if (!produto || !produto.salvo || !produto.temImagem || !podeEditar()) return false;
    const tk = ++tokenImg;
    try {
      const blob = await ctx.api('/produtos/imagem/' + encodeURIComponent(produto.codigo), {}, true);
      if (tk !== tokenImg) return false;
      codigoImagem = produto.codigo;
      mostrarImagem(blob, blob.type || 'image/jpeg', 'produto');
      atualizarControles();
      return true;
    } catch (e) { if (!silencioso) ctx.toast('Não foi possível carregar a imagem do produto: ' + e.message, 'erro'); return false; }
  }
  function usarArquivo(arq) {
    const msg = validarArquivo(arq);
    if (msg) { ctx.toast(msg, 'erro'); return; }
    tokenImg++;
    mostrarImagem(arq, arq.type, 'arquivo');
    atualizarControles();
  }

  // ---------- gerar ----------
  async function gerar(semConfirmar) {
    if (lendo || !imagem || !produto || !podeEditar()) return;
    if (semConfirmar !== true && ed && ed.temAlteracao() && !(await ctx.confirmar('Substituir o desenho em edição?', 'Há alterações não salvas no desenho. O desenho gerado vai substituí-las.'))) return;
    erro(null);
    proposta = null;
    lendo = true; tempo = 0;
    el.progTxt.textContent = 'Enviando a imagem…';
    relogio = setInterval(() => { tempo++; el.progTxt.textContent = `Lendo a imagem e montando o desenho… ${tempo} s. Costuma levar de 20 a 60 segundos; não feche esta página.`; }, 1000);
    atualizarControles();
    const origem = imagem;
    try {
      const opts = origem.origem === 'arquivo' ? { method: 'POST', body: origem.blob, headers: { 'Content-Type': origem.tipo } } : { method: 'POST' };
      const r = await ctx.api('/perfil_secoes/' + encodeURIComponent(produto.codigo) + '/ler_imagem', opts);
      if (!r || !r.secao) throw new Error('Resposta inesperada do servidor.');
      proposta = r;
      juntaConfirmada = !(r.secao.estimada || []).includes('junta');
      await ed.carregarProposta(r.secao, { blob: origem.blob, calibracao: r.calibracao });
      renderConferencia();
      ctx.toast('Desenho gerado. Confira antes de salvar.', 'ok');
    } catch (e) {
      erro(mensagemErro(e));
    } finally {
      clearInterval(relogio); relogio = 0; lendo = false;
      atualizarControles();
      if (proposta && el.passo3.scrollIntoView) el.passo3.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---------- conferência ----------
  function paleta() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim() || 'white';
    return { contorno: v('--primary-color'), vazado: v('--info-color'), ok: v('--success-color'), aviso: v('--warning-color'), texto: v('--text-dark'), fundo: v('--bg') };
  }
  function desenharSobreposicao() {
    if (!proposta || !imagem || !el.mini.naturalWidth) return;
    const src = el.mini, W = proposta.imagem.largura, H = proposta.imagem.altura;
    const cw = Math.min(1400, Math.max(400, src.naturalWidth));
    const f = cw / W;
    const cv = el.canvas; cv.width = Math.round(cw); cv.height = Math.round(H * f);
    const c = cv.getContext('2d'), P = paleta();
    c.fillStyle = P.fundo; c.fillRect(0, 0, cv.width, cv.height);
    c.drawImage(src, 0, 0, cv.width, cv.height);
    const lw = Math.max(2, cw / 450);
    const poli = (pts, cor) => {
      if (!pts || !pts.length) return;
      c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0] * f, p[1] * f) : c.moveTo(p[0] * f, p[1] * f))); c.closePath();
      c.save(); c.globalAlpha = 0.22; c.fillStyle = cor; c.fill(); c.restore();
      c.strokeStyle = cor; c.lineWidth = lw; c.stroke();
      pts.forEach(p => { c.beginPath(); c.arc(p[0] * f, p[1] * f, lw * 1.6, 0, Math.PI * 2); c.fillStyle = cor; c.fill(); });
    };
    const s = proposta.sobreposicao || {};
    poli(s.contorno, P.contorno);
    (s.vazados || []).forEach(v => poli(v, P.vazado));
    if (s.canal) { // faixa do canal do vidro (tracejada)
      c.save(); c.setLineDash([lw * 3, lw * 2]); c.strokeStyle = P.ok; c.lineWidth = lw;
      c.strokeRect(s.canal.x0 * f, s.canal.y0 * f, (s.canal.x1 - s.canal.x0) * f, (s.canal.y1 - s.canal.y0) * f); c.restore();
    }
    c.font = `${Math.max(12, Math.round(cw / 70))}px sans-serif`;
    (s.cotas || []).forEach(k => {
      const cor = k.bate ? P.ok : P.aviso;
      c.strokeStyle = cor; c.lineWidth = lw; c.beginPath(); c.moveTo(k.p1[0] * f, k.p1[1] * f); c.lineTo(k.p2[0] * f, k.p2[1] * f); c.stroke();
      [k.p1, k.p2].forEach(p => { c.beginPath(); c.arc(p[0] * f, p[1] * f, lw * 1.4, 0, Math.PI * 2); c.fillStyle = cor; c.fill(); });
      c.fillStyle = cor; c.fillText(String(k.texto), ((k.p1[0] + k.p2[0]) / 2) * f + 6, ((k.p1[1] + k.p2[1]) / 2) * f - 4);
    });
  }
  function renderConferencia() {
    if (!proposta) return;
    const conf = rotuloConfianca(proposta.confianca);
    el.selo.textContent = conf.texto; el.selo.className = 'pa-selo ' + conf.nivel;
    const corpo = el.cotas.querySelector('tbody'); corpo.textContent = '';
    const linhas = linhasCotas(proposta.cotasLidas);
    linhas.forEach(l => corpo.appendChild(h('tr', { classe: l.classe }, h('td', { texto: l.lida }), h('td', { classe: 'num', texto: l.desenho }), h('td', { texto: l.resultado }))));
    if (!linhas.length) corpo.appendChild(h('tr', null, h('td', { colspan: '3', texto: 'Nenhuma cota lida.' })));
    el.avisos.textContent = '';
    const avisos = (proposta.avisos || []).concat(proposta.observacoes ? ['Observação da leitura: ' + proposta.observacoes] : []);
    avisos.forEach(a => el.avisos.appendChild(h('li', { texto: a })));
    el.avisosBox.hidden = !avisos.length;
    renderJunta();
    atualizarControles();
    // a imagem precisa estar decodificada para o canvas
    if (el.mini.complete && el.mini.naturalWidth) desenharSobreposicao(); else el.mini.addEventListener('load', desenharSobreposicao, { once: true });
  }
  function renderJunta() {
    const atual = ed ? ed.juntaAtual() : 'reta';
    el.junta45.classList.toggle('ativo', juntaConfirmada && atual === 'meia_esquadria');
    el.juntaReta.classList.toggle('ativo', juntaConfirmada && atual === 'reta');
    el.juntaBox.classList.toggle('definida', juntaConfirmada);
    el.juntaDica.textContent = juntaConfirmada ? 'Junta definida. Você pode mudar enquanto não salvar.' : 'A imagem raramente mostra como as peças se encontram nos cantos: confirme. Enquanto não escolher, vale corte reto.';
  }
  function escolherJunta(j) {
    if (!ed || !ed.definirJunta(j)) return;
    juntaConfirmada = true;
    renderJunta();
  }

  async function aceitar() {
    if (!proposta || lendo) return;
    if (!juntaConfirmada && !(await ctx.confirmar('Salvar com a junta sem confirmar?', 'A leitura da imagem não sabe se o corte é a 45° ou reto: o desenho vai com junta reta. Se não tiver certeza, volte e escolha. Salvar assim mesmo?'))) return;
    el.aceitar.disabled = true;
    const ok = await ed.salvar();
    if (ok) { limparResultado(); ctx.toast('Desenho aceito e salvo.', 'ok'); }
    else atualizarControles();
  }
  async function tentarDeNovo() { limparResultado(); await gerar(true); }   // já houve confirmação ao gerar a primeira vez

  // ---------- eventos ----------
  const IDS = {
    raiz: 'pa-raiz', indisponivel: 'pa-indisponivel', mini: 'pa-mini', miniVazio: 'pa-mini-vazio', usarProduto: 'pa-usar-produto', enviar: 'pa-enviar', arq: 'pa-arq', solta: 'pa-solta',
    gerar: 'pa-gerar', progresso: 'pa-progresso', progTxt: 'pa-prog-txt', erro: 'pa-erro', passo3: 'pa-passo3', canvas: 'pa-canvas', selo: 'pa-selo', cotas: 'pa-cotas',
    avisosBox: 'pa-avisos-box', avisos: 'pa-avisos', juntaBox: 'pa-junta-box', juntaDica: 'pa-junta-dica', junta45: 'pa-junta-45', juntaReta: 'pa-junta-reta',
    aceitar: 'pa-aceitar', tentar: 'pa-tentar', ajustar: 'pa-ajustar'
  };
  function ligarEventos() {
    el.usarProduto.addEventListener('click', () => carregarImagemDoProduto(false));
    el.enviar.addEventListener('click', () => el.arq.click());
    el.arq.addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) usarArquivo(f); });
    el.solta.addEventListener('click', () => { if (!el.enviar.disabled) el.arq.click(); });
    el.solta.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !el.enviar.disabled) { e.preventDefault(); el.arq.click(); } });
    ['dragenter', 'dragover'].forEach(n => el.solta.addEventListener(n, e => { e.preventDefault(); el.solta.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(n => el.solta.addEventListener(n, e => { e.preventDefault(); el.solta.classList.remove('sobre'); }));
    el.solta.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f && !el.enviar.disabled) usarArquivo(f); });
    el.gerar.addEventListener('click', () => gerar());
    el.aceitar.addEventListener('click', aceitar);
    el.tentar.addEventListener('click', tentarDeNovo);
    el.ajustar.addEventListener('click', () => { if (ed) ed.abrirManual(); });
    el.junta45.addEventListener('click', () => escolherJunta('meia_esquadria'));
    el.juntaReta.addEventListener('click', () => escolherJunta('reta'));
    // ao abrir a aba: carrega a imagem do produto (uma vez por produto) e confere se a leitura está liberada no servidor
    document.querySelectorAll('.aba').forEach(a => a.addEventListener('click', () => { if (a.dataset.aba === 'desenho3d') aoAtivarAba(); }));
  }
  async function aoAtivarAba() {
    if (!ctx || !produto || !podeEditar()) return;
    if (!imagem && codigoImagem !== produto.codigo) carregarImagemDoProduto(true);
    try {
      const d = await ctx.api('/perfil_secoes/leitura_imagem/disponivel');
      disponivel = !!d.disponivel;
      el.indisponivel.textContent = disponivel ? '' : (d.mensagem || 'Leitura de imagem não configurada no servidor.') + ' Use “Ajustar manualmente” para desenhar à mão.';
      el.indisponivel.hidden = disponivel;
    } catch (_) { /* sem resposta: deixa tentar; o erro aparece ao gerar */ }
    atualizarControles();
  }

  function produtoMudou(info) {
    if (!ctx) return;
    const outro = !produto || produto.codigo !== info.codigo || info.recarregar;
    produto = info;
    if (outro) {
      tokenImg++; codigoImagem = null;
      soltarImagem(); limparResultado();
    }
    atualizarControles();
    if (outro && info.salvo && info.classeSalva === 'Perfil' && podeAba()) aoAtivarAba();
  }
  const podeAba = () => { const a = document.querySelector('.aba.ativa'); return !!a && a.dataset.aba === 'desenho3d'; };

  function iniciar(contexto) {
    if (ctx) return;
    ctx = contexto; ed = contexto.editor;
    for (const k of Object.keys(IDS)) {
      el[k] = $(IDS[k]);
      if (!el[k]) { console.error('PerfilAuto: elemento ausente no HTML:', IDS[k]); ctx = null; return; }
    }
    ligarEventos();
    atualizarControles();
  }

  return { iniciar, produtoMudou, validarArquivo, rotuloConfianca, linhasCotas, estadoControles, mensagemErro, MAX_BYTES, TIPOS, DICAS };
});
