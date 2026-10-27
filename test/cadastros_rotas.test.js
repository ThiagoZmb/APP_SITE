// Rotas de fornecedores e de funcionários (banco simulado em test/apoio/bancoCadastros.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoCadastros, prepararCadastros } = require('./apoio/bancoCadastros');
const { REGEX_VALOR } = require('../seguranca/valores');

const FORN = { razao: 'ALUMINIO SUL LTDA', cidade: 'Niterói', uf: 'RJ', classe: 'Matéria prima', telefone: '2133334444' };
const FUNC = { nome: 'Maria Souza', cargo: 'Auxiliar', admissao: '2025-01-10', cpf: '529.982.247-25', salarioBase: 2000, almoco: 300 };
const salvar = (chamar, rota, corpo) => chamar(`/${rota}/salvar`, 'POST', corpo);

// ---------------- fornecedores ----------------
test('fornecedores: cria (código gerado, auditado), duplicado 409, valida 400', async t => {
  const { banco, chamar } = await prepararCadastros(t);
  const r = await salvar(chamar, 'fornecedores', FORN);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.criado, true);
  assert.equal(banco.fornecedores.length, 1);
  assert.equal(banco.fornecedores[0].RAZAO_FABRICANTE, 'ALUMINIO SUL LTDA');
  assert.equal(banco.fornecedores[0].STATUS, 'Ativo');
  assert.equal(banco.auditoria[0].acao, 'fornecedor_criado');
  const dup = await salvar(chamar, 'fornecedores', { ...FORN, razao: 'aluminio sul ltda' });
  assert.equal(dup.status, 409);
  assert.equal(banco.fornecedores.length, 1);
  assert.equal((await salvar(chamar, 'fornecedores', { ...FORN, razao: '' })).status, 400);
  assert.equal((await salvar(chamar, 'fornecedores', { ...FORN, razao: 'Outro', classe: 'X' })).status, 400);
  assert.equal(banco.fornecedores.length, 1);
});

test('fornecedores: atualiza dados e situação; razão social não muda (409); código inexistente 404', async t => {
  const banco = bancoCadastros(); const f = banco.semear.fornecedor();
  const { chamar } = await prepararCadastros(t, { banco });
  const r = await salvar(chamar, 'fornecedores', { ...FORN, codigo: f.COD, telefone: '2199998888', status: 'Inativo', cnpj: '11222333000181' });
  assert.equal(r.status, 200);
  assert.equal(banco.fornecedores[0].TELEFONE, '2199998888');
  assert.equal(banco.fornecedores[0].STATUS, 'Inativo');
  assert.equal(banco.fornecedores[0].CNPJ, '11.222.333/0001-81');
  assert.equal(banco.auditoria.at(-1).acao, 'fornecedor_alterado');
  assert.deepEqual(banco.auditoria.at(-1).detalhe.campos.sort(), ['cnpj', 'status', 'telefone']);
  const renomear = await salvar(chamar, 'fornecedores', { ...FORN, codigo: f.COD, razao: 'NOVO NOME' });
  assert.equal(renomear.status, 409);
  assert.match((await renomear.json()).error, /razão social/i);
  assert.equal(banco.fornecedores[0].RAZAO_FABRICANTE, 'ALUMINIO SUL LTDA');
  assert.equal((await salvar(chamar, 'fornecedores', { ...FORN, codigo: 999 })).status, 404);
  assert.equal((await salvar(chamar, 'fornecedores', { ...FORN, codigo: 'abc' })).status, 400);
});

test('fornecedores: lista (sem o "." do VB), filtra por situação e busca, detalhe e 404', async t => {
  const banco = bancoCadastros();
  banco.semear.fornecedor({ RAZAO_FABRICANTE: '.' });
  banco.semear.fornecedor({ RAZAO_FABRICANTE: 'ZINCO NORTE', CIDADE: 'Macaé', STATUS: 'Inativo' });
  const a = banco.semear.fornecedor({ RAZAO_FABRICANTE: 'ALUMINIO SUL', CNPJ: '11.222.333/0001-81' });
  const { chamar } = await prepararCadastros(t, { banco, perfil: 'Somente ver fornecedores' });
  let j = await (await chamar('/fornecedores')).json();
  assert.deepEqual(j.fornecedores.map(f => f.razao), ['ALUMINIO SUL', 'ZINCO NORTE']);
  assert.deepEqual(j.classes, ['Matéria prima', 'Insumos', 'Serviços', 'Geral']);
  j = await (await chamar('/fornecedores?status=Inativo')).json();
  assert.deepEqual(j.fornecedores.map(f => f.razao), ['ZINCO NORTE']);
  j = await (await chamar('/fornecedores?busca=macaé')).json();
  assert.deepEqual(j.fornecedores.map(f => f.razao), ['ZINCO NORTE']);
  j = await (await chamar('/fornecedores?busca=0001-81')).json();
  assert.deepEqual(j.fornecedores.map(f => f.razao), ['ALUMINIO SUL']);
  const d = await (await chamar(`/fornecedores/${a.COD}`)).json();
  assert.equal(d.fornecedor.cnpj, '11.222.333/0001-81');
  assert.equal((await chamar('/fornecedores/999')).status, 404);
  assert.equal((await chamar('/fornecedores/abc')).status, 404);
});

test('fornecedores: sem permissão 403 (ver e editar); só ver não salva', async t => {
  const banco = bancoCadastros(); banco.semear.fornecedor();
  const { chamar } = await prepararCadastros(t, { banco, perfil: 'Sem acesso' });
  assert.equal((await chamar('/fornecedores')).status, 403);
  assert.equal((await chamar('/fornecedores/1')).status, 403);
  assert.equal((await salvar(chamar, 'fornecedores', FORN)).status, 403);
  const { chamar: ver } = await prepararCadastros(t, { banco, perfil: 'Somente ver fornecedores' });
  assert.equal((await ver('/fornecedores')).status, 200);
  assert.equal((await salvar(ver, 'fornecedores', FORN)).status, 403);
  assert.equal(banco.fornecedores.length, 1);
});

// ---------------- funcionários ----------------
test('funcionários: cria sem valores.ver — dinheiro vira 0, SENHA vazia, NIVEL = cargo, demissão = hoje (como o VB)', async t => {
  const { banco, chamar } = await prepararCadastros(t, { perfil: 'RH' });
  const r = await salvar(chamar, 'funcionarios', FUNC);
  assert.equal(r.status, 200);
  const f = banco.funcionarios[0];
  assert.equal(f.NOME, 'Maria Souza');
  assert.equal(f.CPF, '529.982.247-25');
  assert.equal(f.SALARIO_BASE, 0);
  assert.equal(f.ALMOCO, 0);
  assert.equal(f.SENHA, '');
  assert.equal(f.NIVEL, 'Auxiliar');
  assert.equal(f.DARF, 0);
  assert.match(f.DEMISSAO, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(banco.auditoria[0].acao, 'funcionario_criado');
});

test('funcionários: com valores.ver grava o dinheiro; sem ela, editar mantém o que já estava gravado e não toca SENHA/DARF', async t => {
  const banco = bancoCadastros();
  const { chamar: comValores } = await prepararCadastros(t, { banco, perfil: 'RH com valores' });
  await salvar(comValores, 'funcionarios', FUNC);
  assert.equal(banco.funcionarios[0].SALARIO_BASE, 2000);
  assert.equal(banco.funcionarios[0].ALMOCO, 300);
  banco.funcionarios[0].SENHA = 'segredo'; banco.funcionarios[0].DARF = 5;
  const { chamar: rh } = await prepararCadastros(t, { banco, perfil: 'RH' });
  const r = await salvar(rh, 'funcionarios', { ...FUNC, codigo: 1, telefone: '2199990000', salarioBase: 99999, almoco: 1 });
  assert.equal(r.status, 200);
  const f = banco.funcionarios[0];
  assert.equal(f.TELEFONE, '2199990000');
  assert.equal(f.SALARIO_BASE, 2000);
  assert.equal(f.ALMOCO, 300);
  assert.equal(f.SENHA, 'segredo');
  assert.equal(f.DARF, 5);
  const det = banco.auditoria.at(-1).detalhe;
  assert.equal(det.codigo, 1);
  assert.ok(det.campos.includes('telefone'));
  assert.ok(!det.campos.includes('salarioBase'));
  assert.ok(!JSON.stringify(banco.auditoria).includes('529.982'), 'CPF não vai para a auditoria');
});

test('funcionários: detalhe nunca devolve SENHA; sem valores.ver não devolve dinheiro; com ela devolve; nenhuma chave de dinheiro vaza', async t => {
  const banco = bancoCadastros(); banco.semear.funcionario({ SITUACAO: 'Ativo' });
  const { chamar: rh } = await prepararCadastros(t, { banco, perfil: 'Somente ver funcionários' });
  const sem = await (await rh('/funcionarios/1')).json();
  assert.equal(sem.funcionario.nome, 'João da Silva');
  assert.equal(sem.funcionario.cargo, 'Serralheiro');
  for (const k of ['salarioBase', 'fgts', 'ferias', 'feriasFgts', 'decimo', 'decimoFgts', 'almoco', 'transporte', 'planoSaude', 'segVida', 'outros']) assert.equal(k in sem.funcionario, false, k);
  assert.ok(!JSON.stringify(sem).includes('segredo-do-vb'));
  assert.equal(sem.funcionario.demissao, null); // ativo: a data gravada pelo VB não aparece
  const { chamar: comValores } = await prepararCadastros(t, { banco, perfil: 'RH com valores' });
  const com = await (await comValores('/funcionarios/1')).json();
  assert.equal(com.funcionario.salarioBase, 2500);
  assert.equal(com.funcionario.almoco, 400);
  assert.ok(!JSON.stringify(com).includes('segredo-do-vb'));
  assert.ok(!('SENHA' in com.funcionario) && !('senha' in com.funcionario));
  const lista = await (await rh('/funcionarios')).json();
  assert.deepEqual(Object.keys(lista.funcionarios[0]).sort(), ['admissao', 'cargo', 'cidade', 'codigo', 'nome', 'situacao', 'telefone', 'uf']);
  assert.ok(!Object.keys(sem.funcionario).some(k => REGEX_VALOR.test(k)));
});

test('funcionários: lista com filtros, cargos do VB, 404, validação 400 e demitido mostra a demissão', async t => {
  const banco = bancoCadastros();
  banco.semear.funcionario({ NOME: 'Ana', CARGO: 'Auxiliar' });
  banco.semear.funcionario({ NOME: 'Bruno', SITUACAO: 'Demitido', DEMISSAO: '2026-05-02' });
  const { chamar } = await prepararCadastros(t, { banco, perfil: 'RH' });
  let j = await (await chamar('/funcionarios')).json();
  assert.deepEqual(j.funcionarios.map(f => f.nome), ['Ana', 'Bruno']);
  j = await (await chamar('/funcionarios?situacao=Demitido')).json();
  assert.deepEqual(j.funcionarios.map(f => f.nome), ['Bruno']);
  j = await (await chamar('/funcionarios?busca=auxiliar')).json();
  assert.deepEqual(j.funcionarios.map(f => f.nome), ['Ana']);
  assert.deepEqual((await (await chamar('/funcionarios/cargos')).json()).cargos, ['Auxiliar', 'Serralheiro']);
  assert.equal((await (await chamar('/funcionarios/2')).json()).funcionario.demissao, '2026-05-02');
  assert.equal((await chamar('/funcionarios/999')).status, 404);
  assert.equal((await salvar(chamar, 'funcionarios', { ...FUNC, codigo: 999 })).status, 404);
  assert.equal((await salvar(chamar, 'funcionarios', { ...FUNC, admissao: '' })).status, 400);
  assert.equal((await salvar(chamar, 'funcionarios', { ...FUNC, cpf: '123' })).status, 400);
  assert.equal(banco.funcionarios.length, 2);
});

test('funcionários: sem permissão 403 (Compras não vê funcionários); só ver não salva', async t => {
  const banco = bancoCadastros(); banco.semear.funcionario();
  const { chamar } = await prepararCadastros(t, { banco, perfil: 'Compras' });
  assert.equal((await chamar('/funcionarios')).status, 403);
  assert.equal((await chamar('/funcionarios/1')).status, 403);
  assert.equal((await chamar('/funcionarios/cargos')).status, 403);
  assert.equal((await salvar(chamar, 'funcionarios', FUNC)).status, 403);
  const { chamar: ver } = await prepararCadastros(t, { banco, perfil: 'Somente ver funcionários' });
  assert.equal((await salvar(ver, 'funcionarios', FUNC)).status, 403);
  assert.equal(banco.funcionarios.length, 1);
});
