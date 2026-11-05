// ==========================================================================
// Biblioteca de seções transversais de perfis (para o visualizador 3D). Módulo PURO: roda no Node (servidor e testes)
// e no navegador (global PerfilSecoes). Só dados + validação; não lê banco nem DOM.
//
// Sistema local da seção, em mm:
//   x = espessura da porta (0 .. largura)
//   y = 0 .. altura: largura visível do perfil; y = 0 é a borda EXTERNA da porta, y = altura é a borda voltada para a abertura.
// ESQUEMA VERSÃO 2 (o mesmo JSON que a tabela web_perfil_secoes guarda e GET/PUT /perfil_secoes trafegam):
//   { versao:2, codigo, modelo, largura, altura,
//     contorno:[[x,y]...],            polígono externo fechado (sem repetir o 1º ponto)
//     vazados:[[[x,y]...]...],        furos: o oco principal e as nervuras internas
//     canalVidro:{ x0, x1, y0 },      faixa x0..x1 por onde o vidro corre, a partir de y0 (a espessura do vidro é SEMPRE 4 mm, fixa no 3D)
//     parede,                         espessura da parede da caixa oca
//     junta:'reta'|'meia_esquadria',  como as peças se encontram nos cantos
//     cores:{ padrao:'#rrggbb', porAcabamento:{ '<nome do acabamento>':'#rrggbb' } },
//     estimada:[...campos estimados] }
// Seção versão 1 (sem versao/cores) continua válida: registrar() a normaliza para a versão 2.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.PerfilSecoes = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSAO = 2;
  // junta: como as peças da moldura se encontram nos cantos ('reta' = esquadro simples, padrão; 'meia_esquadria' = corte de 45°)
  const JUNTAS = ['reta', 'meia_esquadria'];
  const LIMITES = { dimMin: 1, dimMax: 300, pontosPorPoligono: 200, vazados: 30, acabamentos: 60, nomeAcabamento: 60, estimadas: 20 };
  const REGEX_COR = /^#[0-9a-fA-F]{6}$/;
  const EPS = 1e-9;

  const norm = s => String(s == null ? '' : s).trim().toUpperCase();
  // chave de acabamento: sem acento, maiúscula, espaços unificados ("Anodizado Fosco" == "ANODIZADO  FOSCO")
  const chaveAcabamento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

  // Área de um polígono (positiva, fórmula do laço)
  function areaPoligono(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  // ponto estritamente dentro (a borda não conta como dentro)
  function naBorda(pt, poli) {
    for (let i = 0; i < poli.length; i++) {
      const a = poli[i], b = poli[(i + 1) % poli.length];
      const cr = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
      if (Math.abs(cr) > 1e-7) continue;
      if (pt[0] >= Math.min(a[0], b[0]) - 1e-7 && pt[0] <= Math.max(a[0], b[0]) + 1e-7 && pt[1] >= Math.min(a[1], b[1]) - 1e-7 && pt[1] <= Math.max(a[1], b[1]) + 1e-7) return true;
    }
    return false;
  }
  function pontoDentro(pt, poli) {
    let dentro = false;
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
      const [xi, yi] = poli[i], [xj, yj] = poli[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
  const dentroOuNaBorda = (pt, poli) => naBorda(pt, poli) || pontoDentro(pt, poli);
  const dentroEstrito = (pt, poli) => !naBorda(pt, poli) && pontoDentro(pt, poli);

  // Área sólida = contorno - vazados
  function areaSolida(s) {
    return areaPoligono(s.contorno) - s.vazados.reduce((a, v) => a + areaPoligono(v), 0);
  }

  // ----- geometria de segmentos -----
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sinal = v => (v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0);
  const noSegmento = (a, b, p) => p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9 && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
  // Os dois segmentos se tocam de algum jeito (cruzam, encostam ou se sobrepõem)?
  function segmentosSeTocam(a, b, c, d) {
    const o1 = sinal(orient(a, b, c)), o2 = sinal(orient(a, b, d)), o3 = sinal(orient(c, d, a)), o4 = sinal(orient(c, d, b));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && noSegmento(a, b, c)) return true;
    if (o2 === 0 && noSegmento(a, b, d)) return true;
    if (o3 === 0 && noSegmento(c, d, a)) return true;
    if (o4 === 0 && noSegmento(c, d, b)) return true;
    return false;
  }
  // Cruzamento próprio (um atravessa o outro; encostar na ponta não conta)
  function segmentosCruzam(a, b, c, d) {
    const o1 = sinal(orient(a, b, c)), o2 = sinal(orient(a, b, d)), o3 = sinal(orient(c, d, a)), o4 = sinal(orient(c, d, b));
    return o1 * o2 < 0 && o3 * o4 < 0;
  }

  // Polígono simples: sem pontos repetidos seguidos, sem autointerseção, área > 0. Devolve texto de erro ou ''.
  function problemaPoligono(p) {
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) return 'tem pontos repetidos em sequência';
    }
    if (areaPoligono(p) < 1e-9) return 'tem área nula';
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) {
          // arestas vizinhas só podem dividir o ponto comum: não podem voltar sobre si mesmas
          const c = p[j], d = p[(j + 1) % n];
          const comum = j === i + 1 ? b : a, outroI = j === i + 1 ? a : b, outroJ = j === i + 1 ? d : c;
          if (sinal(orient(comum, outroI, outroJ)) === 0) {
            const prod = (outroI[0] - comum[0]) * (outroJ[0] - comum[0]) + (outroI[1] - comum[1]) * (outroJ[1] - comum[1]);
            if (prod > 0) return 'tem arestas sobrepostas';
          }
          continue;
        }
        if (segmentosSeTocam(a, b, p[j], p[(j + 1) % n])) return 'cruza ou encosta em si mesmo';
      }
    }
    return '';
  }

  const ehPonto = q => Array.isArray(q) && q.length === 2 && q.every(v => typeof v === 'number' && Number.isFinite(v));
  const poliOk = p => Array.isArray(p) && p.length >= 3 && p.every(ehPonto);

  // Confere a seção inteira. Devolve lista de problemas em português (vazia = ok).
  function validar(s) {
    const erros = [];
    if (!s || typeof s !== 'object' || Array.isArray(s)) return ['sem seção'];
    if (s.versao !== undefined && s.versao !== 1 && s.versao !== 2) erros.push('versão do esquema inválida (use 2)');
    if (s.codigo !== undefined && !(Number.isInteger(s.codigo) && s.codigo > 0)) erros.push('código inválido');
    if (typeof s.modelo !== 'string' || !s.modelo.trim() || s.modelo.length > 100) erros.push('modelo inválido');
    const dimOk = v => typeof v === 'number' && Number.isFinite(v) && v >= LIMITES.dimMin && v <= LIMITES.dimMax;
    if (!dimOk(s.largura)) erros.push(`largura inválida (entre ${LIMITES.dimMin} e ${LIMITES.dimMax} mm)`);
    if (!dimOk(s.altura)) erros.push(`altura inválida (entre ${LIMITES.dimMin} e ${LIMITES.dimMax} mm)`);
    if (!poliOk(s.contorno)) { erros.push('contorno inválido (mínimo 3 pontos [x,y])'); return erros; }
    if (s.contorno.length > LIMITES.pontosPorPoligono) { erros.push(`contorno com pontos demais (máximo ${LIMITES.pontosPorPoligono})`); return erros; }
    if (erros.length) return erros; // sem caixa válida não dá para conferir o resto
    const fora = p => p.some(([x, y]) => x < -1e-9 || y < -1e-9 || x > s.largura + 1e-9 || y > s.altura + 1e-9);
    if (fora(s.contorno)) erros.push('contorno fora da caixa largura x altura');
    const pc = problemaPoligono(s.contorno);
    if (pc) erros.push(`contorno ${pc}`);

    const vaz = s.vazados === undefined ? [] : s.vazados;
    if (!Array.isArray(vaz)) erros.push('vazados deve ser uma lista');
    else if (vaz.length > LIMITES.vazados) erros.push(`vazados demais (máximo ${LIMITES.vazados})`);
    else {
      const bons = [];
      vaz.forEach((v, i) => {
        if (!poliOk(v)) { erros.push(`vazado ${i} inválido (mínimo 3 pontos [x,y])`); return; }
        if (v.length > LIMITES.pontosPorPoligono) { erros.push(`vazado ${i} com pontos demais (máximo ${LIMITES.pontosPorPoligono})`); return; }
        const pv = problemaPoligono(v);
        if (pv) { erros.push(`vazado ${i} ${pv}`); return; }
        let ok = true;
        if (!v.every(pt => dentroOuNaBorda(pt, s.contorno))) { erros.push(`vazado ${i} fora do contorno`); ok = false; }
        else {
          // nenhuma aresta do vazado atravessa o contorno, e o meio de cada aresta fica dentro
          for (let a = 0; a < v.length && ok; a++) {
            const p1 = v[a], p2 = v[(a + 1) % v.length];
            const meio = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
            if (!dentroOuNaBorda(meio, s.contorno)) ok = false;
            for (let b = 0; b < s.contorno.length && ok; b++) if (segmentosCruzam(p1, p2, s.contorno[b], s.contorno[(b + 1) % s.contorno.length])) ok = false;
          }
          if (!ok) erros.push(`vazado ${i} sai do contorno`);
        }
        if (ok) bons.push([i, v]);
      });
      // vazados não podem se cruzar nem um estar dentro do outro
      for (let x = 0; x < bons.length; x++) for (let y = x + 1; y < bons.length; y++) {
        const [i, A] = bons[x], [j, B] = bons[y];
        let conflito = A.some(pt => dentroEstrito(pt, B)) || B.some(pt => dentroEstrito(pt, A));
        for (let a = 0; a < A.length && !conflito; a++) for (let b = 0; b < B.length && !conflito; b++) {
          if (segmentosCruzam(A[a], A[(a + 1) % A.length], B[b], B[(b + 1) % B.length])) conflito = true;
        }
        if (!conflito) { // mesmo polígono repetido / sobreposição sem vértice dentro: confere o meio das arestas
          const meios = P => P.map((p1, k) => { const p2 = P[(k + 1) % P.length]; return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]; });
          conflito = meios(A).some(m => dentroEstrito(m, B)) || meios(B).some(m => dentroEstrito(m, A));
        }
        if (conflito) erros.push(`vazados ${i} e ${j} se cruzam ou se sobrepõem`);
      }
    }

    const c = s.canalVidro;
    if (!c || typeof c !== 'object' || ![c.x0, c.x1, c.y0].every(v => typeof v === 'number' && Number.isFinite(v))
      || !(c.x1 > c.x0) || c.x0 < 0 || c.x1 > s.largura || !(c.y0 >= 0) || c.y0 > s.altura) erros.push('canal do vidro inválido (dentro da seção, x1 > x0)');
    if (!(typeof s.parede === 'number' && s.parede > 0 && s.parede <= Math.min(s.largura, s.altura) / 2)) erros.push('parede inválida');
    if (s.junta !== undefined && !JUNTAS.includes(s.junta)) erros.push(`junta inválida (use ${JUNTAS.join(' ou ')})`);

    if (s.cores !== undefined) {
      const co = s.cores;
      if (!co || typeof co !== 'object' || Array.isArray(co)) erros.push('cores inválidas');
      else {
        if (co.padrao !== undefined && !(typeof co.padrao === 'string' && REGEX_COR.test(co.padrao))) erros.push('cor padrão inválida (use #rrggbb)');
        if (co.porAcabamento !== undefined) {
          const pa = co.porAcabamento;
          if (!pa || typeof pa !== 'object' || Array.isArray(pa)) erros.push('cores por acabamento inválidas');
          else {
            const chaves = Object.keys(pa);
            if (chaves.length > LIMITES.acabamentos) erros.push(`acabamentos demais em cores (máximo ${LIMITES.acabamentos})`);
            const vistas = new Set();
            for (const k of chaves) {
              const ch = chaveAcabamento(k);
              if (!ch || k.length > LIMITES.nomeAcabamento) erros.push(`nome de acabamento inválido em cores ("${String(k).slice(0, 20)}")`);
              else if (vistas.has(ch)) erros.push(`acabamento repetido em cores ("${k}")`);
              vistas.add(ch);
              if (!(typeof pa[k] === 'string' && REGEX_COR.test(pa[k]))) erros.push(`cor inválida para o acabamento "${String(k).slice(0, 30)}" (use #rrggbb)`);
            }
          }
        }
      }
    }
    if (s.estimada !== undefined && !(Array.isArray(s.estimada) && s.estimada.length <= LIMITES.estimadas && s.estimada.every(t => typeof t === 'string' && t.length <= 100))) erros.push('lista de estimados inválida');
    if (!erros.length && areaSolida({ contorno: s.contorno, vazados: vaz }) <= 0) erros.push('área sólida não positiva');
    return erros;
  }

  // Forma canônica (versão 2): só os campos conhecidos, padrões preenchidos. NÃO valida (use validar depois).
  function normalizar(s) {
    if (!s || typeof s !== 'object') return s;
    const copia = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const r = {
      versao: VERSAO, codigo: s.codigo, modelo: s.modelo,
      largura: s.largura, altura: s.altura, contorno: copia(s.contorno),
      vazados: s.vazados === undefined ? [] : copia(s.vazados),
      canalVidro: s.canalVidro && typeof s.canalVidro === 'object' ? { x0: s.canalVidro.x0, x1: s.canalVidro.x1, y0: s.canalVidro.y0 } : s.canalVidro,
      parede: s.parede, junta: s.junta === undefined ? 'reta' : s.junta
    };
    if (s.cores !== undefined) {
      r.cores = s.cores && typeof s.cores === 'object' && !Array.isArray(s.cores)
        ? { ...(s.cores.padrao !== undefined ? { padrao: s.cores.padrao } : {}), porAcabamento: s.cores.porAcabamento === undefined ? {} : copia(s.cores.porAcabamento) }
        : s.cores;
    }
    r.estimada = s.estimada === undefined ? [] : copia(s.estimada);
    return r;
  }

  // Cor do perfil para um acabamento: cores.porAcabamento[acabamento] -> cores.padrao -> null (quem chama usa o cinza de sempre)
  function corDoPerfil(secao, acabamento) {
    const c = secao && secao.cores;
    if (!c) return null;
    const ch = chaveAcabamento(acabamento);
    if (ch && c.porAcabamento) {
      for (const k of Object.keys(c.porAcabamento)) if (chaveAcabamento(k) === ch && REGEX_COR.test(c.porAcabamento[k])) return c.porAcabamento[k];
    }
    return typeof c.padrao === 'string' && REGEX_COR.test(c.padrao) ? c.padrao : null;
  }

  // Pontas de uma peça da moldura. `comprimento` = comprimento EXTERNO (medido na borda externa, y = 0 da seção).
  // Devolve [inicio, fim]: posição, ao longo do eixo da peça (0 .. comprimento), do ponto da seção a y mm da borda externa.
  //   'reta': [0, comprimento] para todo y (esquadro simples).
  //   'meia_esquadria': corte de 45°: o ponto a y mm da borda externa recua y mm em cada ponta -> [y, comprimento - y].
  // Peças vizinhas (mesmo y) fecham no mesmo ponto do canto: a linha de corte é a diagonal do canto.
  function pontasPeca(secao, y, comprimento) {
    if (secao && secao.junta === 'meia_esquadria') return [y, comprimento - y];
    return [0, comprimento];
  }

  const secoes = new Map();   // chave = modelo normalizado
  function registrar(s) {
    const normal = normalizar(s);
    const erros = validar(normal);
    if (erros.length) throw new Error(`Seção do perfil ${s && s.modelo} inválida: ${erros.join('; ')}`);
    secoes.set(norm(normal.modelo), normal);
    return normal;
  }
  // Troca TODO o conteúdo pela lista vinda do servidor (a biblioteca é a fonte da verdade: seção apagada sai daqui).
  // Seções inválidas são ignoradas (não derrubam as outras). Devolve { registradas, ignoradas:[{modelo, erros}] }.
  function substituirTodas(lista) {
    const novas = new Map(), ignoradas = [];
    for (const s of Array.isArray(lista) ? lista : []) {
      const normal = normalizar(s), erros = validar(normal);
      if (erros.length) ignoradas.push({ modelo: s && s.modelo, erros }); else novas.set(norm(normal.modelo), normal);
    }
    secoes.clear();
    novas.forEach((v, k) => secoes.set(k, v));
    return { registradas: novas.size, ignoradas };
  }
  function lista() { return Array.from(secoes.values()); }

  // Busca pelo MODELO escolhido no formulário (valor de f-perfil, que é cadastro_de_produtos.MODELO) ou pelo código do produto.
  function porModelo(modelo) { return secoes.get(norm(modelo)) || null; }
  function porCodigo(codigo) {
    for (const s of secoes.values()) if (String(s.codigo) === String(codigo)) return s;
    return null;
  }

  // ----- Perfil 1036 (produto Código 13, Classe Perfil, modelo "1036"): semente da biblioteca e reserva embutida -----
  // Fonte: leitura da imagem da seção (escala conferida, ~4,55 px/mm): altura 45 mm, largura total 18,9 mm,
  // caixa oca 12,9 mm, altura do pé em U 7,8 mm. Duas pequenas nervuras internas foram IGNORADAS nesta etapa.
  // ESTIMADO (a imagem não cota): parede da caixa = 1,5 mm; a aba externa e a base do pé também = 1,5 mm.
  const x0Caixa = 6.0;            // 6,0: onde começa a caixa oca
  const p = 1.5;                 // parede estimada
  const SEMENTE_1036 = {
    versao: VERSAO, codigo: 13, modelo: '1036',
    largura: 18.9, altura: 45, parede: p,
    junta: 'meia_esquadria',   // o 1036 é montado em corte de 45°
    estimada: ['parede', 'espessura da aba e da base do pé'],
    // caixa x 6,0..18,9 / y 0..45 + pé em U (base x 0..6 y 0..1,5; aba x 0..1,5 até y 7,8). Sentido anti-horário.
    contorno: [[0, 0], [18.9, 0], [18.9, 45], [x0Caixa, 45], [x0Caixa, p], [p, p], [p, 7.8], [0, 7.8]],
    // oco da caixa: recuado a parede em todos os lados
    vazados: [[[x0Caixa + p, p], [18.9 - p, p], [18.9 - p, 45 - p], [x0Caixa + p, 45 - p]]],
    // canal do vidro: x 1,5..6,0 (4,5 mm), a partir de y = 1,5 (topo da base do pé); o vidro sobe pela face da caixa
    canalVidro: { x0: p, x1: x0Caixa, y0: p },
    cores: { padrao: '#c3c8cd', porAcabamento: {} }
  };
  const semente1036 = () => JSON.parse(JSON.stringify(SEMENTE_1036));
  registrar(SEMENTE_1036);

  return { VERSAO, JUNTAS, LIMITES, areaPoligono, areaSolida, validar, normalizar, registrar, substituirTodas, lista, porModelo, porCodigo, pontasPeca, corDoPerfil, chaveAcabamento, semente1036 };
});
