const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOGO, CODIGOS, PERFIS_INICIAIS, permissoesFinais, atende } = require('../seguranca/permissoes');

const perfil = nome => PERFIS_INICIAIS.find(p => p.nome === nome);

test('catálogo tem 46 permissões e códigos únicos', () => {
  assert.equal(CATALOGO.length, 46);
  assert.equal(CODIGOS.size, 46);
  assert.ok(CODIGOS.has('precos.gravar'));
  assert.equal(CATALOGO.find(p => p.codigo === 'precos.editar').nome, 'Editar ligações de custo, parâmetros e margens');
  assert.ok(CODIGOS.has('precos.ver') && CODIGOS.has('precos.editar'));
  for (const c of ['valores.ver', 'admin.usuarios', 'estoque.movimentar', 'estoque.desfazer', 'estoque.ajustar', 'orcamentos.salvar', 'pedidos.criar', 'pedidos.cancelar', 'pedidos.excluir']) assert.ok(CODIGOS.has(c), c);
});

test('Interno completo = todas menos admin.usuarios, pedidos.criar, cancelar e excluir', () => {
  const p = perfil('Interno completo');
  assert.equal(p.permissoes.length, 33); // + notas.*, atendimento.modo, + fornecedores.*, tintas.* e corte.ver/planejar
  assert.ok(p.permissoes.includes('precos.ver') && !p.permissoes.includes('precos.editar') && !p.permissoes.includes('precos.gravar'));
  assert.ok(p.permissoes.includes('estoque.desfazer') && p.permissoes.includes('orcamentos.salvar'));
  assert.ok(!p.permissoes.includes('admin.usuarios') && !p.permissoes.includes('pedidos.criar') && !p.permissoes.includes('pedidos.cancelar') && !p.permissoes.includes('pedidos.excluir'));
  assert.equal(perfil('Administrador').permissoes.length, 45);
  assert.ok(p.permissoes.includes('corte.ver') && p.permissoes.includes('corte.planejar')); // plano de corte: Interno completo planeja
  assert.ok(!p.permissoes.includes('corte.parametros')); // parâmetros e retalhos manuais: só o Administrador
  assert.ok(!p.permissoes.includes('gestao.ver') && !p.permissoes.includes('gestao.editar')); // Central de Gestão: só o Administrador na migração
  assert.ok(!p.permissoes.includes('pedidos.situacao')); // mudar situação: só o Administrador
});

test('Vendedor salva orçamento mas não pedido', () => {
  const p = perfil('Vendedor').permissoes;
  assert.ok(p.includes('orcamentos.salvar') && !p.includes('pedidos.criar'));
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

test('preços: só Administrador e Interno completo veem; vendedor, estoquista e representante não', () => {
  for (const n of ['Vendedor', 'Estoquista', 'Representante']) assert.ok(!perfil(n).permissoes.some(c => c.startsWith('precos.')), n);
});

test('entregas: no catálogo (área Entregas); Interno completo não vira motorista; Administrador tem tudo', () => {
  for (const c of ['entregas.ver', 'entregas.programar', 'entregas.baixar']) {
    assert.ok(CODIGOS.has(c), c);
    assert.equal(CATALOGO.find(p => p.codigo === c).area, 'Entregas');
  }
  const ic = perfil('Interno completo').permissoes;
  assert.ok(ic.includes('entregas.ver') && ic.includes('entregas.programar') && !ic.includes('entregas.baixar'));
  assert.ok(perfil('Administrador').permissoes.includes('entregas.baixar'));
  for (const n of ['Vendedor', 'Estoquista', 'Representante']) assert.ok(!perfil(n).permissoes.some(c => c.startsWith('entregas.')), n);
});

test('cadastros: fornecedores para Administrador e Interno completo; funcionários só para o Administrador; outros perfis nada', () => {
  for (const c of ['fornecedores.ver', 'fornecedores.editar', 'funcionarios.ver', 'funcionarios.editar']) {
    assert.ok(CODIGOS.has(c), c);
    assert.equal(CATALOGO.find(p => p.codigo === c).area, 'Cadastros');
    assert.ok(perfil('Administrador').permissoes.includes(c), c);
  }
  const ic = perfil('Interno completo').permissoes;
  assert.ok(ic.includes('fornecedores.ver') && ic.includes('fornecedores.editar'));
  assert.ok(!ic.includes('funcionarios.ver') && !ic.includes('funcionarios.editar'));
  for (const n of ['Vendedor', 'Estoquista', 'Representante']) {
    assert.ok(!perfil(n).permissoes.some(c => c.startsWith('fornecedores.') || c.startsWith('funcionarios.')), n);
  }
});

test('tintas: Administrador e Interno completo recebem tintas.ver e tintas.editar; outros perfis nada', () => {
  for (const c of ['tintas.ver', 'tintas.editar']) {
    assert.ok(CODIGOS.has(c), c);
    assert.equal(CATALOGO.find(p => p.codigo === c).area, 'Cadastros');
    assert.ok(perfil('Administrador').permissoes.includes(c), c);
    assert.ok(perfil('Interno completo').permissoes.includes(c), c);
  }
  for (const n of ['Vendedor', 'Estoquista', 'Representante']) assert.ok(!perfil(n).permissoes.some(c => c.startsWith('tintas.')), n);
});
