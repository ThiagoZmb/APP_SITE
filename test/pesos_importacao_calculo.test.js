// Regra pura da importação das estimativas de peso.
const test = require('node:test');
const assert = require('node:assert/strict');
const { planejarImportacaoPesos } = require('../calculo/pesos_importacao');
const { validarPeso } = require('../calculo/peso');

const est = (x = {}) => ({ tipo: 'perfil', produto: '3345', kgPorMetro: 0.412, unidade: 'kg_m', origem: 'estimado_desenho', confianca: 'alta', ...x });

test('importação de pesos: converte kgPorMetro em kgPorUnidade e mantém a confiança', () => {
  const p = planejarImportacaoPesos({ estimativas: [est(), est({ produto: '3180', tipo: 'puxador', confianca: 'media', kgPorMetro: 0.738 })] });
  assert.deepEqual(p.ignorar, []);
  assert.deepEqual(p.inserir, [
    { tipo: 'perfil', produto: '3345', unidadePeso: 'kg_m', kgPorUnidade: 0.412, origem: 'estimado_desenho', confianca: 'alta' },
    { tipo: 'puxador', produto: '3180', unidadePeso: 'kg_m', kgPorUnidade: 0.738, origem: 'estimado_desenho', confianca: 'media' }
  ]);
});

test('importação de pesos: nunca sobrescreve (já cadastrado com qualquer origem, sem diferenciar caixa e espaços)', () => {
  const p = planejarImportacaoPesos({ estimativas: [est({ produto: 'Thin LED 1805' }), est()], existentes: [{ tipo: 'perfil', produto: '  thin led  1805 ' }] });
  assert.deepEqual(p.inserir.map(x => x.produto), ['3345']);
  assert.deepEqual(p.ignorar, [{ tipo: 'perfil', produto: 'Thin LED 1805', motivo: 'já cadastrado' }]);
});

test('importação de pesos: mesmo nome em tipos diferentes não conflita; repetido no arquivo entra uma vez', () => {
  const p = planejarImportacaoPesos({ estimativas: [est(), est({ tipo: 'puxador' }), est()] });
  assert.equal(p.inserir.length, 2);
  assert.deepEqual(p.ignorar.map(x => x.motivo), ['já cadastrado']);
});

test('importação de pesos: item inválido é ignorado com motivo (origem, peso, unidade, confiança, tipo)', () => {
  const p = planejarImportacaoPesos({ estimativas: [est({ origem: 'manual' }), est({ produto: 'a', kgPorMetro: 0 }), est({ produto: 'b', unidade: 'kg_un' }),
    est({ produto: 'c', confianca: 'x' }), est({ produto: 'd', tipo: 'janela' }), null] });
  assert.equal(p.inserir.length, 0);
  assert.equal(p.ignorar.length, 6);
  assert.match(p.ignorar[0].motivo, /origem/);
  assert.match(p.ignorar[1].motivo, /Peso inválido/);
  assert.match(p.ignorar[3].motivo, /Confiança/);
});

test('importação de pesos: arquivo que não é lista não quebra', () => {
  const p = planejarImportacaoPesos({ estimativas: { a: 1 } });
  assert.equal(p.inserir.length, 0);
  assert.equal(p.ignorar.length, 1);
});

test('validarPeso: origem padrão manual, valores aceitos e confiança opcional', () => {
  const base = { tipo: 'perfil', produto: 'X', unidadePeso: 'kg_m', kgPorUnidade: '1,5' };
  assert.deepEqual([validarPeso(base).dados.origem, validarPeso(base).dados.confianca], ['manual', null]);
  for (const o of ['manual', 'pesado', 'fornecedor', 'estimado_desenho']) assert.deepEqual(validarPeso({ ...base, origem: o }).erros, [], o);
  assert.ok(validarPeso({ ...base, origem: 'chute' }).erros.join().includes('Origem'));
  assert.ok(validarPeso({ ...base, confianca: 'enorme' }).erros.join().includes('Confiança'));
  assert.equal(validarPeso({ ...base, confianca: 'media' }).dados.confianca, 'media');
});

test('arquivo docs/pesos_estimados_perfis.json: 17 estimativas válidas; 3180, 3180 T e 3186 T entram como puxador', () => {
  const arq = require('../docs/pesos_estimados_perfis.json');
  const p = planejarImportacaoPesos({ estimativas: arq });
  assert.equal(arq.length, 17);
  assert.equal(p.ignorar.length, 0);
  assert.equal(p.inserir.length, 17);
  for (const nome of ['3180', '3180 T', '3186 T']) assert.equal(p.inserir.find(x => x.produto === nome)?.tipo, 'puxador', nome);
  for (const fora of ['Sottile', 'Evidence', 'Evidence Slim', '2010/20', '1013', '1019']) assert.ok(!p.inserir.some(x => x.produto === fora), fora);
});
