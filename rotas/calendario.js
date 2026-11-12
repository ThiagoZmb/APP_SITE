// ==========================================================================
// Calendário de previsão de finalização dos pedidos (somente leitura).
//   GET /calendario/pedidos?mes=AAAA-MM&situacao=abertos|todos   pedidos do mês agrupados por dia
//   GET /calendario/dia?data=AAAA-MM-DD&situacao=abertos|todos   pedidos de um dia
// A data é ped_orc.DATA_PRONTO (tipo Pedido). Pedidos em 1 consulta + composição e itens (ped_orc_lista_itens, IN) em paralelo: sem N+1; "em aberto" e "atrasado" saem de calculo/calendario.js.
// Permissão pedidos.ver (a mesma de /dados_lista); estados restritos do usuário filtram pelo cliente; valor só com valores.ver.
// Regras: docs/regras/calendario-pedidos.md
// ==========================================================================
const { filtroEstados } = require('../seguranca/acesso');
const { semValores } = require('../seguranca/valores');
const { hojeLocal } = require('./transacao');
const { validarData, validarMes, validarSituacao, somarDias, montarPedido, agruparPorDia, agruparItens } = require('../calculo/calendario');
const { carregarComposicao } = require('../calculo/composicao_documentos');
const { SEM_COMPOSICAO } = require('../calculo/composicao_pedido');

const VER = ['pedidos.ver'];

function registrarCalendario({ rota, pool }) {
  // itens dos pedidos do período em UMA consulta (IN); só texto, nunca UNITARIO/TOTAL
  async function carregarItens(numeros) {
    if (!numeros.length) return new Map();
    const [linhas] = await pool.execute(
      `SELECT NUMERO, ITEM, TIPO_PRODUTO, PRODUTO, QTD, DESCRICAO, OBSERVACAO FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN (${numeros.map(() => '?').join(',')}) ORDER BY NUMERO, ITEM`, numeros);
    return agruparItens(linhas);
  }
  // pedidos com DATA_PRONTO em [de, ate) ; a ordem final é a do agrupamento
  async function buscar(req, de, ate) {
    const est = filtroEstados(req, 'c.ESTADO');
    const [linhas] = await pool.execute(
      `SELECT p.NUMERO AS numero, p.RAZAO_SOCIAL AS cliente, p.CLIENTE_FINAL AS cliente_final, p.SITUACAO AS situacao, p.TOTAL AS valor,
              CAST(p.DATA_PRONTO AS CHAR) AS pronto_em, CAST(p.DATA_ENTREGA AS CHAR) AS data_entrega
       FROM ped_orc p
       ${est.sql ? 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL' : ''}
       WHERE p.TIPO = 'Pedido' AND p.DATA_PRONTO >= ? AND p.DATA_PRONTO < ? ${est.sql ? 'AND ' + est.sql : ''}
       ORDER BY p.DATA_PRONTO, p.NUMERO`, [de, ate, ...est.params]);
    return linhas;
  }
  // composição (ícones) e itens do balão saem JUNTOS (ida e volta ao banco ~190 ms); falha em qualquer um só tira aquele enfeite, nunca a lista
  async function enriquecer(linhas) {
    const numeros = linhas.map(r => r.numero);
    const [composicao, itens] = await Promise.all([
      carregarComposicao(pool, 'Pedido', numeros).catch(err => { console.error('Erro composição do calendário:', err.message); return new Map(); }),
      carregarItens(numeros).catch(err => { console.error('Erro itens do calendário:', err.message); return new Map(); })
    ]);
    return linhas.map(r => ({ ...r, ...(composicao.get(Number(r.numero)) || SEM_COMPOSICAO), ...(itens.get(Number(r.numero)) || {}) }));
  }
  const resumo = dias => ({ qtdPedidos: dias.reduce((n, d) => n + d.qtdPedidos, 0), qtdAtrasados: dias.reduce((n, d) => n + d.qtdAtrasados, 0) });

  rota('get', '/calendario/pedidos', VER, async (req, res) => {
    const mes = validarMes(req.query.mes);
    if (!mes) return res.status(400).json({ error: 'Mês inválido. Use o formato AAAA-MM.' });
    const situacao = validarSituacao(req.query.situacao);
    if (!situacao) return res.status(400).json({ error: 'Situação inválida. Use abertos ou todos.' });
    try {
      const hoje = hojeLocal();
      const linhas = await buscar(req, mes.inicio, mes.fim);
      const dias = agruparPorDia((await enriquecer(linhas)).map(r => montarPedido(r, hoje)), situacao);
      res.json(semValores(req, { mes: mes.chave, situacao, hoje, ...resumo(dias), dias }, ['valor']));
    } catch (err) {
      console.error('Erro GET /calendario/pedidos:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('get', '/calendario/dia', VER, async (req, res) => {
    const data = validarData(req.query.data);
    if (!data) return res.status(400).json({ error: 'Data inválida. Use o formato AAAA-MM-DD.' });
    const situacao = validarSituacao(req.query.situacao);
    if (!situacao) return res.status(400).json({ error: 'Situação inválida. Use abertos ou todos.' });
    try {
      const hoje = hojeLocal();
      const linhas = await buscar(req, data, somarDias(data, 1));
      const dias = agruparPorDia((await enriquecer(linhas)).map(r => montarPedido(r, hoje)), situacao);
      const pedidos = dias.length ? dias[0].pedidos : [];
      res.json(semValores(req, { data, situacao, hoje, ...resumo(dias), pedidos }, ['valor']));
    } catch (err) {
      console.error('Erro GET /calendario/dia:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarCalendario };
