// GET /pedidos/total_periodo?de=AAAA-MM-DD&ate=AAAA-MM-DD[&cliente=RAZÃO SOCIAL] (somente leitura)
// Soma do valor dos pedidos entre duas datas (ped_orc.DATA), sem Cancelados e sem orçamentos, com a lista completa (sem teto de linhas).
// Exige pedidos.ver E valores.ver; estados restritos do usuário filtram pelo cliente (como /dados_lista). Contas em calculo/total_periodo.js.
const { filtroEstados } = require('../seguranca/acesso');
const { semValores } = require('../seguranca/valores');
const { validarIntervalo, somarPedidos } = require('../calculo/total_periodo');

const MAX_CLIENTE = 200;

function registrarTotalPeriodo({ rota, pool }) {
  rota('get', '/pedidos/total_periodo', ['pedidos.ver', 'valores.ver'], async (req, res) => {
    const q = req.query;
    if (q.cliente !== undefined && (typeof q.cliente !== 'string' || q.cliente.length > MAX_CLIENTE)) return res.status(400).json({ error: 'Cliente inválido.' });
    const iv = validarIntervalo(q.de, q.ate);
    if (iv.erro) return res.status(400).json({ error: iv.erro });
    const cliente = q.cliente || '';
    try {
      const est = filtroEstados(req, 'c.ESTADO');
      const [linhas] = await pool.execute(
        `SELECT p.SITUACAO AS situacao, p.TOTAL AS valor
         FROM ped_orc p
         ${est.sql ? 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL' : ''}
         WHERE p.TIPO = 'Pedido' AND p.DATA >= ? AND p.DATA < DATE_ADD(?, INTERVAL 1 DAY)
           ${cliente ? 'AND p.RAZAO_SOCIAL = ?' : ''} ${est.sql ? 'AND ' + est.sql : ''}`,
        [iv.de, iv.ate, ...(cliente ? [cliente] : []), ...est.params]);
      const r = somarPedidos(linhas);
      res.json(semValores(req, { de: iv.de, ate: iv.ate, cliente, qtdPedidos: r.qtd, valores: { total: r.total } }, ['valores']));
    } catch (err) {
      console.error('Erro GET /pedidos/total_periodo:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarTotalPeriodo };
