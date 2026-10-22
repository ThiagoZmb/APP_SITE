// ============================================================
// Formação de preços — partes B + C: do custo do material (parte A) ao VALOR_FIXO sugerido.
// Puro: recebe o custo já calculado, as premissas do Thiago (em %) e as margens.
//   mínimo     = custo ÷ (1 − V)
//   equilíbrio = custo ÷ (1 − V − F)
//   alvo       = custo ÷ (1 − V − F − M)
//   sugerido   = arred2(alvo ÷ (1 − D))
// V = imposto + comissão + encargos extras ativos; F = custo fixo; M = margem (material > classe > padrão); D = desconto.
// Premissa ausente → sem preço + motivo (nunca 0 implícito).
// ============================================================
const { chaveMySQL } = require('./nomes');

// meio para cima em centavos; toPrecision(15) tira o ruído de ponto flutuante (10.075 * 100 = 1007.4999…)
const arred2 = v => Math.round(Number((v * 100).toPrecision(15))) / 100;
const pct = v => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + '%';
const moeda = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const definido = v => v !== null && v !== undefined && Number.isFinite(Number(v));

function margemDo(material, margens) {
  const doMaterial = margens.materiais.get(Number(material.CODIGO));
  if (definido(doMaterial)) return { pct: Number(doMaterial), origem: 'material' };
  const daClasse = margens.classes.get(chaveMySQL(material.CLASSE));
  if (definido(daClasse)) return { pct: Number(daClasse), origem: 'classe' };
  if (definido(margens.padrao)) return { pct: Number(margens.padrao), origem: 'padrao' };
  return null;
}

// margem (%) que um VALOR_FIXO deixa depois do desconto, dos encargos e do custo fixo
function margemCom(valor, { custo, V, F }, descontoPct) {
  if (!(Number(valor) > 0) || !definido(custo) || !definido(descontoPct) || descontoPct >= 100) return null;
  return (1 - V / 100 - F / 100 - custo / (valor * (1 - descontoPct / 100))) * 100;
}

function formarPreco({ custoInfo, material, parametros, encargos, margens, descontoMax }) {
  const atual = Number(material.VALOR_FIXO) > 0 ? Number(material.VALOR_FIXO) : null;
  const r = { situacao: custoInfo.situacao, motivos: [], avisos: [], custo: custoInfo.custo ?? null, V: null, F: null, M: null, origemMargem: null,
    D: null, minimo: null, equilibrio: null, alvo: null, sugerido: null, atual, variacao: null, margemAtual: null, margemPior: null,
    gravavelPorPadrao: false, passos: [] };

  if (r.custo === null) {
    r.motivos = custoInfo.motivos?.length ? [...custoInfo.motivos] : [custoInfo.situacao === 'sem_compra' ? 'material marcado sem custo de compra' : 'sem custo'];
    return r;
  }
  const faltam = [['impostoPct', 'imposto'], ['comissaoPct', 'comissão'], ['custoFixoPct', 'custo fixo'], ['descontoPct', 'desconto']]
    .filter(([k]) => !definido(parametros[k])).map(([, nome]) => `defina o parâmetro ${nome}`);
  const margem = margemDo(material, margens);
  if (!margem) faltam.push('defina a margem padrão');
  if (faltam.length) { r.motivos = faltam; return r; }

  const extras = encargos.filter(e => Number(e.ativo)).reduce((s, e) => s + Number(e.pct), 0);
  r.V = Number(parametros.impostoPct) + Number(parametros.comissaoPct) + extras;
  r.F = Number(parametros.custoFixoPct);
  r.M = margem.pct; r.origemMargem = margem.origem;
  r.D = Number(parametros.descontoPct);
  const c = r.custo;

  if (custoInfo.usaCadastro) r.avisos.push('custo pelo valor do cadastro do estoque (sem nota de compra)');
  else if (custoInfo.situacao === 'desatualizado') r.avisos.push(`custo desatualizado (última compra ${custoInfo.ultimaCompra || '—'})`);
  if (custoInfo.divergente) r.avisos.push('custo diverge do valor do estoque');

  r.passos.push(`Custo: ${moeda(c)}`, `Encargos sobre a venda (V): ${pct(r.V)} · custo fixo (F): ${pct(r.F)} · margem (M): ${pct(r.M)} (${margem.origem}) · desconto (D): ${pct(r.D)}`);
  if (r.V >= 100) { r.motivos.push(`encargos somam ${pct(r.V)} — impossível formar preço`); return r; }
  r.minimo = c / (1 - r.V / 100);
  r.passos.push(`Mínimo = custo ÷ (1 − ${pct(r.V)}) = ${moeda(r.minimo)}`);
  if (r.V + r.F >= 100) { r.motivos.push(`encargos + custo fixo somam ${pct(r.V + r.F)} — impossível formar preço`); return r; }
  r.equilibrio = c / (1 - (r.V + r.F) / 100);
  r.passos.push(`Equilíbrio = custo ÷ (1 − ${pct(r.V + r.F)}) = ${moeda(r.equilibrio)}`);
  if (r.V + r.F + r.M >= 100) { r.motivos.push(`percentuais somam ${pct(r.V + r.F + r.M)} — impossível formar preço`); return r; }
  r.alvo = c / (1 - (r.V + r.F + r.M) / 100);
  r.passos.push(`Alvo = custo ÷ (1 − ${pct(r.V + r.F + r.M)}) = ${moeda(r.alvo)}`);
  if (r.D >= 100) { r.motivos.push(`desconto de ${pct(r.D)} — impossível sugerir VALOR_FIXO`); return r; }
  r.sugerido = arred2(r.alvo / (1 - r.D / 100));
  r.passos.push(`VALOR_FIXO sugerido = alvo ÷ (1 − ${pct(r.D)}) = ${moeda(r.sugerido)}`);

  if (atual !== null) {
    r.variacao = (r.sugerido - atual) / atual * 100;
    r.margemAtual = margemCom(atual, r, r.D);
    r.margemPior = definido(descontoMax) ? margemCom(atual, r, Number(descontoMax)) : null;
  }
  r.gravavelPorPadrao = !r.avisos.length;
  return r;
}

module.exports = { arred2, margemDo, margemCom, formarPreco };
