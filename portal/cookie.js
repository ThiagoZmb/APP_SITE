// ==========================================================================
// Cookie da sessão do portal (sem dependência). Prefixo __Host-: só vale com
// Secure, Path=/ e sem Domain, então um subdomínio não consegue sobrescrevê-lo.
// ==========================================================================
const NOME_COOKIE = '__Host-portal';
const ATRIBUTOS = 'HttpOnly; Secure; SameSite=Strict; Path=/';

// Valor do cookie `nome`, exatamente como veio (sem decodificar). Nome repetido é ambíguo: null.
function lerCookie(req, nome) {
  const cabecalho = req.headers && req.headers.cookie;
  if (typeof cabecalho !== 'string') return null;
  const achados = [];
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) achados.push(parte.slice(i + 1).trim());
  }
  if (achados.length !== 1 || achados[0] === '') return null;
  return achados[0];
}

function cookieSessao(valor, { maxAgeSeg = 28800 } = {}) {
  // o valor é o token opaco (base64url); qualquer outra coisa poderia injetar atributos
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(valor)) throw new TypeError('Valor de cookie inválido.');
  if (!Number.isInteger(maxAgeSeg) || maxAgeSeg < 0) throw new TypeError('maxAgeSeg precisa ser um inteiro maior ou igual a zero.');
  return `${NOME_COOKIE}=${valor}; Max-Age=${maxAgeSeg}; ${ATRIBUTOS}`;
}

function cookieLimpar() {
  return `${NOME_COOKIE}=; Max-Age=0; ${ATRIBUTOS}`;
}

module.exports = { NOME_COOKIE, lerCookie, cookieSessao, cookieLimpar };
