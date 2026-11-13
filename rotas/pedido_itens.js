'use strict';
// Itens de Pedidos para o balão (title) das telas: UMA consulta IN em ped_orc_lista_itens para todos os números.
// Só texto (UNITARIO/TOTAL/PORCENTAGEM nunca são lidos). Devolve Map numero -> { itens: [{ qtd, texto, cores? }], qtdItens } (calculo/calendario.js agruparItens).
// Com { cores: true } (Calendário de pedidos) lê também, em paralelo e também com IN, as colunas COR_* de ped_orc_itens_v4 e a COR de ped_orc_serralheria;
// falha nessas duas leituras só tira as cores (log), nunca os itens. O calendário de Entregas continua sem cores.
// Quem chama trata a falha (omite os itens, nunca derruba a tela).
const { agruparItens, agruparCores } = require('../calculo/calendario');

async function carregarItensPedidos(pool, numeros, { cores = false } = {}) {
  const unicos = [...new Set((numeros || []).map(Number).filter(n => Number.isFinite(n)))];
  if (!unicos.length) return new Map();
  const marcas = unicos.map(() => '?').join(',');
  const semCores = err => { console.error('Erro cores do balão:', err.message); return [[]]; };
  const [[linhas], [v4], [serralheria]] = await Promise.all([
    pool.execute(`SELECT NUMERO, ITEM, TIPO_PRODUTO, PRODUTO, QTD, DESCRICAO, OBSERVACAO FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN (${marcas}) ORDER BY NUMERO, ITEM`, unicos),
    cores ? pool.execute(`SELECT NUMERO, ITEM_PEDIDO, COR_PERFIL, COR_PUXADOR, COR_DIVISOR, COR_REVESTIMENTO FROM ped_orc_itens_v4 WHERE TIPO = 'Pedido' AND NUMERO IN (${marcas})`, unicos).catch(semCores) : [[]],
    cores ? pool.execute(`SELECT NUMERO, ITEM_PEDIDO, COR FROM ped_orc_serralheria WHERE TIPO = 'Pedido' AND NUMERO IN (${marcas})`, unicos).catch(semCores) : [[]]
  ]);
  return agruparItens(linhas, cores ? agruparCores(v4, serralheria) : undefined);
}

module.exports = { carregarItensPedidos };
