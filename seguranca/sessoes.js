// ==========================================================================
// Sessões de funcionário (revogáveis): o JWT leva o `sid` e cada requisição
// confere no banco, por chave primária e sem cache, se a sessão ainda vale.
// ==========================================================================
const crypto = require('crypto');

const VALIDADE_MS = 8 * 60 * 60 * 1000; // igual à validade do JWT (8 h)

function criarSessoes({ pool, agora = () => new Date() }) {
  async function criar(usuarioCodigo, ip) {
    const id = crypto.randomBytes(16).toString('hex');
    const criadoEm = agora();
    await pool.execute(
      'INSERT INTO web_sessoes (id, usuario_codigo, criado_em, expira_em, ip, revogada) VALUES (?, ?, ?, ?, ?, 0)',
      [id, usuarioCodigo, criadoEm, new Date(criadoEm.getTime() + VALIDADE_MS), ip ? String(ip).slice(0, 45) : null]);
    return id;
  }

  // false para sid ausente/mal formado, inexistente, de outro usuário, revogado ou expirado
  async function valida(sid, usuarioCodigo) {
    if (typeof sid !== 'string' || !/^[0-9a-f]{32}$/.test(sid)) return false;
    const [linhas] = await pool.execute(
      'SELECT id FROM web_sessoes WHERE id = ? AND usuario_codigo = ? AND revogada = 0 AND expira_em > ? LIMIT 1',
      [sid, usuarioCodigo, agora()]);
    return linhas.length > 0;
  }

  async function revogar(sid) {
    await pool.execute('UPDATE web_sessoes SET revogada = 1 WHERE id = ?', [sid]);
  }

  // todas as sessões do usuário; `exceto` = sid que continua valendo (ex.: a de quem trocou a senha)
  async function revogarTodas(usuarioCodigo, { exceto } = {}) {
    if (exceto) {
      await pool.execute('UPDATE web_sessoes SET revogada = 1 WHERE usuario_codigo = ? AND revogada = 0 AND id <> ?', [usuarioCodigo, exceto]);
    } else {
      await pool.execute('UPDATE web_sessoes SET revogada = 1 WHERE usuario_codigo = ? AND revogada = 0', [usuarioCodigo]);
    }
  }

  return { criar, valida, revogar, revogarTodas };
}

module.exports = { criarSessoes, VALIDADE_MS };
