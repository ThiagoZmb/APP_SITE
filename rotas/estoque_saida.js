// ==========================================================================
// Saída de estoque compartilhada: POST /estoque/saida (frm_Saida_Estoque) e a baixa das varas novas ao confirmar um plano de corte.
// Grava nas tabelas do VB do jeito que ele espera (saida_estoque, estoque.QTD_ESTOQUE). Tudo roda na transação de quem chama.
// ==========================================================================
const { ErroUsuario } = require('./transacao');

const LIMITE_LINHA_SAIDA = 127; // saida_estoque.QTD é tinyint

// trava e devolve os produtos pedidos, indexados pelo código
async function travarProdutos(conn, codigos) {
  const unicos = [...new Set(codigos.map(Number))];
  const [linhas] = await conn.execute(
    `SELECT CODIGO, NOME_PRODUTO, QTD_ESTOQUE, VALOR, CODIGO_BARRA, FORNECEDOR, NOME_PRODUTO_FORNECEDOR, COD_FORNECEDOR
     FROM estoque WHERE CODIGO IN (${unicos.map(() => '?').join(', ')}) FOR UPDATE`, unicos);
  return new Map(linhas.map(l => [Number(l.CODIGO), l]));
}

// recusa (400) a saída que deixaria o produto com quantidade negativa
function conferirSaldo(p, qtd) {
  const atual = Number(p.QTD_ESTOQUE) || 0;
  if (atual - qtd < 0) throw new ErroUsuario(400, `A quantidade do item '${p.NOME_PRODUTO}' é menor que 0! (estoque: ${atual}, saída: ${qtd})`);
}

// Grava a saída de cada item { p: linha travada de travarProdutos, qtd }: linhas em saida_estoque (STATUS NULL, divididas em
// LIMITE_LINHA_SAIDA) e abate estoque.QTD_ESTOQUE. `quando` é a mesma em todas as linhas: é assim que o lançamento se reagrupa.
async function gravarSaidas(conn, itens, { quando, usuario }) {
  const resumo = [];
  for (const { p, qtd } of itens) {
    for (let resta = qtd; resta > 0; resta -= LIMITE_LINHA_SAIDA) {
      await conn.execute(
        `INSERT INTO saida_estoque (CODIGO_BARRA, FORNECEDOR, NOME_PRODUTO_FORNECEDOR, NOME_PRODUTO, DATA, QTD, USUARIO, STATUS)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        [p.CODIGO_BARRA || '', p.FORNECEDOR || '', p.NOME_PRODUTO_FORNECEDOR || '', p.NOME_PRODUTO, quando, Math.min(resta, LIMITE_LINHA_SAIDA), usuario]);
    }
    await conn.execute('UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE - ? WHERE CODIGO = ?', [qtd, p.CODIGO]);
    const antes = Number(p.QTD_ESTOQUE) || 0;
    resumo.push({ produto: p.NOME_PRODUTO, antes, depois: antes - qtd });
  }
  return resumo;
}

module.exports = { LIMITE_LINHA_SAIDA, travarProdutos, conferirSaldo, gravarSaidas };
