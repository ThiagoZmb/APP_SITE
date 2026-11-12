'use strict';
// Itens de Pedidos para o balão (title) das telas: UMA consulta IN em ped_orc_lista_itens para todos os números.
// Só texto (UNITARIO/TOTAL/PORCENTAGEM nunca são lidos). Devolve Map numero -> { itens: [{ qtd, texto }], qtdItens } (calculo/calendario.js agruparItens).
// Usado pelo Calendário de pedidos e pelo calendário de Entregas; quem chama trata a falha (omite os itens, nunca derruba a tela).
const { agruparItens } = require('../calculo/calendario');

async function carregarItensPedidos(pool, numeros) {
  const unicos = [...new Set((numeros || []).map(Number).filter(n => Number.isFinite(n)))];
  if (!unicos.length) return new Map();
  const [linhas] = await pool.execute(
    `SELECT NUMERO, ITEM, TIPO_PRODUTO, PRODUTO, QTD, DESCRICAO, OBSERVACAO FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN (${unicos.map(() => '?').join(',')}) ORDER BY NUMERO, ITEM`, unicos);
  return agruparItens(linhas);
}

module.exports = { carregarItensPedidos };
