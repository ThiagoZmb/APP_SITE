// Transação com nova tentativa em deadlock, erro de usuário e hora local (Brasília). Compartilhado pelas rotas.
class ErroUsuario extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; }
}

// deadlock ou espera de trava esgotada: o MySQL desfez a transação inteira, dá para tentar de novo
const ehConcorrencia = err => err?.errno === 1213 || err?.errno === 1205;
const TENTATIVAS = 3;

// Roda `trabalho(conn)` numa transação; ErroUsuario vira a resposta com a mensagem, outros erros viram 500.
// Em deadlock (por exemplo, o VB gravando ao mesmo tempo) a transação é refeita do zero, até 3 vezes.
async function emTransacao(pool, res, rotaNome, trabalho) {
  for (let tentativa = 1; ; tentativa++) {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const resultado = await trabalho(conn);
      await conn.commit();
      return resultado;
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      if (ehConcorrencia(err) && tentativa < TENTATIVAS) continue;
      if (err instanceof ErroUsuario) res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      else { console.error(`Erro ${rotaNome}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); }
      return undefined;
    } finally {
      if (conn) conn.release();
    }
  }
}

// hora de Brasília (o servidor no Render roda em UTC; o VB grava a hora local)
const horaLocal = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
const agoraLocal = () => `${hojeLocal()} ${horaLocal()}`; // gravado nas tabelas web_ no lugar de NOW() (o MySQL pode estar em outro fuso)
const hojeLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // AAAA-MM-DD

module.exports = { ErroUsuario, emTransacao, agoraLocal, hojeLocal, horaLocal };
