// Auditoria do portal (web_portal_auditoria). Nunca lança: falha de auditoria não derruba o fluxo,
// e o log leva só o código do erro. `detalhe` não pode conter senha, token, código nem e-mail de conta inexistente.
async function auditarPortal(pool, { evento, usuarioId = null, clienteCodigo = null, ip = null, detalhe = null }) {
  try {
    const texto = detalhe == null ? null : (typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe));
    await pool.execute(
      'INSERT INTO web_portal_auditoria (quando, evento, usuario_id, cliente_codigo, ip, detalhe) VALUES (?, ?, ?, ?, ?, ?)',
      [new Date(), String(evento).slice(0, 40), usuarioId, clienteCodigo, ip ? String(ip).slice(0, 45) : null, texto]);
  } catch (err) {
    console.error('[portal] auditoria falhou:', (err && err.code) || 'sem código');
  }
}

module.exports = { auditarPortal };
