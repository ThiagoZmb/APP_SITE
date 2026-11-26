// Agendas: repetir item (série) e mudar/apagar em série (rotas/minha_semana.js, rotas/semana_admin.js). Banco em memória.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { criarBancoSemana } = require('./apoio/bancoSemana');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { instalarTabelas } = require('../seguranca/instalacao');
const { agoraLocal } = require('../rotas/transacao');
aceitarSidDeTeste(sessoes);

const NOMES = { 1: 'Ana', 2: 'João', 3: 'Zé' };

async function preparar(t, { semPermissao = [3] } = {}) {
  const banco = criarBancoSemana();
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  acesso.limpar();
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: NOMES[id] || 'U' + id, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'X' },
    estados: [], ativo: true, permissoes: new Set(semPermissao.includes(id) ? [] : ['tarefas_admin.usar']) }));
  const logs = [];
  for (const m of ['warn', 'error', 'log']) t.mock.method(console, m, (...a) => logs.push(a.join(' ')));
  const s = await subir(app);
  t.after(s.fechar);
  const como = id => {
    const cab = { Authorization: 'Bearer ' + jwt.sign({ id, nome: 'x', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' }), 'Content-Type': 'application/json' };
    const pedir = async (metodo, caminho, corpo) => {
      const r = await fetch(s.url + caminho, { method: metodo, headers: cab, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      return { status: r.status, corpo: await r.json().catch(() => ({})) };
    };
    return { get: c => pedir('GET', c), post: (c, b) => pedir('POST', c, b), put: (c, b) => pedir('PUT', c, b), del: (c, b) => pedir('DELETE', c, b) };
  };
  return { banco, como, logs };
}
const DIARIA = (de, ate, pular = false) => ({ tipo: 'diaria', de, ate, pularFimDeSemana: pular });
const transacao = banco => banco.f.chamadas.some(c => c.sql === 'BEGIN') && banco.f.chamadas.some(c => c.sql === 'COMMIT');

// ---------- criar a série: Minha semana ----------
test('pessoal: repetir todos os dias; o item vira a 1ª ocorrência (vai para a 1ª data); cópias sem alarme e não concluídas, mesmo texto e categoria', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana/categorias', { nome: 'Banco', cor: 'azul' });
  await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'Extrato', categoriaId: 1 });
  Object.assign(banco.pessoais[0], { feita: 1, alarme: '2026-11-24 09:00:00' });
  const r = await ana.post('/minha_semana/1/repetir', DIARIA('2026-11-27', '2026-12-01'));
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.linhas.length, 5);
  assert.deepEqual(r.corpo.linhas.map(l => l.data), ['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'], 'sábado e domingo entram');
  assert.deepEqual(r.corpo.linhas.map(l => l.seriePos), [1, 2, 3, 4, 5]);
  const serie = r.corpo.linha.serieId;
  assert.match(serie, /^[0-9a-f]{32}$/);
  assert.deepEqual([r.corpo.linha.id, r.corpo.linha.data, r.corpo.linha.feita], [1, '2026-11-27', true], 'o próprio item (mantém o concluído)');
  assert.equal(banco.pessoais[0].alarme, '2026-11-24 09:00:00', 'o alarme do próprio item fica');
  for (const l of banco.pessoais.slice(1)) {
    assert.deepEqual([l.usuario_codigo, l.quadro, l.texto, l.categoria_unica_id, l.feita, l.alarme, l.serie_id], [1, 'dia', 'Extrato', 1, 0, null, serie]);
  }
  assert.ok(transacao(banco), 'numa transação');
  const g = await ana.get('/minha_semana?inicio=2026-11-23');
  assert.deepEqual(g.corpo.linhas.map(l => [l.data, l.serieId === serie]), [['2026-11-27', true], ['2026-11-28', true], ['2026-11-29', true]]);
});

test('pessoal: item em Tarefas repete por mês a partir de hoje; Notas não se repetem; item já em série = 409 sem duplicar (clique duplo)', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'Aluguel' });
  const hoje = agoraLocal().slice(0, 10);
  const [r1, r2] = await Promise.all([ana.post('/minha_semana/1/repetir', { tipo: 'mensal', dia: 31, meses: 3 }), ana.post('/minha_semana/1/repetir', { tipo: 'mensal', dia: 31, meses: 3 })]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 409]);
  assert.equal([r1, r2].find(r => r.status === 409).corpo.jaEmSerie, true);
  assert.equal(banco.pessoais.length, 3, 'só uma série criada');
  const linhas = [r1, r2].find(r => r.status === 201).corpo.linhas;
  assert.ok(linhas[0].data >= hoje && linhas.every(l => l.quadro === 'dia'));
  assert.equal((await ana.post('/minha_semana/1/repetir', DIARIA('2026-12-01', '2026-12-05'))).status, 409, 'série não se repete de novo');
  await ana.post('/minha_semana', { quadro: 'notas', texto: 'nota' });
  assert.equal((await ana.post('/minha_semana/4/repetir', DIARIA('2026-12-01', '2026-12-05'))).status, 400);
  assert.equal(banco.pessoais.length, 4);
});

test('pessoal: regra inválida = 400 e nada gravado; item de outra pessoa = 404', async t => {
  const { como, banco } = await preparar(t);
  await como(1).post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'meu' });
  for (const regra of [DIARIA('2026-01-01', '2027-01-02'), DIARIA('2026-12-02', '2026-12-01'), { tipo: 'mensal', dia: 5, meses: 61 }, { tipo: 'semanal' }])
    assert.equal((await como(1).post('/minha_semana/1/repetir', regra)).status, 400, JSON.stringify(regra));
  assert.equal((await como(2).post('/minha_semana/1/repetir', DIARIA('2026-12-01', '2026-12-03'))).status, 404);
  assert.equal((await como(1).post('/minha_semana/abc/repetir', DIARIA('2026-12-01', '2026-12-03'))).status, 404);
  assert.deepEqual(banco.pessoais.map(l => [l.texto, l.serie_id ?? null, l.data]), [['meu', null, '2026-11-24']]);
});

// ---------- mudar e apagar em série: Minha semana ----------
async function serieDaAna(como, banco, n = 5) {
  const ana = como(1);
  const p = await ana.post('/minha_semana', { quadro: 'dia', data: '2026-12-01', texto: 'Ponto' });
  const r = await ana.post(`/minha_semana/${p.corpo.id}/repetir`, DIARIA('2026-12-01', `2026-12-0${n}`));
  assert.equal(r.status, 201);
  return { ana, serie: r.corpo.linha.serieId };
}

test('pessoal: texto em série: só este, este e os próximos, todos; categoria também; outros campos com escopo = 400', async t => {
  const { como, banco } = await preparar(t);
  const { ana } = await serieDaAna(como, banco);
  let r = await ana.put('/minha_semana/3', { texto: 'Só o 3', escopo: 'este' });
  assert.deepEqual(banco.pessoais.map(l => l.texto), ['Ponto', 'Ponto', 'Só o 3', 'Ponto', 'Ponto']);
  r = await ana.put('/minha_semana/3', { texto: 'Do 3 em diante', escopo: 'proximos' });
  assert.equal(r.status, 200);
  assert.deepEqual(banco.pessoais.map(l => l.texto), ['Ponto', 'Ponto', 'Do 3 em diante', 'Do 3 em diante', 'Do 3 em diante']);
  assert.deepEqual(r.corpo.serie.alteradas.map(l => l.id), [3, 4, 5]);
  assert.equal(r.corpo.texto, 'Do 3 em diante', 'a resposta é a linha clicada');
  await ana.post('/minha_semana/categorias', { nome: 'RH', cor: 'verde' });
  r = await ana.put('/minha_semana/2', { categoriaId: 1, escopo: 'todos' });
  assert.deepEqual(banco.pessoais.map(l => l.categoria_unica_id), [1, 1, 1, 1, 1]);
  assert.ok(transacao(banco));
  for (const corpo of [{ texto: 'x', feita: true, escopo: 'todos' }, { quadro: 'tarefas', escopo: 'todos' }, { texto: 'x', escopo: 'tudo' }])
    assert.equal((await ana.put('/minha_semana/2', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal((await ana.put('/minha_semana/2', { categoriaId: 99, escopo: 'todos' })).status, 400, 'categoria alheia');
  assert.deepEqual(banco.pessoais.map(l => l.categoria_unica_id), [1, 1, 1, 1, 1]);
});

test('pessoal: apagar em série não apaga os concluídos (só o próprio item, se pedido); "só este" apaga mesmo concluído', async t => {
  const { como, banco } = await preparar(t);
  const { ana } = await serieDaAna(como, banco);
  banco.pessoais.find(l => l.id === 4).feita = 1;
  banco.pessoais.find(l => l.id === 2).feita = 1;
  let r = await ana.del('/minha_semana/2?escopo=proximos');
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.serie.apagadas.sort(), [2, 3, 5], 'o próprio (concluído) sai; o 4 concluído fica');
  assert.equal(r.corpo.serie.concluidas, 1);
  assert.deepEqual(banco.pessoais.map(l => l.id), [1, 4]);
  r = await ana.del('/minha_semana/4');
  assert.deepEqual([r.status, banco.pessoais.map(l => l.id)], [200, [1]], 'só este: apaga mesmo concluído');
  assert.equal((await ana.del('/minha_semana/1?escopo=nada')).status, 400);
});

test('pessoal: série alheia nunca é tocada (mesmo serie_id em outra pessoa ou na compartilhada); mover para Notas tira da série', async t => {
  const { como, banco } = await preparar(t);
  const { ana, serie } = await serieDaAna(como, banco, 3);
  // linhas plantadas com o MESMO identificador: de outra pessoa e da compartilhada
  banco.pessoais.push({ id: 90, usuario_codigo: 2, quadro: 'dia', data: '2026-12-02', texto: 'Ponto', feita: 0, alarme: null, categoria_id: null, serie_id: serie, serie_pos: 2 });
  banco.admin.push({ id: 91, quadro: 'dia', data: '2026-12-02', texto: 'Ponto', feita: 0, alarme: null, versao: 1, criada_por_codigo: 1, criada_por: 'Ana', feita_por: null, categoria_id: null, serie_id: serie, serie_pos: 2 });
  await ana.put('/minha_semana/1', { texto: 'Mudou', escopo: 'todos' });
  await ana.del('/minha_semana/1?escopo=todos');
  assert.deepEqual(banco.pessoais.map(l => [l.id, l.texto]), [[90, 'Ponto']]);
  assert.deepEqual([banco.admin[0].texto, banco.admin[0].versao], ['Ponto', 1]);
  assert.equal((await como(2).put('/minha_semana/90', { texto: 'x', escopo: 'todos' })).status, 200);
  assert.equal((await ana.put('/minha_semana/90', { texto: 'x', escopo: 'todos' })).status, 404, 'item de outra pessoa = 404');
  assert.equal((await ana.del('/minha_semana/90?escopo=todos')).status, 404);
  // Notas: sai da série
  const s2 = await serieDaAna(como, banco, 3);
  const id = banco.pessoais.find(l => l.serie_id === s2.serie && l.usuario_codigo === 1).id;
  const r = await ana.put('/minha_semana/' + id, { quadro: 'notas' });
  assert.deepEqual([r.corpo.serieId, banco.pessoais.find(l => l.id === id).serie_id], [null, null]);
  const r2 = await ana.put('/minha_semana/' + (id + 1), { quadro: 'tarefas' });
  assert.equal(r2.corpo.serieId, s2.serie, 'Tarefas continua na série');
});

// ---------- Semana compartilhada ----------
test('compartilhada: repetir leva a versão; versão velha = 409 com o atual e nada criado; autoria das cópias = quem repetiu', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1), joao = como(2);
  await ana.post('/semana_admin', { quadro: 'dia', data: '2026-12-01', texto: 'Backup' });
  await joao.put('/semana_admin/1', { texto: 'Backup do servidor', versao: 1 });
  const velha = await ana.post('/semana_admin/1/repetir', { ...DIARIA('2026-12-01', '2026-12-03'), versao: 1 });
  assert.deepEqual([velha.status, velha.corpo.atual.texto], [409, 'Backup do servidor']);
  assert.equal(banco.admin.length, 1);
  assert.equal((await ana.post('/semana_admin/1/repetir', DIARIA('2026-12-01', '2026-12-03'))).status, 400, 'sem versão');
  const r = await joao.post('/semana_admin/1/repetir', { ...DIARIA('2026-12-01', '2026-12-03'), versao: 2 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.corpo.linhas.map(l => [l.id, l.data, l.versao, l.criadaPor, l.texto]), [[1, '2026-12-01', 3, 'Ana', 'Backup do servidor'], [2, '2026-12-02', 1, 'João', 'Backup do servidor'], [3, '2026-12-03', 1, 'João', 'Backup do servidor']]);
  assert.equal((await joao.post('/semana_admin/1/repetir', { ...DIARIA('2026-12-01', '2026-12-03'), versao: 3 })).status, 409, 'já em série');
  assert.equal(banco.admin.length, 3);
  assert.equal((await como(3).post('/semana_admin/1/repetir', { ...DIARIA('2026-12-01', '2026-12-03'), versao: 3 })).status, 403);
});

test('compartilhada: mudar em série só mexe nos itens que estavam iguais a este; os que alguém mudou ficam e são contados', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1), joao = como(2);
  await ana.post('/semana_admin', { quadro: 'dia', data: '2026-12-01', texto: 'Ponto' });
  await ana.post('/semana_admin/1/repetir', { ...DIARIA('2026-12-01', '2026-12-04'), versao: 1 });
  await joao.put('/semana_admin/3', { texto: 'Ponto (João)', versao: 1 });   // João personalizou o 3
  const versoes = banco.admin.map(l => l.versao);
  const r = await ana.put('/semana_admin/1', { texto: 'Ponto e banco de horas', escopo: 'todos', versao: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(banco.admin.map(l => l.texto), ['Ponto e banco de horas', 'Ponto e banco de horas', 'Ponto (João)', 'Ponto e banco de horas']);
  assert.deepEqual(r.corpo.serie.alteradas.map(l => [l.id, l.versao]), [[1, 3], [2, 2], [4, 2]]);
  assert.equal(r.corpo.serie.diferentes, 1);
  assert.deepEqual(banco.admin.map(l => l.versao), [versoes[0] + 1, versoes[1] + 1, versoes[2], versoes[3] + 1], 'quem não mudou não ganha versão');
  // versão velha no item clicado: 409 e nada muda em nenhum
  const antes = JSON.stringify(banco.admin);
  const v = await ana.put('/semana_admin/1', { texto: 'outro', escopo: 'todos', versao: 2 });
  assert.equal(v.status, 409);
  assert.equal(JSON.stringify(banco.admin), antes);
  assert.equal((await ana.put('/semana_admin/1', { texto: 'x', alarme: null, escopo: 'todos', versao: 3 })).status, 400);
});

test('compartilhada: apagar em série não apaga concluídos nem os que alguém mudou; avisos dos apagados somem', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/semana_admin', { quadro: 'dia', data: '2026-12-01', texto: 'Ponto' });
  await ana.post('/semana_admin/1/repetir', { ...DIARIA('2026-12-01', '2026-12-05'), versao: 1 });
  await ana.put('/semana_admin/3', { feita: true, versao: 1 });
  await ana.put('/semana_admin/4', { texto: 'Outro', versao: 1 });
  banco.avisos.push({ tarefa_id: 5, usuario_codigo: 2, alarme: '2026-12-05 09:00:00', visto: 1, adiado: null });
  const r = await ana.del('/semana_admin/2', { versao: 1, escopo: 'proximos' });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual([r.corpo.serie.apagadas.sort(), r.corpo.serie.concluidas, r.corpo.serie.diferentes], [[2, 5], 1, 1]);
  assert.deepEqual(banco.admin.map(l => l.id), [1, 3, 4]);
  assert.equal(banco.avisos.length, 0);
  assert.equal((await ana.del('/semana_admin/1', { versao: 1, escopo: 'todos' })).status, 409, 'versão velha');
  assert.deepEqual(banco.admin.map(l => l.id), [1, 3, 4]);
  assert.equal((await ana.del('/semana_admin/1', { versao: 2, escopo: 'qualquer' })).status, 400);
});

test('compartilhada: série da pessoal nunca vale aqui (mesmo serie_id plantado); Notas tira da série', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/semana_admin', { quadro: 'dia', data: '2026-12-01', texto: 'Ponto' });
  const r = await ana.post('/semana_admin/1/repetir', { ...DIARIA('2026-12-01', '2026-12-02'), versao: 1 });
  const serie = r.corpo.linha.serieId;
  banco.pessoais.push({ id: 70, usuario_codigo: 1, quadro: 'dia', data: '2026-12-02', texto: 'Ponto', feita: 0, alarme: null, categoria_id: null, serie_id: serie, serie_pos: 2 });
  await ana.put('/semana_admin/1', { texto: 'Mudou', escopo: 'todos', versao: 2 });
  assert.equal(banco.pessoais[0].texto, 'Ponto');
  const n = await ana.put('/semana_admin/2', { quadro: 'notas', versao: 2 });
  assert.deepEqual([n.corpo.serieId, banco.admin[1].serie_id], [null, null]);
});

test('texto fora do log; falha do banco no meio da série = 500 só com o código e ROLLBACK', async t => {
  const { como, banco, logs } = await preparar(t);
  await como(1).post('/minha_semana', { quadro: 'dia', data: '2026-12-01', texto: 'TEXTO-PRIVADO' });
  const original = banco.f.execute;
  const falhar = async (sql, p) => { if (/^INSERT INTO web_tarefas \(usuario_codigo, quadro, data, texto, feita, criado_em, atualizado_em, categoria_unica_id, serie_id, serie_pos, hora_inicio, hora_fim\)/.test(sql)) { const e = new Error('TEXTO-PRIVADO dup'); e.code = 'ER_X'; throw e; } return original(sql, p); };
  pool.getConnection = async () => ({ execute: falhar, query: falhar, beginTransaction: async () => banco.f.chamadas.push({ sql: 'BEGIN' }), commit: async () => banco.f.chamadas.push({ sql: 'COMMIT' }), rollback: async () => banco.f.chamadas.push({ sql: 'ROLLBACK' }), release() {} });
  const r = await como(1).post('/minha_semana/1/repetir', DIARIA('2026-12-01', '2026-12-03'));
  assert.deepEqual([r.status, r.corpo], [500, { error: 'Erro de servidor' }]);
  assert.ok(banco.f.chamadas.some(c => c.sql === 'ROLLBACK'));
  assert.ok(logs.some(l => l.includes('ER_X')) && !logs.join('\n').includes('TEXTO-PRIVADO'));
  assert.ok(!banco.f.chamadas.some(c => /web_auditoria/.test(c.sql)));
});

test('sem token = 401 nas rotas de repetir', async t => {
  await preparar(t);
  const s = await subir(app);
  t.after(s.fechar);
  for (const c of ['/minha_semana/1/repetir', '/semana_admin/1/repetir'])
    assert.equal((await fetch(s.url + c, { method: 'POST' })).status, 401, c);
});

test('instalação: serie_id e serie_pos com índice, num ALTER só e só se faltar (MySQL real: idempotente)', async () => {
  const p = criarPoolFalso();
  await instalarTabelas(p);
  const alters = p.chamadas.map(c => c.sql).filter(s => /serie_id/.test(s) && /^ALTER/.test(s));
  assert.deepEqual(alters, [
    'ALTER TABLE web_tarefas ADD COLUMN serie_id CHAR(32) NULL, ADD COLUMN serie_pos SMALLINT NULL, ADD KEY ix_tarefas_serie (usuario_codigo, serie_id)',
    'ALTER TABLE web_tarefas_admin ADD COLUMN serie_id CHAR(32) NULL, ADD COLUMN serie_pos SMALLINT NULL, ADD KEY ix_tarefas_admin_serie (serie_id)'
  ]);
  const q = criarPoolFalso([[/information_schema\.COLUMNS .*COLUMN_NAME = 'serie_id'/, [{ n: 1 }]]]);
  await instalarTabelas(q);
  assert.ok(!q.chamadas.some(c => /ADD COLUMN serie_id/.test(c.sql)));
});
