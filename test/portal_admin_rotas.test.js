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
    ['POST', '/admin/portal/usuarios/100/reenviar_convite'], ['POST', '/admin/portal/usuarios/100/reiniciar_2fa']
  ];
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

test('convite: validações (portal inativo 503, empresa não liberada 400, suspensa 400, e-mail inválido 400, repetido 409) sem criar nada', async t => {
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
  assert.equal((await post({ clienteCodigo: 11, email: 'x@y.com' })).status, 400); // suspensa
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
  assert.match(sqlBusca.sql, /LIKE \? ESCAPE '\\\\' OR c\.CODIGO = \?/);
  assert.match(sqlBusca.sql, /LIMIT 50$/);
  assert.deepEqual(sqlBusca.params, ['%100\\%\\_%', 0]);
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
