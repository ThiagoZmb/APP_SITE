process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { criarSessoesPortal } = require('../portal/sessoes');
const { criarAcessoPortal } = require('../portal/acesso');
const { cabecalhosPortal } = require('../portal/cabecalhos');
const { criarRegistro } = require('../seguranca/rotas');
const { criarCripto } = require('../portal/cripto');
const { hashToken } = require('../portal/tokens');
const totp = require('../portal/totp');
const { criarLimiteLogin } = require('../seguranca/login_limite');
const { registrarPortalAuth } = require('../rotas/portal_auth');
const { registrarPortalUsuarios } = require('../rotas/portal_usuarios');

const CHAVE = Buffer.alloc(32, 9).toString('base64');
const BASE = 'https://portal.exemplo.com';
const SENHA = 'Aurora-Verde-2027';
const T0 = Date.now();
const PASSO = Math.floor(T0 / 1000 / 30);
const MSG_404 = { error: 'Usuário não encontrado.' };
const MSG_ULTIMO = { error: 'A empresa precisa de ao menos um administrador ativo.' };
const MSG_DUP = { error: 'Já existe um usuário do portal com este e-mail.' };
const MSG_DOC = { error: 'Para ver documentos, conceda também a visão de pedidos.' };
const TRES = ['documentos.ver', 'financeiro.ver', 'pedidos.ver'];

// Envolve o pool: `trocar(sql, params)` devolve [sql, params] (mutação) e `antes(sql)` pode lançar.
function envolver(pool, { trocar, antes }) {
  const execute = (sql, params = []) => {
    if (antes) antes(sql);
    const [s2, p2] = trocar ? trocar(sql, params) : [sql, params];
    return pool.execute(s2, p2);
  };
  return {
    execute, query: execute,
    getConnection: async () => {
      const conn = await pool.getConnection();
      return { ...conn, execute, query: execute };
    }
  };
}
// mutação fiel: tira a condição de empresa do SQL por id e o seu parâmetro (o MySQL real recusaria a sobra)
const SEM_EMPRESA = (sql, params) => (sql.includes(' AND cliente_codigo = ?')
  ? [sql.replace(' AND cliente_codigo = ?', ' AND 1 = 1'), params.slice(0, -1)] : [sql, params]);

// Usuários: 1 Ana (admin ACME), 2 Caio (comum ACME, pedidos.ver), 3 Bia (admin BETA), 4 Dora (convidada ACME, nunca aceitou),
// 5 Edu (inativo ACME), 6 Fabio (comum BETA), 7 Gui (convidado BETA), 8 Lia (comum ACME, as 3), 9 Otto (convidado ACME que já aceitou o termo),
// 10 Ana2 (segundo administrador ACME, só com doisAdmins).
async function montar(t, { doisAdmins = false, mutar = false, quebrarBanco = false, quebrarAuditoria = false, limite, enviar } = {}) {
  const banco = criarBancoPortal();
  const d = banco.dados;
  d.clientes.push({ CODIGO: 40, RAZAO_SOCIAL: 'ACME LTDA' }, { CODIGO: 41, RAZAO_SOCIAL: 'BETA LTDA' });
  d.empresas.push({ cliente_codigo: 40, situacao: 'ativa' }, { cliente_codigo: 41, situacao: 'ativa' });
  const u = (id, email, cliente, papel, situacao, termo = true) => ({
    id, email, cliente_codigo: cliente, papel, situacao, senha_hash: 'HASH-SECRETO', totp_segredo_cifrado: 'SEGREDO-SECRETO', totp_ativo: 1,
    totp_ultimo_passo: 0, termo_aceito_em: termo ? new Date(T0 - 86400000) : null
  });
  d.usuarios.push(u(1, 'ana@acme.com', 40, 'admin_geral', 'ativo'), u(2, 'caio@acme.com', 40, 'usuario', 'ativo'),
    u(3, 'bia@beta.com', 41, 'admin_geral', 'ativo'), u(4, 'dora@acme.com', 40, 'usuario', 'convidado', false),
    u(5, 'edu@acme.com', 40, 'usuario', 'inativo'), u(6, 'fabio@beta.com', 41, 'usuario', 'ativo'),
    u(7, 'gui@beta.com', 41, 'usuario', 'convidado', false), u(8, 'lia@acme.com', 40, 'usuario', 'ativo'),
    u(9, 'otto@acme.com', 40, 'usuario', 'convidado', true));
  if (doisAdmins) d.usuarios.push(u(10, 'ana2@acme.com', 40, 'admin_geral', 'ativo'));
  const perm = (usuario_id, permissao) => d.permissoes.push({ usuario_id, permissao });
  perm(2, 'pedidos.ver'); perm(4, 'pedidos.ver'); perm(5, 'pedidos.ver'); perm(6, 'pedidos.ver'); perm(9, 'pedidos.ver');
  perm(7, 'documentos.ver'); perm(7, 'pedidos.ver');
  TRES.forEach(p => perm(8, p));
  const futuro = new Date(T0 + 3600000);
  d.convites.push({ id: 1001, token_hash: 'h4', usuario_id: 4, expira_em: futuro, usado_em: null, criado_por: 'x', criado_em: new Date(T0) },
    { id: 1002, token_hash: 'h7', usuario_id: 7, expira_em: futuro, usado_em: null, criado_por: 'x', criado_em: new Date(T0) });
  d.recuperacao.push({ usuario_id: 4, codigo_hash: 'r4', usado_em: null });
  d.sessoes.push({ id: 's4', usuario_id: 4, criado_em: new Date(T0), expira_em: futuro, ultimo_uso_em: new Date(T0), ip: '1.1.1.1', revogada: 0 });

  const cripto = criarCripto(CHAVE);
  const config = { ativo: true, baseUrl: BASE, chaveCripto: CHAVE, termoVersao: 'T1' };
  let relogio = T0;
  const enviados = [];
  const email = { enviarConvite: async dd => { enviados.push(dd); return enviar ? enviar(dd) : { enviado: false }; } };
  let poolRotas = banco.pool;
  if (mutar) poolRotas = envolver(banco.pool, { trocar: SEM_EMPRESA });
  if (quebrarBanco) poolRotas = { execute: async () => { throw { code: 'ER_X', sqlMessage: 'SEGREDO DO BANCO' }; }, getConnection: async () => { throw { code: 'ER_X', sqlMessage: 'SEGREDO DO BANCO' }; } };
  if (quebrarAuditoria) poolRotas = envolver(banco.pool, { antes: sql => { if (/web_portal_auditoria/.test(sql)) throw { code: 'ER_AUD' }; } });

  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(cabecalhosPortal);
  const sessoes = criarSessoesPortal({ pool: banco.pool });
  const { portalAtivo, portalAutenticar } = criarAcessoPortal({ pool: banco.pool, sessoes, config });
  const registro = criarRegistro(app, { autenticado: [], portalPublico: [portalAtivo], portalAutenticado: [portalAtivo, portalAutenticar] });
  registrarPortalAuth({ portal: registro.portal, portalPublica: registro.portalPublica, pool: banco.pool, sessoes, cripto, config,
    agora: () => relogio, falhasPorIp: 100000, limite: criarLimiteLogin() });
  registrarPortalUsuarios({ portal: registro.portal, pool: poolRotas, sessoes, email, config, ...(limite ? { limite } : {}) });
  registro.verificar();
  const s = await subir(app);
  t.after(s.fechar);
  const cookieDe = async usuarioId => `__Host-portal=${await sessoes.criar(usuarioId, '1.2.3.4')}`;
  const chamar = (metodo, caminho, corpo, { cookie, portal = true, raw } = {}) => fetch(s.url + caminho, {
    method: metodo,
    headers: { ...(corpo !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(portal ? { 'X-Portal': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: raw !== undefined ? raw : corpo !== undefined ? JSON.stringify(corpo) : undefined
  });
  return { banco, d, registro, sessoes, enviados, cookieDe, chamar, pool: banco.pool, avancar: ms => { relogio += ms; }, cripto };
}

const ROTAS = id => [
  ['GET', '/portal/api/usuarios', undefined],
  ['POST', '/portal/api/usuarios', { email: 'x@acme.com', permissoes: [] }],
  ['PUT', `/portal/api/usuarios/${id}/permissoes`, { permissoes: ['pedidos.ver'] }],
  ['POST', `/portal/api/usuarios/${id}/papel`, { papel: 'usuario', permissoes: [] }],
  ['POST', `/portal/api/usuarios/${id}/desativar`, {}],
  ['POST', `/portal/api/usuarios/${id}/reenviar_convite`, {}],
  ['POST', `/portal/api/usuarios/${id}/remover`, {}]
];
const POR_ID = ROTAS(1).slice(2).map(([m, c, b]) => [m, c.replace('/1/', '/{id}/'), b]);
const caminhoDe = (modelo, id) => modelo.replace('{id}', id);

const estado = d => JSON.stringify({ u: d.usuarios, p: d.permissoes, c: d.convites, s: d.sessoes, r: d.recuperacao });
const permsDe = (d, id) => d.permissoes.filter(p => p.usuario_id === id).map(p => p.permissao).sort();
const cabecalhos = r => { const h = Object.fromEntries(r.headers); delete h.date; return h; };
const usuario = (d, id) => d.usuarios.find(x => x.id === id);
function capturarLogs(t) {
  const linhas = [];
  const orig = {};
  for (const m of ['log', 'error', 'warn']) {
    orig[m] = console[m];
    console[m] = (...a) => linhas.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' '));
  }
  t.after(() => { for (const m of Object.keys(orig)) console[m] = orig[m]; });
  return linhas;
}

// ===================== 1. lista =====================

test('GET /usuarios lista só a empresa da sessão, com as chaves exatas e sem segredo', async t => {
  const c = await montar(t);
  c.d.permissoes.push({ usuario_id: 2, permissao: 'usuarios.gerir' }); // linha indevida: nunca aparece
  const r = await c.chamar('GET', '/portal/api/usuarios', undefined, { cookie: await c.cookieDe(1) });
  assert.equal(r.status, 200);
  const texto = await r.text();
  const corpo = JSON.parse(texto);
  const acme = c.d.usuarios.filter(x => x.cliente_codigo === 40);
  assert.ok(acme.length > 0);
  assert.deepEqual(corpo.usuarios.map(x => x.id).sort((a, b) => a - b), acme.map(x => x.id).sort((a, b) => a - b));
  for (const x of corpo.usuarios) assert.deepEqual(Object.keys(x).sort(), ['email', 'id', 'papel', 'permissoes', 'situacao']);
  assert.ok(!/beta\.com|HASH-SECRETO|SEGREDO-SECRETO|senha_hash|totp|token|termo|criado/i.test(texto));
  const por = id => corpo.usuarios.find(x => x.id === id);
  assert.deepEqual(por(1).permissoes, TRES, 'administrador aparece com as 3 concedíveis');
  assert.deepEqual(por(2).permissoes, ['pedidos.ver'], 'usuarios.gerir gravado por engano não aparece');
  assert.deepEqual(por(8).permissoes, TRES);
  assert.deepEqual(por(5).permissoes, ['pedidos.ver']);
  assert.equal(por(4).situacao, 'convidado');
});

// ===================== 2. isolamento: 404 idêntico =====================

test('rotas por id: usuário de outra empresa, inexistente e id inválido dão o MESMO 404 e não alteram nem auditam nada', async t => {
  const c = await montar(t, { doisAdmins: true });
  const cookie = await c.cookieDe(1);
  const antes = estado(c.d);
  let n = 0;
  for (const [metodo, modelo, corpo] of POR_ID) {
    const base = await c.chamar(metodo, caminhoDe(modelo, 999), corpo, { cookie });
    const baseTexto = await base.text();
    assert.equal(base.status, 404, modelo);
    assert.deepEqual(JSON.parse(baseTexto), MSG_404);
    for (const id of [6, 7, 3, 999, '12abc', '0', '1.5', '-3', '00000000000']) {
      const r = await c.chamar(metodo, caminhoDe(modelo, id), corpo, { cookie });
      assert.equal(r.status, 404, `${modelo} ${id}`);
      assert.equal(await r.text(), baseTexto, `${modelo} ${id}`);
      assert.deepEqual(cabecalhos(r), cabecalhos(base), `${modelo} ${id}`);
      n++;
    }
  }
  assert.equal(n, POR_ID.length * 9);
  assert.equal(estado(c.d), antes);
  assert.equal(c.d.auditoria.length, 0);
  assert.equal(c.enviados.length, 0);
});

// ===================== 3. POST /usuarios =====================

test('POST /usuarios cria usuário comum convidado com as permissões e o convite; o link só vem sem envio', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const r = await c.chamar('POST', '/portal/api/usuarios', { email: ' Novo@Acme.com ', permissoes: ['pedidos.ver', 'financeiro.ver'] }, { cookie });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.ok, true);
  assert.equal(corpo.enviado, false);
  assert.ok(corpo.link.startsWith(`${BASE}/portal/convite.html#`));
  const novo = c.d.usuarios.find(x => x.email === 'novo@acme.com');
  assert.ok(novo);
  assert.equal(novo.cliente_codigo, 40);
  assert.equal(novo.papel, 'usuario');
  assert.equal(novo.situacao, 'convidado');
  assert.deepEqual(permsDe(c.d, novo.id), ['financeiro.ver', 'pedidos.ver']);
  const abertos = c.d.convites.filter(x => x.usuario_id === novo.id && x.usado_em == null);
  assert.equal(abertos.length, 1);
  assert.equal(abertos[0].token_hash, hashToken(corpo.link.split('#')[1]));
  assert.equal(c.enviados.length, 1);
  assert.equal(c.enviados[0].para, 'novo@acme.com');
  assert.equal(c.enviados[0].razaoSocial, 'ACME LTDA');
});

test('POST /usuarios com o e-mail enviado não devolve o link', async t => {
  const c = await montar(t, { enviar: async () => ({ enviado: true }) });
  const r = await c.chamar('POST', '/portal/api/usuarios', { email: 'novo@acme.com', permissoes: [] }, { cookie: await c.cookieDe(1) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, enviado: true });
});

test('POST /usuarios recusa e-mail duplicado (inclusive de outra empresa), e-mail inválido, permissão fora da lista e corpo errado', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const antes = estado(c.d);
  const nUsuarios = c.d.usuarios.length;
  const casos = [
    [409, MSG_DUP, { email: 'fabio@beta.com', permissoes: [] }],
    [409, MSG_DUP, { email: 'CAIO@acme.com', permissoes: [] }],
    [400, null, { email: 'sem-arroba', permissoes: [] }],
    [400, null, { email: 'açaí@acme.com', permissoes: [] }],
    [400, null, { permissoes: [] }],
    [400, null, { email: 'a@acme.com', permissoes: ['usuarios.gerir'] }],
    [400, null, { email: 'a@acme.com', permissoes: ['x'] }],
    [400, null, { email: 'a@acme.com', permissoes: ['pedidos.ver', 'pedidos.ver'] }],
    [400, null, { email: 'a@acme.com', permissoes: 'pedidos.ver' }],
    [400, null, { email: 'a@acme.com', permissoes: [1] }],
    [400, null, { email: 'a@acme.com' }],
    [400, MSG_DOC, { email: 'a@acme.com', permissoes: ['documentos.ver'] }],
    [400, MSG_DOC, { email: 'a@acme.com', permissoes: ['documentos.ver', 'financeiro.ver'] }]
  ];
  for (const [status, msg, corpo] of casos) {
    const r = await c.chamar('POST', '/portal/api/usuarios', corpo, { cookie });
    assert.equal(r.status, status, JSON.stringify(corpo));
    const j = await r.json();
    if (msg) assert.deepEqual(j, msg);
    else assert.equal(typeof j.error, 'string');
  }
  const arr = await c.chamar('POST', '/portal/api/usuarios', undefined, { cookie, raw: '[]' });
  assert.equal(arr.status, 400);
  assert.equal(casos.length, 13);
  assert.equal(c.d.usuarios.length, nUsuarios);
  assert.equal(estado(c.d), antes);
  assert.equal(c.enviados.length, 0);
});

test('POST /usuarios sem o cabeçalho X-Portal é recusado', async t => {
  const c = await montar(t);
  const r = await c.chamar('POST', '/portal/api/usuarios', { email: 'a@acme.com', permissoes: [] }, { cookie: await c.cookieDe(1), portal: false });
  assert.equal(r.status, 403);
  assert.ok(!c.d.usuarios.some(x => x.email === 'a@acme.com'));
});

// ===================== 4. PUT permissoes =====================

test('PUT permissoes substitui as permissões de comum ativo ou convidado e recusa administrador e inativo', async t => {
  const c = await montar(t, { doisAdmins: true });
  const cookie = await c.cookieDe(1);
  const lia = permsDe(c.d, 8);
  let r = await c.chamar('PUT', '/portal/api/usuarios/2/permissoes', { permissoes: ['financeiro.ver'] }, { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual(permsDe(c.d, 2), ['financeiro.ver']);
  assert.deepEqual(permsDe(c.d, 8), lia, 'outro usuário não muda');
  r = await c.chamar('PUT', '/portal/api/usuarios/4/permissoes', { permissoes: ['pedidos.ver', 'documentos.ver'] }, { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(permsDe(c.d, 4), ['documentos.ver', 'pedidos.ver']);
  r = await c.chamar('PUT', '/portal/api/usuarios/2/permissoes', { permissoes: [] }, { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(permsDe(c.d, 2), []);
  const antes = estado(c.d);
  for (const id of [1, 10, 5]) {
    r = await c.chamar('PUT', `/portal/api/usuarios/${id}/permissoes`, { permissoes: ['pedidos.ver'] }, { cookie });
    assert.equal(r.status, 409, String(id));
    assert.equal(typeof (await r.json()).error, 'string');
  }
  for (const permissoes of [['usuarios.gerir'], ['x'], ['documentos.ver'], 'pedidos.ver', ['pedidos.ver', 'pedidos.ver'], undefined]) {
    r = await c.chamar('PUT', '/portal/api/usuarios/2/permissoes', { permissoes }, { cookie });
    assert.equal(r.status, 400, JSON.stringify(permissoes));
  }
  r = await c.chamar('PUT', '/portal/api/usuarios/2/permissoes', undefined, { cookie, raw: '[]' });
  assert.equal(r.status, 400);
  assert.equal(estado(c.d), antes);
});

// ===================== 5. papel =====================

test('POST papel: promover só quem está ativo, apagando as linhas de permissões', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  let r = await c.chamar('POST', '/portal/api/usuarios/2/papel', { papel: 'admin_geral' }, { cookie });
  assert.equal(r.status, 200);
  assert.equal(usuario(c.d, 2).papel, 'admin_geral');
  assert.deepEqual(permsDe(c.d, 2), []);
  const antes = estado(c.d);
  for (const id of [4, 5, 2]) { // convidada, inativo, já administrador
    r = await c.chamar('POST', `/portal/api/usuarios/${id}/papel`, { papel: 'admin_geral' }, { cookie });
    assert.equal(r.status, 409, String(id));
  }
  assert.equal(estado(c.d), antes);
});

test('POST papel: rebaixar exige a lista, grava só as novas e valida papel e permissões', async t => {
  const c = await montar(t, { doisAdmins: true });
  const cookie = await c.cookieDe(1);
  await c.chamar('POST', '/portal/api/usuarios/8/papel', { papel: 'admin_geral' }, { cookie });
  assert.deepEqual(permsDe(c.d, 8), []);
  c.d.permissoes.push({ usuario_id: 10, permissao: 'financeiro.ver' }); // sobra antiga: some ao rebaixar
  let r = await c.chamar('POST', '/portal/api/usuarios/10/papel', { papel: 'usuario', permissoes: ['pedidos.ver'] }, { cookie });
  assert.equal(r.status, 200);
  assert.equal(usuario(c.d, 10).papel, 'usuario');
  assert.deepEqual(permsDe(c.d, 10), ['pedidos.ver']);
  r = await c.chamar('POST', '/portal/api/usuarios/8/papel', { papel: 'usuario', permissoes: [] }, { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(permsDe(c.d, 8), [], 'lista vazia vale');
  const antes = estado(c.d);
  const ruins = [
    { papel: 'usuario' }, { papel: 'usuario', permissoes: 'pedidos.ver' }, { papel: 'usuario', permissoes: ['usuarios.gerir'] },
    { papel: 'usuario', permissoes: ['documentos.ver'] }, { papel: 'dono', permissoes: [] }, {}, { papel: 7 }
  ];
  for (const corpo of ruins) {
    r = await c.chamar('POST', '/portal/api/usuarios/2/papel', corpo, { cookie });
    assert.equal(r.status, 400, JSON.stringify(corpo));
  }
  assert.equal(estado(c.d), antes);
});

test('POST papel: trava do último administrador (duas chamadas em sequência com dois administradores)', async t => {
  const c = await montar(t, { doisAdmins: true });
  const cookie = await c.cookieDe(1);
  const um = await c.chamar('POST', '/portal/api/usuarios/10/papel', { papel: 'usuario', permissoes: [] }, { cookie });
  assert.equal(um.status, 200);
  const dois = await c.chamar('POST', '/portal/api/usuarios/1/papel', { papel: 'usuario', permissoes: [] }, { cookie });
  assert.equal(dois.status, 409);
  assert.deepEqual(await dois.json(), MSG_ULTIMO);
  assert.equal(usuario(c.d, 1).papel, 'admin_geral');
  assert.equal(c.d.usuarios.filter(x => x.cliente_codigo === 40 && x.papel === 'admin_geral').length, 1);
});

test('POST papel: único administrador ativo não se rebaixa; administrador só convidado ou inativo não conta', async t => {
  const c = await montar(t, { doisAdmins: true });
  const cookie = await c.cookieDe(1);
  for (const situacao of ['convidado', 'inativo']) {
    usuario(c.d, 10).situacao = situacao;
    const antes = estado(c.d);
    const r = await c.chamar('POST', '/portal/api/usuarios/1/papel', { papel: 'usuario', permissoes: ['pedidos.ver'] }, { cookie });
    assert.equal(r.status, 409, situacao);
    assert.deepEqual(await r.json(), MSG_ULTIMO);
    assert.equal(estado(c.d), antes);
  }
  const c2 = await montar(t);
  const r2 = await c2.chamar('POST', '/portal/api/usuarios/1/papel', { papel: 'usuario', permissoes: [] }, { cookie: await c2.cookieDe(1) });
  assert.equal(r2.status, 409);
  assert.equal(usuario(c2.d, 1).papel, 'admin_geral');
});

// ===================== 6. desativar =====================

test('desativar: usuário comum perde o acesso, sessões revogadas e convites abertos invalidados', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const sessaoCaio = await c.sessoes.criar(2, '1.2.3.4');
  assert.ok(await c.sessoes.valida(sessaoCaio));
  let r = await c.chamar('POST', '/portal/api/usuarios/2/desativar', {}, { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(usuario(c.d, 2).situacao, 'inativo');
  assert.equal(await c.sessoes.valida(sessaoCaio), null);
  r = await c.chamar('POST', '/portal/api/usuarios/4/desativar', {}, { cookie });
  assert.equal(r.status, 200);
  assert.equal(c.d.convites.filter(x => x.usuario_id === 4 && x.usado_em == null).length, 0);
  r = await c.chamar('POST', '/portal/api/usuarios/5/desativar', {}, { cookie });
  assert.equal(r.status, 409, 'já inativo');
});

test('desativar: último administrador ativo = 409; com outro administrador a pessoa pode se desativar', async t => {
  const c = await montar(t);
  const r = await c.chamar('POST', '/portal/api/usuarios/1/desativar', {}, { cookie: await c.cookieDe(1) });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), MSG_ULTIMO);
  assert.equal(usuario(c.d, 1).situacao, 'ativo');

  const c2 = await montar(t, { doisAdmins: true });
  const cookie1 = await c2.cookieDe(1);
  const cookie10 = await c2.cookieDe(10);
  const r2 = await c2.chamar('POST', '/portal/api/usuarios/1/desativar', {}, { cookie: cookie1 });
  assert.equal(r2.status, 200);
  assert.equal(usuario(c2.d, 1).situacao, 'inativo');
  const eu = await c2.chamar('GET', '/portal/api/usuarios', undefined, { cookie: cookie1 });
  assert.equal(eu.status, 401, 'a própria sessão caiu');
  const r3 = await c2.chamar('POST', '/portal/api/usuarios/10/desativar', {}, { cookie: cookie10 });
  assert.equal(r3.status, 409, 'agora é o último');
  assert.equal(usuario(c2.d, 10).situacao, 'ativo');
});

// ===================== 7. reenviar e remover =====================

test('reenviar_convite: só convidado; os anteriores são invalidados e um novo é criado', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const r = await c.chamar('POST', '/portal/api/usuarios/4/reenviar_convite', {}, { cookie });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.ok, true);
  assert.equal(corpo.enviado, false);
  assert.ok(corpo.link.startsWith(`${BASE}/portal/convite.html#`));
  assert.equal(c.d.convites.find(x => x.id === 1001).usado_em != null, true);
  const abertos = c.d.convites.filter(x => x.usuario_id === 4 && x.usado_em == null);
  assert.equal(abertos.length, 1);
  assert.equal(abertos[0].token_hash, hashToken(corpo.link.split('#')[1]));
  assert.equal(c.enviados.length, 1);
  assert.equal(c.enviados[0].para, 'dora@acme.com');
  const antes = estado(c.d);
  for (const id of [2, 5, 8, 1]) {
    const x = await c.chamar('POST', `/portal/api/usuarios/${id}/reenviar_convite`, {}, { cookie });
    assert.equal(x.status, 409, String(id));
  }
  assert.equal(estado(c.d), antes);
  assert.equal(c.enviados.length, 1);
});

test('remover: só convidado que nunca aceitou; apaga tudo dele e libera o e-mail', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const r = await c.chamar('POST', '/portal/api/usuarios/4/remover', {}, { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.ok(!usuario(c.d, 4));
  assert.equal(c.d.convites.filter(x => x.usuario_id === 4).length, 0);
  assert.equal(c.d.recuperacao.filter(x => x.usuario_id === 4).length, 0);
  assert.equal(permsDe(c.d, 4).length, 0);
  assert.equal(c.d.sessoes.filter(x => x.usuario_id === 4).length, 0);
  assert.ok(usuario(c.d, 2), 'os outros ficam');
  const livre = await c.chamar('POST', '/portal/api/usuarios', { email: 'dora@acme.com', permissoes: [] }, { cookie });
  assert.equal(livre.status, 200, 'e-mail liberado');
  const antes = estado(c.d);
  for (const id of [9, 2, 5, 1, 8]) { // convidado que já aceitou, ativo, inativo, administrador
    const x = await c.chamar('POST', `/portal/api/usuarios/${id}/remover`, {}, { cookie });
    assert.equal(x.status, 409, String(id));
  }
  assert.equal(estado(c.d), antes);
});

// ===================== 8. permissão =====================

test('usuário comum, mesmo com as 3 concedíveis, recebe 403 nas 7 rotas sem tocar nos dados', async t => {
  const c = await montar(t);
  c.d.permissoes.push({ usuario_id: 8, permissao: 'usuarios.gerir' }); // linha gravada: não vale
  const cookie = await c.cookieDe(8);
  const antes = estado(c.d);
  const chamadasAntes = c.pool.chamadas.length;
  let n = 0;
  for (const [metodo, caminho, corpo] of ROTAS(2)) {
    const r = await c.chamar(metodo, caminho, corpo, { cookie });
    assert.equal(r.status, 403, `${metodo} ${caminho}`);
    n++;
  }
  assert.equal(n, 7);
  const delta = c.pool.chamadas.slice(chamadasAntes).map(x => x.sql);
  assert.ok(delta.length > 0);
  const autenticacao = /^(SELECT usuario_id FROM web_portal_sessoes|UPDATE web_portal_sessoes SET ultimo_uso_em|SELECT u\.id, u\.email, u\.cliente_codigo|SELECT RAZAO_SOCIAL FROM cadastro_clientes|SELECT COUNT\(\*\) AS n FROM cadastro_clientes|SELECT permissao FROM web_portal_permissoes)/;
  for (const sql of delta) assert.match(sql.replace(/\s+/g, ' ').trim(), autenticacao);
  assert.equal(estado(c.d), antes);
  assert.equal(c.d.auditoria.length, 0);
  assert.equal(c.enviados.length, 0);
});

test('sem cookie, JWT de funcionário e empresa suspensa dão 401 nas 7 rotas', async t => {
  const c = await montar(t);
  const jwtFuncionario = jwt.sign({ id: 1, nome: 'Thiago', v: 2, tipo: 'funcionario', sid: 'x' }, 'teste', { issuer: 'elegance-api' });
  const cookie = await c.cookieDe(1); // a sessão da Ana entra no estado antes da comparação
  const antes = estado(c.d);
  let n = 0;
  for (const [metodo, caminho, corpo] of ROTAS(2)) {
    for (const cookie of [undefined, `__Host-portal=${jwtFuncionario}`, '__Host-portal=lixo']) {
      const r = await c.chamar(metodo, caminho, corpo, { cookie });
      assert.equal(r.status, 401, `${metodo} ${caminho}`);
      n++;
    }
    const x = await c.chamar(metodo, caminho, corpo, { cookie: undefined, portal: true });
    assert.equal(x.status, 401);
  }
  assert.equal(n, 21);
  c.d.empresas.find(e => e.cliente_codigo === 40).situacao = 'suspensa';
  for (const [metodo, caminho, corpo] of ROTAS(2)) {
    const r = await c.chamar(metodo, caminho, corpo, { cookie });
    assert.equal(r.status, 401, `suspensa ${metodo} ${caminho}`);
  }
  assert.equal(estado(c.d), antes);
});

// ===================== 9. prova de mutação do isolamento =====================

async function afirmarIsolamento(c) {
  const cookie = await c.cookieDe(1); // Ana, ACME
  const antes = estado(c.d);
  for (const [metodo, caminho, corpo] of [
    ['PUT', '/portal/api/usuarios/6/permissoes', { permissoes: ['financeiro.ver'] }],
    ['POST', '/portal/api/usuarios/6/desativar', {}]
  ]) {
    const r = await c.chamar(metodo, caminho, corpo, { cookie });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), MSG_404);
  }
  assert.equal(estado(c.d), antes);
  assert.equal(usuario(c.d, 6).situacao, 'ativo');
}

test('prova de mutação: sem o filtro de empresa no SQL por id o isolamento FALHA; com ele passa', async t => {
  const controle = await montar(t);
  await afirmarIsolamento(controle); // passa
  const mutado = await montar(t, { mutar: true });
  await assert.rejects(() => afirmarIsolamento(mutado));
  assert.notDeepEqual(permsDe(mutado.d, 6), ['pedidos.ver'], 'o usuário da outra empresa foi alterado pela mutação');
});

// ===================== lock em ordem fixa =====================

test('toda rota que muda papel, situação ou remove trava as linhas da empresa ANTES de ler o alvo', async t => {
  const c = await montar(t, { doisAdmins: true });
  const cookie = await c.cookieDe(1);
  const chamadas = [
    ['PUT', '/portal/api/usuarios/2/permissoes', { permissoes: [] }],
    ['POST', '/portal/api/usuarios/8/papel', { papel: 'admin_geral' }],
    ['POST', '/portal/api/usuarios/2/desativar', {}],
    ['POST', '/portal/api/usuarios/4/remover', {}]
  ];
  for (const [metodo, caminho, corpo] of chamadas) {
    const i0 = c.pool.chamadas.length;
    const r = await c.chamar(metodo, caminho, corpo, { cookie });
    assert.equal(r.status, 200, caminho);
    const sqls = c.pool.chamadas.slice(i0).map(x => ({ sql: x.sql.replace(/\s+/g, ' ').trim(), params: x.params }));
    const trava = sqls.findIndex(x => x.sql === 'SELECT id FROM web_portal_usuarios WHERE cliente_codigo = ? ORDER BY id FOR UPDATE');
    const alvo = sqls.findIndex(x => /FROM web_portal_usuarios WHERE id = \? AND cliente_codigo = \?/.test(x.sql));
    assert.ok(trava >= 0 && alvo >= 0, caminho);
    assert.ok(trava < alvo, caminho);
    assert.deepEqual(sqls[trava].params, [40]);
    assert.ok(sqls[alvo].sql.endsWith('FOR UPDATE'), 'o alvo também é lido com trava');
    assert.deepEqual(sqls[alvo].params.slice(1), [40]);
  }
});

// ===================== 10. fluxo completo =====================

test('fluxo: administrador convida, o convidado conclui e entra só com as permissões dadas; mudar permissões vale na requisição seguinte', async t => {
  const c = await montar(t);
  const cookieAna = await c.cookieDe(1);
  const conv = await c.chamar('POST', '/portal/api/usuarios', { email: 'novo@acme.com', permissoes: ['pedidos.ver'] }, { cookie: cookieAna });
  assert.equal(conv.status, 200);
  const token = (await conv.json()).link.split('#')[1];
  const ini = await c.chamar('POST', '/portal/api/convite/iniciar', { token });
  assert.equal(ini.status, 200);
  const { segredo } = await ini.json();
  const conc = await c.chamar('POST', '/portal/api/convite/concluir', { token, senha: SENHA, codigo: totp.codigoEm(segredo, PASSO), aceitoTermo: true, termoVersao: 'T1' });
  assert.equal(conc.status, 200);
  c.avancar(30000); // o código do login é de outro passo (anti-replay)
  const login = await c.chamar('POST', '/portal/api/login', { email: 'novo@acme.com', senha: SENHA, codigo: totp.codigoEm(segredo, PASSO + 1) });
  assert.equal(login.status, 200);
  const cookieNovo = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookieNovo.startsWith('__Host-portal='));
  let eu = await (await c.chamar('GET', '/portal/api/eu', undefined, { cookie: cookieNovo })).json();
  assert.deepEqual(eu.usuario.permissoes, ['pedidos.ver']);
  assert.equal(eu.usuario.papel, 'usuario');
  const novoId = c.d.usuarios.find(x => x.email === 'novo@acme.com').id;
  const put = await c.chamar('PUT', `/portal/api/usuarios/${novoId}/permissoes`, { permissoes: ['pedidos.ver', 'financeiro.ver'] }, { cookie: cookieAna });
  assert.equal(put.status, 200);
  eu = await (await c.chamar('GET', '/portal/api/eu', undefined, { cookie: cookieNovo })).json();
  assert.deepEqual(eu.usuario.permissoes, ['financeiro.ver', 'pedidos.ver']);
  const proibido = await c.chamar('GET', '/portal/api/usuarios', undefined, { cookie: cookieNovo });
  assert.equal(proibido.status, 403, 'o convidado não é administrador');
});

// ===================== 11. auditoria =====================

test('auditoria: uma linha por ação bem-sucedida, só com ids; nada em 400, 403, 404 e 409', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const acoes = [
    ['POST', '/portal/api/usuarios', { email: 'novo@acme.com', permissoes: ['pedidos.ver'] }, 'usuario_convidado'],
    ['PUT', '/portal/api/usuarios/2/permissoes', { permissoes: ['financeiro.ver'] }, 'usuario_permissoes'],
    ['POST', '/portal/api/usuarios/8/papel', { papel: 'admin_geral' }, 'usuario_papel'],
    ['POST', '/portal/api/usuarios/2/desativar', {}, 'usuario_desativado'],
    ['POST', '/portal/api/usuarios/4/reenviar_convite', {}, 'convite_reenviado'],
    ['POST', '/portal/api/usuarios/4/remover', {}, 'usuario_removido']
  ];
  for (const [metodo, caminho, corpo, evento] of acoes) {
    const antes = c.d.auditoria.length;
    const r = await c.chamar(metodo, caminho, corpo, { cookie });
    assert.equal(r.status, 200, caminho);
    assert.equal(c.d.auditoria.length, antes + 1, evento);
    const linha = c.d.auditoria[c.d.auditoria.length - 1];
    assert.equal(linha.evento, evento);
    assert.equal(linha.usuario_id, 1);
    assert.equal(linha.cliente_codigo, 40);
    assert.match(linha.detalhe, /^usuario=\d+(;papel=(admin_geral|usuario))?$/);
  }
  const tudo = JSON.stringify(c.d.auditoria);
  assert.ok(!/@|convite\.html|http|token|pedidos\.ver|financeiro/i.test(tudo), tudo);
  const n = c.d.auditoria.length;
  for (const [metodo, caminho, corpo] of [
    ['POST', '/portal/api/usuarios', { email: 'ruim', permissoes: [] }],
    ['PUT', '/portal/api/usuarios/6/permissoes', { permissoes: [] }],
    ['POST', '/portal/api/usuarios/5/desativar', {}],
    ['POST', '/portal/api/usuarios/5/remover', {}]
  ]) await c.chamar(metodo, caminho, corpo, { cookie });
  await c.chamar('POST', '/portal/api/usuarios/1/remover', {}, { cookie: await c.cookieDe(8) });
  assert.equal(c.d.auditoria.length, n);
});

test('falha ao gravar a auditoria não desfaz a ação', async t => {
  const logs = capturarLogs(t);
  const c = await montar(t, { quebrarAuditoria: true });
  const r = await c.chamar('POST', '/portal/api/usuarios/2/desativar', {}, { cookie: await c.cookieDe(1) });
  assert.equal(r.status, 200);
  assert.equal(usuario(c.d, 2).situacao, 'inativo');
  assert.equal(c.d.auditoria.length, 0);
  assert.ok(logs.some(l => l.includes('ER_AUD')));
});

// ===================== 12. limite =====================

test('limite: 20 convites por hora por administrador (criar e reenviar juntos); outro administrador e a lista não são afetados', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  for (let i = 0; i < 10; i++) {
    const r = await c.chamar('POST', '/portal/api/usuarios', { email: `n${i}@acme.com`, permissoes: [] }, { cookie });
    assert.equal(r.status, 200, `criar ${i}`);
  }
  for (let i = 0; i < 10; i++) {
    const r = await c.chamar('POST', '/portal/api/usuarios/4/reenviar_convite', {}, { cookie });
    assert.equal(r.status, 200, `reenviar ${i}`);
  }
  const x = await c.chamar('POST', '/portal/api/usuarios', { email: 'excesso@acme.com', permissoes: [] }, { cookie });
  assert.equal(x.status, 429);
  assert.ok(!c.d.usuarios.some(u => u.email === 'excesso@acme.com'));
  const y = await c.chamar('POST', '/portal/api/usuarios/4/reenviar_convite', {}, { cookie });
  assert.equal(y.status, 429);
  assert.equal(y.headers.get('ratelimit'), null);
  assert.equal(y.headers.get('x-ratelimit-limit'), null);
  const lista = await c.chamar('GET', '/portal/api/usuarios', undefined, { cookie });
  assert.equal(lista.status, 200);
  const outro = await c.chamar('POST', '/portal/api/usuarios', { email: 'bia2@beta.com', permissoes: [] }, { cookie: await c.cookieDe(3) });
  assert.equal(outro.status, 200);
});

test('limite injetável: com max 1 o segundo convite já dá 429', async t => {
  const c = await montar(t, { limite: { janelaMs: 60000, max: 1 } });
  const cookie = await c.cookieDe(1);
  assert.equal((await c.chamar('POST', '/portal/api/usuarios', { email: 'a1@acme.com', permissoes: [] }, { cookie })).status, 200);
  assert.equal((await c.chamar('POST', '/portal/api/usuarios', { email: 'a2@acme.com', permissoes: [] }, { cookie })).status, 429);
});

// ===================== 13. erro de banco e registro =====================

test('erro de banco vira 500 genérico e o log leva só o código', async t => {
  const logs = capturarLogs(t);
  const c = await montar(t, { quebrarBanco: true });
  const cookie = await c.cookieDe(1);
  let n = 0;
  for (const [metodo, caminho, corpo] of ROTAS(2)) {
    const r = await c.chamar(metodo, caminho, corpo, { cookie });
    assert.equal(r.status, 500, `${metodo} ${caminho}`);
    assert.deepEqual(await r.json(), { error: 'Erro de servidor' });
    n++;
  }
  assert.equal(n, 7);
  assert.ok(logs.some(l => l.includes('ER_X')));
  assert.ok(!logs.some(l => l.includes('SEGREDO')));
});

test('as 7 rotas estão no registro do portal e o registro passa na verificação', async t => {
  const c = await montar(t);
  const lista = c.registro.rotasPortal().map(r => `${r.metodo} ${r.caminho}`);
  for (const esperado of [
    'get /portal/api/usuarios', 'post /portal/api/usuarios', 'put /portal/api/usuarios/:id/permissoes', 'post /portal/api/usuarios/:id/papel',
    'post /portal/api/usuarios/:id/desativar', 'post /portal/api/usuarios/:id/reenviar_convite', 'post /portal/api/usuarios/:id/remover'
  ]) assert.ok(lista.includes(esperado), esperado);
  assert.doesNotThrow(() => c.registro.verificar());
});
