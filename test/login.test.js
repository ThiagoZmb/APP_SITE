process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso } = require('../index.js');

const HASH = bcrypt.hashSync('segredo123', 4);
const usarPool = regras => { const f = criarPoolFalso(regras); pool.execute = f.execute; pool.getConnection = f.getConnection; return f; };
const acessoDe = (extra = {}) => ({ codigo: 7, nome: 'Caio', cargo: 'Produção', empresa: 'ELEGANCE', perfil: { id: 4, nome: 'Estoquista' },
  estados: [], ativo: true, permissoes: new Set(['estoque.ver']), ...extra });
const tokenV2 = (id = 7) => jwt.sign({ id, nome: 'Caio', v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function servidor(t) { const s = await subir(app); t.after(s.fechar); acesso.limpar(); return s; }
const postLogin = (s, body) => fetch(s.url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('login de INATIVO na web recebe 403 com a mensagem da spec', async t => {
  const s = await servidor(t);
  usarPool([[/FROM cliente_usuarios WHERE NOME/, [{ CODIGO: 7, NOME: 'Caio', RAZAO_SOCIAL: 'ELEGANCE', CARGO: 'Produção', SENHA: HASH }]]]);
  t.mock.method(acesso, 'carregar', async () => acessoDe({ ativo: false, permissoes: new Set() }));
  const r = await postLogin(s, { username: 'Caio', password: 'segredo123' });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { success: false, message: 'Acesso à web não liberado. Fale com o administrador.' });
});

test('login ok devolve acesso.permissoes como array e token com v:2', async t => {
  const s = await servidor(t);
  usarPool([[/FROM cliente_usuarios WHERE NOME/, [{ CODIGO: 7, NOME: 'Caio', RAZAO_SOCIAL: 'ELEGANCE', CARGO: 'Produção', SENHA: HASH }]]]);
  t.mock.method(acesso, 'carregar', async () => acessoDe());
  const r = await postLogin(s, { username: 'Caio', password: 'segredo123' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.success, true);
  assert.deepEqual(d.user, { nome: 'Caio', empresa: 'ELEGANCE', cargo: 'Produção' });
  assert.deepEqual(d.acesso, { perfil: { id: 4, nome: 'Estoquista' }, permissoes: ['estoque.ver'], estados: [] });
  const claims = jwt.decode(d.token);
  assert.equal(claims.v, 2);
  assert.equal(claims.id, 7);
  assert.equal(claims.cargo, undefined);
});

test('senha errada continua 401', async t => {
  const s = await servidor(t);
  usarPool([[/FROM cliente_usuarios WHERE NOME/, [{ CODIGO: 7, NOME: 'Caio', SENHA: HASH }]]]);
  const r = await postLogin(s, { username: 'Caio', password: 'errada' });
  assert.equal(r.status, 401);
});

test('token antigo sem v recebe 401 Sessão expirada', async t => {
  const s = await servidor(t);
  const antigo = jwt.sign({ id: 7, nome: 'Caio', cargo: 'Produção' }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
  const r = await fetch(s.url + '/auth/verify', { headers: { Authorization: 'Bearer ' + antigo } });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'Sessão expirada. Faça login novamente.' });
});

test('usuário desativado com token válido recebe 401 Sessão encerrada', async t => {
  const s = await servidor(t);
  t.mock.method(acesso, 'carregar', async () => acessoDe({ ativo: false, permissoes: new Set() }));
  const r = await fetch(s.url + '/auth/verify', { headers: { Authorization: 'Bearer ' + tokenV2() } });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'Sessão encerrada. Faça login novamente.' });
});

test('/auth/verify devolve permissões atuais', async t => {
  const s = await servidor(t);
  t.mock.method(acesso, 'carregar', async () => acessoDe({ permissoes: new Set(['estoque.ver', 'valores.ver']) }));
  const r = await fetch(s.url + '/auth/verify', { headers: { Authorization: 'Bearer ' + tokenV2() } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { valid: true, user: { nome: 'Caio', cargo: 'Produção' },
    acesso: { perfil: { id: 4, nome: 'Estoquista' }, permissoes: ['estoque.ver', 'valores.ver'], estados: [] } });
});
