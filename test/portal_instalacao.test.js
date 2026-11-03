process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { instalarTabelas, acrescentarPermissoesPortal } = require('../seguranca/instalacao');
const { CATALOGO, PERFIS_INICIAIS } = require('../seguranca/permissoes');

const TABELAS = ['web_portal_auditoria', 'web_portal_convites', 'web_portal_empresas', 'web_portal_permissoes', 'web_portal_recuperacao', 'web_portal_sessoes', 'web_portal_usuarios'];

async function ddl() {
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const por = nome => pool.chamadas.find(c => new RegExp('`' + nome + '`').test(c.sql))?.sql;
  return { pool, por };
}

test('as 7 tabelas do portal são criadas, sem chave estrangeira', async () => {
  const { pool, por } = await ddl();
  const criadas = pool.chamadas.filter(c => /CREATE TABLE IF NOT EXISTS `web_portal_/.test(c.sql)).map(c => c.sql.match(/`(web_portal_\w+)`/)[1]);
  assert.deepEqual(criadas.sort(), TABELAS);
  for (const t of TABELAS) assert.doesNotMatch(por(t), /FOREIGN KEY|REFERENCES/, t);
});

test('empresas e usuários: colunas, e-mail utf8mb4_bin único, índice por empresa', async () => {
  const { por } = await ddl();
  const e = por('web_portal_empresas');
  assert.match(e, /cliente_codigo INT NOT NULL PRIMARY KEY/);
  assert.match(e, /situacao ENUM\('ativa','suspensa'\) NOT NULL DEFAULT 'ativa'/);
  assert.match(e, /liberado_por VARCHAR\(100\) NOT NULL/);
  assert.match(e, /suspenso_em DATETIME NULL/);
  const u = por('web_portal_usuarios');
  assert.match(u, /email VARCHAR\(190\) COLLATE utf8mb4_bin NOT NULL/);
  assert.match(u, /UNIQUE KEY \w+ \(email\)/);
  assert.match(u, /papel ENUM\('admin_geral','usuario'\) NOT NULL/);
  assert.match(u, /situacao ENUM\('convidado','ativo','inativo'\) NOT NULL DEFAULT 'convidado'/);
  assert.match(u, /senha_hash VARCHAR\(100\) NULL/);
  assert.match(u, /totp_segredo_cifrado VARCHAR\(400\) NULL/);
  assert.match(u, /totp_ativo TINYINT NOT NULL DEFAULT 0/);
  assert.match(u, /totp_ultimo_passo BIGINT NOT NULL DEFAULT 0/);
  assert.match(u, /termo_versao VARCHAR\(30\) NULL/);
  assert.match(u, /KEY idx_portal_usuario_empresa \(cliente_codigo\)/);
});

test('permissões, convites, recuperação, sessões e auditoria', async () => {
  const { por } = await ddl();
  assert.match(por('web_portal_permissoes'), /PRIMARY KEY \(usuario_id, permissao\)/);
  assert.match(por('web_portal_permissoes'), /permissao VARCHAR\(60\) NOT NULL/);
  const c = por('web_portal_convites');
  assert.match(c, /token_hash CHAR\(64\) NOT NULL/);
  assert.match(c, /UNIQUE KEY \w+ \(token_hash\)/);
  assert.match(c, /KEY idx_portal_convite_usuario \(usuario_id\)/);
  const r = por('web_portal_recuperacao');
  assert.match(r, /codigo_hash CHAR\(64\) NOT NULL/);
  assert.match(r, /PRIMARY KEY \(usuario_id, codigo_hash\)/);
  const s = por('web_portal_sessoes');
  assert.match(s, /id CHAR\(64\) NOT NULL PRIMARY KEY/);
  assert.match(s, /ip VARCHAR\(45\) NULL/);
  assert.match(s, /revogada TINYINT NOT NULL DEFAULT 0/);
  assert.match(s, /KEY idx_portal_sessao_usuario \(usuario_id\)/);
  const a = por('web_portal_auditoria');
  assert.match(a, /evento VARCHAR\(40\) NOT NULL/);
  assert.match(a, /detalhe TEXT NULL/);
  assert.match(a, /KEY idx_portal_audit_evento \(evento\)/);
  assert.match(a, /KEY idx_portal_audit_quando \(quando\)/);
});

test('portal.gerir está no catálogo (Administração), no Administrador e fora dos demais perfis', () => {
  const p = CATALOGO.find(x => x.codigo === 'portal.gerir');
  assert.ok(p);
  assert.equal(p.area, 'Administração');
  assert.match(p.nome, /portal do cliente/);
  for (const perfil of PERFIS_INICIAIS) {
    assert.equal(perfil.permissoes.includes('portal.gerir'), perfil.nome === 'Administrador', perfil.nome);
  }
});

function poolPortal({ jaFeito = false } = {}) {
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_portal'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
}

test('acrescentarPermissoesPortal: só o Administrador, uma vez', async () => {
  const pool = poolPortal();
  assert.deepEqual(await acrescentarPermissoesPortal(pool), { feito: true });
  assert.deepEqual(pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params), [[1, 'portal.gerir']]);
  assert.ok(pool.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql)).params.includes('permissoes_portal'));
  assert.ok(!pool.chamadas.some(c => /Interno completo/.test(c.sql)));
  const ja = poolPortal({ jaFeito: true });
  assert.deepEqual(await acrescentarPermissoesPortal(ja), { feito: false });
  assert.ok(!ja.chamadas.some(c => /INSERT/.test(c.sql)));
});
