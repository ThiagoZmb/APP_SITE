// Validação das entradas do plano de corte de vidros (calculo/vidro_validacao.js). Funções puras.
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITE_MM, validarConfigVidros, validarRetalhoVidro, validarConferenciaVidros } = require('../calculo/vidro_validacao');

test('LIMITE_MM é 20000', () => assert.equal(LIMITE_MM, 20000));

test('config de vidros: válida, com padrões e recusas', () => {
  assert.deepEqual(validarConfigVidros({ serra: 3, sobraMinima: 250 }), { ok: true, dados: { serra: 3, sobraMinima: 250 } });
  assert.deepEqual(validarConfigVidros({ serra: '0', sobraMinima: '300' }), { ok: true, dados: { serra: 0, sobraMinima: 300 } });
  assert.deepEqual(validarConfigVidros({}), { ok: true, dados: { serra: 0, sobraMinima: 300 } });   // padrões
  for (const ruim of [{ serra: -1 }, { serra: 2.5 }, { serra: 'x' }, { serra: 20001 }, { sobraMinima: 0 }, { sobraMinima: -3 }, { sobraMinima: 10.5 }, { sobraMinima: 20001 }]) {
    const r = validarConfigVidros({ serra: 0, sobraMinima: 300, ...ruim });
    assert.equal(r.ok, false, JSON.stringify(ruim));
    assert.ok(r.erro);
  }
});

test('retalho de vidro: produto e lados', () => {
  assert.deepEqual(validarRetalhoVidro({ produtoCodigo: '12', altura: '800', largura: 500 }),
    { ok: true, dados: { produtoCodigo: 12, altura: 800, largura: 500 } });
  const base = { produtoCodigo: 5, altura: 800, largura: 500 };
  for (const ruim of [{ altura: 0 }, { largura: 0 }, { altura: 'abc' }, { largura: 20001 }, { largura: 10.5 }, { produtoCodigo: undefined }, { produtoCodigo: 0 }, { produtoCodigo: 'x' }]) {
    const r = validarRetalhoVidro({ ...base, ...ruim });
    assert.equal(r.ok, false, JSON.stringify(ruim));
    assert.ok(r.erro);
  }
});

const plano = {
  grupos: [{ chave: 'G1', chapas: [
    { sobras: [{ x: 0, y: 0, altura: 1000, largura: 600 }, { x: 0, y: 0, altura: 400, largura: 300 }] },
    { sobras: [] },
  ] }],
};

test('conferência de vidros: válida, vazia e normalizada', () => {
  assert.deepEqual(validarConferenciaVidros({ sobras: [] }, plano), { ok: true, sobras: [] });
  assert.deepEqual(validarConferenciaVidros({}, plano), { ok: true, sobras: [] });
  const r = validarConferenciaVidros({ sobras: [
    { grupo: 'G1', chapa: 0, sobra: 0, destino: 'guardar', altura: '990', largura: 600 },
    { grupo: 'G1', chapa: 0, sobra: 1, destino: 'descartar' },
  ] }, plano);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sobras[0], { grupo: 'G1', chapa: 0, sobra: 0, destino: 'guardar', altura: 990, largura: 600 });
  assert.equal(r.sobras[1].destino, 'descartar');
});

test('conferência de vidros: recusas', () => {
  const ok = { grupo: 'G1', chapa: 0, sobra: 0, destino: 'guardar', altura: 900, largura: 500 };
  for (const ruim of [
    { grupo: 'G9' }, { chapa: 5 }, { chapa: 1 }, { sobra: 2 }, { sobra: -1 }, { sobra: '0' },
    { destino: 'vender' }, { destino: undefined },
    { altura: 1001 }, { largura: 601 }, { altura: 0 }, { largura: 'x' }, { altura: 10.5 },
  ]) {
    const r = validarConferenciaVidros({ sobras: [{ ...ok, ...ruim }] }, plano);
    assert.equal(r.ok, false, JSON.stringify(ruim));
    assert.ok(r.erro);
  }
  assert.equal(validarConferenciaVidros({ sobras: [ok, { ...ok }] }, plano).ok, false);   // duplicada
  assert.equal(validarConferenciaVidros({ sobras: 'x' }, plano).ok, false);
});
