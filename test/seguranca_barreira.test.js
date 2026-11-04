process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes, registro, configPortal, sessoesPortal } = require('../index.js');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
aceitarSidDeTeste(sessoes);

const assinar = claims => jwt.sign(claims, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
// Todos os tokens levam `sid` válido: só a regra de `tipo` de `autenticar` pode gerar o 401 destes testes.
const tokenCliente = assinar({ id: 7, nome: 'Cliente', v: 2, tipo: 'cliente', sid: SID_TESTE });
const usarPool = regras => { const f = criarPoolFalso(regras); pool.execute = f.execute; pool.getConnection = f.getConnection; return f; };

test('token com tipo cliente é recusado em toda rota autenticada', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  acesso.limpar();
  // Se o token passasse da barreira, o acesso de funcionário viria daqui: nunca deve ser chamado.
  let chamadas = 0;
  t.mock.method(acesso, 'carregar', async () => { chamadas++; return null; });
  const rotas = registro.rotasAutenticadas();
  assert.ok(rotas.length > 50, `lista de rotas autenticadas pequena demais: ${rotas.length}`);
  const falhas = [];
  for (const { metodo, caminho } of rotas) {
    const url = s.url + caminho.replace(/:[A-Za-z_]+/g, '1');
    const r = await fetch(url, { method: metodo.toUpperCase(), headers: { Authorization: 'Bearer ' + tokenCliente } });
    if (r.status !== 401) falhas.push(`${metodo.toUpperCase()} ${caminho} -> ${r.status}`);
  }
  assert.deepEqual(falhas, []);
  assert.equal(chamadas, 0);
});

test('rotasAutenticadas devolve cópia e não inclui as públicas', () => {
  const a = registro.rotasAutenticadas();
  a.length = 0;
  assert.ok(registro.rotasAutenticadas().length > 50);
  assert.ok(!registro.rotasAutenticadas().some(r => r.caminho === '/login'));
});

const acessoCaio = async () => ({ codigo: 7, nome: 'Caio', cargo: 'Produção', perfil: { id: 4, nome: 'X' }, estados: [], ativo: true, permissoes: new Set() });

test('token com tipo funcionario e sid válido continua valendo (controle positivo)', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  acesso.limpar();
  t.mock.method(acesso, 'carregar', acessoCaio);
  const r = await fetch(s.url + '/auth/verify', { headers: { Authorization: 'Bearer ' + assinar({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario', sid: SID_TESTE }) } });
  assert.equal(r.status, 200);
});

test('token sem tipo é recusado mesmo com sid válido', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  acesso.limpar();
  t.mock.method(acesso, 'carregar', acessoCaio);
  const r = await fetch(s.url + '/auth/verify', { headers: { Authorization: 'Bearer ' + assinar({ id: 7, nome: 'Caio', v: 2, sid: SID_TESTE }) } });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'Sessão expirada. Faça login novamente.' });
});

for (const [rotulo, tipo] of [['cliente', 'cliente'], ['null', null], ['string vazia', ''], ['zero', 0], ['false', false], ['array', ['funcionario']], ['caixa diferente', 'Funcionario']]) {
  test(`tipo ${rotulo} com sid válido recebe 401`, async t => {
    const s = await subir(app);
    t.after(s.fechar);
    acesso.limpar();
    t.mock.method(acesso, 'carregar', acessoCaio);
    const r = await fetch(s.url + '/auth/verify', { headers: { Authorization: 'Bearer ' + assinar({ id: 7, nome: 'Caio', v: 2, tipo, sid: SID_TESTE }) } });
    assert.equal(r.status, 401);
  });
}

test('tipo diferente de funcionario recebe 401 com a mensagem de sessão expirada', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  const r = await fetch(s.url + '/auth/verify', { headers: { Authorization: 'Bearer ' + tokenCliente } });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'Sessão expirada. Faça login novamente.' });
});

test('gerarToken inclui tipo funcionario (token do /login)', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  acesso.limpar();
  usarPool([[/FROM cliente_usuarios WHERE NOME/, [{ CODIGO: 7, NOME: 'Caio', RAZAO_SOCIAL: 'ELEGANCE', CARGO: 'Produção', SENHA: bcrypt.hashSync('segredo123', 4) }]]]);
  t.mock.method(acesso, 'carregar', async () => ({ codigo: 7, nome: 'Caio', cargo: 'Produção', empresa: 'ELEGANCE', perfil: { id: 4, nome: 'X' }, estados: [], ativo: true, permissoes: new Set() }));
  const r = await fetch(s.url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Caio', password: 'segredo123' }) });
  assert.equal(r.status, 200);
  assert.equal(jwt.decode((await r.json()).token).tipo, 'funcionario');
});

// ---- Caminho inverso: credenciais do portal não autenticam rotas de funcionário ----

async function varrer(s, headers) {
  const falhas = [];
  for (const { metodo, caminho } of registro.rotasAutenticadas()) {
    const url = s.url + caminho.replace(/:[A-Za-z_]+/g, '1');
    const r = await fetch(url, { method: metodo.toUpperCase(), headers });
    if (r.status !== 401) falhas.push(`${metodo.toUpperCase()} ${caminho} -> ${r.status}`);
  }
  return falhas;
}

// Cria uma sessão VÁLIDA do portal (banco falso do portal no lugar do pool, empresa e usuário ativos) pelo mesmo caminho do login
// (`sessoesPortal.criar`); o controle positivo prova que o token vale NO PORTAL, então o 401 das rotas de funcionário é da barreira.
async function sessaoValidaDoPortal(t, s) {
  const banco = criarBancoPortal({
    clientes: [{ CODIGO: 40, RAZAO_SOCIAL: 'ACME LTDA' }], empresas: [{ cliente_codigo: 40, situacao: 'ativa' }],
    usuarios: [{ id: 1, email: 'ana@acme.com', cliente_codigo: 40, papel: 'admin_geral', situacao: 'ativo' }]
  });
  pool.execute = banco.pool.execute; pool.getConnection = banco.pool.getConnection;
  const antes = { ativo: configPortal.ativo, baseUrl: configPortal.baseUrl };
  configPortal.ativo = true; configPortal.baseUrl = 'https://portal.teste';
  t.after(() => Object.assign(configPortal, antes));
  const token = await sessoesPortal.criar(1, '127.0.0.1');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const eu = await fetch(s.url + '/portal/api/eu', { headers: { Cookie: '__Host-portal=' + token } });
  assert.equal(eu.status, 200, 'controle: a sessão do portal é válida no próprio portal');
  return token;
}

for (const [rotulo, montarCabecalhos] of [
  ['como Authorization: Bearer', token => ({ Authorization: 'Bearer ' + token })],
  ['como cookie __Host-portal (sem Authorization)', token => ({ Cookie: '__Host-portal=' + token })],
  ['nos dois lugares ao mesmo tempo', token => ({ Authorization: 'Bearer ' + token, Cookie: '__Host-portal=' + token })]
]) {
  test(`token de uma sessão VÁLIDA do portal (43 caracteres base64url) enviado ${rotulo} dá 401 em todas as rotas de funcionário`, async t => {
    const s = await subir(app);
    t.after(s.fechar);
    acesso.limpar();
    let chamadas = 0;
    t.mock.method(acesso, 'carregar', async () => { chamadas++; return null; });
    const token = await sessaoValidaDoPortal(t, s);
    assert.ok(registro.rotasAutenticadas().length > 50);
    const falhas = await varrer(s, montarCabecalhos(token));
    assert.deepEqual(falhas, []);
    assert.equal(chamadas, 0);
  });
}
