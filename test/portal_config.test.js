process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerConfigPortal } = require('../portal/config');

const CHAVE = Buffer.alloc(32, 7).toString('base64');
const base = (extra = {}) => ({ PORTAL_URL_BASE: 'https://portal.exemplo.com.br', PORTAL_CHAVE_CRIPTO: CHAVE, ...extra });

test('ativa com URL https e chave de 32 bytes', () => {
  const c = lerConfigPortal(base());
  assert.equal(c.ativo, true);
  assert.equal(c.baseUrl, 'https://portal.exemplo.com.br');
  assert.equal(c.chaveCripto, CHAVE);
  assert.equal(c.termoVersao, '2026-11-rascunho');
  assert.equal(c.smtp, undefined);
});

test('termo de uso pode ser trocado por variável', () => {
  assert.equal(lerConfigPortal(base({ PORTAL_TERMO_VERSAO: '2027-01' })).termoVersao, '2027-01');
});

test('inativa sem PORTAL_URL_BASE', () => {
  const c = lerConfigPortal({ PORTAL_CHAVE_CRIPTO: CHAVE });
  assert.equal(c.ativo, false);
  assert.match(c.motivo, /PORTAL_URL_BASE/);
});

test('inativa sem chave', () => {
  const c = lerConfigPortal({ PORTAL_URL_BASE: 'https://portal.exemplo.com.br' });
  assert.equal(c.ativo, false);
  assert.match(c.motivo, /PORTAL_CHAVE_CRIPTO/);
});

test('http em production é recusado; em desenvolvimento só localhost', () => {
  assert.equal(lerConfigPortal(base({ PORTAL_URL_BASE: 'http://localhost:3000', NODE_ENV: 'production' })).ativo, false);
  assert.equal(lerConfigPortal(base({ PORTAL_URL_BASE: 'http://portal.exemplo.com.br', NODE_ENV: 'development' })).ativo, false);
  assert.equal(lerConfigPortal(base({ PORTAL_URL_BASE: 'http://localhost:3000', NODE_ENV: 'development' })).ativo, true);
  assert.equal(lerConfigPortal(base({ PORTAL_URL_BASE: 'http://localhost', NODE_ENV: 'test' })).ativo, true);
});

test('barra final, caminho e query são recusados', () => {
  for (const u of ['https://portal.exemplo.com.br/', 'https://portal.exemplo.com.br/portal', 'https://portal.exemplo.com.br?a=1', 'portal.exemplo.com.br', 'ftp://portal.exemplo.com.br']) {
    const c = lerConfigPortal(base({ PORTAL_URL_BASE: u }));
    assert.equal(c.ativo, false, u);
    assert.match(c.motivo, /PORTAL_URL_BASE/);
  }
});

test('chave que não tem 32 bytes é recusada', () => {
  for (const k of [Buffer.alloc(31, 1).toString('base64'), Buffer.alloc(33, 1).toString('base64'), 'isto não é base64!!']) {
    const c = lerConfigPortal(base({ PORTAL_CHAVE_CRIPTO: k }));
    assert.equal(c.ativo, false);
    assert.match(c.motivo, /PORTAL_CHAVE_CRIPTO/);
  }
});

test('smtp só com host, usuário e senha; porta padrão 465 e remetente = usuário', () => {
  assert.equal(lerConfigPortal(base({ SMTP_HOST: 'smtp.x.com', SMTP_USER: 'u@x.com' })).smtp, undefined);
  const c = lerConfigPortal(base({ SMTP_HOST: 'smtp.x.com', SMTP_USER: 'u@x.com', SMTP_PASS: 'segredo-smtp' }));
  assert.deepEqual(c.smtp, { host: 'smtp.x.com', port: 465, user: 'u@x.com', pass: 'segredo-smtp', from: 'u@x.com' });
  const d = lerConfigPortal(base({ SMTP_HOST: 'smtp.x.com', SMTP_USER: 'u@x.com', SMTP_PASS: 'p', SMTP_PORT: '587', SMTP_FROM: 'Elegance <nao-responda@x.com>' }));
  assert.equal(d.smtp.port, 587);
  assert.equal(d.smtp.from, 'Elegance <nao-responda@x.com>');
});

test('o motivo nunca contém o valor das variáveis', () => {
  const valores = ['http://valor-secreto-1.com/caminho', 'c2VncmVkby1jdXJ0bw==', 'https://valor-secreto-2.com/'];
  for (const [u, k] of [[valores[0], CHAVE], ['https://portal.exemplo.com.br', valores[1]], [valores[2], valores[1]]]) {
    const c = lerConfigPortal({ PORTAL_URL_BASE: u, PORTAL_CHAVE_CRIPTO: k, SMTP_PASS: 'senha-smtp-x' });
    assert.equal(c.ativo, false);
    for (const v of [...valores, CHAVE, 'senha-smtp-x']) assert.ok(!c.motivo.includes(v), v);
  }
});
