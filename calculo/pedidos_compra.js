// ==========================================================================
// Pedidos a fornecedor: regras puras (sugestão do que comprar, caixas, baixa
// pela entrada de nota, situações e validação). Quantidades em unidades do estoque.
// Regras: docs/regras/pedidos-compra.md
// ==========================================================================
const DIAS_FOLGA = 30;       // a sugestão cobre o prazo de reposição + esta folga
const MIN_DIAS_DADOS = 30;   // com menos histórico que isso o consumo não é usado
const MAX_ITENS = 300;
const MAX_QTD = 1000000;
const MAX_POR_CAIXA = 100000;
const AVISO_MARCA = 'marcado como aguardando fora destes pedidos';

function quantidadeSugerida({ qtd, minimo, consumoDia, prazoDias, diasDados, aCaminho, porCaixa }) {
  const peloConsumo = diasDados >= MIN_DIAS_DADOS ? consumoDia * (prazoDias + DIAS_FOLGA) - qtd : 0;
  // arredonda antes do teto: 45 × 1 − 4 não pode virar 42 por causa de ponto flutuante
  const falta = Math.round((Math.max(minimo - qtd, peloConsumo) - aCaminho) * 10000) / 10000;
  if (!(falta > 0)) return null;
  return Math.ceil(Math.ceil(falta) / porCaixa) * porCaixa;
}

const entraNaSugestao = ({ qtd, minimo, alerta, consumoAno }) =>
  (minimo > 0 && qtd <= minimo) || alerta === 'comprar' || (qtd <= 0 && consumoAno > 0);

// analise = itens de calcularAnalises; produtos = só os do fornecedor escolhido
function montarSugestao({ analise, diasDados, produtos, aCaminho, rascunhos, porCaixa }) {
  const saida = [];
  for (const a of analise) {
    const p = produtos.get(a.codigo);
    if (!p || !/^ativo$/i.test(p.situacao || '') || !entraNaSugestao(a)) continue;
    const caminho = aCaminho.get(a.codigo) || 0, caixa = porCaixa.get(a.codigo) || 1;
    const sugerido = quantidadeSugerida({ ...a, diasDados, aCaminho: caminho, porCaixa: caixa });
    const marcaAntiga = !!p.aguardando && !caminho;
    const aviso = rascunhos.has(a.codigo) ? `em rascunho nº ${rascunhos.get(a.codigo)}` : marcaAntiga ? AVISO_MARCA : '';
    saida.push({ codigo: a.codigo, produto: a.produto, unidade: a.unidade, qtd: a.qtd, minimo: a.minimo, diasCobertura: a.diasCobertura,
      aCaminho: caminho, porCaixa: caixa, sugerido, marcado: sugerido !== null && !aviso, aviso });
  }
  return saida;
}

// abertos já vêm do pedido mais antigo para o mais novo; o que passar do pedido é ignorado
function distribuirBaixa(abertos, chegada) {
  const resta = new Map(chegada), saida = [];
  for (const a of abertos) {
    const qtd = Math.min(a.falta, resta.get(a.produtoCodigo) || 0);
    if (!(qtd > 0)) continue;
    resta.set(a.produtoCodigo, resta.get(a.produtoCodigo) - qtd);
    saida.push({ itemId: a.itemId, pedidoId: a.pedidoId, produtoCodigo: a.produtoCodigo, qtd });
  }
  return saida;
}

const FIXAS = ['rascunho', 'encerrado', 'cancelado'];
function situacaoPelaChegada(atual, itens) {
  if (FIXAS.includes(atual)) return atual;
  if (itens.every(i => i.chegou >= i.qtd)) return 'recebido';
  return itens.some(i => i.chegou > 0) ? 'parcial' : 'enviado';
}

const ACOES = {
  enviar: { de: ['rascunho'], para: 'enviado' },
  encerrar: { de: ['enviado', 'parcial'], para: 'encerrado' },
  cancelar: { de: ['enviado'], para: 'cancelado', semChegada: true }
};
function acaoPermitida(acao, situacao, algoChegou) {
  if (!Object.hasOwn(ACOES, acao)) return null;
  const r = ACOES[acao];
  return r.de.includes(situacao) && !(r.semChegada && algoChegou) ? r.para : null;
}

const inteiroEntre = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;
function validarPedido(corpo) {
  const b = corpo || {};
  const fornecedor = String(b.fornecedor ?? '').trim();
  const observacao = String(b.observacao ?? '').trim().slice(0, 2000);
  if (!fornecedor || fornecedor.length > 190) return { erro: 'Escolha um fornecedor.' };
  if (!Array.isArray(b.itens) || !b.itens.length) return { erro: 'Inclua pelo menos um item com quantidade.' };
  if (b.itens.length > MAX_ITENS) return { erro: `Um pedido aceita no máximo ${MAX_ITENS} itens.` };
  const vistos = new Set(), itens = [];
  for (const [i, it] of b.itens.entries()) {
    const produtoCodigo = Number(it?.produtoCodigo), porCaixa = it?.porCaixa === undefined ? 1 : it.porCaixa;
    if (!inteiroEntre(produtoCodigo, 2147483647)) return { erro: `Item ${i + 1}: produto inválido.` };
    if (!inteiroEntre(porCaixa, MAX_POR_CAIXA)) return { erro: `Item ${i + 1}: unidades por caixa precisa ser um número inteiro de 1 a ${MAX_POR_CAIXA}.` };
    if (!inteiroEntre(it.quantidade, MAX_QTD) || it.quantidade * porCaixa > MAX_QTD) return { erro: `Item ${i + 1}: quantidade precisa ser um número inteiro maior que zero.` };
    if (vistos.has(produtoCodigo)) return { erro: `Item ${i + 1}: produto repetido no pedido.` };
    vistos.add(produtoCodigo);
    itens.push({ produtoCodigo, qtd: it.quantidade * porCaixa, porCaixa });
  }
  return { fornecedor, observacao, itens };
}

module.exports = { quantidadeSugerida, entraNaSugestao, montarSugestao, distribuirBaixa, situacaoPelaChegada, acaoPermitida, validarPedido, AVISO_MARCA, MAX_ITENS };
