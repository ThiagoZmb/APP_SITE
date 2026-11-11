const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOGO, CODIGOS, PERFIS_INICIAIS, permissoesFinais, atende } = require('../seguranca/permissoes');

const perfil = nome => PERFIS_INICIAIS.find(p => p.nome === nome);

test('catálogo tem 69 permissões e códigos únicos', () => {
  assert.equal(CATALOGO.length, 69);
  assert.equal(CODIGOS.size, 69);
  assert.ok(CODIGOS.has('entregas.checklist')); // checklist externo de entrega (2026-11-12)
  assert.ok(CODIGOS.has('precos.gravar'));
  assert.equal(CATALOGO.find(p => p.codigo === 'precos.editar').nome, 'Editar ligações de custo, parâmetros e margens');
  assert.ok(CODIGOS.has('precos.ver') && CODIGOS.has('precos.editar'));
  for (const c of ['valores.ver', 'admin.usuarios', 'estoque.movimentar', 'estoque.desfazer', 'estoque.ajustar', 'orcamentos.salvar', 'pedidos.criar', 'pedidos.cancelar', 'pedidos.excluir']) assert.ok(CODIGOS.has(c), c);
});

test('Interno completo = todas menos admin.usuarios, pedidos.criar, cancelar e excluir', () => {
  const p = perfil('Interno completo');
  assert.equal(p.permissoes.length, 50); // + entregas.checklist, + etapas.ver e as 5 etapas de produção (não finalizar nem gerir), + perfis.desenho, + danfe.ver, orcamentos.situacao, pesos.*, notas.*, atendimento.modo, + fornecedores.*, tintas.*, corte.ver/planejar, compras_nfe.* e pedidos.checklist/checklist.enviar
  assert.ok(p.permissoes.includes('precos.ver') && !p.permissoes.includes('precos.editar') && !p.permissoes.includes('precos.gravar'));
  assert.ok(p.permissoes.includes('estoque.desfazer') && p.permissoes.includes('orcamentos.salvar'));
  assert.ok(!p.permissoes.includes('admin.usuarios') && !p.permissoes.includes('pedidos.criar') && !p.permissoes.includes('pedidos.cancelar') && !p.permissoes.includes('pedidos.excluir'));
  assert.equal(perfil("Administrador").permissoes.length, 68);
  assert.ok(p.permissoes.includes('corte.ver') && p.permissoes.includes('corte.planejar')); // plano de corte: Interno completo planeja
  assert.ok(!p.permissoes.includes('corte.parametros')); // parâmetros e retalhos manuais: só o Administrador
  assert.ok(!p.permissoes.includes('gestao.ver') && !p.permissoes.includes('gestao.editar')); // Central de Gestão: só o Administrador na migração
  assert.ok(!p.permissoes.includes('portal.gerir') && perfil('Administrador').permissoes.includes('portal.gerir')); // portal do cliente: só o Administrador
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

test('etapas de produção: no catálogo (área Etapas de produção); Interno completo ganha ver e as 5 etapas, não finalizar nem gerir; Administrador tem tudo', () => {
  const etapas = ['etapas.ver', 'etapas.corte_perfil', 'etapas.corte_vidro', 'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem', 'etapas.finalizar', 'etapas.gerir'];
  for (const c of etapas) { assert.ok(CODIGOS.has(c), c); assert.equal(CATALOGO.find(p => p.codigo === c).area, 'Etapas de produção'); }
  const ic = perfil('Interno completo').permissoes;
  for (const c of etapas.slice(0, 6)) assert.ok(ic.includes(c), c);
  assert.ok(!ic.includes('etapas.finalizar') && !ic.includes('etapas.gerir'));
  for (const c of etapas) assert.ok(perfil('Administrador').permissoes.includes(c), c);
  for (const n of ['Vendedor', 'Estoquista', 'Representante']) assert.ok(!perfil(n).permissoes.some(c => c.startsWith('etapas.')), n);
});

// ---------- Administrativo × Operador (decisão do dono, 2026-11-10): a permissão-chave `administrativo.ver` ----------
const { PERMISSOES_ADMINISTRATIVAS } = require('../seguranca/permissoes');
const finais = (permissoesPerfil, excecoes = []) => permissoesFinais({ permissoesPerfil, excecoes, ativo: true });

test('administrativo.ver existe no catálogo, na área Especial, e é uma permissão como as outras', () => {
  const p = CATALOGO.find(x => x.codigo === 'administrativo.ver');
  assert.ok(p && p.area === 'Especial' && CODIGOS.has('administrativo.ver'));
});

test('com a chave: o usuário ganha valores.ver sozinho (a classe administrativa vê dinheiro)', () => {
  const f = finais(['administrativo.ver', 'financeiro.ver']);
  assert.ok(f.has('valores.ver') && f.has('financeiro.ver') && f.has('administrativo.ver'));
});

test('sem a chave: as permissões administrativas SOMEM, venham do perfil ou de exceção "liberar"', () => {
  const todas = ['paineis.ver', 'indicadores.ver', 'financeiro.ver', 'financeiro.lancar', 'financeiro.excluir', 'gestao.ver', 'gestao.editar',
    'precos.ver', 'precos.editar', 'precos.gravar', 'clientes.receber', 'clientes.credito'];
  assert.deepEqual([...PERMISSOES_ADMINISTRATIVAS].sort(), [...todas].sort());
  const doPerfil = finais([...todas, 'estoque.ver', 'pedidos.ver']);
  for (const c of todas) assert.ok(!doPerfil.has(c), c);
  assert.ok(doPerfil.has('estoque.ver') && doPerfil.has('pedidos.ver'), 'o que é operacional fica');
  const porExcecao = finais(['estoque.ver'], todas.map(c => ({ permissao: c, tipo: 'liberar' })));
  for (const c of todas) assert.ok(!porExcecao.has(c), 'exceção liberar não vale sem a chave: ' + c);
});

test('a chave pode vir de exceção "liberar" e ser derrubada por "bloquear"', () => {
  assert.ok(finais(['estoque.ver'], [{ permissao: 'administrativo.ver', tipo: 'liberar' }]).has('valores.ver'));
  const f = finais(['administrativo.ver', 'financeiro.ver'], [{ permissao: 'administrativo.ver', tipo: 'bloquear' }]);
  assert.ok(!f.has('financeiro.ver') && !f.has('valores.ver'), 'sem a chave, nada administrativo');
});

test('terceira situação: valores.ver SEM a chave continua valendo (Vendedor e Representante veem preço, sem gráficos nem gestão)', () => {
  for (const nome of ['Vendedor', 'Representante']) {
    const f = finais(perfil(nome).permissoes);
    assert.ok(f.has('valores.ver') && f.has('pedidos.ver'), nome);
    assert.ok(!f.has('paineis.ver') && !f.has('administrativo.ver'), nome + ' perde o Início, mas não o preço');
  }
});

test('Administrador e Interno completo têm a chave; Operador é perfil pronto, sem a chave e sem valores', () => {
  assert.ok(perfil('Administrador').permissoes.includes('administrativo.ver'));
  assert.ok(perfil('Interno completo').permissoes.includes('administrativo.ver'));
  const op = perfil('Operador');
  assert.ok(op, 'perfil Operador');
  for (const proibido of ['administrativo.ver', 'valores.ver', ...PERMISSOES_ADMINISTRATIVAS, 'admin.usuarios', 'estoque.ajustar', 'estoque.editar']) {
    assert.ok(!op.permissoes.includes(proibido), proibido);
  }
  for (const c of ['estoque.ver', 'estoque.movimentar', 'pedidos.ver', 'pedidos.situacao', 'etapas.ver', 'entregas.ver']) assert.ok(op.permissoes.includes(c), c);
  assert.ok(op.permissoes.every(c => CODIGOS.has(c)), 'só códigos do catálogo');
});
