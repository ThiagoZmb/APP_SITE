// ==========================================================================
// Visualizador 3D da porta (somente leitura) para orcamentos.html.
// Duas partes:
//  1) PURA (sem DOM, testada no Node em test/desenho3d.test.js): montarCaixas(geo) calcula, em mm,
//     as caixas (perfis, vidro, divisores, puxadores, trilhos) e os furos; posicaoCamera/distanciaEnquadrar
//     calculam a câmera. As regras de medida espelham o desenho 2D (desenharVisualizacao em orcamentos.html);
//     quem lê o formulário é geometria3D() lá, o mesmo estado que o 2D usa.
//  2) NAVEGADOR: criar(container, opcoes) monta a cena Three.js (carregada sob demanda, com SRI) e controles
//     próprios de girar/zoom (mouse e toque). Não grava nada, não toca no 2D, no PNG do PDF nem no rascunho.
// Eixos da cena: x = direita, y = para cima (base da porta em y = 0), z = para o observador. Unidade: mm.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Desenho3D = lib;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';

  // seções transversais dos perfis (calculo/perfil_secoes.js): require no Node, global PerfilSecoes no navegador
  let SECOES = raiz.PerfilSecoes || null;
  if (!SECOES && typeof require === 'function') { try { SECOES = require('./calculo/perfil_secoes.js'); } catch (_) { SECOES = null; } }

  // ----- constantes (as mesmas do 2D quando existem lá) -----
  const PERFIL_MM = 45;          // largura do perfil (fixa no 2D)
  const DIVISOR_MM = 15;         // espessura do divisor (2D)
  const FURO_DIAM_MM = 35;       // diâmetro do furo (2D)
  const TRILHO_MM = 60, FOLGA_MM = 45; // trilho e folga do correr com sistema (2D)
  const PUX_TAM_PADRAO_MM = 120; // 2D: tamanho do puxador quando o campo está vazio
  const ESP_PORTA_MM = 40;       // ESPESSURA da porta: o 2D não tem profundidade; valor só visual do 3D
  const ESP_VIDRO_MM = 4;        // regra do dono: vidro SEMPRE com 4 mm
  const SALIENCIA_PUX_MM = 18;   // quanto o puxador sobreposto/total sai de cada face (só visual)
  const AFASTO_CORRER_MM = 22;   // folhas de correr em trilhos diferentes: afastamento em z (só visual)

  const CORES = { perfil: '#c3c8cd', puxador: '#2b2f33', vidro: '#eaf4fb', furo: '#1f2d2d', trilho: '#5f6670', contorno: '#6b7178' };
  const OPACIDADE_VIDRO = 0.45;

  const VISTAS = {
    frontal: { az: 0, el: 0 },
    perspectiva: { az: 35, el: 18 }
  };

  // bibliotecas externas: versão exata + SRI (hash sha384 do arquivo baixado do jsDelivr)
  const BIBLIOTECAS = {
    three: {
      url: 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js',
      integrity: 'sha384-RRHfJ6w1mTlKUBMYT/hvnRiOzEB/vyRV3DrQOseb6oYfvaZSfdd0byS4bHps0k2R'
    }
  };

  const num = (v, pad = 0) => { const n = Number(v); return Number.isFinite(n) ? n : pad; };
  const rad = g => g * Math.PI / 180;

  // ----------------------------------------------------------------------
  // PARTE PURA
  // ----------------------------------------------------------------------

  // Comprimento do puxador (2D: comp): total ou tamanho >= lado = lado inteiro; senão o tamanho, com piso de 28 mm ou 10% do lado
  function comprimentoPuxador(tam, lado, total) {
    if (total || tam >= lado) return lado;
    return Math.min(Math.max(tam, Math.max(28, lado * 0.1)), lado);
  }

  // Espessura do puxador no plano da folha (2D: esp, em mm, sem o piso de pixels)
  function espessuraPuxador(tipo) {
    const emb = tipo === 'embutido', sob = tipo === 'sobreposto';
    const e = emb ? Math.max(2.5, PERFIL_MM * 0.28) : sob ? Math.max(4, PERFIL_MM * 0.36) : Math.max(3.5, PERFIL_MM * 0.34);
    return Math.min(e, PERFIL_MM * 0.55);
  }

  // Retângulo do puxador na folha, em mm com origem no canto SUPERIOR ESQUERDO da folha e y para baixo (como no 2D):
  // devolve [x, y, w, h] ou null se o nome não for reconhecido. Mesma regra do geo() do 2D.
  function retanguloPuxador(nome, L, H, esp, recuo, tam) {
    const u = String(nome || '').toUpperCase();
    const total = u.includes('TOTAL');
    if (u.startsWith('LATERAL')) {
      const compV = comprimentoPuxador(tam, H, total);
      const x = u.includes('ESQUERD') ? -recuo : L - esp + recuo;
      if (total) return [x, 0, esp, H];
      const y = u.includes('SUPERIOR') ? 0 : u.includes('INFERIOR') ? H - compV : (H - compV) / 2;
      return [x, y, esp, compV];
    }
    if (u.startsWith('TOPO') || u.startsWith('BASE')) {
      const compH = comprimentoPuxador(tam, L, total);
      const y = u.startsWith('TOPO') ? -recuo : H - esp + recuo;
      if (total) return [0, y, L, esp];
      const x = u.includes('ESQUERD') ? 0 : u.includes('DIREIT') ? L - compH : (L - compH) / 2;
      return [x, y, compH, esp];
    }
    return null;
  }

  // Valida e normaliza o objeto de geometria. Devolve { ok, motivo, geo }.
  function normalizarGeometria(geo) {
    if (!geo || typeof geo !== 'object') return { ok: false, motivo: 'sem geometria' };
    const altura = num(geo.altura), largura = num(geo.largura);
    if (!(altura > 0) || !(largura > 0)) return { ok: false, motivo: 'informe altura e largura' };
    const folhas = (Array.isArray(geo.folhas) && geo.folhas.length ? geo.folhas : [{}]).map(f => ({
      largura: num(f && f.largura) > 0 ? num(f.largura) : largura,
      posicoes: Array.isArray(f && f.posicoes) ? f.posicoes.map(p => String(p).toUpperCase()) : [],
      puxadorTotal: !!(f && f.puxadorTotal),
      ladoFuro: String((f && f.ladoFuro) || '')
    }));
    const pux = geo.puxador || {};
    const furos = geo.furos || {};
    return {
      ok: true,
      geo: {
        perfil: String(geo.perfil || ''),
        secao: geo.secao && typeof geo.secao === 'object' ? geo.secao : null, // injeção direta (teste/futuro traçador); senão busca pelo perfil
        correr: !!geo.correr,
        altura, largura,
        folhas,
        gap: Math.max(0, num(geo.gap)),
        sobraVao: Math.max(0, num(geo.sobraVao)),
        divH: Math.max(0, Math.floor(num(geo.divH))),
        divV: Math.max(0, Math.floor(num(geo.divV))),
        puxador: {
          tem: !!pux.tem,
          tipo: pux.tipo === 'embutido' || pux.tipo === 'sobreposto' ? pux.tipo : 'outro',
          tamanho: num(pux.tamanho) > 0 ? num(pux.tamanho) : PUX_TAM_PADRAO_MM
        },
        furos: {
          lista: Array.isArray(furos.lista) ? furos.lista.map(Number).filter(Number.isFinite) : [],
          referenciaInvertida: !!furos.referenciaInvertida
        },
        trilhoSup: geo.trilhoSup ? { nome: String(geo.trilhoSup.nome || 'Trilho superior') } : null,
        trilhoInf: geo.trilhoInf ? { nome: String(geo.trilhoInf.nome || 'Trilho inferior') } : null
      }
    };
  }

  // Monta as caixas da cena. Cada caixa: { id, tipo, x, y, z, w, h, d, cor, opacidade? } (centro e dimensões, mm);
  // furo: { tipo:'furo', x, y, z, raio, d }. Também devolve os limites e o rótulo das folhas.
  function montarCaixas(entrada) {
    const nrm = normalizarGeometria(entrada);
    if (!nrm.ok) return { ok: false, motivo: nrm.motivo, caixas: [], limites: null };
    const g = nrm.geo;
    const n = g.folhas.length;
    // seção transversal real do perfil escolhido (se cadastrada); sem ela, o bloco liso de antes
    const sec = g.secao || (SECOES && g.perfil ? SECOES.porModelo(g.perfil) : null);
    const H = g.altura, P = sec ? sec.altura : PERFIL_MM, T = sec ? sec.largura : ESP_PORTA_MM;
    const caixas = [];
    const add = c => { caixas.push(c); return c; };

    const somaL = g.folhas.reduce((a, f) => a + f.largura, 0);
    const totalW = somaL + g.gap * (n - 1) + g.sobraVao;
    const xIni = -totalW / 2; // centraliza em x = 0

    let xCursor = xIni;
    g.folhas.forEach((f, i) => {
      const L = f.largura;
      const x0 = xCursor;
      xCursor += L + g.gap;
      const zc = g.correr && n > 1 ? (i % 2 === 0 ? -AFASTO_CORRER_MM : AFASTO_CORRER_MM) : 0;
      const idf = `f${i + 1}`;
      // perfis: 2 montantes inteiros + travessas entre eles (esquadro simples)
      const gw = Math.max(0, L - 2 * P), gh = Math.max(0, H - 2 * P);
      if (sec) {
        // extrusão da seção: sx = espessura -> z da cena (y=0 da seção na borda externa), sy = para dentro da folha, sz = ao longo do comprimento.
        // Os três eixos formam rotação própria (sem espelhamento); o pé (x = 0) fica sempre do lado -z, nos quatro lados.
        const zIni = zc - T / 2, ez = [0, 0, 1];
        const peca = (sufixo, comp, origem, sy, sz) => {
          const c = {
            id: `${idf}-perfil-${sufixo}`, tipo: 'perfil', folha: i, cor: CORES.perfil,
            secao: sec, comprimento: comp, origem, eixos: { sx: ez, sy, sz }
          };
          c.x = origem[0] + sy[0] * P / 2 + sz[0] * comp / 2;
          c.y = origem[1] + sy[1] * P / 2 + sz[1] * comp / 2;
          c.z = zIni + T / 2;
          c.w = Math.abs(sy[0]) * P + Math.abs(sz[0]) * comp;
          c.h = Math.abs(sy[1]) * P + Math.abs(sz[1]) * comp;
          c.d = T;
          return add(c);
        };
        peca('esq', H, [x0, 0, zIni], [1, 0, 0], [0, 1, 0]);
        peca('dir', H, [x0 + L, H, zIni], [-1, 0, 0], [0, -1, 0]);
        peca('topo', gw, [x0 + P, H, zIni], [0, -1, 0], [1, 0, 0]);
        peca('base', gw, [x0 + L - P, 0, zIni], [0, 1, 0], [-1, 0, 0]);
        // vidro no canal: espessura = largura do canal; começa a y0 da borda externa em cada lado
        const cv = sec.canalVidro;
        add({ id: `${idf}-vidro`, tipo: 'vidro', folha: i, x: x0 + L / 2, y: H / 2, z: zIni + (cv.x0 + cv.x1) / 2, w: Math.max(0, L - 2 * cv.y0), h: Math.max(0, H - 2 * cv.y0), d: ESP_VIDRO_MM, cor: CORES.vidro, opacidade: OPACIDADE_VIDRO });
      } else {
        add({ id: `${idf}-perfil-esq`, tipo: 'perfil', folha: i, x: x0 + P / 2, y: H / 2, z: zc, w: P, h: H, d: T, cor: CORES.perfil });
        add({ id: `${idf}-perfil-dir`, tipo: 'perfil', folha: i, x: x0 + L - P / 2, y: H / 2, z: zc, w: P, h: H, d: T, cor: CORES.perfil });
        add({ id: `${idf}-perfil-topo`, tipo: 'perfil', folha: i, x: x0 + L / 2, y: H - P / 2, z: zc, w: gw, h: P, d: T, cor: CORES.perfil });
        add({ id: `${idf}-perfil-base`, tipo: 'perfil', folha: i, x: x0 + L / 2, y: P / 2, z: zc, w: gw, h: P, d: T, cor: CORES.perfil });
        // vidro (translúcido)
        add({ id: `${idf}-vidro`, tipo: 'vidro', folha: i, x: x0 + L / 2, y: H / 2, z: zc, w: gw, h: gh, d: ESP_VIDRO_MM, cor: CORES.vidro, opacidade: OPACIDADE_VIDRO });
      }
      // divisores (15 mm), igualmente espaçados na área do vidro
      for (let d = 1; d <= g.divH; d++) {
        const yDown = P + gh / (g.divH + 1) * d;
        add({ id: `${idf}-divh${d}`, tipo: 'divisor', folha: i, x: x0 + L / 2, y: H - yDown, z: zc, w: gw, h: DIVISOR_MM, d: T / 2, cor: CORES.perfil });
      }
      for (let d = 1; d <= g.divV; d++) {
        const xx = x0 + P + gw / (g.divV + 1) * d;
        add({ id: `${idf}-divv${d}`, tipo: 'divisor', folha: i, x: xx, y: H / 2, z: zc, w: DIVISOR_MM, h: gh, d: T / 2, cor: CORES.perfil });
      }
      // puxador: um sólido por posição escolhida na folha
      if (g.puxador.tem) {
        const tipo = g.puxador.tipo;
        const esp = espessuraPuxador(tipo);
        const recuo = (tipo === 'embutido' || f.puxadorTotal) ? 0 : esp / 2;
        const prof = tipo === 'embutido' ? T + 2 : T + 2 * SALIENCIA_PUX_MM;
        f.posicoes.forEach((nome, k) => {
          const r = retanguloPuxador(nome, L, H, esp, recuo, g.puxador.tamanho);
          if (!r) return;
          add({ id: `${idf}-pux${k + 1}`, tipo: 'puxador', folha: i, posicao: nome, x: x0 + r[0] + r[2] / 2, y: H - (r[1] + r[3] / 2), z: zc, w: r[2], h: r[3], d: prof, cor: CORES.puxador });
        });
      }
      // furos (mesma lista em todas as folhas, no lado de cada uma, no centro do perfil)
      if (g.furos.lista.length && f.ladoFuro) {
        const lado = f.ladoFuro;
        g.furos.lista.forEach((m, k) => {
          let cx, cy;
          if (lado === 'Topo' || lado === 'Base') {
            if (m < 0 || m > L) return;
            cx = x0 + m; cy = lado === 'Topo' ? H - P / 2 : P / 2;
          } else {
            if (m < 0 || m > H) return;
            const yDown = g.furos.referenciaInvertida ? H - m : m;
            cy = H - yDown;
            cx = lado === 'Direita' ? x0 + L - P / 2 : x0 + P / 2;
          }
          add({ id: `${idf}-furo${k + 1}`, tipo: 'furo', folha: i, x: cx, y: cy, z: zc, raio: FURO_DIAM_MM / 2, d: T + 1, cor: CORES.furo });
        });
      }
    });

    // trilhos da porta de correr com sistema: cobrem o vão todo, com folga sobre/sob a porta
    const profTrilho = T + 2 * AFASTO_CORRER_MM + 10;
    if (g.trilhoSup) add({ id: 'trilho-sup', tipo: 'trilho', nome: g.trilhoSup.nome, x: xIni + totalW / 2, y: H + FOLGA_MM + TRILHO_MM / 2, z: 0, w: totalW, h: TRILHO_MM, d: profTrilho, cor: CORES.trilho });
    if (g.trilhoInf) add({ id: 'trilho-inf', tipo: 'trilho', nome: g.trilhoInf.nome, x: xIni + totalW / 2, y: -(FOLGA_MM + TRILHO_MM / 2), z: 0, w: totalW, h: TRILHO_MM, d: profTrilho, cor: CORES.trilho });

    return { ok: true, caixas, limites: calcularLimites(caixas), folhas: n, secao: sec ? sec.modelo : null, espessuraPorta: T };
  }

  function calcularLimites(caixas) {
    const mn = { x: Infinity, y: Infinity, z: Infinity }, mx = { x: -Infinity, y: -Infinity, z: -Infinity };
    caixas.forEach(c => {
      const hw = c.tipo === 'furo' ? c.raio : c.w / 2, hh = c.tipo === 'furo' ? c.raio : c.h / 2, hd = c.d / 2;
      mn.x = Math.min(mn.x, c.x - hw); mx.x = Math.max(mx.x, c.x + hw);
      mn.y = Math.min(mn.y, c.y - hh); mx.y = Math.max(mx.y, c.y + hh);
      mn.z = Math.min(mn.z, c.z - hd); mx.z = Math.max(mx.z, c.z + hd);
    });
    if (!caixas.length) return null;
    return {
      min: mn, max: mx,
      centro: { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 },
      tamanho: { x: mx.x - mn.x, y: mx.y - mn.y, z: mx.z - mn.z }
    };
  }

  // Distância da câmera para a cena caber na tela (com margem), pelo maior de largura/altura
  function distanciaEnquadrar(limites, fovGraus, aspecto) {
    if (!limites) return 3000;
    const a = aspecto > 0 ? aspecto : 1;
    const meioV = rad(fovGraus) / 2;
    const meioH = Math.atan(Math.tan(meioV) * a);
    const raioY = limites.tamanho.y / 2, raioX = limites.tamanho.x / 2, prof = limites.tamanho.z / 2;
    const dY = raioY / Math.tan(meioV), dX = raioX / Math.tan(meioH);
    return (Math.max(dX, dY) + prof) * 1.12;
  }

  // Posição da câmera em órbita em volta do alvo (az/el em graus; az 0 = de frente, +az gira para a direita)
  function posicaoCamera(alvo, az, el, dist) {
    const a = rad(az), e = rad(el);
    return {
      x: alvo.x + dist * Math.sin(a) * Math.cos(e),
      y: alvo.y + dist * Math.sin(e),
      z: alvo.z + dist * Math.cos(a) * Math.cos(e)
    };
  }

  const limitar = (v, a, b) => Math.min(Math.max(v, a), b);

  // ----------------------------------------------------------------------
  // PARTE DO NAVEGADOR (WebGL). Nada abaixo roda no Node.
  // ----------------------------------------------------------------------
  let promessaThree = null;
  function carregarThree() {
    if (raiz.THREE) return Promise.resolve(raiz.THREE);
    if (promessaThree) return promessaThree;
    promessaThree = new Promise((ok, erro) => {
      const sc = document.createElement('script');
      sc.src = BIBLIOTECAS.three.url;
      sc.integrity = BIBLIOTECAS.three.integrity;
      sc.crossOrigin = 'anonymous';
      sc.onload = () => raiz.THREE ? ok(raiz.THREE) : erro(new Error('Three.js não carregou'));
      sc.onerror = () => { promessaThree = null; erro(new Error('Não foi possível carregar o Three.js')); };
      document.head.appendChild(sc);
    });
    return promessaThree;
  }

  function webglDisponivel() {
    try {
      const c = document.createElement('canvas');
      return !!(raiz.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (_) { return false; }
  }

  // criar(container, { aoErro }) -> controlador. O container é um <div>; o canvas é criado dentro dele.
  function criar(container, opcoes) {
    const aoErro = (opcoes && opcoes.aoErro) || (() => {});
    const c = {
      geo: null, visivel: false, THREE: null,
      renderer: null, cena: null, camera: null, grupo: null,
      az: VISTAS.perspectiva.az, el: VISTAS.perspectiva.el, dist: 3000, distBase: 3000,
      auto: false, raf: 0, sujo: false, obs: null, ponteiros: new Map(), limites: null, vistaAtual: 'perspectiva'
    };

    function tamanhoCanvas() {
      const r = container.getBoundingClientRect();
      return { w: Math.max(200, Math.round(r.width)), h: Math.max(200, Math.round(r.height)) };
    }

    function corFundo() {
      let cor = '';
      try { cor = getComputedStyle(container).backgroundColor; } catch (_) { /* usa o fallback */ }
      return cor && cor !== 'rgba(0, 0, 0, 0)' ? cor : '#20242b';
    }

    function limparCena() {
      if (!c.grupo || !c.cena) return;
      c.grupo.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
      c.cena.remove(c.grupo);
      c.grupo = null;
    }

    function construirCena() {
      const T = c.THREE;
      limparCena();
      const res = c.geo ? montarCaixas(c.geo) : { ok: false };
      if (!res.ok) { c.limites = null; return false; }
      c.limites = res.limites;
      const grupo = new T.Group();
      res.caixas.forEach(cx => {
        let geom, mat;
        const cor = new T.Color(cx.cor);
        if (cx.secao) {
          // extrusão da seção real ao longo do comprimento, depois orientada pelos eixos calculados em montarCaixas
          const pt = q => new T.Vector2(q[0], q[1]);
          const forma = new T.Shape(cx.secao.contorno.map(pt));
          (cx.secao.vazados || []).forEach(v => forma.holes.push(new T.Path(v.map(pt))));
          geom = new T.ExtrudeGeometry(forma, { depth: cx.comprimento, bevelEnabled: false, steps: 1 });
          const e = cx.eixos;
          const m = new T.Matrix4().makeBasis(new T.Vector3(...e.sx), new T.Vector3(...e.sy), new T.Vector3(...e.sz));
          m.setPosition(cx.origem[0], cx.origem[1], cx.origem[2]);
          geom.applyMatrix4(m);
          mat = new T.MeshStandardMaterial({ color: cor, roughness: 0.55, metalness: 0.45 });
        } else if (cx.tipo === 'furo') {
          geom = new T.CylinderGeometry(cx.raio, cx.raio, cx.d, 20);
          geom.rotateX(Math.PI / 2); // eixo do furo ao longo de z
          mat = new T.MeshStandardMaterial({ color: cor, roughness: 0.9, metalness: 0 });
        } else {
          geom = new T.BoxGeometry(Math.max(cx.w, 0.1), Math.max(cx.h, 0.1), Math.max(cx.d, 0.1));
          mat = cx.tipo === 'vidro'
            ? new T.MeshStandardMaterial({ color: cor, roughness: 0.1, metalness: 0, transparent: true, opacity: cx.opacidade, depthWrite: false })
            : new T.MeshStandardMaterial({ color: cor, roughness: cx.tipo === 'puxador' ? 0.5 : 0.55, metalness: cx.tipo === 'puxador' ? 0.3 : 0.45 });
        }
        const malha = new T.Mesh(geom, mat);
        if (cx.secao) malha.position.set(0, 0, 0); // a geometria já está na posição final
        else malha.position.set(cx.x, cx.y, cx.z);
        if (cx.tipo === 'vidro') malha.renderOrder = 2;
        grupo.add(malha);
        if (cx.tipo === 'perfil' || cx.tipo === 'divisor' || cx.tipo === 'trilho' || cx.tipo === 'puxador') {
          const linhas = new T.LineSegments(new T.EdgesGeometry(geom), new T.LineBasicMaterial({ color: new T.Color(CORES.contorno) }));
          linhas.position.copy(malha.position);
          grupo.add(linhas);
        }
      });
      c.cena.add(grupo);
      c.grupo = grupo;
      return true;
    }

    function aplicarCamera() {
      if (!c.camera || !c.limites) return;
      const p = posicaoCamera(c.limites.centro, c.az, c.el, c.dist);
      c.camera.position.set(p.x, p.y, p.z);
      c.camera.lookAt(c.limites.centro.x, c.limites.centro.y, c.limites.centro.z);
    }

    function enquadrar() {
      if (!c.camera) return;
      const t = tamanhoCanvas();
      c.distBase = distanciaEnquadrar(c.limites, c.camera.fov, t.w / t.h);
      c.dist = c.distBase;
    }

    function desenhar() {
      c.raf = 0;
      if (!c.visivel || !c.renderer) return;
      if (c.auto) c.az += 0.6;
      aplicarCamera();
      c.renderer.render(c.cena, c.camera);
      c.sujo = false;
      if (c.auto) c.raf = requestAnimationFrame(desenhar); // só continua em loop se estiver girando
    }
    function pedirQuadro() {
      if (!c.visivel || !c.renderer || c.raf) return;
      c.raf = requestAnimationFrame(desenhar);
    }

    function ajustarTamanho() {
      if (!c.renderer) return;
      const t = tamanhoCanvas();
      c.renderer.setPixelRatio(Math.min(raiz.devicePixelRatio || 1, 2));
      c.renderer.setSize(t.w, t.h, false);
      c.renderer.domElement.style.width = '100%';
      c.renderer.domElement.style.height = '100%';
      c.camera.aspect = t.w / t.h;
      c.camera.updateProjectionMatrix();
    }

    // ----- controles próprios: arrastar gira, roda/pinça dá zoom -----
    function aoPressionar(e) {
      c.ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* sem captura */ }
    }
    function aoMover(e) {
      const ant = c.ponteiros.get(e.pointerId);
      if (!ant) return;
      if (c.ponteiros.size === 2) {
        const [a, b] = Array.from(c.ponteiros.values());
        const antes = Math.hypot(a.x - b.x, a.y - b.y);
        c.ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = Array.from(c.ponteiros.values());
        const agora = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (antes > 0 && agora > 0) c.dist = limitar(c.dist * antes / agora, c.distBase * 0.25, c.distBase * 4);
      } else {
        c.az -= (e.clientX - ant.x) * 0.5;
        c.el = limitar(c.el + (e.clientY - ant.y) * 0.5, -85, 85);
        c.ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      pedirQuadro();
    }
    function aoSoltar(e) { c.ponteiros.delete(e.pointerId); }
    function aoRolar(e) {
      e.preventDefault();
      c.dist = limitar(c.dist * (e.deltaY > 0 ? 1.1 : 0.9), c.distBase * 0.25, c.distBase * 4);
      pedirQuadro();
    }

    function ligarEventos(el) {
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', aoPressionar);
      el.addEventListener('pointermove', aoMover);
      el.addEventListener('pointerup', aoSoltar);
      el.addEventListener('pointercancel', aoSoltar);
      el.addEventListener('wheel', aoRolar, { passive: false });
    }

    // cria o renderer (ao mostrar); se o WebGL falhar, avisa e o 2D segue
    function montarRenderer() {
      const T = c.THREE;
      try {
        c.renderer = new T.WebGLRenderer({ antialias: true });
      } catch (err) { c.renderer = null; aoErro('Não foi possível iniciar o 3D neste navegador (WebGL).'); return false; }
      c.cena = new T.Scene();
      c.cena.background = new T.Color(corFundo());
      c.camera = new T.PerspectiveCamera(35, 1, 10, 100000);
      c.cena.add(new T.AmbientLight(0xffffff, 0.75));
      const l1 = new T.DirectionalLight(0xffffff, 0.8); l1.position.set(1500, 3000, 4000); c.cena.add(l1);
      const l2 = new T.DirectionalLight(0xffffff, 0.35); l2.position.set(-2500, 1000, -2000); c.cena.add(l2);
      container.appendChild(c.renderer.domElement);
      ligarEventos(c.renderer.domElement);
      ajustarTamanho();
      return true;
    }

    function liberar() {
      if (c.raf) { cancelAnimationFrame(c.raf); c.raf = 0; }
      if (c.obs) { c.obs.disconnect(); c.obs = null; }
      limparCena();
      if (c.renderer) {
        const el = c.renderer.domElement;
        c.renderer.dispose();
        try { c.renderer.forceContextLoss(); } catch (_) { /* já perdido */ }
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
      c.renderer = null; c.cena = null; c.camera = null; c.ponteiros.clear();
    }

    const api = {
      suportado: webglDisponivel,
      // mostra o 3D: carrega o Three.js na 1ª vez, cria o renderer e desenha o último estado
      async mostrar() {
        if (c.visivel) return true;
        if (!webglDisponivel()) { aoErro('Este navegador não tem WebGL: o 3D não está disponível (o 2D continua normal).'); return false; }
        try { c.THREE = await carregarThree(); } catch (err) { aoErro(err.message || 'Falha ao carregar o 3D.'); return false; }
        if (c.visivel) return true;
        c.visivel = true;
        if (!montarRenderer()) { c.visivel = false; return false; }
        if (typeof ResizeObserver === 'function') {
          c.obs = new ResizeObserver(() => { ajustarTamanho(); pedirQuadro(); });
          c.obs.observe(container);
        }
        if (construirCena()) { enquadrar(); }
        pedirQuadro();
        return true;
      },
      // esconde o 3D e libera o WebGL (dispose); o estado (geo, vista) fica guardado
      esconder() { c.visivel = false; liberar(); },
      // recebe a geometria nova (o que geometria3D() lê do formulário); só redesenha se estiver visível
      atualizar(geo) {
        c.geo = geo;
        if (!c.visivel || !c.renderer) return;
        const tinha = !!c.limites;
        if (construirCena()) { if (!tinha) enquadrar(); }
        pedirQuadro();
      },
      vista(nome) {
        const v = VISTAS[nome]; if (!v) return;
        c.az = v.az; c.el = v.el; c.vistaAtual = nome;
        c.dist = c.distBase;
        pedirQuadro();
      },
      girarAuto(ligado) { c.auto = !!ligado; pedirQuadro(); },
      resetar() { c.auto = false; enquadrar(); api.vista('perspectiva'); },
      estado() { return { visivel: c.visivel, auto: c.auto, vista: c.vistaAtual, temRenderer: !!c.renderer }; },
      destruir() { c.visivel = false; liberar(); }
    };
    return api;
  }

  return {
    CORES, VISTAS, BIBLIOTECAS, PERFIL_MM, DIVISOR_MM, FURO_DIAM_MM, TRILHO_MM, FOLGA_MM, ESP_PORTA_MM,
    comprimentoPuxador, espessuraPuxador, retanguloPuxador, normalizarGeometria, montarCaixas, calcularLimites,
    distanciaEnquadrar, posicaoCamera, criar, webglDisponivel
  };
});
