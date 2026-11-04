process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { app, pool, acesso, sessoes, configPortal, emailPortal } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
aceitarSidDeTeste(sessoes);
const { PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { REGEX_VALOR } = require('../seguranca/valores');
const { hashToken } = require('../portal/tokens');

const BASE = 'https://portal.teste';

// 1 = Thiago (Administrador, tem portal.gerir), 2 = Caio (Estoquista, não tem)
function montar(inicial = {}) {
  const perfis = PERFIS_INICIAIS.map((p, i) => ({ id: i + 1, nome: p.nome, permissoes: [...p.permissoes] }));
  const usuarios = {
    1: { CODIGO: 1, NOME: 'Thiago', CARGO: 'Administrador', RAZAO_SOCIAL: 'ELEGANCE', SITUACAO: 'ATIVO' },
    2: { CODIGO: 2, NOME: 'Caio', CARGO: 'Produção', RAZAO_SOCIAL: 'ELEGANCE', SITUACAO: 'ATIVO' }
  };
  const acessos = { 1: { perfil_id: 1, estados: null, ativo: 1 }, 2: { perfil_id: 4, estados: null, ativo: 1 } };
  const perfilPor = id => perfis.find(p => p.id === Number(id));
  const regrasFuncionario = [
    [/FROM cliente_usuarios WHERE CODIGO = \? LIMIT 1/, (sql, [c]) => usuarios[c] ? [usuarios[c]] : []],
    [/FROM web_usuario_acesso a LEFT JOIN web_perfis p/, (sql, [c]) => {
      const a = acessos[c]; if (!a) return [];
      const p = perfilPor(a.perfil_id);
      return [{ ...a, perfil_nome: p.nome, perfil_ativo: 1 }];
    }],
    [/SELECT permissao FROM web_perfil_permissoes WHERE perfil_id = \?/, (sql, [id]) => perfilPor(id).permissoes.map(permissao => ({ permissao }))],
    [/SELECT permissao, tipo FROM web_usuario_excecoes WHERE usuario_codigo = \?/, []]
  ];
  const banco = criarBancoPortal({
    clientes: [
      { CODIGO: 10, RAZAO_SOCIAL: 'Alfa Esquadrias', CNPJ_CPF: '11.111.111/0001-11' },
      { CODIGO: 11, RAZAO_SOCIAL: 'Beta 100%_Vidros', CNPJ_CPF: '22.222.222/0001-22' },
      { CODIGO: 12, RAZAO_SOCIAL: 'Gama Duplicada', CNPJ_CPF: '' },
      { CODIGO: 13, RAZAO_SOCIAL: 'Gama Duplicada', CNPJ_CPF: '' }
    ],
    ...inicial
  });
  const f = criarPoolFalso([...regrasFuncionario, ...banco.regras]);
  return { f, banco };
}

const token = id => jwt.sign({ id, nome: id === 1 ? 'Thiago' : 'Caio', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t, { ativo = true, enviar, inicial } = {}) {
  const { f, banco } = montar(inicial);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  acesso.limpar();
  const antes = { ativo: configPortal.ativo, baseUrl: configPortal.baseUrl, enviarConvite: emailPortal.enviarConvite };
  configPortal.ativo = ativo; configPortal.baseUrl = BASE;
  const enviados = [];
  emailPortal.enviarConvite = async d => { enviados.push(d); return enviar ? enviar(d) : { enviado: false }; };
  t.after(() => { Object.assign(configPortal, { ativo: antes.ativo, baseUrl: antes.baseUrl }); emailPortal.enviarConvite = antes.enviarConvite; });
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(id), 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined });
  return { f, banco, chamar, enviados, dados: banco.dados };
}

const ok = { enviado: true };
const textoSql = f => f.chamadas.map(c => c.sql).join('\n');
const acoes = dados => dados.auditoriaEquipe.map(a => a.acao);

test('sem portal.gerir recebe 403 em todas as rotas, sem tocar nas tabelas do portal', async t => {
  const { chamar, f } = await preparar(t);
  const rotas = [
    ['GET', '/admin/portal/clientes'], ['GET', '/admin/portal/empresas'], ['GET', '/admin/portal/empresas/10/usuarios'],
    ['POST', '/admin/portal/empresas', { clienteCodigo: 10 }], ['POST', '/admin/portal/empresas/10/suspender'],
    ['POST', '/admin/portal/empresas/10/reativar'], ['POST', '/admin/portal/convites', { clienteCodigo: 10, email: 'a@b.com' }],
    ['POST', '/admin/portal/usuarios/100/reenviar_convite'], ['POST', '/admin/portal/usuarios/100/reiniciar_2fa'],
    ['POST', '/admin/portal/usuarios/100/desativar'], ['POST', '/admin/portal/usuarios/100/remover']
  ];
  assert.equal(rotas.length, 11);
  for (const [metodo, caminho, corpo] of rotas) assert.equal((await chamar(2, caminho, metodo, corpo)).status, 403, `${metodo} ${caminho}`);
  assert.doesNotMatch(textoSql(f), /web_portal_(empresas|usuarios|convites)|web_auditoria/);
  assert.equal((await chamar(1, '/admin/portal/empresas')).status, 200);
});

test('liberar: ok, grava quem liberou, audita só com o código; repetida 409; nome duplicado 409; inexistente 404; código inválido 400', async t => {
  const { chamar, dados, f } = await preparar(t);
  const r = await chamar(1, '/admin/portal/empresas', 'POST', { clienteCodigo: 10 });
  assert.equal(r.status, 201);
  assert.equal(dados.empresas[0].cliente_codigo, 10);
  assert.equal(dados.empresas[0].situacao, 'ativa');
  assert.equal(dados.empresas[0].liberado_por, 'Thiago');
  assert.deepEqual(dados.auditoriaEquipe.map(a => [a.quem, a.acao, a.alvo, a.detalhe]),
    [['Thiago', 'portal_empresa_liberada', '10', '{"clienteCodigo":10}']]);
  const ins = f.chamadas.find(c => /^INSERT INTO web_portal_empresas/.test(c.sql));
  assert.match(ins.sql, /VALUES \(\?, 'ativa', \?, \?\)/);
  assert.equal(ins.params[0], 10); assert.equal(ins.params[1], 'Thiago');
  assert.ok(f.chamadas.some(c => c.sql === 'BEGIN') && f.chamadas.some(c => c.sql === 'COMMIT'));

  const outra = await chamar(1, '/admin/portal/empresas', 'POST', { clienteCodigo: 10 });
  assert.equal(outra.status, 409);
  assert.match((await outra.json()).error, /já foi liberada/);
  const dup = await chamar(1, '/admin/portal/empresas', 'POST', { clienteCodigo: 12 });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).error, 'Há mais de um cadastro com esta razão social; corrija o cadastro antes de liberar o portal.');
  assert.equal((await chamar(1, '/admin/portal/empresas', 'POST', { clienteCodigo: 999 })).status, 404);
  assert.equal((await chamar(1, '/admin/portal/empresas', 'POST', { clienteCodigo: '12abc' })).status, 400);
  assert.equal((await chamar(1, '/admin/portal/empresas', 'POST', {})).status, 400);
  assert.equal(dados.empresas.length, 1);
});

test('suspender revoga as sessões da empresa, repetir dá 409; reativar volta e limpa suspenso_em', async t => {
  const { chamar, dados, f } = await preparar(t, { inicial: {
    empresas: [{ cliente_codigo: 10, situacao: 'ativa' }],
    usuarios: [{ id: 5, email: 'a@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo' },
      { id: 6, email: 'b@beta.com', cliente_codigo: 11, papel: 'admin_geral', situacao: 'ativo' }],
    sessoes: [{ id: 's5', usuario_id: 5, revogada: 0 }, { id: 's6', usuario_id: 6, revogada: 0 }]
  } });
  assert.equal((await chamar(1, '/admin/portal/empresas/10/suspender', 'POST')).status, 200);
  assert.equal(dados.empresas[0].situacao, 'suspensa');
  assert.ok(dados.empresas[0].suspenso_em instanceof Date);
  assert.equal(dados.sessoes.find(s => s.id === 's5').revogada, 1);
  assert.equal(dados.sessoes.find(s => s.id === 's6').revogada, 0);
  const rev = f.chamadas.find(c => /UPDATE web_portal_sessoes s INNER JOIN web_portal_usuarios u/.test(c.sql));
  assert.deepEqual(rev.params, [10]);
  assert.equal((await chamar(1, '/admin/portal/empresas/10/suspender', 'POST')).status, 409);
  assert.equal((await chamar(1, '/admin/portal/empresas/99/suspender', 'POST')).status, 404);

  assert.equal((await chamar(1, '/admin/portal/empresas/10/reativar', 'POST')).status, 200);
  assert.equal(dados.empresas[0].situacao, 'ativa');
  assert.equal(dados.empresas[0].suspenso_em, null);
  assert.match(f.chamadas.find(c => /SET situacao = 'ativa'/.test(c.sql)).sql, /suspenso_em = NULL WHERE cliente_codigo = \?/);
  assert.equal((await chamar(1, '/admin/portal/empresas/10/reativar', 'POST')).status, 409);
  assert.equal((await chamar(1, '/admin/portal/empresas/10x/reativar', 'POST')).status, 400);
  assert.deepEqual(acoes(dados), ['portal_empresa_suspensa', 'portal_empresa_reativada']);
});

test('convite: validações (portal inativo 503, empresa não liberada 400, suspensa 409, e-mail inválido 400, repetido 409) sem criar nada', async t => {
  const c1 = await preparar(t, { ativo: false, inicial: { empresas: [{ cliente_codigo: 10, situacao: 'ativa' }] } });
  const r503 = await c1.chamar(1, '/admin/portal/convites', 'POST', { clienteCodigo: 10, email: 'a@alfa.com' });
  assert.equal(r503.status, 503);
  assert.deepEqual(await r503.json(), { error: 'Portal não configurado.' });
  assert.equal(c1.dados.usuarios.length, 0);

  const c2 = await preparar(t, { inicial: {
    empresas: [{ cliente_codigo: 10, situacao: 'ativa' }, { cliente_codigo: 11, situacao: 'suspensa' }],
    usuarios: [{ id: 5, email: 'dono@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo' }]
  } });
  const post = corpo => c2.chamar(1, '/admin/portal/convites', 'POST', corpo);
  assert.equal((await post({ clienteCodigo: 12, email: 'x@y.com' })).status, 400); // não liberada
  const suspensa = await post({ clienteCodigo: 11, email: 'x@y.com' }); // suspensa: 409, como reenviar e reiniciar
  assert.equal(suspensa.status, 409);
  assert.equal((await suspensa.json()).error, 'A empresa está suspensa. Reative-a antes de convidar.');
  for (const email of ['sem-arroba', 'a b@alfa.com', 'ação@alfa.com', 'a@alfa', '', undefined, 'a@alfa.com,b@alfa.com', `${'a'.repeat(185)}@alfa.com`]) {
    const r = await post({ clienteCodigo: 10, email });
    assert.equal(r.status, 400, String(email));
    assert.match((await r.json()).error, /E-mail inválido/);
  }
  assert.equal((await post({ email: 'x@y.com' })).status, 400);
  assert.equal((await post({ clienteCodigo: '10abc', email: 'x@y.com' })).status, 400);
  // e-mail repetido, já normalizado (maiúsculas e espaços nas pontas não escapam da comparação)
  assert.equal((await post({ clienteCodigo: 10, email: '  DONO@Alfa.com ' })).status, 409);
  assert.equal(c2.dados.usuarios.length, 1);
  assert.equal(c2.dados.convites.length, 0);
  assert.equal(c2.dados.auditoriaEquipe.length, 0);
});

test('convite sem e-mail configurado: devolve o link com #token; o token confere com o hash gravado e o INSERT nunca o contém', async t => {
  const { chamar, dados, f, enviados } = await preparar(t, { inicial: { empresas: [{ cliente_codigo: 10, situacao: 'ativa' }] } });
  const r = await chamar(1, '/admin/portal/convites', 'POST', { clienteCodigo: 10, email: '  Cliente@Alfa.COM ' });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.emailEnviado, false);
  const m = /^https:\/\/portal\.teste\/portal\/convite\.html#([A-Za-z0-9_-]{43})$/.exec(corpo.link);
  assert.ok(m, corpo.link);
  const tokenLink = m[1];
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].para, 'cliente@alfa.com');
  assert.equal(enviados[0].razaoSocial, 'Alfa Esquadrias');

  const u = dados.usuarios[0];
  assert.deepEqual([u.email, u.cliente_codigo, u.papel, u.situacao, u.criado_por], ['cliente@alfa.com', 10, 'admin_geral', 'convidado', 'Thiago']);
  assert.equal(dados.convites.length, 1);
  assert.equal(dados.convites[0].token_hash, hashToken(tokenLink));
  assert.equal(dados.convites[0].usuario_id, u.id);
  const horas = (dados.convites[0].expira_em - dados.convites[0].criado_em) / 3600000;
  assert.equal(horas, 48);

  const insConvite = f.chamadas.find(c => /^INSERT INTO web_portal_convites/.test(c.sql));
  assert.match(insConvite.sql, /\(token_hash, usuario_id, expira_em, criado_por, criado_em\)/);
  assert.equal(insConvite.params[0], hashToken(tokenLink));
  // o token em claro não aparece em NENHUMA chamada ao banco (texto nem parâmetros)
  const tudo = JSON.stringify(f.chamadas);
  assert.ok(!tudo.includes(tokenLink), 'token em claro chegou ao banco');
  const insUsuario = f.chamadas.find(c => /^INSERT INTO web_portal_usuarios/.test(c.sql));
  assert.match(insUsuario.sql, /'admin_geral', 'convidado'/);
  assert.ok(f.chamadas.map(c => c.sql).indexOf('COMMIT') >= 0);
  assert.deepEqual(acoes(dados), ['portal_convite_criado']);
});

test('convite com e-mail enviado: emailEnviado true, SEM link, e o envio acontece depois do COMMIT', async t => {
  const ordem = [];
  const { chamar, f, dados, enviados } = await preparar(t, {
    inicial: { empresas: [{ cliente_codigo: 10, situacao: 'ativa' }] },
    enviar: async () => { ordem.push(f.chamadas.map(c => c.sql).includes('COMMIT') ? 'enviou-apos-commit' : 'enviou-antes-commit'); return ok; }
  });
  const r = await chamar(1, '/admin/portal/convites', 'POST', { clienteCodigo: 10, email: 'novo@alfa.com' });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo, { emailEnviado: true });
  assert.deepEqual(ordem, ['enviou-apos-commit']);
  assert.match(enviados[0].link, /^https:\/\/portal\.teste\/portal\/convite\.html#[A-Za-z0-9_-]{43}$/);
  assert.equal(dados.convites[0].token_hash, hashToken(enviados[0].link.split('#')[1]));
});

test('falha do e-mail (exceção) não desfaz o convite: devolve o link', async t => {
  const { chamar, dados } = await preparar(t, {
    inicial: { empresas: [{ cliente_codigo: 10, situacao: 'ativa' }] },
    enviar: async () => { throw new Error('SMTP caiu'); }
  });
  const r = await chamar(1, '/admin/portal/convites', 'POST', { clienteCodigo: 10, email: 'novo@alfa.com' });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.emailEnviado, false);
  assert.match(corpo.link, /#[A-Za-z0-9_-]{43}$/);
  assert.equal(dados.usuarios.length, 1);
  assert.equal(dados.convites.length, 1);
});

test('reenviar: só convidado; invalida os convites anteriores e cria novo; ativo 409; inexistente 404; id inválido 400', async t => {
  const { chamar, dados, f } = await preparar(t, { inicial: {
    empresas: [{ cliente_codigo: 10, situacao: 'ativa' }],
    usuarios: [{ id: 5, email: 'conv@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'convidado' },
      { id: 6, email: 'ativo@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo' }],
    convites: [{ id: 50, token_hash: 'a'.repeat(64), usuario_id: 5, expira_em: new Date(), usado_em: null }]
  } });
  const r = await chamar(1, '/admin/portal/usuarios/5/reenviar_convite', 'POST');
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.emailEnviado, false);
  const tk = corpo.link.split('#')[1];
  assert.ok(dados.convites.find(c => c.id === 50).usado_em instanceof Date, 'convite antigo continua válido');
  const novo = dados.convites.find(c => c.id !== 50);
  assert.equal(novo.token_hash, hashToken(tk));
  assert.equal(novo.usado_em, null);
  const upd = f.chamadas.find(c => /^UPDATE web_portal_convites/.test(c.sql));
  assert.match(upd.sql, /SET usado_em = \? WHERE usuario_id = \? AND usado_em IS NULL/);
  assert.equal(upd.params[1], 5);
  // a invalidação vem ANTES de criar o novo
  const sqls = f.chamadas.map(c => c.sql);
  assert.ok(sqls.findIndex(s => /^UPDATE web_portal_convites/.test(s)) < sqls.findIndex(s => /^INSERT INTO web_portal_convites/.test(s)));
  assert.ok(!JSON.stringify(f.chamadas).includes(tk));

  assert.equal((await chamar(1, '/admin/portal/usuarios/6/reenviar_convite', 'POST')).status, 409);
  assert.equal((await chamar(1, '/admin/portal/usuarios/999/reenviar_convite', 'POST')).status, 404);
  assert.equal((await chamar(1, '/admin/portal/usuarios/5x/reenviar_convite', 'POST')).status, 400);
  assert.deepEqual(acoes(dados), ['portal_convite_criado']);
  assert.equal(dados.auditoriaEquipe[0].alvo, '5');
});

test('reiniciar 2FA: só ativo; zera segredo, passo, senha e códigos; volta a convidado; revoga sessões; novo convite', async t => {
  const { chamar, dados, f } = await preparar(t, { inicial: {
    empresas: [{ cliente_codigo: 10, situacao: 'ativa' }],
    usuarios: [{ id: 6, email: 'ativo@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo', senha_hash: 'h', totp_segredo_cifrado: 'seg', totp_ativo: 1, totp_ultimo_passo: 99 },
      { id: 7, email: 'conv@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'convidado' },
      { id: 8, email: 'outro@alfa.com', cliente_codigo: 10, papel: 'usuario', situacao: 'ativo' }],
    recuperacao: [{ usuario_id: 6, codigo_hash: 'x' }, { usuario_id: 8, codigo_hash: 'y' }],
    convites: [{ id: 60, token_hash: 'b'.repeat(64), usuario_id: 6, expira_em: new Date(), usado_em: null }],
    sessoes: [{ id: 's6', usuario_id: 6, revogada: 0 }, { id: 's8', usuario_id: 8, revogada: 0 }]
  } });
  const r = await chamar(1, '/admin/portal/usuarios/6/reiniciar_2fa', 'POST');
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.emailEnviado, false);
  const u = dados.usuarios.find(x => x.id === 6);
  assert.deepEqual([u.totp_segredo_cifrado, u.totp_ativo, u.totp_ultimo_passo, u.senha_hash, u.situacao], [null, 0, 0, null, 'convidado']);
  assert.deepEqual(dados.recuperacao.map(x => x.usuario_id), [8]);
  assert.equal(dados.sessoes.find(s => s.id === 's6').revogada, 1);
  assert.equal(dados.sessoes.find(s => s.id === 's8').revogada, 0);
  assert.ok(dados.convites.find(c => c.id === 60).usado_em instanceof Date);
  const novo = dados.convites.find(c => c.id !== 60);
  assert.equal(novo.token_hash, hashToken(corpo.link.split('#')[1]));
  const upd = f.chamadas.find(c => /^UPDATE web_portal_usuarios SET/.test(c.sql));
  assert.match(upd.sql, /totp_segredo_cifrado = NULL, totp_ativo = 0, totp_ultimo_passo = 0, senha_hash = NULL, situacao = 'convidado' WHERE id = \?/);
  assert.match(f.chamadas.find(c => /^DELETE FROM web_portal_recuperacao/.test(c.sql)).sql, /WHERE usuario_id = \?/);
  assert.deepEqual(acoes(dados), ['portal_2fa_reiniciado']);

  assert.equal((await chamar(1, '/admin/portal/usuarios/7/reiniciar_2fa', 'POST')).status, 409); // convidado
  assert.equal((await chamar(1, '/admin/portal/usuarios/999/reiniciar_2fa', 'POST')).status, 404);
  assert.equal((await chamar(1, '/admin/portal/usuarios/6/reiniciar_2fa', 'POST')).status, 409); // agora convidado
});

test('falha no meio do reinício desfaz a transação inteira (ROLLBACK, resposta 500 genérica)', async t => {
  const { chamar, f } = await preparar(t, { inicial: {
    empresas: [{ cliente_codigo: 10, situacao: 'ativa' }],
    usuarios: [{ id: 6, email: 'ativo@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo' }]
  } });
  f.regras.unshift([/^INSERT INTO web_portal_convites/, () => { const e = new Error('segredo do banco'); e.code = 'ER_X'; throw e; }]);
  const r = await chamar(1, '/admin/portal/usuarios/6/reiniciar_2fa', 'POST');
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'Erro de servidor' });
  assert.ok(f.chamadas.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!f.chamadas.some(c => c.sql === 'COMMIT'));
});

test('listas: clientes (situação, liberável, motivo, busca com % e _ escapados), empresas e usuários da empresa', async t => {
  const { chamar, f } = await preparar(t, { inicial: {
    empresas: [{ cliente_codigo: 10, situacao: 'suspensa' }],
    usuarios: [{ id: 5, email: 'a@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo' },
      { id: 6, email: 'u@alfa.com', cliente_codigo: 10, papel: 'usuario', situacao: 'convidado' }]
  } });
  const todos = await (await chamar(1, '/admin/portal/clientes')).json();
  const por = c => todos.clientes.find(x => x.codigo === c);
  assert.equal(todos.clientes.length, 4);
  assert.deepEqual(por(10), { codigo: 10, razaoSocial: 'Alfa Esquadrias', cnpjCpf: '11.111.111/0001-11', situacaoPortal: 'suspensa', liberavel: false, motivo: 'Esta empresa já foi liberada para o portal.' });
  assert.deepEqual(por(11), { codigo: 11, razaoSocial: 'Beta 100%_Vidros', cnpjCpf: '22.222.222/0001-22', situacaoPortal: 'nao_liberada', liberavel: true });
  assert.equal(por(12).liberavel, false);
  assert.match(por(12).motivo, /mais de um cadastro/);

  const busca = await (await chamar(1, '/admin/portal/clientes?q=' + encodeURIComponent('100%_'))).json();
  assert.deepEqual(busca.clientes.map(c => c.codigo), [11]);
  const sqlBusca = f.chamadas.filter(c => /^SELECT c\.CODIGO/.test(c.sql)).pop();
  assert.match(sqlBusca.sql, /LIKE \? ESCAPE '!' OR c\.CODIGO = \?/);
  assert.ok(!sqlBusca.sql.includes('\\'), 'o SQL não depende de barra invertida (NO_BACKSLASH_ESCAPES)');
  assert.match(sqlBusca.sql, /LIMIT 50$/);
  assert.deepEqual(sqlBusca.params, ['%100!%!_%', 0]);
  const comEscape = await chamar(1, '/admin/portal/clientes?q=' + encodeURIComponent('a!b'));
  assert.equal(comEscape.status, 200);
  assert.deepEqual(f.chamadas.filter(c => /^SELECT c\.CODIGO/.test(c.sql)).pop().params, ['%a!!b%', 0]);
  const porCodigo = await (await chamar(1, '/admin/portal/clientes?q=13')).json();
  assert.deepEqual(porCodigo.clientes.map(c => c.codigo), [13]);
  assert.deepEqual(f.chamadas.filter(c => /^SELECT c\.CODIGO/.test(c.sql)).pop().params, ['%13%', 13]);
  const coringa = await (await chamar(1, '/admin/portal/clientes?q=%25')).json();
  assert.deepEqual(coringa.clientes.map(c => c.codigo), [11]); // "%" é literal (só a Beta tem %), não coringa de todos

  const emp = await (await chamar(1, '/admin/portal/empresas')).json();
  assert.deepEqual(emp, { empresas: [{ clienteCodigo: 10, razaoSocial: 'Alfa Esquadrias', situacao: 'suspensa', qtdUsuarios: 2 }] });
  const us = await (await chamar(1, '/admin/portal/empresas/10/usuarios')).json();
  assert.deepEqual(us, { usuarios: [{ id: 5, email: 'a@alfa.com', papel: 'admin_geral', situacao: 'ativo' }, { id: 6, email: 'u@alfa.com', papel: 'usuario', situacao: 'convidado' }] });
  assert.equal((await chamar(1, '/admin/portal/empresas/11/usuarios')).status, 404);
  assert.equal((await chamar(1, '/admin/portal/empresas/10abc/usuarios')).status, 400);

  // nenhum nome de campo das respostas casa com REGEX_VALOR (senão a rede de valores apagaria o campo)
  const nomes = o => Array.isArray(o) ? o.flatMap(nomes) : (o && typeof o === 'object') ? Object.entries(o).flatMap(([k, v]) => [k, ...nomes(v)]) : [];
  for (const corpo of [todos, emp, us]) for (const nome of nomes(corpo)) assert.ok(!REGEX_VALOR.test(nome), `campo ${nome} casa com REGEX_VALOR`);
});

test('auditoria nunca leva e-mail, token, link nem razão social', async t => {
  const { chamar, dados, f } = await preparar(t, { inicial: { empresas: [{ cliente_codigo: 10, situacao: 'ativa' }] } });
  const r = await chamar(1, '/admin/portal/convites', 'POST', { clienteCodigo: 10, email: 'segredo@alfa.com' });
  const { link } = await r.json();
  await chamar(1, '/admin/portal/empresas/10/suspender', 'POST');
  await chamar(1, '/admin/portal/empresas/10/reativar', 'POST');
  const tk = link.split('#')[1];
  const linhas = f.chamadas.filter(c => /INTO web_auditoria/.test(c.sql));
  assert.equal(linhas.length, 3);
  const bruto = JSON.stringify(linhas);
  for (const proibido of ['segredo@alfa.com', 'alfa.com', tk, 'convite.html', 'Alfa Esquadrias']) assert.ok(!bruto.includes(proibido), proibido);
  assert.deepEqual(dados.auditoriaEquipe.map(a => a.quem), ['Thiago', 'Thiago', 'Thiago']);
  assert.equal(dados.auditoriaEquipe[0].detalhe, JSON.stringify({ usuarioId: dados.usuarios[0].id, clienteCodigo: 10 }));
});

// ---- I3: com a empresa suspensa a equipe ainda reinicia o 2º fator e reenvia convite ----
test('empresa suspensa: reiniciar 2º fator e reenviar convite valem (200, convite novo); criar convite novo continua exigindo empresa ativa (409)', async t => {
  const { chamar, dados } = await preparar(t, { inicial: {
    empresas: [{ cliente_codigo: 10, situacao: 'suspensa' }],
    usuarios: [{ id: 5, email: 'conv@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'convidado' },
      { id: 6, email: 'ativo@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo', senha_hash: 'h', totp_segredo_cifrado: 's', totp_ativo: 1 }],
    convites: [{ id: 50, token_hash: 'a'.repeat(64), usuario_id: 5, expira_em: new Date(), usado_em: null }]
  } });
  const reenv = await chamar(1, '/admin/portal/usuarios/5/reenviar_convite', 'POST');
  assert.equal(reenv.status, 200);
  assert.match((await reenv.json()).link, /#[A-Za-z0-9_-]{43}$/);
  assert.ok(dados.convites.find(c => c.id === 50).usado_em instanceof Date);
  const reinicia = await chamar(1, '/admin/portal/usuarios/6/reiniciar_2fa', 'POST');
  assert.equal(reinicia.status, 200);
  assert.match((await reinicia.json()).link, /#[A-Za-z0-9_-]{43}$/);
  assert.equal(dados.usuarios.find(u => u.id === 6).situacao, 'convidado');
  assert.equal(dados.convites.filter(c => c.usado_em == null).length, 2, 'um convite novo para cada');
  assert.deepEqual(acoes(dados), ['portal_convite_criado', 'portal_2fa_reiniciado']);
  // convite NOVO para a empresa suspensa continua recusado, com 409
  const novo = await chamar(1, '/admin/portal/convites', 'POST', { clienteCodigo: 10, email: 'outro@alfa.com' });
  assert.equal(novo.status, 409);
  assert.equal(dados.usuarios.length, 2);
  // as regras de usuário continuam: reiniciar exige ativo, reenviar exige convidado
  assert.equal((await chamar(1, '/admin/portal/usuarios/5/reiniciar_2fa', 'POST')).status, 409); // convidado
  assert.equal((await chamar(1, '/admin/portal/usuarios/999/reenviar_convite', 'POST')).status, 404);
});

// ---- I2: desativar e remover usuário ----
const cenarioUsuarios = () => ({
  empresas: [{ cliente_codigo: 10, situacao: 'ativa' }],
  usuarios: [
    { id: 6, email: 'ativo@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo', senha_hash: 'h', totp_segredo_cifrado: 's', totp_ativo: 1, termo_aceito_em: new Date() },
    { id: 7, email: 'errado@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'convidado', termo_aceito_em: null },
    { id: 8, email: 'outro@alfa.com', cliente_codigo: 10, papel: 'usuario', situacao: 'ativo' },
    { id: 9, email: 'inativo@alfa.com', cliente_codigo: 10, papel: 'usuario', situacao: 'inativo' },
    { id: 10, email: 'refeito@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'convidado', termo_aceito_em: new Date() }
  ],
  convites: [
    { id: 60, token_hash: 'a'.repeat(64), usuario_id: 6, expira_em: new Date(), usado_em: null },
    { id: 61, token_hash: 'b'.repeat(64), usuario_id: 7, expira_em: new Date(), usado_em: null },
    { id: 62, token_hash: 'c'.repeat(64), usuario_id: 8, expira_em: new Date(), usado_em: null }
  ],
  recuperacao: [{ usuario_id: 6, codigo_hash: 'x' }, { usuario_id: 7, codigo_hash: 'y' }, { usuario_id: 8, codigo_hash: 'z' }],
  permissoes: [{ usuario_id: 7, permissao: 'pedidos.ver' }, { usuario_id: 8, permissao: 'pedidos.ver' }],
  sessoes: [{ id: 's6', usuario_id: 6, revogada: 0 }, { id: 's7', usuario_id: 7, revogada: 0 }, { id: 's8', usuario_id: 8, revogada: 0 }]
});

test('desativar: usuário vira inativo, convites abertos e sessões dele caem, só ele; audita só com ids; vale com empresa suspensa', async t => {
  const { chamar, dados, f } = await preparar(t, { inicial: cenarioUsuarios() });
  const r = await chamar(1, '/admin/portal/usuarios/6/desativar', 'POST');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(dados.usuarios.find(u => u.id === 6).situacao, 'inativo');
  assert.equal(dados.usuarios.find(u => u.id === 8).situacao, 'ativo');
  assert.ok(dados.convites.find(c => c.id === 60).usado_em instanceof Date, 'convite aberto do usuário invalidado');
  assert.equal(dados.convites.find(c => c.id === 62).usado_em, null, 'convite de outro usuário intacto');
  assert.equal(dados.sessoes.find(s => s.id === 's6').revogada, 1);
  assert.equal(dados.sessoes.find(s => s.id === 's8').revogada, 0);
  assert.deepEqual(dados.auditoriaEquipe.map(a => [a.quem, a.acao, a.alvo, a.detalhe]),
    [['Thiago', 'portal_usuario_desativado', '6', '{"usuarioId":6,"clienteCodigo":10}']]);
  assert.ok(!JSON.stringify(dados.auditoriaEquipe).includes('alfa.com'));
  const sqls = f.chamadas.map(c => c.sql);
  assert.ok(sqls.includes('BEGIN') && sqls.includes('COMMIT'));
  assert.match(f.chamadas.find(c => /^SELECT id, email, cliente_codigo, situacao FROM web_portal_usuarios/.test(c.sql)).sql, /FOR UPDATE$/);
  assert.match(f.chamadas.find(c => /SET situacao = 'inativo'/.test(c.sql)).sql, /WHERE id = \?$/);

  // convidado também pode ser desativado, e com a empresa suspensa
  dados.empresas[0].situacao = 'suspensa';
  assert.equal((await chamar(1, '/admin/portal/usuarios/7/desativar', 'POST')).status, 200);
  assert.equal(dados.usuarios.find(u => u.id === 7).situacao, 'inativo');
  assert.ok(dados.convites.find(c => c.id === 61).usado_em instanceof Date);
  // repetir, inexistente e id inválido
  assert.equal((await chamar(1, '/admin/portal/usuarios/6/desativar', 'POST')).status, 409);
  assert.equal((await chamar(1, '/admin/portal/usuarios/9/desativar', 'POST')).status, 409);
  assert.equal((await chamar(1, '/admin/portal/usuarios/999/desativar', 'POST')).status, 404);
  for (const ruim of ['12abc', '0', '-3', '1.5']) assert.equal((await chamar(1, `/admin/portal/usuarios/${ruim}/desativar`, 'POST')).status, 400, ruim);
  assert.deepEqual(acoes(dados), ['portal_usuario_desativado', 'portal_usuario_desativado']);
});

test('remover: só convidado que nunca aceitou; apaga usuário, convites, códigos, permissões e sessões dele; o e-mail volta a ficar livre', async t => {
  const { chamar, dados, f } = await preparar(t, { inicial: cenarioUsuarios() });
  const r = await chamar(1, '/admin/portal/usuarios/7/remover', 'POST');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.ok(!dados.usuarios.some(u => u.id === 7));
  assert.ok(!dados.convites.some(c => c.usuario_id === 7));
  assert.ok(!dados.recuperacao.some(x => x.usuario_id === 7));
  assert.ok(!dados.permissoes.some(p => p.usuario_id === 7));
  assert.ok(!dados.sessoes.some(s => s.usuario_id === 7));
  // os dos outros ficam
  assert.deepEqual(dados.usuarios.map(u => u.id), [6, 8, 9, 10]);
  assert.equal(dados.convites.length, 2);
  assert.equal(dados.recuperacao.length, 2);
  assert.equal(dados.permissoes.length, 1);
  assert.equal(dados.sessoes.length, 2);
  assert.deepEqual(dados.auditoriaEquipe.map(a => [a.quem, a.acao, a.alvo, a.detalhe]),
    [['Thiago', 'portal_usuario_removido', '7', '{"usuarioId":7,"clienteCodigo":10}']]);
  assert.ok(!JSON.stringify(dados.auditoriaEquipe).includes('errado@'));
  const sqls = f.chamadas.map(c => c.sql);
  assert.ok(sqls.includes('BEGIN') && sqls.includes('COMMIT'));
  assert.match(f.chamadas.find(c => /^DELETE FROM web_portal_usuarios/.test(c.sql)).sql, /WHERE id = \? AND situacao = 'convidado'/);

  // ativo, inativo e convidado que já aceitou antes (2º fator reiniciado) NÃO se removem: use Desativar
  for (const id of [6, 8, 9, 10]) {
    const nao = await chamar(1, `/admin/portal/usuarios/${id}/remover`, 'POST');
    assert.equal(nao.status, 409, String(id));
    assert.equal((await nao.json()).error, 'Só dá para remover quem ainda não aceitou o convite; use Desativar.');
  }
  assert.deepEqual(dados.usuarios.map(u => u.id), [6, 8, 9, 10]);
  assert.equal((await chamar(1, '/admin/portal/usuarios/999/remover', 'POST')).status, 404);
  for (const ruim of ['12abc', '0', '-3', '1.5']) assert.equal((await chamar(1, `/admin/portal/usuarios/${ruim}/remover`, 'POST')).status, 400, ruim);
  assert.equal(dados.auditoriaEquipe.length, 1);

  // o e-mail digitado errado pode ser convidado de novo, agora com o endereço certo e o mesmo e-mail já não está preso
  const de_novo = await chamar(1, '/admin/portal/convites', 'POST', { clienteCodigo: 10, email: 'errado@alfa.com' });
  assert.equal(de_novo.status, 200);
});

test('remover: a checagem de situação e de aceite do convite vale sozinha (mesmo que o DELETE aceitasse tudo, nada é apagado)', async t => {
  const { chamar, dados, f } = await preparar(t, { inicial: cenarioUsuarios() });
  f.regras.unshift([/^DELETE FROM web_portal_usuarios/, () => ({ affectedRows: 1 })]);
  const antes = JSON.stringify([dados.usuarios, dados.convites, dados.recuperacao, dados.permissoes, dados.sessoes]);
  for (const id of [6, 8, 9, 10]) assert.equal((await chamar(1, `/admin/portal/usuarios/${id}/remover`, 'POST')).status, 409, String(id));
  assert.equal(JSON.stringify([dados.usuarios, dados.convites, dados.recuperacao, dados.permissoes, dados.sessoes]), antes);
  assert.equal(f.chamadas.filter(c => /^DELETE/.test(c.sql)).length, 0, 'nenhum DELETE foi tentado');
  assert.equal(dados.auditoriaEquipe.length, 0);
});

test('remover: se o DELETE do usuário não afetar 1 linha (mudou de situação no meio) responde 409, sem auditar', async t => {
  const { chamar, dados, f } = await preparar(t, { inicial: cenarioUsuarios() });
  f.regras.unshift([/^DELETE FROM web_portal_usuarios/, () => ({ affectedRows: 0 })]);
  const r = await chamar(1, '/admin/portal/usuarios/7/remover', 'POST');
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'Só dá para remover quem ainda não aceitou o convite; use Desativar.');
  assert.ok(f.chamadas.some(c => /^DELETE FROM web_portal_usuarios/.test(c.sql)), 'o DELETE foi tentado');
  assert.ok(f.chamadas.some(c => c.sql === 'ROLLBACK'));
  assert.equal(dados.auditoriaEquipe.length, 0);
});

test('remover e desativar: falha no meio desfaz a transação (ROLLBACK, 500 genérica, nada apagado)', async t => {
  for (const rota of ['remover', 'desativar']) {
    const { chamar, f, dados } = await preparar(t, { inicial: cenarioUsuarios() });
    f.regras.unshift([/^INSERT INTO web_auditoria/, () => { const e = new Error('segredo do banco'); e.code = 'ER_X'; throw e; }]);
    const r = await chamar(1, `/admin/portal/usuarios/7/${rota}`, 'POST');
    assert.equal(r.status, 500, rota);
    assert.deepEqual(await r.json(), { error: 'Erro de servidor' });
    assert.ok(f.chamadas.some(c => c.sql === 'ROLLBACK'), rota);
    assert.ok(!f.chamadas.some(c => c.sql === 'COMMIT'), rota);
    // o banco falso não desfaz nada: a prova é o ROLLBACK sem COMMIT e a auditoria ser a última etapa (depois dos apagamentos)
    assert.ok(f.chamadas.findIndex(c => /^INSERT INTO web_auditoria/.test(c.sql)) > f.chamadas.findIndex(c => /^(DELETE|UPDATE web_portal_usuarios)/.test(c.sql)), rota);
    assert.ok(dados.usuarios.length > 0);
  }
});

// ---- M5: razão social vazia ----
test('razão social vazia: a lista marca como não liberável com motivo e liberar responde 409 com a mesma mensagem', async t => {
  const { chamar, dados } = await preparar(t, { inicial: {
    clientes: [{ CODIGO: 20, RAZAO_SOCIAL: '', CNPJ_CPF: '' }, { CODIGO: 21, RAZAO_SOCIAL: 'Delta Vidros', CNPJ_CPF: '' }]
  } });
  const lista = await (await chamar(1, '/admin/portal/clientes')).json();
  assert.equal(lista.clientes.length, 2);
  const vazio = lista.clientes.find(c => c.codigo === 20);
  assert.equal(vazio.liberavel, false);
  assert.equal(vazio.motivo, 'O cadastro está sem razão social.');
  assert.equal(lista.clientes.find(c => c.codigo === 21).liberavel, true);
  const r = await chamar(1, '/admin/portal/empresas', 'POST', { clienteCodigo: 20 });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'O cadastro está sem razão social.');
  assert.equal(dados.empresas.length, 0);
});

test('razão social só com espaços: não liberável e liberar responde 409 com a mesma mensagem', async t => {
  const { chamar, dados } = await preparar(t, { inicial: {
    clientes: [{ CODIGO: 22, RAZAO_SOCIAL: '   ', CNPJ_CPF: '' }]
  } });
  const lista = await (await chamar(1, '/admin/portal/clientes')).json();
  const item = lista.clientes.find(c => c.codigo === 22);
  assert.equal(item.liberavel, false);
  assert.equal(item.motivo, 'O cadastro está sem razão social.');
  const r = await chamar(1, '/admin/portal/empresas', 'POST', { clienteCodigo: 22 });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'O cadastro está sem razão social.');
  assert.equal(dados.empresas.length, 0);
});

// ---- M2: o link do convite, o token e o e-mail do convidado nunca vão a log ----
test('convite, reenvio e reinício (com e sem e-mail enviado): nenhum console.log/error/warn leva o token, o link nem o e-mail do convidado', async t => {
  for (const enviar of [undefined, async () => ok, async () => { throw new Error('SMTP caiu para seguro@alfa.com'); }]) {
    const { chamar, enviados } = await preparar(t, { enviar, inicial: {
      empresas: [{ cliente_codigo: 10, situacao: 'ativa' }],
      usuarios: [{ id: 5, email: 'conv@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'convidado' },
        { id: 6, email: 'ativo@alfa.com', cliente_codigo: 10, papel: 'admin_geral', situacao: 'ativo', senha_hash: 'h', totp_segredo_cifrado: 's', totp_ativo: 1 }]
    } });
    const linhas = [];
    const originais = {};
    for (const m of ['log', 'error', 'warn']) {
      originais[m] = console[m];
      console[m] = (...a) => linhas.push(a.map(x => (x instanceof Error ? x.message : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '));
    }
    let respostas;
    try {
      respostas = [
        await chamar(1, '/admin/portal/convites', 'POST', { clienteCodigo: 10, email: 'seguro@alfa.com' }),
        await chamar(1, '/admin/portal/usuarios/5/reenviar_convite', 'POST'),
        await chamar(1, '/admin/portal/usuarios/6/reiniciar_2fa', 'POST')
      ];
    } finally { for (const m of Object.keys(originais)) console[m] = originais[m]; }
    for (const r of respostas) assert.equal(r.status, 200);
    assert.equal(enviados.length, 3, 'os três convites foram gerados');
    for (const e of enviados) {
      const tokenLink = e.link.split('#')[1];
      assert.match(tokenLink, /^[A-Za-z0-9_-]{43}$/);
      for (const linha of linhas) {
        for (const proibido of [tokenLink, e.link, e.para, 'convite.html', '@alfa.com']) assert.ok(!linha.includes(proibido), `log vazou ${proibido}: ${linha}`);
      }
    }
  }
});
