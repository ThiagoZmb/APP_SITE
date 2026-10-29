// Tabela web_pesos e permissões pesos.* (instalação).
const test = require('node:test');
const assert = require('node:assert/strict');
const { instalarTabelas, acrescentarPermissoesPesos } = require('../seguranca/instalacao');
const { CODIGOS, PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { criarPoolFalso } = require('./apoio/poolFalso');

test('pesos: instalarTabelas cria web_pesos (único por tipo+produto, sem FK)', async () => {
  const pool = criarPoolFalso();
  await instalarTabelas(pool);
  const ddl = pool.chamadas.map(c => c.sql).find(s => /CREATE TABLE IF NOT EXISTS/.test(s) && s.includes('`web_pesos`'));
  assert.ok(ddl, 'DDL ausente');
  for (const c of ["tipo ENUM('perfil','puxador','vidro','acessorio') NOT NULL", 'produto VARCHAR(190) NOT NULL', "unidade_peso ENUM('kg_m','kg_m2_mm','kg_un') NOT NULL",
    'valor DECIMAL(12,4) NOT NULL', 'atualizado_por VARCHAR(100) NULL', 'atualizado_em DATETIME NULL', 'UNIQUE KEY ux_peso_produto (tipo, produto)']) assert.ok(ddl.includes(c), c);
  assert.ok(!/FOREIGN KEY|REFERENCES/i.test(ddl));
  for (const s of pool.chamadas.map(c => c.sql).filter(s => /^\s*(ALTER|DROP)\b/i.test(s))) assert.match(s, /(ALTER|DROP)\s+TABLE\s+(IF EXISTS\s+)?`?web_/i, s);
});

test('pesos: permissões existem no catálogo e a migração dá ver+editar a Administrador e Interno completo, uma vez só', async () => {
  assert.ok(CODIGOS.has('pesos.ver') && CODIGOS.has('pesos.editar'));
  for (const nome of ['Administrador', 'Interno completo']) assert.ok(PERFIS_INICIAIS.find(p => p.nome === nome).permissoes.includes('pesos.editar'), nome);
  let feito = false;
  const pool = criarPoolFalso([
    [/SELECT id FROM web_auditoria WHERE acao = 'permissoes_pesos'/, () => feito ? [{ id: 1 }] : []],
    [/SELECT id, nome FROM web_perfis/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT INTO web_auditoria/, () => { feito = true; return { affectedRows: 1 }; }]
  ]);
  assert.deepEqual(await acrescentarPermissoesPesos(pool), { feito: true });
  const inseridas = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params.join(':'));
  assert.deepEqual(inseridas.sort(), ['1:pesos.editar', '1:pesos.ver', '2:pesos.editar', '2:pesos.ver']);
  const antes = pool.chamadas.length;
  assert.deepEqual(await acrescentarPermissoesPesos(pool), { feito: false });
  assert.equal(pool.chamadas.slice(antes).filter(c => /INSERT/.test(c.sql)).length, 0);
});
