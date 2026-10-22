const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { instalarTabelas, migrarAcessos, acrescentarPermissoesEstoque, acrescentarPermissoesPedOrc, acrescentarPermissoesPrecos, acrescentarPermissoesPrecosGravar } = require('../seguranca/instalacao');

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

test('cria as 16 tabelas web_', async () => {
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const creates = pool.chamadas.filter(c => /CREATE TABLE IF NOT EXISTS `web_/.test(c.sql)).map(c => c.sql.match(/`(web_\w+)`/)[1]);
  assert.deepEqual(creates.sort(), ['web_auditoria', 'web_custo_ligacoes', 'web_custo_material', 'web_custo_parametros', 'web_estoque_ajustes', 'web_estoque_estornos', 'web_estoque_lancamentos', 'web_estoque_ligacoes', 'web_estoque_reposicao',
    'web_perfil_permissoes', 'web_perfis', 'web_preco_encargos', 'web_preco_historico', 'web_preco_margens', 'web_usuario_acesso', 'web_usuario_excecoes']);
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
