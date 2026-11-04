process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { lerConfigPortal } = require('../portal/config');

const CHAVE = crypto.randomBytes(32).toString('base64');
const base = url => lerConfigPortal({ PORTAL_URL_BASE: url, PORTAL_CHAVE_CRIPTO: CHAVE, NODE_ENV: 'production' });

test('PORTAL_URL_BASE é normalizada: minúsculas, sem :443 e sem barra final', () => {
  const casos = [
    ['https://Meu-Servico.OnRender.com', 'https://meu-servico.onrender.com'],
    ['https://meu-servico.onrender.com:443', 'https://meu-servico.onrender.com'],
    ['HTTPS://Meu-Servico.onrender.com:443/', 'https://meu-servico.onrender.com'],
    ['  https://meu-servico.onrender.com/  ', 'https://meu-servico.onrender.com'],
    ['https://meu-servico.onrender.com', 'https://meu-servico.onrender.com']
  ];
  assert.ok(casos.length > 0);
  for (const [entrada, esperado] of casos) {
    const c = base(entrada);
    assert.equal(c.ativo, true, entrada);
    assert.equal(c.baseUrl, esperado, entrada);
  }
});

test('porta diferente da padrão é mantida; o Origin do navegador a traz junto', () => {
  assert.equal(base('https://exemplo.com:8443').baseUrl, 'https://exemplo.com:8443');
  assert.equal(lerConfigPortal({ PORTAL_URL_BASE: 'http://LOCALHOST:3000', PORTAL_CHAVE_CRIPTO: CHAVE, NODE_ENV: 'development' }).baseUrl, 'http://localhost:3000');
});

test('o que continua inválido segue recusado, sem repetir o valor no motivo', () => {
  const ruins = ['https://exemplo.com/portal', 'https://exemplo.com?x=1', 'https://exemplo.com#a', 'ftp://exemplo.com', 'exemplo.com', 'https://u:p@exemplo.com', 'http://exemplo.com'];
  for (const v of ruins) {
    const c = base(v);
    assert.equal(c.ativo, false, v);
    assert.match(c.motivo, /PORTAL_URL_BASE inválida/, v);
    assert.ok(!c.motivo.includes('exemplo'), 'o motivo não pode repetir o valor');
  }
  assert.equal(ruins.length, 7);
});
