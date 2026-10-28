// Validação das notas fiscais sem itens (função pura, testável sem banco).
// Só cabeçalho: tipo, número, série, chave, data, contraparte, valor e observação.
const TIPOS_NOTA = ['entrada', 'saida'];
const t = v => String(v ?? '').trim();

// número > 0 com vírgula OU ponto decimal; "1.234,56", milhar "1.500", texto e negativo = NaN (mesma regra das tintas)
function numero(v) {
  const s = t(v);
  if (!/^\d+([.,]\d+)?$/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s)) return NaN;
  return Number(s.replace(',', '.'));
}

// DV da chave de acesso: módulo 11, pesos 2..9 da direita para a esquerda nos 43 primeiros dígitos
function chaveValida(chave) {
  const s = t(chave);
  if (!/^\d{44}$/.test(s)) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return Number(s[43]) === (r < 2 ? 0 : 11 - r);
}

// só dígitos, sem zeros à esquerda, até 9 dígitos (padrão da NF-e); '' se inválido
function normalizarNumero(v) {
  const s = t(v);
  if (!/^\d{1,9}$/.test(s)) return '';
  const n = s.replace(/^0+/, '');
  return n;
}

function dataValida(v) {
  const s = t(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// criando=false: só dataEmissao, valorTotal e observacao (o resto não muda depois de criada)
// podeValores: sem `valores.ver` o valor nem é lido (a rota decide o que fazer)
function validarNota(b = {}, { podeValores = false, criando = true } = {}) {
  const erros = [];
  const dados = {};
  if (criando) {
    dados.tipo = t(b.tipo);
    if (!TIPOS_NOTA.includes(dados.tipo)) erros.push('Tipo inválido (entrada ou saída).');
    dados.numero = normalizarNumero(b.numero);
    if (!dados.numero) erros.push('Número da nota inválido (1 a 9 dígitos, maior que zero).');
    dados.serie = t(b.serie).replace(/^0+(?=\d)/, '') || '1';   // "01" e "1" são a mesma série
    if (dados.serie.length > 5) erros.push('Série muito longa (máximo 5 caracteres).');
    const chave = t(b.chave).replace(/\s+/g, '');
    dados.chave = chave || null;
    if (chave && !chaveValida(chave)) erros.push('Chave de acesso inválida (44 dígitos com dígito verificador correto).');
    dados.contraparteCodigo = Number(t(b.contraparteCodigo));
    if (!Number.isInteger(dados.contraparteCodigo) || dados.contraparteCodigo <= 0)
      erros.push(`Escolha o ${dados.tipo === 'saida' ? 'cliente' : 'fornecedor'}.`);
  }
  dados.dataEmissao = t(b.dataEmissao);
  if (!dataValida(dados.dataEmissao)) erros.push('Data de emissão inválida (use AAAA-MM-DD).');
  if (podeValores) {
    dados.valorTotal = numero(b.valorTotal);
    // até 2 casas (não arredonda em silêncio) e dentro do DECIMAL(14,2)
    if (!(dados.valorTotal > 0) || /[.,]\d{3,}$/.test(t(b.valorTotal)) || dados.valorTotal > 999999999999.99)
      erros.push('Valor inválido (maior que zero, até 2 casas decimais, com vírgula ou ponto decimal).');
  }
  dados.observacao = t(b.observacao);
  if (dados.observacao.length > 500) erros.push('Observação muito longa (máximo 500 caracteres).');
  return { erros, dados };
}

function validarCancelamento(b = {}) {
  const motivo = t(b.motivo);
  const erros = [];
  if (!motivo) erros.push('Informe o motivo do cancelamento.');
  if (motivo.length > 300) erros.push('Motivo muito longo (máximo 300 caracteres).');
  return { erros, motivo };
}

module.exports = { TIPOS_NOTA, chaveValida, normalizarNumero, validarNota, validarCancelamento };
