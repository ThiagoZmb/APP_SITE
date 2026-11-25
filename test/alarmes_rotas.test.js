// Alarmes das duas semanas: calculo/alarmes.js, PUT com `alarme`, GET /alarmes, OK e Adiar. Banco simulado em memória.
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
const { validarAlarme } = require('../calculo/alarmes');
aceitarSidDeTeste(sessoes);

const A1 = '2026-11-25 14:30';
const A2 = '2026-11-26 09:00';
const NOMES = { 1: 'Ana', 2: 'João', 3: 'Zé' };

async function preparar(t) {
  const banco = criarBancoSemana();
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  acesso.limpar();
  const comPermissao = new Set([1, 2]);   // 3 = sem tarefas_admin.usar
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: NOMES[id], cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'X' },
    estados: [], ativo: true, permissoes: new Set(comPermissao.has(id) ? ['tarefas_admin.usar'] : []) }));
  const logs = [];
  t.mock.method(console, 'warn', (...a) => logs.push(a.join(' ')));
  t.mock.method(console, 'error', (...a) => logs.push(a.join(' ')));
  const s = await subir(app);
  t.after(s.fechar);
  const como = id => {
    const cab = { Authorization: 'Bearer ' + jwt.sign({ id, nome: 'x', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' }), 'Content-Type': 'application/json' };
    const pedir = async (metodo, caminho, corpo) => {
      const r = await fetch(s.url + caminho, { method: metodo, headers: cab, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      return { status: r.status, corpo: await r.json().catch(() => ({})) };
    };
    const alarmes = async () => (await pedir('GET', '/alarmes')).corpo.alarmes;
    return { get: c => pedir('GET', c), post: (c, b) => pedir('POST', c, b), put: (c, b) => pedir('PUT', c, b), del: (c, b) => pedir('DELETE', c, b), alarmes };
  };
  return { banco, como, logs, comPermissao };
}

test('validarAlarme: só AAAA-MM-DD HH:MM que exista', () => {
  for (const s of [A1, '2028-02-29 00:00', '2026-12-31 23:59']) assert.equal(validarAlarme(s), true, s);
  for (const s of ['2026-02-29 10:00', '2026-11-25 24:00', '2026-11-25 10:60', '2026-11-25T10:00', '2026-11-25 10:00:00', '2026-11-25', '25/11/2026 10:00', ' 2026-11-25 10:00', '', null, undefined, 1, ['2026-11-25 10:00']])
    assert.equal(validarAlarme(s), false, String(s));
});

test('PUT das duas páginas grava e remove o alarme; notas não têm; linha devolve alarme', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  const p = await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'p', alarme: A1 });
  assert.equal(p.corpo.alarme, null, 'linha nova: o alarme vem depois, por PUT');
  await ana.post('/semana_admin', { quadro: 'dia', data: '2026-11-25', texto: 'a' });
  let r = await ana.put('/minha_semana/1', { alarme: A1 });
  assert.deepEqual([r.status, r.corpo.alarme, r.corpo.texto], [200, A1, 'p']);
  assert.equal((await ana.get('/minha_semana?inicio=2026-11-23')).corpo.linhas[0].alarme, A1);
  r = await ana.put('/semana_admin/1', { alarme: A1, versao: 1 });
  assert.deepEqual([r.status, r.corpo.alarme, r.corpo.versao], [200, A1, 2]);
  assert.equal((await ana.put('/minha_semana/1', { alarme: null })).corpo.alarme, null);
  assert.equal((await ana.put('/semana_admin/1', { alarme: null, versao: 2 })).corpo.alarme, null);

  await ana.post('/minha_semana', { quadro: 'notas', texto: 'n' });
  await ana.post('/semana_admin', { quadro: 'notas', texto: 'n' });
  assert.equal((await ana.put('/minha_semana/2', { alarme: A1 })).status, 400);
  assert.equal((await ana.put('/semana_admin/2', { alarme: A1, versao: 1 })).status, 400);
  assert.equal((await ana.put('/minha_semana/2', { alarme: null })).status, 200);
  for (const ruim of ['ontem', '2026-11-25', 5, '']) {
    assert.equal((await ana.put('/minha_semana/1', { alarme: ruim })).status, 400, String(ruim));
    assert.equal((await ana.put('/semana_admin/1', { alarme: ruim, versao: 3 })).status, 400, String(ruim));
  }
  assert.equal((await como(2).put('/minha_semana/1', { alarme: A1 })).status, 404, 'linha pessoal de outro');
  assert.equal(banco.pessoais[1].alarme, null);
});

test('GET /alarmes: só não feitas, com alarme; pessoal só do dono; compartilhado só com a permissão; o servidor não compara horários', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1), joao = como(2), ze = como(3);
  await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'meu futuro' });
  await ana.put('/minha_semana/1', { alarme: '2099-01-01 10:00' });
  await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'sem alarme' });
  await ana.post('/semana_admin', { quadro: 'tarefas', texto: 'de todos' });
  await ana.put('/semana_admin/1', { alarme: A1, versao: 1 });
  await ze.post('/minha_semana', { quadro: 'tarefas', texto: 'do Zé' });
  await ze.put('/minha_semana/3', { alarme: A2 });

  const eu = await ana.get('/alarmes');
  assert.equal(eu.status, 200);
  assert.deepEqual(eu.corpo, { alarmes: [
    { origem: 'pessoal', id: 1, texto: 'meu futuro', alarme: '2099-01-01 10:00', quando: '2099-01-01 10:00' },
    { origem: 'admin', id: 1, texto: 'de todos', alarme: A1, quando: A1 }
  ] });
  assert.deepEqual((await joao.alarmes()).map(a => a.origem + a.id), ['admin1']);
  const antes = banco.f.chamadas.length;
  assert.deepEqual((await ze.alarmes()).map(a => a.texto), ['do Zé']);
  assert.ok(!banco.f.chamadas.slice(antes).some(c => /web_tarefas_admin/.test(c.sql)), 'sem a permissão nem consulta a compartilhada');

  await ana.put('/minha_semana/1', { feita: true });
  await ana.put('/semana_admin/1', { feita: true, versao: 2 });
  assert.deepEqual(await ana.alarmes(), [], 'concluída não toca');
  await ana.put('/semana_admin/1', { feita: false, versao: 3 });
  assert.equal((await ana.alarmes()).length, 1);
  await ana.del('/semana_admin/1', { versao: 4 });
  assert.deepEqual(await joao.alarmes(), [], 'apagada não toca');
});

test('OK e Adiar: pessoal; alarme diferente = 409; de outro usuário = 404; trocar o alarme depois do OK volta a tocar', async t => {
  const { como, banco, logs } = await preparar(t);
  const ana = como(1), joao = como(2);
  await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'TEXTO-RESERVADO' });
  await ana.put('/minha_semana/1', { alarme: A1 });
  assert.equal((await joao.post('/alarmes/pessoal/1/ok', { alarme: A1 })).status, 404);
  assert.equal((await joao.post('/alarmes/pessoal/1/adiar', { alarme: A1, ate: A2 })).status, 404);
  assert.equal((await ana.post('/alarmes/pessoal/1/ok', { alarme: A2 })).status, 409);
  assert.equal((await ana.post('/alarmes/pessoal/1/adiar', { alarme: A2, ate: A1 })).status, 409);
  assert.equal(banco.pessoais[0].alarme_visto, null);

  let r = await ana.post('/alarmes/pessoal/1/adiar', { alarme: A1, ate: '2026-11-25 14:40' });
  assert.deepEqual([r.status, r.corpo], [200, { ok: true }]);
  assert.deepEqual(await ana.alarmes(), [{ origem: 'pessoal', id: 1, texto: 'TEXTO-RESERVADO', alarme: A1, quando: '2026-11-25 14:40' }]);
  assert.equal(banco.pessoais[0].alarme.slice(0, 16), A1, 'adiar não altera o alarme');

  assert.equal((await ana.post('/alarmes/pessoal/1/ok', { alarme: A1 })).status, 200);
  assert.deepEqual(await ana.alarmes(), []);
  assert.equal((await ana.post('/alarmes/pessoal/1/adiar', { alarme: A1, ate: A2 })).status, 200);
  assert.deepEqual(await ana.alarmes(), [], 'adiar numa aba atrasada não desfaz o OK');
  await ana.put('/minha_semana/1', { texto: 'TEXTO-RESERVADO 2' });
  assert.deepEqual(await ana.alarmes(), [], 'mudar o texto não faz tocar de novo');

  await ana.put('/minha_semana/1', { alarme: A2 });
  assert.deepEqual((await ana.alarmes()).map(a => [a.alarme, a.quando]), [[A2, A2]], 'alarme trocado volta a tocar, sem o adiamento antigo');
  await ana.post('/alarmes/pessoal/1/ok', { alarme: A2 });
  await ana.put('/minha_semana/1', { alarme: A1 });
  assert.equal((await ana.alarmes()).length, 1, 'mesmo voltando a um horário já visto');
  assert.ok(!logs.join('\n').includes('TEXTO-RESERVADO'));
});

test('OK e Adiar: compartilhado vale só para quem clicou; sem permissão = 403; trocar o alarme volta a tocar para todos', async t => {
  const { como, banco, comPermissao } = await preparar(t);
  const ana = como(1), joao = como(2), ze = como(3);
  await ana.post('/semana_admin', { quadro: 'tarefas', texto: 'reunião' });
  await ana.put('/semana_admin/1', { alarme: A1, versao: 1 });
  assert.equal((await ze.post('/alarmes/admin/1/ok', { alarme: A1 })).status, 403);
  assert.equal((await ze.post('/alarmes/admin/1/adiar', { alarme: A1, ate: A2 })).status, 403);
  assert.equal(banco.avisos.length, 0);

  assert.equal((await ana.post('/alarmes/admin/1/ok', { alarme: A1 })).status, 200);
  assert.deepEqual(await ana.alarmes(), []);
  assert.equal((await joao.alarmes()).length, 1);
  assert.equal((await joao.post('/alarmes/admin/1/adiar', { alarme: A1, ate: '2026-11-25 14:40' })).status, 200);
  assert.deepEqual((await joao.alarmes()).map(a => [a.alarme, a.quando]), [[A1, '2026-11-25 14:40']]);
  assert.equal(banco.admin[0].alarme.slice(0, 16), A1, 'adiar não altera o alarme dos outros');
  assert.equal(banco.admin[0].versao, 2, 'nem a versão da linha');
  assert.equal((await ana.post('/alarmes/admin/1/adiar', { alarme: A1, ate: A2 })).status, 200);
  assert.deepEqual(await ana.alarmes(), [], 'adiar numa aba atrasada não desfaz o OK');

  // mudar texto não mexe nos avisos; trocar o alarme apaga e volta a tocar para os dois
  await ana.put('/semana_admin/1', { texto: 'reunião 2', versao: 2 });
  assert.deepEqual(await ana.alarmes(), []);
  await joao.put('/semana_admin/1', { alarme: A2, versao: 3 });
  for (const quem of [ana, joao]) assert.deepEqual((await quem.alarmes()).map(a => [a.alarme, a.quando]), [[A2, A2]]);
  assert.equal((await ana.post('/alarmes/admin/1/ok', { alarme: A1 })).status, 409, 'janela antiga não confirma o alarme novo');

  await ana.post('/alarmes/admin/1/ok', { alarme: A2 });
  comPermissao.delete(2);
  acesso.limpar();
  assert.deepEqual(await joao.alarmes(), [], 'perdeu a permissão: nenhum alarme compartilhado');
  await ana.del('/semana_admin/1', { versao: 4 });
  assert.equal(banco.avisos.length, 0, 'apagar a tarefa apaga os avisos');
  assert.equal((await ana.post('/alarmes/admin/1/ok', { alarme: A2 })).status, 404);
});

test('OK/Adiar: corpo e endereço inválidos', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'p' });
  assert.equal((await ana.post('/alarmes/pessoal/1/ok', { alarme: A1 })).status, 409, 'sem alarme na linha');
  await ana.put('/minha_semana/1', { alarme: A1 });
  for (const corpo of [{}, { alarme: 'x' }, { alarme: null }]) assert.equal((await ana.post('/alarmes/pessoal/1/ok', corpo)).status, 400, JSON.stringify(corpo));
  for (const corpo of [{ alarme: A1 }, { alarme: A1, ate: 'x' }, { alarme: A1, ate: '2026-11-25' }]) assert.equal((await ana.post('/alarmes/pessoal/1/adiar', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal((await ana.post('/alarmes/outra/1/ok', { alarme: A1 })).status, 404);
  assert.equal((await ana.post('/alarmes/pessoal/abc/ok', { alarme: A1 })).status, 404);
  assert.equal((await ana.post('/alarmes/admin/99/ok', { alarme: A1 })).status, 404);
  assert.equal(banco.pessoais[0].alarme_visto, null);
});

test('falha do banco: 500 sem texto no log', async t => {
  const { como, logs } = await preparar(t);
  pool.execute = async () => { const e = new Error('TEXTO-RESERVADO'); e.code = 'ER_X'; throw e; };
  for (const r of [await como(1).get('/alarmes'), await como(1).post('/alarmes/pessoal/1/ok', { alarme: A1 })])
    assert.deepEqual([r.status, r.corpo], [500, { error: 'Erro de servidor' }]);
  assert.ok(logs.some(l => l.includes('ER_X')));
  assert.ok(!logs.join('\n').includes('TEXTO-RESERVADO'));
});

test('instalarTabelas acrescenta as colunas do alarme em web_tarefas só se faltarem e cria a tabela de avisos', async () => {
  const faltando = criarPoolFalso();
  await instalarTabelas(faltando);
  const alters = faltando.chamadas.map(c => c.sql).filter(s => /^ALTER TABLE web_tarefas /.test(s));
  assert.deepEqual(alters, [
    'ALTER TABLE web_tarefas ADD COLUMN alarme DATETIME NULL',
    'ALTER TABLE web_tarefas ADD COLUMN alarme_visto DATETIME NULL',
    'ALTER TABLE web_tarefas ADD COLUMN alarme_adiado DATETIME NULL'
  ]);
  const ddl = faltando.chamadas.map(c => c.sql).find(s => s.includes('`web_tarefas_admin_avisos`'));
  for (const trecho of ['tarefa_id INT NOT NULL', 'usuario_codigo INT NOT NULL', 'alarme DATETIME NOT NULL', 'visto TINYINT', 'adiado DATETIME NULL', 'PRIMARY KEY (tarefa_id, usuario_codigo)'])
    assert.ok(ddl.includes(trecho), trecho);
  assert.ok(!/FOREIGN KEY|REFERENCES/i.test(ddl));

  const prontas = criarPoolFalso([[/TABLE_NAME = 'web_tarefas'/, [{ n: 1 }]]]);
  await instalarTabelas(prontas);
  assert.ok(!prontas.chamadas.some(c => /^ALTER TABLE web_tarefas /.test(c.sql)));
});
