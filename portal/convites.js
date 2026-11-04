// ==========================================================================
// Convites do portal do cliente, compartilhados pelas rotas da equipe (rotas/portal_admin.js)
// e pelas do administrador da empresa. O token existe só em memória: o banco recebe o hash e
// o link (com o token no fragmento) só volta ao chamador quando o e-mail NÃO foi enviado.
// ==========================================================================
const { novoTokenOpaco } = require('./tokens');

const VALIDADE_CONVITE_MS = 48 * 60 * 60 * 1000;

// convite novo de 48 h; o hash vai ao banco e o token em claro volta só para montar o link
async function criarConvite(conn, usuarioId, quem) {
  const { token, hash } = novoTokenOpaco();
  const agora = new Date();
  await conn.execute(
    'INSERT INTO web_portal_convites (token_hash, usuario_id, expira_em, criado_por, criado_em) VALUES (?, ?, ?, ?, ?)',
    [hash, usuarioId, new Date(agora.getTime() + VALIDADE_CONVITE_MS), quem, agora]);
  return token;
}

// convites antigos do usuário deixam de valer
function invalidarConvites(conn, usuarioId) {
  return conn.execute('UPDATE web_portal_convites SET usado_em = ? WHERE usuario_id = ? AND usado_em IS NULL', [new Date(), usuarioId]);
}

// depois do commit: tenta o e-mail; sem envio devolve o link para repassar à mão
async function responderConviteJson({ config, email }, { token, para, razaoSocial }) {
  const link = `${config.baseUrl}/portal/convite.html#${token}`;
  let enviado = false;
  try { enviado = !!(await email.enviarConvite({ para, link, razaoSocial })).enviado; } catch { enviado = false; }
  return enviado ? { enviado: true } : { enviado: false, link };
}

module.exports = { VALIDADE_CONVITE_MS, criarConvite, invalidarConvites, responderConviteJson };
