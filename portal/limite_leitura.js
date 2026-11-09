'use strict';
// Limite de uso por usuário do portal nas rotas de leitura (pedidos e financeiro). Só em memória; vem DEPOIS da
// autenticação (precisa de req.portal), então a contagem nunca vaza nada a quem não tem sessão. Cada requisição
// autenticada custa consultas no MySQL compartilhado com o ERP; sem teto, um laço derrubaria o banco.
const rateLimit = require('express-rate-limit');

const LIMITE_LEITURA_PADRAO = { janelaMs: 60 * 1000, max: 120 };
const MSG_LIMITE_LEITURA = { error: 'Muitas consultas em pouco tempo. Aguarde um instante e tente de novo.' };

function criarLimiteLeitura(limite = LIMITE_LEITURA_PADRAO) {
  return rateLimit({
    windowMs: limite.janelaMs, limit: limite.max,
    keyGenerator: req => `u${req.portal.usuarioId}`,
    standardHeaders: false, legacyHeaders: false,
    handler: (req, res) => res.status(429).set('Retry-After', String(Math.ceil(limite.janelaMs / 1000))).json(MSG_LIMITE_LEITURA)
  });
}

module.exports = { criarLimiteLeitura, LIMITE_LEITURA_PADRAO };
