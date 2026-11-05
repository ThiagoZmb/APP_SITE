// Rotas do calendário de pedidos (GET /calendario/pedidos e /calendario/dia) com pool falso. Datas de 2020 (passado) e 2099 (futuro)
// para o atraso não depender do dia em que o teste roda.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes, registro } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
aceitarSidDeTeste(sessoes);

const USUARIOS = {
  1: { nome: 'Admin', permissoes: new Set(['pedidos.ver', 'valores.ver']), estados: [] },
  2: { nome: 'Sem valores', permissoes: new Set(['pedidos.ver']), estados: [] },
  3: { nome: 'Sem pedidos', permissoes: new Set(['estoque.ver', 'valores.ver']), estados: [] },
  4: { nome: 'Regional', permissoes: new Set(['pedidos.ver', 'valores.ver']), estados: ['RJ', 'ES'] }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

const L = (numero, situacao, pronto, extra = {}) => ({ numero, cliente: 'Cliente ' + numero, cliente_final: '', situacao, valor: '250.00', pronto_em: pronto, data_entrega: null, ...extra });
const LINHAS = [
  L(10, 'Em Produção', '2020-03-10'),      // atrasado
  L(11, 'Pronto', '2020-03-10'),           // pronto: não atrasa
  L(12, 'Entregue', '2020-03-10'),         // fora de "abertos"
  L(13, 'Cancelado', '2020-03-11'),        // fora de "abertos"
  L(14, 'Em Produção', '2099-03-12')       // futuro
];

async function preparar(t, linhas = LINHAS) {
  const f = criarPoolFalso([[/FROM ped_orc p/, linhas]]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => {
    const u = USUARIOS[id];
    return u && { codigo: id, nome: u.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id, nome: 'P' + id }, estados: u.estados, ativo: true, permissoes: u.permissoes };
  });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho) => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token(id) } });
  return { f, chamar };
}
const consultas = f => f.chamadas.filter(c => /FROM ped_orc p/.test(c.sql));

test('as duas rotas estão no registro, são GET e o servidor sobe (registro.verificar)', () => {
  const rotas = registro.rotasAutenticadas().filter(r => r.caminho.startsWith('/calendario/'));
  assert.deepEqual(rotas.map(r => `${r.metodo} ${r.caminho}`).sort(), ['get /calendario/dia', 'get /calendario/pedidos']);
  assert.doesNotThrow(() => registro.verificar());
});

test('sem pedidos.ver: 403 nas duas rotas e nenhuma consulta ao banco', async t => {
  const { f, chamar } = await preparar(t);
  assert.equal((await chamar(3, '/calendario/pedidos?mes=2020-03')).status, 403);
  assert.equal((await chamar(3, '/calendario/dia?data=2020-03-10')).status, 403);
  assert.equal(consultas(f).length, 0);
});

test('parâmetros inválidos: 400 sem consultar o banco', async t => {
  const { f, chamar } = await preparar(t);
  for (const q of ['', '?mes=2020-13', '?mes=2020-3', '?mes=lixo', '?mes=2020-03&situacao=x', '?mes=2020-03&situacao=Todos']) {
    const r = await chamar(1, '/calendario/pedidos' + q);
    assert.equal(r.status, 400, q);
    assert.ok((await r.json()).error);
  }
  for (const q of ['', '?data=2027-02-29', '?data=2020-04-31', '?data=10/03/2020', '?data=2020-03-10&situacao=nada']) assert.equal((await chamar(1, '/calendario/dia' + q)).status, 400, q);
  assert.equal(consultas(f).length, 0);
});

test('mês: SQL só do tipo Pedido, intervalo do mês (virada de ano) e agrupado por dia; abertos é o padrão', async t => {
  const { f, chamar } = await preparar(t);
  const r = await chamar(1, '/calendario/pedidos?mes=2020-12');
  assert.equal(r.status, 200);
  assert.equal(consultas(f).length, 1, 'uma consulta só (sem N+1)');
  const q = consultas(f)[0];
  assert.match(q.sql, /p\.TIPO = 'Pedido'/);
  assert.match(q.sql, /p\.DATA_PRONTO >= \? AND p\.DATA_PRONTO < \?/);
  assert.deepEqual(q.params, ['2020-12-01', '2021-01-01']);
  const d = await r.json();
  assert.equal(d.mes, '2020-12');
  assert.equal(d.situacao, 'abertos');
  assert.deepEqual(d.dias.map(x => [x.data, x.pedidos.map(p => p.numero), x.qtdPedidos, x.qtdAtrasados]), [['2020-03-10', [10, 11], 2, 1], ['2099-03-12', [14], 1, 0]]);
  assert.equal(d.qtdPedidos, 3);
  assert.equal(d.qtdAtrasados, 1);
  const p10 = d.dias[0].pedidos[0];
  assert.equal(p10.atrasado, true);
  assert.equal(p10.classe, 'producao');
  assert.equal(p10.prontoEm, '2020-03-10');
  assert.equal(d.dias[0].pedidos[1].atrasado, false, 'pronto não atrasa');
});

test('mês com situacao=todos inclui entregue e cancelado, com a situação visível', async t => {
  const { chamar } = await preparar(t);
  const d = await (await chamar(1, '/calendario/pedidos?mes=2020-03&situacao=todos')).json();
  assert.equal(d.situacao, 'todos');
  assert.equal(d.qtdPedidos, 5);
  assert.deepEqual(d.dias[0].pedidos.map(p => [p.numero, p.situacao]), [[10, 'Em Produção'], [11, 'Pronto'], [12, 'Entregue']]);
  assert.deepEqual(d.dias[1].pedidos.map(p => [p.numero, p.classe]), [[13, 'cancelado']]);
});

test('dia: SQL de [dia, dia seguinte), lista só aquele dia e vira mês/ano/29 de fevereiro', async t => {
  const { f, chamar } = await preparar(t, LINHAS.filter(l => l.pronto_em === '2020-03-10'));
  const d = await (await chamar(1, '/calendario/dia?data=2020-03-10&situacao=todos')).json();
  assert.deepEqual(consultas(f)[0].params, ['2020-03-10', '2020-03-11']);
  assert.deepEqual(d.pedidos.map(p => p.numero), [10, 11, 12]);
  assert.equal(d.data, '2020-03-10');
  assert.equal(d.qtdPedidos, 3);
  assert.equal(d.qtdAtrasados, 1);
  await chamar(1, '/calendario/dia?data=2028-02-28');
  assert.deepEqual(consultas(f).pop().params, ['2028-02-28', '2028-02-29']);
  await chamar(1, '/calendario/dia?data=2020-12-31');
  assert.deepEqual(consultas(f).pop().params, ['2020-12-31', '2021-01-01']);
});

test('dia sem pedidos devolve lista vazia', async t => {
  const { chamar } = await preparar(t, []);
  const d = await (await chamar(1, '/calendario/dia?data=2020-03-10')).json();
  assert.deepEqual(d, { data: '2020-03-10', situacao: 'abertos', hoje: d.hoje, qtdPedidos: 0, qtdAtrasados: 0, pedidos: [] });
});

test('valor: com valores.ver vem; sem valores.ver não aparece em lugar nenhum (as contagens continuam)', async t => {
  const { chamar } = await preparar(t);
  for (const caminho of ['/calendario/pedidos?mes=2020-03&situacao=todos', '/calendario/dia?data=2020-03-10&situacao=todos']) {
    const com = JSON.stringify(await (await chamar(1, caminho)).json());
    assert.match(com, /"valor":250/);
    const sem = JSON.stringify(await (await chamar(2, caminho)).json());
    assert.ok(!/valor|250/i.test(sem), sem);
    assert.match(sem, /"qtdPedidos"/);
  }
});

test('estados restritos: junta o cliente e filtra ESTADO IN (...); sem restrição não junta', async t => {
  const { f, chamar } = await preparar(t);
  assert.equal((await chamar(4, '/calendario/pedidos?mes=2020-03')).status, 200);
  const q = consultas(f)[0];
  assert.match(q.sql, /INNER JOIN cadastro_clientes c ON p\.RAZAO_SOCIAL = c\.RAZAO_SOCIAL/);
  assert.match(q.sql, /c\.ESTADO IN \(\?,\?\)/);
  assert.deepEqual(q.params, ['2020-03-01', '2020-04-01', 'RJ', 'ES']);
  await chamar(4, '/calendario/dia?data=2020-03-10');
  assert.deepEqual(consultas(f).pop().params, ['2020-03-10', '2020-03-11', 'RJ', 'ES']);
  f.chamadas.length = 0;
  await chamar(1, '/calendario/pedidos?mes=2020-03');
  assert.doesNotMatch(consultas(f)[0].sql, /cadastro_clientes/);
});

test('erro do banco: 500 sem vazar a mensagem', async t => {
  const { chamar } = await preparar(t);
  pool.execute = async () => { throw new Error('segredo do banco'); };
  const r = await chamar(1, '/calendario/pedidos?mes=2020-03');
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(await r.json()).includes('segredo'));
});
