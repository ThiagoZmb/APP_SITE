// ==========================================================================
// Valores financeiros: quem não tem `valores.ver` nunca recebe dinheiro.
// Camada 1: cada rota chama semValores(...) nos seus campos de valor.
// Camada 2: redeDeValores varre toda resposta JSON e apaga qualquer campo com
// nome de dinheiro que tenha escapado — e avisa no log para corrigirmos a rota.
// Contagens NÃO podem usar esses nomes: use qtd*/quantidade.
// ==========================================================================
const REGEX_VALOR = /valor|pre[cç]o|total|custo|saldo|cr[eé]dito|desconto|unit[aá]rio|comiss[aã]o|pago|receb|faturamento|ticket|fixo|cheio|frete|ipi/i;
// nomes que casam com a regex mas não são dinheiro (medidas em mm, rótulo da tabela)
const CAMPOS_TECNICOS = new Set(['descontoVidro', 'descPerfPux', 'DESCONTO_VIDRO', 'DESC_PERF_PUX', 'tipoDesconto', 'TIPO_DESCONTO']);

const podeVerValores = req => !!req?.acesso?.permissoes?.has('valores.ver');

const ehObjetoSimples = v => v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date);

// cópia profunda sem as chaves para as quais `apagar(chave)` é verdadeiro
function filtrar(dado, apagar, removidos) {
  if (Array.isArray(dado)) return dado.map(x => filtrar(x, apagar, removidos));
  if (!ehObjetoSimples(dado)) return dado;
  const saida = {};
  for (const [k, v] of Object.entries(dado)) {
    if (apagar(k)) { removidos.add(k); continue; }
    saida[k] = filtrar(v, apagar, removidos);
  }
  return saida;
}

function removerValores(dado) {
  const removidos = new Set();
  const limpo = filtrar(dado, k => REGEX_VALOR.test(k) && !CAMPOS_TECNICOS.has(k), removidos);
  return { dado: limpo, removidos: [...removidos] };
}

function semValores(req, dado, campos) {
  if (podeVerValores(req)) return dado;
  const lista = new Set(campos);
  return filtrar(dado, k => lista.has(k), new Set());
}

function preservarValores(req, recebido, atual, campos) {
  if (podeVerValores(req)) return recebido;
  const saida = { ...recebido };
  for (const c of campos) saida[c] = atual ? atual[c] : undefined;
  return saida;
}

function redeDeValores(req, res, next) {
  const original = res.json.bind(res);
  res.json = dado => {
    if (podeVerValores(req)) return original(dado);
    const { dado: limpo, removidos } = removerValores(dado);
    if (removidos.length) console.warn(`[valores] rota ${req.method} ${req.path}: campos removidos pela rede: ${removidos.join(', ')}`);
    return original(limpo);
  };
  next();
}

module.exports = { REGEX_VALOR, CAMPOS_TECNICOS, podeVerValores, removerValores, semValores, preservarValores, redeDeValores };
