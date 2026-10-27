// ============================================================
// PLANO DE CORTE — otimização de varas e retalhos. Função pura e determinística (sem acaso, sem banco).
// Regra de encaixe igual à do VB (frm_aproveitamento_vara.vb, CalcularFFD): cabe se
//   soma das peças + (peças já na barra × serra) + tamanho ≤ comprimento   (n peças usam n−1 serras).
// O corte final da ponta (quando sobra material) é descontado da sobra informada.
// Todas as medidas são mm inteiros.
// ============================================================
const { chaveGrupo } = require('./corte_pecas');

const PADRAO = { comprimentoVara: 6000, serra: 3, sobraMinima: 500 };
const LIMITE_NOS = 200000;       // teto da busca exata
const MAX_PECAS_EXATO = 12;      // busca exata só em grupos pequenos

// linhasConfig: linhas de web_corte_config (perfil NULL = padrão). Cada campo cai para o padrão se estiver nulo.
function resolverParametros(linhasConfig, perfil) {
  const linhas = linhasConfig || [];
  const doPerfil = (perfil && linhas.find(l => l.perfil === perfil)) || {};
  const geral = linhas.find(l => !l.perfil) || {};   // perfil '' (ou nulo) = padrão
  const pega = (campo, padrao) => doPerfil[campo] ?? geral[campo] ?? padrao;
  return {
    comprimentoVara: Number(pega('comprimento_vara', PADRAO.comprimentoVara)),
    serra: Number(pega('serra', PADRAO.serra)),
    sobraMinima: Number(pega('sobra_minima', PADRAO.sobraMinima))
  };
}

const novaBarra = (tipo, comprimento, retalhoId = null) => ({ tipo, retalhoId, comprimento, pecas: [], soma: 0 });
const cabe = (b, t, serra) => b.soma + t + b.pecas.length * serra <= b.comprimento;
const colocar = (b, p) => { b.pecas.push(p); b.soma += p.tamanho; };
// livre depois das n−1 serras entre as peças; sobra útil = livre menos o corte final
const livre = (b, serra) => b.comprimento - b.soma - Math.max(0, b.pecas.length - 1) * serra;
const sobraDe = (b, serra) => { const l = livre(b, serra); return l >= serra ? l - serra : 0; };

// menor é melhor: [varas novas, comprimento total usado (=> maior aproveitamento), sobras pequenas que viram descarte]
function pontuacao(barras, p) {
  const usadas = barras.filter(b => b.pecas.length);
  const pequenas = usadas.filter(b => { const s = sobraDe(b, p.serra); return s > 0 && s < p.sobraMinima; }).length;
  return [usadas.filter(b => b.tipo === 'vara').length, usadas.reduce((s, b) => s + b.comprimento, 0), pequenas];
}
const comparar = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

function guloso(pecas, retalhos, p, ordemRetalhos, escolha) {
  const barras = [...retalhos].sort((a, b) => (ordemRetalhos === 'asc' ? a.comprimento - b.comprimento : b.comprimento - a.comprimento) || a.id - b.id)
    .map(r => novaBarra('retalho', r.comprimento, r.id));
  for (const peca of pecas) {
    let alvo = null;
    for (const b of barras) {
      if (!cabe(b, peca.tamanho, p.serra)) continue;
      if (escolha === 'primeiro') { alvo = b; break; }
      if (!alvo || livre(b, p.serra) - peca.tamanho < livre(alvo, p.serra) - peca.tamanho) alvo = b;   // melhor encaixe: menos folga
    }
    if (!alvo) { alvo = novaBarra('vara', p.comprimentoVara); barras.push(alvo); }
    colocar(alvo, peca);
  }
  return barras;
}

// Busca exata (ramifica e poda) para grupos pequenos; parte da melhor solução gulosa como limite
function exato(pecas, retalhos, p, melhorGulosa) {
  let melhor = melhorGulosa, melhorPont = pontuacao(melhorGulosa, p), nos = 0;
  const barras = [...retalhos].sort((a, b) => a.comprimento - b.comprimento || a.id - b.id).map(r => novaBarra('retalho', r.comprimento, r.id));
  const copia = () => barras.map(b => ({ ...b, pecas: [...b.pecas] }));
  function dfs(i, varasNovas) {
    if (++nos > LIMITE_NOS || varasNovas > melhorPont[0]) return;
    if (i === pecas.length) {
      const pont = pontuacao(barras, p);
      if (comparar(pont, melhorPont) < 0) { melhorPont = pont; melhor = copia(); }
      return;
    }
    const peca = pecas[i], vistos = new Set();
    for (const b of barras) {
      if (!cabe(b, peca.tamanho, p.serra)) continue;
      const chave = `${b.tipo}|${b.comprimento}|${b.soma}|${b.pecas.length}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      colocar(b, peca);
      dfs(i + 1, varasNovas);
      b.pecas.pop(); b.soma -= peca.tamanho;
    }
    if (varasNovas + 1 <= melhorPont[0]) {
      const v = novaBarra('vara', p.comprimentoVara);
      barras.push(v); colocar(v, peca);
      dfs(i + 1, varasNovas + 1);
      barras.pop();
    }
  }
  dfs(0, 0);
  return melhor;
}

function planoDoGrupo(pecas, retalhos, p) {
  const ordenadas = pecas.map((x, i) => ({ x, i })).sort((a, b) => b.x.tamanho - a.x.tamanho || a.i - b.i).map(o => o.x);
  const candidatos = [guloso(ordenadas, retalhos, p, 'asc', 'primeiro'), guloso(ordenadas, retalhos, p, 'asc', 'melhor'),
    guloso(ordenadas, retalhos, p, 'desc', 'primeiro'), guloso(ordenadas, retalhos, p, 'desc', 'melhor')];
  let melhor = candidatos[0];
  for (const c of candidatos) if (comparar(pontuacao(c, p), pontuacao(melhor, p)) < 0) melhor = c;
  if (ordenadas.length <= MAX_PECAS_EXATO) melhor = exato(ordenadas, retalhos, p, melhor);
  return melhor.filter(b => b.pecas.length).map(b => {
    const sobra = sobraDe(b, p.serra);
    return { tipo: b.tipo, retalhoId: b.retalhoId, comprimento: b.comprimento,
      pecas: b.pecas.map(x => ({ tamanho: x.tamanho, item: x.item, origem: x.origem })),
      sobra, destinoSobra: sobra >= p.sobraMinima ? 'guardar' : 'descartar' };
  });
}

// pecas: { perfil, acabamento, cor, tamanho, item, origem }[]; retalhos: { id, perfil, acabamento, cor, comprimento }[]
function otimizar({ pecas = [], retalhos = [], parametrosDe }) {
  const grupos = new Map(), erros = [];
  for (const peca of pecas) {
    const p = parametrosDe(peca.perfil);
    if (peca.tamanho > p.comprimentoVara) { erros.push({ peca, motivo: `Peça de ${peca.tamanho} mm maior que a vara de ${p.comprimentoVara} mm.` }); continue; }
    const k = chaveGrupo(peca);
    if (!grupos.has(k)) grupos.set(k, { chave: k, perfil: peca.perfil, acabamento: peca.acabamento, cor: peca.cor, pecas: [] });
    grupos.get(k).pecas.push(peca);
  }
  const saida = [...grupos.values()].sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0)).map(g => ({
    chave: g.chave, perfil: g.perfil, acabamento: g.acabamento, cor: g.cor,
    barras: planoDoGrupo(g.pecas, retalhos.filter(r => chaveGrupo(r) === g.chave), parametrosDe(g.perfil))
  }));
  const todas = saida.flatMap(g => g.barras);
  const somaPecas = todas.reduce((s, b) => s + b.pecas.reduce((t, x) => t + x.tamanho, 0), 0);
  const total = todas.reduce((s, b) => s + b.comprimento, 0);
  return {
    grupos: saida, erros,
    resumo: {
      qtdVarasNovas: todas.filter(b => b.tipo === 'vara').length,
      qtdRetalhosUsados: todas.filter(b => b.tipo === 'retalho').length,
      aproveitamentoPct: total ? Math.round(somaPecas * 1000 / total) / 10 : 0,
      sobraSomaMm: todas.reduce((s, b) => s + b.sobra, 0)   // não usar "total" no nome: REGEX_VALOR apagaria o campo
    }
  };
}

module.exports = { PADRAO, resolverParametros, otimizar };
