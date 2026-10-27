// Validação das entradas do plano de corte (calculo/corte_validacao.js). Funções puras.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarConfig, validarRetalho, validarConferencia } = require('../calculo/corte_validacao');

test('config padrão exige os três valores inteiros positivos', () => {
  assert.deepEqual(validarConfig({ comprimentoVara: 6000, serra: 3, sobraMinima: 500 }),
    { ok: true, dados: { perfil: '', comprimentoVara: 6000, serra: 3, sobraMinima: 500 } });
  for (const ruim of [{ comprimentoVara: 0 }, { comprimentoVara: -1 }, { comprimentoVara: 6000.5 }, { comprimentoVara: '6000x' }, { serra: 0 }, { sobraMinima: -5 }, { comprimentoVara: 30000 }]) {
    const r = validarConfig({ comprimentoVara: 6000, serra: 3, sobraMinima: 500, ...ruim });
    assert.equal(r.ok, false, JSON.stringify(ruim));
    assert.ok(r.erro);
  }
  assert.equal(validarConfig({ serra: 3, sobraMinima: 500 }).ok, false);   // padrão sem comprimento
});

test('config de um perfil aceita campos em branco (herdam o padrão), mas não todos em branco', () => {
  assert.deepEqual(validarConfig({ perfil: ' P7 ', comprimentoVara: 3000 }),
    { ok: true, dados: { perfil: 'P7', comprimentoVara: 3000, serra: null, sobraMinima: null } });
  assert.equal(validarConfig({ perfil: 'P7' }).ok, false);
});

test('retalho manual: perfil, acabamento, cor e comprimento válidos', () => {
  assert.deepEqual(validarRetalho({ perfil: ' P100 ', acabamento: 'Anodizado', cor: 'Natural', comprimento: '1850' }),
    { ok: true, dados: { perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural', comprimento: 1850 } });
  assert.deepEqual(validarRetalho({ perfil: 'P', acabamento: '  ', cor: null, comprimento: 1000 }),
    { ok: true, dados: { perfil: 'P', acabamento: '', cor: '', comprimento: 1000 } });   // acabamento e cor podem ser vazios (como no pedido)
  for (const ruim of [{ perfil: '' }, { comprimento: 0 }, { comprimento: 12.5 }, { comprimento: 99999 }]) {
    assert.equal(validarRetalho({ perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 1000, ...ruim }).ok, false, JSON.stringify(ruim));
  }
});

const planoBase = { grupos: [{ chave: 'P|A|C', barras: [{ sobra: 997, destinoSobra: 'guardar' }, { sobra: 0, destinoSobra: 'descartar' }, { sobra: 300, destinoSobra: 'descartar' }] }] };

test('conferência: sobra real maior que a calculada, zero ou negativa é recusada', () => {
  for (const medida of [998, 0, -1, 12.5, 'abc']) {
    const r = validarConferencia({ sobras: [{ grupo: 'P|A|C', barra: 0, destino: 'guardar', medidaReal: medida }] }, planoBase);
    assert.equal(r.ok, false, String(medida));
  }
});

test('conferência: guardar uma barra sem sobra, barra inexistente e referência repetida são recusados', () => {
  assert.equal(validarConferencia({ sobras: [{ grupo: 'P|A|C', barra: 1, destino: 'guardar', medidaReal: 10 }] }, planoBase).ok, false);
  assert.equal(validarConferencia({ sobras: [{ grupo: 'P|A|C', barra: 9, destino: 'descartar' }] }, planoBase).ok, false);
  assert.equal(validarConferencia({ sobras: [{ grupo: 'X', barra: 0, destino: 'descartar' }] }, planoBase).ok, false);
  const dup = { grupo: 'P|A|C', barra: 0, destino: 'descartar' };
  assert.equal(validarConferencia({ sobras: [dup, dup] }, planoBase).ok, false);
});

test('conferência válida devolve a lista normalizada; barras não citadas ficam como o plano sugeriu', () => {
  const r = validarConferencia({ sobras: [{ grupo: 'P|A|C', barra: 0, destino: 'guardar', medidaReal: 990 }, { grupo: 'P|A|C', barra: 2, destino: 'guardar', medidaReal: 300 }] }, planoBase);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sobras, [
    { grupo: 'P|A|C', barra: 0, destino: 'guardar', medidaReal: 990 },
    { grupo: 'P|A|C', barra: 1, destino: 'descartar', medidaReal: 0 },
    { grupo: 'P|A|C', barra: 2, destino: 'guardar', medidaReal: 300 }
  ]);
});
