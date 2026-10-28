// Tabelas do plano de corte de vidros (web_vidro_*).
const test = require('node:test');
const assert = require('node:assert/strict');
const { instalarTabelas } = require('../seguranca/instalacao');
const { criarPoolFalso } = require('./apoio/poolFalso');

const TABELAS = ['web_vidro_config', 'web_vidro_retalhos', 'web_vidro_planos'];

test('corte de vidros: instalarTabelas cria as três tabelas web_vidro_*', async () => {
  const pool = criarPoolFalso();
  await instalarTabelas(pool);
  for (const t of TABELAS) {
    const ddl = pool.chamadas.map(c => c.sql).find(s => /CREATE TABLE IF NOT EXISTS/.test(s) && s.includes('`' + t + '`'));
    assert.ok(ddl, 'DDL ausente: ' + t);
  }
});

test('corte de vidros: colunas e índices combinados com as rotas', async () => {
  const pool = criarPoolFalso();
  await instalarTabelas(pool);
  const ddl = n => pool.chamadas.map(c => c.sql).find(s => s.includes('`' + n + '`'));
  const cfg = ddl('web_vidro_config');
  assert.ok(/id INT NOT NULL PRIMARY KEY/.test(cfg) && !/AUTO_INCREMENT/.test(cfg), 'config: id fixo, sem auto incremento');
  for (const c of ['serra INT NULL', 'sobra_minima INT NULL', 'atualizado_por VARCHAR(100)']) assert.ok(cfg.includes(c), c);
  const ret = ddl('web_vidro_retalhos');
  for (const c of ['produto_codigo INT NOT NULL', 'produto_nome VARCHAR(190) NOT NULL', 'altura INT NOT NULL', 'largura INT NOT NULL',
    "ENUM('disponivel','reservado','usado','descartado')", 'plano_origem INT NULL', 'plano_reserva INT NULL', 'KEY ix_vretalho (situacao, produto_codigo)']) {
    assert.ok(ret.includes(c), c);
  }
  const pl = ddl('web_vidro_planos');
  for (const c of ['pedido INT NOT NULL', "ENUM('gerado','conferido','cancelado')", 'impressao_pecas CHAR(64) NOT NULL', 'resultado LONGTEXT NOT NULL',
    'progresso LONGTEXT', 'excluido_em DATETIME NULL', 'KEY ix_vplano_pedido (pedido, situacao)']) {
    assert.ok(pl.includes(c), c);
  }
});

test('corte de vidros: nada de ALTER/DROP nem FOREIGN KEY em tabela fora de web_*', async () => {
  const pool = criarPoolFalso();
  await instalarTabelas(pool);
  const sqls = pool.chamadas.map(c => c.sql);
  const vidro = sqls.filter(s => /web_vidro_/.test(s));
  assert.ok(vidro.length >= 3);
  assert.ok(!vidro.some(s => /FOREIGN KEY|REFERENCES/i.test(s)));
  for (const s of sqls.filter(s => /^\s*(ALTER|DROP)\b/i.test(s))) {
    assert.match(s, /(ALTER|DROP)\s+TABLE\s+(IF EXISTS\s+)?`?web_/i, s);
  }
});
