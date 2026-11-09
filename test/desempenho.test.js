// Medidor de desempenho (desempenho/medidor.js): tempo por rota, nº de consultas e tempo no banco, log só das lentas e resumo
// por hora. Sem banco real: pool falso com relógio controlado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { criarMedidor } = require('../desempenho/medidor');

// relógio manual: cada "esperar(ms)" avança o tempo
function relogio() { let t = 1000; return { agora: () => t, passa: ms => { t += ms; } }; }

// pool falso: cada consulta "demora" `custo` ms no relógio e devolve [linhas, campos], como o mysql2/promise
function poolFalso(rel, custo = 10) {
  const conn = { async execute(sql) { rel.passa(custo); return [[{ sql }], []]; }, async query(sql) { rel.passa(custo); return [[{ sql }], []]; }, release() {} };
  return {
    conn,
    async execute(sql, params) { rel.passa(custo); if (/FALHA/.test(sql)) throw Object.assign(new Error('ruim'), { code: 'ER_X' }); return [[{ sql, params }], []]; },
    async query(sql) { rel.passa(custo); return [[{ sql }], []]; },
    async getConnection() { return conn; }
  };
}

// uma "requisição" completa: o middleware chama o handler dentro do contexto, e depois a resposta termina
async function requisitar(medidor, { metodo = 'GET', rota = '/dados_lista', status = 200, handler }) {
  const req = { method: metodo, baseUrl: '', route: rota ? { path: rota } : undefined };
  const res = new EventEmitter(); res.statusCode = status;
  await new Promise((fim, erro) => medidor.middleware(req, res, () => { Promise.resolve(handler()).then(fim, erro); }));
  res.emit('finish');
}

test('pool instrumentado devolve o mesmo resultado e propaga o erro; consultas contam dentro da requisição', async () => {
  const rel = relogio(), linhas = [];
  const m = criarMedidor({ agora: rel.agora, log: l => linhas.push(l), limiteLentoMs: 0 });
  const pool = poolFalso(rel); m.instrumentarPool(pool);
  const [r] = await pool.execute('SELECT 1', [7]);   // fora de requisição: funciona e não conta em lugar nenhum
  assert.deepEqual(r, [{ sql: 'SELECT 1', params: [7] }]);
  await requisitar(m, { handler: async () => {
    await pool.execute('SELECT A', []); await pool.query('SELECT B');
    await assert.rejects(pool.execute('SELECT FALHA', []), /ruim/);
  } });
  assert.match(linhas[0], /^\[perf\] GET \/dados_lista 200 30ms q=3 db=30ms$/);
});

test('getConnection: as consultas da transação contam; instrumentar duas vezes não conta em dobro', async () => {
  const rel = relogio(), linhas = [];
  const m = criarMedidor({ agora: rel.agora, log: l => linhas.push(l), limiteLentoMs: 0 });
  const pool = poolFalso(rel); m.instrumentarPool(pool); m.instrumentarPool(pool);
  await requisitar(m, { metodo: 'POST', rota: '/ped_orc/salvar', handler: async () => {
    const c1 = await pool.getConnection(); await c1.execute('INSERT A'); c1.release();
    const c2 = await pool.getConnection(); await c2.query('UPDATE B'); await c2.execute('UPDATE C'); c2.release();
  } });
  assert.match(linhas[0], /^\[perf\] POST \/ped_orc\/salvar 200 30ms q=3 db=30ms$/);
});

test('só registra requisição lenta (limite em ms) ou com muitas consultas; a rápida só entra no resumo', async () => {
  const rel = relogio(), linhas = [];
  const m = criarMedidor({ agora: rel.agora, log: l => linhas.push(l), limiteLentoMs: 400, limiteConsultas: 5 });
  const pool = poolFalso(rel, 10); m.instrumentarPool(pool);
  await requisitar(m, { rota: '/rapida', handler: async () => { await pool.execute('SELECT 1'); } });
  assert.equal(linhas.length, 0);
  await requisitar(m, { rota: '/lenta', handler: async () => { rel.passa(500); } });
  assert.equal(linhas.length, 1); assert.match(linhas[0], /GET \/lenta 200 500ms q=0 db=0ms/);
  await requisitar(m, { rota: '/muitas', handler: async () => { for (let i = 0; i < 6; i++) await pool.execute('SELECT 1'); } });
  assert.equal(linhas.length, 2); assert.match(linhas[1], /GET \/muitas 200 60ms q=6 db=60ms/);
});

test('o log nunca leva o SQL, os parâmetros nem o endereço com valores (só o padrão da rota)', async () => {
  const rel = relogio(), linhas = [];
  const m = criarMedidor({ agora: rel.agora, log: l => linhas.push(l), limiteLentoMs: 0 });
  const pool = poolFalso(rel); m.instrumentarPool(pool);
  const req = { method: 'GET', baseUrl: '', url: '/clientes/ACME%20LTDA?token=segredo', originalUrl: '/clientes/ACME%20LTDA?token=segredo', route: { path: '/clientes/:razao' } };
  const res = new EventEmitter(); res.statusCode = 200;
  await new Promise(ok => m.middleware(req, res, () => { pool.execute('SELECT SENHA FROM x WHERE a = ?', ['valor-sigiloso']).then(ok); }));
  res.emit('finish');
  assert.equal(linhas.length, 1);
  assert.match(linhas[0], /GET \/clientes\/:razao 200/);
  for (const proibido of ['SELECT', 'SENHA', 'valor-sigiloso', 'ACME', 'segredo', 'token']) assert.ok(!linhas[0].includes(proibido), proibido);
});

test('rota sem correspondência (404, arquivo estático) vira "(sem rota)" e nunca o caminho real', async () => {
  const rel = relogio(), linhas = [];
  const m = criarMedidor({ agora: rel.agora, log: l => linhas.push(l), limiteLentoMs: 0 });
  await requisitar(m, { rota: null, status: 404, handler: async () => {} });
  assert.match(linhas[0], /^\[perf\] GET \(sem rota\) 404 0ms q=0 db=0ms$/);
});

test('resumo: agrupa por rota, ordena pelo tempo total e limparResumo zera', async () => {
  const rel = relogio();
  const m = criarMedidor({ agora: rel.agora, log: () => {}, limiteLentoMs: 99999 });
  const pool = poolFalso(rel, 10); m.instrumentarPool(pool);
  await requisitar(m, { rota: '/a', handler: async () => { await pool.execute('SELECT 1'); } });
  await requisitar(m, { rota: '/a', handler: async () => { await pool.execute('SELECT 1'); await pool.execute('SELECT 2'); rel.passa(70); } });
  await requisitar(m, { rota: '/b', handler: async () => { rel.passa(5); } });
  const r = m.resumo();
  assert.deepEqual(r.map(x => x.rota), ['GET /a', 'GET /b']);
  assert.deepEqual([r[0].n, r[0].mediaMs, r[0].maxMs, r[0].mediaConsultas, r[0].mediaDbMs], [2, 50, 90, 1.5, 15]);
  assert.deepEqual([r[1].n, r[1].mediaMs, r[1].mediaConsultas], [1, 5, 0]);
  assert.match(m.linhasDoResumo(1)[0], /GET \/a .* 2 req .* média 50ms .* máx 90ms .* 1\.5 consultas .* 15ms no banco/);
  m.limparResumo();
  assert.deepEqual(m.resumo(), []);
});

test('ida e volta ao banco: mediana de N "SELECT 1" medidos no relógio', async () => {
  const rel = relogio();
  const m = criarMedidor({ agora: rel.agora, log: () => {} });
  const custos = [30, 25, 90, 26, 27]; let i = 0;
  const pool = { async query() { rel.passa(custos[i++]); return [[{ 1: 1 }], []]; } };
  const r = await m.medirIdaEVolta(pool, 5);
  assert.deepEqual([r.medianaMs, r.minMs, r.maxMs, r.amostras], [27, 25, 90, 5]);
});

test('uma requisição que falha (resposta 500) também é medida; nada vaza entre requisições', async () => {
  const rel = relogio(), linhas = [];
  const m = criarMedidor({ agora: rel.agora, log: l => linhas.push(l), limiteLentoMs: 0 });
  const pool = poolFalso(rel); m.instrumentarPool(pool);
  await Promise.all([
    requisitar(m, { rota: '/x', status: 500, handler: async () => { await pool.execute('A'); await pool.execute('B'); } }),
    requisitar(m, { rota: '/y', handler: async () => { await pool.execute('C'); } })
  ]);
  const x = linhas.find(l => /GET \/x 500/.test(l)), y = linhas.find(l => /GET \/y 200/.test(l));
  assert.match(x, /q=2/); assert.match(y, /q=1/);
});
