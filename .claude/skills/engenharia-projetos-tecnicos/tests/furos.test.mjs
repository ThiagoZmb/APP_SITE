import test from 'node:test';
import assert from 'node:assert/strict';
import { furosPorRegra, MARGEM_FURO_MM } from '../scripts/lib/furos.mjs';

test('furosPorRegra: 100 mm de cada ponta e o resto dividido igualmente', () => {
  assert.equal(MARGEM_FURO_MM, 100);
  assert.deepEqual(furosPorRegra(2000, 2), [100, 1900]);
  assert.deepEqual(furosPorRegra(2000, 3), [100, 1000, 1900]);
  assert.deepEqual(furosPorRegra(2337, 5), [100, 634, 1169, 1703, 2237]);
  assert.deepEqual(furosPorRegra(2363, 3), [100, 1182, 2263]);
});

test('furosPorRegra: um furo fica no meio; entradas inválidas lançam erro', () => {
  assert.deepEqual(furosPorRegra(1000, 1), [500]);
  assert.throws(() => furosPorRegra(200, 2));
  assert.throws(() => furosPorRegra(2000, 0));
  assert.throws(() => furosPorRegra(2000, 2.5));
  assert.throws(() => furosPorRegra(NaN, 2));
});
