process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool } = require('../index.js');

// Dois usuários com o mesmo NOME (o UPDATE troca a senha dos dois) e um terceiro que não pode ser tocado.
test('/admin/definir_senha revoga as sessões de TODOS os usuários com o nome, e só deles', async t => {
  process.env.ADMIN_KEY = 'chave-de-teste'; process.env.ADMIN_ROTAS = '1';
  const f = criarPoolFalso([
    [/^UPDATE cliente_usuarios SET SENHA/, { affectedRows: 2 }],
    [/SELECT CODIGO FROM cliente_usuarios WHERE NOME/, (sql, p) => p[0] === 'Caio' ? [{ CODIGO: 11 }, { CODIGO: 12 }] : []],
    [/^UPDATE web_sessoes SET revogada = 1/, { affectedRows: 1 }]
  ]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  const s = await subir(app); t.after(s.fechar);
  const r = await fetch(s.url + '/admin/definir_senha', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': 'chave-de-teste' },
    body: JSON.stringify({ username: 'Caio', novaSenha: 'novasenha123' }) });
  assert.equal(r.status, 200);
  const revogados = f.chamadas.filter(c => /UPDATE web_sessoes SET revogada = 1/.test(c.sql)).map(c => c.params[0]).sort();
  assert.deepEqual(revogados, [11, 12]);
  assert.ok(!revogados.includes(13));
  assert.ok(!f.chamadas.some(c => /SELECT CODIGO FROM cliente_usuarios WHERE NOME/.test(c.sql) && /LIMIT/i.test(c.sql)));
});
