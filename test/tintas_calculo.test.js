// Regras do cadastro de tintas (funções puras; formulário do VB frm_Cadastro_Tintas).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarTinta, CLASSES_TINTA, TIPOS_TINTA, CONJUNTOS_TINTA } = require('../calculo/tintas');

const BASE = { fabricante: 'Sayerlack', classe: 'Verniz', tipo: 'Verniz Fosco', conjunto: 'Conjunto Vidro', valor: '12,5', porcentagem: '50', cor: 'ff1a2b3c', rendimento: '' };
const COM = { podeValores: true };
const erroCom = (b, rotulo, op = COM) => validarTinta(b, op).erros.join(' ').includes(rotulo);

test('listas fixas do VB', () => {
  assert.equal(CLASSES_TINTA.length, 6);
  assert.ok(CLASSES_TINTA.includes('Tinta') && CLASSES_TINTA.includes('Verniz'));
  assert.equal(TIPOS_TINTA.length, 19);
  assert.ok(TIPOS_TINTA.includes('Pasticgrip') && TIPOS_TINTA.includes('Aderente (Fundo Fosfatizante)'));
  assert.equal(CONJUNTOS_TINTA.length, 9);
});

test('formulário válido: números, cor em maiúsculas, rendimento vazio = 0', () => {
  const { erros, dados } = validarTinta(BASE, COM);
  assert.deepEqual(erros, []);
  assert.equal(dados.valor, 12.5);
  assert.equal(dados.porcentagem, 50);
  assert.equal(dados.cor, 'FF1A2B3C');
  assert.equal(dados.rendimento, 0);
});

test('obrigatórios faltando', () => {
  for (const [campo, rotulo] of [['fabricante', 'Fabricante'], ['classe', 'Classe'], ['tipo', 'Tipo'], ['conjunto', 'Conjunto'], ['valor', 'Valor'], ['porcentagem', '% da mistura']]) {
    assert.ok(erroCom({ ...BASE, [campo]: '' }, rotulo), campo);
  }
});

test('valor e porcentagem: milhar, texto e negativo recusados', () => {
  for (const v of ['1.234,56', 'abc', '-3']) assert.ok(erroCom({ ...BASE, valor: v }, 'Valor'), v);
  for (const p of ['100,5', '-1', '101']) assert.ok(erroCom({ ...BASE, porcentagem: p }, '% da mistura'), p);
  for (const p of ['0', '100']) assert.deepEqual(validarTinta({ ...BASE, porcentagem: p }, COM).erros, []);
});

test('cor: obrigatória fora da classe Tinta (que grava preto como o VB); formato errado recusado', () => {
  const tinta = validarTinta({ ...BASE, classe: 'Tinta', tipo: 'Laca Fosca Sólida', cor: '' }, COM);
  assert.deepEqual(tinta.erros, []);
  assert.equal(tinta.dados.cor, 'FF000000');
  assert.ok(erroCom({ ...BASE, cor: '' }, 'Cor'));
  for (const c of ['#fff', 'ZZ']) assert.ok(erroCom({ ...BASE, cor: c }, 'Cor'), c);
});

test('classe, tipo e conjunto precisam estar nas listas', () => {
  assert.ok(erroCom({ ...BASE, classe: 'X' }, 'Classe'));
  assert.ok(erroCom({ ...BASE, tipo: 'X' }, 'Tipo'));
  assert.ok(erroCom({ ...BASE, conjunto: 'X' }, 'Conjunto'));
});

test('sem valores.ver o valor nem é lido', () => {
  const { erros, dados } = validarTinta({ ...BASE, valor: '' });
  assert.deepEqual(erros, []);
  assert.equal(dados.valor, undefined);
});

test('textos: corta as pontas e limita a 100 caracteres', () => {
  assert.equal(validarTinta({ ...BASE, refFabricante: '  TX-10  ' }, COM).dados.refFabricante, 'TX-10');
  assert.ok(erroCom({ ...BASE, refFabricante: 'x'.repeat(101) }, 'Referência'));
  assert.ok(erroCom({ ...BASE, corElegance: 'x'.repeat(101) }, 'Cor Elegance'));
});
