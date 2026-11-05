// ==========================================================================
// Seções transversais de perfis (para o visualizador 3D). Módulo PURO: roda no Node (testes) e no navegador
// (global PerfilSecoes). Só dados + validação; não lê banco nem DOM.
//
// Sistema local da seção, em mm:
//   x = espessura da porta (0 .. largura)
//   y = 0 .. altura: largura visível do perfil; y = 0 é a borda EXTERNA da porta, y = altura é a borda voltada para a abertura.
// Estrutura de cada seção:
//   { codigo, modelo, largura, altura, contorno:[[x,y]...], vazados:[[[x,y]...]...],
//     canalVidro:{ x0, x1, y0 }, parede, estimada:[...campos estimados] }
//   contorno = polígono externo fechado (sem repetir o 1º ponto); vazados = polígonos de furo (ocos);
//   canalVidro = faixa x0..x1 onde o vidro corre, a partir de y0; parede = espessura da parede da caixa oca.
// Pronta para vir depois de uma tabela (web_perfil_secoes) ou de um traçador: basta registrar() com o mesmo formato.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.PerfilSecoes = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // junta: como as peças da moldura se encontram nos cantos ('reta' = esquadro simples, padrão; 'meia_esquadria' = corte de 45°)
  const JUNTAS = ['reta', 'meia_esquadria'];

  const norm = s => String(s == null ? '' : s).trim().toUpperCase();

  // Área de um polígono (positiva, fórmula do laço)
  function areaPoligono(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  function pontoDentro(pt, poli) {
    let dentro = false;
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
      const [xi, yi] = poli[i], [xj, yj] = poli[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  // Área sólida = contorno - vazados
  function areaSolida(s) {
    return areaPoligono(s.contorno) - s.vazados.reduce((a, v) => a + areaPoligono(v), 0);
  }

  // Confere se a seção fecha: polígonos válidos, dentro da caixa largura x altura, vazados dentro do contorno,
  // canal do vidro dentro da seção. Devolve lista de problemas (vazia = ok).
  function validar(s) {
    const erros = [];
    if (!s || typeof s !== 'object') return ['sem seção'];
    if (!(s.largura > 0) || !(s.altura > 0)) erros.push('largura/altura inválidas');
    const poliOk = p => Array.isArray(p) && p.length >= 3 && p.every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite));
    if (!poliOk(s.contorno)) { erros.push('contorno inválido'); return erros; }
    const fora = p => p.some(([x, y]) => x < -1e-9 || y < -1e-9 || x > s.largura + 1e-9 || y > s.altura + 1e-9);
    if (fora(s.contorno)) erros.push('contorno fora da caixa largura x altura');
    (s.vazados || []).forEach((v, i) => {
      if (!poliOk(v)) { erros.push(`vazado ${i} inválido`); return; }
      if (!v.every(pt => pontoDentro(pt, s.contorno) || s.contorno.some(c => c[0] === pt[0] && c[1] === pt[1]))) erros.push(`vazado ${i} fora do contorno`);
    });
    const c = s.canalVidro;
    if (!c || !(c.x1 > c.x0) || c.x0 < 0 || c.x1 > s.largura || !(c.y0 >= 0) || c.y0 > s.altura) erros.push('canal do vidro inválido');
    if (!(s.parede > 0)) erros.push('parede inválida');
    if (s.junta !== undefined && !JUNTAS.includes(s.junta)) erros.push(`junta inválida (use ${JUNTAS.join(' ou ')})`);
    if (areaSolida(s) <= 0) erros.push('área sólida não positiva');
    return erros;
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
    const normal = { ...s, vazados: s.vazados || [], junta: s.junta === undefined ? 'reta' : s.junta };
    const erros = validar(normal);
    if (erros.length) throw new Error(`Seção do perfil ${s && s.modelo} inválida: ${erros.join('; ')}`);
    secoes.set(norm(normal.modelo), normal);
    return normal;
  }

  // Busca pelo MODELO escolhido no formulário (valor de f-perfil, que é cadastro_de_produtos.MODELO) ou pelo código do produto.
  function porModelo(modelo) { return secoes.get(norm(modelo)) || null; }
  function porCodigo(codigo) {
    for (const s of secoes.values()) if (String(s.codigo) === String(codigo)) return s;
    return null;
  }

  // ----- Perfil 1036 (produto Código 13, Classe Perfil, modelo "1036") -----
  // Fonte: leitura da imagem da seção (escala conferida, ~4,55 px/mm): altura 45 mm, largura total 18,9 mm,
  // caixa oca 12,9 mm, altura do pé em U 7,8 mm. Duas pequenas nervuras internas foram IGNORADAS nesta etapa.
  // ESTIMADO (a imagem não cota): parede da caixa = 1,5 mm; a aba externa e a base do pé também = 1,5 mm.
  const x0Caixa = 6.0;            // 6,0: onde começa a caixa oca
  const p = 1.5;                 // parede estimada
  registrar({
    codigo: 13, modelo: '1036',
    largura: 18.9, altura: 45, parede: p,
    junta: 'meia_esquadria',   // o 1036 é montado em corte de 45°
    estimada: ['parede', 'espessura da aba e da base do pé'],
    // caixa x 6,0..18,9 / y 0..45 + pé em U (base x 0..6 y 0..1,5; aba x 0..1,5 até y 7,8). Sentido anti-horário.
    contorno: [[0, 0], [18.9, 0], [18.9, 45], [x0Caixa, 45], [x0Caixa, p], [p, p], [p, 7.8], [0, 7.8]],
    // oco da caixa: recuado a parede em todos os lados
    vazados: [[[x0Caixa + p, p], [18.9 - p, p], [18.9 - p, 45 - p], [x0Caixa + p, 45 - p]]],
    // canal do vidro: x 1,5..6,0 (4,5 mm), a partir de y = 1,5 (topo da base do pé); o vidro sobe pela face da caixa
    canalVidro: { x0: p, x1: x0Caixa, y0: p }
  });

  return { JUNTAS, areaPoligono, areaSolida, validar, registrar, porModelo, porCodigo, pontasPeca };
});
