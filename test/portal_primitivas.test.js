process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { validarSenha, SENHAS_FRACAS } = require('../portal/senha');
const totp = require('../portal/totp');
const { criarCripto } = require('../portal/cripto');
const tokens = require('../portal/tokens');

const EMAIL = 'maria.souza@exemplo.com.br';

// ---------- senha ----------
test('senha: limite de 11 e 12 caracteres', () => {
  assert.equal(validarSenha('aB3$kLm9xQz', { email: EMAIL }).ok, false);
  assert.equal(validarSenha('aB3$kLm9xQzP', { email: EMAIL }).ok, true);
  assert.match(validarSenha('curta', { email: EMAIL }).motivo, /12/);
});

test('senha: limite de 72 bytes UTF-8 (acentos contam 2 bytes)', () => {
  const exata = 'é'.repeat(35) + 'ab'; // 70 + 2 = 72 bytes (37 caracteres)
  assert.equal(Buffer.byteLength(exata), 72);
  assert.equal(validarSenha(exata, { email: EMAIL }).ok, true);
  const passou = exata + 'c';
  assert.equal(Buffer.byteLength(passou), 73);
  const r = validarSenha(passou, { email: EMAIL });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /72/);
});

test('senha: 36 "é" = 72 bytes passa no tamanho; 37 passa de 72 bytes', () => {
  // só um caractere repetido é recusado por outro motivo; conferimos o motivo
  assert.doesNotMatch(validarSenha('é'.repeat(36), { email: EMAIL }).motivo || '', /72/);
  assert.match(validarSenha('é'.repeat(37), { email: EMAIL }).motivo, /72/);
});

test('senha: recusa um caractere só repetido', () => {
  const r = validarSenha('aaaaaaaaaaaaaa', { email: EMAIL });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /repet/i);
});

test('senha: recusa contida no e-mail ou contendo a parte local, sem caixa', () => {
  const a = validarSenha('maria.souza@exemplo.com.br', { email: EMAIL });
  assert.equal(a.ok, false);
  assert.match(a.motivo, /e-mail/i);
  const b = validarSenha('XX-Maria.Souza-99!', { email: EMAIL });
  assert.equal(b.ok, false);
  assert.match(b.motivo, /e-mail/i);
  const c = validarSenha('exemplo.com.br', { email: EMAIL });
  assert.equal(c.ok, false);
});

test('senha: parte local curta (< 4) não recusa por acaso', () => {
  assert.equal(validarSenha('Ana-cavalo-roxo-77', { email: 'ana@x.com' }).ok, true);
  assert.equal(validarSenha('aB3$kLm9xQzPaa', { email: 'a@x.com' }).ok, true);
});

test('senha: lista fixa de senhas fracas', () => {
  for (const s of ['123456789012', 'senhasenha12', 'elegance2026', 'elegancealuminio', 'qwertyuiop12']) {
    assert.ok(SENHAS_FRACAS.includes(s), s);
    const r = validarSenha(s, { email: EMAIL });
    assert.equal(r.ok, false, s);
    assert.match(r.motivo, /comum|fraca/i);
  }
  assert.equal(validarSenha('ELEGANCE2026', { email: EMAIL }).ok, false);
});

test('senha: aceita uma boa', () => {
  assert.deepEqual(validarSenha('cavalo-azul-37-Tijolo', { email: EMAIL }), { ok: true });
});

// ---------- TOTP ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function paraBase32(buf) {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let saida = '';
  for (let i = 0; i < bits.length; i += 5) saida += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return saida;
}
const SEGREDO_RFC = paraBase32(Buffer.from('12345678901234567890', 'ascii'));

test('totp: vetores do RFC 6238 (HMAC-SHA1, 6 últimos dígitos)', () => {
  const vetores = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'],
    [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']];
  for (const [t, esperado] of vetores) {
    assert.equal(totp.codigoEm(SEGREDO_RFC, Math.floor(t / 30)), esperado, `t=${t}`);
    assert.deepEqual(totp.verificar(SEGREDO_RFC, esperado, { agora: t * 1000 }), { ok: true, passo: Math.floor(t / 30) });
  }
});

test('totp: gerarSegredo é base32 de 20 bytes sem padding e diferente a cada vez', () => {
  const a = totp.gerarSegredo();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.notEqual(a, totp.gerarSegredo());
});

test('totp: deriva de ±1 passo aceita e ±2 recusada', () => {
  const t0 = 1111111109 * 1000; // passo 37037036
  const passo = Math.floor(t0 / 30000);
  for (const d of [-1, 1]) {
    const cod = totp.codigoEm(SEGREDO_RFC, passo + d);
    assert.deepEqual(totp.verificar(SEGREDO_RFC, cod, { agora: t0 }), { ok: true, passo: passo + d });
  }
  for (const d of [-2, 2]) {
    const cod = totp.codigoEm(SEGREDO_RFC, passo + d);
    assert.equal(totp.verificar(SEGREDO_RFC, cod, { agora: t0 }).ok, false);
  }
});

test('totp: mesmo passo recusado na segunda vez (ultimoPasso)', () => {
  const agora = 1111111109 * 1000;
  const cod = '081804';
  const r1 = totp.verificar(SEGREDO_RFC, cod, { agora });
  assert.equal(r1.ok, true);
  assert.equal(totp.verificar(SEGREDO_RFC, cod, { agora, ultimoPasso: r1.passo }).ok, false);
  // passo anterior ao último também recusado; posterior aceito
  const ant = totp.codigoEm(SEGREDO_RFC, r1.passo - 1);
  assert.equal(totp.verificar(SEGREDO_RFC, ant, { agora, ultimoPasso: r1.passo }).ok, false);
  const prox = totp.codigoEm(SEGREDO_RFC, r1.passo + 1);
  assert.deepEqual(totp.verificar(SEGREDO_RFC, prox, { agora, ultimoPasso: r1.passo }), { ok: true, passo: r1.passo + 1 });
});

test('totp: ignora espaços e recusa formatos inválidos', () => {
  const agora = 59 * 1000;
  assert.equal(totp.verificar(SEGREDO_RFC, '287 082', { agora }).ok, true);
  for (const ruim of ['28708a', '12345', '', '2870822', null, undefined, 287082]) {
    assert.equal(totp.verificar(SEGREDO_RFC, ruim, { agora }).ok, false, String(ruim));
  }
});

test('totp: uriOtpauth', () => {
  const uri = totp.uriOtpauth({ segredo: 'ABC234', email: 'a b@x.com' });
  assert.ok(uri.startsWith('otpauth://totp/Elegance:a%20b%40x.com?'));
  assert.match(uri, /secret=ABC234/);
  assert.match(uri, /issuer=Elegance/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

// ---------- cifra ----------
const CHAVE = crypto.randomBytes(32).toString('base64');

test('cripto: ida e volta, IV novo a cada chamada, formato v1', () => {
  const c = criarCripto(CHAVE);
  const a = c.cifrar('segredo-totp-ÁÉ');
  const b = c.cifrar('segredo-totp-ÁÉ');
  assert.notEqual(a, b);
  assert.equal(c.decifrar(a), 'segredo-totp-ÁÉ');
  const partes = a.split(':');
  assert.equal(partes.length, 4);
  assert.equal(partes[0], 'v1');
  assert.equal(Buffer.from(partes[1], 'base64').length, 12);
  assert.equal(Buffer.from(partes[2], 'base64').length, 16);
  assert.ok(!a.includes('segredo'));
});

test('cripto: adulteração, formato errado e chave errada lançam sem expor o conteúdo', () => {
  const c = criarCripto(CHAVE);
  const blob = c.cifrar('conteudo-secreto');
  const p = blob.split(':');
  const cif = Buffer.from(p[3], 'base64');
  cif[0] ^= 1;
  const adulterado = [p[0], p[1], p[2], cif.toString('base64')].join(':');
  assert.throws(() => c.decifrar(adulterado));
  const tag = Buffer.from(p[2], 'base64');
  tag[0] ^= 1;
  assert.throws(() => c.decifrar([p[0], p[1], tag.toString('base64'), p[3]].join(':')));
  for (const ruim of ['', 'lixo', 'v2:a:b:c', 'v1:a:b', 'v1:::']) assert.throws(() => c.decifrar(ruim), ruim);
  const outra = criarCripto(crypto.randomBytes(32).toString('base64'));
  assert.throws(() => outra.decifrar(blob));
  try { outra.decifrar(blob); } catch (e) { assert.ok(!String(e.message).includes('conteudo-secreto')); }
});

test('cripto: chave que não tem 32 bytes lança', () => {
  assert.throws(() => criarCripto(crypto.randomBytes(31).toString('base64')), /32/);
  assert.throws(() => criarCripto(crypto.randomBytes(33).toString('base64')), /32/);
  assert.throws(() => criarCripto(''), /32/);
  assert.throws(() => criarCripto(undefined), /32/);
});

// ---------- tokens ----------
test('tokens: opaco com 32 bytes base64url e hash SHA-256 hex', () => {
  const t = tokens.novoTokenOpaco();
  assert.match(t.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(t.token, 'base64url').length, 32);
  assert.equal(t.hash, crypto.createHash('sha256').update(t.token).digest('hex'));
  assert.equal(tokens.hashToken(t.token), t.hash);
  assert.notEqual(t.token, tokens.novoTokenOpaco().token);
});

test('tokens: códigos de recuperação XXXX-XXXX, únicos, com hashes', () => {
  const { codigos, hashes } = tokens.gerarCodigosRecuperacao();
  assert.equal(codigos.length, 10);
  assert.equal(new Set(codigos).size, 10);
  for (const c of codigos) assert.match(c, /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
  assert.equal(hashes.length, 10);
  codigos.forEach((c, i) => assert.equal(hashes[i], tokens.hashCodigoRecuperacao(c)));
  assert.equal(tokens.gerarCodigosRecuperacao(3).codigos.length, 3);
});

test('tokens: hashCodigoRecuperacao normaliza caixa, hífen e espaço', () => {
  assert.equal(tokens.hashCodigoRecuperacao('abcd efgh'), tokens.hashCodigoRecuperacao('ABCD-EFGH'));
  assert.match(tokens.hashCodigoRecuperacao('ABCD-EFGH'), /^[0-9a-f]{64}$/);
});
