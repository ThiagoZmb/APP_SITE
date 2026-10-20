const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEstoque } = require('./apoio/bancoEstoque');
const { registrarEstoqueMovimentos } = require('../rotas/estoque_movimentos');

const VER = 'estoque.ver';
const MAPA = {
  'GET /estoque/mov/produtos': [VER, { algum: ['estoque.movimentar', 'estoque.ajustar'] }],
  'GET /estoque/mov/fornecedores': [VER, 'estoque.movimentar'],
  'POST /estoque/entrada/xml': [VER, 'estoque.movimentar'],
  'POST /estoque/entrada': [VER, 'estoque.movimentar'],
  'POST /estoque/saida': [VER, 'estoque.movimentar'],
  'POST /estoque/ajuste': [VER, 'estoque.ajustar'],
  'GET /estoque/historico': [VER, { algum: ['estoque.movimentar', 'estoque.desfazer', 'estoque.ajustar'] }],
  'POST /estoque/entrada/desfazer': [VER, 'estoque.desfazer'],
  'POST /estoque/saida/desfazer': [VER, 'estoque.desfazer']
};

test('cada rota registrada exige as permissões da spec', () => {
  const vistas = {};
  registrarEstoqueMovimentos({ rota: (m, c, exige) => { vistas[`${m.toUpperCase()} ${c}`] = exige; }, pool: {} });
  assert.deepEqual(Object.keys(vistas).sort(), Object.keys(MAPA).sort());
  for (const [k, exige] of Object.entries(vistas)) assert.deepEqual(exige, MAPA[k], k);
});

test('Estoquista lista produtos sem valor e sem inativo zerado', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  const r = await chamar('/estoque/mov/produtos');
  assert.equal(r.status, 200);
  const lista = await r.json();
  assert.deepEqual(lista.map(p => p.codigo), [3, 1]);
  assert.deepEqual(Object.keys(lista[1]).sort(), ['codFornecedor', 'codigo', 'fornecedor', 'produto', 'qtd', 'situacao', 'unidade']);
  assert.equal(lista[1].produto, 'Perfil Slim');
});

test('Interno completo recebe o valor; busca filtra', async t => {
  const { chamar } = await prepararEstoque(t);
  const lista = await (await chamar('/estoque/mov/produtos?busca=slim')).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].valor, 12.5);
});

test('fornecedores para a entrada', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  assert.deepEqual(await (await chamar('/estoque/mov/fornecedores')).json(), [
    { razao: 'FORNECEDOR TESTE LTDA', cnpj: '12.345.678/0001-90' }, { razao: 'OUTRO FORNECEDOR SA', cnpj: '98.765.432/0001-10' }]);
});

test('só ver o estoque: 403 nas listas', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Somente ver' });
  assert.equal((await chamar('/estoque/mov/produtos')).status, 403);
  assert.equal((await chamar('/estoque/mov/fornecedores')).status, 403);
});
