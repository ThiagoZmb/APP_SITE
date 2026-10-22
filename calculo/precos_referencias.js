// ============================================================
// Formação de preços — referências mostradas AO LADO das premissas (nunca usadas no cálculo).
// Puro: recebe as linhas já lidas do cadastro de clientes e o fluxo de caixa agrupado.
// ============================================================
const { lerPercentual } = require('./custos');
const { chaveMySQL } = require('./nomes');

const media = v => v.reduce((s, x) => s + x, 0) / v.length;
// mais frequente; empate → o menor
function maisFrequente(v) {
  const n = new Map();
  for (const x of v) n.set(x, (n.get(x) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

// comissão vazia não é comissão 0: vazio e texto ilegível ficam fora e são contados
function referenciaComissao(clientes) {
  const valores = [];
  let ilegiveis = 0;
  for (const c of clientes) {
    const v = String(c.COMISSAO ?? '').trim() === '' ? null : lerPercentual(c.COMISSAO);
    if (v === null) ilegiveis++; else valores.push(v);
  }
  if (!valores.length) return { media: null, maisFrequente: null, qtd: 0, ilegiveis, motivo: 'nenhum cliente com pedido no período tem comissão preenchida' };
  return { media: media(valores), maisFrequente: maisFrequente(valores), qtd: valores.length, ilegiveis, motivo: null };
}

// só clientes de desconto fixo: é neles que o desconto incide sobre o VALOR_FIXO; desconto vazio não é 0% (fica fora e é contado)
function referenciaDesconto(clientes) {
  const fixos = clientes.filter(c => /FIXO/i.test(String(c.TIPO_DESCONTO || '')));
  const valores = fixos.filter(c => String(c.DESCONTO ?? '').trim() !== '')
    .map(c => Number(c.DESCONTO)).filter(v => Number.isFinite(v) && v >= 0);
  const semDesconto = fixos.length - valores.length;
  if (!valores.length) return { media: null, maisFrequente: null, maior: null, qtd: 0, semDesconto, motivo: 'nenhum cliente de desconto fixo com pedido no período e desconto preenchido' };
  return { media: media(valores), maisFrequente: maisFrequente(valores), maior: Math.max(...valores), qtd: valores.length, semDesconto, motivo: null };
}

// despesas pagas de classificação fixa ÷ receitas recebidas (ENTRA_DRE = 1 ou sem classificação), no período
function referenciaCustoFixo(grupos, meses) {
  const fixa = g => chaveMySQL(g.COMPORTAMENTO).trim().startsWith('FIX');
  const pagos = grupos.filter(g => g.SITUACAO === 'Pago');
  const contas = pagos.filter(g => g.classificacaoId !== null && fixa(g)).map(g => ({ nome: g.nome, total: Number(g.total) || 0 }));
  const recebidos = grupos.filter(g => g.SITUACAO === 'Recebido' && (g.classificacaoId === null || Number(g.ENTRA_DRE) === 1));
  const receitas = recebidos.reduce((s, g) => s + (Number(g.total) || 0), 0);
  const receitasSemClassificacao = recebidos.filter(g => g.classificacaoId === null).reduce((s, g) => s + (Number(g.total) || 0), 0);
  const despesas = contas.reduce((s, c) => s + c.total, 0);
  const comportamentos = [...new Set(grupos.map(g => String(g.COMPORTAMENTO ?? '').trim()).filter(Boolean))].sort();
  const semComportamento = pagos.filter(g => g.classificacaoId !== null && !String(g.COMPORTAMENTO ?? '').trim()).map(g => g.nome);
  const r = { pct: null, despesasMes: despesas / meses, receitasMes: receitas / meses, receitasSemClassificacao, contas, comportamentos, semComportamento, motivo: null };
  if (!contas.length) r.motivo = 'nenhuma classificação marcada como fixa no fluxo de caixa';
  else if (!(receitas > 0)) r.motivo = 'nenhuma receita recebida no período';
  else r.pct = despesas / receitas * 100;
  return r;
}

module.exports = { referenciaComissao, referenciaDesconto, referenciaCustoFixo };
