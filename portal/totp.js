// ==========================================================================
// TOTP (RFC 6238): HMAC-SHA1, 6 dígitos, passo de 30 s. Só node:crypto.
// `verificar` devolve o PASSO aceito: quem chama grava e o repassa como
// `ultimoPasso`, para um mesmo código nunca valer duas vezes.
// ==========================================================================
const crypto = require('node:crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASSO_SEGUNDOS = 30;
const DIGITOS = 6;
const JANELA = 1; // aceita passo atual ±1 (deriva de relógio)

function base32Codificar(buf) {
  let bits = 0, valor = 0, saida = '';
  for (const byte of buf) {
    valor = ((valor << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) { saida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

function base32Decodificar(texto) {
  let bits = 0, valor = 0;
  const bytes = [];
  for (const ch of String(texto).toUpperCase().replace(/=+$/, '')) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error('Segredo TOTP inválido.');
    valor = ((valor << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

const gerarSegredo = () => base32Codificar(crypto.randomBytes(20));

function codigoEm(segredo, passo) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac('sha1', base32Decodificar(segredo)).update(contador).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

function verificar(segredo, codigo, { agora = Date.now(), ultimoPasso = 0 } = {}) {
  if (typeof codigo !== 'string') return { ok: false };
  const limpo = codigo.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(limpo)) return { ok: false };
  const recebido = Buffer.from(limpo);
  const atual = Math.floor(agora / 1000 / PASSO_SEGUNDOS);
  let aceito = null;
  // percorre todas as janelas, sem parar no primeiro acerto; comparação em tempo constante
  for (let p = atual - JANELA; p <= atual + JANELA; p++) {
    const igual = crypto.timingSafeEqual(recebido, Buffer.from(codigoEm(segredo, p)));
    if (igual && p > ultimoPasso && aceito === null) aceito = p;
  }
  return aceito === null ? { ok: false } : { ok: true, passo: aceito };
}

function uriOtpauth({ segredo, email, emissor = 'Elegance' }) {
  const rotulo = `${encodeURIComponent(emissor)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}`
    + `&algorithm=SHA1&digits=${DIGITOS}&period=${PASSO_SEGUNDOS}`;
}

module.exports = { gerarSegredo, codigoEm, verificar, uriOtpauth };
