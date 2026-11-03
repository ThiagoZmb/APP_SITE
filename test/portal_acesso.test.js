process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
process.env.PORTAL_URL_BASE = 'https://portal.exemplo.com';
process.env.PORTAL_CHAVE_CRIPTO = Buffer.alloc(32, 7).toString('base64');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { criarSessoesPortal } = require('../portal/sessoes');
const { criarAcessoPortal, empresaLiberavel } = require('../portal/acesso');
const { auditarPortal } = require('../portal/auditoria');
const { cabecalhosPortal } = require('../portal/cabecalhos');
const { criarRegistro } = require('../seguranca/rotas');

const BASE = 'https://portal.exemplo.com';
const TRES = ['pedidos.ver', 'documentos.ver', 'financeiro.ver'];

function cenario({ ativo = true } = {}) {
  const banco = criarBancoPortal();
  banco.dados.clientes.push({ CODIGO: 40, RAZAO_SOCIAL: 'ACME LTDA' });
  banco.dados.empresas.push({ cliente_codigo: 40, situacao: 'ativa' });
  banco.dados.usuarios.push(
    { id: 1, email: 'a@acme.com', cliente_codigo: 40, papel: 'admin_geral', situacao: 'ativo' },
    { id: 2, email: 'u@acme.com', cliente_codigo: 40, papel: 'usuario', situacao: 'ativo' }
  );
  banco.dados.permissoes.push(
    { usuario_id: 2, permissao: 'pedidos.ver' },
    { usuario_id: 2, permissao: 'codigo.desconhecido' },
    { usuario_id: 1, permissao: 'ignorada.para.admin' }
  );
  const sessoes = criarSessoesPortal({ pool: banco.pool });
  const config = ativo ? { ativo: true, baseUrl: BASE } : { ativo: false, motivo: 'x' };
  const { portalAtivo, portalAutenticar } = criarAcessoPortal({ pool: banco.pool, sessoes, config });
  return { banco, sessoes, config, portalAtivo, portalAutenticar };
}

async function subirApp(c) {
  const app = express();
  app.use(express.json());
  const registro = criarRegistro(app, { autenticado: [], portalPublico: [c.portalAtivo], portalAutenticado: [c.portalAtivo, c.portalAutenticar] });
  registro.portal('get', '/portal/teste', [], (req, res) => res.json({ ...req.portal, permissoes: [...req.portal.permissoes].sort() }));
  registro.portal('post', '/portal/teste', [], (req, res) => res.json({ ok: true }));
  registro.portalPublica('get', '/portal/aberta', (req, res) => res.json({ ok: true }));
  registro.verificar();
  return subir(app);
}

const cookie = token => ({ Cookie: '__Host-portal=' + token });
const MSG401 = { error: 'Sessão expirada. Entre novamente.' };

test('sem configuração o portal responde 503 nas rotas públicas e autenticadas', async t => {
  const s = await subirApp(cenario({ ativo: false }));
  t.after(s.fechar);
  for (const caminho of ['/portal/teste', '/portal/aberta']) {
    const r = await fetch(s.url + caminho);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'Portal não configurado.' });
  }
});

test('401 uniforme: sem cookie, token mal formado, JWT de funcionário e token desconhecido', async t => {
  const c = cenario();
  const s = await subirApp(c);
  t.after(s.fechar);
  const jwtFunc = jwt.sign({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario', sid: 'a'.repeat(32) }, 'teste', { issuer: 'elegance-api' });
  for (const headers of [{}, cookie('curto'), cookie(jwtFunc), cookie('a'.repeat(43))]) {
    const r = await fetch(s.url + '/portal/teste', { headers });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), MSG401);
  }
});

test('200 com sessão válida e req.portal completo', async t => {
  const c = cenario();
  const s = await subirApp(c);
  t.after(s.fechar);
  const token = await c.sessoes.criar(2, null);
  const r = await fetch(s.url + '/portal/teste', { headers: cookie(token) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    usuarioId: 2, empresaCodigo: 40, papel: 'usuario', email: 'u@acme.com', razaoSocial: 'ACME LTDA', permissoes: ['pedidos.ver']
  });
});

test('administrador geral recebe as três permissões do portal', async t => {
  const c = cenario();
  const s = await subirApp(c);
  t.after(s.fechar);
  const token = await c.sessoes.criar(1, null);
  const j = await (await fetch(s.url + '/portal/teste', { headers: cookie(token) })).json();
  assert.deepEqual(j.permissoes, [...TRES].sort());
  assert.equal(j.papel, 'admin_geral');
});

for (const situacao of ['convidado', 'inativo']) {
  test(`usuário ${situacao} recebe 401`, async t => {
    const c = cenario();
    const s = await subirApp(c);
    t.after(s.fechar);
    const token = await c.sessoes.criar(2, null);
    c.banco.dados.usuarios.find(u => u.id === 2).situacao = situacao;
    const r = await fetch(s.url + '/portal/teste', { headers: cookie(token) });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), MSG401);
  });
}

test('empresa suspensa no meio da sessão derruba a requisição seguinte', async t => {
  const c = cenario();
  const s = await subirApp(c);
  t.after(s.fechar);
  const token = await c.sessoes.criar(2, null);
  assert.equal((await fetch(s.url + '/portal/teste', { headers: cookie(token) })).status, 200);
  c.banco.dados.empresas[0].situacao = 'suspensa';
  const r = await fetch(s.url + '/portal/teste', { headers: cookie(token) });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), MSG401);
});

test('empresa sem registro em web_portal_empresas e nome que deixou de ser único dão 401', async t => {
  const c = cenario();
  const s = await subirApp(c);
  t.after(s.fechar);
  const token = await c.sessoes.criar(2, null);
  c.banco.dados.clientes.push({ CODIGO: 99, RAZAO_SOCIAL: 'ACME LTDA' });
  assert.equal((await fetch(s.url + '/portal/teste', { headers: cookie(token) })).status, 401);
  c.banco.dados.clientes.pop();
  assert.equal((await fetch(s.url + '/portal/teste', { headers: cookie(token) })).status, 200);
  c.banco.dados.empresas.length = 0;
  assert.equal((await fetch(s.url + '/portal/teste', { headers: cookie(token) })).status, 401);
});

test('sessão revogada depois de aceita deixa de valer', async t => {
  const c = cenario();
  const s = await subirApp(c);
  t.after(s.fechar);
  const token = await c.sessoes.criar(2, null);
  await c.sessoes.revogar(token);
  assert.equal((await fetch(s.url + '/portal/teste', { headers: cookie(token) })).status, 401);
});

test('CSRF: POST sem X-Portal, com Origin alheio ou X-Portal diferente de 1 dá 403', async t => {
  const c = cenario();
  const s = await subirApp(c);
  t.after(s.fechar);
  const token = await c.sessoes.criar(2, null);
  const msg = { error: 'Requisição recusada.' };
  for (const extra of [{}, { 'X-Portal': '0' }, { 'X-Portal': '1', Origin: 'https://malvado.com' }, { Origin: BASE }]) {
    const r = await fetch(s.url + '/portal/teste', { method: 'POST', headers: { ...cookie(token), ...extra } });
    assert.equal(r.status, 403, JSON.stringify(extra));
    assert.deepEqual(await r.json(), msg);
  }
});

test('CSRF: POST com X-Portal e sem Origin, ou com Origin igual à base, passa; GET não exige o cabeçalho', async t => {
  const c = cenario();
  const s = await subirApp(c);
  t.after(s.fechar);
  const token = await c.sessoes.criar(2, null);
  const a = await fetch(s.url + '/portal/teste', { method: 'POST', headers: { ...cookie(token), 'X-Portal': '1' } });
  assert.equal(a.status, 200);
  const b = await fetch(s.url + '/portal/teste', { method: 'POST', headers: { ...cookie(token), 'X-Portal': '1', Origin: BASE } });
  assert.equal(b.status, 200);
  const g = await fetch(s.url + '/portal/teste', { headers: { ...cookie(token), Origin: 'https://outro.com' } });
  assert.equal(g.status, 200);
});

test('POST sem sessão continua dando 401 (não 403): a sessão vem antes do CSRF', async t => {
  const s = await subirApp(cenario());
  t.after(s.fechar);
  const r = await fetch(s.url + '/portal/teste', { method: 'POST' });
  assert.equal(r.status, 401);
});

// ---- empresaLiberavel ----
test('empresaLiberavel: inexistente, nome duplicado, ok e ja_liberada só ao liberar', async () => {
  const { banco } = cenario();
  const { pool, dados } = banco;
  assert.deepEqual(await empresaLiberavel(pool, 12345), { ok: false, motivo: 'inexistente' });
  dados.clientes.push({ CODIGO: 41, RAZAO_SOCIAL: 'ACME LTDA' });
  assert.deepEqual(await empresaLiberavel(pool, 40), { ok: false, motivo: 'nome_duplicado' });
  dados.clientes.push({ CODIGO: 50, RAZAO_SOCIAL: 'BETA SA' });
  assert.equal((await empresaLiberavel(pool, 50)).ok, true);
  dados.empresas.push({ cliente_codigo: 50, situacao: 'ativa' });
  assert.equal((await empresaLiberavel(pool, 50)).ok, true, 'sem aoLiberar não olha web_portal_empresas');
  assert.deepEqual(await empresaLiberavel(pool, 50, { aoLiberar: true }), { ok: false, motivo: 'ja_liberada' });
  dados.clientes.push({ CODIGO: 60, RAZAO_SOCIAL: 'GAMA' });
  assert.equal((await empresaLiberavel(pool, 60, { aoLiberar: true })).ok, true);
});

// ---- auditoria ----
test('auditarPortal grava com detalhe em JSON', async () => {
  const { pool, dados } = criarBancoPortal();
  await auditarPortal(pool, { evento: 'login_ok', usuarioId: 2, clienteCodigo: 40, ip: '1.1.1.1', detalhe: { motivo: 'x' } });
  await auditarPortal(pool, { evento: 'logout' });
  assert.equal(dados.auditoria.length, 2);
  assert.equal(dados.auditoria[0].detalhe, '{"motivo":"x"}');
  assert.equal(dados.auditoria[1].usuario_id, null);
  assert.equal(dados.auditoria[1].detalhe, null);
});

test('auditarPortal nunca lança e só loga o código do erro', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...a) => logs.push(a.join(' ')));
  const pool = { execute: async () => { const e = new Error('senha=segredo host=banco'); e.code = 'ER_X'; throw e; } };
  await auditarPortal(pool, { evento: 'login_falhou' });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /ER_X/);
  assert.ok(!logs[0].includes('segredo'));
});

// ---- ligações no index.js: CORS e cabeçalhos ----
const { app, configPortal, sessoesPortal } = require('../index.js');

test('index exporta configPortal ativa e sessoesPortal', () => {
  assert.equal(configPortal.ativo, true);
  assert.equal(configPortal.baseUrl, BASE);
  assert.equal(typeof sessoesPortal.valida, 'function');
});

test('CORS: POST com Origin da base em /portal/ não vira 500; em outro caminho continua recusado', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  const a = await fetch(s.url + '/portal/api/x', { method: 'POST', headers: { Origin: BASE } });
  assert.notEqual(a.status, 500);
  assert.equal(a.headers.get('access-control-allow-origin'), BASE);
  const b = await fetch(s.url + '/clientes/salvar', { method: 'POST', headers: { Origin: BASE } });
  assert.equal(b.status, 500);
  assert.equal(b.headers.get('access-control-allow-origin'), null);
  const c = await fetch(s.url + '/portal/api/x', { method: 'POST', headers: { Origin: 'https://malvado.com' } });
  assert.equal(c.status, 500);
  // regras antigas intactas
  const d = await fetch(s.url + '/clientes/salvar', { method: 'POST', headers: { Origin: 'https://thiagozmb.github.io' } });
  assert.notEqual(d.status, 500);
});

const CSP_ESPERADA = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'";

test('cabeçalhos do portal: middleware isolado, CSP exata e só em /portal', async t => {
  // O 404 padrão do Express (finalhandler) reescreve a CSP; por isso o middleware é testado numa rota real.
  const mini = express();
  mini.use(cabecalhosPortal);
  mini.get('/portal/x', (req, res) => res.json({}));
  mini.get('/portalx', (req, res) => res.json({}));
  mini.get('/fora', (req, res) => res.json({}));
  const s = await subir(mini);
  t.after(s.fechar);
  const p = await fetch(s.url + '/portal/x');
  assert.equal(p.headers.get('content-security-policy'), CSP_ESPERADA);
  assert.equal(p.headers.get('cache-control'), 'no-store');
  assert.equal(p.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(p.headers.get('x-content-type-options'), 'nosniff');
  for (const fora of ['/portalx', '/fora']) {
    const o = await fetch(s.url + fora);
    assert.equal(o.headers.get('content-security-policy'), null);
    assert.notEqual(o.headers.get('cache-control'), 'no-store');
  }
});

test('index.js instala os cabeçalhos do portal (Cache-Control em /portal/, não em /login)', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  const p = await fetch(s.url + '/portal/qualquer');
  assert.equal(p.headers.get('cache-control'), 'no-store');
  assert.equal(p.headers.get('referrer-policy'), 'no-referrer');
  const q = await fetch(s.url + '/portalx');
  assert.notEqual(q.headers.get('cache-control'), 'no-store');
});
