const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CATALOGO, PERFIS_INICIAIS, PERMISSOES_ADMINISTRATIVAS } = require('../seguranca/permissoes');
const { acrescentarPermissoesCompras, instalarTabelas } = require('../seguranca/instalacao');
const { criarPoolFalso } = require('./apoio/poolFalso');

test('compras.ver e compras.criar: área Estoque, não administrativas, fora de Estoquista e Operador', () => {
  for (const c of ['compras.ver', 'compras.criar']) {
    const p = CATALOGO.find(x => x.codigo === c);
    assert.equal(p?.area, 'Estoque', c);
    assert.ok(p.descricao, c);
    assert.ok(!PERMISSOES_ADMINISTRATIVAS.includes(c), c);
    for (const nome of ['Administrador', 'Interno completo']) assert.ok(PERFIS_INICIAIS.find(x => x.nome === nome).permissoes.includes(c), nome + ' ' + c);
    for (const nome of ['Estoquista', 'Operador', 'Vendedor', 'Representante']) assert.ok(!PERFIS_INICIAIS.find(x => x.nome === nome).permissoes.includes(c), nome + ' ' + c);
  }
});

test('migração única: quem tem estoque.editar ganha as duas, inclusive por exceção', async () => {
  let feito = false;
  const pool = criarPoolFalso([
    [/SELECT id FROM web_auditoria WHERE acao = \?/, () => feito ? [{ id: 1 }] : []],
    [/SELECT DISTINCT perfil_id FROM web_perfil_permissoes WHERE permissao = 'administrativo.ver'/, []],
    [/SELECT DISTINCT perfil_id FROM web_perfil_permissoes WHERE permissao = \?/, (sql, [de]) => de === 'estoque.editar' ? [{ perfil_id: 3 }] : []],
    [/SELECT usuario_codigo, tipo FROM web_usuario_excecoes WHERE permissao = \?/, [{ usuario_codigo: 9, tipo: 'liberar' }]],
    [/INSERT IGNORE INTO web_(perfil_permissoes|usuario_excecoes)/, { affectedRows: 1 }],
    [/INSERT INTO web_auditoria/, () => { feito = true; return { affectedRows: 1 }; }]
  ]);
  assert.equal((await acrescentarPermissoesCompras(pool)).feito, true);
  const inseridas = re => pool.chamadas.filter(c => re.test(c.sql)).map(c => c.params.join(':'));
  assert.deepEqual(inseridas(/INSERT IGNORE INTO web_perfil_permissoes/), ['3:compras.ver', '3:compras.criar']);
  assert.deepEqual(inseridas(/INSERT IGNORE INTO web_usuario_excecoes/), ['9:compras.ver:liberar', '9:compras.criar:liberar']);
  assert.equal((await acrescentarPermissoesCompras(pool)).feito, false);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), /acrescentarPermissoesCompras\(pool\)/);
});

test('instalarTabelas cria as três tabelas dos pedidos a fornecedor', async () => {
  const pool = criarPoolFalso([[/information_schema/, [{ n: 1 }]], [/./, []]]);
  await instalarTabelas(pool);
  const sql = pool.chamadas.map(c => c.sql).join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `web_pedidos_compra` \([\s\S]*?chave VARCHAR\(64\) NOT NULL[\s\S]*?UNIQUE KEY[^\n]*\(chave\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `web_pedidos_compra_itens`[\s\S]*?por_caixa INT NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `web_pedidos_compra_baixas`/);
});
