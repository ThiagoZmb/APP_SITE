'use strict';
// Portal do cliente, etapa 3b: financeiro (somente leitura).
// A empresa vem SEMPRE da sessão (req.portal.empresaCodigo); nenhum parâmetro, cabeçalho ou corpo escolhe a empresa.
// As consultas são fixas, com colunas escritas à mão: só DATA, PEDIDO, NOTA_FISCAL, SITUACAO e VALOR saem do banco
// (o ID aparece só no ORDER BY). Lançamento com fornecedor preenchido (pagamento a fornecedor) nunca é selecionado.
const {
  visaoValida, dinheiro, docesMesesAtras, projetarTitulo, EM_ABERTO, paginaValida, TAMANHO_PAGINA, PAGINA_MAXIMA
} = require('../calculo/portal_financeiro');
const { hojeLocal } = require('./transacao');
const { auditarPortal } = require('../portal/auditoria');

const LISTA_ABERTOS = `(${EM_ABERTO.map(s => `'${s}'`).join(',')})`;

const LIGACAO = `FROM fluxo_de_caixa f
  JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = f.RAZAO_SOCIAL
 WHERE c.CODIGO = ?
   AND COALESCE(f.RAZAO_FABRICANTE, '') = ''
   AND f.DATA IS NOT NULL
   AND f.VALOR IS NOT NULL`;

const SELECIONAR_TITULOS = `SELECT DATE_FORMAT(f.DATA, '%Y-%m-%d') AS DATA, f.PEDIDO AS PEDIDO, f.NOTA_FISCAL AS NOTA_FISCAL,
       f.SITUACAO AS SITUACAO, f.VALOR AS VALOR
  ${LIGACAO}`;

const SQL_ABERTOS = `${SELECIONAR_TITULOS}
   AND f.SITUACAO IN ${LISTA_ABERTOS}
 ORDER BY f.DATA ASC, f.ID ASC`;

const SQL_PAGOS = `${SELECIONAR_TITULOS}
   AND f.SITUACAO = 'Recebido' AND f.DATA >= ?
 ORDER BY f.DATA DESC, f.ID DESC`;

// O primeiro "?" é a data de hoje (vencido), o segundo a empresa.
const SQL_RESUMO = `SELECT COALESCE(SUM(f.VALOR),0) AS A_RECEBER,
       COALESCE(SUM(IF(f.SITUACAO IN ('Atrasado','Protestado') OR f.DATA < ?, f.VALOR, 0)),0) AS EM_ATRASO
  ${LIGACAO}
   AND f.SITUACAO IN ${LISTA_ABERTOS}`;

const VISAO_INVALIDA = { error: 'Visão inválida.' };
const PAGINA_INVALIDA = { error: 'Página inválida.' };

function registrarPortalFinanceiro({ portal, pool, hoje = hojeLocal }) {
  const falhaInterna = (res, nome, err) => {
    console.error(`Erro ${nome}:`, (err && err.code) || 'sem código');
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  portal('get', '/portal/api/financeiro', ['financeiro.ver'], async (req, res) => {
    try {
      const visao = visaoValida(req.query.visao);
      if (visao === null) return res.status(400).json(VISAO_INVALIDA);
      const pagina = paginaValida(req.query.pagina);
      if (pagina === null || pagina > PAGINA_MAXIMA) return res.status(400).json(PAGINA_INVALIDA);

      const empresa = req.portal.empresaCodigo;
      const dia = hoje();
      // LIMIT/OFFSET interpolados (inteiros já validados), como na etapa 3a.
      const paginar = `LIMIT ${TAMANHO_PAGINA + 1} OFFSET ${(pagina - 1) * TAMANHO_PAGINA}`;
      const [linhas] = visao === 'abertos'
        ? await pool.execute(`${SQL_ABERTOS} ${paginar}`, [empresa])
        : await pool.execute(`${SQL_PAGOS} ${paginar}`, [empresa, docesMesesAtras(dia)]);
      const [resumoLinhas] = await pool.execute(SQL_RESUMO, [dia, empresa]);
      const r = (resumoLinhas && resumoLinhas[0]) || {};

      const titulos = linhas.slice(0, TAMANHO_PAGINA).map(l => projetarTitulo(l, dia)).filter(Boolean);
      const corpo = {
        resumo: { aReceber: dinheiro(r.A_RECEBER) ?? 0, emAtraso: dinheiro(r.EM_ATRASO) ?? 0 },
        titulos, visao, pagina, temMais: linhas.length > TAMANHO_PAGINA
      };
      // Auditoria só do que deu certo; o detalhe leva visão e página, nunca valores nem nomes. Não lança.
      await auditarPortal(pool, {
        evento: 'financeiro_visto', usuarioId: req.portal.usuarioId, clienteCodigo: empresa,
        ip: req.ip, detalhe: `visao=${visao};pagina=${pagina}`
      });
      res.json(corpo);
    } catch (err) { falhaInterna(res, 'GET /portal/api/financeiro', err); }
  });
}

module.exports = { registrarPortalFinanceiro };
