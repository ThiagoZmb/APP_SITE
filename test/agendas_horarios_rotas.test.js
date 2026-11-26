// Agendas: horário opcional dos itens dos dias nas rotas (rotas/minha_semana.js, rotas/semana_admin.js). Banco em memória.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarBancoSemana } = require('./apoio/bancoSemana');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
aceitarSidDeTeste(sessoes);

const NOMES = { 1: 'Ana', 2: 'João' };
const SEMANA = '?inicio=2026-11-23';
const H = (inicio, fim) => ({ inicio, fim });

async function preparar(t) {
  const banco = criarBancoSemana();
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  acesso.limpar();
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: NOMES[id] || 'U' + id, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'X' },
    estados: [], ativo: true, permissoes: new Set(['tarefas_admin.usar']) }));
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

// ---------- Minha semana ----------
test('pessoal: item novo com horário (só nos dias); a leitura devolve o horário; sem horário = dia todo', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  const a = await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'Fernanda', horario: H('09:30', '10:30') });
  assert.deepEqual([a.status, a.corpo.horario], [201, H('09:30', '10:30')]);
  assert.deepEqual([banco.pessoais[0].hora_inicio, banco.pessoais[0].hora_fim], [570, 630]);
  const b = await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'Extrato' });
  assert.equal(b.corpo.horario, null);
  for (const corpo of [{ quadro: 'tarefas', texto: 'x', horario: H('09:00', '10:00') }, { quadro: 'notas', texto: 'x', horario: H('09:00', '10:00') },
    { quadro: 'dia', data: '2026-11-24', texto: 'x', horario: H('10:00', '09:00') }, { quadro: 'dia', data: '2026-11-24', texto: 'x', horario: '09:00' },
    { quadro: 'dia', data: '2026-11-24', texto: 'x', horario: H('9:00', '10:00') }])
    assert.equal((await ana.post('/minha_semana', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal(banco.pessoais.length, 2, 'nada gravado nos recusados');
  const g = await ana.get('/minha_semana' + SEMANA);
  assert.deepEqual(g.corpo.linhas.map(l => [l.texto, l.horario]), [['Fernanda', H('09:30', '10:30')], ['Extrato', null]]);
});

test('pessoal: definir, mudar e tirar o horário; item de Tarefas não aceita; outra pessoa = 404', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'Mãe chega' });
  let r = await ana.put('/minha_semana/1', { horario: H('10:00', '11:00') });
  assert.deepEqual([r.status, r.corpo.horario, r.corpo.texto, r.corpo.data], [200, H('10:00', '11:00'), 'Mãe chega', '2026-11-24']);
  r = await ana.put('/minha_semana/1', { horario: H('10:15', '12:00') });
  assert.deepEqual(r.corpo.horario, H('10:15', '12:00'));
  r = await ana.put('/minha_semana/1', { horario: null });
  assert.deepEqual([r.status, r.corpo.horario, banco.pessoais[0].hora_inicio], [200, null, null]);
  assert.equal((await ana.put('/minha_semana/1', { horario: H('12:00', '11:00') })).status, 400);
  assert.equal((await como(2).put('/minha_semana/1', { horario: H('08:00', '09:00') })).status, 404);
  assert.equal(banco.pessoais[0].hora_inicio, null);
  await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'sem dia' });
  assert.equal((await ana.put('/minha_semana/2', { horario: H('08:00', '09:00') })).status, 400);
  assert.equal(banco.pessoais[1].hora_inicio, null);
});

test('pessoal: mover entre dias mantém o horário (ou troca, se vier junto); ir para Tarefas ou Notas tira', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'Reunião', horario: H('14:00', '15:30') });
  let r = await ana.put('/minha_semana/1', { quadro: 'dia', data: '2026-11-26' });
  assert.deepEqual([r.corpo.data, r.corpo.horario], ['2026-11-26', H('14:00', '15:30')]);
  r = await ana.put('/minha_semana/1', { quadro: 'dia', data: '2026-11-27', horario: H('08:00', '09:30') });
  assert.deepEqual([r.corpo.data, r.corpo.horario], ['2026-11-27', H('08:00', '09:30')]);
  r = await ana.put('/minha_semana/1', { quadro: 'dia', data: '2026-11-27', horario: null });
  assert.equal(r.corpo.horario, null, 'de volta ao dia todo');
  await ana.put('/minha_semana/1', { horario: H('08:00', '09:00') });
  r = await ana.put('/minha_semana/1', { quadro: 'tarefas' });
  assert.deepEqual([r.corpo.quadro, r.corpo.horario, banco.pessoais[0].hora_inicio, banco.pessoais[0].hora_fim], ['tarefas', null, null, null]);
  assert.equal((await ana.put('/minha_semana/1', { quadro: 'notas', horario: H('08:00', '09:00') })).status, 400);
  await ana.put('/minha_semana/1', { quadro: 'dia', data: '2026-11-24', horario: H('08:00', '09:00') });
  r = await ana.put('/minha_semana/1', { quadro: 'notas' });
  assert.deepEqual([r.corpo.quadro, r.corpo.horario], ['notas', null]);
});

test('pessoal: repetir leva o horário às cópias; mudar o horário de um item da série vale só para ele; escopo não aceita horário', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'Ponto', horario: H('08:00', '08:30') });
  const rep = await ana.post('/minha_semana/1/repetir', { tipo: 'diaria', de: '2026-11-24', ate: '2026-11-26' });
  assert.equal(rep.status, 201);
  assert.deepEqual(rep.corpo.linhas.map(l => l.horario), [H('08:00', '08:30'), H('08:00', '08:30'), H('08:00', '08:30')]);
  const r = await ana.put('/minha_semana/2', { horario: H('09:00', '09:30') });
  assert.deepEqual(r.corpo.horario, H('09:00', '09:30'));
  assert.deepEqual(banco.pessoais.map(l => l.hora_inicio), [480, 540, 480]);
  assert.equal((await ana.put('/minha_semana/1', { horario: H('10:00', '11:00'), escopo: 'todos' })).status, 400);
  assert.deepEqual(banco.pessoais.map(l => l.hora_inicio), [480, 540, 480]);
});

// ---------- Semana compartilhada ----------
test('compartilhada: horário no item novo; mudar leva a versão; versão velha = 409 com o atual (e o horário dele); nada por cima', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1), joao = como(2);
  const a = await ana.post('/semana_admin', { quadro: 'dia', data: '2026-11-24', texto: 'Visita', horario: H('09:00', '10:00') });
  assert.deepEqual([a.status, a.corpo.horario, a.corpo.versao], [201, H('09:00', '10:00'), 1]);
  let r = await joao.put('/semana_admin/1', { horario: H('11:00', '12:00'), versao: 1 });
  assert.deepEqual([r.status, r.corpo.horario, r.corpo.versao], [200, H('11:00', '12:00'), 2]);
  r = await ana.put('/semana_admin/1', { horario: H('15:00', '16:00'), versao: 1 });
  assert.equal(r.status, 409);
  assert.deepEqual([r.corpo.atual.horario, r.corpo.atual.versao], [H('11:00', '12:00'), 2]);
  assert.deepEqual([banco.admin[0].hora_inicio, banco.admin[0].hora_fim], [660, 720]);
  assert.equal((await ana.put('/semana_admin/1', { horario: H('15:00', '16:00') })).status, 400, 'sem versão');
  r = await ana.put('/semana_admin/1', { quadro: 'dia', data: '2026-11-26', horario: null, versao: 2 });
  assert.deepEqual([r.corpo.data, r.corpo.horario, r.corpo.versao], ['2026-11-26', null, 3]);
  await ana.post('/semana_admin', { quadro: 'tarefas', texto: 'lista' });
  assert.equal((await ana.put('/semana_admin/2', { horario: H('08:00', '09:00'), versao: 1 })).status, 400);
  assert.equal((await ana.post('/semana_admin', { quadro: 'notas', texto: 'x', horario: H('08:00', '09:00') })).status, 400);
});

test('compartilhada: ir para Tarefas tira o horário; repetir leva o horário; série não muda horário junto', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/semana_admin', { quadro: 'dia', data: '2026-11-24', texto: 'Backup', horario: H('18:00', '18:30') });
  const rep = await ana.post('/semana_admin/1/repetir', { tipo: 'diaria', de: '2026-11-24', ate: '2026-11-25', versao: 1 });
  assert.deepEqual(rep.corpo.linhas.map(l => [l.data, l.horario]), [['2026-11-24', H('18:00', '18:30')], ['2026-11-25', H('18:00', '18:30')]]);
  assert.equal((await ana.put('/semana_admin/1', { horario: H('19:00', '20:00'), escopo: 'todos', versao: 2 })).status, 400);
  const r = await ana.put('/semana_admin/2', { quadro: 'tarefas', versao: 1 });
  assert.deepEqual([r.corpo.quadro, r.corpo.horario, r.corpo.versao], ['tarefas', null, 2]);
  assert.deepEqual(banco.admin.map(l => l.hora_inicio), [1080, null]);
});

test('horário: texto fora do log nos erros (falha do banco = 500 só com o código)', async t => {
  const { como, logs } = await preparar(t);
  const falha = async () => { const e = new Error('TEXTO-PRIVADO no erro'); e.code = 'ER_X'; throw e; };
  pool.execute = falha;
  pool.getConnection = async () => ({ execute: falha, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
  const r = await como(1).post('/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'TEXTO-PRIVADO', horario: H('09:00', '10:00') });
  assert.deepEqual([r.status, r.corpo], [500, { error: 'Erro de servidor' }]);
  const s = await como(1).put('/semana_admin/1', { horario: H('09:00', '10:00'), versao: 1 });
  assert.equal(s.status, 500);
  assert.ok(!logs.join('\n').includes('TEXTO-PRIVADO'));
});
