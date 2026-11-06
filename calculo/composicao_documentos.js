// Leituras da composição dos documentos, compartilhadas pela lista do Início e pelo calendário.
const composicaoPedido = require('./composicao_pedido');

async function carregarComposicao(pool, tipo, numeros) {
  const filtrado = Array.isArray(numeros);
  if (filtrado && !numeros.length) return new Map();
  const filtro = filtrado ? ` AND NUMERO IN (${numeros.map(() => '?').join(',')})` : '';
  const params = filtrado ? [tipo, ...numeros] : [tipo];
  const filtroVidros = filtrado ? ` WHERE NUMERO IN (${numeros.map(() => '?').join(',')})` : '';
  const [itens] = await pool.execute(`SELECT NUMERO, ITEM, ITEM_PEDIDO, PERFIL, ACABAMENTO_PERFIL, REVESTIMENTO FROM ped_orc_itens_v4 WHERE TIPO = ?${filtro}`, params);
  const [vidros] = await pool.execute(`SELECT DISTINCT NUMERO, ITEM FROM vidros${filtroVidros}`, filtrado ? numeros : []);
  const [serr] = await pool.execute(`SELECT DISTINCT NUMERO FROM ped_orc_serralheria WHERE TIPO = ?${filtro}`, params);
  const [tipos] = await pool.execute(`SELECT DISTINCT NUMERO, TIPO_PRODUTO FROM ped_orc_lista_itens WHERE TIPO = ?${filtro}`, params);
  return composicaoPedido.compor({ itens, vidros, serralheria: (serr || []).map(r => r.NUMERO), tipos });
}

module.exports = { carregarComposicao };
