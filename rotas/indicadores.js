// ==========================================================================
// Indicadores do painel de Pedidos e Orçamentos, calculados NO SERVIDOR (somente leitura).
//   GET /painel/indicadores?periodo=mes|mes-ant|3|6|12|ano|tudo&cliente=RAZÃO SOCIAL
// Blocos "Operação agora" e "Resultado do período" de painel_inicial.html. Exige pedidos.ver E indicadores.ver.
// Estados restritos do usuário filtram pelo cliente (como /dados_lista); dinheiro só dentro de `valores` (valores.ver).
// Contas em calculo/indicadores_painel.js. Regras: docs/regras/outras-regras.md
// ==========================================================================
const { filtroEstados } = require('../seguranca/acesso');
const { semValores } = require('../seguranca/valores');
const { hojeLocal } = require('./transacao');
const { calcularIndicadores, validarPeriodo, dataBRSegura } = require('../calculo/indicadores_painel');

const EXIGE = ['pedidos.ver', 'indicadores.ver'];
const MAX_CLIENTE = 200;

function registrarIndicadores({ rota, pool }) {
  rota('get', '/painel/indicadores', EXIGE, async (req, res) => {
    const periodo = validarPeriodo(req.query.periodo);
    if (!periodo) return res.status(400).json({ error: 'Período inválido.' });
    const cliente = typeof req.query.cliente === 'string' ? req.query.cliente : '';
    if (req.query.cliente !== undefined && typeof req.query.cliente !== 'string') return res.status(400).json({ error: 'Cliente inválido.' });
    if (cliente.length > MAX_CLIENTE) return res.status(400).json({ error: 'Cliente inválido.' });
    try {
      const est = filtroEstados(req, 'c.ESTADO');
      const [linhas] = await pool.execute(
        `SELECT p.TIPO AS tipo, p.RAZAO_SOCIAL AS cliente, DATE_FORMAT(p.DATA, '%d/%m/%Y') AS data, p.TOTAL AS valor,
                p.SITUACAO AS situacao, p.FINANCEIRO AS financeiro,
                CAST(p.DATA_PRONTO AS CHAR) AS prontoEm, CAST(p.DATA_ENTREGA AS CHAR) AS dataEntrega
         FROM ped_orc p
         ${est.sql ? 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL' : ''}
         WHERE p.TIPO IN ('Pedido', 'Orçamento') ${cliente ? 'AND p.RAZAO_SOCIAL = ?' : ''} ${est.sql ? 'AND ' + est.sql : ''}`,
        [...(cliente ? [cliente] : []), ...est.params]);
      const normal = linhas.map(r => ({ ...r, prontoEm: dataBRSegura(r.prontoEm), dataEntrega: dataBRSegura(r.dataEntrega) }));
      const dados = calcularIndicadores({
        pedidos: normal.filter(r => r.tipo === 'Pedido'),
        orcamentos: normal.filter(r => r.tipo === 'Orçamento'),
        periodo, cliente, hoje: hojeLocal()
      });
      res.json(semValores(req, dados, ['valores']));
    } catch (err) {
      console.error('Erro GET /painel/indicadores:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarIndicadores };
