process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerCookie, cookieSessao, cookieLimpar } = require('../portal/cookie');
const { criarSessoesPortal } = require('../portal/sessoes');
const { hashToken } = require('../portal/tokens');
const { criarBancoPortal } = require('./apoio/bancoPortal');

const MIN = 60 * 1000;
const T0 = new Date('2026-11-03T12:00:00');

function montar() {
  const banco = criarBancoPortal();
  let agora = T0;
  const sessoes = criarSessoesPortal({ pool: banco.pool, agora: () => agora });
  return { banco, sessoes, passar: ms => { agora = new Date(agora.getTime() + ms); } };
}

// ---- cookie ----
test('lerCookie acha o __Host-portal entre vários cookies', () => {
  const req = { headers: { cookie: 'a=1; __Host-portal=abc_DEF-123; outro=x' } };
  assert.equal(lerCookie(req, '__Host-portal'), 'abc_DEF-123');
});

test('lerCookie devolve null sem cabeçalho, sem o cookie ou com valor vazio', () => {
  assert.equal(lerCookie({ headers: {} }, '__Host-portal'), null);
  assert.equal(lerCookie({ headers: { cookie: 'a=1' } }, '__Host-portal'), null);
  assert.equal(lerCookie({ headers: { cookie: '__Host-portal=' } }, '__Host-portal'), null);
});

test('lerCookie só aceita o nome exato e não decodifica o valor', () => {
  assert.equal(lerCookie({ headers: { cookie: 'x__Host-portal=1; __Host-portal2=2' } }, '__Host-portal'), null);
  assert.equal(lerCookie({ headers: { cookie: '__Host-portal=%41%42' } }, '__Host-portal'), '%41%42');
});

test('lerCookie devolve null quando o nome aparece duas vezes (ambíguo)', () => {
  assert.equal(lerCookie({ headers: { cookie: '__Host-portal=a; __Host-portal=b' } }, '__Host-portal'), null);
});

test('cookieSessao e cookieLimpar têm todos os atributos', () => {
  assert.equal(cookieSessao('tok'), '__Host-portal=tok; Max-Age=28800; HttpOnly; Secure; SameSite=Strict; Path=/');
  assert.equal(cookieSessao('tok', { maxAgeSeg: 60 }), '__Host-portal=tok; Max-Age=60; HttpOnly; Secure; SameSite=Strict; Path=/');
  assert.equal(cookieLimpar(), '__Host-portal=; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Path=/');
  assert.throws(() => cookieSessao('a; Path=/x'), /inválido/);
  for (const ruim of [NaN, -1, 1.5, '60', Infinity, null]) assert.throws(() => cookieSessao('tok', { maxAgeSeg: ruim }), TypeError);
  assert.equal(cookieSessao('tok', { maxAgeSeg: 0 }), '__Host-portal=tok; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Path=/');
});

// ---- sessões ----
test('criar grava só o hash do token, nunca o token', async () => {
  const { banco, sessoes } = montar();
  const token = await sessoes.criar(5, '1.2.3.4');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(banco.dados.sessoes.length, 1);
  const s = banco.dados.sessoes[0];
  assert.equal(s.id, hashToken(token));
  assert.equal(s.usuario_id, 5);
  assert.equal(s.ip, '1.2.3.4');
  assert.equal(s.expira_em.getTime(), T0.getTime() + 8 * 60 * MIN);
  assert.ok(!JSON.stringify(banco.pool.chamadas).includes(token));
});

test('valida aceita sessão recém-criada e devolve o usuário', async () => {
  const { sessoes } = montar();
  const token = await sessoes.criar(5, null);
  assert.deepEqual(await sessoes.valida(token), { usuarioId: 5 });
});

test('valida recusa formato inválido sem consultar o banco', async () => {
  const { banco, sessoes } = montar();
  for (const t of [undefined, null, 123, '', 'curto', 'a'.repeat(42), 'a'.repeat(44), '!'.repeat(43), 'a'.repeat(42) + '=']) {
    assert.equal(await sessoes.valida(t), null);
  }
  assert.equal(banco.pool.chamadas.length, 0);
});

test('valida recusa token desconhecido e sessão revogada', async () => {
  const { sessoes } = montar();
  assert.equal(await sessoes.valida('a'.repeat(43)), null);
  const token = await sessoes.criar(5, null);
  await sessoes.revogar(token);
  assert.equal(await sessoes.valida(token), null);
});

test('valida recusa depois de 8 h absolutas, mesmo com uso constante', async () => {
  const { sessoes, passar } = montar();
  const token = await sessoes.criar(5, null);
  for (let i = 0; i < 15; i++) { passar(30 * MIN); assert.ok(await sessoes.valida(token), `meia hora ${i + 1}`); }
  passar(30 * MIN); // 8 h exatas: expira_em não é mais maior que agora
  assert.equal(await sessoes.valida(token), null);
});

test('valida recusa inativa há 61 min e aceita no limite de 60', async () => {
  const a = montar();
  const t1 = await a.sessoes.criar(5, null);
  a.passar(61 * MIN);
  assert.equal(await a.sessoes.valida(t1), null);
  const b = montar();
  const t2 = await b.sessoes.criar(5, null);
  b.passar(60 * MIN);
  assert.deepEqual(await b.sessoes.valida(t2), { usuarioId: 5 });
});

test('ultimo_uso_em é atualizado no máximo uma vez por minuto', async () => {
  const { banco, sessoes, passar } = montar();
  const token = await sessoes.criar(5, null);
  const atualizacoes = () => banco.pool.chamadas.filter(c => /^UPDATE web_portal_sessoes SET ultimo_uso_em/.test(c.sql)).length;
  const gravado = () => banco.dados.sessoes[0].ultimo_uso_em.getTime();

  passar(30 * 1000);
  await sessoes.valida(token);
  assert.equal(gravado(), T0.getTime(), 'dentro do minuto não regrava');
  passar(31 * 1000); // 61 s depois da criação
  await sessoes.valida(token);
  assert.equal(gravado(), T0.getTime() + 61 * 1000);
  assert.equal(atualizacoes(), 2);
  passar(10 * 1000);
  await sessoes.valida(token);
  assert.equal(gravado(), T0.getTime() + 61 * 1000, 'segunda validação no mesmo minuto não regrava');
  assert.equal(atualizacoes(), 3, 'a UPDATE é emitida a cada validação, mas só grava se passou 1 minuto (WHERE no banco)');
  // a atividade renovada afasta a inatividade
  passar(59 * MIN);
  assert.ok(await sessoes.valida(token));
});

test('revogarUsuario revoga todas as sessões do usuário e só dele', async () => {
  const { sessoes } = montar();
  const a1 = await sessoes.criar(5, null);
  const a2 = await sessoes.criar(5, null);
  const b = await sessoes.criar(6, null);
  await sessoes.revogarUsuario(5);
  assert.equal(await sessoes.valida(a1), null);
  assert.equal(await sessoes.valida(a2), null);
  assert.ok(await sessoes.valida(b));
});

test('revogarEmpresa revoga por cliente_codigo via junção com os usuários', async () => {
  const { banco, sessoes } = montar();
  banco.dados.usuarios.push({ id: 5, cliente_codigo: 40 }, { id: 6, cliente_codigo: 41 });
  const a = await sessoes.criar(5, null);
  const b = await sessoes.criar(6, null);
  await sessoes.revogarEmpresa(40);
  const c = banco.pool.chamadas.find(x => /INNER JOIN web_portal_usuarios/.test(x.sql));
  assert.match(c.sql, /u\.cliente_codigo = \?/);
  assert.deepEqual(c.params, [40]);
  assert.equal(await sessoes.valida(a), null);
  assert.ok(await sessoes.valida(b));
});

// ---- texto e ordem dos parâmetros do SQL (o banco falso só reconhece o prefixo e aplica regras próprias) ----
const unico = (banco, re) => { const l = banco.pool.chamadas.filter(c => re.test(c.sql)); assert.equal(l.length, 1); return l[0]; };

test('valida emite a SELECT e a UPDATE com o texto e os parâmetros exatos', async () => {
  const { banco, sessoes, passar } = montar();
  const token = await sessoes.criar(5, null);
  passar(2 * MIN);
  const agora = new Date(T0.getTime() + 2 * MIN);
  await sessoes.valida(token);
  const sel = unico(banco, /^SELECT usuario_id FROM web_portal_sessoes/);
  assert.match(sel.sql, /WHERE id = \? AND revogada = 0 AND expira_em > \? AND ultimo_uso_em >= \? LIMIT 1$/);
  assert.deepEqual(sel.params, [hashToken(token), agora, new Date(agora.getTime() - 60 * MIN)]);
  const upd = unico(banco, /^UPDATE web_portal_sessoes SET ultimo_uso_em/);
  assert.equal(upd.sql, 'UPDATE web_portal_sessoes SET ultimo_uso_em = ? WHERE id = ? AND ultimo_uso_em < ?');
  assert.deepEqual(upd.params, [agora, hashToken(token), new Date(agora.getTime() - MIN)]);
});

test('revogar, revogarUsuario e revogarEmpresa: texto e parâmetros exatos', async () => {
  const { banco, sessoes } = montar();
  const token = await sessoes.criar(5, null);
  await sessoes.revogar(token);
  await sessoes.revogarUsuario(5);
  await sessoes.revogarEmpresa(40);
  const r = unico(banco, /SET revogada = 1 WHERE id = \?/);
  assert.equal(r.sql, 'UPDATE web_portal_sessoes SET revogada = 1 WHERE id = ?');
  assert.deepEqual(r.params, [hashToken(token)]);
  const u = unico(banco, /SET revogada = 1 WHERE usuario_id = \?/);
  assert.equal(u.sql, 'UPDATE web_portal_sessoes SET revogada = 1 WHERE usuario_id = ? AND revogada = 0');
  assert.deepEqual(u.params, [5]);
  const e = unico(banco, /INNER JOIN web_portal_usuarios/);
  assert.match(e.sql, /WHERE u\.cliente_codigo = \? AND s\.revogada = 0$/);
  assert.deepEqual(e.params, [40]);
});
