// Recebimento dividido em várias formas de pagamento (POST /fluxo/salvar_varios). Funções puras, testáveis sem banco.
// Cada linha vira uma linha normal de fluxo_de_caixa, como o VB grava; a divisão só poupa o trabalho de salvar uma a uma.
const MAX_LINHAS = 10;
const SITUACOES_ENTRADA = ['Recebido', 'A Receber', 'Faturado', 'Protestado', 'Atrasado'];

const txt = (v, max = 255) => String(v ?? '').trim().slice(0, max);
function numero(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const t = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!t) return 0;
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return isFinite(n) ? n : 0;
}
const arredondar = n => Math.round(n * 100) / 100;

// "23376" -> 23376; "23376/23316", "", "abc" -> null (vários números: não dá para saber como o valor se divide)
function numeroUnicoDoPedido(texto) {
  const t = String(texto ?? '').trim();
  return /^\d{1,9}$/.test(t) ? parseInt(t, 10) : null;
}

// situações aceitas por tipo (iguais às da tela, financeiro.html: SITUACOES)
const SITUACOES_SAIDA = ['A Pagar', 'Atrasado', 'Faturado', 'Pago', 'Protestado'];
const SITUACOES_POR_MOVIMENTO = { 'Entrada': SITUACOES_ENTRADA, 'Saída': SITUACOES_SAIDA };
// situações "ainda por vir": a forma de pagamento só se sabe no dia em que o dinheiro entra ou sai, então pode ficar em branco
const SEM_FORMA = ['A Receber', 'A Pagar'];

// valida as linhas (1 a 10) de um tipo de movimento; devolve { linhas } ou { erro }
function validarLinhas(brutas, permitidas) {
  const linhas = [];
  for (let i = 0; i < brutas.length; i++) {
    const l = brutas[i] || {}, n = `Linha ${i + 1}: `;
    const formaPgto = txt(l.formaPgto, 100);
    const situacao = txt(l.situacao, 50);
    if (!formaPgto && !SEM_FORMA.includes(situacao)) return { erro: n + 'favor escolher uma forma de pagamento!' };
    const data = String(l.data || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(new Date(data + 'T00:00:00'))) return { erro: n + 'favor inserir uma data válida!' };
    const valor = arredondar(numero(l.valor));
    if (!(valor > 0)) return { erro: n + 'favor inserir um valor maior que zero!' };
    if (!permitidas.includes(situacao)) return { erro: n + 'favor escolher a situação desse registro!' };
    linhas.push({ formaPgto, banco: txt(l.banco, 100), data, valor, situacao });
  }
  return { linhas };
}

function dadosComuns(b, classificacao) {
  return {
    nome: txt(b.nome) || null, pedido: txt(b.pedido, 50), pdv: txt(b.pdv, 50), preNota: txt(b.preNota, 50),
    notaFiscal: txt(b.notaFiscal, 50), observacao: txt(b.observacao, 2000), classificacao
  };
}

// Valida o corpo e devolve { ok: true, comum, linhas, quitar } ou { ok: false, erro } (mesmas mensagens do /fluxo/salvar)
function validarDivisao(b) {
  b = b || {};
  if (b.movimento !== 'Entrada') return { ok: false, erro: 'A divisão do recebimento vale só para Entrada.' };
  const brutas = Array.isArray(b.linhas) ? b.linhas : [];
  if (brutas.length < 2) return { ok: false, erro: 'Informe pelo menos duas formas de pagamento para dividir.' };
  if (brutas.length > MAX_LINHAS) return { ok: false, erro: `No máximo ${MAX_LINHAS} formas de pagamento por vez.` };
  const classificacao = parseInt(b.codClassificacao, 10);
  if (!(classificacao > 0)) return { ok: false, erro: 'Favor escolher uma categoria!' };
  const v = validarLinhas(brutas, SITUACOES_ENTRADA);
  if (v.erro) return { ok: false, erro: v.erro };
  const comum = dadosComuns(b, classificacao);
  let quitar = null;
  if (b.quitarPedido) {
    quitar = numeroUnicoDoPedido(comum.pedido);
    if (quitar === null) return { ok: false, erro: 'Para quitar o pedido, informe um único número de pedido.' };
  }
  return { ok: true, comum, linhas: v.linhas, quitar, soma: arredondar(v.linhas.reduce((s, l) => s + l.valor, 0)) };
}

// Divisão de um movimento JÁ EXISTENTE (Editar movimento): a linha 1 atualiza o registro `id`; as demais viram registros novos.
// Vale para Entrada e Saída. Devolve { ok: true, id, movimento, comum, linhas, soma } ou { ok: false, erro }.
function validarDivisaoEdicao(b) {
  b = b || {};
  const id = parseInt(b.id, 10);
  if (!(id > 0)) return { ok: false, erro: 'Registro inválido para dividir.' };
  if (b.movimento !== 'Entrada' && b.movimento !== 'Saída') return { ok: false, erro: 'Tipo de movimento inválido.' };
  const brutas = Array.isArray(b.linhas) ? b.linhas : [];
  if (brutas.length < 2) return { ok: false, erro: 'Informe pelo menos duas parcelas para dividir.' };
  if (brutas.length > MAX_LINHAS) return { ok: false, erro: `No máximo ${MAX_LINHAS} parcelas por vez.` };
  const classificacao = parseInt(b.codClassificacao, 10);
  if (!(classificacao > 0)) return { ok: false, erro: 'Favor escolher uma categoria!' };
  const v = validarLinhas(brutas, SITUACOES_POR_MOVIMENTO[b.movimento]);
  if (v.erro) return { ok: false, erro: v.erro };
  return { ok: true, id, movimento: b.movimento, comum: dadosComuns(b, classificacao), linhas: v.linhas, soma: arredondar(v.linhas.reduce((s, l) => s + l.valor, 0)) };
}

// total do pedido x o que já entrou como Recebido (soma das linhas já gravadas + as que estão sendo lançadas agora)
function saldoDoPedido(total, recebidoAntes, lancandoAgora = 0) {
  const t = arredondar(Number(total) || 0), r = arredondar((Number(recebidoAntes) || 0) + (Number(lancandoAgora) || 0));
  return { total: t, recebido: r, falta: arredondar(Math.max(0, t - r)), cobreTotal: t > 0 && r >= t };
}

module.exports = { MAX_LINHAS, SITUACOES_ENTRADA, SITUACOES_SAIDA, SEM_FORMA, numero, numeroUnicoDoPedido, validarDivisao, validarDivisaoEdicao, saldoDoPedido };
