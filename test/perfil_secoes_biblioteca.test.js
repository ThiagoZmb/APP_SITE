// Biblioteca de sementes das seções de perfis (calculo/perfil_secoes_biblioteca.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const PS = require('../calculo/perfil_secoes');
const BIB = require('../calculo/perfil_secoes_biblioteca');

test('toda seção da biblioteca passa em validar; códigos, modelos e campos coerentes', () => {
  assert.ok(BIB.SECOES.length >= 2);
  for (const s of BIB.SECOES) {
    assert.ok(Number.isInteger(s.rev) && s.rev >= 1, `rev de ${s.modelo}`);
    const sec = { ...s.secao, codigo: s.codigo, modelo: s.modelo };
    assert.deepEqual(PS.validar(PS.normalizar(sec)), [], `seção ${s.modelo}`);
    assert.equal(s.secao.codigo, s.codigo); assert.equal(s.secao.modelo, s.modelo);
  }
});

test('sem código nem modelo repetido; lista() é cópia', () => {
  const cod = BIB.SECOES.map(s => s.codigo), mod = BIB.SECOES.map(s => s.modelo.toUpperCase());
  assert.equal(new Set(cod).size, cod.length); assert.equal(new Set(mod).size, mod.length);
  const l = BIB.lista(); l[0].secao.altura = 1;
  assert.notEqual(BIB.SECOES[0].secao.altura, 1);
});

test('1036 reaproveita a semente embutida; 3345 tem as medidas lidas', () => {
  const b1036 = BIB.SECOES.find(s => s.codigo === 13);
  assert.deepEqual(b1036.secao, PS.semente1036());
  const s = BIB.SECOES.find(x => x.codigo === 92).secao;
  assert.equal(s.largura, 19); assert.equal(s.altura, 45); assert.equal(s.junta, 'meia_esquadria');
  assert.deepEqual(s.canalVidro, { x0: 1.5, x1: 6.4, y0: 1.5 });
  assert.deepEqual(s.estimada, ['parede', 'vazados']);
  assert.ok(Math.abs(PS.areaPoligono(s.contorno) - 580.35) < 1e-9);
  assert.ok(Math.abs(PS.areaSolida(s) - 177.15) < 1e-9);
});
