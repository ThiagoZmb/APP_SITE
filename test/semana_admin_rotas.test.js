// Semana compartilhada: rotas/semana_admin.js, permissão tarefas_admin.usar. Banco simulado em memória.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { criarBancoSemana } = require('./apoio/bancoSemana');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { instalarTabelas, acrescentarPermissoesTarefasAdmin } = require('../seguranca/instalacao');
const { CATALOGO, PERFIS_INICIAIS, PERMISSOES_ADMINISTRATIVAS } = require('../seguranca/permissoes');
aceitarSidDeTeste(sessoes);

const SEMANA = '/semana_admin?inicio=2026-11-23';
const NOMES = { 1: 'Ana', 2: 'João', 3: 'Zé' };

async function preparar(t, { semPermissao = [3] } = {}) {
  const banco = criarBancoSemana();
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  acesso.limpar();
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: NOMES[id] || 'U' + id, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'X' },
    estados: [], ativo: true, permissoes: new Set(semPermissao.includes(id) ? [] : ['tarefas_admin.usar']) }));
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
    return { get: c => pedir('GET', c), post: (c, b) => pedir('POST', c, b), put: (c, b) => pedir('PUT', c, b), del: (c, b) => pedir('DELETE', c, b) };
  };
  return { banco, como, logs };
}

test('dois administradores veem e mexem na mesma linha; autoria e feitaPor vêm do login', async t => {
  const { como } = await preparar(t);
  const ana = como(1), joao = como(2);
  const r = await ana.post('/semana_admin', { quadro: 'dia', data: '2026-11-25', texto: ' Ligar\ncedo ', criadaPor: 'Outro', criada_por: 'Outro', criada_por_codigo: 99, feitaPor: 'Outro', versao: 40, feita: true });
  assert.equal(r.status, 201);
  assert.deepEqual(r.corpo, { id: 1, quadro: 'dia', data: '2026-11-25', texto: 'Ligar cedo', feita: false, alarme: null, versao: 1, criadaPor: 'Ana', feitaPor: null, categoriaId: null });
  assert.deepEqual((await joao.get(SEMANA)).corpo, { linhas: [r.corpo], categorias: [] });
  const marcada = await joao.put('/semana_admin/1', { feita: true, versao: 1, feitaPor: 'Impostor' });
  assert.equal(marcada.status, 200);
  assert.deepEqual([marcada.corpo.feita, marcada.corpo.feitaPor, marcada.corpo.criadaPor, marcada.corpo.versao], [true, 'João', 'Ana', 2]);
  const texto = await ana.put('/semana_admin/1', { texto: 'Ligar às 9', versao: 2 });
  assert.deepEqual([texto.corpo.texto, texto.corpo.feitaPor, texto.corpo.versao], ['Ligar às 9', 'João', 3], 'mudar o texto não troca quem concluiu');
  const aberta = await ana.put('/semana_admin/1', { feita: false, versao: 3 });
  assert.deepEqual([aberta.corpo.feita, aberta.corpo.feitaPor, aberta.corpo.versao], [false, null, 4]);
  assert.equal((await joao.del('/semana_admin/1', { versao: 4 })).status, 200);
  assert.deepEqual((await ana.get(SEMANA)).corpo, { linhas: [], categorias: [] });
});

test('sem tarefas_admin.usar: 403 nas quatro rotas, sem tocar no banco', async t => {
  const { como, banco } = await preparar(t);
  await como(1).post('/semana_admin', { quadro: 'tarefas', texto: 'segredo' });
  const antes = banco.f.chamadas.length;
  const ze = como(3);
  for (const r of [await ze.get(SEMANA), await ze.post('/semana_admin', { quadro: 'tarefas', texto: 'a' }),
    await ze.put('/semana_admin/1', { texto: 'b', versao: 1 }), await ze.del('/semana_admin/1', { versao: 1 })]) {
    assert.equal(r.status, 403);
    assert.ok(!JSON.stringify(r.corpo).includes('segredo'));
  }
  assert.equal(banco.f.chamadas.length, antes);
  assert.equal(banco.admin[0].texto, 'segredo');
});

test('versão velha: 409 com a linha atual, nada é gravado (PUT e DELETE); linha inexistente: 404', async t => {
  const { como, banco, logs } = await preparar(t);
  const ana = como(1), joao = como(2);
  await ana.post('/semana_admin', { quadro: 'tarefas', texto: 'TEXTO-RESERVADO' });
  await joao.put('/semana_admin/1', { texto: 'TEXTO-RESERVADO do João', versao: 1 });
  const antes = { ...banco.admin[0] };
  const r = await ana.put('/semana_admin/1', { texto: 'da Ana', feita: true, versao: 1 });
  assert.equal(r.status, 409);
  assert.ok(r.corpo.error);
  assert.deepEqual(r.corpo.atual, { id: 1, quadro: 'tarefas', data: null, texto: 'TEXTO-RESERVADO do João', feita: false, alarme: null, versao: 2, criadaPor: 'Ana', feitaPor: null, categoriaId: null });
  const d = await ana.del('/semana_admin/1', { versao: 1 });
  assert.equal(d.status, 409);
  assert.equal(d.corpo.atual.versao, 2);
  assert.deepEqual(banco.admin, [antes]);
  // a versão também pode vir na URL do DELETE
  assert.equal((await ana.del('/semana_admin/1?versao=1')).status, 409);
  assert.equal((await ana.del('/semana_admin/1?versao=2')).status, 200);
  assert.equal((await ana.put('/semana_admin/1', { texto: 'x', versao: 2 })).status, 404);
  assert.equal((await ana.del('/semana_admin/1', { versao: 2 })).status, 404);
  assert.ok(!logs.join('\n').includes('TEXTO-RESERVADO'));
  assert.ok(!banco.f.chamadas.some(c => /web_auditoria/.test(c.sql)));
  assert.ok(banco.f.chamadas.some(c => /^UPDATE web_tarefas_admin SET .*versao = versao \+ 1 WHERE id = \? AND versao = \?$/.test(c.sql)));
});

test('validação: mesmas regras da Minha semana, versão obrigatória, id inválido 404', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  for (const corpo of [{ quadro: 'x', texto: 'a' }, { quadro: 'dia', texto: 'a' }, { quadro: 'dia', data: '2026-02-30', texto: 'a' }, { quadro: 'tarefas', texto: ' ' }, { quadro: 'tarefas', texto: 'a'.repeat(301) }])
    assert.equal((await ana.post('/semana_admin', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal(banco.admin.length, 0);
  await ana.post('/semana_admin', { quadro: 'tarefas', texto: 'a' });
  for (const corpo of [{ texto: 'b' }, { texto: 'b', versao: 0 }, { texto: 'b', versao: '1' }, { versao: 1 }, { texto: '', versao: 1 }, { feita: 'sim', versao: 1 }])
    assert.equal((await ana.put('/semana_admin/1', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal((await ana.del('/semana_admin/1')).status, 400, 'excluir sem versão');
  for (const id of ['abc', '0', '1.5']) {
    assert.equal((await ana.put('/semana_admin/' + id, { feita: true, versao: 1 })).status, 404, id);
    assert.equal((await ana.del('/semana_admin/' + id, { versao: 1 })).status, 404, id);
  }
  for (const q of ['', '?inicio=ontem', '?inicio=2026-02-30'])
    assert.equal((await ana.get('/semana_admin' + q)).status, 400, q);
  assert.equal(banco.admin[0].versao, 1);
});

test('compartilhada e pessoal não se misturam', async t => {
  const { como, banco } = await preparar(t);
  const ana = como(1);
  await ana.post('/minha_semana', { quadro: 'tarefas', texto: 'só meu' });
  await ana.post('/semana_admin', { quadro: 'tarefas', texto: 'de todos' });
  assert.deepEqual((await ana.get(SEMANA)).corpo.linhas.map(l => l.texto), ['de todos']);
  assert.deepEqual((await ana.get('/minha_semana?inicio=2026-11-23')).corpo.linhas.map(l => l.texto), ['só meu']);
  for (const c of banco.f.chamadas) assert.ok(!(/\bweb_tarefas\b/.test(c.sql) && /\bweb_tarefas_admin\b/.test(c.sql)), c.sql);
});

test('falha do banco: 500, log só com rótulo e código', async t => {
  const { como, logs } = await preparar(t);
  const falha = async () => { const e = new Error('TEXTO-RESERVADO no erro'); e.code = 'ER_X'; throw e; };
  pool.execute = falha;
  pool.getConnection = async () => ({ execute: falha, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
  for (const r of [await como(1).post('/semana_admin', { quadro: 'tarefas', texto: 'TEXTO-RESERVADO' }),
    await como(1).put('/semana_admin/1', { texto: 'TEXTO-RESERVADO', versao: 1 }), await como(1).del('/semana_admin/1', { versao: 1 })])
    assert.deepEqual([r.status, r.corpo], [500, { error: 'Erro de servidor' }]);
  assert.ok(logs.some(l => l.includes('ER_X')));
  assert.ok(!logs.join('\n').includes('TEXTO-RESERVADO'));
});

test('permissão: no catálogo, só administrativa, só no perfil Administrador', () => {
  const p = CATALOGO.find(x => x.codigo === 'tarefas_admin.usar');
  assert.equal(p.nome, 'Semana compartilhada');
  assert.ok(p.descricao.length >= 15 && p.administrativa);
  assert.ok(PERMISSOES_ADMINISTRATIVAS.includes('tarefas_admin.usar'));
  for (const perfil of PERFIS_INICIAIS) assert.equal(perfil.permissoes.includes('tarefas_admin.usar'), perfil.nome === 'Administrador', perfil.nome);
});

test('migração: dá a permissão só ao Administrador, uma única vez, depois da chave administrativa', async () => {
  let marcado = false;
  const p = criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_tarefas_admin'/, () => (marcado ? [{ id: 1 }] : [])],
    [/FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]],
    [/^INSERT INTO web_auditoria/, () => { marcado = true; return { affectedRows: 1 }; }]
  ]);
  assert.deepEqual(await acrescentarPermissoesTarefasAdmin(p), { feito: true });
  assert.deepEqual(await acrescentarPermissoesTarefasAdmin(p), { feito: false });
  assert.deepEqual(p.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params), [[1, 'tarefas_admin.usar']]);
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.ok(fonte.indexOf('await acrescentarPermissoesTarefasAdmin(pool)') > fonte.indexOf('await acrescentarPermissoesAdministrativo(pool)'));
});

test('instalarTabelas cria web_tarefas_admin sem FK', async () => {
  const p = criarPoolFalso();
  await instalarTabelas(p);
  const ddl = p.chamadas.map(c => c.sql).find(s => s.includes('`web_tarefas_admin`'));
  assert.ok(ddl, 'DDL ausente');
  for (const trecho of ['id INT NOT NULL AUTO_INCREMENT PRIMARY KEY', "quadro ENUM('dia','tarefas','notas') NOT NULL", 'data DATE NULL', 'texto VARCHAR(300) NOT NULL',
    'feita TINYINT(1) NOT NULL DEFAULT 0', 'alarme DATETIME NULL', 'versao INT NOT NULL DEFAULT 1', 'criada_por_codigo INT NOT NULL', 'criada_por VARCHAR(100)',
    'feita_por VARCHAR(100) NULL', 'criado_em DATETIME NULL', 'atualizado_em DATETIME NULL', 'utf8mb4'])
    assert.ok(ddl.includes(trecho), trecho);
  assert.ok(!/FOREIGN KEY|REFERENCES/i.test(ddl));
});
