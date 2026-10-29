// Rotas do cadastro de peso (banco simulado em test/apoio/bancoPesos.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoPesos, prepararPesos } = require('./apoio/bancoPesos');
const { REGEX_VALOR } = require('../seguranca/valores');

const PESO = { tipo: 'perfil', produto: 'Perfil 30', unidadePeso: 'kg_m', kgPorUnidade: '1,25' };
const salvar = (chamar, corpo) => chamar('/pesos', 'PUT', corpo);

// todos os nomes de campo de um JSON (recursivo)
const nomes = (v, acc = new Set()) => {
  if (Array.isArray(v)) v.forEach(x => nomes(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); nomes(x, acc); }
  return acc;
};

test('pesos: PUT cria (vírgula decimal), atualiza o mesmo produto e audita só nomes de campos', async t => {
  const { banco, chamar } = await prepararPesos(t);
  let r = await salvar(chamar, PESO);
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.deepEqual([j.ok, j.criado, j.id], [true, true, 1]);
  assert.equal(banco.pesos[0].valor, 1.25);
  assert.equal(banco.pesos[0].atualizado_por, 'Caio');
  assert.equal(banco.auditoria[0].acao, 'peso_criado');
  r = await salvar(chamar, { ...PESO, produto: ' perfil 30 ', kgPorUnidade: '1.5' });
  j = await r.json();
  assert.deepEqual([j.criado, j.id], [false, 1]);
  assert.equal(banco.pesos.length, 1);
  assert.equal(banco.pesos[0].valor, 1.5);
  assert.equal(banco.auditoria.at(-1).acao, 'peso_alterado');
  assert.deepEqual(banco.auditoria.at(-1).detalhe.campos, ['kgPorUnidade']);
  assert.ok(!JSON.stringify(banco.auditoria).includes('1.5') && !JSON.stringify(banco.auditoria).includes('1,25'));
});

test('pesos: PUT recusa tipo, unidade, produto e peso inválidos (400) sem gravar', async t => {
  const { banco, chamar } = await prepararPesos(t);
  for (const m of [{ tipo: 'x' }, { unidadePeso: 'kg_un' }, { unidadePeso: 'g' }, { produto: '  ' }, { kgPorUnidade: '0' }, { kgPorUnidade: '-2' },
    { kgPorUnidade: '1.234,5' }, { kgPorUnidade: 'abc' }, { tipo: 'vidro' }]) {
    assert.equal((await salvar(chamar, { ...PESO, ...m })).status, 400, JSON.stringify(m));
  }
  assert.equal(banco.pesos.length, 0);
  assert.equal(banco.auditoria.length, 0);
});

test('pesos: GET lista com filtro de tipo e busca (escape de %), sem nomes de dinheiro nos campos', async t => {
  const banco = bancoPesos();
  banco.semear.peso({ tipo: 'perfil', produto: 'Perfil 30' });
  banco.semear.peso({ tipo: 'perfil', produto: 'Perfil 100%' });
  banco.semear.peso({ tipo: 'puxador', produto: 'Puxador A' });
  const { chamar } = await prepararPesos(t, { banco, perfil: 'Somente ver pesos' });
  let j = await (await chamar('/pesos')).json();
  assert.deepEqual(j.pesos.map(p => p.produto), ['Perfil 100%', 'Perfil 30', 'Puxador A']);
  assert.equal(j.pesos[0].kgPorUnidade, 1.2);
  assert.equal(j.pesos[0].unidadePeso, 'kg_m');
  const proibidos = [...nomes(j)].filter(k => REGEX_VALOR.test(k));
  assert.deepEqual(proibidos, []);
  j = await (await chamar('/pesos?tipo=puxador')).json();
  assert.deepEqual(j.pesos.map(p => p.produto), ['Puxador A']);
  j = await (await chamar('/pesos?q=100%25')).json();
  assert.deepEqual(j.pesos.map(p => p.produto), ['Perfil 100%']);
  j = await (await chamar('/pesos?q=PERFIL')).json();
  assert.equal(j.pesos.length, 2);
});

test('pesos: DELETE apaga, audita e dá 404 quando não existe', async t => {
  const banco = bancoPesos(); const x = banco.semear.peso();
  const { chamar } = await prepararPesos(t, { banco });
  assert.equal((await chamar('/pesos/999', 'DELETE')).status, 404);
  assert.equal((await chamar('/pesos/abc', 'DELETE')).status, 404);
  assert.equal((await chamar('/pesos/' + x.id, 'DELETE')).status, 200);
  assert.equal(banco.pesos.length, 0);
  assert.equal(banco.auditoria.at(-1).acao, 'peso_excluido');
});

test('pesos: /pesos/produtos lista os nomes do VB por tipo e marca os já cadastrados', async t => {
  const banco = bancoPesos();
  banco.semear.produto('Perfil 30', 'Perfil'); banco.semear.produto('Divisor X', 'Divisor'); banco.semear.produto('Perfil Velho', 'Perfil', 'Inativo');
  banco.semear.produto('Puxador A', 'Puxador'); banco.semear.produto('Reflecta Bronze 4mm', 'Revestimento');
  banco.semear.peso({ tipo: 'perfil', produto: 'perfil 30' });
  const { chamar } = await prepararPesos(t, { banco, perfil: 'Somente ver pesos' });
  let j = await (await chamar('/pesos/produtos?tipo=perfil')).json();
  assert.deepEqual(j.produtos, [{ nome: 'Divisor X', cadastrado: false }, { nome: 'Perfil 30', cadastrado: true }]);
  j = await (await chamar('/pesos/produtos?tipo=vidro')).json();
  assert.deepEqual(j.produtos, [{ nome: 'Reflecta Bronze 4mm', cadastrado: false }]);
  assert.equal((await chamar('/pesos/produtos?tipo=xx')).status, 400);
  assert.equal((await chamar('/pesos/produtos')).status, 400);
});

test('pesos: permissões — só ver não grava; sem acesso recebe 403', async t => {
  const so = await prepararPesos(t, { perfil: 'Somente ver pesos' });
  assert.equal((await salvar(so.chamar, PESO)).status, 403);
  assert.equal((await so.chamar('/pesos/1', 'DELETE')).status, 403);
  assert.equal((await so.chamar('/pesos')).status, 200);
  assert.equal(so.banco.pesos.length, 0);
  const sem = await prepararPesos(t, { perfil: 'Sem acesso' });
  assert.equal((await sem.chamar('/pesos')).status, 403);
  assert.equal((await sem.chamar('/pesos/produtos?tipo=perfil')).status, 403);
});
