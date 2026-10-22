const test = require('node:test');
const assert = require('node:assert/strict');
const { unidadeDaClasse, sugerirLigacoes, sugerirFator, fraseFator } = require('../calculo/custos_sugestao');
const { normalizarNome, semelhanca } = require('../calculo/nomes');

test('nomes: normalização e semelhança (as mesmas da importação de XML)', () => {
  assert.equal(normalizarNome('  Perfil  1036 – Anodizado '), 'PERFIL 1036 ANODIZADO');
  assert.equal(semelhanca('Perfil 1036', 'PERFIL 1036'), 1);
  assert.equal(semelhanca('Perfil 1036', 'Puxador 50'), 0);
});

test('unidade de venda pela classe (regra do motor de preço)', () => {
  assert.equal(unidadeDaClasse('Perfis'), 'm');
  assert.equal(unidadeDaClasse('Puxador'), 'm');
  assert.equal(unidadeDaClasse('Divisores'), 'm');
  assert.equal(unidadeDaClasse('Trilhos'), 'm');
  assert.equal(unidadeDaClasse('Revestimento'), 'm2');
  assert.equal(unidadeDaClasse('Vidros'), 'm2');
  assert.equal(unidadeDaClasse('Acessórios'), 'un');
  assert.equal(unidadeDaClasse(''), 'un');
});

const itens = [
  { CODIGO: 1, NOME_PRODUTO: 'PERFIL 1036' },
  { CODIGO: 2, NOME_PRODUTO: 'PERFIL 1036 BARRA 6M' },
  { CODIGO: 3, NOME_PRODUTO: 'PERFIL 1036 PRETO' },
  { CODIGO: 4, NOME_PRODUTO: 'PERFIL 1036 BRANCO BARRA' },
  { CODIGO: 5, NOME_PRODUTO: 'PERFIL 1036 BRONZE 3M' },
  { CODIGO: 6, NOME_PRODUTO: 'PUXADOR CONCHA' }
];

test('sugestão forte: nome igual (sem maiúsculas/acentos) — só ela', () => {
  const s = sugerirLigacoes({ MODELO: 'Perfil 1036' }, itens);
  assert.deepEqual(s.map(x => [x.estoque.CODIGO, x.forca]), [[1, 'forte']]);
});

test('parecidas: até 3, da mais parecida para a menos; abaixo de 0,5 fica de fora', () => {
  const s = sugerirLigacoes({ MODELO: 'Perfil 1036 6M' }, itens.filter(i => i.CODIGO !== 1));
  assert.equal(s.length, 3);
  assert.ok(s.every(x => x.forca === 'parecida' && x.semelhanca >= 0.5));
  assert.equal(s[0].estoque.CODIGO, 2);
  assert.ok(s[0].semelhanca >= s[1].semelhanca && s[1].semelhanca >= s[2].semelhanca);
  assert.deepEqual(sugerirLigacoes({ MODELO: 'Fechadura tetra' }, itens), []);
});

test('fator sugerido: barra pelo TAMANHO, chapa pela ALTURA × LARGURA, unidade = 1', () => {
  assert.equal(sugerirFator('m', { TAMANHO: 6000 }), 6);
  assert.equal(sugerirFator('m2', { ALTURA: 2200, LARGURA: 3210 }), 7.062);
  assert.equal(sugerirFator('un', {}), 1);
  assert.equal(sugerirFator('m', { TAMANHO: 0 }), null);
  assert.equal(sugerirFator('m2', { ALTURA: 2200 }), null);
});

test('frase de conferência do fator', () => {
  assert.equal(fraseFator('Barra', 6, 'm'), '1 Barra = 6 metros');
  assert.equal(fraseFator('Chapa', 7.062, 'm2'), '1 Chapa = 7,062 m²');
  assert.equal(fraseFator('Peça', 1, 'un'), '1 Peça = 1 unidade');
  assert.equal(fraseFator('', 2, 'un'), '1 unidade de compra = 2 unidades');
});
