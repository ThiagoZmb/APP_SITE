const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { instalarTabelas, migrarAcessos, acrescentarPermissoesEstoque, acrescentarPermissoesPedOrc, acrescentarPermissoesPrecos, acrescentarPermissoesPrecosGravar, acrescentarPermissoesEntregas } = require('../seguranca/instalacao');

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

test('cria as 26 tabelas web_', async () => {
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const creates = pool.chamadas.filter(c => /CREATE TABLE IF NOT EXISTS `web_/.test(c.sql)).map(c => c.sql.match(/`(web_\w+)`/)[1]);
  assert.deepEqual(creates.sort(), ['web_auditoria', 'web_corte_config', 'web_corte_planos', 'web_custo_componentes', 'web_custo_ligacoes', 'web_custo_material', 'web_custo_parametros', 'web_entrega_anexos', 'web_entrega_eventos', 'web_entregas', 'web_estoque_ajustes', 'web_estoque_estornos', 'web_estoque_lancamentos', 'web_estoque_ligacoes', 'web_estoque_reposicao', 'web_gestao_metas', 'web_gestao_orcamento', 'web_item_desenhos',
    'web_perfil_permissoes', 'web_perfis', 'web_preco_encargos', 'web_preco_historico', 'web_preco_margens', 'web_retalhos', 'web_usuario_acesso', 'web_usuario_excecoes']);
  const lig = pool.chamadas.find(c => /`web_estoque_ligacoes`/.test(c.sql)).sql;
  assert.match(lig, /UNIQUE KEY[^(]*\(fornecedor, cod_fabricante\)/);
  assert.match(pool.chamadas.find(c => /`web_estoque_lancamentos`/.test(c.sql)).sql, /chave VARCHAR\(64\) NOT NULL PRIMARY KEY/);
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

// ----- permissões novas do estoque (passo único) -----
function poolPermissoes({ jaFeito = false, perfis = [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }] } = {}) {
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_estoque'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id, nome FROM web_perfis WHERE nome IN/, perfis],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
}

test('acrescenta desfazer e ajustar a Administrador e Interno completo, uma vez', async () => {
  const pool = poolPermissoes();
  assert.deepEqual(await acrescentarPermissoesEstoque(pool), { feito: true });
  const ins = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params);
  assert.deepEqual(ins, [[1, 'estoque.desfazer'], [1, 'estoque.ajustar'], [2, 'estoque.desfazer'], [2, 'estoque.ajustar']]);
  const aud = pool.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql));
  assert.ok(aud.params.includes('permissoes_estoque'));
  assert.deepEqual(JSON.parse(aud.params.find(p => String(p).startsWith('{'))), { perfis: [1, 2] });
  const seq = pool.chamadas.map(c => c.sql);
  assert.ok(seq.indexOf('BEGIN') >= 0 && seq.indexOf('COMMIT') > seq.indexOf('BEGIN'));
});

test('permissões do estoque já acrescentadas: não faz nada', async () => {
  const pool = poolPermissoes({ jaFeito: true });
  assert.deepEqual(await acrescentarPermissoesEstoque(pool), { feito: false });
  assert.ok(!pool.chamadas.some(c => /INSERT/.test(c.sql)));
});

test('perfil ausente não quebra', async () => {
  const pool = poolPermissoes({ perfis: [{ id: 1, nome: 'Administrador' }] });
  assert.deepEqual(await acrescentarPermissoesEstoque(pool), { feito: true });
  assert.equal(pool.chamadas.filter(c => /INSERT IGNORE/.test(c.sql)).length, 2);
});

// ----- permissões de salvar orçamento/pedido (passo único) -----
function poolPedOrc({ jaFeito = false } = {}) {
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_ped_orc'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT DISTINCT perfil_id FROM web_perfil_permissoes WHERE permissao = 'orcamentos.criar'/, [{ perfil_id: 1 }, { perfil_id: 2 }, { perfil_id: 5 }]],
    [/SELECT id FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
}

test('salvar orçamento vai para quem monta orçamento; pedido só para o Administrador', async () => {
  const pool = poolPedOrc();
  assert.deepEqual(await acrescentarPermissoesPedOrc(pool), { feito: true });
  const ins = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params);
  assert.deepEqual(ins, [[1, 'orcamentos.salvar'], [2, 'orcamentos.salvar'], [5, 'orcamentos.salvar'], [1, 'pedidos.criar']]);
  assert.ok(pool.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql)).params.includes('permissoes_ped_orc'));
  const seq = pool.chamadas.map(c => c.sql);
  assert.ok(seq.indexOf('BEGIN') >= 0 && seq.indexOf('COMMIT') > seq.indexOf('BEGIN'));
});

test('permissões de orçamento/pedido já acrescentadas: não faz nada', async () => {
  const pool = poolPedOrc({ jaFeito: true });
  assert.deepEqual(await acrescentarPermissoesPedOrc(pool), { feito: false });
  assert.ok(!pool.chamadas.some(c => /INSERT/.test(c.sql)));
});

test('preços: ver e editar vão só para o Administrador, uma vez', async () => {
  const pool = criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_precos'/, []],
    [/SELECT id FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
  assert.deepEqual(await acrescentarPermissoesPrecos(pool), { feito: true });
  assert.deepEqual(pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params), [[1, 'precos.ver'], [1, 'precos.editar']]);
  const ja = criarPoolFalso([[/FROM web_auditoria WHERE acao = 'permissoes_precos'/, [{ id: 3 }]]]);
  assert.deepEqual(await acrescentarPermissoesPrecos(ja), { feito: false });
});

test('preços: gravar vai só para o Administrador, uma vez', async () => {
  const pool = criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_precos_gravar'/, []],
    [/SELECT id FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
  assert.deepEqual(await acrescentarPermissoesPrecosGravar(pool), { feito: true });
  assert.deepEqual(pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params), [[1, 'precos.gravar']]);
  assert.ok(pool.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql)).params.includes('permissoes_precos_gravar'));
  const ja = criarPoolFalso([[/FROM web_auditoria WHERE acao = 'permissoes_precos_gravar'/, [{ id: 3 }]]]);
  assert.deepEqual(await acrescentarPermissoesPrecosGravar(ja), { feito: false });
});

test('tabelas de preço: histórico guarda valor anterior anulável e índice por material', async () => {
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const hist = pool.chamadas.find(c => /`web_preco_historico`/.test(c.sql)).sql;
  assert.match(hist, /valor_anterior DOUBLE NULL/);
  assert.match(hist, /KEY idx_material \(material_codigo, id\)/);
  assert.match(pool.chamadas.find(c => /`web_preco_margens`/.test(c.sql)).sql, /UNIQUE KEY uk_escopo_chave \(escopo, chave\)/);
});

test('composição: coluna componente_id no CREATE e ALTER só quando falta', async () => {
  const sem = criarPoolFalso([[/information_schema\.COLUMNS/, [{ n: 0 }]]]);
  await instalarTabelas(sem);
  assert.match(sem.chamadas.find(c => /`web_custo_ligacoes`/.test(c.sql)).sql, /componente_id INT NULL/);
  assert.ok(sem.chamadas.some(c => c.sql === 'ALTER TABLE web_custo_ligacoes ADD COLUMN componente_id INT NULL'));
  const com = criarPoolFalso([[/information_schema\.COLUMNS/, [{ n: 1 }]]]);
  await instalarTabelas(com);
  assert.ok(!com.chamadas.some(c => /^ALTER/.test(c.sql)));
  assert.match(com.chamadas.find(c => /`web_custo_componentes`/.test(c.sql)).sql, /quantidade DECIMAL\(14,4\) NULL/);
});

test('composição por quantidade: acrescenta a coluna e converte a participação % já gravada (100% → 1)', async () => {
  const sem = criarPoolFalso([[/COLUMN_NAME = 'componente_id'/, [{ n: 1 }]], [/COLUMN_NAME = 'quantidade'/, [{ n: 0 }]]]);
  await instalarTabelas(sem);
  const sqls = sem.chamadas.map(c => c.sql);
  assert.ok(sqls.includes('ALTER TABLE web_custo_componentes ADD COLUMN quantidade DECIMAL(14,4) NULL'));
  assert.ok(sqls.includes('UPDATE web_custo_componentes SET quantidade = participacao_pct / 100 WHERE quantidade IS NULL'));
  const com = criarPoolFalso([[/information_schema\.COLUMNS/, [{ n: 1 }]]]);
  await instalarTabelas(com);
  assert.ok(!com.chamadas.some(c => /^ALTER|^UPDATE/.test(c.sql)));
});

test('custo informado: colunas no CREATE e ALTER só quando faltam', async () => {
  const sem = criarPoolFalso([[/COLUMN_NAME = 'custo_informado'/, [{ n: 0 }]], [/information_schema\.COLUMNS/, [{ n: 1 }]]]);
  await instalarTabelas(sem);
  assert.ok(sem.chamadas.some(c => c.sql === 'ALTER TABLE web_custo_componentes ADD COLUMN custo_informado DECIMAL(14,4) NULL, ADD COLUMN informado_em DATETIME NULL, ADD COLUMN informado_por VARCHAR(190) NULL'));
  const com = criarPoolFalso([[/information_schema\.COLUMNS/, [{ n: 1 }]]]);
  await instalarTabelas(com);
  assert.match(com.chamadas.find(c => /`web_custo_componentes`/.test(c.sql)).sql, /custo_informado DECIMAL\(14,4\) NULL/);
  assert.ok(!com.chamadas.some(c => /^ALTER/.test(c.sql)));
});

test('quantidade por item: coluna nas ligações e passagem da qtd do componente para os itens (uma vez)', async () => {
  const sem = criarPoolFalso([[/COLUMN_NAME = 'componente_id'/, [{ n: 1 }]], [/COLUMN_NAME = 'quantidade' AND TABLE_NAME|TABLE_NAME = 'web_custo_ligacoes' AND COLUMN_NAME = 'quantidade'/, [{ n: 0 }]],
    [/information_schema\.COLUMNS/, [{ n: 1 }]]]);
  await instalarTabelas(sem);
  const sqls = sem.chamadas.map(c => c.sql);
  assert.ok(sqls.includes('ALTER TABLE web_custo_ligacoes ADD COLUMN quantidade DECIMAL(14,4) NULL'));
  assert.ok(sqls.includes('UPDATE web_custo_ligacoes l JOIN web_custo_componentes c ON c.id = l.componente_id SET l.quantidade = c.quantidade WHERE c.quantidade IS NOT NULL AND c.quantidade <> 1'));
  assert.ok(sqls.includes('UPDATE web_custo_componentes SET quantidade = 1 WHERE quantidade IS NOT NULL AND quantidade <> 1'));
  const com = criarPoolFalso([[/information_schema\.COLUMNS/, [{ n: 1 }]]]);
  await instalarTabelas(com);
  assert.ok(!com.chamadas.some(c => /^ALTER|^UPDATE/.test(c.sql)));
  assert.match(com.chamadas.find(c => /`web_custo_ligacoes`/.test(c.sql)).sql, /quantidade DECIMAL\(14,4\) NULL/);
});

test('tabelas de entregas: número único, índice dos eventos, anexo em MEDIUMBLOB, sem nome de coluna de dinheiro', async () => {
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const sql = n => pool.chamadas.find(c => new RegExp('`' + n + '`').test(c.sql)).sql;
  assert.match(sql('web_entregas'), /numero INT NOT NULL/);
  assert.match(sql('web_entregas'), /UNIQUE KEY uk_numero \(numero\)/);
  assert.match(sql('web_entregas'), /status VARCHAR\(20\) NOT NULL/);
  assert.match(sql('web_entrega_eventos'), /KEY idx_entrega \(entrega_id, id\)/);
  assert.match(sql('web_entrega_eventos'), /entregue_a VARCHAR\(190\) NULL/);
  assert.match(sql('web_entrega_anexos'), /dados MEDIUMBLOB/);
  assert.match(sql('web_entrega_anexos'), /evento_id INT NULL/);
  const { REGEX_VALOR } = require('../seguranca/valores');
  for (const n of ['web_entregas', 'web_entrega_eventos', 'web_entrega_anexos']) {
    const colunas = [...sql(n).matchAll(/^\s+([a-z_]+) (?:INT|VARCHAR|DATE|DATETIME|JSON|MEDIUMBLOB|CHAR|TEXT)/gm)].map(m => m[1]);
    assert.ok(colunas.length >= 5, n);
    for (const col of colunas) assert.ok(!REGEX_VALOR.test(col), n + '.' + col);
  }
});

function poolCadastros({ jaFeito = false } = {}) {
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_cadastros'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id, nome FROM web_perfis WHERE nome IN/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
}

function poolEntregas({ jaFeito = false } = {}) {
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_entregas'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id, nome FROM web_perfis WHERE nome IN/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
}

test('cadastros: Administrador recebe fornecedores e funcionários; Interno completo só fornecedores; uma vez', async () => {
  const { acrescentarPermissoesCadastros } = require('../seguranca/instalacao');
  const pool = poolCadastros();
  assert.deepEqual(await acrescentarPermissoesCadastros(pool), { feito: true });
  const ins = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params);
  assert.deepEqual(ins, [[1, 'fornecedores.ver'], [1, 'fornecedores.editar'], [1, 'funcionarios.ver'], [1, 'funcionarios.editar'], [2, 'fornecedores.ver'], [2, 'fornecedores.editar']]);
  assert.ok(pool.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql)).params.includes('permissoes_cadastros'));
  assert.deepEqual(await acrescentarPermissoesCadastros(poolCadastros({ jaFeito: true })), { feito: false });
});

test('entregas: ver e programar para Administrador e Interno completo (nunca baixar), uma vez', async () => {
  const pool = poolEntregas();
  assert.deepEqual(await acrescentarPermissoesEntregas(pool), { feito: true });
  const ins = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params);
  assert.deepEqual(ins, [[1, 'entregas.ver'], [1, 'entregas.programar'], [2, 'entregas.ver'], [2, 'entregas.programar']]);
  assert.ok(pool.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql)).params.includes('permissoes_entregas'));
  const seq = pool.chamadas.map(c => c.sql);
  assert.ok(seq.indexOf('BEGIN') >= 0 && seq.indexOf('COMMIT') > seq.indexOf('BEGIN'));
  const ja = poolEntregas({ jaFeito: true });
  assert.deepEqual(await acrescentarPermissoesEntregas(ja), { feito: false });
  assert.ok(!ja.chamadas.some(c => /INSERT/.test(c.sql)));
});

test('tintas: ver e editar para Administrador e Interno completo, uma vez', async () => {
  const { acrescentarPermissoesTintas } = require('../seguranca/instalacao');
  const poolTintas = ({ jaFeito = false } = {}) => criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_tintas'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id, nome FROM web_perfis WHERE nome IN/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
  const pool = poolTintas();
  assert.deepEqual(await acrescentarPermissoesTintas(pool), { feito: true });
  const ins = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params);
  assert.deepEqual(ins, [[1, 'tintas.ver'], [1, 'tintas.editar'], [2, 'tintas.ver'], [2, 'tintas.editar']]);
  assert.ok(pool.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql)).params.includes('permissoes_tintas'));
  assert.deepEqual(await acrescentarPermissoesTintas(poolTintas({ jaFeito: true })), { feito: false });
});

test('gestão: tabelas de metas e orçamento (DECIMAL(14,2), UNIQUE, sem chave estrangeira) e permissões só para o Administrador, uma vez', async () => {
  const { acrescentarPermissoesGestao } = require('../seguranca/instalacao');
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const metas = pool.chamadas.find(c => /`web_gestao_metas`/.test(c.sql)).sql;
  assert.ok(metas.includes('valor DECIMAL(14,2) NOT NULL'));
  assert.ok(metas.includes('UNIQUE KEY uq_meta (periodo, tipo)'));
  assert.ok(metas.includes("origem ENUM('web','vb')"));
  const orc = pool.chamadas.find(c => /`web_gestao_orcamento`/.test(c.sql)).sql;
  assert.ok(orc.includes('valor DECIMAL(14,2) NOT NULL'));
  assert.ok(orc.includes('UNIQUE KEY uq_orcamento (periodo, classificacao_id)'));
  assert.doesNotMatch(metas + orc, /FOREIGN KEY|REFERENCES/);
  const poolGestao = ({ jaFeito = false } = {}) => criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_gestao'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
  const p = poolGestao();
  assert.deepEqual(await acrescentarPermissoesGestao(p), { feito: true });
  assert.deepEqual(p.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params), [[1, 'gestao.ver'], [1, 'gestao.editar']]);
  assert.ok(p.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql)).params.includes('permissoes_gestao'));
  assert.deepEqual(await acrescentarPermissoesGestao(poolGestao({ jaFeito: true })), { feito: false });
});

test('plano de corte: tabelas em mm inteiros, UNIQUE por perfil, sem chave estrangeira; permissões por perfil, uma vez', async () => {
  const { acrescentarPermissoesCorte } = require('../seguranca/instalacao');
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const sql = nome => pool.chamadas.find(c => new RegExp('`' + nome + '`').test(c.sql)).sql;
  const cfg = sql('web_corte_config');
  assert.ok(cfg.includes("perfil VARCHAR(190) NOT NULL DEFAULT ''"));
  assert.ok(cfg.includes('comprimento_vara INT') && cfg.includes('serra INT') && cfg.includes('sobra_minima INT'));
  assert.ok(cfg.includes('UNIQUE KEY uq_corte_config (perfil)'));
  const ret = sql('web_retalhos');
  assert.ok(ret.includes('comprimento INT NOT NULL'));
  assert.ok(ret.includes("ENUM('disponivel','reservado','usado','descartado')"));
  const pl = sql('web_corte_planos');
  assert.ok(pl.includes('excluido_em DATETIME NULL'));
  assert.ok(pl.includes('pedido INT NOT NULL') && pl.includes('impressao_pecas CHAR(64)'));
  assert.ok(pl.includes("ENUM('gerado','conferido','desatualizado','cancelado')"));
  assert.ok(/resultado (JSON|LONGTEXT)/.test(pl));
  assert.doesNotMatch(cfg + ret + pl, /FOREIGN KEY|REFERENCES/);
  const poolCorte = ({ jaFeito = false } = {}) => criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_corte'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id, nome FROM web_perfis WHERE nome IN/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
  const p = poolCorte();
  assert.deepEqual(await acrescentarPermissoesCorte(p), { feito: true });
  assert.deepEqual(p.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params),
    [[1, 'corte.ver'], [1, 'corte.planejar'], [1, 'corte.parametros'], [2, 'corte.ver'], [2, 'corte.planejar']]);
  assert.ok(p.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql)).params.includes('permissoes_corte'));
  assert.deepEqual(await acrescentarPermissoesCorte(poolCorte({ jaFeito: true })), { feito: false });
});
