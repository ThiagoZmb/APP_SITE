// Chave de manutenção (ADMIN_KEY) das rotas /admin/* e /migrar_senhas.
// - Desligada por padrão: só vale com ADMIN_ROTAS=1 (o dono liga quando precisar e desliga depois).
// - Compara os SHA-256 da chave enviada e da configurada em tempo constante (tamanhos diferentes não lançam).
// - Header ausente, vazio ou repetido (array) nunca confere.
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');

const sha256 = valor => crypto.createHash('sha256').update(String(valor), 'utf8').digest();

function chaveAdminConfere(req, env = process.env) {
  const configurada = env.ADMIN_KEY;
  if (!configurada || env.ADMIN_ROTAS !== '1') return false;
  const enviada = req.headers?.['x-admin-key'];
  if (typeof enviada !== 'string' || enviada === '') return false;
  return crypto.timingSafeEqual(sha256(enviada), sha256(configurada));
}

// Só as tentativas que falham contam (status >= 400): 5 por 15 min por IP.
const limitadorAdmin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = { chaveAdminConfere, limitadorAdmin };
