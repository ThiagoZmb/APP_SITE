// Tabelas, permissões e migração do DANFE.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOGO, PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { instalarTabelas, acrescentarPermissoesDanfe } = require('../seguranca/instalacao');
const { criarPoolFalso } = require('./apoio/poolFalso');

test('danfe: permissões no catálogo; ver para Interno completo, enviar e vincular só para o Administrador', () => {
  for (const c of ['danfe.ver', 'danfe.enviar', 'danfe.vincular']) assert.equal(CATALOGO.find(p => p.codigo === c)?.area, 'Cadastros', c);
  const interno = PERFIS_INICIAIS.find(p => p.nome === 'Interno completo').permissoes;
  const admin = PERFIS_INICIAIS.find(p => p.nome === 'Administrador').permissoes;
  assert.ok(interno.includes('danfe.ver') && !interno.includes('danfe.enviar') && !interno.includes('danfe.vincular'));
  for (const c of ['danfe.ver', 'danfe.enviar', 'danfe.vincular']) assert.ok(admin.includes(c), c);
  for (const nome of ['Vendedor', 'Estoquista', 'Representante']) assert.ok(!PERFIS_INICIAIS.find(p => p.nome === nome).permissoes.some(c => c.startsWith('danfe.')), nome);
});

test('danfe: migração dá ver aos dois perfis, enviar e vincular só ao Administrador, e roda uma vez só', async () => {
  let feito = false;
  const pool = criarPoolFalso([
    [/SELECT id FROM web_auditoria WHERE acao = 'permissoes_danfe'/, () => feito ? [{ id: 1 }] : []],
    [/SELECT id, nome FROM web_perfis/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT INTO web_auditoria/, () => { feito = true; return { affectedRows: 1 }; }]
  ]);
  assert.deepEqual(await acrescentarPermissoesDanfe(pool), { feito: true });
  const inseridas = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params.join(':'));
  assert.deepEqual(inseridas.sort(), ['1:danfe.enviar', '1:danfe.ver', '1:danfe.vincular', '2:danfe.ver']);
  const antes = pool.chamadas.length;
  assert.deepEqual(await acrescentarPermissoesDanfe(pool), { feito: false });
  assert.equal(pool.chamadas.slice(antes).filter(c => /INSERT/.test(c.sql)).length, 0);
});

test('danfe: instalarTabelas cria web_danfe (chave única, MEDIUMBLOB) e web_danfe_vinculos (único chave+pedido), sem FK', async () => {
  const pool = criarPoolFalso();
  await instalarTabelas(pool);
  const ddl = n => pool.chamadas.map(c => c.sql).find(s => s.includes('`' + n + '`'));
  const d = ddl('web_danfe');
  assert.ok(d, 'DDL web_danfe ausente');
  for (const trecho of ['chave CHAR(44)', 'ux_danfe_chave', 'numero_nf INT', 'serie INT', 'modelo CHAR(2)', 'cnpj_emitente CHAR(14)', 'data_emissao_aamm CHAR(4)', 'pdf MEDIUMBLOB', 'tamanho INT', 'sha256 CHAR(64)', 'enviado_por', 'enviado_em', 'utf8mb4']) assert.ok(d.includes(trecho), trecho);
  const v = ddl('web_danfe_vinculos');
  assert.ok(v, 'DDL web_danfe_vinculos ausente');
  for (const trecho of ['chave CHAR(44)', 'pedido_numero INT', 'criado_por', 'criado_em', 'UNIQUE KEY ux_danfe_vinculo (chave, pedido_numero)', 'ix_danfe_vinculo_pedido']) assert.ok(v.includes(trecho), trecho);
  assert.ok(!/FOREIGN KEY|REFERENCES/i.test(d + v));
  assert.ok(/CREATE TABLE IF NOT EXISTS/.test(d) && /CREATE TABLE IF NOT EXISTS/.test(v), 'idempotente');
});
