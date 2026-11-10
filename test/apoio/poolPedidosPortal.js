// Pool falso das rotas de pedidos do portal (etapa 3a). Reconhece SÓ a consulta de pedidos.
// Ele decide o filtro de empresa PELO TEXTO do SQL: só aplica `CODIGO = params[0]` se o SQL contém "c.CODIGO = ?".
// Se alguém tirar esse filtro da consulta de produção, o pool devolve pedidos de todas as empresas e o teste de
// isolamento falha (e o teste de mutação prova isso). Qualquer outro SQL devolve [] (e fica em `chamadas`).
//
// pedidos:  linhas de ped_orc  { NUMERO, TIPO, RAZAO_SOCIAL, DATA, SITUACAO, DATA_ENTREGA, TOTAL, ... } (datas já 'YYYY-MM-DD')
// clientes: { CODIGO, RAZAO_SOCIAL }
// entregas: { id, numero, status, data_agendada } (várias por pedido: a junção é simulada pelo texto do SQL, ver juncaoEntregas.js)
// A linha devolvida tem SÓ as colunas que a consulta seleciona (o resto do pedido nunca sai do "banco").
const { juntarEntregas } = require('./juncaoEntregas');

function criarPoolPedidos({ pedidos = [], clientes = [], entregas = [] } = {}) {
  entregas = entregas.map((e, i) => ({ id: i + 1, ...e }));
  const chamadas = [];
  async function execute(sql, params = []) {
    chamadas.push({ sql, params });
    if (!/FROM ped_orc p\b/.test(sql)) return [[], []];
    let i = 0;
    const filtraEmpresa = /c\.CODIGO = \?/.test(sql);
    const filtraTipo = /p\.TIPO = 'Pedido'/.test(sql);
    const empresa = filtraEmpresa ? params[i++] : null;
    const filtraNumero = /p\.NUMERO = \?/.test(sql);
    const numero = filtraNumero ? params[i++] : null;

    let linhas = pedidos.filter(p => {
      const cli = clientes.find(c => c.RAZAO_SOCIAL === p.RAZAO_SOCIAL); // JOIN por razão social
      if (!cli) return false;
      if (filtraEmpresa && cli.CODIGO !== empresa) return false;
      if (filtraTipo && p.TIPO !== 'Pedido') return false;
      if (filtraNumero && p.NUMERO !== numero) return false;
      return true;
    });
    if (/ORDER BY p\.NUMERO DESC/.test(sql)) linhas = [...linhas].sort((a, b) => b.NUMERO - a.NUMERO);
    // junção com as entregas ANTES do LIMIT, como no MySQL (o LIMIT 1 da subconsulta da entrega principal não conta: vale o último)
    const juntas = linhas.flatMap(p => juntarEntregas(sql, p.NUMERO, entregas).map(j => ({ p, ...j })));
    const lim = /LIMIT (\d+)(?![\s\S]*LIMIT)/.exec(sql);
    const off = /OFFSET (\d+)/.exec(sql);
    const de = off ? Number(off[1]) : 0;
    const pagina = lim ? juntas.slice(de, de + Number(lim[1])) : juntas;

    return [pagina.map(({ p, en, qtd }) => ({
      NUMERO: p.NUMERO, DATA: p.DATA, SITUACAO: p.SITUACAO, DATA_ENTREGA: p.DATA_ENTREGA ?? null,
      ENTREGA_STATUS: en ? en.status : null, DATA_AGENDADA: en ? (en.data_agendada ?? null) : null,
      ...(/AS QTD_ENTREGAS\b/.test(sql) ? { QTD_ENTREGAS: qtd.qtdEntregas, QTD_ENTREGAS_CONCLUIDAS: qtd.qtdEntregasConcluidas } : {})
    })), []];
  }
  return { execute, query: execute, chamadas };
}

module.exports = { criarPoolPedidos };
