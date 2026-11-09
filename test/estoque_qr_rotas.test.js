// Baixa de estoque por QR: rotas de leitura (por_codigo e etiquetas).
const test = require('node:test');
const assert = require('node:assert');
const { bancoEstoque, prepararEstoque } = require('./apoio/bancoEstoque');

test('por_codigo devolve só 4 campos e a quantidade chega a quem não tem valores.ver', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  const r = await chamar('/estoque/por_codigo/7890000000011');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { codigo: 1, nome: 'Perfil Slim', unidade: 'Barra', qtd: 10 });
});

test('por_codigo: item inativo e código desconhecido dão 404 com a mesma mensagem', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  for (const c of ['7890000000028', '9999']) {
    const r = await chamar('/estoque/por_codigo/' + c);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'Item não encontrado.' });
  }
});

test('por_codigo: código de barras repetido dá 409 e não baixa nada', async t => {
  const banco = bancoEstoque();
  banco.estoque.push({ ...banco.estoque[0], CODIGO: 9, NOME_PRODUTO: 'Perfil Slim Gêmeo' });
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista', banco });
  const r = await chamar('/estoque/por_codigo/7890000000011');
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'Código de barras repetido no estoque: avise o administrador.' });
  assert.equal(banco.saidas.length, 0);
});

test('por_codigo: código inválido dá 400; link de site cai em 404', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  for (const c of ['a'.repeat(21), '%20']) {
    const r = await chamar('/estoque/por_codigo/' + c);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Código inválido.' });
  }
  const r = await chamar('/estoque/por_codigo/' + encodeURIComponent('https://x.com/a'));
  assert.equal(r.status, 404);
});

test('por_codigo: perfil Somente ver recebe 403', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Somente ver' });
  assert.equal((await chamar('/estoque/por_codigo/7890000000011')).status, 403);
});

test('etiquetas: ativos por nome, conta os sem código; Estoquista recebe 403', async t => {
  const banco = bancoEstoque();
  const { chamar } = await prepararEstoque(t, { perfil: 'Interno completo', banco });
  let r = await chamar('/estoque/etiquetas');
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo.itens.map(i => i.produto), ['Parafuso', 'Perfil Slim']);
  assert.equal(corpo.semCodigo, 0);

  banco.estoque.find(e => e.NOME_PRODUTO === 'Parafuso').CODIGO_BARRA = '';
  r = await chamar('/estoque/etiquetas');
  const corpo2 = await r.json();
  assert.equal(corpo2.itens.length, 1);
  assert.equal(corpo2.semCodigo, 1);

  const outro = await prepararEstoque(t, { perfil: 'Estoquista' });
  assert.equal((await outro.chamar('/estoque/etiquetas')).status, 403);
});
