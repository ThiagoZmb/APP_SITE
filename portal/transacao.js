// Transação simples das rotas do portal: libera a conexão em todos os caminhos.
// ErroUsuario vira a resposta com a mensagem; ER_DUP_ENTRY vira 409; o resto vira 500 genérico
// (o log leva só o código do erro, nunca err.message: pode trazer dados do banco).
const { ErroUsuario } = require('../rotas/transacao');

async function emTransacaoPortal(pool, res, nome, trabalho) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const resultado = await trabalho(conn);
    await conn.commit();
    return resultado;
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err instanceof ErroUsuario) res.status(err.status).json({ error: err.message });
    else if (err && err.code === 'ER_DUP_ENTRY') res.status(409).json({ error: 'Já existe um registro igual.' });
    else {
      console.error(`Erro ${nome}:`, (err && err.code) || 'sem código');
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
    return undefined;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { emTransacaoPortal };
