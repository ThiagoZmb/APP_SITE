process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso } = require('../index.js');
const { PERFIS_INICIAIS } = require('../seguranca/permissoes');

// banco simulado com estado: 1 = Thiago (Administrador), 2 = Caio (Estoquista), 3 = Ana (Interno completo)
function bancoComEstado() {
  const perfis = PERFIS_INICIAIS.map((p, i) => ({ id: i + 1, nome: p.nome, ativo: 1, permissoes: [...p.permissoes] }));
  perfis.push({ id: 6, nome: 'Admin antigo (desativado)', ativo: 0, permissoes: ['admin.usuarios'] });
  const usuarios = {
    1: { CODIGO: 1, NOME: 'Thiago', CARGO: 'Administrador', RAZAO_SOCIAL: 'ELEGANCE', SITUACAO: 'ATIVO' },
    2: { CODIGO: 2, NOME: 'Caio', CARGO: 'Produção', RAZAO_SOCIAL: 'ELEGANCE', SITUACAO: 'ATIVO' },
    3: { CODIGO: 3, NOME: 'Ana', CARGO: 'Vendas', RAZAO_SOCIAL: 'ELEGANCE', SITUACAO: 'ATIVO' }
  };
  const acessos = { 1: { perfil_id: 1, estados: null, ativo: 1 }, 2: { perfil_id: 4, estados: null, ativo: 1 }, 3: { perfil_id: 2, estados: null, ativo: 1 } };
  const excecoes = [];
  const perfilPor = id => perfis.find(p => p.id === Number(id));
  const f = criarPoolFalso([
    // seguranca/acesso.js
    [/FROM cliente_usuarios WHERE CODIGO = \? LIMIT 1/, (sql, [c]) => usuarios[c] ? [usuarios[c]] : []],
    [/FROM web_usuario_acesso a LEFT JOIN web_perfis p/, (sql, [c]) => {
      const a = acessos[c]; if (!a) return [];
      const p = perfilPor(a.perfil_id);
      return [{ ...a, perfil_nome: p?.nome, perfil_ativo: p?.ativo }];
    }],
    [/SELECT permissao FROM web_perfil_permissoes WHERE perfil_id = \?/, (sql, [id]) => (perfilPor(id)?.permissoes || []).map(permissao => ({ permissao }))],
    [/SELECT permissao, tipo FROM web_usuario_excecoes WHERE usuario_codigo = \?/, (sql, [c]) => excecoes.filter(e => e.usuario_codigo === Number(c))],
    // rotas/admin.js
    [/FROM web_usuario_acesso a JOIN cliente_usuarios u/, () => Object.entries(acessos).map(([c, a]) => ({
      usuario_codigo: Number(c), perfil_id: a.perfil_id, ativo: a.ativo, perfil_ativo: perfilPor(a.perfil_id)?.ativo, SITUACAO: usuarios[c].SITUACAO }))],
    [/SELECT id, ativo FROM web_perfis$/, () => perfis.map(p => ({ id: p.id, ativo: p.ativo }))],
    [/SELECT perfil_id, permissao FROM web_perfil_permissoes$/, () => perfis.flatMap(p => p.permissoes.map(permissao => ({ perfil_id: p.id, permissao })))],
    [/SELECT usuario_codigo, permissao, tipo FROM web_usuario_excecoes$/, () => excecoes],
    [/SELECT perfil_id, estados, ativo FROM web_usuario_acesso WHERE usuario_codigo = \?/, (sql, [c]) => acessos[c] ? [acessos[c]] : []],
    [/SELECT CODIGO, NOME FROM cliente_usuarios WHERE CODIGO = \?/, (sql, [c]) => usuarios[c] ? [usuarios[c]] : []],
    [/INSERT INTO web_usuario_acesso/, (sql, [c, perfil_id, estados, ativo]) => { acessos[c] = { perfil_id, estados, ativo }; return { affectedRows: 1 }; }],
    [/DELETE FROM web_usuario_excecoes/, (sql, [c]) => { for (let i = excecoes.length - 1; i >= 0; i--) if (excecoes[i].usuario_codigo === Number(c)) excecoes.splice(i, 1); return {}; }],
    [/DELETE FROM web_usuario_acesso WHERE usuario_codigo = \?/, (sql, [c]) => { delete acessos[c]; return {}; }],
    [/DELETE FROM cliente_usuarios WHERE CODIGO = \?/, (sql, [c]) => {
      const existed = !!usuarios[c];
      delete usuarios[c];
      return { affectedRows: existed ? 1 : 0 };
    }],
    [/INSERT INTO web_usuario_excecoes/, (sql, [c, permissao, tipo]) => { excecoes.push({ usuario_codigo: Number(c), permissao, tipo }); return {}; }],
    [/SELECT CARGO FROM cargos WHERE CARGO = \?/, (sql, [c]) => ['Administrador', 'Produção', 'Vendas'].includes(c) ? [{ CARGO: c }] : []],
    [/SELECT RAZAO_SOCIAL FROM cadastro_clientes WHERE RAZAO_SOCIAL = \?/, (sql, [r]) => r === 'ELEGANCE' ? [{ RAZAO_SOCIAL: r }] : []],
    [/SELECT id FROM web_perfis WHERE id = \?/, (sql, [id]) => perfilPor(id) ? [{ id: Number(id) }] : []],
    [/SELECT CODIGO FROM cliente_usuarios WHERE NOME = \?/, (sql, [n]) => Object.values(usuarios).filter(u => u.NOME === n)],
    [/SELECT MAX\(CODIGO\) AS m FROM cliente_usuarios FOR UPDATE/, () => [{ m: 3 }]],
    [/INSERT INTO cliente_usuarios/, () => ({ affectedRows: 1 })],
    [/UPDATE cliente_usuarios SET SENHA/, () => ({ affectedRows: 1 })],
    [/SELECT id, nome, descricao, ativo FROM web_perfis WHERE id = \?/, (sql, [id]) => perfilPor(id) ? [perfilPor(id)] : []],
    [/UPDATE web_perfis SET/, (sql, [nome, descricao, ativo, id]) => { Object.assign(perfilPor(id), { nome, ativo }); return { affectedRows: 1 }; }],
    [/DELETE FROM web_perfil_permissoes/, (sql, [id]) => { perfilPor(id).permissoes = []; return {}; }],
    [/INSERT INTO web_perfil_permissoes/, (sql, [id, c]) => { perfilPor(id).permissoes.push(c); return {}; }],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
  return { f, usuarios, acessos, excecoes, perfis };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t) {
  const banco = bancoComEstado();
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  acesso.limpar();
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(id, banco.usuarios[id]?.NOME || 'Removido'), 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined });
  return { banco, chamar };
}

test('sem admin.usuarios recebe 403 em /admin/usuarios', async t => {
  const { chamar } = await preparar(t);
  assert.equal((await chamar(2, '/admin/usuarios')).status, 403);
  assert.equal((await chamar(1, '/admin/permissoes')).status, 200);
});

test('criar usuário usa transação e FOR UPDATE', async t => {
  const { banco, chamar } = await preparar(t);
  const r = await chamar(1, '/admin/usuarios', 'POST', { nome: 'Novo', senha: 'segredo123', cargo: 'Produção', empresa: 'ELEGANCE', perfilId: 4, estados: '' });
  assert.equal(r.status, 201, await r.clone().text());
  assert.deepEqual(await r.json(), { codigo: 4 });
  const seq = banco.f.chamadas.map(c => c.sql);
  const i = n => seq.findIndex(s => n.test(s));
  assert.ok(i(/^BEGIN$/) < i(/FOR UPDATE/) && i(/FOR UPDATE/) < i(/INSERT INTO cliente_usuarios/) && i(/INSERT INTO cliente_usuarios/) < i(/^COMMIT$/));
  const ins = banco.f.chamadas.find(c => /INSERT INTO cliente_usuarios/.test(c.sql));
  assert.equal(ins.params[0], 4);
  assert.match(ins.params[3], /^\$2[aby]\$12\$/);
  assert.ok(banco.f.chamadas.some(c => /INSERT INTO web_auditoria/.test(c.sql)));
});

test('cargo inexistente ⇒ 400', async t => {
  const { chamar } = await preparar(t);
  const r = await chamar(1, '/admin/usuarios', 'POST', { nome: 'X', senha: 'segredo123', cargo: 'Astronauta', empresa: 'ELEGANCE', perfilId: 4 });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Cargo inexistente.' });
});

test('senha curta ⇒ 400', async t => {
  const { chamar } = await preparar(t);
  const r = await chamar(1, '/admin/usuarios/2/senha', 'POST', { senha: '123' });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'A senha precisa ter pelo menos 8 caracteres.' });
});

test('desativar usuário derruba a sessão dele na hora', async t => {
  const { chamar } = await preparar(t);
  assert.equal((await chamar(2, '/auth/verify')).status, 200);
  const r = await chamar(1, '/admin/usuarios/2', 'PUT', { ativo: false });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await chamar(2, '/auth/verify')).status, 401);
});

test('excluir usuário remove dependências e encerra a sessão', async t => {
  const { banco, chamar } = await preparar(t);
  banco.excecoes.push({ usuario_codigo: 2, permissao: 'estoque.editar', tipo: 'liberar' });
  const r = await chamar(1, '/admin/usuarios/2', 'DELETE');
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(banco.usuarios[2], undefined);
  assert.equal(banco.acessos[2], undefined);
  assert.deepEqual(banco.excecoes, []);
  const seq = banco.f.chamadas.map(c => c.sql);
  const i = n => seq.findIndex(s => n.test(s));
  assert.ok(i(/^BEGIN$/) < i(/DELETE FROM web_usuario_excecoes/) &&
    i(/DELETE FROM web_usuario_excecoes/) < i(/DELETE FROM web_usuario_acesso/) &&
    i(/DELETE FROM web_usuario_acesso/) < i(/DELETE FROM cliente_usuarios/) &&
    i(/DELETE FROM cliente_usuarios/) < i(/^COMMIT$/));
  assert.ok(banco.f.chamadas.some(c => /INSERT INTO web_auditoria/.test(c.sql) && c.params.includes('usuario_excluido')));
  assert.equal((await chamar(2, '/auth/verify')).status, 401);
});

test('não exclui a própria conta nem deixa o sistema sem administrador', async t => {
  const { banco, chamar } = await preparar(t);
  const proprio = await chamar(1, '/admin/usuarios/1', 'DELETE');
  assert.equal(proprio.status, 409);
  assert.deepEqual(await proprio.json(), { error: 'Você não pode excluir sua própria conta.' });
  await chamar(1, '/auth/verify');
  banco.acessos[1] = { perfil_id: 2, estados: null, ativo: 1 };
  banco.acessos[2] = { perfil_id: 1, estados: null, ativo: 1 };
  const semUltimo = await chamar(1, '/admin/usuarios/2', 'DELETE');
  assert.equal(semUltimo.status, 409);
  assert.deepEqual(await semUltimo.json(), { error: 'Não é possível deixar o sistema sem nenhum administrador ativo.' });
  assert.ok(banco.usuarios[2]);
});

test('não remove o próprio admin (mesmo havendo outro administrador)', async t => {
  const { banco, chamar } = await preparar(t);
  banco.excecoes.push({ usuario_codigo: 3, permissao: 'admin.usuarios', tipo: 'liberar' }); // Ana também é admin
  const r = await chamar(1, '/admin/usuarios/1', 'PUT', { perfilId: 2 });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'Você não pode remover o seu próprio acesso de administrador.' });
});

test('não deixa o sistema sem administrador', async t => {
  const { banco, chamar } = await preparar(t);
  // Ana vira administradora por exceção e tenta desativar o perfil Administrador (o do Thiago): sobraria ela — ok.
  banco.excecoes.push({ usuario_codigo: 3, permissao: 'admin.usuarios', tipo: 'liberar' });
  acesso.limpar();
  const r = await chamar(3, '/admin/perfis/1', 'PUT', { ativo: false });
  assert.equal(r.status, 200, await r.clone().text()); // Ana continua admin pela exceção
  // Ana tira a própria exceção: não sobraria nenhum administrador (a trava mais grave vence)
  const r2 = await chamar(3, '/admin/usuarios/3', 'PUT', { excecoes: [] });
  assert.equal(r2.status, 409);
  assert.deepEqual(await r2.json(), { error: 'Não é possível deixar o sistema sem nenhum administrador ativo.' });
  banco.perfis[0].ativo = 1; acesso.limpar();
  const r3 = await chamar(1, '/admin/usuarios/3', 'PUT', { excecoes: [] });
  assert.equal(r3.status, 200); // Thiago continua admin
  const r4 = await chamar(1, '/admin/perfis/1', 'PUT', { ativo: false });
  assert.equal(r4.status, 409);
  assert.deepEqual(await r4.json(), { error: 'Não é possível deixar o sistema sem nenhum administrador ativo.' });
});

test('exceção com código desconhecido é ignorada', async t => {
  const { banco, chamar } = await preparar(t);
  const r = await chamar(1, '/admin/usuarios/2', 'PUT', { excecoes: [{ permissao: 'xpto.ver', tipo: 'liberar' }, { permissao: 'estoque.editar', tipo: 'liberar' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(banco.excecoes, [{ usuario_codigo: 2, permissao: 'estoque.editar', tipo: 'liberar' }]);
});

test('ficha do usuário traz exceções e permissões finais', async t => {
  const { chamar } = await preparar(t);
  const d = await (await chamar(1, '/admin/usuarios/2')).json();
  assert.equal(d.nome, 'Caio');
  assert.deepEqual(d.permissoesFinais.sort(), ['estoque.movimentar', 'estoque.ver']);
  assert.deepEqual(d.excecoes, []);
});

test('mover o último admin para um perfil desativado (mesmo com admin.usuarios) é recusado', async t => {
  const { chamar } = await preparar(t);
  const r = await chamar(1, '/admin/usuarios/1', 'PUT', { perfilId: 6 });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'Não é possível deixar o sistema sem nenhum administrador ativo.' });
});
