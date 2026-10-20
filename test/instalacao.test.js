const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { instalarTabelas, migrarAcessos } = require('../seguranca/instalacao');

const NOMES = ['Administrador', 'Interno completo', 'Vendedor', 'Estoquista', 'Representante'];

function poolMigracao({ jaFeita = false, perfisExistentes = 0, falharEm = null } = {}) {
  let proximoId = 1;
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'migracao_inicial'/, jaFeita ? [{ id: 1 }] : []],
    [/COUNT\(\*\) AS n FROM web_perfis/, [{ n: perfisExistentes }]],
    [/INSERT INTO web_perfis/, () => ({ insertId: proximoId++ })],
    [/SELECT id, nome FROM web_perfis/, NOMES.map((nome, i) => ({ id: i + 1, nome }))],
    [/FROM cliente_usuarios u/, [
      { CODIGO: 1, NOME: 'Thiago', CARGO: 'Administrador' },
      { CODIGO: 2, NOME: 'Ana', CARGO: 'Representante RJ' },
      { CODIGO: 3, NOME: 'Caio', CARGO: 'Produção' }
    ]],
    [/INSERT INTO web_usuario_acesso/, (sql, params) => {
      if (falharEm && params[0] === falharEm) throw new Error('falha simulada');
      return { affectedRows: 1 };
    }]
  ]);
}

test('cria as 5 tabelas web_', async () => {
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const creates = pool.chamadas.filter(c => /CREATE TABLE IF NOT EXISTS `web_/.test(c.sql)).map(c => c.sql.match(/`(web_\w+)`/)[1]);
  assert.deepEqual(creates.sort(), ['web_auditoria', 'web_perfil_permissoes', 'web_perfis', 'web_usuario_acesso', 'web_usuario_excecoes']);
});

test('mapeia representante, admin e demais', async () => {
  const pool = poolMigracao();
  const r = await migrarAcessos(pool, { adminInicial: 'Thiago' });
  assert.deepEqual(r, { jaFeita: false, criados: 3 });
  const acessos = pool.chamadas.filter(c => /INSERT INTO web_usuario_acesso/.test(c.sql)).map(c => c.params);
  // params: [usuario_codigo, perfil_id, estados]
  assert.deepEqual(acessos.map(p => p.slice(0, 3)), [[1, 1, null], [2, 5, 'RJ'], [3, 2, null]]);
  assert.equal(pool.chamadas.filter(c => /INSERT INTO web_perfis/.test(c.sql)).length, 5);
  assert.ok(pool.chamadas.some(c => /INSERT INTO web_perfil_permissoes/.test(c.sql)));
  assert.ok(pool.chamadas.some(c => /INSERT INTO web_auditoria/.test(c.sql) && c.params.includes('migracao_inicial')));
  assert.deepEqual(pool.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql), ['BEGIN', 'COMMIT']);
});

test('perfis já existentes não são recriados', async () => {
  const pool = poolMigracao({ perfisExistentes: 5 });
  await migrarAcessos(pool, { adminInicial: 'Thiago' });
  assert.equal(pool.chamadas.filter(c => /INSERT INTO web_perfis/.test(c.sql)).length, 0);
});

test('não roda duas vezes', async () => {
  const pool = poolMigracao({ jaFeita: true });
  assert.deepEqual(await migrarAcessos(pool, { adminInicial: 'Thiago' }), { jaFeita: true, criados: 0 });
  assert.ok(!pool.chamadas.some(c => /INSERT/.test(c.sql)));
});

test('erro no meio faz rollback', async () => {
  const pool = poolMigracao({ falharEm: 2 });
  await assert.rejects(migrarAcessos(pool, { adminInicial: 'Thiago' }), /falha simulada/);
  assert.ok(pool.chamadas.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!pool.chamadas.some(c => c.sql === 'COMMIT'));
});
