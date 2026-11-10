'use strict';
// Portal do cliente, etapa 3a: pedidos e status (somente leitura).
// A empresa vem SEMPRE da sessão (req.portal.empresaCodigo); nenhum parâmetro, cabeçalho ou corpo escolhe a empresa.
// A consulta é fixa e seleciona só as colunas da lista fechada + as contagens de entregas (qtd*; nunca valores, observações
// nem cliente final). Com várias entregas por pedido, a junção traz UMA linha por pedido (rotas/entregas_resumo.js).
const { projetarPedido, paginaValida, numeroValido, TAMANHO_PAGINA, PAGINA_MAXIMA } = require('../calculo/portal_pedidos');
const { criarLimiteLeitura } = require('../portal/limite_leitura');
const { juntarEntregaPrincipal, colunasQtdEntregas } = require('./entregas_resumo');

const SELECIONAR = `SELECT p.NUMERO AS NUMERO, DATE_FORMAT(p.DATA, '%Y-%m-%d') AS DATA, p.SITUACAO AS SITUACAO,
       DATE_FORMAT(p.DATA_ENTREGA, '%Y-%m-%d') AS DATA_ENTREGA, en.status AS ENTREGA_STATUS,
       DATE_FORMAT(en.data_agendada, '%Y-%m-%d') AS DATA_AGENDADA, ${colunasQtdEntregas('QTD_ENTREGAS', 'QTD_ENTREGAS_CONCLUIDAS')}
  FROM ped_orc p
  JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
  ${juntarEntregaPrincipal()}
 WHERE c.CODIGO = ? AND p.TIPO = 'Pedido'`;

const NAO_ENCONTRADO = { error: 'Pedido não encontrado.' };
const PAGINA_INVALIDA = { error: 'Página inválida.' };

function registrarPortalPedidos({ portal, pool, limite }) {
  const limitar = criarLimiteLeitura(limite);
  const falhaInterna = (res, nome, err) => {
    console.error(`Erro ${nome}:`, (err && err.code) || 'sem código');
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  portal('get', '/portal/api/pedidos', ['pedidos.ver'], limitar, async (req, res) => {
    try {
      const pagina = paginaValida(req.query.pagina);
      if (pagina === null || pagina > PAGINA_MAXIMA) return res.status(400).json(PAGINA_INVALIDA);
      // LIMIT/OFFSET interpolados (inteiros já validados): execute com placeholders neles falha no MySQL real
      // ("Incorrect arguments to mysqld_stmt_execute"); as outras rotas do projeto fazem o mesmo.
      const deslocamento = (pagina - 1) * TAMANHO_PAGINA;
      const [linhas] = await pool.execute(
        `${SELECIONAR} ORDER BY p.NUMERO DESC LIMIT ${TAMANHO_PAGINA + 1} OFFSET ${deslocamento}`,
        [req.portal.empresaCodigo]);
      res.json({ pedidos: linhas.slice(0, TAMANHO_PAGINA).map(projetarPedido), pagina, temMais: linhas.length > TAMANHO_PAGINA });
    } catch (err) { falhaInterna(res, 'GET /portal/api/pedidos', err); }
  });

  portal('get', '/portal/api/pedidos/:numero', ['pedidos.ver'], limitar, async (req, res) => {
    try {
      const numero = numeroValido(req.params.numero);
      if (numero === null) return res.status(404).json(NAO_ENCONTRADO);
      const [linhas] = await pool.execute(`${SELECIONAR} AND p.NUMERO = ? LIMIT 1`, [req.portal.empresaCodigo, numero]);
      if (!linhas.length) return res.status(404).json(NAO_ENCONTRADO);
      res.json({ pedido: projetarPedido(linhas[0]) });
    } catch (err) { falhaInterna(res, 'GET /portal/api/pedidos/:numero', err); }
  });
}

module.exports = { registrarPortalPedidos };
