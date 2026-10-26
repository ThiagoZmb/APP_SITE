import test from 'node:test';
import assert from 'node:assert/strict';
import { paraMm, lerNumeroBr, interpretarCota } from '../scripts/lib/unidades.mjs';

test('paraMm converte mm, cm, m e pol', () => {
  assert.equal(paraMm(2100, 'mm'), 2100);
  assert.equal(paraMm(210, 'cm'), 2100);
  assert.equal(paraMm(2.1, 'm'), 2100);
  assert.equal(paraMm(1, 'pol'), 25.4);
});

test('paraMm é exato, sem ruído de ponto flutuante', () => {
  assert.equal(paraMm(1.1, 'm'), 1100); // 1.1 * 1000 em double dá 1100.0000000000002
  assert.equal(paraMm(0.7, 'cm'), 7);
  assert.equal(paraMm(35, 'pol'), 889);
  assert.equal(paraMm(-2, 'pol'), -50.8);
  assert.equal(paraMm(1.25, 'pol'), 31.75);
});

test('paraMm lança erro para unidade desconhecida ou valor inválido', () => {
  assert.throws(() => paraMm(1, 'ft'), /desconhecida/);
  assert.throws(() => paraMm(1, undefined), /desconhecida/);
  assert.throws(() => paraMm(NaN, 'mm'), /inválido/);
  assert.throws(() => paraMm('2', 'mm'), /inválido/);
});

test('lerNumeroBr: inteiros e decimais pt-BR', () => {
  assert.deepEqual(lerNumeroBr('2100'), { valor: 2100, ambiguo: false, motivo: null });
  assert.equal(lerNumeroBr('2,10').valor, 2.1);
  assert.equal(lerNumeroBr('1.234,5').valor, 1234.5);
  assert.equal(lerNumeroBr('1.234.567').valor, 1234567);
  assert.equal(lerNumeroBr('2.5').valor, 2.5);
  assert.equal(lerNumeroBr('0.125').valor, 0.125);
});

test('lerNumeroBr: "2.100" é ambíguo e não é adivinhado', () => {
  const r = lerNumeroBr('2.100');
  assert.equal(r.valor, null);
  assert.equal(r.ambiguo, true);
  assert.deepEqual(r.candidatos, [2100, 2.1]);
  assert.match(r.motivo, /milhar/);
});

test('lerNumeroBr: texto não numérico devolve valor null', () => {
  for (const t of ['abc', '', '1,2,3', '1,234.5', '12a']) {
    const r = lerNumeroBr(t);
    assert.equal(r.valor, null, t);
    assert.equal(r.ambiguo, false, t);
    assert.ok(r.motivo, t);
  }
});

test('interpretarCota: unidade explícita no texto converte e é confirmada', () => {
  const r = interpretarCota('210 cm');
  assert.equal(r.valorMm, 2100);
  assert.equal(r.estadoUnidade, 'confirmado');
  assert.deepEqual(r.pendencias, []);
  assert.equal(interpretarCota('2,1 m').valorMm, 2100);
  assert.equal(interpretarCota('2100mm').valorMm, 2100);
  assert.equal(interpretarCota('2 pol').valorMm, 50.8);
});

test('interpretarCota: sem unidade usa a declarada na prancha', () => {
  const r = interpretarCota('2100', { unidadeDeclarada: 'mm' });
  assert.equal(r.valorMm, 2100);
  assert.equal(r.estadoUnidade, 'confirmado');
  assert.equal(interpretarCota('210', { unidadeDeclarada: 'cm' }).valorMm, 2100);
});

test('interpretarCota: unidade declarada marcada como inferida → inferido + pendência', () => {
  const r = interpretarCota('2100', { unidadeDeclarada: { unidade: 'mm', inferida: true } });
  assert.equal(r.valorMm, 2100);
  assert.equal(r.estadoUnidade, 'inferido');
  assert.equal(r.pendencias[0].tipo, 'unidade_ambigua');
});

test('interpretarCota: sem nenhuma unidade → ausente, sem converter', () => {
  const r = interpretarCota('2100');
  assert.equal(r.valorMm, null);
  assert.equal(r.estadoUnidade, 'ausente');
  assert.equal(r.valorOriginal, 2100);
  assert.equal(r.pendencias[0].tipo, 'unidade_ambigua');
});

test('interpretarCota: número ambíguo e unidade desconhecida geram pendência', () => {
  const amb = interpretarCota('2.100 mm');
  assert.equal(amb.valorMm, null);
  assert.equal(amb.ambiguo, true);
  assert.equal(amb.pendencias[0].tipo, 'unidade_ambigua');
  const desc = interpretarCota('10 ft');
  assert.equal(desc.valorMm, null);
  assert.match(desc.pendencias[0].mensagem, /desconhecida/);
  assert.equal(interpretarCota('abc').valorMm, null);
});
