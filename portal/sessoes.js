// ==========================================================================
// Sessões do portal do cliente: token opaco no cookie, só o hash no banco.
// Validade absoluta de 8 h, inatividade máxima de 60 min; revogáveis por
// token, usuário ou empresa. Datas gravadas e comparadas como em seguranca/sessoes.js.
// ==========================================================================
const { novoTokenOpaco, hashToken } = require('./tokens');

const VALIDADE_MS = 8 * 60 * 60 * 1000;
const INATIVIDADE_MS = 60 * 60 * 1000;
const RENOVACAO_MS = 60 * 1000; // ultimo_uso_em só é regravado se tiver mais de 1 minuto

// novoTokenOpaco: 32 bytes em base64url = 43 caracteres
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function criarSessoesPortal({ pool, agora = () => new Date() }) {
  async function criar(usuarioId, ip) {
    const { token, hash } = novoTokenOpaco();
    const criadoEm = agora();
    await pool.execute(
      'INSERT INTO web_portal_sessoes (id, usuario_id, criado_em, expira_em, ultimo_uso_em, ip, revogada) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [hash, usuarioId, criadoEm, new Date(criadoEm.getTime() + VALIDADE_MS), criadoEm, ip ? String(ip).slice(0, 45) : null]);
    return token;
  }

  // null para token mal formado (sem consultar o banco), desconhecido, revogado, expirado ou inativo
  async function valida(token) {
    if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) return null;
    const id = hashToken(token);
    const agoraData = agora();
    const [linhas] = await pool.execute(
      'SELECT usuario_id FROM web_portal_sessoes WHERE id = ? AND revogada = 0 AND expira_em > ? AND ultimo_uso_em >= ? LIMIT 1',
      [id, agoraData, new Date(agoraData.getTime() - INATIVIDADE_MS)]);
    if (!linhas.length) return null;
    // a comparação fica no banco: só grava se o último uso for anterior a 1 minuto atrás
    await pool.execute(
      'UPDATE web_portal_sessoes SET ultimo_uso_em = ? WHERE id = ? AND ultimo_uso_em < ?',
      [agoraData, id, new Date(agoraData.getTime() - RENOVACAO_MS)]);
    return { usuarioId: linhas[0].usuario_id };
  }

  async function revogar(token) {
    if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) return;
    await pool.execute('UPDATE web_portal_sessoes SET revogada = 1 WHERE id = ?', [hashToken(token)]);
  }

  async function revogarUsuario(usuarioId) {
    await pool.execute('UPDATE web_portal_sessoes SET revogada = 1 WHERE usuario_id = ? AND revogada = 0', [usuarioId]);
  }

  // todas as sessões dos usuários da empresa (suspensão da empresa)
  async function revogarEmpresa(clienteCodigo) {
    await pool.execute(
      'UPDATE web_portal_sessoes s INNER JOIN web_portal_usuarios u ON u.id = s.usuario_id SET s.revogada = 1 WHERE u.cliente_codigo = ? AND s.revogada = 0',
      [clienteCodigo]);
  }

  return { criar, valida, revogar, revogarUsuario, revogarEmpresa };
}

module.exports = { criarSessoesPortal, VALIDADE_MS, INATIVIDADE_MS };
