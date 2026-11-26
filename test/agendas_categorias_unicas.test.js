// Agendas: migração das categorias pessoais para a lista única (seguranca/instalacao.js unificarCategoriasAgendas).
// Banco em memória (test/apoio/bancoSemana.js), que entende o SQL da migração.
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoSemana } = require('./apoio/bancoSemana');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { unificarCategoriasAgendas, instalarTabelas, MARCADOR_CATEGORIAS } = require('../seguranca/instalacao');

const item = (id, usuario_codigo, categoria_id, extra = {}) => ({ id, usuario_codigo, quadro: 'notas', data: null, texto: 't' + id, feita: 0, alarme: null, categoria_id, categoria_unica_id: null, ...extra });

function cenario() {
  const b = criarBancoSemana();
  // lista única (a da compartilhada) já com "Médico" azul e "Banco" verde
  b.catAdmin.push({ id: 1, nome: 'Médico', cor: 'azul' }, { id: 2, nome: 'Banco', cor: 'verde' });
  // pessoais: ids repetem os da lista única de propósito (1 e 2 aqui NÃO são os 1 e 2 de lá)
  b.catPessoais.push(
    { id: 1, usuario_codigo: 7, nome: 'Academia', cor: 'rosa' },   // nova na lista única
    { id: 2, usuario_codigo: 7, nome: 'MEDICO', cor: 'roxo' },      // já existe (sem acento/maiúsculas): vale a azul
    { id: 3, usuario_codigo: 8, nome: 'academia', cor: 'lima' },    // mesmo nome da do 7, mais nova: junta na dela
    { id: 4, usuario_codigo: 8, nome: 'Escola', cor: 'amarelo' });
  b.pessoais.push(item(1, 7, 1), item(2, 7, 2), item(3, 8, 3), item(4, 8, 4), item(5, 8, null), item(6, 7, 3) /* categoria de outra pessoa: não vale */);
  b.admin.push({ id: 1, quadro: 'tarefas', data: null, texto: 'comp', feita: 0, alarme: null, versao: 4, criada_por: 'Ana', feita_por: null, categoria_id: 1 });
  return b;
}

test('migração: junta pelo nome (vale a da lista única), mesma pessoa/outra pessoa = a mais antiga; itens ganham categoria_unica_id', async () => {
  const b = cenario();
  const r = await unificarCategoriasAgendas(b.f);
  assert.deepEqual(r, { feito: true, pessoais: 4, criadas: 2, itens: 4 });
  assert.deepEqual(b.catAdmin.map(c => [c.id, c.nome, c.cor]), [[1, 'Médico', 'azul'], [2, 'Banco', 'verde'], [3, 'Academia', 'rosa'], [4, 'Escola', 'amarelo']]);
  // Academia (7) -> 3; MEDICO (7) -> 1 (azul da lista única); academia (8) -> 3 (a mais antiga, rosa); Escola -> 4
  assert.deepEqual(b.pessoais.map(l => [l.id, l.categoria_unica_id]), [[1, 3], [2, 1], [3, 3], [4, 4], [5, null], [6, null]]);
  assert.deepEqual(b.pessoais.map(l => l.categoria_id), [1, 2, 3, 4, null, 3], 'a coluna antiga fica como estava');
  assert.equal(b.catPessoais.length, 4, 'a tabela antiga não é apagada');
  assert.deepEqual([b.admin[0].categoria_id, b.admin[0].versao], [1, 4], 'os itens compartilhados não mudam');
  // marcador com contagens, sem nome de categoria
  assert.equal(b.auditoria.length, 1);
  assert.equal(b.auditoria[0].acao, MARCADOR_CATEGORIAS);
  assert.ok(!/Academia|Escola|M[eé]dico|Banco/i.test(b.auditoria[0].detalhe));
  const sqls = b.f.chamadas.map(c => c.sql);
  assert.ok(sqls.indexOf('BEGIN') < sqls.findIndex(s => /FOR UPDATE/.test(s)) && sqls.at(-1) === 'COMMIT', 'tudo numa transação, com a lista travada');
  assert.ok(!sqls.some(s => /^(DELETE|DROP|TRUNCATE)/i.test(s) || /UPDATE web_tarefas SET categoria_id/.test(s)), 'nada apagado; categoria_id nunca reescrita');
});

test('migração: roda uma vez só (marcador); a segunda subida não remapeia de novo nem duplica categorias', async () => {
  const b = cenario();
  await unificarCategoriasAgendas(b.f);
  b.pessoais[0].categoria_unica_id = 4;   // a pessoa trocou depois da migração
  b.pessoais.push(item(9, 7, 1));         // item antigo do servidor velho (coluna antiga) aparece depois
  const antes = b.f.chamadas.length;
  assert.deepEqual(await unificarCategoriasAgendas(b.f), { feito: false });
  assert.equal(b.catAdmin.length, 4);
  assert.deepEqual(b.pessoais.map(l => l.categoria_unica_id), [4, 1, 3, 4, null, null, null]);
  assert.deepEqual(b.f.chamadas.slice(antes).map(c => c.sql), [`SELECT id FROM web_auditoria WHERE acao = '${MARCADOR_CATEGORIAS}' LIMIT 1`]);
});

test('migração: outra subida que gravou o marcador enquanto esta esperava a trava = desiste sem gravar nada', async () => {
  const b = cenario();
  let primeira = true;
  const exec = b.f.execute;
  b.f.execute = async (sql, p) => {
    // a 1ª conferência (fora da transação) não vê o marcador; a 2ª (depois da trava) vê: a outra subida terminou antes
    if (/FROM web_auditoria/.test(sql) && primeira) { primeira = false; return [[], []]; }
    if (/FROM web_auditoria/.test(sql)) return [[{ id: 1 }], []];
    return exec(sql, p);
  };
  const conn = b.f.getConnection;
  b.f.getConnection = async () => ({ ...(await conn()), execute: b.f.execute });
  assert.deepEqual(await unificarCategoriasAgendas(b.f), { feito: false });
  assert.equal(b.catAdmin.length, 2);
  assert.ok(b.pessoais.every(l => l.categoria_unica_id === null));
  assert.ok(b.f.chamadas.some(c => c.sql === 'ROLLBACK'));
});

test('migração: falha no meio = ROLLBACK, sem marcador; na subida seguinte termina certo, sem duplicar o que já tivesse entrado', async () => {
  const b = cenario();
  const exec = b.f.execute;
  let falhar = true;
  b.f.execute = async (sql, p) => {
    if (falhar && /^UPDATE web_tarefas SET categoria_unica_id/.test(sql)) { falhar = false; const e = new Error('caiu'); e.code = 'PROTOCOL_CONNECTION_LOST'; throw e; }
    return exec(sql, p);
  };
  const conn = b.f.getConnection;
  b.f.getConnection = async () => ({ ...(await conn()), execute: b.f.execute });
  await assert.rejects(unificarCategoriasAgendas(b.f), /caiu/);
  assert.ok(b.f.chamadas.some(c => c.sql === 'ROLLBACK'));
  assert.equal(b.auditoria.length, 0, 'sem marcador: roda de novo');
  // o banco de verdade desfaz tudo no ROLLBACK; o de memória não: mesmo com as categorias já criadas, a nova rodada não duplica
  const r = await unificarCategoriasAgendas(b.f);
  assert.equal(r.feito, true);
  assert.deepEqual(b.catAdmin.map(c => c.nome), ['Médico', 'Banco', 'Academia', 'Escola']);
  assert.deepEqual(b.pessoais.map(l => l.categoria_unica_id), [3, 1, 3, 4, null, null]);
});

test('migração: nome que o banco acha igual e a comparação daqui acha diferente usa a categoria que já está lá', async () => {
  const b = criarBancoSemana();
  b.catAdmin.push({ id: 1, nome: 'Strasse', cor: 'azul' });
  b.catPessoais.push({ id: 1, usuario_codigo: 7, nome: 'Straße', cor: 'rosa' });
  b.pessoais.push(item(1, 7, 1));
  const exec = b.f.execute;
  b.f.execute = async (sql, p) => {
    if (/^INSERT INTO web_tarefas_admin_categorias/.test(sql)) { const e = new Error('Duplicate'); e.code = 'ER_DUP_ENTRY'; e.errno = 1062; throw e; }
    if (/^SELECT id FROM web_tarefas_admin_categorias WHERE nome = \?$/.test(sql)) return [[{ id: 1 }], []];
    return exec(sql, p);
  };
  const conn = b.f.getConnection;
  b.f.getConnection = async () => ({ ...(await conn()), execute: b.f.execute });
  const r = await unificarCategoriasAgendas(b.f);
  assert.deepEqual([r.criadas, b.pessoais[0].categoria_unica_id, b.catAdmin.length], [0, 1, 1]);
});

test('migração: acima de 30 no total, todas ficam', async () => {
  const b = criarBancoSemana();
  for (let i = 1; i <= 20; i++) b.catAdmin.push({ id: i, nome: 'Comp ' + i, cor: 'azul' });
  for (let i = 1; i <= 15; i++) b.catPessoais.push({ id: i, usuario_codigo: 7, nome: 'Pes ' + i, cor: 'rosa' });
  await unificarCategoriasAgendas(b.f);
  assert.equal(b.catAdmin.length, 35);
});

test('instalação: colunas hora_inicio/hora_fim e categoria_unica_id só se faltarem (web_* apenas); a migração roda depois delas', async () => {
  const p = criarPoolFalso();
  await instalarTabelas(p);
  const sqls = p.chamadas.map(c => c.sql);
  assert.ok(sqls.includes('ALTER TABLE web_tarefas ADD COLUMN hora_inicio SMALLINT NULL, ADD COLUMN hora_fim SMALLINT NULL'));
  assert.ok(sqls.includes('ALTER TABLE web_tarefas_admin ADD COLUMN hora_inicio SMALLINT NULL, ADD COLUMN hora_fim SMALLINT NULL'));
  assert.ok(sqls.includes('ALTER TABLE web_tarefas ADD COLUMN categoria_unica_id INT NULL, ADD KEY ix_tarefas_cat_unica (categoria_unica_id)'));
  const alter = sqls.indexOf('ALTER TABLE web_tarefas ADD COLUMN categoria_unica_id INT NULL, ADD KEY ix_tarefas_cat_unica (categoria_unica_id)');
  assert.ok(alter < sqls.findIndex(s => /FROM web_tarefas_admin_categorias ORDER BY id FOR UPDATE/.test(s)), 'coluna antes da migração');
  for (const s of sqls.filter(s => /^ALTER|^UPDATE|^INSERT/.test(s))) assert.match(s, /^(ALTER TABLE|UPDATE|INSERT INTO) web_/, s);
  // segunda subida: colunas já existem e o marcador também: nenhum ALTER das agendas, nenhuma transação da migração
  const q = criarPoolFalso([[/information_schema\.COLUMNS .*COLUMN_NAME = '(hora_inicio|categoria_unica_id)'/, [{ n: 1 }]],
    [/FROM web_auditoria WHERE acao = 'agendas_categorias_unicas'/, [{ id: 1 }]]]);
  await instalarTabelas(q);
  assert.ok(!q.chamadas.some(c => /ADD COLUMN (hora_inicio|categoria_unica_id)/.test(c.sql)));
  assert.ok(!q.chamadas.some(c => /FOR UPDATE/.test(c.sql)));
});
