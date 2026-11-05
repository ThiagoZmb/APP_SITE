// ==========================================================================
// Calendário de previsão de finalização dos pedidos (somente leitura).
//   GET /calendario/pedidos?mes=AAAA-MM&situacao=abertos|todos   pedidos do mês agrupados por dia
//   GET /calendario/dia?data=AAAA-MM-DD&situacao=abertos|todos   pedidos de um dia
// A data é ped_orc.DATA_PRONTO (tipo Pedido). Uma consulta por chamada (sem N+1); "em aberto" e "atrasado" saem de calculo/calendario.js.
// Permissão pedidos.ver (a mesma de /dados_lista); estados restritos do usuário filtram pelo cliente; valor só com valores.ver.
// Regras: docs/regras/calendario-pedidos.md
// ==========================================================================
const { filtroEstados } = require('../seguranca/acesso');
const { semValores } = require('../seguranca/valores');
const { hojeLocal } = require('./transacao');
const { validarData, validarMes, validarSituacao, somarDias, montarPedido, agruparPorDia } = require('../calculo/calendario');

const VER = ['pedidos.ver'];

function registrarCalendario({ rota, pool }) {
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
  const resumo = dias => ({ qtdPedidos: dias.reduce((n, d) => n + d.qtdPedidos, 0), qtdAtrasados: dias.reduce((n, d) => n + d.qtdAtrasados, 0) });

  rota('get', '/calendario/pedidos', VER, async (req, res) => {
    const mes = validarMes(req.query.mes);
    if (!mes) return res.status(400).json({ error: 'Mês inválido. Use o formato AAAA-MM.' });
    const situacao = validarSituacao(req.query.situacao);
    if (!situacao) return res.status(400).json({ error: 'Situação inválida. Use abertos ou todos.' });
    try {
      const hoje = hojeLocal();
      const dias = agruparPorDia((await buscar(req, mes.inicio, mes.fim)).map(r => montarPedido(r, hoje)), situacao);
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
      const dias = agruparPorDia((await buscar(req, data, somarDias(data, 1))).map(r => montarPedido(r, hoje)), situacao);
      const pedidos = dias.length ? dias[0].pedidos : [];
      res.json(semValores(req, { data, situacao, hoje, ...resumo(dias), pedidos }, ['valor']));
    } catch (err) {
      console.error('Erro GET /calendario/dia:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarCalendario };
