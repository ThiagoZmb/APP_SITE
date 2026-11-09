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
  const entrega = tem(ROTULO_ENTREGA, l.ENTREGA_STATUS) ? ROTULO_ENTREGA[l.ENTREGA_STATUS] : null;
  const finalizado = l.SITUACAO === 'Entregue' || l.SITUACAO === 'Retirado';
  const agendado = l.ENTREGA_STATUS === 'agendada' || l.ENTREGA_STATUS === 'em_rota';
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
