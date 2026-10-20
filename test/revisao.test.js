// Testes das correções pedidas na revisão final (problemas "Important" 1 a 4).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso } = require('../index.js');
const { migrarAcessos, garantirAdministrador } = require('../seguranca/instalacao');

// ---------- Important 1: nunca ficar sem administrador por causa do WEB_ADMIN_INICIAL ----------
test('migração reconhece o administrador sem diferenciar maiúsculas nem espaços', async () => {
  const pool = criarPoolFalso([
    [/COUNT\(\*\) AS n FROM web_perfis/, [{ n: 5 }]],
    [/SELECT id, nome FROM web_perfis/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }, { id: 5, nome: 'Representante' }]],
    [/FROM cliente_usuarios u/, [{ CODIGO: 1, NOME: 'Thiago', CARGO: 'Diretor' }]]
  ]);
  await migrarAcessos(pool, { adminInicial: '  thiago ' });
  const ins = pool.chamadas.find(c => /INSERT INTO web_usuario_acesso/.test(c.sql));
  assert.equal(ins.params[1], 1);
});

function poolSemAdmin({ usuario = [{ CODIGO: 1, NOME: 'Thiago' }] } = {}) {
  return criarPoolFalso([
    [/FROM web_usuario_acesso a JOIN cliente_usuarios u/, [{ usuario_codigo: 1, perfil_id: 2, ativo: 1, perfil_ativo: 1, SITUACAO: 'ATIVO' }]],
    [/SELECT perfil_id, permissao FROM web_perfil_permissoes$/, [{ perfil_id: 2, permissao: 'estoque.ver' }]],
    [/SELECT usuario_codigo, permissao, tipo FROM web_usuario_excecoes$/, []],
    [/SELECT id, ativo FROM web_perfis$/, [{ id: 1, ativo: 1 }, { id: 2, ativo: 1 }]],
    [/SELECT CODIGO, NOME FROM cliente_usuarios WHERE UPPER\(TRIM\(NOME\)\)/, usuario],
    [/SELECT id FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]]
  ]);
}

test('sem nenhum administrador, a subida concede Administrador ao WEB_ADMIN_INICIAL', async () => {
  const p = poolSemAdmin();
  assert.deepEqual(await garantirAdministrador(p, { adminInicial: 'THIAGO' }), { concedido: true, usuario: 'Thiago' });
  const up = p.chamadas.find(c => /INSERT INTO web_usuario_acesso/.test(c.sql));
  assert.deepEqual(up.params.slice(0, 2), [1, 1]);
  assert.ok(p.chamadas.some(c => /INSERT INTO web_auditoria/.test(c.sql) && c.params.includes('admin_restaurado')));
});

test('sem administrador e sem WEB_ADMIN_INICIAL válido, avisa e não concede nada', async t => {
  const erro = t.mock.method(console, 'error', () => {});
  const p = poolSemAdmin({ usuario: [] });
  assert.deepEqual(await garantirAdministrador(p, { adminInicial: 'Fulano' }), { concedido: false, usuario: null });
  assert.ok(!p.chamadas.some(c => /INSERT INTO web_usuario_acesso/.test(c.sql)));
  assert.match(erro.mock.calls[0].arguments[0], /NENHUM administrador/);
});

test('com administrador existente, garantirAdministrador não mexe em nada', async () => {
  const p = criarPoolFalso([
    [/FROM web_usuario_acesso a JOIN cliente_usuarios u/, [{ usuario_codigo: 1, perfil_id: 1, ativo: 1, perfil_ativo: 1, SITUACAO: 'ATIVO' }]],
    [/SELECT perfil_id, permissao FROM web_perfil_permissoes$/, [{ perfil_id: 1, permissao: 'admin.usuarios' }]],
    [/SELECT id, ativo FROM web_perfis$/, [{ id: 1, ativo: 1 }]]
  ]);
  assert.deepEqual(await garantirAdministrador(p, { adminInicial: 'Thiago' }), { concedido: false, usuario: null });
  assert.ok(!p.chamadas.some(c => /INSERT/.test(c.sql)));
});

// ---------- Important 2 e 3: estados na análise do cliente e nas gravações de cliente ----------
const USUARIOS = {
  2: { nome: 'Ana', permissoes: new Set(['paineis.ver', 'pedidos.ver', 'pedidos.pdf', 'clientes.ver', 'valores.ver']), estados: ['RJ'] },
  5: { nome: 'Vera', permissoes: new Set(['clientes.ver', 'clientes.editar', 'clientes.permissao', 'clientes.credito', 'clientes.receber', 'valores.ver']), estados: ['RJ'] }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
async function preparar(t, regras) {
  const f = criarPoolFalso(regras);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => {
    const u = USUARIOS[id];
    return u && { codigo: id, nome: u.nome, cargo: '', empresa: 'ELEGANCE', perfil: null, estados: u.estados, ativo: true, permissoes: u.permissoes };
  });
  t.mock.method(console, 'warn', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho, corpo) => fetch(s.url + caminho, {
    method: corpo ? 'POST' : 'GET', body: corpo ? JSON.stringify(corpo) : undefined,
    headers: { Authorization: 'Bearer ' + token(id), 'Content-Type': 'application/json' } });
  return { f, chamar };
}

test('análise do cliente: faturamento e posição da empresa ficam restritos aos estados do usuário', async t => {
  const { f, chamar } = await preparar(t, [
    [/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, RAZAO_SOCIAL: 'CLI', ESTADO: 'RJ' }]],
    [/COUNT\(\*\) AS qtd, SUM\(TOTAL\)/, [{ primeiro: '', qtd: 0, total: 0 }]],
    [/AS pedidos, SUM\(IF/, [{ pedidos: 10, orcamentos: 20, clientes: 1 }]],
    [/AS posicao/, [{ posicao: 1 }]],
    [/SUM\(VALOR\) AS total, COUNT/, [{ total: 0, qtd: 0 }]]
  ]);
  assert.equal((await chamar(2, '/clientes/analise/5')).status, 200);
  for (const re of [/AS pedidos, SUM\(IF/, /AS posicao/]) {
    const c = f.chamadas.find(x => re.test(x.sql));
    assert.match(c.sql, /ESTADO IN \(\?\)/, re.source);
    assert.ok(c.params.includes('RJ'), re.source);
  }
});

const corpoCliente = estado => ({ codigo: 5, razaoSocial: 'CLI', classe: 'Esquadria', medicao: 'Vão', telefone: '1', estado });

test('salvar cliente de fora dos estados do usuário: 403', async t => {
  const { chamar } = await preparar(t, [[/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, ESTADO: 'SP', RAZAO_SOCIAL: 'CLI' }]]]);
  assert.equal((await chamar(5, '/clientes/salvar', corpoCliente('RJ'))).status, 403);
});

test('mudar o cliente para um estado fora dos do usuário: 403', async t => {
  const { chamar } = await preparar(t, [[/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, ESTADO: 'RJ', RAZAO_SOCIAL: 'CLI' }]]]);
  assert.equal((await chamar(5, '/clientes/salvar', corpoCliente('SP'))).status, 403);
});

test('bloquear, dar crédito ou receber de cliente fora dos estados: 403', async t => {
  const { chamar } = await preparar(t, [[/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, ESTADO: 'ES', RAZAO_SOCIAL: 'CLI', PERMISSAO: 'Liberado' }]]]);
  assert.equal((await chamar(5, '/clientes/permissao', { codigo: 5 })).status, 403);
  assert.equal((await chamar(5, '/clientes/credito', { codigo: 5, valor: 10 })).status, 403);
  assert.equal((await chamar(5, '/clientes/receber', { codigo: 5, zerarCredito: true })).status, 403);
});
