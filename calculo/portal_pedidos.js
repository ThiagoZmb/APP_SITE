'use strict';
// Portal do cliente, etapa 3a: projeção e validação puras dos pedidos (sem banco).

const TAMANHO_PAGINA = 50;

// Teto de página: com 50 por página já passa de 5 milhões de pedidos e mantém o OFFSET longe de perder precisão.
// Teto realista: OFFSET alto com JOIN por nome varre a tabela do VB inteira (DoS autenticado); 2000 páginas já passam de qualquer cliente.
const PAGINA_MAXIMA = 2000;

const ROTULO_SITUACAO = Object.freeze({
  'Em Produção': 'Em produção',
  'Pronto': 'Pronto',
  'Entregue': 'Entregue',
  'Retirado': 'Retirado',
  'Cancelado': 'Cancelado',
});

const ROTULO_ENTREGA = Object.freeze({
  a_programar: 'Aguardando agendamento',
  agendada: 'Entrega agendada',
  em_rota: 'Saiu para entrega',
  ocorrencia: 'Entrega a reprogramar',
  entregue: 'Entregue',
  retirado: 'Retirado',
  enviada: 'Enviada',
  cancelada: 'Cancelada',
});

const tem = (mapa, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(mapa, k);

function projetarPedido(linha) {
  const l = linha || {};
  const situacao = tem(ROTULO_SITUACAO, l.SITUACAO) ? ROTULO_SITUACAO[l.SITUACAO] : 'Em andamento';
  const finalizado = l.SITUACAO === 'Entregue' || l.SITUACAO === 'Retirado';
  // várias entregas por pedido: o cliente vê só o resumo ("Entregue parcialmente: 1 de 2"), nunca o detalhe por entrega.
  // Com uma entrega só (ou sem contagens) o rótulo é o de sempre.
  const qtd = Number(l.QTD_ENTREGAS) || 0, concluidas = Number(l.QTD_ENTREGAS_CONCLUIDAS) || 0;
  const parcial = !finalizado && qtd > 1 && concluidas > 0 && concluidas < qtd;
  // pedido já Entregue/Retirado (por qualquer caminho): a entrega nunca aparece como pendente nem cancelada para o cliente;
  // o rótulo é o do próprio pedido (a varredura da equipe encerra as que esperavam; ver calculo/entregas.js)
  const st = finalizado && l.ENTREGA_STATUS && l.ENTREGA_STATUS !== 'entregue' && l.ENTREGA_STATUS !== 'retirado'
    ? (l.SITUACAO === 'Retirado' ? 'retirado' : 'entregue') : l.ENTREGA_STATUS;
  const entrega = parcial ? `Entregue parcialmente: ${concluidas} de ${qtd}`
    : tem(ROTULO_ENTREGA, st) ? ROTULO_ENTREGA[st] : null;
  const agendado = !finalizado && (st === 'agendada' || st === 'em_rota');
  return {
    numero: Number(l.NUMERO),
    data: l.DATA,
    situacao,
    dataEntrega: finalizado ? (l.DATA_ENTREGA || null) : null,
    entrega,
    dataAgendada: agendado ? (l.DATA_AGENDADA || null) : null,
  };
}

function paginaValida(texto) {
  if (texto === undefined) return 1;
  if (typeof texto !== 'string' || !/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function numeroValido(texto) {
  if (typeof texto !== 'string' || !/^\d{1,9}$/.test(texto)) return null;
  const n = Number(texto);
  return n > 0 ? n : null;
}

module.exports = { projetarPedido, paginaValida, numeroValido, TAMANHO_PAGINA, PAGINA_MAXIMA };
