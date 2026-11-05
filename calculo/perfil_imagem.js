// ==========================================================================
// Desenho automático da seção do perfil a partir da LEITURA de uma imagem (módulo PURO, só Node; sem rede, sem banco).
//
// Quem olha a imagem é o modelo de visão (leitura/perfil_imagem.js). Aqui o CÓDIGO faz a parte numérica, porque modelo de
// visão erra medida em mm mas acerta razoavelmente onde as coisas estão na figura:
//   1. o modelo devolve coordenadas da imagem (vértices do contorno, dos vazados, do canal) e as cotas lidas (valor + os dois
//      extremos de cada linha de cota). Nada em mm;
//   2. calibração px -> mm pelas COTAS (mínimos quadrados ponderados pelo comprimento: as cotas maiores mandam), sem cota = sem desenho;
//   3. conversão com origem no canto inferior esquerdo externo (y para cima), esticada para a maior cota de cada eixo
//      quando ela bate com o desenho (até 6%);
//   4. encaixe: vértices quase alinhados viram ângulo reto (agrupamento de coordenadas), cada cota lida força a distância
//      exata entre os dois lados que ela mede (ex.: altura 45, largura 18,9, caixa 12,9, pé 7,8), grade de 0,05 mm,
//      pontos repetidos e colineares saem, polígonos ficam anti-horários;
//   5. `parede` é estimada (menor espessura do contorno ao oco principal) e marcada em `estimada`; junta 'reta' se a imagem não diz;
//   6. a seção passa por PerfilSecoes.validar. Se falhar, NADA é proposto: devolve os motivos em português.
// Saída de montarProposta: { ok, secao, sobreposicao, cotasLidas, avisos, confianca, ... } ou { ok:false, erros, achado, sobreposicao }.
// Nada aqui grava: quem decide é a pessoa, na conferência da tela.
// ==========================================================================
'use strict';
const PS = require('./perfil_secoes');

const GRADE = 0.05;                       // mm
const LIM = { pontos: 200, vazados: 30, cotas: 40, texto: 200 };
const FATOR_INCERTEZA = { baixa: 0.55, media: 0.85, alta: 1 };
const TOL_ESTICAR = 0.06;                 // a maior cota do eixo só estica o desenho se estiver a até 6% dele
const RAIO_COTA_MM = 1.2;                 // quão longe do extremo da cota pode estar o lado do desenho que ela mede
const TOL_BATE_MM = 0.06;
const COR_PADRAO = '#c3c8cd';
const PAREDE_PADRAO = 1.5;

const num = v => typeof v === 'number' && Number.isFinite(v);
const grade = v => { const r = Math.round(Math.round(v / GRADE) * GRADE * 100) / 100; return r === 0 ? 0 : r; };
const arred = (v, n = 2) => { const f = Math.pow(10, n); const r = Math.round(v * f) / f; return r === 0 ? 0 : r; };
const fmt = v => String(arred(v, 2)).replace('.', ',');
const texto = (v, max = LIM.texto) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function lerValor(v) {
  if (num(v)) return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/\s/g, '').replace(/mm$/i, '');
  return /^\d+([.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. resposta do modelo (coordenadas de 0 a 1000 em cada eixo) -> coordenadas em pixels da imagem
// ---------------------------------------------------------------------------------------------------------------
// → { ok:true, leitura } | { ok:false, erro }. Cota ilegível é descartada (e contada); o resto mal formado recusa a resposta.
function normalizarResposta(j, { largura, altura }) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, erro: 'a resposta não é um objeto JSON' };
  const W = largura / 1000, H = altura / 1000;
  const pt = p => (Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]) && p[0] >= -50 && p[0] <= 1050 && p[1] >= -50 && p[1] <= 1050 ? [p[0] * W, p[1] * H] : null);
  const poli = ps => { if (!Array.isArray(ps) || ps.length > LIM.pontos) return null; const r = ps.map(pt); return r.every(Boolean) ? r : null; };
  const observacoes = texto(j.observacoes, 600);
  if (j.secaoEncontrada === false) return { ok: true, leitura: { naoEncontrada: true, observacoes, contorno: [], vazados: [], cotas: [], canal: null, junta: null, incertezas: [], descartadas: 0 } };

  const contorno = poli(j.contorno);
  if (!contorno || contorno.length < 3) return { ok: false, erro: 'o contorno externo está ausente ou mal formado' };
  if (!Array.isArray(j.vazados) || j.vazados.length > LIM.vazados) return { ok: false, erro: 'a lista de vazados está ausente ou grande demais' };
  const vazados = [];
  for (const v of j.vazados) {
    const pontos = poli(Array.isArray(v) ? v : v && v.pontos);
    if (!pontos || pontos.length < 3) return { ok: false, erro: 'um dos vazados está mal formado' };
    vazados.push(pontos);
  }
  if (!Array.isArray(j.cotas) || j.cotas.length > LIM.cotas) return { ok: false, erro: 'a lista de cotas está ausente ou grande demais' };
  const cotas = []; let descartadas = 0;
  for (const c of j.cotas) {
    const valor = lerValor(c && c.valor), p1 = pt(c && c.p1), p2 = pt(c && c.p2);
    if (!(valor > 0 && valor <= 300) || !p1 || !p2) { descartadas++; continue; }
    cotas.push({ texto: texto(c.texto, 30) || fmt(valor), valor, p1, p2, incerteza: FATOR_INCERTEZA[c.incerteza] ? c.incerteza : 'media' });
  }
  let canal = null;
  if (j.canalVidro != null) {
    const k = j.canalVidro;
    if (typeof k !== 'object' || ![k.x0, k.y0, k.x1, k.y1].every(v => num(v) && v >= -50 && v <= 1050)) return { ok: false, erro: 'o canal do vidro está mal formado' };
    canal = { x0: Math.min(k.x0, k.x1) * W, x1: Math.max(k.x0, k.x1) * W, y0: Math.min(k.y0, k.y1) * H, y1: Math.max(k.y0, k.y1) * H };
  }
  const incertezas = (Array.isArray(j.incertezas) ? j.incertezas : []).slice(0, 30)
    .map(i => ({ item: texto(i && i.item, 80), nivel: i && FATOR_INCERTEZA[i.nivel] ? i.nivel : 'media', motivo: texto(i && i.motivo, 200) })).filter(i => i.item);
  return { ok: true, leitura: { naoEncontrada: false, contorno, vazados, cotas, canal, junta: j.junta === 'meia_esquadria' || j.junta === 'reta' ? j.junta : null, incertezas, observacoes, descartadas } };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. calibração px -> mm pelas cotas
// ---------------------------------------------------------------------------------------------------------------
function calibrarEscala(cotas, avisos) {
  for (const c of cotas) {
    c.compPx = Math.hypot(c.p2[0] - c.p1[0], c.p2[1] - c.p1[1]);
    const ang = Math.atan2(Math.abs(c.p2[1] - c.p1[1]), Math.abs(c.p2[0] - c.p1[0])) * 180 / Math.PI;
    c.eixo = c.compPx < 10 ? null : ang <= 15 ? 'x' : ang >= 75 ? 'y' : null;
    c.usada = false;
    if (!c.eixo) avisos.push({ texto: `A cota ${c.texto} não é horizontal nem vertical (ou é curta demais) e não entrou na calibração.`, grave: true });
  }
  let uteis = cotas.filter(c => c.eixo);
  if (!uteis.length) return { ok: false, erro: 'Não foi possível calibrar a escala: nenhuma cota horizontal ou vertical legível na seção. Envie uma imagem com as cotas visíveis.' };
  if (uteis.length >= 3) { // cota que destoa da escala das demais é descartada (provável leitura errada de valor ou de extremo)
    const e = uteis.map(c => c.valor / c.compPx).sort((a, b) => a - b);
    const med = e.length % 2 ? e[(e.length - 1) / 2] : (e[e.length / 2 - 1] + e[e.length / 2]) / 2;
    uteis = uteis.filter(c => {
      if (Math.abs(c.valor / c.compPx / med - 1) <= 0.15) return true;
      avisos.push({ texto: `A cota ${c.texto} destoa da escala das outras e foi ignorada na calibração (confira o valor lido).`, grave: true });
      return false;
    });
  }
  uteis.forEach(c => { c.usada = true; });
  const ls = arr => arr.reduce((s, c) => s + c.valor * c.compPx, 0) / arr.reduce((s, c) => s + c.compPx * c.compPx, 0);
  const xs = uteis.filter(c => c.eixo === 'x'), ys = uteis.filter(c => c.eixo === 'y');
  let kx, ky;
  if (xs.length && ys.length) {
    const sx = ls(xs), sy = ls(ys);
    if (Math.abs(sx / sy - 1) > 0.04) {
      kx = sx; ky = sy;
      avisos.push({ texto: `As escalas horizontal e vertical da imagem diferem em ${arred(Math.abs(sx / sy - 1) * 100, 1)}%: a imagem pode estar esticada. Cada eixo foi calibrado separado.`, grave: true });
    } else kx = ky = ls(uteis);
  } else {
    kx = ky = ls(uteis);
    avisos.push({ texto: `Só há cotas na ${xs.length ? 'horizontal' : 'vertical'}: a escala do outro eixo foi assumida igual.`, grave: false });
  }
  for (const c of uteis) {
    const medido = c.compPx * (c.eixo === 'x' ? kx : ky);
    if (Math.abs(medido - c.valor) / c.valor > 0.06) avisos.push({ texto: `A cota ${c.texto} mede ${fmt(medido)} mm na escala das demais: confira o valor lido.`, grave: true });
  }
  return { ok: true, kx, ky };
}

// ---------------------------------------------------------------------------------------------------------------
// 3/4. geometria
// ---------------------------------------------------------------------------------------------------------------
function agrupar(pts, i, tol) { // coordenadas com intervalo de até `tol` entre vizinhas (e no máximo 1,5*tol no grupo) viram a média do grupo
  const ordem = pts.map((_, k) => k).sort((a, b) => pts[a][i] - pts[b][i]);
  const grupos = []; let g = null, ini = 0, ant = 0;
  for (const k of ordem) {
    const v = pts[k][i];
    if (!g || v - ant > tol || v - ini > 1.5 * tol) { g = []; grupos.push(g); ini = v; }
    g.push(k); ant = v;
  }
  for (const gr of grupos) { const m = gr.reduce((s, k) => s + pts[k][i], 0) / gr.length; gr.forEach(k => { pts[k][i] = m; }); }
}
const valoresUnicos = (pts, i) => { const v = [...new Set(pts.map(p => p[i]))]; return v.sort((a, b) => a - b); };
const maisProximo = (vals, x) => vals.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
const areaAssinada = p => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

function limparPoligono(poli) {
  const p = poli.map(q => [q[0], q[1]]);
  let mudou = true;
  while (mudou && p.length >= 3) {
    mudou = false;
    for (let i = 0; i < p.length && !mudou; i++) { // ponto repetido em sequência
      const j = (i + 1) % p.length;
      if (Math.abs(p[i][0] - p[j][0]) < 1e-9 && Math.abs(p[i][1] - p[j][1]) < 1e-9) { p.splice(j, 1); mudou = true; }
    }
    for (let i = 0; i < p.length && !mudou && p.length >= 3; i++) { // colinear redundante (ou "bico" que volta sobre si mesmo)
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const comp = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const cruz = (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
      if (comp < 1e-9 || Math.abs(cruz) / comp <= 0.03) { p.splice(i, 1); mudou = true; }
    }
  }
  return p;
}
function orientar(p) { // anti-horário (y para cima), começando pelo ponto mais baixo e mais à esquerda
  let q = areaAssinada(p) < 0 ? p.slice().reverse() : p.slice();
  let ini = 0;
  q.forEach((pt, i) => { if (pt[1] < q[ini][1] - 1e-9 || (Math.abs(pt[1] - q[ini][1]) < 1e-9 && pt[0] < q[ini][0])) ini = i; });
  return q.slice(ini).concat(q.slice(0, ini));
}
function distPontoSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function estimarParede(contorno, oco) {
  if (!oco) return null;
  let min = Infinity;
  const varre = (pts, poli) => pts.forEach(p => poli.forEach((a, i) => { const d = distPontoSeg(p, a, poli[(i + 1) % poli.length]); if (d > 0.05 && d < min) min = d; }));
  varre(oco, contorno); varre(contorno, oco);
  return Number.isFinite(min) ? grade(min) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// proposta
// ---------------------------------------------------------------------------------------------------------------
function resumoAchado(l) {
  return { contornoPontos: l.contorno.length, vazados: l.vazados.length, vazadosPontos: l.vazados.map(v => v.length), cotas: l.cotas.map(c => ({ texto: c.texto, valor: c.valor })), canalVidro: !!l.canal, junta: l.junta, descartadas: l.descartadas || 0 };
}
const r1 = v => Math.round(v * 10) / 10;

// leitura: saída de normalizarResposta (pixels). meta: { codigo, modelo, largura, altura } (a imagem em pixels)
function montarProposta(leitura, meta) {
  const avisos = []; // { texto, grave }
  const av = (texto, grave = false) => avisos.push({ texto, grave });
  const achado = resumoAchado(leitura);
  const imagem = { largura: meta.largura, altura: meta.altura };
  const falha = (erros, sobreposicao) => ({ ok: false, erros, achado, imagem, ...(sobreposicao ? { sobreposicao } : {}), avisos: avisos.map(a => a.texto), observacoes: leitura.observacoes || '' });
  if (leitura.naoEncontrada) return falha(['A imagem não parece ter uma seção transversal legível do perfil. Envie a seção limpa (vista de corte), com as cotas.']);

  // calibração
  const cotas = leitura.cotas.map(c => ({ ...c }));
  const esc = calibrarEscala(cotas, avisos);
  if (!esc.ok) return falha([esc.erro]);
  let { kx, ky } = esc;

  // origem: canto inferior esquerdo do contorno lido
  const ox = Math.min(...leitura.contorno.map(p => p[0])), oy = Math.max(...leitura.contorno.map(p => p[1]));
  const extX = (Math.max(...leitura.contorno.map(p => p[0])) - ox) * kx, extY = (oy - Math.min(...leitura.contorno.map(p => p[1]))) * ky;
  if (!(extX > 0.5 && extY > 0.5)) return falha(['O contorno lido é pequeno demais para ser uma seção de perfil.']);

  // estica cada eixo para a cota que representa a medida total, se ela bater (até 6%)
  for (const eixo of ['x', 'y']) {
    const ext = eixo === 'x' ? extX : extY, rotulo = eixo === 'x' ? 'largura' : 'altura';
    const cand = cotas.filter(c => c.usada && c.eixo === eixo).map(c => c.valor);
    const melhor = cand.length ? cand.reduce((a, b) => (Math.abs(b - ext) < Math.abs(a - ext) ? b : a)) : null;
    if (melhor !== null && Math.abs(melhor - ext) / melhor <= TOL_ESTICAR) { if (eixo === 'x') kx *= melhor / ext; else ky *= melhor / ext; }
    else av(`A ${rotulo} medida no desenho (${fmt(ext)} mm) não tem uma cota correspondente na imagem: ela vem só da escala.`, true);
  }

  let tx = 0, ty = 0;
  const aMm = p => [(p[0] - ox) * kx - tx, (oy - p[1]) * ky - ty];
  const contorno = leitura.contorno.map(aMm);
  const vazados = leitura.vazados.map(v => v.map(aMm));
  let canalPts = null;
  if (leitura.canal) canalPts = [aMm([leitura.canal.x0, leitura.canal.y1]), aMm([leitura.canal.x1, leitura.canal.y1])];
  else av('O canal do vidro não foi encontrado na imagem.', true);
  const todos = () => [...contorno, ...vazados.flat(), ...(canalPts || [])];

  // ângulos retos: coordenadas quase iguais viram uma só
  const tol = Math.min(0.8, Math.max(0.3, 3 * (kx + ky) / 2)); // ~3 pixels
  agrupar(todos(), 0, tol); agrupar(todos(), 1, tol);
  const encostar = () => { // desloca tudo para o contorno começar em 0,0
    const mx = Math.min(...contorno.map(p => p[0])), my = Math.min(...contorno.map(p => p[1]));
    todos().forEach(p => { p[0] -= mx; p[1] -= my; });
    tx += mx; ty += my;
  };
  encostar();

  // cotas lidas forçam a distância exata entre os dois lados que medem
  const fixos = [[0], [0]];
  const ehFixo = (i, v) => fixos[i].some(f => Math.abs(f - v) < 1e-9);
  const mover = (i, de, para) => { todos().forEach(p => { if (Math.abs(p[i] - de) < 1e-9) p[i] = para; }); fixos[i] = fixos[i].map(f => (Math.abs(f - de) < 1e-9 ? para : f)); };
  const extremo = (c, p) => (c.eixo === 'x' ? (p[0] - ox) * kx - tx : (oy - p[1]) * ky - ty);
  for (const c of cotas.filter(k => k.usada).sort((a, b) => b.valor - a.valor)) {
    const i = c.eixo === 'x' ? 0 : 1;
    const vals = valoresUnicos(todos(), i);
    const e1 = extremo(c, c.p1), e2 = extremo(c, c.p2);
    const n1 = maisProximo(vals, e1), n2 = maisProximo(vals, e2);
    if (Math.abs(n1 - e1) > RAIO_COTA_MM || Math.abs(n2 - e2) > RAIO_COTA_MM || Math.abs(n1 - n2) < 1e-9) { av(`A cota ${c.texto} não tem dois lados correspondentes no desenho lido.`, true); continue; }
    const lo = Math.min(n1, n2), hi = Math.max(n1, n2), dif = c.valor - (hi - lo);
    if (Math.abs(dif) > Math.max(0.8, 0.1 * c.valor)) { av(`A cota ${c.texto} não confere com o desenho lido (o desenho mede ${fmt(hi - lo)} mm).`, true); continue; }
    if (Math.abs(dif) >= 0.005) {
      if (ehFixo(i, lo) && ehFixo(i, hi)) { av(`A cota ${c.texto} conflita com outras já aplicadas; o desenho mede ${fmt(hi - lo)} mm.`, true); continue; }
      if (ehFixo(i, hi)) mover(i, lo, hi - c.valor); else mover(i, hi, lo + c.valor);
    }
    const novos = valoresUnicos(todos(), i);
    [maisProximo(novos, e1), maisProximo(novos, e2)].forEach(v => { if (!ehFixo(i, v)) fixos[i].push(v); });
  }

  // grade de 0,05 mm e limpeza
  todos().forEach(p => { p[0] = grade(p[0]); p[1] = grade(p[1]); });
  let c0 = limparPoligono(contorno);
  if (c0.length < 3) return falha(['O contorno externo ficou degenerado depois do ajuste às cotas.']);
  c0 = orientar(c0);
  let v0 = [];
  vazados.forEach((v, k) => {
    const l = limparPoligono(v);
    if (l.length < 3 || Math.abs(areaAssinada(l)) < 0.5) { av(`O vazado ${k + 1} ficou pequeno demais depois do ajuste e foi descartado.`, true); return; }
    v0.push(orientar(l));
  });
  v0.sort((a, b) => Math.abs(areaAssinada(b)) - Math.abs(areaAssinada(a)));
  // sobra algum deslocamento? (contorno precisa começar em 0,0)
  const mx = Math.min(...c0.map(p => p[0])), my = Math.min(...c0.map(p => p[1]));
  if (mx !== 0 || my !== 0) { [c0, ...v0].forEach(poly => poly.forEach(p => { p[0] = grade(p[0] - mx); p[1] = grade(p[1] - my); })); if (canalPts) canalPts.forEach(p => { p[0] = grade(p[0] - mx); p[1] = grade(p[1] - my); }); tx += mx; ty += my; }
  const largura = grade(Math.max(...c0.map(p => p[0]))), altura = grade(Math.max(...c0.map(p => p[1])));

  // canal do vidro
  let canalVidro;
  if (canalPts) {
    const x0 = Math.max(0, grade(Math.min(canalPts[0][0], canalPts[1][0]))), x1 = Math.min(largura, grade(Math.max(canalPts[0][0], canalPts[1][0])));
    const y0 = Math.min(altura, Math.max(0, grade(canalPts[0][1])));
    if (x1 - x0 >= 0.3) canalVidro = { x0, x1, y0 }; else av('O canal do vidro ficou estreito demais depois do ajuste.', true);
  }

  // parede, junta, cores
  const estimada = [];
  let parede = estimarParede(c0, v0[0] || null);
  if (!(parede > 0 && parede <= Math.min(largura, altura) / 2)) parede = Math.min(PAREDE_PADRAO, grade(Math.min(largura, altura) / 2));
  estimada.push('parede');
  av(`Espessura da parede (${fmt(parede)} mm) é uma ESTIMATIVA (menor espessura entre o contorno e o oco): confira e corrija se preciso.`);
  let junta = leitura.junta;
  if (!junta) { junta = 'reta'; estimada.push('junta'); av('A imagem não diz como as peças se encontram nos cantos: marquei junta reta. Informe se o corte é a 45° ou reto.'); }

  const secao = { versao: 2, codigo: meta.codigo, modelo: meta.modelo, largura, altura, contorno: c0, vazados: v0, canalVidro, parede, junta, cores: { padrao: COR_PADRAO, porAcabamento: {} }, estimada };

  // conversões para desenhar por cima da imagem e para a conferência
  const paraPx = (x, y) => [r1(ox + (x + tx) / kx), r1(oy - (y + ty) / ky)];
  const todosFinal = [...c0, ...v0.flat(), ...(canalVidro ? [[canalVidro.x0, canalVidro.y0], [canalVidro.x1, canalVidro.y0]] : [])];
  const valsFinal = [valoresUnicos(todosFinal, 0), valoresUnicos(todosFinal, 1)];
  const cotasLidas = leitura.cotas.map(orig => {
    const c = cotas.find(k => k.p1 === orig.p1) || orig;
    const eixo = c.eixo || null, i = eixo === 'x' ? 0 : 1;
    let desenho = null;
    if (eixo) {
      const e1 = extremo(c, c.p1), e2 = extremo(c, c.p2);
      const n1 = maisProximo(valsFinal[i], e1), n2 = maisProximo(valsFinal[i], e2);
      if (Math.abs(n1 - e1) <= RAIO_COTA_MM && Math.abs(n2 - e2) <= RAIO_COTA_MM && Math.abs(n1 - n2) > 1e-9) desenho = arred(Math.abs(n2 - n1), 2);
    }
    const bate = desenho !== null && Math.abs(desenho - c.valor) <= TOL_BATE_MM;
    return { texto: c.texto, valor: c.valor, eixo, desenho, bate, entrouNaEscala: !!c.usada, p1: [r1(c.p1[0]), r1(c.p1[1])], p2: [r1(c.p2[0]), r1(c.p2[1])] };
  });
  cotasLidas.filter(c => !c.bate).forEach(c => av(c.desenho === null ? `Cota ${c.texto} mm: não encontrei os dois lados no desenho gerado.` : `Cota ${c.texto} mm: o desenho gerado mede ${fmt(c.desenho)} mm.`, true));
  if (leitura.descartadas) av(`${leitura.descartadas} cota(s) ilegível(is) foram ignoradas.`);
  const sobreposicao = {
    contorno: c0.map(p => paraPx(p[0], p[1])), vazados: v0.map(v => v.map(p => paraPx(p[0], p[1]))),
    canal: canalVidro ? (() => { const a = paraPx(canalVidro.x0, canalVidro.y0), b = paraPx(canalVidro.x1, canalVidro.y0); return { x0: a[0], x1: b[0], y1: a[1], y0: r1(Math.min(leitura.canal.y0, a[1] - 4)) }; })() : null,
    cotas: cotasLidas.map(c => ({ texto: c.texto, p1: c.p1, p2: c.p2, bate: c.bate }))
  };

  if (!canalVidro) return falha(['Não foi possível definir o canal do vidro (faixa onde o vidro encaixa).'], sobreposicao);
  const erros = PS.validar(PS.normalizar(secao));
  if (erros.length) return falha(erros, sobreposicao);

  // confiança
  let conf = 1;
  for (const i of leitura.incertezas) conf = Math.min(conf, FATOR_INCERTEZA[i.nivel]);
  for (const c of leitura.cotas) conf = Math.min(conf, FATOR_INCERTEZA[c.incerteza] + 0.1);
  conf -= Math.min(0.5, 0.12 * cotasLidas.filter(c => !c.bate).length);
  conf -= Math.min(0.3, 0.05 * avisos.filter(a => a.grave).length);
  conf = Math.max(0.05, Math.min(1, arred(conf, 2)));
  const confianca = { valor: conf, nivel: conf >= 0.8 ? 'alta' : conf >= 0.55 ? 'media' : 'baixa' };

  return {
    ok: true, secao: PS.normalizar(secao), sobreposicao, cotasLidas, avisos: avisos.map(a => a.texto), confianca, imagem,
    calibracao: { mmPorPx: (kx + ky) / 2, origem: { px: paraPx(0, 0)[0], py: paraPx(0, 0)[1] } },
    observacoes: leitura.observacoes || '', incertezas: leitura.incertezas
  };
}

module.exports = { GRADE, LIM, normalizarResposta, calibrarEscala, montarProposta, limparPoligono, estimarParede, lerValor };
