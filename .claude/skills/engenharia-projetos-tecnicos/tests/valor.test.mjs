import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmado, inferido, ausente, conflitante, calculado, confirmarHumano } from '../scripts/lib/valor.mjs';

const origem = { arquivo: 'a.pdf', pagina: 2, trecho: 'H=2100' };
const base = { id: 'x', valor: 2100, unidade: 'mm', metodo: 'texto_vetorial', origem };

test('confirmado: cria valor válido com confiança padrão 1', () => {
  const v = confirmado(base);
  assert.equal(v.estado, 'confirmado');
  assert.equal(v.confianca, 1);
});

test('confirmado com ocr ou leitura_visual exige confirmacao', () => {
  assert.throws(() => confirmado({ ...base, metodo: 'ocr' }), /confirmacao/);
  assert.throws(() => confirmado({ ...base, metodo: 'leitura_visual' }), /confirmacao/);
  const ok = confirmado({ ...base, metodo: 'ocr', confirmacao: { por: 'Ana', em: '2026-10-26' } });
  assert.equal(ok.confirmacao.por, 'Ana');
});

test('confirmado sem valor é recusado', () => {
  assert.throws(() => confirmado({ ...base, valor: null }), /exige valor/);
});

test('inferido exige confiança explícita', () => {
  assert.throws(() => inferido({ ...base, metodo: 'ocr' }), /confianca/);
  assert.equal(inferido({ ...base, metodo: 'ocr', confianca: 0.6 }).estado, 'inferido');
});

test('ausente tem valor null e confiança 0', () => {
  const v = ausente({ id: 'a', unidade: 'mm', origem });
  assert.equal(v.valor, null);
  assert.equal(v.confianca, 0);
});

test('conflitante: valor null, mínimo 2 candidatos com valores diferentes', () => {
  const a = confirmado({ ...base, id: 'a' });
  const b = confirmado({ ...base, id: 'b', valor: 2110 });
  const c = conflitante([a, b], { id: 'c' });
  assert.equal(c.valor, null);
  assert.equal(c.candidatos.length, 2);
  assert.throws(() => conflitante([a], { id: 'c' }), /2 candidatos/);
  assert.throws(() => conflitante([a, confirmado({ ...base, id: 'b2' })], { id: 'c' }), /diferentes/);
});

test('calculado: estado = pior estado das entradas', () => {
  const dados = { id: 'c', regra: 'a*b', entradas: ['a', 'b'], valor: 10, unidade: 'm2', origem: { arquivo: 'a.pdf' } };
  assert.equal(calculado({ ...dados, estadoEntradas: ['confirmado', 'confirmado'] }).estado, 'confirmado');
  const inf = calculado({ ...dados, estadoEntradas: ['confirmado', 'inferido'], confianca: 0.7 });
  assert.equal(inf.estado, 'inferido');
  assert.deepEqual(inf.origem.entradas, ['a', 'b']);
  assert.equal(inf.regra, 'a*b');
});

test('calculado: entrada ausente/conflitante ⇒ ausente, valor descartado', () => {
  const dados = { id: 'c', regra: 'a*b', entradas: ['a', 'b'], valor: 10, unidade: 'm2', origem: { arquivo: 'a.pdf' } };
  for (const ruim of ['ausente', 'conflitante']) {
    const v = calculado({ ...dados, estadoEntradas: ['confirmado', ruim] });
    assert.equal(v.estado, 'ausente');
    assert.equal(v.valor, null);
    assert.equal(v.confianca, 0);
  }
});

test('calculado: exige regra, entradas, estados alinhados e confiança se inferido', () => {
  const dados = { id: 'c', entradas: ['a'], estadoEntradas: ['confirmado'], valor: 1, origem: { arquivo: 'a.pdf' } };
  assert.throws(() => calculado({ ...dados, regra: '' }), /regra/);
  assert.throws(() => calculado({ ...dados, regra: 'r', entradas: [] }), /entradas/);
  assert.throws(() => calculado({ ...dados, regra: 'r', estadoEntradas: [] }), /um estado por entrada/);
  assert.throws(() => calculado({ ...dados, regra: 'r', estadoEntradas: ['inferido'] }), /confianca/);
});

test('confirmarHumano: inferido → confirmado registrando quem, sem mutar o original', () => {
  const i = inferido({ ...base, metodo: 'leitura_visual', confianca: 0.7 });
  const c = confirmarHumano(i, { por: 'Ana', em: '2026-10-26', nota: 'conferido na obra' });
  assert.equal(c.estado, 'confirmado');
  assert.deepEqual(c.confirmacao, { por: 'Ana', em: '2026-10-26', nota: 'conferido na obra' });
  assert.equal(i.estado, 'inferido');
});

test('confirmarHumano recusa quem não é inferido, sem "por" ou data inválida', () => {
  const i = inferido({ ...base, metodo: 'ocr', confianca: 0.5 });
  assert.throws(() => confirmarHumano(confirmado(base), { por: 'Ana', em: '2026-10-26' }), /inferido/);
  assert.throws(() => confirmarHumano(i, { em: '2026-10-26' }), /por/);
  assert.throws(() => confirmarHumano(i, { por: 'Ana', em: 'ontem' }), /data ISO/);
});
