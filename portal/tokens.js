// ==========================================================================
// Tokens opacos (sessão, convite, redefinição) e códigos de recuperação.
// O banco guarda só o hash SHA-256; o valor original vai uma vez ao usuário.
// ==========================================================================
const crypto = require('node:crypto');

// sem 0 O 1 I L (evita confusão ao digitar); são 31 símbolos, então sorteia
// por rejeição (aceita só bytes < 31 * 8) para não haver viés no módulo
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LIMITE = 256 - (256 % ALFABETO.length);

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

function novoTokenOpaco() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

const hashCodigoRecuperacao = codigo =>
  hashToken(String(codigo).toUpperCase().replace(/[-\s]/g, ''));

function umCodigo() {
  let s = '';
  while (s.length < 8) {
    for (const b of crypto.randomBytes(16)) {
      if (b < LIMITE && s.length < 8) s += ALFABETO[b % ALFABETO.length];
    }
  }
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function gerarCodigosRecuperacao(n = 10) {
  const codigos = new Set();
  while (codigos.size < n) codigos.add(umCodigo());
  const lista = [...codigos];
  return { codigos: lista, hashes: lista.map(hashCodigoRecuperacao) };
}

module.exports = { novoTokenOpaco, hashToken, gerarCodigosRecuperacao, hashCodigoRecuperacao };
