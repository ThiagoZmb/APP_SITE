// Leituras da composição dos documentos, compartilhadas pela lista do Início e pelo calendário.
const composicaoPedido = require('./composicao_pedido');

async function carregarComposicao(pool, tipo, numeros) {
  const filtrado = Array.isArray(numeros);
  if (filtrado && !numeros.length) return new Map();
  const filtro = filtrado ? ` AND NUMERO IN (${numeros.map(() => '?').join(',')})` : '';
  const params = filtrado ? [tipo, ...numeros] : [tipo];
  const filtroVidros = filtrado ? ` WHERE NUMERO IN (${numeros.map(() => '?').join(',')})` : '';
  // As 4 leituras são independentes: saem JUNTAS. Cada ida ao banco custa ~190 ms (Render -> HostGator, medido em 2026-11-09); em série
  // eram 4 idas e voltas (~0,8 s), em paralelo é uma.
  const [[itens], [vidros], [serr], [tipos]] = await Promise.all([
    pool.execute(`SELECT NUMERO, ITEM, ITEM_PEDIDO, PERFIL, ACABAMENTO_PERFIL, REVESTIMENTO FROM ped_orc_itens_v4 WHERE TIPO = ?${filtro}`, params),
    pool.execute(`SELECT DISTINCT NUMERO, ITEM FROM vidros${filtroVidros}`, filtrado ? numeros : []),
    pool.execute(`SELECT DISTINCT NUMERO, ACABAMENTO FROM ped_orc_serralheria WHERE TIPO = ?${filtro}`, params),
    pool.execute(`SELECT DISTINCT NUMERO, TIPO_PRODUTO FROM ped_orc_lista_itens WHERE TIPO = ?${filtro}`, params)
  ]);
  return composicaoPedido.compor({ itens, vidros, serralheria: serr || [], tipos });
}

module.exports = { carregarComposicao };
