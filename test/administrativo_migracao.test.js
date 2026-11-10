// Migração única da divisão administrativo × operador (seguranca/instalacao.js) e a função que dá a classe de exibição.
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { acrescentarPermissoesAdministrativo } = require('../seguranca/instalacao');
const { classeDoAcesso, PERFIS_INICIAIS } = require('../seguranca/permissoes');

function pool({ jaFeito = false, perfis = [{ id: 1 }, { id: 2 }, { id: 8 }], usuarios = [{ usuario_codigo: 7 }], operador = [] } = {}) {
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_administrativo'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT DISTINCT p\.id FROM web_perfis p LEFT JOIN web_perfil_permissoes pp/, perfis],
    [/SELECT DISTINCT usuario_codigo FROM web_usuario_excecoes/, usuarios],
    [/SELECT id FROM web_perfis WHERE nome = 'Operador'/, operador],
    [/INSERT INTO web_perfis/, () => ({ insertId: 40 })],
    [/INSERT (IGNORE )?INTO web_(perfil_permissoes|usuario_excecoes)/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
}
const inserts = (p, re) => p.chamadas.filter(c => re.test(c.sql));

test('migração: a chave vai para os perfis que já usam gestão e para quem tem exceção; o Operador é criado; tudo numa transação', async () => {
  const p = pool();
  const r = await acrescentarPermissoesAdministrativo(p);
  assert.deepEqual(r, { feito: true, perfis: 3, usuarios: 1, operadorCriado: true });
  // consulta dos perfis: Administrador e Interno completo OU quem já tem financeiro/gestão/preços
  const q = p.chamadas.find(c => /SELECT DISTINCT p\.id FROM web_perfis p/.test(c.sql));
  assert.match(q.sql, /'Administrador', 'Interno completo'/);
  assert.deepEqual(q.params, ['financeiro.ver', 'gestao.ver', 'precos.ver']);
  const chaves = inserts(p, /INSERT IGNORE INTO web_perfil_permissoes/);
  assert.deepEqual(chaves.map(c => c.params[0]), [1, 2, 8]);
  assert.ok(chaves.every(c => /administrativo\.ver/.test(c.sql)));
  const exc = inserts(p, /INSERT IGNORE INTO web_usuario_excecoes/);
  assert.equal(exc.length, 1);
  assert.deepEqual(exc[0].params, [7]);
  assert.match(exc[0].sql, /'administrativo\.ver', 'liberar'/);
  // perfil Operador criado com as permissões do modelo, sem a chave nem valores
  const modelo = PERFIS_INICIAIS.find(x => x.nome === 'Operador');
  assert.equal(inserts(p, /INSERT INTO web_perfis/).length, 1);
  const permsOp = inserts(p, /INSERT INTO web_perfil_permissoes \(perfil_id, permissao\)/).map(c => c.params);
  assert.deepEqual(permsOp.map(x => x[1]).sort(), [...modelo.permissoes].sort());
  assert.ok(permsOp.every(x => x[0] === 40));
  assert.ok(!permsOp.some(x => x[1] === 'administrativo.ver' || x[1] === 'valores.ver'));
  // auditoria com quem recebeu a chave
  const aud = p.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql));
  assert.deepEqual(JSON.parse(aud.params[3]), { perfisComChave: [1, 2, 8], usuariosComChave: [7], operadorCriado: true });
  assert.deepEqual(p.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql), ['BEGIN', 'COMMIT']);
});

test('migração: Operador que já existe não é recriado; Vendedor e Representante só entram se já usarem financeiro/gestão/preços (aqui não)', async () => {
  const p = pool({ perfis: [{ id: 1 }, { id: 2 }], usuarios: [], operador: [{ id: 5 }] });
  const r = await acrescentarPermissoesAdministrativo(p);
  assert.deepEqual(r, { feito: true, perfis: 2, usuarios: 0, operadorCriado: false });
  assert.equal(inserts(p, /INSERT INTO web_perfis/).length, 0);
  assert.equal(inserts(p, /INSERT IGNORE INTO web_usuario_excecoes/).length, 0);
});

test('migração: roda uma única vez (a marca na auditoria impede a repetição) e desfaz tudo se algo falhar', async () => {
  const ja = pool({ jaFeito: true });
  assert.deepEqual(await acrescentarPermissoesAdministrativo(ja), { feito: false });
  assert.ok(!ja.chamadas.some(c => /INSERT|BEGIN/.test(c.sql)));
  const ruim = criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_administrativo'/, []],
    [/SELECT DISTINCT p\.id FROM web_perfis p/, () => { throw new Error('banco caiu'); }]
  ]);
  await assert.rejects(acrescentarPermissoesAdministrativo(ruim), /banco caiu/);
  assert.deepEqual(ruim.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql), ['BEGIN', 'ROLLBACK']);
});

test('classeDoAcesso: administrativo (chave), só valores (valores.ver sem a chave) ou operador', () => {
  assert.equal(classeDoAcesso(new Set(['administrativo.ver', 'valores.ver'])), 'administrativo');
  assert.equal(classeDoAcesso(['administrativo.ver']), 'administrativo');
  assert.equal(classeDoAcesso(new Set(['valores.ver', 'pedidos.ver'])), 'so_valores');
  assert.equal(classeDoAcesso(new Set(['estoque.ver', 'estoque.movimentar'])), 'operador');
  assert.equal(classeDoAcesso(new Set()), 'operador');
  assert.equal(classeDoAcesso(undefined), 'operador');
});
