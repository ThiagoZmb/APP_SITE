// Agendas: categorias com cores e mover itens (rotas/minha_semana.js, rotas/semana_admin.js). Banco em memória (test/apoio/bancoSemana.js).
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
const { CORES, validarCategoria, chaveNome, validarMudanca } = require('../calculo/minha_semana');
aceitarSidDeTeste(sessoes);

const NOMES = { 1: 'Ana', 2: 'João', 3: 'Zé' };
const SEMANA = '?inicio=2026-11-23';

async function preparar(t, { semPermissao = [3] } = {}) {
  const banco = criarBancoSemana();
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  acesso.limpar();
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: NOMES[id] || 'U' + id, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'X' },
    estados: [], ativo: true, permissoes: new Set(semPermissao.includes(id) ? [] : ['tarefas_admin.usar']) }));
  const logs = [];
  t.mock.method(console, 'warn', (...a) => logs.push(a.join(' ')));
  t.mock.method(console, 'error', (...a) => logs.push(a.join(' ')));
  t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
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

// ---------- funções puras ----------
test('paleta: 10 cores fixas; nome de 1 a 30 caracteres, uma linha; repetição ignora maiúsculas e acentos', () => {
  assert.deepEqual(CORES, ['vermelho', 'laranja', 'amarelo', 'lima', 'verde', 'turquesa', 'azul', 'lavanda', 'roxo', 'rosa']);
  assert.deepEqual(validarCategoria({ nome: '  Banco \n do   Brasil ', cor: 'azul' }), { ok: true, valor: { nome: 'Banco do Brasil', cor: 'azul' } });
  assert.equal(validarCategoria({ nome: 'a'.repeat(30), cor: 'rosa' }).ok, true);
  for (const c of [{ nome: '', cor: 'azul' }, { nome: '   ', cor: 'azul' }, { nome: 'a'.repeat(31), cor: 'azul' }, { nome: 5, cor: 'azul' }, { nome: 'x', cor: '#ff0000' }, { nome: 'x' }, { cor: 'azul' }, null])
    assert.equal(validarCategoria(c).ok, false, JSON.stringify(c));
  assert.deepEqual(validarCategoria({ cor: 'verde' }, { parcial: true }), { ok: true, valor: { cor: 'verde' } });
  assert.equal(validarCategoria({}, { parcial: true }).ok, false);
  assert.equal(chaveNome('Médico'), chaveNome('MEDICO'));
  assert.notEqual(chaveNome('Médico'), chaveNome('Médica'));
});

test('validarMudanca: mover exige quadro (e data no dia); categoria é número ou null; Notas sem concluído e sem alarme', () => {
  assert.deepEqual(validarMudanca({ quadro: 'dia', data: '2026-11-27' }), { ok: true, valor: { quadro: 'dia', data: '2026-11-27' } });
  assert.deepEqual(validarMudanca({ quadro: 'tarefas', data: '2026-11-27' }), { ok: true, valor: { quadro: 'tarefas', data: null } });
  assert.deepEqual(validarMudanca({ categoriaId: null }), { ok: true, valor: { categoriaId: null } });
  assert.deepEqual(validarMudanca({ categoriaId: 4 }), { ok: true, valor: { categoriaId: 4 } });
  for (const c of [{ quadro: 'x' }, { quadro: 'dia' }, { quadro: 'dia', data: '2026-02-30' }, { data: '2026-11-27' }, { categoriaId: '4' }, { categoriaId: 0 }, { categoriaId: 1.5 },
    { categoriaId: 2 ** 31 }, { quadro: 'notas', feita: true }, { quadro: 'notas', alarme: '2026-11-27 10:00' }])
    assert.equal(validarMudanca(c).ok, false, JSON.stringify(c));
});

// ---------- categorias da Minha semana ----------
test('pessoal: cria, lista (por nome), renomeia, troca a cor; o GET da semana traz as categorias', async t => {
  const { como } = await preparar(t);
  const ana = como(1);
  const a = await ana.post('/minha_semana/categorias', { nome: 'Médico', cor: 'rosa', usuario_codigo: 2 });
  assert.deepEqual([a.status, a.corpo], [201, { id: 1, nome: 'Médico', cor: 'rosa' }]);
  const b = await ana.post('/minha_semana/categorias', { nome: 'Banco', cor: 'azul' });
  assert.equal(b.status, 201);
  assert.deepEqual((await ana.get('/minha_semana/categorias')).corpo, { categorias: [{ id: 2, nome: 'Banco', cor: 'azul' }, { id: 1, nome: 'Médico', cor: 'rosa' }] });
  const r = await ana.put('/minha_semana/categorias/1', { nome: 'Saúde' });
  assert.deepEqual([r.status, r.corpo], [200, { id: 1, nome: 'Saúde', cor: 'rosa' }]);
  assert.deepEqual((await ana.put('/minha_semana/categorias/1', { cor: 'verde' })).corpo, { id: 1, nome: 'Saúde', cor: 'verde' });
  const g = await ana.get('/minha_semana' + SEMANA);
  assert.deepEqual(g.corpo.categorias.map(c => c.nome), ['Banco', 'Saúde']);
  assert.deepEqual(g.corpo.linhas, []);
});

test('pessoal: nome repetido (maiúsculas/acentos) = 409; inválido = 400; limite de 30 categorias', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana/categorias', { nome: 'Médico', cor: 'rosa' });
  assert.equal((await ana.post('/minha_semana/categorias', { nome: 'MEDICO', cor: 'azul' })).status, 409);
  await ana.post('/minha_semana/categorias', { nome: 'Banco', cor: 'azul' });
  assert.equal((await ana.put('/minha_semana/categorias/2', { nome: 'médico' })).status, 409);
  assert.equal((await ana.put('/minha_semana/categorias/2', { nome: 'Banco' })).status, 200, 'o próprio nome não é repetição');
  assert.equal((await como(2).post('/minha_semana/categorias', { nome: 'Médico', cor: 'rosa' })).status, 201, 'outra pessoa pode ter o mesmo nome');
  for (const c of [{ nome: '', cor: 'azul' }, { nome: 'x', cor: 'preto' }, { nome: 'a'.repeat(31), cor: 'azul' }])
    assert.equal((await ana.post('/minha_semana/categorias', c)).status, 400, JSON.stringify(c));
  assert.equal((await ana.put('/minha_semana/categorias/2', {})).status, 400);
  for (let i = banco.catPessoais.filter(c => c.usuario_codigo === 1).length; i < 30; i++)
    assert.equal((await ana.post('/minha_semana/categorias', { nome: 'C' + i, cor: 'lima' })).status, 201);
  assert.equal((await ana.post('/minha_semana/categorias', { nome: 'Mais uma', cor: 'lima' })).status, 400);
});

test('pessoal: categoria de outra pessoa = 404 (ver, mudar, excluir); nem o administrador vê', async t => {
  const { como, banco } = await preparar(t);
  await como(1).post('/minha_semana/categorias', { nome: 'Segredo', cor: 'roxo' });
  const joao = como(2);
  assert.deepEqual((await joao.get('/minha_semana/categorias')).corpo, { categorias: [] });
  assert.equal((await joao.put('/minha_semana/categorias/1', { nome: 'Invadi' })).status, 404);
  assert.equal((await joao.del('/minha_semana/categorias/1')).status, 404);
  assert.deepEqual(banco.catPessoais.map(c => [c.nome, c.usuario_codigo]), [['Segredo', 1]]);
  for (const id of ['abc', '0', '1.5'])
    assert.equal((await joao.put('/minha_semana/categorias/' + id, { cor: 'azul' })).status, 404, id);
});

test('pessoal: categoriaId de outro dono ou da compartilhada é recusado no POST e no PUT, nada gravado', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1), joao = como(2);
  await joao.post('/minha_semana/categorias', { nome: 'Do João', cor: 'azul' });   // id 1 (pessoal do João)
  await ana.post('/semana_admin/categorias', { nome: 'Compartilhada', cor: 'verde' });   // id 1 (compartilhada)
  await ana.post('/minha_semana/categorias', { nome: 'Minha', cor: 'rosa' });   // id 2
  assert.equal((await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'x', categoriaId: 1 })).status, 400);
  assert.equal(banco.pessoais.length, 0);
  const ok = await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'x', categoriaId: 2 });
  assert.deepEqual([ok.status, ok.corpo.categoriaId], [201, 2]);
  const r = await ana.put('/minha_semana/1', { categoriaId: 1 });
  assert.equal(r.status, 400);
  assert.equal(banco.pessoais[0].categoria_id, 2);
  assert.equal((await ana.put('/minha_semana/1', { categoriaId: 99, texto: 'mudou?' })).status, 400);
  assert.equal(banco.pessoais[0].texto, 'x', 'nada do PUT recusado é gravado');
  assert.deepEqual((await ana.put('/minha_semana/1', { categoriaId: null })).corpo.categoriaId, null);
});

test('pessoal: excluir a categoria deixa os itens "Sem categoria" (nunca apaga item); itens de outra pessoa intocados', async t => {
  const { como, banco, logs } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana/categorias', { nome: 'NOME-PRIVADO', cor: 'azul' });
  await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'a', categoriaId: 1 });
  await ana.post('/minha_semana', { quadro: 'notas', texto: 'b', categoriaId: 1 });
  banco.pessoais.push({ id: 50, usuario_codigo: 2, quadro: 'notas', data: null, texto: 'alheia', feita: 0, alarme: null, categoria_id: 1 });
  const r = await ana.del('/minha_semana/categorias/1');
  assert.deepEqual([r.status, r.corpo], [200, { ok: true }]);
  assert.deepEqual(banco.pessoais.map(l => [l.id, l.categoria_id]), [[1, null], [2, null], [50, 1]]);
  assert.equal(banco.catPessoais.length, 0);
  assert.equal((await ana.del('/minha_semana/categorias/1')).status, 404);
  const g = await ana.get('/minha_semana' + SEMANA);
  assert.deepEqual(g.corpo.linhas.map(l => [l.texto, l.categoriaId]), [['a', null], ['b', null]]);
  assert.ok(banco.f.chamadas.some(c => c.sql === 'BEGIN') && banco.f.chamadas.some(c => c.sql === 'COMMIT'), 'numa transação');
  assert.ok(!logs.join('\n').includes('NOME-PRIVADO'));
  assert.ok(!banco.f.chamadas.some(c => /web_auditoria/.test(c.sql)));
});

test('pessoal: categoria que sumiu no meio do caminho aparece como "Sem categoria" na leitura', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'a' });
  banco.pessoais[0].categoria_id = 77;
  assert.equal((await ana.get('/minha_semana' + SEMANA)).corpo.linhas[0].categoriaId, null);
});

// ---------- mover na Minha semana ----------
test('pessoal: mover entre dias e Tarefas não muda texto, concluído, categoria nem alarme; outra pessoa não move', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana/categorias', { nome: 'Banco', cor: 'azul' });
  await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'pagar', categoriaId: 1 });
  Object.assign(banco.pessoais[0], { feita: 1, alarme: '2026-11-24 10:00:00' });
  let r = await ana.put('/minha_semana/1', { quadro: 'dia', data: '2026-11-27' });
  assert.deepEqual([r.status, r.corpo.quadro, r.corpo.data, r.corpo.texto, r.corpo.feita, r.corpo.categoriaId], [200, 'dia', '2026-11-27', 'pagar', true, 1]);
  assert.equal(banco.pessoais[0].alarme, '2026-11-24 10:00:00', 'o alarme gravado não muda');
  r = await ana.put('/minha_semana/1', { quadro: 'tarefas', data: '2026-11-27' });
  assert.deepEqual([r.corpo.quadro, r.corpo.data, r.corpo.feita], ['tarefas', null, true]);
  assert.equal((await como(2).put('/minha_semana/1', { quadro: 'notas' })).status, 404);
  assert.equal(banco.pessoais[0].quadro, 'tarefas');
});

test('pessoal: ir para Notas tira o concluído e o alarme (e o "já vi")', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'x' });
  Object.assign(banco.pessoais[0], { feita: 1, alarme: '2026-11-24 10:00:00', alarme_visto: '2026-11-24 10:00:00', alarme_adiado: '2026-11-24 10:10:00' });
  const r = await ana.put('/minha_semana/1', { quadro: 'notas' });
  assert.deepEqual([r.status, r.corpo.quadro, r.corpo.data, r.corpo.feita, r.corpo.alarme], [200, 'notas', null, false, null]);
  assert.deepEqual([banco.pessoais[0].feita, banco.pessoais[0].alarme, banco.pessoais[0].alarme_visto, banco.pessoais[0].alarme_adiado], [0, null, null, null]);
  assert.equal((await ana.put('/minha_semana/1', { quadro: 'notas', feita: true })).status, 400);
});

// ---------- categorias e mover na Semana compartilhada ----------
test('compartilhada: lista única; quem tem a permissão cria, renomeia, troca a cor e exclui; sem ela 403 sem tocar no banco', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1), joao = como(2), ze = como(3);
  const a = await ana.post('/semana_admin/categorias', { nome: 'Entregas', cor: 'laranja' });
  assert.deepEqual([a.status, a.corpo], [201, { id: 1, nome: 'Entregas', cor: 'laranja' }]);
  assert.deepEqual((await joao.get('/semana_admin/categorias')).corpo.categorias, [{ id: 1, nome: 'Entregas', cor: 'laranja' }]);
  assert.deepEqual((await joao.put('/semana_admin/categorias/1', { nome: 'Fretes', cor: 'amarelo' })).corpo, { id: 1, nome: 'Fretes', cor: 'amarelo' });
  assert.equal((await joao.post('/semana_admin/categorias', { nome: 'fretes', cor: 'azul' })).status, 409);
  assert.deepEqual((await ana.get('/semana_admin' + SEMANA)).corpo.categorias.map(c => c.nome), ['Fretes']);
  const antes = banco.f.chamadas.length;
  for (const r of [await ze.get('/semana_admin/categorias'), await ze.post('/semana_admin/categorias', { nome: 'x', cor: 'azul' }),
    await ze.put('/semana_admin/categorias/1', { cor: 'azul' }), await ze.del('/semana_admin/categorias/1')]) {
    assert.equal(r.status, 403);
    assert.ok(!JSON.stringify(r.corpo).includes('Fretes'));
  }
  assert.equal(banco.f.chamadas.length, antes);
  assert.equal((await ana.put('/semana_admin/categorias/9', { cor: 'azul' })).status, 404);
});

test('compartilhada: categoria pessoal nunca vale aqui; excluir deixa os itens sem categoria, sem mudar a versão', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana/categorias', { nome: 'Pessoal', cor: 'rosa' });   // pessoal id 1
  assert.equal((await ana.post('/semana_admin', { quadro: 'tarefas', texto: 'x', categoriaId: 1 })).status, 400);
  await ana.post('/semana_admin/categorias', { nome: 'Geral', cor: 'azul' });   // compartilhada id 1
  await ana.post('/semana_admin/categorias', { nome: 'Outra', cor: 'verde' });   // compartilhada id 2
  const l = await ana.post('/semana_admin', { quadro: 'tarefas', texto: 'x', categoriaId: 1 });
  assert.deepEqual([l.status, l.corpo.categoriaId], [201, 1]);
  assert.equal((await ana.put('/semana_admin/1', { categoriaId: 2, versao: 1 })).corpo.versao, 2);
  assert.equal((await ana.put('/semana_admin/1', { categoriaId: 5, versao: 2 })).status, 400);
  // a pessoal não aceita categoria da compartilhada
  await ana.post('/minha_semana', { quadro: 'notas', texto: 'p' });
  assert.equal((await ana.put('/minha_semana/1', { categoriaId: 2 })).status, 400);
  assert.equal((await ana.del('/semana_admin/categorias/2')).status, 200);
  assert.deepEqual([banco.admin[0].categoria_id, banco.admin[0].versao, banco.admin[0].texto], [null, 2, 'x']);
});

test('compartilhada: mover leva a versão; versão velha = 409 com o atual e nada gravado; ir para Notas zera concluído, alarme e avisos', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1), joao = como(2);
  await ana.post('/semana_admin', { quadro: 'dia', data: '2026-11-24', texto: 'ligar' });
  let r = await joao.put('/semana_admin/1', { quadro: 'dia', data: '2026-11-26', versao: 1 });
  assert.deepEqual([r.status, r.corpo.data, r.corpo.versao, r.corpo.texto], [200, '2026-11-26', 2, 'ligar']);
  r = await ana.put('/semana_admin/1', { quadro: 'tarefas', versao: 1 });
  assert.equal(r.status, 409);
  assert.deepEqual([r.corpo.atual.quadro, r.corpo.atual.data, r.corpo.atual.versao], ['dia', '2026-11-26', 2]);
  assert.equal(banco.admin[0].quadro, 'dia');
  assert.equal((await ana.put('/semana_admin/1', { quadro: 'tarefas' })).status, 400, 'sem versão');
  Object.assign(banco.admin[0], { feita: 1, feita_por: 'João', alarme: '2026-11-26 09:00:00' });
  banco.avisos.push({ tarefa_id: 1, usuario_codigo: 2, alarme: '2026-11-26 09:00:00', visto: 1, adiado: null });
  r = await ana.put('/semana_admin/1', { quadro: 'notas', versao: 2 });
  assert.deepEqual([r.status, r.corpo.quadro, r.corpo.data, r.corpo.feita, r.corpo.feitaPor, r.corpo.alarme, r.corpo.versao], [200, 'notas', null, false, null, null, 3]);
  assert.equal(banco.avisos.length, 0);
  assert.equal((await ana.put('/semana_admin/1', { alarme: '2026-11-26 09:00', versao: 3 })).status, 400, 'nota não tem alarme');
});

test('categorias: texto do nome fora do log, falha do banco = 500 só com código', async t => {
  const { como, logs } = await preparar(t);
  const falha = async () => { const e = new Error('NOME-PRIVADO no erro'); e.code = 'ER_X'; throw e; };
  pool.execute = falha;
  pool.getConnection = async () => ({ execute: falha, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
  for (const base of ['/minha_semana/categorias', '/semana_admin/categorias']) {
    for (const r of [await como(1).post(base, { nome: 'NOME-PRIVADO', cor: 'azul' }), await como(1).put(base + '/1', { nome: 'NOME-PRIVADO' }), await como(1).del(base + '/1'), await como(1).get(base)])
      assert.deepEqual([r.status, r.corpo], [500, { error: 'Erro de servidor' }]);
  }
  assert.ok(logs.some(l => l.includes('ER_X')));
  assert.ok(!logs.join('\n').includes('NOME-PRIVADO'));
});

test('sem token = 401 nas rotas de categoria', async t => {
  const { como } = await preparar(t);
  const s = await subir(app);
  t.after(s.fechar);
  for (const [m, c] of [['GET', '/minha_semana/categorias'], ['POST', '/minha_semana/categorias'], ['PUT', '/minha_semana/categorias/1'], ['DELETE', '/minha_semana/categorias/1'],
    ['GET', '/semana_admin/categorias'], ['POST', '/semana_admin/categorias'], ['PUT', '/semana_admin/categorias/1'], ['DELETE', '/semana_admin/categorias/1']])
    assert.equal((await fetch(s.url + c, { method: m })).status, 401, m + ' ' + c);
  assert.ok(como);
});

// ---------- instalação (MySQL real: idempotente, sem palavra reservada, sem FK) ----------
test('instalação: tabelas de categorias (utf8mb4, nome único por lista, sem FK) e categoria_id só se faltar', async () => {
  const p = criarPoolFalso();
  await instalarTabelas(p);
  const sqls = p.chamadas.map(c => c.sql);
  const pessoal = sqls.find(s => s.includes('`web_tarefas_categorias`'));
  const admin = sqls.find(s => s.includes('`web_tarefas_admin_categorias`'));
  assert.ok(pessoal && admin);
  for (const t of ['CREATE TABLE IF NOT EXISTS', 'id INT NOT NULL AUTO_INCREMENT PRIMARY KEY', 'usuario_codigo INT NOT NULL', 'nome VARCHAR(30) NOT NULL', 'cor VARCHAR(20) NOT NULL', 'UNIQUE KEY uk_tarefas_cat_nome (usuario_codigo, nome)', 'utf8mb4'])
    assert.ok(pessoal.includes(t), t);
  for (const t of ['CREATE TABLE IF NOT EXISTS', 'nome VARCHAR(30) NOT NULL', 'cor VARCHAR(20) NOT NULL', 'criado_por_codigo INT NULL', 'UNIQUE KEY uk_tarefas_admin_cat_nome (nome)', 'utf8mb4'])
    assert.ok(admin.includes(t), t);
  for (const ddl of [pessoal, admin]) assert.ok(!/FOREIGN KEY|REFERENCES/i.test(ddl));
  // sem a coluna: acrescenta, uma vez para cada tabela
  assert.deepEqual(sqls.filter(s => /categoria_id/.test(s) && /^ALTER/.test(s)), ['ALTER TABLE web_tarefas ADD COLUMN categoria_id INT NULL', 'ALTER TABLE web_tarefas_admin ADD COLUMN categoria_id INT NULL']);
  // com a coluna já existente (segunda subida): nenhum ALTER de categoria_id
  const q = criarPoolFalso([[/information_schema\.COLUMNS .*COLUMN_NAME = 'categoria_id'/, [{ n: 1 }]]]);
  await instalarTabelas(q);
  assert.ok(!q.chamadas.some(c => /ADD COLUMN categoria_id/.test(c.sql)));
  assert.ok(q.chamadas.filter(c => /COLUMN_NAME = 'categoria_id'/.test(c.sql)).every(c => /TABLE_NAME = 'web_tarefas(_admin)?'/.test(c.sql)));
});
