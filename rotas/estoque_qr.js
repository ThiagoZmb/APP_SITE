// ==========================================================================
// Baixa de estoque por QR/código de barras: rotas de leitura.
//   GET /estoque/por_codigo/:codigo  -> item lido pelo celular (só 4 campos)
//   GET /estoque/etiquetas           -> lista para imprimir etiquetas
// Só lê; a baixa usa a saída de estoque que já existe (POST /estoque/saida).
// ==========================================================================
const { codigoValido, projetarItem, projetarEtiquetas } = require('../calculo/estoque_qr');

function registrarEstoqueQr({ rota, pool }) {
  const falha = (res, rotaNome, err) => {
    console.error(`Erro ${rotaNome}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  rota('get', '/estoque/por_codigo/:codigo', ['estoque.ver', 'estoque.movimentar'], async (req, res) => {
    try {
      const codigo = codigoValido(req.params.codigo);
      if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
      // O banco não garante CODIGO_BARRA único: LIMIT 2 basta para detectar a repetição.
      const [linhas] = await pool.execute(
        'SELECT CODIGO, NOME_PRODUTO, UNIDADE, QTD_ESTOQUE, SITUACAO FROM estoque WHERE CODIGO_BARRA = ? LIMIT 2', [codigo]);
      if (linhas.length > 1) return res.status(409).json({ error: 'Código de barras repetido no estoque: avise o administrador.' });
      if (!linhas.length || /^inativo$/i.test(String(linhas[0].SITUACAO ?? '').trim())) {
        return res.status(404).json({ error: 'Item não encontrado.' });
      }
      res.json(projetarItem(linhas[0]));
    } catch (err) { falha(res, 'GET /estoque/por_codigo', err); }
  });

  rota('get', '/estoque/etiquetas', ['estoque.ver', 'estoque.editar'], async (req, res) => {
    try {
      const [linhas] = await pool.execute(
        "SELECT CODIGO, NOME_PRODUTO, UNIDADE, CODIGO_BARRA FROM estoque WHERE SITUACAO = 'Ativo' ORDER BY NOME_PRODUTO ASC");
      res.json(projetarEtiquetas(linhas));
    } catch (err) { falha(res, 'GET /estoque/etiquetas', err); }
  });
}

module.exports = { registrarEstoqueQr };
