// ============================================================
// Formação de preços — parte A: custo de cada material de venda por unidade de venda,
// a partir das compras reais (entrada_estoque). Puro: recebe as linhas já lidas.
// custo = média ponderada das compras convertidas × (1 + IPI%) × (1 + frete%) ÷ (1 − perda%)
// Dado ausente → custo null + motivo (nunca zero).
// ============================================================
const { chaveMySQL } = require('./nomes');
const { unidadeDaClasse } = require('./custos_sugestao');

// "8" | "8%" | "8,5" | 5 → número; vazio → 0; texto que não é número → null (ilegível)
function lerPercentual(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).trim().replace('%', '').replace(',', '.').trim();
  if (t === '') return 0;
  return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
}

const moeda = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const SUFIXO = { m: '/m', m2: '/m²', un: '/un' };

// custo de um grupo de itens de compra equivalentes (mesmo item de fornecedores diferentes): média ponderada das compras
function custoDoGrupo({ ligacoes, itens, compras, desde, divergenciaPct, unidade }) {
  const vazio = { custo: null, precoMedio: null, ultimaCompra: null, qtdCompras: 0, referencia: null, divergencia: null, divergente: false,
    usadas: [], ignoradas: [], passos: [], unidade };

  // ligações válidas: item existe, fator > 0, percentuais legíveis
  const motivos = [];
  const ligs = [];
  for (const l of ligacoes) {
    const item = itens.get(Number(l.estoque_codigo));
    const fator = Number(l.fator);
    if (!item) { motivos.push(`item de compra não encontrado (código ${l.estoque_codigo})`); continue; }
    if (!(fator > 0)) { motivos.push(`fator inválido em ${item.NOME_PRODUTO}`); continue; }
    const ipi = lerPercentual(item.IPI), frete = lerPercentual(item.FRETE), perda = lerPercentual(item.PERDA);
    if (perda === null || perda >= 100 || perda < 0) { motivos.push(`perda ilegível ou ≥ 100% em ${item.NOME_PRODUTO}`); continue; }
    if (ipi === null || frete === null) { motivos.push(`IPI ou frete ilegível em ${item.NOME_PRODUTO}`); continue; }
    ligs.push({ item, fator, ipi, frete, perda, nome: chaveMySQL(item.NOME_PRODUTO) });
  }
  if (motivos.length) return { ...vazio, situacao: 'faltando', motivos };

  const fatorCusto = l => (1 + l.ipi / 100) * (1 + l.frete / 100) / (1 - l.perda / 100);
  const validas = [], ignoradas = [];
  for (const c of compras) {
    const l = ligs.find(x => x.nome === chaveMySQL(c.NOME_PRODUTO));
    if (!l) continue;
    const qtd = Number(c.QTD), valor = Number(c.VALOR_UNITARIO);
    const base = { nf: c.NOTA_FISCAL, data: String(c.DATA).slice(0, 10), fornecedor: c.FABRICANTE, qtd, valor, item: l.item.NOME_PRODUTO };
    if (!(qtd > 0) || !(valor > 0)) { ignoradas.push({ ...base, motivo: 'quantidade ou valor zero/negativo' }); continue; }
    const precoConvertido = valor / l.fator;
    validas.push({ ...base, fator: l.fator, precoConvertido, qtdConvertida: qtd * l.fator, custoUnitario: precoConvertido * fatorCusto(l) });
  }
  if (!validas.length) return { ...vazio, ignoradas, situacao: 'faltando', motivos: ['item nunca comprado'] };

  const ultimaCompra = validas.reduce((m, c) => (c.data > m ? c.data : m), '');
  const doPeriodo = validas.filter(c => c.data >= desde);
  const situacao = doPeriodo.length ? 'confiavel' : 'desatualizado';
  // desatualizado: só a última compra (a mais recente; empate → a última da lista)
  const usadas = doPeriodo.length ? doPeriodo : [validas.filter(c => c.data === ultimaCompra).at(-1)];

  const somaQtd = usadas.reduce((s, c) => s + c.qtdConvertida, 0);
  const precoMedio = usadas.reduce((s, c) => s + c.precoConvertido * c.qtdConvertida, 0) / somaQtd;
  const custo = usadas.reduce((s, c) => s + c.custoUnitario * c.qtdConvertida, 0) / somaQtd;

  // referência: VALOR do estoque convertido, com os mesmos percentuais (média simples dos itens com VALOR)
  const refs = ligs.filter(l => Number(l.item.VALOR) > 0).map(l => Number(l.item.VALOR) / l.fator * fatorCusto(l));
  const referencia = refs.length ? refs.reduce((s, v) => s + v, 0) / refs.length : null;
  const divergencia = referencia ? Math.abs(custo - referencia) / referencia * 100 : null;

  const suf = SUFIXO[unidade];
  const passos = [`Preço médio de compra: ${moeda(precoMedio)}${suf} (${usadas.length} compra(s)${situacao === 'desatualizado' ? ', última conhecida' : ''})`];
  if (ligs.length === 1) {
    const l = ligs[0];
    passos.push(`+ IPI ${l.ipi}%`, `+ frete ${l.frete}%`, `÷ (1 − perda ${l.perda}%)`);
  } else passos.push('Cada compra com o IPI, o frete e a perda do seu item de estoque');
  passos.push(`= Custo: ${moeda(custo)}${suf}`);

  return { situacao, motivos: [], custo, precoMedio, ultimaCompra, qtdCompras: usadas.length, referencia, divergencia,
    divergente: divergencia !== null && divergencia > divergenciaPct, usadas, ignoradas, passos, unidade };
}

const pctTxt = v => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + '%';

// Material de venda = Σ participação × componente. Sem componentes cadastrados, as ligações formam um grupo só
// (o material simples de hoje, resultado idêntico). Um componente sem custo deixa o material sem custo: nunca custo parcial.
function calcularCusto({ material, config, ligacoes, itens, compras, desde, divergenciaPct = 15, componentes = [] }) {
  const unidade = config?.unidadeVenda || unidadeDaClasse(material.CLASSE);
  const vazio = { custo: null, precoMedio: null, ultimaCompra: null, qtdCompras: 0, referencia: null, divergencia: null, divergente: false,
    usadas: [], ignoradas: [], passos: [], unidade, componentes: [] };
  if (config?.semCompra) return { ...vazio, situacao: 'sem_compra', motivos: [] };
  if (!ligacoes.length && !componentes.length) return { ...vazio, situacao: 'faltando', motivos: ['sem ligação confirmada'] };
  const comum = { itens, compras, desde, divergenciaPct, unidade };
  const implicitas = ligacoes.filter(l => l.componente_id === null || l.componente_id === undefined);
  if (!componentes.length) return { ...custoDoGrupo({ ligacoes: implicitas, ...comum }), componentes: [] };

  // ligações sem componente ao lado de componentes: entram como o componente principal (100%)
  const grupos = [...(implicitas.length ? [{ id: null, nome: null, participacao_pct: 100, ordem: -1 }] : []),
    ...[...componentes].sort((a, b) => Number(a.ordem) - Number(b.ordem) || Number(a.id) - Number(b.id))];
  const motivos = [], partes = [];
  grupos.forEach((g, i) => {
    const nome = g.nome || `Componente ${i + 1}`;
    const pct = Number(g.participacao_pct);
    const ligs = g.id === null ? implicitas : ligacoes.filter(l => Number(l.componente_id) === Number(g.id));
    const parte = { id: g.id === null ? null : Number(g.id), nome: g.nome ?? null, rotulo: nome, participacaoPct: pct, situacao: 'faltando', motivos: [],
      custo: null, precoMedio: null, parcela: null, r: null };
    partes.push(parte);
    if (!(pct > 0)) { parte.motivos = ['participação inválida']; motivos.push(`${nome}: participação inválida`); return; }
    if (!ligs.length) { parte.motivos = ['sem item do estoque']; motivos.push(`componente ${nome} sem item do estoque`); return; }
    const r = custoDoGrupo({ ligacoes: ligs, ...comum });
    Object.assign(parte, { r, situacao: r.situacao, motivos: r.motivos, custo: r.custo, precoMedio: r.precoMedio,
      parcela: r.custo === null ? null : r.custo * pct / 100 });
    if (r.custo === null) motivos.push(...r.motivos.map(m => `${nome}: ${m}`));
  });
  const marcar = (lista, p) => lista.map(c => ({ ...c, componente: p.rotulo }));
  const usadas = partes.flatMap(p => (p.r ? marcar(p.r.usadas, p) : []));
  const ignoradas = partes.flatMap(p => (p.r ? marcar(p.r.ignoradas, p) : []));
  const saidaComp = partes.map(({ r, rotulo, ...p }) => p);
  if (motivos.length) return { ...vazio, situacao: 'faltando', motivos, usadas, ignoradas, componentes: saidaComp };

  const soma = f => partes.reduce((s, p) => s + p.r[f] * p.participacaoPct / 100, 0);
  const custo = soma('custo'), precoMedio = soma('precoMedio');
  const referencia = partes.every(p => p.r.referencia !== null) ? soma('referencia') : null;
  const divergencia = referencia ? Math.abs(custo - referencia) / referencia * 100 : null;
  const ultimaCompra = partes.map(p => p.r.ultimaCompra).sort()[0];
  const suf = SUFIXO[unidade];
  const passos = [...partes.map(p => `${p.rotulo}: ${pctTxt(p.participacaoPct)} × ${moeda(p.custo)}${suf} = ${moeda(p.parcela)}${suf}`), `= Custo: ${moeda(custo)}${suf}`];
  return { situacao: partes.some(p => p.situacao === 'desatualizado') ? 'desatualizado' : 'confiavel', motivos: [], custo, precoMedio, ultimaCompra,
    qtdCompras: usadas.length, referencia, divergencia, divergente: partes.some(p => p.r.divergente), usadas, ignoradas, passos, unidade, componentes: saidaComp };
}

module.exports = { calcularCusto, lerPercentual };
