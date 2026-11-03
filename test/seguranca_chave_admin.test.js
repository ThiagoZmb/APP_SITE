process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { chaveAdminConfere } = require('../seguranca/chave_admin');
const { app, pool } = require('../index.js');

const req = valor => ({ headers: valor === undefined ? {} : { 'x-admin-key': valor } });
const ENV = { ADMIN_KEY: 'chave-de-teste', ADMIN_ROTAS: '1' };

test('chaveAdminConfere: chave certa com ADMIN_ROTAS=1 confere', () => {
  assert.equal(chaveAdminConfere(req('chave-de-teste'), ENV), true);
});
test('chaveAdminConfere: sem ADMIN_ROTAS (ou diferente de 1) nunca confere', () => {
  assert.equal(chaveAdminConfere(req('chave-de-teste'), { ADMIN_KEY: 'chave-de-teste' }), false);
  assert.equal(chaveAdminConfere(req('chave-de-teste'), { ...ENV, ADMIN_ROTAS: 'true' }), false);
});
test('chaveAdminConfere: tamanho diferente, array, vazia, ausente e ADMIN_KEY indefinida dão false sem lançar', () => {
  assert.equal(chaveAdminConfere(req('curta'), ENV), false);
  assert.equal(chaveAdminConfere(req('chave-de-teste-comprida-demais'), ENV), false);
  assert.equal(chaveAdminConfere(req(['chave-de-teste', 'chave-de-teste']), ENV), false);
  assert.equal(chaveAdminConfere(req(['a', 'b']), ENV), false);
  assert.equal(chaveAdminConfere(req(''), ENV), false);
  assert.equal(chaveAdminConfere(req(undefined), ENV), false);
  assert.equal(chaveAdminConfere(req('qualquer'), { ADMIN_ROTAS: '1' }), false);
});

test('/migrar_senhas ignora SENHA nula ou vazia e converte texto puro', async t => {
  process.env.ADMIN_KEY = 'chave-de-teste'; process.env.ADMIN_ROTAS = '1';
  const f = criarPoolFalso([[/SELECT CODIGO, SENHA FROM cliente_usuarios/, [
    { CODIGO: 1, SENHA: null }, { CODIGO: 2, SENHA: '' }, { CODIGO: 3, SENHA: 'abc12345' }]]]);
  pool.execute = f.execute;
  const s = await subir(app); t.after(s.fechar);
  const r = await fetch(s.url + '/migrar_senhas', { method: 'POST', headers: { 'x-admin-key': 'chave-de-teste' } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ignorados, 2);
  assert.equal(d.convertidos, 1);
  const updates = f.chamadas.filter(c => /^UPDATE cliente_usuarios/.test(c.sql));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].params[1], 3);
  assert.match(updates[0].params[0], /^\$2/);
});

// Por último: o limitador é um só para as rotas de manutenção e este teste o esgota.
test('/admin/definir_senha: 6ª tentativa com chave errada recebe 429', async t => {
  process.env.ADMIN_KEY = 'chave-de-teste'; process.env.ADMIN_ROTAS = '1';
  const s = await subir(app); t.after(s.fechar);
  const chamar = () => fetch(s.url + '/admin/definir_senha', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': 'errada' }, body: '{}' });
  for (let i = 0; i < 5; i++) assert.equal((await chamar()).status, 403);
  const r = await chamar();
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { error: 'Muitas tentativas. Aguarde 15 minutos.' });
});
