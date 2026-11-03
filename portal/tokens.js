// ==========================================================================
// Tokens opacos (sessão, convite, redefinição) e códigos de recuperação.
// O banco guarda só o hash SHA-256; o valor original vai uma vez ao usuário.
// ==========================================================================
const crypto = require('node:crypto');

// sem 0 O 1 I L (evita confusão ao digitar); são 31 símbolos, então sorteia
// por rejeição (aceita só bytes < 31 * 8) para não haver viés no módulo
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LIMITE = 256 - (256 % ALFABETO.length);

const exigirTexto = (v, nome) => {
  if (typeof v !== 'string' || v === '') throw new TypeError(`${nome} precisa ser um texto não vazio.`);
  return v;
};

// token opaco tem 256 bits: SHA-256 simples basta
const hashToken = token => crypto.createHash('sha256').update(exigirTexto(token, 'O token')).digest('hex');

function novoTokenOpaco() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

// Código de recuperação tem ~40 bits: SHA-256 puro seria quebrável offline se o banco vazasse.
// Por isso o hash é HMAC com uma subchave derivada da chave do servidor (PORTAL_CHAVE_CRIPTO).
function subchaveRecuperacao(chaveBase64) {
  const chave = Buffer.from(typeof chaveBase64 === 'string' ? chaveBase64 : '', 'base64');
  if (chave.length !== 32) throw new Error('A chave do servidor precisa ser base64 de exatamente 32 bytes.');
  return crypto.createHmac('sha256', chave).update('recuperacao-v1').digest();
}

function hashCodigoRecuperacao(codigo, chaveBase64) {
  const sub = subchaveRecuperacao(chaveBase64);
  const normal = exigirTexto(codigo, 'O código').toUpperCase().replace(/[-\s]/g, '');
  return crypto.createHmac('sha256', sub).update(normal).digest('hex');
}

function umCodigo() {
  let s = '';
  while (s.length < 8) {
    for (const b of crypto.randomBytes(16)) {
      if (b < LIMITE && s.length < 8) s += ALFABETO[b % ALFABETO.length];
    }
  }
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function gerarCodigosRecuperacao(n = 10, chaveBase64) {
  subchaveRecuperacao(chaveBase64); // falha cedo se a chave for inválida
  const codigos = new Set();
  while (codigos.size < n) codigos.add(umCodigo());
  const lista = [...codigos];
  return { codigos: lista, hashes: lista.map(c => hashCodigoRecuperacao(c, chaveBase64)) };
}

module.exports = { novoTokenOpaco, hashToken, gerarCodigosRecuperacao, hashCodigoRecuperacao };
