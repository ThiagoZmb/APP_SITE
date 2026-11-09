// GET /painel/indicadores com pool falso: 403 sem permissão, 200 com, estados, valores e parâmetros.
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
  1: { nome: 'Admin', permissoes: new Set(['pedidos.ver', 'indicadores.ver', 'valores.ver']), estados: [] },
  2: { nome: 'Sem valores', permissoes: new Set(['pedidos.ver', 'indicadores.ver']), estados: [] },
  3: { nome: 'Sem indicadores', permissoes: new Set(['pedidos.ver', 'valores.ver']), estados: [] },
  4: { nome: 'Só indicadores', permissoes: new Set(['indicadores.ver', 'valores.ver']), estados: [] },
  5: { nome: 'Regional', permissoes: new Set(['pedidos.ver', 'indicadores.ver', 'valores.ver']), estados: ['RJ', 'ES'] }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

const hojeBR = (() => { const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).split('-'); return `${d}/${m}/${a}`; })();
const LINHAS = [
  { tipo: 'Pedido', cliente: 'A', data: hojeBR, valor: '100.00', situacao: 'Em Produção', financeiro: 'A Receber', prontoEm: '2020-01-01', dataEntrega: null },
  { tipo: 'Pedido', cliente: 'B', data: hojeBR, valor: '50.00', situacao: 'Cancelado', financeiro: '', prontoEm: null, dataEntrega: null },
  { tipo: 'Orçamento', cliente: 'A', data: hojeBR, valor: '300.00', situacao: 'Aberto', financeiro: '', prontoEm: null, dataEntrega: null }
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

test('a rota está no registro como GET e exige pedidos.ver e indicadores.ver', () => {
  const r = registro.rotasAutenticadas().find(x => x.caminho === '/painel/indicadores');
  assert.ok(r);
  assert.equal(r.metodo, 'get');
  assert.doesNotThrow(() => registro.verificar());
});

test('403 sem indicadores.ver (mesmo com pedidos.ver) e sem pedidos.ver; nenhuma consulta ao banco', async t => {
  const { f, chamar } = await preparar(t);
  assert.equal((await chamar(3, '/painel/indicadores')).status, 403);
  assert.equal((await chamar(4, '/painel/indicadores')).status, 403);
  assert.equal(consultas(f).length, 0);
});

test('sem token: 401', async t => {
  const { f } = await preparar(t);
  const s = await subir(app);
  t.after(s.fechar);
  assert.equal((await fetch(s.url + '/painel/indicadores')).status, 401);
  assert.equal(consultas(f).length, 0);
});

test('200 com permissão: contagens e valores; uma só consulta ao banco', async t => {
  const { f, chamar } = await preparar(t);
  const r = await chamar(1, '/painel/indicadores?periodo=mes');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.resultado.qtdPedidos, 1);
  assert.equal(d.resultado.qtdCancelados, 1);
  assert.equal(d.resultado.qtdOrcamentos, 1);
  assert.equal(d.operacao.qtdEmProducao, 1);
  assert.equal(d.operacao.qtdHojePedidos, 2);
  assert.equal(d.operacao.qtdHojeOrcamentos, 1);
  assert.equal(d.operacao.qtdAtrasadas, 1); // prontoEm 2020
  assert.equal(d.valores.resultado.pedidos, 100);
  assert.equal(d.valores.resultado.conversao, 100 / 300);
  assert.equal(d.valores.operacao.aReceber, 100);
  assert.equal(consultas(f).length, 1);
});

test('sem valores.ver: nenhum dinheiro na resposta (chave valores some), contagens ficam', async t => {
  const { chamar } = await preparar(t);
  const r = await chamar(2, '/painel/indicadores?periodo=mes');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.valores, undefined);
  assert.equal(d.resultado.qtdPedidos, 1);
  assert.equal(d.operacao.qtdEmProducao, 1);
  assert.ok(!/"(valor|valores|total|ticket|conversao)"/i.test(JSON.stringify(d)), JSON.stringify(d));
});

test('estados restritos: a consulta filtra por c.ESTADO IN (...) com os estados do usuário', async t => {
  const { f, chamar } = await preparar(t);
  assert.equal((await chamar(5, '/painel/indicadores')).status, 200);
  const c = consultas(f)[0];
  assert.match(c.sql, /INNER JOIN cadastro_clientes c/);
  assert.match(c.sql, /c\.ESTADO IN \(\?,\?\)/);
  assert.deepEqual(c.params.slice(-2), ['RJ', 'ES']);
  // ?estado= na URL não amplia nem troca o filtro do usuário
  const { f: f2, chamar: chamar2 } = await preparar(t);
  await chamar2(5, '/painel/indicadores?estado=SP');
  assert.ok(!consultas(f2)[0].params.includes('SP'));
});

test('sem restrição de estados: sem JOIN', async t => {
  const { f, chamar } = await preparar(t);
  await chamar(1, '/painel/indicadores');
  assert.ok(!/cadastro_clientes/.test(consultas(f)[0].sql));
});

test('cliente: vai como parâmetro (nunca no SQL) e filtra o resultado', async t => {
  const { f, chamar } = await preparar(t);
  const nome = "A'; DROP TABLE ped_orc;--";
  const d = await (await chamar(1, '/painel/indicadores?cliente=' + encodeURIComponent(nome))).json();
  const c = consultas(f)[0];
  assert.ok(!c.sql.includes('DROP'));
  assert.ok(c.params.includes(nome));
  assert.equal(d.resultado.qtdPedidos, 0); // nenhuma linha com esse cliente
  const ok = await (await chamar(1, '/painel/indicadores?periodo=mes&cliente=A')).json();
  assert.equal(ok.resultado.qtdPedidos, 1);
  assert.equal(ok.periodo.cliente, 'A');
});

test('parâmetros inválidos: 400 sem consultar o banco', async t => {
  const { f, chamar } = await preparar(t);
  assert.equal((await chamar(1, '/painel/indicadores?periodo=7')).status, 400);
  assert.equal((await chamar(1, '/painel/indicadores?periodo=a&periodo=b')).status, 400);
  assert.equal((await chamar(1, '/painel/indicadores?cliente=' + 'x'.repeat(201))).status, 400);
  assert.equal((await chamar(1, '/painel/indicadores?cliente=a&cliente=b')).status, 400);
  assert.equal(consultas(f).length, 0);
});

test('erro de banco: 500 sem vazar detalhe', async t => {
  const { f, chamar } = await preparar(t);
  pool.execute = async () => { throw new Error('segredo do banco'); };
  const r = await chamar(1, '/painel/indicadores');
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(await r.json()).includes('segredo'));
  void f;
});
