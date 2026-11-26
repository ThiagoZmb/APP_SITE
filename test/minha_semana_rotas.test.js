// Minha semana: caderno pessoal de tarefas (rotas/minha_semana.js, calculo/minha_semana.js, web_tarefas). Banco simulado em memória.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { instalarTabelas } = require('../seguranca/instalacao');
const { validarData, diasDaSemana, validarNova, validarMudanca } = require('../calculo/minha_semana');
aceitarSidDeTeste(sessoes);

const SEMANA = '/minha_semana?inicio=2026-11-23';

// o banco falso obedece ao usuario_codigo dos parâmetros: se a rota não filtrasse, o teste de isolamento falharia
function bancoTarefas() {
  const linhas = [];
  let proximo = 1;
  const achar = (id, usuario) => linhas.find(l => l.id === Number(id) && l.usuario_codigo === usuario);
  const publica = l => ({ id: l.id, quadro: l.quadro, data: l.data, texto: l.texto, feita: l.feita });
  const f = criarPoolFalso([
    [/^INSERT INTO web_tarefas/, (sql, [usuario_codigo, quadro, data, texto]) => {
      const id = proximo++;
      linhas.push({ id, usuario_codigo, quadro, data, texto, feita: 0 });
      return { insertId: id, affectedRows: 1 };
    }],
    [/^SELECT .* FROM web_tarefas WHERE usuario_codigo = \? AND \(quadro/, (sql, [usuario, de, ate]) =>
      linhas.filter(l => l.usuario_codigo === usuario && (l.quadro !== 'dia' || (l.data >= de && l.data <= ate))).map(publica)],
    [/^SELECT .* FROM web_tarefas WHERE id = \? AND usuario_codigo = \?/, (sql, [id, usuario]) => { const l = achar(id, usuario); return l ? [publica(l)] : []; }],
    [/^UPDATE web_tarefas SET /, (sql, params) => {
      assert.match(sql, /WHERE id = \? AND usuario_codigo = \?$/);
      const [id, usuario] = params.slice(-2);
      const l = achar(id, usuario);
      if (!l) return { affectedRows: 0 };
      const colunas = sql.slice('UPDATE web_tarefas SET '.length, sql.indexOf(' WHERE')).split(', ').map(c => c.split(' = ')[0]);
      colunas.forEach((c, i) => { l[c] = params[i]; });
      return { affectedRows: 1 };
    }],
    [/^DELETE FROM web_tarefas WHERE id = \? AND usuario_codigo = \?/, (sql, [id, usuario]) => {
      const l = achar(id, usuario);
      if (!l) return { affectedRows: 0 };
      linhas.splice(linhas.indexOf(l), 1);
      return { affectedRows: 1 };
    }]
  ]);
  return { linhas, f };
}

async function preparar(t, { permissoes = {} } = {}) {
  const banco = bancoTarefas();
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  acesso.limpar();
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'U' + id, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'X' },
    estados: [], ativo: true, permissoes: new Set(permissoes[id] || []) }));
  const logs = [];
  t.mock.method(console, 'warn', (...a) => logs.push(a.join(' ')));
  t.mock.method(console, 'error', (...a) => logs.push(a.join(' ')));
  const s = await subir(app);
  t.after(s.fechar);
  const como = id => {
    const cab = { Authorization: 'Bearer ' + jwt.sign({ id, nome: 'U' + id, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' }), 'Content-Type': 'application/json' };
    const pedir = async (metodo, caminho, corpo) => {
      const r = await fetch(s.url + caminho, { method: metodo, headers: cab, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      return { status: r.status, corpo: await r.json().catch(() => ({})) };
    };
    return { get: c => pedir('GET', c), post: (c, b) => pedir('POST', c, b), put: (c, b) => pedir('PUT', c, b), del: c => pedir('DELETE', c) };
  };
  return { banco, como, url: s.url, logs };
}

const TEXTO = '<b> "x" \u{1F600}';

test('usuário sem nenhuma permissão cria e lê a própria linha', async t => {
  const { como } = await preparar(t);
  const eu = como(7);
  const r = await eu.post('/minha_semana', { quadro: 'dia', data: '2026-11-25', texto: TEXTO });
  assert.equal(r.status, 201);
  assert.deepEqual(r.corpo, { id: 1, quadro: 'dia', data: '2026-11-25', texto: TEXTO, feita: false, alarme: null, categoriaId: null, serieId: null, seriePos: null });
  const g = await eu.get(SEMANA);
  assert.equal(g.status, 200);
  assert.deepEqual(g.corpo, { linhas: [r.corpo], categorias: [] });
  assert.equal(g.corpo.linhas[0].feita, false);
});

test('GET traz só os dias da semana, mais todas de tarefas e notas', async t => {
  const { como, banco } = await preparar(t);
  const eu = como(7);
  for (const [quadro, data, texto] of [['dia', '2026-11-22', 'antes'], ['dia', '2026-11-23', 'segunda'], ['dia', '2026-11-29', 'domingo'], ['dia', '2026-11-30', 'depois'], ['tarefas', null, 't'], ['notas', null, 'n']])
    assert.equal((await eu.post('/minha_semana', { quadro, data, texto })).status, 201);
  const g = await eu.get(SEMANA);
  assert.deepEqual(g.corpo.linhas.map(l => l.texto), ['segunda', 'domingo', 't', 'n']);
  const sql = banco.f.chamadas.find(c => /FROM web_tarefas WHERE usuario_codigo = \? AND \(quadro/.test(c.sql));
  assert.deepEqual(sql.params, [7, '2026-11-23', '2026-11-29']);
  assert.match(sql.sql, /ORDER BY id$/);
});

test('PUT altera texto e marca; DELETE exclui a própria linha', async t => {
  const { como, banco } = await preparar(t);
  const eu = como(7);
  await eu.post('/minha_semana', { quadro: 'tarefas', texto: 'a' });
  let r = await eu.put('/minha_semana/1', { texto: '  linha\r\nde baixo  ' });
  assert.deepEqual([r.status, r.corpo.texto, r.corpo.feita], [200, 'linha de baixo', false]);
  r = await eu.put('/minha_semana/1', { feita: true });
  assert.deepEqual([r.status, r.corpo.texto, r.corpo.feita], [200, 'linha de baixo', true]);
  r = await eu.put('/minha_semana/1', { feita: false });
  assert.equal(r.corpo.feita, false);
  r = await eu.del('/minha_semana/1');
  assert.deepEqual([r.status, r.corpo], [200, { ok: true }]);
  assert.equal(banco.linhas.length, 0);
  assert.equal((await eu.del('/minha_semana/1')).status, 404);
});

test('outro usuário não vê, não altera e não exclui, nem sendo administrador', async t => {
  const { como, banco } = await preparar(t, { permissoes: { 8: ['administrativo.ver', 'admin.usuarios', 'valores.ver'] } });
  await como(7).post('/minha_semana', { quadro: 'tarefas', texto: 'segredo' });
  const outro = como(8);
  assert.deepEqual((await outro.get(SEMANA)).corpo, { linhas: [], categorias: [] });
  assert.equal((await outro.put('/minha_semana/1', { texto: 'invadi' })).status, 404);
  assert.equal((await outro.put('/minha_semana/1', { feita: true })).status, 404);
  assert.equal((await outro.del('/minha_semana/1')).status, 404);
  assert.deepEqual(banco.linhas, [{ id: 1, usuario_codigo: 7, quadro: 'tarefas', data: null, texto: 'segredo', feita: 0 }]);
});

test('todo SELECT, UPDATE e DELETE filtra por usuario_codigo; texto não vai para auditoria nem log', async t => {
  const { como, banco, logs } = await preparar(t);
  const eu = como(7);
  await eu.post('/minha_semana', { quadro: 'tarefas', texto: 'TEXTO-PRIVADO' });
  await eu.put('/minha_semana/1', { texto: 'TEXTO-PRIVADO 2' });
  await eu.get(SEMANA);
  await eu.del('/minha_semana/1');
  const sqls = banco.f.chamadas.filter(c => /web_tarefas/.test(c.sql));
  for (const c of sqls) if (!/^INSERT/.test(c.sql)) assert.match(c.sql, /usuario_codigo = \?/, c.sql);
  assert.ok(!banco.f.chamadas.some(c => /web_auditoria/.test(c.sql)));
  assert.ok(!logs.join('\n').includes('TEXTO-PRIVADO'));
});

test('falha do banco: 500 sem vazar texto, log só com rótulo e código', async t => {
  const { como, logs } = await preparar(t);
  pool.execute = async () => { const e = new Error('TEXTO-PRIVADO no erro do banco'); e.code = 'ER_X'; throw e; };
  const r = await como(7).post('/minha_semana', { quadro: 'tarefas', texto: 'TEXTO-PRIVADO' });
  assert.deepEqual([r.status, r.corpo], [500, { error: 'Erro de servidor' }]);
  assert.ok(logs.some(l => l.includes('ER_X')));
  assert.ok(!logs.join('\n').includes('TEXTO-PRIVADO'));
});

test('usuario do corpo ou da URL é ignorado', async t => {
  const { como, banco } = await preparar(t);
  const r = await como(7).post('/minha_semana?usuario_codigo=8', { quadro: 'tarefas', texto: 'a', usuario_codigo: 8, usuario: 8 });
  assert.equal(r.status, 201);
  assert.equal(banco.linhas[0].usuario_codigo, 7);
  assert.deepEqual((await como(8).get(SEMANA + '&usuario_codigo=7')).corpo, { linhas: [], categorias: [] });
});

test('recusa 400 o que não vale; id inválido é 404', async t => {
  const { como, banco } = await preparar(t);
  const eu = como(7);
  const ruins = [
    { quadro: 'x', texto: 'a' },
    { texto: 'a' },
    { quadro: 'dia', texto: 'a' },
    { quadro: 'dia', data: '2026-02-30', texto: 'a' },
    { quadro: 'dia', data: ['2026-02-20'], texto: 'a' },
    { quadro: 'tarefas', texto: '' },
    { quadro: 'tarefas', texto: '  \n ' },
    { quadro: 'tarefas', texto: 5 },
    { quadro: 'tarefas', texto: 'a'.repeat(301) }
  ];
  for (const corpo of ruins) {
    const r = await eu.post('/minha_semana', corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.ok(r.corpo.error);
  }
  assert.equal(banco.linhas.length, 0);
  assert.equal((await eu.post('/minha_semana', { quadro: 'tarefas', texto: 'a'.repeat(300) })).status, 201);
  const comData = await eu.post('/minha_semana', { quadro: 'tarefas', data: '2026-11-25', texto: 'b' });
  assert.deepEqual([comData.status, comData.corpo.data], [201, null]);
  assert.equal(banco.linhas[1].data, null);

  // mover exige quadro válido (e data no dia): agendas_categorias_rotas.test.js
  for (const corpo of [{}, { feita: 'sim' }, { feita: 1 }, { texto: '' }, { texto: 'a'.repeat(301) }, { quadro: 'x' }, { quadro: 'dia' }, { data: '2026-11-25' }])
    assert.equal((await eu.put('/minha_semana/1', corpo)).status, 400, JSON.stringify(corpo));
  for (const q of ['', '?inicio=', '?inicio=ontem', '?inicio=2026-02-30', '?inicio=2026-11-23&inicio=2026-11-30'])
    assert.equal((await eu.get('/minha_semana' + q)).status, 400, q);
  for (const id of ['abc', '0', '1.5', '99999999999']) {
    assert.equal((await eu.put('/minha_semana/' + id, { feita: true })).status, 404, id);
    assert.equal((await eu.del('/minha_semana/' + id)).status, 404, id);
  }
});

test('semana cruzando o ano e o mês; datas reais; validações puras', () => {
  assert.deepEqual(diasDaSemana('2026-12-28'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.equal(diasDaSemana('2028-02-28')[1], '2028-02-29');
  assert.equal(validarData('2028-02-29'), true);
  for (const s of ['2026-02-29', '2026-13-01', '2026-1-1', '', null, undefined, 20261125]) assert.equal(validarData(s), false, String(s));
  assert.deepEqual(validarNova({ quadro: 'notas', texto: ' a\nb ' }), { ok: true, valor: { quadro: 'notas', data: null, texto: 'a b', categoriaId: null } });
  assert.equal(validarNova(undefined).ok, false);
  assert.deepEqual(validarMudanca({ feita: false }), { ok: true, valor: { feita: false } });
  assert.equal(validarMudanca(null).ok, false);
});

test('resposta não perde campo na rede de valores (usuário sem valores.ver)', async t => {
  const { como, logs } = await preparar(t);
  const eu = como(7);
  await eu.post('/minha_semana', { quadro: 'dia', data: '2026-11-25', texto: 'a' });
  const g = await eu.get(SEMANA);
  assert.deepEqual(Object.keys(g.corpo.linhas[0]), ['id', 'quadro', 'data', 'texto', 'feita', 'alarme', 'categoriaId', 'serieId', 'seriePos']);
  assert.ok(!logs.some(l => l.includes('[valores]')));
});

test('sem token → 401', async t => {
  const { url } = await preparar(t);
  for (const [metodo, caminho] of [['GET', SEMANA], ['POST', '/minha_semana'], ['PUT', '/minha_semana/1'], ['DELETE', '/minha_semana/1']])
    assert.equal((await fetch(url + caminho, { method: metodo })).status, 401, metodo);
});

test('instalarTabelas cria web_tarefas (utf8mb4, índice por usuário), sem FK e sem mexer em tabela do VB', async () => {
  const p = criarPoolFalso();
  await instalarTabelas(p);
  const ddl = p.chamadas.map(c => c.sql).find(s => s.includes('`web_tarefas`'));
  assert.ok(ddl, 'DDL web_tarefas ausente');
  for (const trecho of ['id INT NOT NULL AUTO_INCREMENT PRIMARY KEY', 'usuario_codigo INT NOT NULL', "quadro ENUM('dia','tarefas','notas') NOT NULL", 'data DATE NULL',
    'texto VARCHAR(300) NOT NULL', 'feita TINYINT(1) NOT NULL DEFAULT 0', 'criado_em DATETIME NULL', 'atualizado_em DATETIME NULL', 'KEY ix_tarefas_usuario (usuario_codigo, quadro, data)', 'utf8mb4'])
    assert.ok(ddl.includes(trecho), trecho);
  assert.ok(!/FOREIGN KEY|REFERENCES/i.test(ddl));
});
