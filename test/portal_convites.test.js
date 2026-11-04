process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { hashToken } = require('../portal/tokens');
const { VALIDADE_CONVITE_MS, criarConvite, invalidarConvites, responderConviteJson } = require('../portal/convites');
const { carregarPermissoesPortal, PERMISSOES_PORTAL, PERMISSOES_CONCEDIVEIS } = require('../portal/acesso');

const BASE = 'https://portal.exemplo.com';

test('validade do convite é de 48 horas', () => {
  assert.equal(VALIDADE_CONVITE_MS, 48 * 60 * 60 * 1000);
});

test('criarConvite grava só o hash, com validade de 48 h, e devolve o token', async () => {
  const banco = criarBancoPortal();
  const antes = Date.now();
  const token = await criarConvite(banco.pool, 7, 'Thiago');
  const depois = Date.now();
  assert.equal(typeof token, 'string');
  assert.equal(banco.dados.convites.length, 1);
  const c = banco.dados.convites[0];
  assert.equal(c.token_hash, hashToken(token));
  assert.notEqual(c.token_hash, token);
  assert.equal(c.usuario_id, 7);
  assert.equal(c.criado_por, 'Thiago');
  assert.equal(c.usado_em, null);
  assert.ok(c.expira_em.getTime() - c.criado_em.getTime() === VALIDADE_CONVITE_MS);
  assert.ok(c.criado_em.getTime() >= antes && c.criado_em.getTime() <= depois);
  assert.ok(!JSON.stringify(banco.dados.convites).includes(token));
});

test('invalidarConvites marca usado_em só nos convites abertos do usuário', async () => {
  const banco = criarBancoPortal();
  await criarConvite(banco.pool, 7, 'a');
  await criarConvite(banco.pool, 8, 'a');
  await invalidarConvites(banco.pool, 7);
  const [do7, do8] = [7, 8].map(id => banco.dados.convites.find(c => c.usuario_id === id));
  assert.ok(do7.usado_em instanceof Date);
  assert.equal(do8.usado_em, null);
});

test('responderConviteJson: e-mail enviado não devolve o link', async () => {
  const chamadas = [];
  const email = { enviarConvite: async d => { chamadas.push(d); return { enviado: true }; } };
  const r = await responderConviteJson({ config: { baseUrl: BASE }, email }, { token: 'TKN', para: 'a@b.com', razaoSocial: 'ACME' });
  assert.deepEqual(r, { enviado: true });
  assert.deepEqual(chamadas, [{ para: 'a@b.com', link: BASE + '/portal/convite.html#TKN', razaoSocial: 'ACME' }]);
});

for (const [nome, email] of [
  ['envio devolve enviado:false', { enviarConvite: async () => ({ enviado: false }) }],
  ['envio lança erro', { enviarConvite: async () => { throw new Error('smtp'); } }]
]) {
  test(`responderConviteJson: ${nome} devolve o link`, async () => {
    const r = await responderConviteJson({ config: { baseUrl: BASE }, email }, { token: 'TKN', para: 'a@b.com', razaoSocial: 'ACME' });
    assert.deepEqual(r, { enviado: false, link: BASE + '/portal/convite.html#TKN' });
  });
}

test('permissões: constantes do portal', () => {
  assert.deepEqual(PERMISSOES_CONCEDIVEIS, ['pedidos.ver', 'documentos.ver', 'financeiro.ver']);
  assert.deepEqual(PERMISSOES_PORTAL, [...PERMISSOES_CONCEDIVEIS, 'usuarios.gerir']);
});

test('permissões: administrador geral tem as quatro', async () => {
  const banco = criarBancoPortal();
  const ps = await carregarPermissoesPortal(banco.pool, 1, 'admin_geral');
  assert.deepEqual([...ps].sort(), [...PERMISSOES_PORTAL].sort());
  assert.ok(ps.has('usuarios.gerir'));
});

test('permissões: usuário comum nunca recebe usuarios.gerir, mesmo gravada; desconhecida é ignorada', async () => {
  const banco = criarBancoPortal();
  banco.dados.permissoes.push(
    { usuario_id: 2, permissao: 'pedidos.ver' },
    { usuario_id: 2, permissao: 'usuarios.gerir' },
    { usuario_id: 2, permissao: 'codigo.desconhecido' });
  const ps = await carregarPermissoesPortal(banco.pool, 2, 'usuario');
  assert.deepEqual([...ps], ['pedidos.ver']);
});
