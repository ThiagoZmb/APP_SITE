// EPIs: validações e contas puras (sem banco). Spec: docs/superpowers/specs/2026-11-27-epis-design.md.
// Atenção aos nomes devolvidos para a tela: nada de "saldo", "total", "valor" etc. (a redeDeValores apagaria de quem não vê dinheiro).
const MAX_QTD = 999999;
const MAX_ITENS = 30;
const MAX_NOME = 80;
const MAX_TEXTO = 200;
const REGEX_CHAVE = /^[A-Za-z0-9-]{8,64}$/;

// AAAA-MM-DD de um dia que existe
const dataIsoValida = t => /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t + 'T00:00:00Z')) && new Date(t + 'T00:00:00Z').toISOString().slice(0, 10) === t;

const limpar = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
// inteiro >= min, aceitando número ou texto só com dígitos; qualquer outra coisa = null
function inteiro(v, min = 0) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const t = String(v).trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= MAX_QTD ? n : null;
}
const quantidade = v => inteiro(v, 1);
const chaveValida = v => typeof v === 'string' && REGEX_CHAVE.test(v);
const vazio = v => v === undefined || v === null || v === '';

function validarEpi(b) {
  const nome = limpar(b?.nome), ca = limpar(b?.ca);
  if (!nome) return { erro: 'Digite o nome do EPI.' };
  if (nome.length > MAX_NOME) return { erro: `O nome do EPI passa de ${MAX_NOME} caracteres.` };
  if (!/^\d{1,7}$/.test(ca)) return { erro: 'Informe o número do C.A. (somente números, até 7).' };
  const minimo = vazio(b.minimo) ? 0 : inteiro(b.minimo);
  if (minimo === null) return { erro: 'O estoque mínimo precisa ser um número inteiro.' };
  return { dados: { nome, ca, minimo } };
}

// `hoje` = AAAA-MM-DD (hora de Brasília). Data vazia = hoje; anterior vale; futura não.
function validarEntrega(b, hoje) {
  if (!b || typeof b !== 'object') return { erro: 'Corpo inválido.' };
  const funcionarioCodigo = inteiro(b.funcionarioCodigo, 1);
  if (funcionarioCodigo === null) return { erro: 'Escolha o funcionário.' };
  const data = vazio(b.data) ? hoje : String(b.data);
  if (!dataIsoValida(data) || data < '2000-01-01') return { erro: 'Data da entrega inválida.' };
  if (data > hoje) return { erro: 'A data da entrega não pode ser futura.' };
  const observacao = limpar(b.observacao);
  if (observacao.length > MAX_TEXTO) return { erro: `A observação passa de ${MAX_TEXTO} caracteres.` };
  if (!Array.isArray(b.itens) || !b.itens.length) return { erro: 'Informe ao menos um EPI.' };
  if (b.itens.length > MAX_ITENS) return { erro: `Máximo de ${MAX_ITENS} EPIs por entrega.` };
  const itens = [];
  for (const i of b.itens) {
    const epiId = inteiro(i?.epiId, 1), qtd = quantidade(i?.quantidade);
    if (epiId === null) return { erro: 'Escolha o EPI em todas as linhas.' };
    if (qtd === null) return { erro: 'Quantidade inválida: use um número inteiro de 1 em diante.' };
    if (itens.some(x => x.epiId === epiId)) return { erro: 'EPI repetido na entrega: junte as quantidades numa linha só.' };
    itens.push({ epiId, quantidade: qtd });
  }
  if (!chaveValida(b.chave)) return { erro: 'Chave do envio inválida. Recarregue a página.' };
  return { dados: { funcionarioCodigo, data, observacao: observacao || null, itens, chave: b.chave } };
}

function validarMotivo(v) {
  const motivo = limpar(v);
  if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
  if (motivo.length > MAX_TEXTO) return { erro: `O motivo passa de ${MAX_TEXTO} caracteres.` };
  return { motivo };
}

function diasAtras(hoje, dias) {
  const d = new Date(hoje + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

// saldo = entradas − itens de entregas não canceladas; "Dura (est.)" = saldo ÷ (consumo dos últimos 30 dias ÷ 30), como no piloto
function montarEstoque(epis, entradas, saidas) {
  const ent = new Map(entradas.map(r => [Number(r.epi_id), Number(r.qtd) || 0]));
  const sai = new Map(saidas.map(r => [Number(r.epi_id), r]));
  return epis.map(e => {
    const id = Number(e.id), s = sai.get(id);
    const qtdEstoque = (ent.get(id) || 0) - (Number(s?.qtd) || 0);
    const uso = Number(s?.qtd_30) || 0;
    const ativo = Number(e.ativo) === 1, minimo = Number(e.minimo) || 0;
    return { id, nome: e.nome, ca: e.ca, minimo, ativo, qtdEstoque, baixo: ativo && qtdEstoque <= minimo, duraDias: uso ? Math.round(qtdEstoque / (uso / 30)) : null };
  });
}

// `itens` = itens das entregas NÃO canceladas (data_entrega, funcionario_codigo/nome, epi_id, nome, quantidade)
function montarResumo({ itens, estoque, qtdFuncionarios, hoje }) {
  const desde = diasAtras(hoje, 30);
  const soma = lista => lista.reduce((a, i) => a + Number(i.quantidade), 0);
  const top = (chave, nome) => {
    const m = new Map();
    for (const i of itens) {
      const k = String(i[chave]), x = m.get(k) || { nome: i[nome], qtd: 0 };
      x.qtd += Number(i.quantidade);
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 6);
  };
  const [ano, mes] = hoje.split('-').map(Number);
  const porMes = [];
  for (let n = 5; n >= 0; n--) {
    const k = new Date(Date.UTC(ano, mes - 1 - n, 1)).toISOString().slice(0, 7);
    porMes.push({ mes: k, qtd: soma(itens.filter(i => String(i.data_entrega).slice(0, 7) === k)) });
  }
  const ativos = estoque.filter(e => e.ativo);
  return {
    qtdUnidades: soma(itens),
    qtdUltimos30: soma(itens.filter(i => String(i.data_entrega).slice(0, 10) >= desde)),
    qtdFuncionarios,
    baixos: ativos.filter(e => e.baixo).map(e => e.nome),
    porMes,
    porFuncionario: top('funcionario_codigo', 'funcionario_nome'),
    porEpi: top('epi_id', 'nome'),
    estoque: ativos.map(e => ({ nome: e.nome, qtd: e.qtdEstoque, baixo: e.baixo }))
  };
}

module.exports = { MAX_ITENS, inteiro, quantidade, chaveValida, validarEpi, validarEntrega, validarMotivo, diasAtras, montarEstoque, montarResumo, limpar };
