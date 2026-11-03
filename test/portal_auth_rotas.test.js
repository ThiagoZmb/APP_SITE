process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { criarSessoesPortal } = require('../portal/sessoes');
const { criarAcessoPortal } = require('../portal/acesso');
const { cabecalhosPortal } = require('../portal/cabecalhos');
const { criarRegistro } = require('../seguranca/rotas');
const { criarCripto } = require('../portal/cripto');
const { novoTokenOpaco, hashToken, gerarCodigosRecuperacao, hashCodigoRecuperacao } = require('../portal/tokens');
const totp = require('../portal/totp');
const { registrarPortalAuth } = require('../rotas/portal_auth');
const { criarLimiteLogin } = require('../seguranca/login_limite');

const CHAVE = Buffer.alloc(32, 9).toString('base64');
const BASE = 'https://portal.exemplo.com';
const SENHA = 'Aurora-Verde-2027';
const T0 = Date.now();
const PASSO = Math.floor(T0 / 1000 / 30);
const MSG_CONVITE = { error: 'Convite inválido ou expirado.' };
const MSG_LOGIN = { error: 'E-mail, senha ou código inválidos.' };
const MSG_LIMITE = { error: 'Muitas tentativas. Aguarde alguns minutos.' };
const COOKIE_RE = /^__Host-portal=[A-Za-z0-9_-]{43}; Max-Age=28800; HttpOnly; Secure; SameSite=Strict; Path=\/$/;
const TRES = ['documentos.ver', 'financeiro.ver', 'pedidos.ver'];

// Monta um app de teste com o registro REAL e as rotas de portal/auth, sobre o banco falso.
// Usuários: 1 Ana (ativa, admin_geral, empresa 40), 3 Bia (ativa, empresa 41 suspensa), 4 Ivo (inativo),
// 2 Novo e 6/7/9 (convidados, com convite válido / usado / expirado / de empresa suspensa), 8 (ativo, com convite pendente).
// Por padrão o limite por IP é alto (vários testes provocam dezenas de falhas no mesmo app); o teste do limite usa 10, o valor real.
function montar(t, { ativo = true, falhasPorIp = 100000, limite } = {}) {
  const banco = criarBancoPortal();
  const d = banco.dados;
  const cripto = criarCripto(CHAVE);
  const config = { ativo, baseUrl: BASE, chaveCripto: CHAVE, termoVersao: 'T1' };
  const segredo = totp.gerarSegredo();
  const recuperacao = gerarCodigosRecuperacao(10, CHAVE);
  d.clientes.push({ CODIGO: 40, RAZAO_SOCIAL: 'ACME LTDA' }, { CODIGO: 41, RAZAO_SOCIAL: 'BETA LTDA' });
  d.empresas.push({ cliente_codigo: 40, situacao: 'ativa' }, { cliente_codigo: 41, situacao: 'suspensa' });
  const hash = bcrypt.hashSync(SENHA, 4);
  const ativoCom = (id, email, cliente, situacao = 'ativo') => ({
    id, email, cliente_codigo: cliente, papel: 'admin_geral', situacao, senha_hash: hash,
    totp_segredo_cifrado: cripto.cifrar(segredo), totp_ativo: 1, totp_ultimo_passo: 0
  });
  const convidado = (id, email, cliente = 40) => ({
    id, email, cliente_codigo: cliente, papel: 'admin_geral', situacao: 'convidado', senha_hash: null,
    totp_segredo_cifrado: null, totp_ativo: 0, totp_ultimo_passo: 0
  });
  d.usuarios.push(ativoCom(1, 'ana@acme.com', 40), ativoCom(3, 'bia@beta.com', 41), ativoCom(4, 'ivo@acme.com', 40, 'inativo'),
    convidado(2, 'novo@acme.com'), convidado(6, 'seis@acme.com'), convidado(7, 'sete@acme.com'), convidado(9, 'nove@beta.com', 41),
    ativoCom(8, 'oito@acme.com', 40));
  recuperacao.hashes.forEach(h => d.recuperacao.push({ usuario_id: 1, codigo_hash: h, usado_em: null }));
  const tokens = {};
  const convite = (nome, usuarioId, { usado = false, expirado = false } = {}) => {
    const { token, hash: h } = novoTokenOpaco();
    tokens[nome] = token;
    d.convites.push({ id: d.convites.length + 1, token_hash: h, usuario_id: usuarioId,
      expira_em: new Date(T0 + (expirado ? -1000 : 48 * 3600 * 1000)), usado_em: usado ? new Date(T0 - 5000) : null, criado_por: 'Thiago', criado_em: new Date(T0 - 9000) });
  };
  convite('ok', 2); convite('usado', 6, { usado: true }); convite('expirado', 7, { expirado: true });
  convite('semSegredo', 6); // mesmo usuário do usado: serve para "concluir sem iniciar"
  convite('empresaSuspensa', 9); convite('usuarioAtivo', 8);

  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(cabecalhosPortal);
  const sessoes = criarSessoesPortal({ pool: banco.pool });
  const { portalAtivo, portalAutenticar } = criarAcessoPortal({ pool: banco.pool, sessoes, config });
  const registro = criarRegistro(app, { autenticado: [], portalPublico: [portalAtivo], portalAutenticado: [portalAtivo, portalAutenticar] });
  registrarPortalAuth({ portal: registro.portal, portalPublica: registro.portalPublica, pool: banco.pool, sessoes, cripto: ativo ? cripto : undefined, config, agora: () => T0, falhasPorIp, ...(limite ? { limite } : {}) });
  registro.verificar();
  return subir(app).then(s => {
    t.after(s.fechar);
    const post = (caminho, corpo, { portal = true, cookie, tipo = 'application/json', raw } = {}) => fetch(s.url + caminho, {
      method: 'POST',
      headers: { ...(tipo ? { 'Content-Type': tipo } : {}), ...(portal ? { 'X-Portal': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: raw !== undefined ? raw : JSON.stringify(corpo)
    });
    const get = (caminho, { cookie, headers = {} } = {}) => fetch(s.url + caminho, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
    const codigo = (p = PASSO, seg = segredo) => totp.codigoEm(seg, p);
    const login = (corpo, opcoes) => post('/portal/api/login', corpo, opcoes);
    const corretos = (extra = {}) => ({ email: 'ana@acme.com', senha: SENHA, codigo: codigo(), ...extra });
    return { banco, d, cripto, config, segredo, recuperacao, tokens, s, post, get, codigo, login, corretos, pool: banco.pool, sessoes };
  });
}

const cookieDe = res => (res.headers.get('set-cookie') || '').split(';')[0];
const espiar = (obj, nome, t) => {
  const original = obj[nome];
  const e = { n: 0 };
  obj[nome] = function (...args) { e.n++; return original.apply(this, args); };
  t.after(() => { obj[nome] = original; });
  return e;
};
function capturarLogs(t) {
  const linhas = [];
  const originais = {};
  for (const m of ['log', 'error', 'warn']) {
    originais[m] = console[m];
    console[m] = (...a) => linhas.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' '));
  }
  t.after(() => { for (const m of Object.keys(originais)) console[m] = originais[m]; });
  return linhas;
}
// um código de 6 dígitos que NÃO vale no segredo (nenhum dos passos da janela)
const codigoErrado = (segredo) => {
  const validos = new Set([PASSO - 1, PASSO, PASSO + 1].map(p => totp.codigoEm(segredo, p)));
  for (let i = 0; i < 1000; i++) { const c = String(i * 997 % 1000000).padStart(6, '0'); if (!validos.has(c)) return c; }
  throw new Error('impossível');
};
const hmacEmail = email => {
  const sub = crypto.createHmac('sha256', Buffer.from(CHAVE, 'base64')).update('portal-login-email-v1').digest();
  return crypto.createHmac('sha256', sub).update(email).digest('hex').slice(0, 12);
};

// ===================== convite: iniciar =====================

test('convite/iniciar: token inexistente, usado, expirado, lixo, usuário já ativo e empresa suspensa dão a MESMA 400', async t => {
  const c = await montar(t);
  const casos = [
    novoTokenOpaco().token, c.tokens.usado, c.tokens.expirado, c.tokens.usuarioAtivo, c.tokens.empresaSuspensa,
    'lixo', 'a'.repeat(42), 'a'.repeat(44), '+'.repeat(43), 123, null, undefined, ['x'], { $ne: 1 }
  ];
  for (const token of casos) {
    const r = await c.post('/portal/api/convite/iniciar', { token });
    assert.equal(r.status, 400, JSON.stringify(token));
    assert.deepEqual(await r.json(), MSG_CONVITE);
  }
});

test('convite/iniciar: formato inválido responde 400 sem tocar no banco', async t => {
  const c = await montar(t);
  for (const token of ['lixo', 'a'.repeat(42), 'a'.repeat(44), '+'.repeat(43), 7, null]) {
    const antes = c.pool.chamadas.length;
    const r = await c.post('/portal/api/convite/iniciar', { token });
    assert.equal(r.status, 400);
    assert.equal(c.pool.chamadas.length, antes, 'não pode consultar o banco');
  }
});

test('convite/iniciar: devolve e-mail, segredo, uri e versão do termo; grava o segredo CIFRADO e troca a cada chamada', async t => {
  const c = await montar(t);
  const r1 = await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok });
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.deepEqual(Object.keys(b1).sort(), ['email', 'segredo', 'termoVersao', 'uri']);
  assert.equal(b1.email, 'novo@acme.com');
  assert.equal(b1.termoVersao, 'T1');
  assert.match(b1.segredo, /^[A-Z2-7]{32}$/);
  assert.equal(b1.uri, totp.uriOtpauth({ segredo: b1.segredo, email: 'novo@acme.com' }));
  const u = c.d.usuarios.find(x => x.id === 2);
  assert.notEqual(u.totp_segredo_cifrado, b1.segredo);
  assert.match(u.totp_segredo_cifrado, /^v1:/);
  assert.equal(c.cripto.decifrar(u.totp_segredo_cifrado), b1.segredo);
  assert.equal(u.totp_ativo, 0);
  assert.equal(u.situacao, 'convidado');

  const b2 = await (await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok })).json();
  assert.notEqual(b2.segredo, b1.segredo, 'segredo novo a cada chamada');
  assert.equal(c.cripto.decifrar(c.d.usuarios.find(x => x.id === 2).totp_segredo_cifrado), b2.segredo);
  assert.equal(c.d.convites.find(x => x.usuario_id === 2).usado_em, null, 'iniciar não consome o convite');
});

test('convite/iniciar: o SQL valida convite, usuário e empresa e só regrava segredo de usuário ainda convidado', async t => {
  const c = await montar(t);
  await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok });
  const busca = c.pool.chamadas.find(x => /FROM web_portal_convites c/.test(x.sql));
  assert.match(busca.sql, /c\.token_hash = \?/);
  assert.match(busca.sql, /c\.usado_em IS NULL/);
  assert.match(busca.sql, /c\.expira_em > \?/);
  assert.match(busca.sql, /u\.situacao = 'convidado'/);
  assert.match(busca.sql, /e\.situacao = 'ativa'/);
  assert.equal(busca.params[0], hashToken(c.tokens.ok));
  const grava = c.pool.chamadas.find(x => /^UPDATE web_portal_usuarios SET totp_segredo_cifrado = \?/.test(x.sql));
  assert.match(grava.sql, /totp_ativo = 0/);
  assert.match(grava.sql, /situacao = 'convidado'/);
});

test('convite: o token em claro nunca chega ao banco (só o hash), em iniciar nem em concluir', async t => {
  const c = await montar(t);
  const ini = await (await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok })).json();
  await c.post('/portal/api/convite/concluir', { token: c.tokens.ok, senha: SENHA, codigo: c.codigo(PASSO, ini.segredo), aceitoTermo: true, termoVersao: 'T1' });
  const tudo = JSON.stringify(c.pool.chamadas.map(x => [x.sql, x.params]));
  assert.ok(!tudo.includes(c.tokens.ok));
  assert.ok(tudo.includes(hashToken(c.tokens.ok)));
});

// ===================== convite: concluir =====================

const concluirOk = (c, token, segredo, extra = {}) => c.post('/portal/api/convite/concluir',
  { token, senha: SENHA, codigo: c.codigo(PASSO, segredo), aceitoTermo: true, termoVersao: 'T1', ...extra });

test('convite/concluir: senha fraca, código errado, sem termo ou versão errada recusam SEM consumir o convite', async t => {
  const c = await montar(t);
  const ini = await (await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok })).json();
  const base = { token: c.tokens.ok, senha: SENHA, codigo: c.codigo(PASSO, ini.segredo), aceitoTermo: true, termoVersao: 'T1' };
  const ruins = [
    { senha: 'curta' }, { senha: 'novo@acme.com' }, { senha: 12345678901234 }, { senha: undefined },
    { codigo: codigoErrado(ini.segredo) }, { codigo: undefined }, { codigo: 123456 },
    { aceitoTermo: false }, { aceitoTermo: 'true' }, { aceitoTermo: 1 }, { aceitoTermo: undefined },
    { termoVersao: 'T0' }, { termoVersao: undefined }
  ];
  for (const ruim of ruins) {
    const r = await c.post('/portal/api/convite/concluir', { ...base, ...ruim });
    assert.equal(r.status, 400, JSON.stringify(ruim));
    const corpo = await r.json();
    assert.equal(typeof corpo.error, 'string');
    assert.ok(!('codigosRecuperacao' in corpo));
  }
  const u = c.d.usuarios.find(x => x.id === 2);
  assert.equal(u.situacao, 'convidado');
  assert.equal(u.senha_hash, null);
  assert.equal(u.totp_ativo, 0);
  assert.equal(c.d.convites.find(x => x.usuario_id === 2).usado_em, null, 'convite continua utilizável');
  assert.equal(c.d.recuperacao.filter(r => r.usuario_id === 2).length, 0);
  // e continua funcionando depois das falhas
  const certo = await c.post('/portal/api/convite/concluir', base);
  assert.equal(certo.status, 200);
});

test('convite/concluir: token inválido (inexistente, usado, expirado, lixo) dá a mesma 400 genérica, mesmo com o resto certo', async t => {
  const c = await montar(t);
  for (const token of [novoTokenOpaco().token, c.tokens.usado, c.tokens.expirado, c.tokens.usuarioAtivo, c.tokens.empresaSuspensa, 'lixo', 'a'.repeat(44), 5, undefined]) {
    const r = await c.post('/portal/api/convite/concluir', { token, senha: SENHA, codigo: c.codigo(), aceitoTermo: true, termoVersao: 'T1' });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), MSG_CONVITE);
  }
  assert.equal(c.d.usuarios.find(x => x.id === 8).totp_ultimo_passo, 0);
});

test('convite/concluir: sem ter chamado iniciar (sem segredo gravado) recusa e não consome', async t => {
  const c = await montar(t);
  const r = await concluirOk(c, c.tokens.semSegredo, c.segredo);
  assert.equal(r.status, 400);
  assert.equal(c.d.convites.find(x => x.id === 4).usado_em, null);
});

test('convite/concluir: ok ativa a conta, grava só o hash da senha, 10 códigos de recuperação só como HMAC e NÃO abre sessão', async t => {
  const c = await montar(t);
  const ini = await (await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok })).json();
  const r = await concluirOk(c, c.tokens.ok, ini.segredo);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('set-cookie'), null, 'concluir não abre sessão');
  const corpo = await r.json();
  assert.equal(corpo.ok, true);
  assert.equal(corpo.codigosRecuperacao.length, 10);
  assert.equal(new Set(corpo.codigosRecuperacao).size, 10);
  corpo.codigosRecuperacao.forEach(x => assert.match(x, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/));

  const u = c.d.usuarios.find(x => x.id === 2);
  assert.equal(u.situacao, 'ativo');
  assert.equal(u.totp_ativo, 1);
  assert.equal(u.totp_ultimo_passo, PASSO);
  assert.equal(u.termo_versao, 'T1');
  assert.ok(u.termo_aceito_em instanceof Date);
  assert.ok(u.senha_alterada_em instanceof Date);
  assert.notEqual(u.senha_hash, SENHA);
  assert.match(u.senha_hash, /^\$2[aby]\$12\$/);
  assert.ok(await bcrypt.compare(SENHA, u.senha_hash));
  assert.ok(c.d.convites.find(x => x.usuario_id === 2).usado_em instanceof Date);

  const gravados = c.d.recuperacao.filter(x => x.usuario_id === 2).map(x => x.codigo_hash).sort();
  assert.deepEqual(gravados, corpo.codigosRecuperacao.map(x => hashCodigoRecuperacao(x, CHAVE)).sort());
  const tudo = JSON.stringify(c.pool.chamadas.map(x => [x.sql, x.params]));
  corpo.codigosRecuperacao.forEach(x => assert.ok(!tudo.includes(x), 'código em claro no banco'));
  assert.ok(!tudo.includes(SENHA), 'senha em claro no banco');
  assert.ok(!tudo.includes(ini.segredo), 'segredo TOTP em claro no banco');

  const aud = c.d.auditoria.find(x => x.evento === 'convite_aceito');
  assert.equal(aud.usuario_id, 2);
  assert.equal(aud.cliente_codigo, 40);
  assert.ok(!JSON.stringify(c.d.auditoria).includes(SENHA));

  // convite usado: nova tentativa dá a 400 genérica
  const de_novo = await concluirOk(c, c.tokens.ok, ini.segredo);
  assert.equal(de_novo.status, 400);
  assert.deepEqual(await de_novo.json(), MSG_CONVITE);
  // e a conta já entra com os dados novos (próximo passo do TOTP)
  const l = await c.login({ email: 'novo@acme.com', senha: SENHA, codigo: c.codigo(PASSO + 1, ini.segredo) });
  assert.equal(l.status, 200);
});

test('convite/concluir: transação com FOR UPDATE no convite e no usuário, e o convite é reivindicado com WHERE usado_em IS NULL', async t => {
  const c = await montar(t);
  const ini = await (await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok })).json();
  c.pool.chamadas.length = 0;
  assert.equal((await concluirOk(c, c.tokens.ok, ini.segredo)).status, 200);
  const sqls = c.pool.chamadas.map(x => x.sql);
  const idx = re => sqls.findIndex(s => re.test(s));
  assert.ok(idx(/^BEGIN$/) >= 0 && idx(/^COMMIT$/) > idx(/^BEGIN$/));
  const sc = c.pool.chamadas.find(x => /FROM web_portal_convites WHERE token_hash/.test(x.sql));
  assert.match(sc.sql, /usado_em IS NULL/);
  assert.match(sc.sql, /expira_em > \?/);
  assert.match(sc.sql, /FOR UPDATE$/);
  assert.match(c.pool.chamadas.find(x => /FROM web_portal_usuarios WHERE id = \?/.test(x.sql) && /totp_segredo_cifrado/.test(x.sql)).sql, /FOR UPDATE$/);
  const claim = c.pool.chamadas.find(x => /^UPDATE web_portal_convites SET usado_em = \?/.test(x.sql));
  assert.match(claim.sql, /WHERE id = \? AND usado_em IS NULL/);
  assert.match(c.pool.chamadas.find(x => /^UPDATE web_portal_usuarios SET senha_hash/.test(x.sql)).sql, /situacao = 'convidado'/);
  assert.ok(idx(/^UPDATE web_portal_convites SET usado_em = \? WHERE id/) < idx(/^UPDATE web_portal_usuarios SET senha_hash/), 'reivindica o convite antes de gravar a conta');
  assert.ok(idx(/^COMMIT$/) > idx(/^INSERT INTO web_portal_recuperacao/));
  const ativ = c.pool.chamadas.find(x => /^UPDATE web_portal_usuarios SET senha_hash/.test(x.sql));
  const SET = /SET senha_hash = \?, totp_ativo = 1, totp_ultimo_passo = \?, situacao = 'ativo',\s+termo_versao = \?, termo_aceito_em = \?, senha_alterada_em = \? WHERE id = \? AND situacao = 'convidado'$/;
  assert.match(ativ.sql, SET);
  assert.match(ativ.params[0], /^\$2[aby]\$12\$/);
  assert.deepEqual(ativ.params.slice(1, 3), [PASSO, 'T1']);
  assert.ok(ativ.params[3] instanceof Date && ativ.params[4] instanceof Date);
  assert.equal(ativ.params[5], 2);
});

test('convite/concluir: duas conclusões simultâneas, só uma vence e há um único conjunto de códigos', async t => {
  const c = await montar(t);
  const ini = await (await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok })).json();
  const [a, b] = await Promise.all([concluirOk(c, c.tokens.ok, ini.segredo), concluirOk(c, c.tokens.ok, ini.segredo)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  const perdedora = a.status === 400 ? a : b;
  assert.deepEqual(await perdedora.json(), MSG_CONVITE);
  assert.equal(c.d.recuperacao.filter(x => x.usuario_id === 2).length, 10);
  assert.equal(c.d.auditoria.filter(x => x.evento === 'convite_aceito').length, 1);
});

// ===================== login =====================

test('login ok: cookie com todos os atributos, corpo do usuário, sessão no banco e auditoria login_ok', async t => {
  const c = await montar(t);
  const r = await c.login(c.corretos());
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), COOKIE_RE);
  const corpo = await r.json();
  assert.deepEqual(corpo, { ok: true, usuario: { email: 'ana@acme.com', papel: 'admin_geral', empresa: { codigo: 40, razaoSocial: 'ACME LTDA' }, permissoes: TRES } });
  const token = cookieDe(r).split('=')[1];
  const sessao = c.d.sessoes.find(x => x.id === hashToken(token));
  assert.equal(sessao.usuario_id, 1);
  assert.ok(!c.d.sessoes.some(x => x.id === token), 'só o hash vai ao banco');
  assert.equal(c.d.usuarios.find(x => x.id === 1).totp_ultimo_passo, PASSO);
  const aud = c.d.auditoria.find(x => x.evento === 'login_ok');
  assert.equal(aud.usuario_id, 1);
  assert.equal(aud.cliente_codigo, 40);
  // e a sessão vale nas rotas do portal
  const eu = await c.get('/portal/api/eu', { cookie: cookieDe(r) });
  assert.equal(eu.status, 200);
  assert.deepEqual((await eu.json()).usuario, corpo.usuario);
});

test('login: e-mail com maiúsculas e espaços é normalizado', async t => {
  const c = await montar(t);
  const r = await c.login(c.corretos({ email: '  ANA@Acme.COM ' }));
  assert.equal(r.status, 200);
});

test('login: TODA falha dá a mesma 401 e o bcrypt e a verificação TOTP rodam exatamente 1 vez em todos os caminhos', async t => {
  const c = await montar(t);
  const b = espiar(bcrypt, 'compare', t);
  const v = espiar(totp, 'verificar', t);
  const casos = {
    'e-mail inexistente': c.corretos({ email: 'fantasma@acme.com' }),
    'e-mail inválido': c.corretos({ email: 'isto nao e email' }),
    'senha errada': c.corretos({ senha: 'Senha-Errada-9999' }),
    'código errado': c.corretos({ codigo: codigoErrado(c.segredo) }),
    'empresa suspensa': { email: 'bia@beta.com', senha: SENHA, codigo: c.codigo() },
    'usuário inativo': { email: 'ivo@acme.com', senha: SENHA, codigo: c.codigo() },
    'usuário convidado': { email: 'novo@acme.com', senha: SENHA, codigo: c.codigo() },
    'corpo vazio': {},
    'tipos errados': { email: 5, senha: { a: 1 }, codigo: [1] },
    'recuperação inválida': { email: 'ana@acme.com', senha: SENHA, codigoRecuperacao: 'ZZZZ-ZZZZ' }
  };
  for (const [nome, corpo] of Object.entries(casos)) {
    b.n = 0; v.n = 0;
    const r = await c.login(corpo);
    assert.equal(r.status, 401, nome);
    assert.deepEqual(await r.json(), MSG_LOGIN, nome);
    assert.equal(r.headers.get('set-cookie'), null, nome);
    assert.equal(b.n, 1, `bcrypt.compare em "${nome}"`);
    assert.equal(v.n, 1, `totp.verificar em "${nome}"`);
  }
  // caminho de sucesso (código TOTP e também código de recuperação) também faz 1 e 1
  b.n = 0; v.n = 0;
  assert.equal((await c.login(c.corretos())).status, 200);
  assert.deepEqual([b.n, v.n], [1, 1]);
  b.n = 0; v.n = 0;
  assert.equal((await c.login({ email: 'ana@acme.com', senha: SENHA, codigoRecuperacao: c.recuperacao.codigos[0] })).status, 200);
  assert.deepEqual([b.n, v.n], [1, 1]);
  assert.equal(c.d.sessoes.length, 2, 'só os dois sucessos abriram sessão');
});

test('login: empresa suspensa e usuário inativo recebem a resposta uniforme e geram login_negado; falha comum gera login_falha', async t => {
  const c = await montar(t);
  await c.login({ email: 'bia@beta.com', senha: SENHA, codigo: c.codigo() });
  await c.login({ email: 'ivo@acme.com', senha: SENHA, codigo: c.codigo() });
  await c.login(c.corretos({ senha: 'Senha-Errada-9999' }));
  const eventos = c.d.auditoria.map(x => [x.evento, x.usuario_id]);
  assert.deepEqual(eventos, [['login_negado', 3], ['login_negado', 4], ['login_falha', 1]]);
  assert.equal(c.d.sessoes.length, 0);
});

test('login: a empresa com nome duplicado em cadastro_clientes também é negada', async t => {
  const c = await montar(t);
  c.d.clientes.push({ CODIGO: 99, RAZAO_SOCIAL: 'ACME LTDA' });
  const r = await c.login(c.corretos());
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), MSG_LOGIN);
});

test('login: 5 falhas bloqueiam a conta com 429 igual para conta real e inexistente, antes de qualquer trabalho caro', async t => {
  const real = await montar(t);
  const b = espiar(bcrypt, 'compare', t);
  for (let i = 0; i < 5; i++) assert.equal((await real.login(real.corretos({ senha: 'Senha-Errada-9999' }))).status, 401);
  b.n = 0;
  const v = espiar(totp, 'verificar', t);
  const bloqueada = await real.login(real.corretos());
  assert.equal(bloqueada.status, 429);
  const corpoReal = await bloqueada.json();
  assert.deepEqual(corpoReal, MSG_LIMITE);
  assert.equal(b.n, 0, 'bloqueada não gasta bcrypt');
  assert.equal(v.n, 0, 'bloqueada não gasta TOTP');
  assert.equal(real.d.sessoes.length, 0);
  assert.ok(real.d.auditoria.some(x => x.evento === 'login_bloqueado' && x.usuario_id === 1));

  const outra = await montar(t); // outro app: o limite por IP não interfere
  for (let i = 0; i < 5; i++) assert.equal((await outra.login(outra.corretos({ email: 'fantasma@acme.com' }))).status, 401);
  const r2 = await outra.login(outra.corretos({ email: 'fantasma@acme.com' }));
  assert.equal(r2.status, 429);
  assert.deepEqual(await r2.json(), corpoReal);
  const bloq = outra.d.auditoria.find(x => x.evento === 'login_bloqueado');
  assert.equal(bloq.usuario_id, null);
  assert.ok(!JSON.stringify(outra.d.auditoria).includes('fantasma@acme.com'));
});

test('login: limite por IP (10 falhas) responde 429; sucessos não contam', async t => {
  const c = await montar(t, { falhasPorIp: 10 });
  // 10 sucessos (um código de recuperação cada) não consomem o limite por IP
  for (const codigo of c.recuperacao.codigos) {
    assert.equal((await c.login({ email: 'ana@acme.com', senha: SENHA, codigoRecuperacao: codigo })).status, 200);
  }
  for (let i = 0; i < 10; i++) {
    const r = await c.login({ email: `fantasma${i}@acme.com`, senha: SENHA, codigo: '123456' });
    assert.equal(r.status, 401, `falha ${i}`);
  }
  const r = await c.login(c.corretos({ email: 'fantasma99@acme.com' }));
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), MSG_LIMITE);
  // o limite vale também para as outras rotas públicas
  const r2 = await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok });
  assert.equal(r2.status, 429);
});

test('login: o mesmo código TOTP duas vezes, a segunda é recusada', async t => {
  const c = await montar(t);
  const cod = c.codigo();
  assert.equal((await c.login({ email: 'ana@acme.com', senha: SENHA, codigo: cod })).status, 200);
  const r = await c.login({ email: 'ana@acme.com', senha: SENHA, codigo: cod });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), MSG_LOGIN);
  // código de um passo ANTERIOR ao já usado também não vale; o próximo passo vale
  assert.equal((await c.login({ email: 'ana@acme.com', senha: SENHA, codigo: c.codigo(PASSO - 1) })).status, 401);
  assert.equal((await c.login({ email: 'ana@acme.com', senha: SENHA, codigo: c.codigo(PASSO + 1) })).status, 200);
});

test('login: dois logins simultâneos com o mesmo código TOTP, só um passa (anti-replay atômico)', async t => {
  const c = await montar(t);
  const cod = c.codigo();
  const rs = await Promise.all([1, 2, 3].map(() => c.login({ email: 'ana@acme.com', senha: SENHA, codigo: cod })));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 401, 401]);
  assert.equal(c.d.sessoes.length, 1);
  const up = c.pool.chamadas.find(x => /^UPDATE web_portal_usuarios SET totp_ultimo_passo/.test(x.sql));
  assert.match(up.sql, /WHERE id = \? AND totp_ultimo_passo < \?$/);
  assert.deepEqual(up.params, [PASSO, 1, PASSO]);
});

test('login: com a senha errada o código TOTP não é consumido', async t => {
  const c = await montar(t);
  const cod = c.codigo();
  assert.equal((await c.login({ email: 'ana@acme.com', senha: 'Senha-Errada-9999', codigo: cod })).status, 401);
  assert.equal(c.d.usuarios.find(x => x.id === 1).totp_ultimo_passo, 0);
  assert.equal((await c.login({ email: 'ana@acme.com', senha: SENHA, codigo: cod })).status, 200);
});

test('login: código de recuperação vale uma vez só (com ou sem hífen e maiúsculas) e só com a senha certa', async t => {
  const c = await montar(t);
  const [a, b] = c.recuperacao.codigos;
  // senha errada não consome
  assert.equal((await c.login({ email: 'ana@acme.com', senha: 'Senha-Errada-9999', codigoRecuperacao: a })).status, 401);
  assert.equal(c.d.recuperacao.filter(x => x.usado_em).length, 0);
  assert.equal((await c.login({ email: 'ana@acme.com', senha: SENHA, codigoRecuperacao: a })).status, 200);
  assert.equal(c.d.recuperacao.filter(x => x.usado_em).length, 1);
  const repetido = await c.login({ email: 'ana@acme.com', senha: SENHA, codigoRecuperacao: a });
  assert.equal(repetido.status, 401);
  assert.deepEqual(await repetido.json(), MSG_LOGIN);
  assert.equal((await c.login({ email: 'ana@acme.com', senha: SENHA, codigoRecuperacao: b.toLowerCase().replace('-', ' ') })).status, 200);
  const up = c.pool.chamadas.find(x => /^UPDATE web_portal_recuperacao SET usado_em/.test(x.sql));
  assert.match(up.sql, /WHERE usuario_id = \? AND codigo_hash = \? AND usado_em IS NULL$/);
  assert.equal(up.params[2], hashCodigoRecuperacao(a, CHAVE));
  assert.ok(!JSON.stringify(c.pool.chamadas.map(x => x.params)).includes(a), 'código em claro no banco');
});

test('login: o mesmo código de recuperação em dois logins simultâneos, só um passa', async t => {
  const c = await montar(t);
  const rs = await Promise.all([1, 2].map(() => c.login({ email: 'ana@acme.com', senha: SENHA, codigoRecuperacao: c.recuperacao.codigos[3] })));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 401]);
});

test('login: código de recuperação de OUTRA conta não vale', async t => {
  const c = await montar(t);
  const r = await c.login({ email: 'oito@acme.com', senha: SENHA, codigoRecuperacao: c.recuperacao.codigos[0] });
  assert.equal(r.status, 401);
  assert.equal(c.d.recuperacao.filter(x => x.usado_em).length, 0);
});

test('login: auditoria de e-mail inexistente leva só um HMAC curto, nunca o e-mail; nada em log, resposta ou auditoria vaza segredos', async t => {
  const logs = capturarLogs(t);
  const c = await montar(t);
  const respostas = [];
  const guarda = async r => { respostas.push(JSON.stringify([...r.headers.entries()]) + await r.text()); };
  await guarda(await c.login({ email: 'Fantasma@Acme.com', senha: SENHA, codigo: '123456' }));
  await guarda(await c.login(c.corretos({ senha: 'Senha-Errada-9999' })));
  await guarda(await c.login(c.corretos()));
  const falha = c.d.auditoria.find(x => x.evento === 'login_falha' && x.usuario_id === null);
  assert.ok(falha);
  assert.ok(falha.detalhe.includes(hmacEmail('fantasma@acme.com')));
  assert.match(falha.detalhe, /[0-9a-f]{12}/);
  const auditoria = JSON.stringify(c.d.auditoria);
  const proibidos = [SENHA, 'Senha-Errada-9999', c.segredo, ...c.recuperacao.codigos, 'fantasma@acme.com', 'Fantasma@Acme.com', c.codigo()];
  const tudo = [auditoria, logs.join('\n'), respostas.slice(0, 2).join('\n')].join('\n');
  for (const p of proibidos) assert.ok(!tudo.includes(p), `vazou: ${String(p).slice(0, 4)}...`);
  // a resposta de sucesso só traz o e-mail do próprio usuário, nunca senha, segredo ou código
  for (const p of [SENHA, c.segredo, ...c.recuperacao.codigos]) assert.ok(!respostas[2].includes(p));
});

test('login: erro de banco vira 500 genérico e o log leva só o código do erro', async t => {
  const logs = capturarLogs(t);
  const c = await montar(t);
  c.pool.execute = async () => { throw Object.assign(new Error('SEGREDO-NO-ERRO senha=abc'), { code: 'ER_FALSO' }); };
  const r = await c.login(c.corretos());
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'Erro de servidor' });
  const txt = logs.join('\n');
  assert.match(txt, /ER_FALSO/);
  assert.ok(!txt.includes('SEGREDO-NO-ERRO'));
  const r2 = await c.post('/portal/api/convite/iniciar', { token: c.tokens.ok });
  assert.equal(r2.status, 500);
  assert.ok(!logs.join('\n').includes('SEGREDO-NO-ERRO'));
});

// ===================== exigências comuns das rotas públicas =====================

test('rotas públicas POST: sem X-Portal dá 403; sem JSON ou com corpo que não é objeto dá 400', async t => {
  const c = await montar(t);
  const rotas = ['/portal/api/login', '/portal/api/convite/iniciar', '/portal/api/convite/concluir'];
  for (const rota of rotas) {
    const sem = await c.post(rota, c.corretos(), { portal: false });
    assert.equal(sem.status, 403, rota);
    assert.deepEqual(await sem.json(), { error: 'Requisição recusada.' });
    const texto = await c.post(rota, null, { tipo: 'text/plain', raw: JSON.stringify(c.corretos()) });
    assert.equal(texto.status, 400, rota);
    const semTipo = await c.post(rota, null, { tipo: null, raw: JSON.stringify(c.corretos()) });
    assert.equal(semTipo.status, 400, rota);
    const lista = await c.post(rota, null, { raw: '[]' });
    assert.equal(lista.status, 400, rota);
    const nulo = await c.post(rota, null, { raw: 'null' });
    assert.ok([400].includes(nulo.status), rota);
  }
  assert.equal(c.d.sessoes.length, 0);
  assert.equal(c.d.usuarios.find(x => x.id === 1).totp_ultimo_passo, 0, 'nada foi processado');
});

test('portal inativo: as três rotas públicas e as autenticadas respondem 503, sem precisar de cripto', async t => {
  const c = await montar(t, { ativo: false });
  for (const rota of ['/portal/api/login', '/portal/api/convite/iniciar', '/portal/api/convite/concluir']) {
    const r = await c.post(rota, {});
    assert.equal(r.status, 503, rota);
    assert.deepEqual(await r.json(), { error: 'Portal não configurado.' });
  }
  assert.equal((await c.get('/portal/api/eu')).status, 503);
  assert.equal(c.pool.chamadas.length, 0);
});

// ===================== logout e /eu =====================

test('logout: revoga a sessão, limpa o cookie, audita; a mesma sessão dá 401 depois e repetir é idempotente (200)', async t => {
  const c = await montar(t);
  const cookie = cookieDe(await c.login(c.corretos()));
  const r = await c.post('/portal/api/logout', {}, { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(r.headers.get('set-cookie'), '__Host-portal=; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Path=/');
  assert.equal(c.d.sessoes[0].revogada, 1);
  const aud = c.d.auditoria.find(x => x.evento === 'logout');
  assert.equal(aud.usuario_id, 1);
  assert.equal(aud.cliente_codigo, 40);
  assert.equal((await c.get('/portal/api/eu', { cookie })).status, 401);
  const de_novo = await c.post('/portal/api/logout', {}, { cookie });
  assert.equal(de_novo.status, 200);
  assert.match(de_novo.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(c.d.auditoria.filter(x => x.evento === 'logout').length, 1, 'só a sessão válida é auditada');
});

test('logout: sem sessão, cookie lixo ou JWT de funcionário também dá 200 e limpa o cookie, sem revogar a sessão de outra pessoa', async t => {
  const c = await montar(t);
  const outra = cookieDe(await c.login(c.corretos()));
  const jwtFunc = jwt.sign({ id: 1, tipo: 'funcionario', v: 2, sid: 'x' }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
  for (const cookie of [undefined, '__Host-portal=lixo', `__Host-portal=${jwtFunc}`, `__Host-portal=${novoTokenOpaco().token}`]) {
    const r = await c.post('/portal/api/logout', {}, { cookie });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.match(r.headers.get('set-cookie'), /^__Host-portal=; Max-Age=0;/);
  }
  assert.equal(c.d.sessoes[0].revogada, 0);
  assert.equal((await c.get('/portal/api/eu', { cookie: outra })).status, 200);
});

test('logout: usuário de empresa suspensa ainda encerra a própria sessão (a sessão é revogada)', async t => {
  const c = await montar(t);
  const cookie = cookieDe(await c.login(c.corretos()));
  c.d.empresas.find(e => e.cliente_codigo === 40).situacao = 'suspensa';
  assert.equal((await c.get('/portal/api/eu', { cookie })).status, 401, 'as rotas do portal já recusam');
  const r = await c.post('/portal/api/logout', {}, { cookie });
  assert.equal(r.status, 200);
  assert.equal(c.d.sessoes[0].revogada, 1);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  // reativada a empresa, a sessão revogada continua morta
  c.d.empresas.find(e => e.cliente_codigo === 40).situacao = 'ativa';
  assert.equal((await c.get('/portal/api/eu', { cookie })).status, 401);
});

test('logout: sem X-Portal ou com Origin de outro site dá 403 e a sessão continua valendo', async t => {
  const c = await montar(t);
  const cookie = cookieDe(await c.login(c.corretos()));
  const sem = await c.post('/portal/api/logout', {}, { cookie, portal: false });
  assert.equal(sem.status, 403);
  const outro = await fetch(c.s.url + '/portal/api/logout', { method: 'POST', headers: { 'X-Portal': '1', Cookie: cookie, Origin: 'https://malvado.exemplo' } });
  assert.equal(outro.status, 403);
  assert.equal(c.d.sessoes[0].revogada, 0);
  const certo = await fetch(c.s.url + '/portal/api/logout', { method: 'POST', headers: { 'X-Portal': '1', Cookie: cookie, Origin: BASE } });
  assert.equal(certo.status, 200);
  assert.equal(c.d.sessoes[0].revogada, 1);
});

test('/eu: com sessão devolve o usuário; sem sessão dá 401', async t => {
  const c = await montar(t);
  assert.equal((await c.get('/portal/api/eu')).status, 401);
  const cookie = cookieDe(await c.login(c.corretos()));
  const r = await c.get('/portal/api/eu', { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { usuario: { email: 'ana@acme.com', papel: 'admin_geral', empresa: { codigo: 40, razaoSocial: 'ACME LTDA' }, permissoes: TRES } });
});

test('/eu: usuário comum devolve só as permissões gravadas', async t => {
  const c = await montar(t);
  c.d.usuarios.find(x => x.id === 1).papel = 'usuario';
  c.d.permissoes.push({ usuario_id: 1, permissao: 'pedidos.ver' });
  const cookie = cookieDe(await c.login(c.corretos()));
  const r = await c.get('/portal/api/eu', { cookie });
  assert.deepEqual((await r.json()).usuario.permissoes, ['pedidos.ver']);
});

test('cookie e Bearer cruzados: JWT de funcionário (ou qualquer token) como cookie dá 401 nas rotas do portal', async t => {
  const c = await montar(t);
  const jwtFunc = jwt.sign({ id: 1, nome: 'Thiago', v: 2, tipo: 'funcionario', sid: 'x' }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
  assert.equal((await c.get('/portal/api/eu', { cookie: `__Host-portal=${jwtFunc}` })).status, 401);
  assert.equal((await c.get('/portal/api/eu', { cookie: `__Host-portal=${novoTokenOpaco().token}` })).status, 401);
  assert.equal((await c.get('/portal/api/eu', { cookie: `__Host-portal=${hashToken('x')}` })).status, 401);
  assert.equal((await c.get('/portal/api/eu', { headers: { Authorization: `Bearer ${jwtFunc}` } })).status, 401);
});

test('o login não reaproveita sessão de funcionário: o token opaco do cookie é só o do portal', async t => {
  const c = await montar(t);
  const r = await c.login(c.corretos());
  const token = cookieDe(r).split('=')[1];
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.throws(() => jwt.verify(token, 'teste'));
});

test('app real: as rotas de autenticação estão no registro (listas EXATAS) e, com o portal inativo, respondem 503', async t => {
  const { app, registro, configPortal } = require('../index.js');
  const lista = rs => rs.map(r => r.metodo + ' ' + r.caminho).sort();
  // logout é público de propósito: precisa funcionar para conta/empresa já suspensa (guarda próprio de sessão + CSRF)
  assert.deepEqual(lista(registro.rotasPortalPublicas()), [
    'post /portal/api/convite/concluir', 'post /portal/api/convite/iniciar', 'post /portal/api/login', 'post /portal/api/logout'
  ]);
  assert.deepEqual(lista(registro.rotasPortal()), ['get /portal/api/eu']);
  assert.doesNotThrow(() => registro.verificar());
  const antes = configPortal.ativo;
  configPortal.ativo = false;
  t.after(() => { configPortal.ativo = antes; });
  const s = await subir(app);
  t.after(s.fechar);
  const r = await fetch(s.url + '/portal/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': '1' }, body: '{}' });
  assert.equal(r.status, 503);
  const r2 = await fetch(s.url + '/portal/api/logout', { method: 'POST', headers: { 'X-Portal': '1' } });
  assert.equal(r2.status, 503);
});

test('login: o SQL de busca é uma consulta única com derivado, LEFT JOINs e COUNT contra COALESCE (mesmo plano com ou sem conta)', async t => {
  const c = await montar(t);
  await c.login(c.corretos());
  await c.login(c.corretos({ email: 'fantasma@acme.com' }));
  const buscas = c.pool.chamadas.filter(x => /^SELECT u\.id, u\.email/.test(x.sql));
  assert.equal(buscas.length, 2);
  const sql = buscas[0].sql.replace(/\s+/g, ' ');
  assert.match(sql, /FROM \(SELECT \? AS em\) k LEFT JOIN web_portal_usuarios u ON u\.email = k\.em/);
  assert.match(sql, /LEFT JOIN web_portal_empresas e ON e\.cliente_codigo = u\.cliente_codigo/);
  assert.match(sql, /LEFT JOIN cadastro_clientes c ON c\.CODIGO = u\.cliente_codigo/);
  assert.match(sql, /\(SELECT COUNT\(\*\) FROM cadastro_clientes d WHERE d\.RAZAO_SOCIAL = COALESCE\(c\.RAZAO_SOCIAL, '[^']+'\)\) AS qtd_nome/);
  assert.match(sql, /LIMIT 1$/);
  assert.equal(buscas[1].sql, buscas[0].sql, 'o mesmo texto para qualquer e-mail');
  assert.deepEqual(buscas[0].params, ['ana@acme.com']);
  assert.deepEqual(buscas[1].params, ['fantasma@acme.com']);
});

test('login: a SEQUÊNCIA de consultas ao banco é idêntica em todos os caminhos de falha (sem oráculo por nº de idas ao banco)', async t => {
  const c = await montar(t);
  const dup = await montar(t); // nome duplicado em cadastro_clientes
  dup.d.clientes.push({ CODIGO: 99, RAZAO_SOCIAL: 'ACME LTDA' });
  const corpos = {
    codigo: (extra, base) => ({ senha: SENHA, codigo: base.codigo(), ...extra }),
    codigoRecuperacao: (extra, base) => ({ senha: SENHA, codigoRecuperacao: base.recuperacao.codigos[0], ...extra })
  };
  for (const [forma, mk] of Object.entries(corpos)) {
    const erradoDoCampo = forma === 'codigo' ? { codigo: codigoErrado(c.segredo) } : { codigoRecuperacao: 'ZZZZ-ZZZZ' };
    const casos = {
      'e-mail inexistente': [c, { email: 'fantasma@acme.com' }],
      'e-mail inválido': [c, { email: 'isto nao e email' }],
      'senha errada': [c, { email: 'ana@acme.com', senha: 'Senha-Errada-9999' }],
      'código errado': [c, { email: 'ana@acme.com', ...erradoDoCampo }],
      'usuário inativo': [c, { email: 'ivo@acme.com' }],
      'usuário convidado': [c, { email: 'novo@acme.com' }],
      'empresa suspensa': [c, { email: 'bia@beta.com' }],
      'nome duplicado': [dup, { email: 'ana@acme.com' }]
    };
    const vistas = {};
    for (const [nome, [base, extra]] of Object.entries(casos)) {
      const de = base.pool.chamadas.length;
      const r = await base.login(mk(extra, base));
      assert.equal(r.status, 401, forma + ' / ' + nome);
      vistas[nome] = sequencia(base, de);
    }
    const referencia = vistas['e-mail inexistente'];
    // 1 busca + 1 UPDATE de consumo (do campo enviado) + 1 auditoria, SEMPRE
    assert.equal(referencia.length, 3, forma);
    assert.match(referencia[0], /^SELECT u\.id/);
    assert.match(referencia[1], forma === 'codigo' ? /^UPDATE web_portal_usuarios SET totp_ultimo_passo/ : /^UPDATE web_portal_recuperacao SET usado_em/);
    assert.match(referencia[2], /^INSERT INTO web_portal_auditoria/);
    for (const [nome, seq] of Object.entries(vistas)) assert.deepEqual(seq, referencia, forma + ' / ' + nome);

    // sucesso: a mesma sequência, só com a criação da sessão a mais (depois de decidida a resposta)
    const de = c.pool.chamadas.length;
    const ok = await c.login(mk({ email: 'ana@acme.com', ...(forma === 'codigo' ? { codigo: c.codigo(PASSO + 1) } : {}) }, c));
    assert.equal(ok.status, 200, forma);
    const sucesso = sequencia(c, de);
    assert.deepEqual(sucesso.filter(x => !/^INSERT INTO web_portal_sessoes/.test(x)), referencia, forma);
    assert.equal(sucesso.length, referencia.length + 1);
  }
});

// sequência de SQL de uma tentativa (prefixos normalizados)
const sequencia = (c, de) => c.pool.chamadas.slice(de).map(x => x.sql.replace(/\s+/g, ' ').slice(0, 55));

test('login: o corpo com os DOIS campos roda os DOIS UPDATEs nos MESMOS 8 caminhos de falha (a forma do corpo decide, não a conta)', async t => {
  const c = await montar(t);
  const dup = await montar(t);
  dup.d.clientes.push({ CODIGO: 99, RAZAO_SOCIAL: 'ACME LTDA' });
  const corpo = (base, extra) => ({ senha: SENHA, codigo: base.codigo(), codigoRecuperacao: base.recuperacao.codigos[0], ...extra });
  const casos = {
    'e-mail inexistente': [c, { email: 'fantasma@acme.com' }],
    'e-mail inválido': [c, { email: 'isto nao e email' }],
    'senha errada': [c, { email: 'ana@acme.com', senha: 'Senha-Errada-9999' }],
    'código errado': [c, { email: 'ana@acme.com', codigo: codigoErrado(c.segredo), codigoRecuperacao: 'ZZZZ-ZZZZ' }],
    'usuário inativo': [c, { email: 'ivo@acme.com' }],
    'usuário convidado': [c, { email: 'novo@acme.com' }],
    'empresa suspensa': [c, { email: 'bia@beta.com' }],
    'nome duplicado': [dup, { email: 'ana@acme.com' }]
  };
  const seqs = {};
  for (const [nome, [base, extra]] of Object.entries(casos)) {
    const de = base.pool.chamadas.length;
    assert.equal((await base.login(corpo(base, extra))).status, 401, nome);
    seqs[nome] = sequencia(base, de);
  }
  const ref = seqs['e-mail inexistente'];
  assert.equal(ref.length, 4);
  assert.match(ref[1], /^UPDATE web_portal_usuarios SET totp_ultimo_passo/);
  assert.match(ref[2], /^UPDATE web_portal_recuperacao SET usado_em/);
  for (const [nome, sq] of Object.entries(seqs)) assert.deepEqual(sq, ref, nome);
  assert.equal(c.d.recuperacao.filter(x => x.usado_em).length, 0, 'nada foi consumido');
});

test('login: UPDATEs de consumo SEM direito vão com alvo 0 (id 0, passo 0, usuario_id 0); COM direito, com os valores reais', async t => {
  const c = await montar(t);
  const updates = de => c.pool.chamadas.slice(de).filter(x => /^UPDATE/.test(x.sql));
  const semDireito = [
    { email: 'fantasma@acme.com' }, { email: 'ana@acme.com', senha: 'Senha-Errada-9999' },
    { email: 'ivo@acme.com' }, { email: 'bia@beta.com' }, { email: 'ana@acme.com', codigo: codigoErrado(c.segredo), codigoRecuperacao: 'ZZZZ-ZZZZ' }
  ];
  for (const extra of semDireito) {
    const de = c.pool.chamadas.length;
    const r = await c.login({ senha: SENHA, codigo: c.codigo(), codigoRecuperacao: c.recuperacao.codigos[0], ...extra });
    assert.equal(r.status, 401, JSON.stringify(extra));
    const [tot, rec] = updates(de);
    assert.deepEqual(tot.params, [0, 0, 0], 'TOTP sem direito: passo 0, id 0');
    // com a senha certa e a conta ativa há direito de TENTAR a recuperação (alvo real, hash que não casa); nos demais, 0
    const tentaReal = extra.email === 'ana@acme.com' && extra.codigo !== undefined;
    assert.equal(rec.params[1], tentaReal ? 1 : 0, 'recuperação: usuario_id ' + (tentaReal ? 'real (hash não casa)' : '0'));
    assert.ok(!c.recuperacao.codigos.some(x => JSON.stringify(rec.params).includes(x)), 'o código nunca vai em claro');
  }
  // com direito (TOTP): passo e id reais, e o UPDATE de recuperação continua com 0 quando o TOTP valeu
  let de = c.pool.chamadas.length;
  assert.equal((await c.login({ senha: SENHA, codigo: c.codigo(), codigoRecuperacao: c.recuperacao.codigos[0], email: 'ana@acme.com' })).status, 200);
  let [tot, rec] = updates(de);
  assert.deepEqual(tot.params, [PASSO, 1, PASSO]);
  assert.equal(rec.params[1], 0);
  // com direito (recuperação, sem codigo): usuario_id real
  de = c.pool.chamadas.length;
  assert.equal((await c.login({ senha: SENHA, codigoRecuperacao: c.recuperacao.codigos[1], email: 'ana@acme.com' })).status, 200);
  [rec] = updates(de);
  assert.equal(rec.params[1], 1);
  assert.equal(rec.params[2], hashCodigoRecuperacao(c.recuperacao.codigos[1], CHAVE));
});

test('429: conta real e inexistente dão o mesmo corpo, Retry-After e cabeçalhos RateLimit-*', async t => {
  const limite = () => criarLimiteLogin({ agora: () => T0 });
  const real = await montar(t, { limite: limite() });
  const falsa = await montar(t, { limite: limite() });
  for (let i = 0; i < 5; i++) {
    await real.login(real.corretos({ senha: 'Senha-Errada-9999' }));
    await falsa.login(falsa.corretos({ email: 'fantasma@acme.com' }));
  }
  const a = await real.login(real.corretos());
  const b = await falsa.login(falsa.corretos({ email: 'fantasma@acme.com' }));
  assert.equal(a.status, 429);
  assert.equal(b.status, 429);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(a.headers.get('retry-after'), b.headers.get('retry-after'));
  assert.ok(a.headers.get('retry-after'));
  const rl = r => Object.fromEntries([...r.headers.entries()].filter(([k]) => k.startsWith('ratelimit')));
  const [ha, hb] = [rl(a), rl(b)];
  assert.deepEqual(Object.keys(ha).sort(), Object.keys(hb).sort());
  assert.ok(Object.keys(ha).length > 0);
  for (const k of Object.keys(ha)) {
    if (/reset/.test(k)) assert.ok(Math.abs(Number(ha[k]) - Number(hb[k])) <= 1, k);
    else assert.equal(ha[k], hb[k], k);
  }
});

test('429: o trabalho de banco é o mesmo para conta real e inexistente (SELECT único + auditoria, sem UPDATEs)', async t => {
  const limite = () => criarLimiteLogin({ agora: () => T0 });
  const real = await montar(t, { limite: limite() });
  const falsa = await montar(t, { limite: limite() });
  for (let i = 0; i < 5; i++) {
    await real.login(real.corretos({ senha: 'Senha-Errada-9999' }));
    await falsa.login(falsa.corretos({ email: 'fantasma@acme.com' }));
  }
  const dr = real.pool.chamadas.length, df = falsa.pool.chamadas.length;
  assert.equal((await real.login(real.corretos())).status, 429);
  assert.equal((await falsa.login(falsa.corretos({ email: 'fantasma@acme.com' }))).status, 429);
  const a = sequencia(real, dr), b = sequencia(falsa, df);
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.match(a[0], /^SELECT u\.id/);
  assert.match(a[1], /^INSERT INTO web_portal_auditoria/);
});

test('razão social vazia: login e rotas do portal concordam em negar (não identifica a empresa nos pedidos)', async t => {
  const c = await montar(t);
  const cookie = cookieDe(await c.login(c.corretos()));
  assert.equal((await c.get('/portal/api/eu', { cookie })).status, 200);
  c.d.clientes.find(x => x.CODIGO === 40).RAZAO_SOCIAL = '';
  assert.equal((await c.get('/portal/api/eu', { cookie })).status, 401);
  const r = await c.login(c.corretos({ codigo: c.codigo(PASSO + 1) }));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), MSG_LOGIN);
});
