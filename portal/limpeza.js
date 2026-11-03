// Retenção dos dados do portal: roda na subida e a cada 24 h (index.js).
// As datas são objetos Date entregues ao mysql2, como em seguranca/sessoes.js.

const DIA_MS = 24 * 60 * 60 * 1000;

async function limparPortal(pool, { agora = () => new Date() } = {}) {
  const hoje = agora();
  const umAno = new Date(hoje);
  umAno.setUTCMonth(umAno.getUTCMonth() - 12);

  // auditoria: 12 meses; sessões: expiradas há mais de 1 dia; convites: expirados há mais de 30 dias
  const [a] = await pool.execute('DELETE FROM web_portal_auditoria WHERE quando < ?', [umAno]);
  const [s] = await pool.execute('DELETE FROM web_portal_sessoes WHERE expira_em < ?', [new Date(hoje.getTime() - DIA_MS)]);
  const [c] = await pool.execute('DELETE FROM web_portal_convites WHERE expira_em < ?', [new Date(hoje.getTime() - 30 * DIA_MS)]);
  return { auditoria: a?.affectedRows || 0, sessoes: s?.affectedRows || 0, convites: c?.affectedRows || 0 };
}

module.exports = { limparPortal };
