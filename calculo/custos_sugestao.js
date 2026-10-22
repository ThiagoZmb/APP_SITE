// ============================================================
// Formação de preços — parte A: unidade de venda, sugestão de ligação
// material de venda ↔ item de estoque e fator de conversão. Puro.
// ============================================================
const { normalizarNome, semelhanca } = require('./nomes');

const SEMELHANCA_MINIMA = 0.5;
const MAX_SUGESTOES = 3;

// mesma regra do motor de preço: perfil/puxador/divisor/trilho por metro; revestimento/vidro por m²; o resto por unidade
function unidadeDaClasse(classe) {
  const c = normalizarNome(classe);
  if (/PERFI|PUXADOR|DIVISOR|TRILHO/.test(c)) return 'm';
  if (/REVEST|VIDRO/.test(c)) return 'm2';
  return 'un';
}

function sugerirLigacoes(material, itensEstoque) {
  const alvo = normalizarNome(material.MODELO);
  const igual = itensEstoque.find(i => normalizarNome(i.NOME_PRODUTO) === alvo);
  if (igual) return [{ estoque: igual, forca: 'forte', semelhanca: 1 }];
  return itensEstoque.map(i => ({ estoque: i, forca: 'parecida', semelhanca: semelhanca(material.MODELO, i.NOME_PRODUTO) }))
    .filter(s => s.semelhanca >= SEMELHANCA_MINIMA)
    .sort((a, b) => b.semelhanca - a.semelhanca)
    .slice(0, MAX_SUGESTOES);
}

// unidades de venda em 1 unidade de compra: barra pelo comprimento, chapa pela área
function sugerirFator(unidadeVenda, item) {
  const n = v => parseFloat(v) || 0;
  if (unidadeVenda === 'm') return n(item.TAMANHO) > 0 ? n(item.TAMANHO) / 1000 : null;
  if (unidadeVenda === 'm2') return n(item.ALTURA) > 0 && n(item.LARGURA) > 0 ? Math.round(n(item.ALTURA) * n(item.LARGURA)) / 1e6 : null;
  if (unidadeVenda === 'un') return 1;
  return null;
}

function fraseFator(unidadeCompra, fator, unidadeVenda) {
  const f = Number(fator);
  const num = (Math.round(f * 1000) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const nome = unidadeVenda === 'm' ? (f === 1 ? 'metro' : 'metros') : unidadeVenda === 'm2' ? 'm²' : (f === 1 ? 'unidade' : 'unidades');
  return `1 ${String(unidadeCompra || '').trim() || 'unidade de compra'} = ${num} ${nome}`;
}

module.exports = { unidadeDaClasse, sugerirLigacoes, sugerirFator, fraseFator, SEMELHANCA_MINIMA, MAX_SUGESTOES };
