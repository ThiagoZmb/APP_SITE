// ============================================================
// PLANO DE CORTE DE VIDROS — encaixe 2D das peças em chapas e retalhos. Função pura e determinística
// (sem acaso, sem banco). Medidas em mm inteiros; x corre ao longo da LARGURA e y ao longo da ALTURA.
// Corte em guilhotina (todo risco vai de ponta a ponta do pedaço que está sendo cortado) e a peça pode
// girar 90°. A folga de serra é descontada de cada risco que separa duas partes.
// Por grupo (modelo|cor) gera vários candidatos e fica com o melhor:
//  - guilhotina por retângulos livres: a peça vai ao retângulo livre de melhor encaixe por área (empate:
//    a rotação com menor sobra no lado curto); o resto do retângulo é dividido em dois pelo eixo de
//    menor sobra (o risco mais longo fica do lado da sobra maior, que continua inteira);
//  - por faixas (shelf), "em pé" (gira só se precisar) e "deitada" (abre faixa com a peça mais baixa);
//  cada um com 4 ordens de peças (área, lado maior, altura, largura; decrescentes, empate = ordem de entrada).
// Em todos, os retalhos do mesmo produto (área crescente) vêm antes de chapa nova.
// Escolha: menos chapas novas → menor área de peças em chapa nova (mais peças em retalho) → menos
// retângulos livres com algum lado < sobraMinima; empate = primeiro candidato da lista (determinismo).
// Nunca usa mais chapas novas que a melhor variante por faixas (guarda explícita, testada).
// ============================================================
const { chaveGrupoVidro } = require('./vidro_pecas');

const PADRAO = { serra: 0, sobraMinima: 300 };

const inteiro = v => (v === null || v === undefined || v === '' ? NaN : Math.round(Number(v)));
const naoNegativo = (v, padrao) => { const n = inteiro(v); return Number.isFinite(n) && n >= 0 ? n : padrao; };
const area = r => r.altura * r.largura;
const comparar = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const compararId = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

// orientações possíveis da peça; a sem giro vem primeiro (empates ficam sem girar)
function orientacoes(p) {
  const o = [{ altura: p.altura, largura: p.largura, girada: false }];
  if (p.altura !== p.largura) o.push({ altura: p.largura, largura: p.altura, girada: true });
  return o;
}

const ORDENS = [area, p => Math.max(p.altura, p.largura), p => p.altura, p => p.largura];
const ordenar = (pecas, chave) => pecas.map((x, i) => ({ x, i })).sort((a, b) => chave(b.x) - chave(a.x) || a.i - b.i).map(o => o.x);

const novoPedaco = (tipo, dim, retalhoId) => ({ tipo, retalhoId, altura: dim.altura, largura: dim.largura, pecas: [],
  livres: [{ x: 0, y: 0, altura: dim.altura, largura: dim.largura }], faixas: [], topo: 0 });
const pedacosIniciais = retalhos => retalhos.map(r => novoPedaco('retalho', r, r.id));
const colocada = (peca, o, x, y) => ({ x, y, altura: o.altura, largura: o.largura, girada: o.girada, item: peca.item, medicao: peca.medicao });

// ---------- guilhotina por retângulos livres ----------
function cortarLivre(ped, idx, o, peca, serra) {
  const r = ped.livres[idx];
  ped.livres.splice(idx, 1);
  ped.pecas.push(colocada(peca, o, r.x, r.y));
  const sobraL = r.largura - o.largura, sobraA = r.altura - o.altura;
  const direita = { x: r.x + o.largura + serra, y: r.y, largura: sobraL - serra, altura: sobraL < sobraA ? o.altura : r.altura };
  const cima = { x: r.x, y: r.y + o.altura + serra, altura: sobraA - serra, largura: sobraL < sobraA ? r.largura : o.largura };
  for (const n of [direita, cima]) if (n.largura > 0 && n.altura > 0) ped.livres.push(n);
}

// melhor retângulo livre (menor sobra de área; empate: menor sobra no lado curto; depois a ordem dos pedaços)
function melhorEncaixe(pedacos, peca) {
  let melhor = null;
  pedacos.forEach((ped, ip) => ped.livres.forEach((r, ir) => {
    for (const o of orientacoes(peca)) {
      if (o.largura > r.largura || o.altura > r.altura) continue;
      const nota = [area(r) - area(o), Math.min(r.largura - o.largura, r.altura - o.altura)];
      if (!melhor || comparar(nota, melhor.nota) < 0) melhor = { nota, ped, ir, o };
    }
  }));
  return melhor;
}

function porGuilhotina(pecas, retalhos, chapa, serra) {
  const pedacos = pedacosIniciais(retalhos);
  for (const peca of pecas) {
    let alvo = melhorEncaixe(pedacos, peca);
    if (!alvo) {   // nada aberto serve: chapa nova (a peça cabe nela, conferido antes)
      pedacos.push(novoPedaco('chapa', chapa));
      alvo = melhorEncaixe(pedacos.slice(-1), peca);
    }
    cortarLivre(alvo.ped, alvo.ir, alvo.o, peca, serra);
  }
  return pedacos;
}

// ---------- por faixas (shelf) ----------
function tentarFaixa(ped, peca, serra, modo) {
  for (const f of ped.faixas) {
    const x = f.xFim + serra;
    const cabem = orientacoes(peca).filter(o => o.altura <= f.altura && x + o.largura <= ped.largura);
    if (!cabem.length) continue;
    const o = cabem.reduce((a, b) => (b.altura > a.altura ? b : a));   // a mais alta preenche melhor a faixa
    const p = colocada(peca, o, x, f.y);
    ped.pecas.push(p); f.pecas.push(p); f.xFim = x + o.largura;
    return true;
  }
  const y = ped.faixas.length ? ped.topo + serra : 0;
  const cabem = orientacoes(peca).filter(o => o.largura <= ped.largura && y + o.altura <= ped.altura);
  if (!cabem.length) return false;
  const o = modo === 'deitada' ? cabem.reduce((a, b) => (b.altura < a.altura ? b : a)) : cabem[0];
  const p = colocada(peca, o, 0, y);
  ped.pecas.push(p);
  ped.faixas.push({ y, altura: o.altura, xFim: o.largura, pecas: [p] });
  ped.topo = y + o.altura;
  return true;
}

// retângulos livres de um pedaço cortado em faixas: acima de cada peça (dentro da faixa), fim de cada faixa e o topo
function livresDasFaixas(ped, serra) {
  const livres = [];
  for (const f of ped.faixas) {
    for (const p of f.pecas) livres.push({ x: p.x, y: p.y + p.altura + serra, largura: p.largura, altura: f.altura - p.altura - serra });
    livres.push({ x: f.xFim + serra, y: f.y, largura: ped.largura - f.xFim - serra, altura: f.altura });
  }
  livres.push({ x: 0, y: ped.topo + serra, largura: ped.largura, altura: ped.altura - ped.topo - serra });
  return livres.filter(r => r.largura > 0 && r.altura > 0);
}

function porFaixas(pecas, retalhos, chapa, serra, modo) {
  const pedacos = pedacosIniciais(retalhos);
  for (const peca of pecas) {
    if (pedacos.some(ped => tentarFaixa(ped, peca, serra, modo))) continue;
    const ped = novoPedaco('chapa', chapa);
    pedacos.push(ped);
    tentarFaixa(ped, peca, serra, modo);
  }
  for (const ped of pedacos) if (ped.faixas.length) ped.livres = livresDasFaixas(ped, serra);
  return pedacos;
}

// ---------- escolha ----------
function nota(pedacos, sobraMinima) {
  const usados = pedacos.filter(p => p.pecas.length), novos = usados.filter(p => p.tipo === 'chapa');
  return [novos.length,
    novos.reduce((s, p) => s + p.pecas.reduce((t, x) => t + area(x), 0), 0),
    usados.reduce((s, p) => s + p.livres.filter(r => r.largura < sobraMinima || r.altura < sobraMinima).length, 0)];
}
const melhorDe = (candidatos, sobraMinima) => candidatos.reduce((m, c) => (comparar(nota(c, sobraMinima), nota(m, sobraMinima)) < 0 ? c : m));

function candidatosPorFaixas(pecas, retalhos, chapa, p, modo) {
  return ORDENS.map(ordem => porFaixas(ordenar(pecas, ordem), retalhos, chapa, p.serra, modo));
}

function planoDoGrupo(pecas, retalhos, chapa, p) {
  const guilhotina = ORDENS.map(ordem => porGuilhotina(ordenar(pecas, ordem), retalhos, chapa, p.serra));
  const faixas = [...candidatosPorFaixas(pecas, retalhos, chapa, p, 'em_pe'), ...candidatosPorFaixas(pecas, retalhos, chapa, p, 'deitada')];
  let melhor = melhorDe([...guilhotina, ...faixas], p.sobraMinima);
  const melhorFaixas = melhorDe(faixas, p.sobraMinima);
  if (nota(melhor, p.sobraMinima)[0] > nota(melhorFaixas, p.sobraMinima)[0]) melhor = melhorFaixas;   // guarda
  return melhor.filter(ped => ped.pecas.length).map(ped => ({
    tipo: ped.tipo, ...(ped.tipo === 'retalho' ? { retalhoId: ped.retalhoId } : {}),
    altura: ped.altura, largura: ped.largura, pecas: ped.pecas,
    sobras: ped.livres.filter(r => r.altura >= p.sobraMinima && r.largura >= p.sobraMinima)
      .sort((a, b) => a.y - b.y || a.x - b.x).map(r => ({ x: r.x, y: r.y, altura: r.altura, largura: r.largura })),
    aproveitamentoPct: Math.round(ped.pecas.reduce((s, x) => s + area(x), 0) * 1000 / area(ped)) / 10
  }));
}

// pecas: de montarPecasVidro; retalhos: { id, produtoCodigo, altura, largura }[];
// chapaDe(chave) -> { produtoCodigo, produtoNome, altura, largura } | null; parametros: { serra, sobraMinima }
function otimizarVidros({ pecas = [], retalhos = [], chapaDe, parametros = {} }) {
  const p = { serra: naoNegativo(parametros?.serra, PADRAO.serra), sobraMinima: naoNegativo(parametros?.sobraMinima, PADRAO.sobraMinima) };
  const porChave = new Map();
  for (const peca of pecas) {
    const k = chaveGrupoVidro(peca);
    if (!porChave.has(k)) porChave.set(k, { chave: k, modelo: peca.modelo, cor: peca.cor, pecas: [] });
    porChave.get(k).pecas.push(peca);
  }
  const livresRet = retalhos.map(r => ({ ...r, altura: inteiro(r.altura), largura: inteiro(r.largura) }))
    .filter(r => r.altura > 0 && r.largura > 0)
    .sort((a, b) => area(a) - area(b) || compararId(a.id, b.id));
  const retalhosUsados = new Set();   // um retalho serve a um grupo só (dois grupos podem ter o mesmo produto)
  let qtdPecasSemChapa = 0;

  const grupos = [...porChave.values()].sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0)).map(g => {
    const base = { chave: g.chave, modelo: g.modelo, cor: g.cor };
    const escolhida = chapaDe(g.chave);
    if (!escolhida) {
      qtdPecasSemChapa += g.pecas.length;
      return { ...base, produtoCodigo: null, produtoNome: null, aguardandoProduto: true, chapa: null, chapas: [], erros: [] };
    }
    const chapa = { altura: inteiro(escolhida.altura), largura: inteiro(escolhida.largura) };
    const grupo = { ...base, produtoCodigo: escolhida.produtoCodigo, produtoNome: escolhida.produtoNome,
      aguardandoProduto: false, chapa, chapas: [], erros: [] };
    if (!(chapa.altura > 0 && chapa.largura > 0)) {
      grupo.erros.push(`Chapa do produto ${escolhida.produtoNome ?? escolhida.produtoCodigo} com medida inválida ` +
        `(${escolhida.altura} x ${escolhida.largura} mm); confira a altura e a largura no estoque.`);
      qtdPecasSemChapa += g.pecas.length;
      return grupo;
    }
    const validas = [];
    for (const peca of g.pecas) {
      const a = inteiro(peca.altura), l = inteiro(peca.largura);
      if (!(a > 0 && l > 0)) grupo.erros.push(`Peça do item ${peca.item} sem medida válida (${peca.altura} x ${peca.largura} mm).`);
      else if (!orientacoes({ altura: a, largura: l }).some(o => o.altura <= chapa.altura && o.largura <= chapa.largura))
        grupo.erros.push(`Peça do item ${peca.item} (${a} x ${l} mm) maior que a chapa de ${chapa.altura} x ${chapa.largura} mm, mesmo girada.`);
      else { validas.push({ ...peca, altura: a, largura: l }); continue; }
      qtdPecasSemChapa++;
    }
    if (validas.length) {
      const doProduto = livresRet.filter(r => !retalhosUsados.has(r.id) && String(r.produtoCodigo) === String(escolhida.produtoCodigo));
      grupo.chapas = planoDoGrupo(validas, doProduto, chapa, p);
      for (const ch of grupo.chapas) if (ch.tipo === 'retalho') retalhosUsados.add(ch.retalhoId);
    }
    return grupo;
  });

  const todas = grupos.flatMap(g => g.chapas);
  return {
    grupos,
    resumo: {
      qtdChapasNovas: todas.filter(c => c.tipo === 'chapa').length,
      qtdRetalhosUsados: todas.filter(c => c.tipo === 'retalho').length,
      qtdPecas: pecas.length,
      qtdPecasSemChapa
    }
  };
}

// só para os testes: menor nº de chapas novas entre as 4 ordens da variante por faixas
function melhorPorFaixas(pecas, retalhos, chapa, parametros, modo) {
  return Math.min(...candidatosPorFaixas(pecas, retalhos, chapa, parametros, modo).map(c => nota(c, parametros.sobraMinima)[0]));
}

module.exports = { PADRAO, otimizarVidros, _internos: { melhorPorFaixas } };
