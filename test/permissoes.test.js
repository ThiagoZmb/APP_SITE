const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOGO, CODIGOS, PERFIS_INICIAIS, permissoesFinais, atende } = require('../seguranca/permissoes');

const perfil = nome => PERFIS_INICIAIS.find(p => p.nome === nome);

test('catálogo tem 21 permissões e códigos únicos', () => {
  assert.equal(CATALOGO.length, 21);
  assert.equal(CODIGOS.size, 21);
  for (const c of ['valores.ver', 'admin.usuarios', 'estoque.movimentar', 'estoque.desfazer', 'estoque.ajustar']) assert.ok(CODIGOS.has(c), c);
});

test('Interno completo = todas menos admin.usuarios', () => {
  const p = perfil('Interno completo');
  assert.equal(p.permissoes.length, 20);
  assert.ok(p.permissoes.includes('estoque.desfazer') && p.permissoes.includes('estoque.ajustar'));
  assert.ok(!p.permissoes.includes('admin.usuarios'));
  assert.equal(perfil('Administrador').permissoes.length, 21);
});

test('Estoquista não tem valores.ver', () => {
  assert.deepEqual([...perfil('Estoquista').permissoes].sort(), ['estoque.movimentar', 'estoque.ver']);
});

test('exceção bloquear vence o perfil', () => {
  const p = permissoesFinais({ permissoesPerfil: ['estoque.ver', 'valores.ver'], excecoes: [{ permissao: 'valores.ver', tipo: 'bloquear' }], ativo: true });
  assert.ok(p.has('estoque.ver'));
  assert.ok(!p.has('valores.ver'));
});

test('exceção liberar acrescenta', () => {
  const p = permissoesFinais({ permissoesPerfil: ['estoque.ver'], excecoes: [{ permissao: 'estoque.editar', tipo: 'liberar' }], ativo: true });
  assert.deepEqual([...p].sort(), ['estoque.editar', 'estoque.ver']);
});

test('inativo não tem nada', () => {
  assert.equal(permissoesFinais({ permissoesPerfil: ['estoque.ver'], excecoes: [], ativo: false }).size, 0);
});

test('código desconhecido é ignorado', () => {
  const p = permissoesFinais({ permissoesPerfil: ['xpto.ver'], excecoes: [{ permissao: 'abc', tipo: 'liberar' }], ativo: true });
  assert.equal(p.size, 0);
});

test('atende com algum + todos', () => {
  assert.deepEqual(atende(new Set(['pedidos.ver']), [{ algum: ['paineis.ver', 'pedidos.ver'] }, 'valores.ver']),
    { ok: false, faltando: ['valores.ver'] });
  assert.deepEqual(atende(new Set(['pedidos.ver', 'valores.ver']), [{ algum: ['paineis.ver', 'pedidos.ver'] }, 'valores.ver']),
    { ok: true, faltando: [] });
  assert.deepEqual(atende(new Set([]), [{ algum: ['a.b', 'c.d'] }]), { ok: false, faltando: ['algum:a.b|c.d'] });
  assert.deepEqual(atende(new Set([]), []), { ok: true, faltando: [] });
});
