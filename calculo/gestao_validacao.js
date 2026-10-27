// Central de Gestão: validação da entrada de metas e orçamentos (funções puras, testáveis sem banco).
const { mesValido, chaveCategoria, rotuloCategoria, ehSaida } = require('./gestao_caixa');

const TIPOS_META = ['faturamento', 'despesa'];
const ORIGENS_META = ['web', 'vb'];
const ANO_MIN = 2000, ANO_MAX = 2100;
const VALOR_MAXIMO = 99999999999.99; // cabe em DECIMAL(14,2)

const t = v => String(v ?? '').trim();

// Dinheiro >= 0 com no máximo 2 casas. Aceita número, "1500", "1500.5", "1500,50" e "1.500,50" (milhar com ponto + vírgula decimal).
// "1.500" sozinho é ambíguo (mil e quinhentos ou um e meio?) e é recusado. Devolve NaN se inválido.
function lerDinheiro(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= VALOR_MAXIMO && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 ? Math.round(v * 100) / 100 : NaN;
  const s = t(v).replace(/^R\$\s*/i, '');
  let n;
  if (/^\d+$/.test(s)) n = s;
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) n = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(s)) n = s.replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(s)) n = s;
  else return NaN;
  const x = Number(n);
  return Number.isFinite(x) && x <= VALOR_MAXIMO ? x : NaN;
}

// mês 'AAAA-MM' com ano entre 2000 e 2100
function lerMes(v) {
  const s = t(v);
  if (!mesValido(s)) return null;
  const ano = Number(s.slice(0, 4));
  return ano >= ANO_MIN && ano <= ANO_MAX ? s : null;
}
const MSG_MES = 'Mês inválido (use AAAA-MM, por exemplo 2026-10).';
const MSG_VALOR = 'Valor inválido (use números maiores ou iguais a zero, com no máximo 2 casas decimais; ex.: 1500,50).';

// corpo de PUT /gestao/meta: { mes, tipo, valor, origem? }
function validarMeta(b = {}) {
  const erros = [];
  const mes = lerMes(b.mes);
  if (!mes) erros.push(MSG_MES);
  const tipo = t(b.tipo).toLowerCase();
  if (!TIPOS_META.includes(tipo)) erros.push('Tipo da meta inválido (faturamento ou despesa).');
  const valor = lerDinheiro(b.valor);
  if (Number.isNaN(valor)) erros.push(MSG_VALOR);
  const origem = b.origem === undefined || b.origem === null || b.origem === '' ? 'web' : t(b.origem).toLowerCase();
  if (!ORIGENS_META.includes(origem)) erros.push('Origem da meta inválida.');
  return { erros, dados: { mes, tipo, valor, origem } };
}

// limiar opcional em %: vazio = usa o padrão (null); senão número entre 1 e 100
function lerLimiar(v, rotulo, erros) {
  if (v === undefined || v === null || t(v) === '') return null;
  const n = Number(t(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 1 || n > 100) { erros.push(`${rotulo} deve ser um percentual entre 1 e 100.`); return null; }
  return Math.round(n * 100) / 100;
}

// corpo de PUT /gestao/orcamento: { mes, classificacaoId, nivel?, valor, limiarAtencao?, limiarAlerta? }
// classificacoes = linhas de fluxo_de_caixa_classificacao ({ id, tipo, classe1, classe2, classe3 }).
// A categoria gravada é a "canônica" do grupo (menor id com o mesmo CLASSE1 [+ CLASSE2]) para não haver dois orçamentos do mesmo grupo.
function validarOrcamento(b = {}, classificacoes = []) {
  const erros = [];
  const mes = lerMes(b.mes);
  if (!mes) erros.push(MSG_MES);
  const valor = lerDinheiro(b.valor);
  if (Number.isNaN(valor)) erros.push(MSG_VALOR);
  const nivelBruto = b.nivel === undefined || b.nivel === null || b.nivel === '' ? 1 : Number(b.nivel);
  if (nivelBruto !== 1 && nivelBruto !== 2) erros.push('Nível inválido (1 = categoria, 2 = categoria e subcategoria).');
  const nivel = nivelBruto === 2 ? 2 : 1;
  const idBruto = typeof b.classificacaoId === 'number' || typeof b.classificacaoId === 'string' ? Number(t(b.classificacaoId)) : NaN;
  let canonica = null, rotulo = '';
  if (!Number.isInteger(idBruto) || idBruto <= 0) erros.push('Escolha a categoria.');
  else {
    const c = classificacoes.find(x => Number(x.id) === idBruto);
    if (!c) erros.push('Categoria não encontrada no fluxo de caixa.');
    else if (!ehSaida(c)) erros.push('O orçamento vale só para categorias de saída (despesa).');
    else if (nivel === 2 && !t(c.classe2)) erros.push('Esta categoria não tem subcategoria (CLASSE2); use o nível 1.');
    else if (!t(c.classe1)) erros.push('Esta categoria não tem nome (CLASSE1).');
    else {
      const chave = chaveCategoria(c, nivel);
      const grupo = classificacoes.filter(x => ehSaida(x) && chaveCategoria(x, nivel) === chave).map(x => Number(x.id));
      canonica = Math.min(...grupo);
      rotulo = rotuloCategoria(c, nivel);
    }
  }
  const limiarAtencao = lerLimiar(b.limiarAtencao, 'Limiar de atenção', erros);
  const limiarAlerta = lerLimiar(b.limiarAlerta, 'Limiar de alerta', erros);
  const atencaoEf = limiarAtencao ?? 70, alertaEf = limiarAlerta ?? 85;
  if (!erros.length && !(atencaoEf < alertaEf)) erros.push('O limiar de atenção deve ser menor que o de alerta.');
  return { erros, dados: { mes, classificacaoId: canonica, nivel, valor, limiarAtencao, limiarAlerta, rotulo } };
}

module.exports = { TIPOS_META, ORIGENS_META, VALOR_MAXIMO, lerDinheiro, lerMes, validarMeta, validarOrcamento, MSG_MES, MSG_VALOR };
