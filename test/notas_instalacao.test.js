// Tabela, permissões e migração das notas fiscais.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOGO, PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { instalarTabelas, acrescentarPermissoesNotas } = require('../seguranca/instalacao');
const { criarPoolFalso } = require('./apoio/poolFalso');

test('notas: permissões no catálogo e no Interno completo', () => {
  for (const c of ['notas.ver', 'notas.editar']) assert.equal(CATALOGO.find(p => p.codigo === c)?.area, 'Cadastros', c);
  const interno = PERFIS_INICIAIS.find(p => p.nome === 'Interno completo');
  assert.ok(interno.permissoes.includes('notas.ver') && interno.permissoes.includes('notas.editar'));
});

test('notas: migração dá ver/editar aos perfis e roda uma vez só', async () => {
  let feito = false;
  const pool = criarPoolFalso([
    [/SELECT id FROM web_auditoria WHERE acao = 'permissoes_notas'/, () => feito ? [{ id: 1 }] : []],
    [/SELECT id, nome FROM web_perfis/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT INTO web_auditoria/, () => { feito = true; return { affectedRows: 1 }; }]
  ]);
  assert.deepEqual(await acrescentarPermissoesNotas(pool), { feito: true });
  const inseridas = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params.join(':'));
  assert.deepEqual(inseridas.sort(), ['1:notas.editar', '1:notas.ver', '2:notas.editar', '2:notas.ver']);
  const antes = pool.chamadas.length;
  assert.deepEqual(await acrescentarPermissoesNotas(pool), { feito: false });
  assert.equal(pool.chamadas.slice(antes).filter(c => /INSERT/.test(c.sql)).length, 0);
});

test('notas: instalarTabelas cria web_notas_fiscais com os índices únicos', async () => {
  const pool = criarPoolFalso();
  await instalarTabelas(pool);
  const ddl = pool.chamadas.map(c => c.sql).find(s => s.includes('`web_notas_fiscais`'));
  assert.ok(ddl, 'DDL ausente');
  assert.ok(ddl.includes('ux_nota_numero') && ddl.includes('ux_nota_chave') && ddl.includes('DECIMAL(14,2)'));
});

test('notas: instalarTabelas acrescenta chave_original em tabela criada antes dela e não repete', async () => {
  const sem = criarPoolFalso([[/information_schema\.COLUMNS.*web_notas_fiscais.*chave_original/, [{ n: 0 }]]]);
  await instalarTabelas(sem);
  assert.ok(sem.chamadas.some(c => /ALTER TABLE web_notas_fiscais ADD COLUMN chave_original/.test(c.sql)));
  const com = criarPoolFalso([[/information_schema\.COLUMNS.*web_notas_fiscais.*chave_original/, [{ n: 1 }]]]);
  await instalarTabelas(com);
  assert.ok(!com.chamadas.some(c => /ALTER TABLE web_notas_fiscais/.test(c.sql)));
});
