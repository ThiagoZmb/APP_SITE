// Transformar ORÇAMENTO em PEDIDO (funções puras; a rota é POST /ped_orc/orcamentos/:numero/virar_pedido em rotas/ped_orc.js).
// Monta, a partir do orçamento já traduzido para o formato da tela (calculo/leitura_vb.js), o MESMO corpo que a tela envia ao trocar o tipo
// para Pedido e salvar: itens gerados do zero (sem `origem`, não são cópia), valor da tela = valor gravado no orçamento.
'use strict';

// Valida o que o usuário escolheu na janela. Padrões: financeiro 'A Receber', produção 'Em Produção'.
// deps = { canonico(lista, valor), SITUACOES, FINANCEIROS, validarData(texto) } (injetadas pela rota, que é dona das listas).
function validarPedido(b, { canonico, SITUACOES, FINANCEIROS, validarData }) {
  const dataPronto = validarData(b.dataPronto);
  if (!dataPronto) return { ok: false, erro: 'Informe a data de pronto (AAAA-MM-DD).' };
  const financeiro = b.financeiro === undefined || b.financeiro === null || b.financeiro === '' ? 'A Receber' : canonico(FINANCEIROS, b.financeiro);
  if (!financeiro) return { ok: false, erro: `Financeiro inválido. Use: ${FINANCEIROS.join(', ')}.` };
  const situacao = b.situacao === undefined || b.situacao === null || b.situacao === '' ? 'Em Produção' : canonico(SITUACOES, b.situacao);
  if (!situacao) return { ok: false, erro: `Situação de produção inválida. Use: ${SITUACOES.join(', ')}.` };
  return { ok: true, valores: { dataPronto, financeiro, situacao } };
}

// Item da tela → item do corpo de POST /ped_orc/salvar (mesmos campos de gravar() em orcamentos.html).
function itemParaGravar(it) {
  return { frente: it.frente, qtd: it.qtd, altura: it.altura, largura: it.largura, profundidade: it.profundidade, soldas: it.soldas, furos: it.furos,
    detalhes: it.detalhes, acessorios: it.acessorios || [], historico: it.historico || '', obs: it.obs || '', valorTela: it.valor,
    ...(it.frente === 'Serralheria' ? { pecas: it.pecas || [], complementos: (it.complementos || []).map(c => ({ id: c.id, qtd: c.qtd })),
      qtdAltura: it.qtdAltura, qtdLargura: it.qtdLargura, qtdProfundidade: it.qtdProfundidade } : {}) };
}

// { ok, corpo } ou { ok: false, erro }. Item 🔒 (só o VB edita) não tem os dados para o pedido ser gerado do zero: recusa dizendo qual é.
function montarCorpo({ cabecalho, itens, clienteCodigo, dataPronto, financeiro, situacao }) {
  if (clienteCodigo === null || clienteCodigo === undefined || String(clienteCodigo).trim() === '') return { ok: false, erro: 'O cliente do orçamento não foi encontrado no cadastro.' };
  if (!Array.isArray(itens) || !itens.length) return { ok: false, erro: 'O orçamento não tem itens.' };
  const presos = itens.map((it, i) => (it.travado ? `Item ${i + 1} (${it.descricao || it.frente}): ${it.motivo}` : null)).filter(Boolean);
  if (presos.length) return { ok: false, erro: 'Não dá para transformar em pedido: há item(ns) que só o VB edita (🔒). Exclua da lista ou finalize no VB. ' + presos.join(' | ') };
  return { ok: true, corpo: { modo: 'novo', tipo: 'Pedido', clienteCodigo, clienteFinal: cabecalho.clienteFinal || '', obsGeral: cabecalho.obsGeral || '',
    dataEntrega: dataPronto, situacao, financeiro, descontoPct: cabecalho.descontoPct || 0, itens: itens.map(itemParaGravar) } };
}

module.exports = { validarPedido, montarCorpo, itemParaGravar };
