// ==========================================================================
// etiquetas_qr.html — impressão de etiquetas com o QR do código de barras dos itens de estoque.
// Rota: GET /estoque/etiquetas ({ itens: [{ codigo, produto, unidade, codBarras }], semCodigo }).
// Funções puras (testadas no Node, test/etiquetas_qr_tela.test.js) e, no fim, o desenho da tela (só no navegador).
// O QR é desenhado com createElementNS (um único <path> com um segmento por módulo escuro, via isDark da biblioteca vendor/qrcode.js); nada de HTML montado em texto.
// Dado da API só entra na tela por textContent. Nenhum valor em dinheiro passa por aqui.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.EtiquetasQr = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : (typeof self !== 'undefined' ? self : this).EntregasComum;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ============ LÓGICA PURA ============
  const norm = t => String(t == null ? '' : t).trim().toLowerCase();

  // nome ou código de barras contém o texto, sem diferenciar caixa
  function filtrarItens(itens, busca) {
    const b = norm(busca);
    if (!b) return itens.slice();
    return itens.filter(i => norm(i.produto).includes(b) || norm(i.codBarras).includes(b));
  }

  function dividirEmFolhas(itens, porFolha = 12) {
    const n = Math.max(1, Math.floor(Number(porFolha) || 12));
    const folhas = [];
    for (let i = 0; i < itens.length; i += n) folhas.push(itens.slice(i, i + n));
    return folhas;
  }

  const textoDoQr = item => item.codBarras;

  // ============ NAVEGADOR ============
  function desenharQr(doc, qrcode, texto) {
    // o padrão da biblioteca codifica com "c & 0xff", mas o jsQR (leitor) decodifica UTF-8: sem isto, código com acento nunca é lido
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    const borda = 2;   // zona de silêncio, em módulos
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n + borda * 2} ${n + borda * 2}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('class', 'qr');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR ' + texto);
    const fundo = doc.createElementNS(SVG_NS, 'rect');
    fundo.setAttribute('width', n + borda * 2); fundo.setAttribute('height', n + borda * 2); fundo.setAttribute('class', 'qr-fundo');
    svg.appendChild(fundo);
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += 'M' + (c + borda) + ' ' + (r + borda) + 'h1v1h-1z';
      }
    }
    const caminho = doc.createElementNS(SVG_NS, 'path');
    caminho.setAttribute('d', d);
    caminho.setAttribute('class', 'qr-modulo');
    svg.appendChild(caminho);
    return svg;
  }

  // devolve texto -> nó do QR: desenha uma vez por código (cache) e entrega um clone; falha de um item vira "QR indisponível"
  function criarFabricaQr(doc, qrcode) {
    const cache = new Map();
    return function (texto) {
      try {
        if (!cache.has(texto)) cache.set(texto, desenharQr(doc, qrcode, texto));
        return cache.get(texto).cloneNode(true);
      } catch {
        const aviso = doc.createElement('div');
        aviso.className = 'qr-erro';
        aviso.textContent = 'QR indisponível';
        return aviso;
      }
    };
  }

  function iniciar(win) {
    if (win.Acesso && !win.Acesso.paginaLiberada()) return;   // sem permissão: o layout.js já mostrou "Sem acesso"
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const { chamar } = C.criarApi(win);
    const marcados = new Set();
    let itens = [], semCodigo = 0, busca = '', fabrica = null;

    function el(tag, classe, texto) {
      const x = doc.createElement(tag);
      if (classe) x.className = classe;
      if (texto !== undefined) x.textContent = texto;
      return x;
    }

    function desenharLista() {
      const lista = $('lista');
      lista.replaceChildren();
      const vis = filtrarItens(itens, busca);
      vis.forEach(i => {
        const lab = el('label', 'linha-item');
        const cb = doc.createElement('input');
        cb.type = 'checkbox'; cb.checked = marcados.has(i.codigo);
        cb.addEventListener('change', () => { if (cb.checked) marcados.add(i.codigo); else marcados.delete(i.codigo); desenharFolhas(); });
        lab.appendChild(cb);
        lab.appendChild(el('span', 'nome', i.produto));
        lab.appendChild(el('span', 'cod', i.codBarras));
        lista.appendChild(lab);
      });
      $('vazio').hidden = vis.length > 0;
      $('marcar-todos').checked = vis.length > 0 && vis.every(i => marcados.has(i.codigo));
    }   // não redesenha as folhas: a seleção não muda ao filtrar a lista

    function desenharFolhas() {
      const area = $('folhas');
      area.replaceChildren();
      const sel = itens.filter(i => marcados.has(i.codigo));
      $('contagem').textContent = sel.length + ' etiqueta(s) selecionada(s)';
      $('btn-imprimir').disabled = sel.length === 0;
      const qrcode = win.qrcode;
      const fabricaQr = typeof qrcode === 'function' ? (fabrica || (fabrica = criarFabricaQr(doc, qrcode))) : null;
      dividirEmFolhas(sel, 12).forEach(folha => {
        const f = el('section', 'folha');
        folha.forEach(i => {
          const et = el('div', 'etiqueta');
          if (fabricaQr) et.appendChild(fabricaQr(textoDoQr(i)));
          et.appendChild(el('div', 'et-nome', i.produto));
          et.appendChild(el('div', 'et-cod', i.codBarras));
          f.appendChild(et);
        });
        area.appendChild(f);
      });
    }

    $('busca').addEventListener('input', ev => { busca = ev.target.value; desenharLista(); });
    $('marcar-todos').addEventListener('change', ev => {
      filtrarItens(itens, busca).forEach(i => { if (ev.target.checked) marcados.add(i.codigo); else marcados.delete(i.codigo); });
      desenharLista();
      desenharFolhas();
    });
    $('btn-imprimir').addEventListener('click', () => win.print());

    (async () => {
      try {
        const r = await chamar('/estoque/etiquetas');
        itens = Array.isArray(r.itens) ? r.itens : [];
        semCodigo = Number(r.semCodigo) || 0;
        if (semCodigo > 0) {
          $('aviso-sem-codigo').textContent = `${semCodigo} item(ns) sem código de barras: cadastre em Estoque`;
          $('aviso-sem-codigo').hidden = false;
        }
        if (typeof win.qrcode !== 'function') $('msg').textContent = 'Biblioteca de QR não carregada.';
        desenharLista();
        desenharFolhas();
      } catch (err) {
        $('msg').textContent = err && err.message ? err.message : 'Erro ao carregar os itens.';
      }
    })();
  }

  return { filtrarItens, dividirEmFolhas, textoDoQr, desenharQr, criarFabricaQr, iniciar };
});
