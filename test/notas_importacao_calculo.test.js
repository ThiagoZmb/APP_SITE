// Conversão de nf_entrada / nf_saida do VB para web_notas_fiscais (função pura).
const test = require('node:test');
const assert = require('node:assert/strict');
const { planejarImportacao } = require('../calculo/notas_importacao');

const FORN = [{ COD: 1, RAZAO_FABRICANTE: 'Alumínios Brasil' }, { COD: 2, RAZAO_FABRICANTE: '.' }];
const CLI = [{ CODIGO: 10, RAZAO_SOCIAL: 'Construtora Alfa' }];
const plano = (o = {}) => planejarImportacao({ entradas: [], saidas: [], fornecedores: FORN, clientes: CLI, existentes: [], ...o });
const ent = (x = {}) => ({ NUMERO: '000123', RAZAO_FABRICANTE: 'Alumínios Brasil', DATA: '2026-10-10 00:00:00', VALOR_TOTAL: 1500.5, ...x });
const sai = (x = {}) => ({ NUMERO: 77, RAZAO_SOCIAL: 'Construtora Alfa', DATA: '2026-10-11', VALOR: 900, ...x });

test('importação: converte entrada e saída (número sem zeros, série 1, nome casado sem diferenciar caixa e espaços)', () => {
  const p = plano({ entradas: [ent({ RAZAO_FABRICANTE: '  alumínios brasil ' })], saidas: [sai()] });
  assert.deepEqual(p.entram, [
    { tipo: 'entrada', numero: '123', serie: '1', dataEmissao: '2026-10-10', contraparteCodigo: 1, contraparteNome: 'Alumínios Brasil', valorTotal: 1500.5 },
    { tipo: 'saida', numero: '77', serie: '1', dataEmissao: '2026-10-11', contraparteCodigo: 10, contraparteNome: 'Construtora Alfa', valorTotal: 900 }
  ]);
  assert.deepEqual([p.ignoradas, p.semCadastro, p.qtdJaImportadas], [[], [], 0]);
});

test('importação: sem cadastro (nome não achado ou "."), entra com código 0 e nome original e é listada', () => {
  const p = plano({ entradas: [ent({ NUMERO: '1', RAZAO_FABRICANTE: 'Fantasma' }), ent({ NUMERO: '2', RAZAO_FABRICANTE: '.' })], saidas: [sai({ RAZAO_SOCIAL: 'Obras X' })] });
  assert.deepEqual(p.entram.map(n => [n.tipo, n.numero, n.contraparteCodigo, n.contraparteNome]),
    [['entrada', '1', 0, 'Fantasma'], ['entrada', '2', 0, '.'], ['saida', '77', 0, 'Obras X']]);
  assert.deepEqual(p.semCadastro.map(s => [s.tipo, s.numero, s.nome]), [['entrada', '1', 'Fantasma'], ['entrada', '2', '.'], ['saida', '77', 'Obras X']]);
});

test('importação: valor nulo ou zero entra como 0 (contado); valor negativo ou texto é ignorado; centavos arredondados', () => {
  const p = plano({ entradas: [ent({ NUMERO: '1', VALOR_TOTAL: null }), ent({ NUMERO: '2', VALOR_TOTAL: 0 }), ent({ NUMERO: '3', VALOR_TOTAL: -5 }),
    ent({ NUMERO: '4', VALOR_TOTAL: 'abc' }), ent({ NUMERO: '5', VALOR_TOTAL: '10.005' }), ent({ NUMERO: '6', VALOR_TOTAL: 1e15 })] });
  assert.deepEqual(p.entram.map(n => [n.numero, n.valorTotal]), [['1', 0], ['2', 0], ['5', 10.01]]);
  assert.equal(p.qtdValorZero, 2);
  assert.deepEqual(p.ignoradas.map(i => [i.numero, i.motivo]), [['3', 'valor inválido'], ['4', 'valor inválido'], ['6', 'valor inválido']]);
});

test('importação: ignora número inválido e data inválida (com o motivo)', () => {
  const p = plano({ entradas: [ent({ NUMERO: 'a-c' }), ent({ NUMERO: '0' }), ent({ NUMERO: 'a'.repeat(21) }), ent({ NUMERO: '5', DATA: '0000-00-00' }),
    ent({ NUMERO: '6', DATA: null }), ent({ NUMERO: '7', DATA: '2026-02-30' })] });
  assert.deepEqual(p.entram, []);
  assert.deepEqual(p.ignoradas.map(i => i.motivo), ['número inválido', 'número inválido', 'número inválido', 'data inválida', 'data inválida', 'data inválida']);
});

test('importação: repetida na origem (mesmo número e mesma contraparte) fica só a primeira; repetida já importada não entra de novo', () => {
  const p = plano({ saidas: [sai(), sai({ VALOR: 1 }), sai({ NUMERO: 78 })],
    existentes: [{ tipo: 'saida', serie: '1', numero: '78', contraparte_codigo: 10 }] });
  assert.deepEqual(p.entram.map(n => [n.numero, n.valorTotal]), [['77', 900]]);
  assert.equal(p.qtdJaImportadas, 1);
  assert.deepEqual(p.ignoradas.map(i => [i.numero, i.motivo]), [['77', 'repetida na origem']]);
});

test('importação: mesmo número com contrapartes diferentes são notas diferentes', () => {
  const p = plano({ entradas: [ent({ NUMERO: '9' })], saidas: [sai({ NUMERO: 9 }), sai({ NUMERO: 9, RAZAO_SOCIAL: 'Outro' })] });
  assert.equal(p.entram.length, 3);
});

test('importação: aceita VALOR_TOTAL na saída e VALOR na entrada; nome vazio vira "(sem nome)"; nome longo é cortado em 190', () => {
  const p = plano({ entradas: [ent({ NUMERO: '1', VALOR_TOTAL: undefined, VALOR: 7, RAZAO_FABRICANTE: '' })], saidas: [sai({ VALOR: undefined, VALOR_TOTAL: 8, RAZAO_SOCIAL: 'x'.repeat(300) })] });
  assert.deepEqual(p.entram.map(n => [n.valorTotal, n.contraparteNome.length]), [[7, '(sem nome)'.length], [8, 190]]);
});

test('importação: números com letras do VB (10m, 86P com espaço, 12888A) entram em maiúsculas; 10M e 10m são a mesma nota', () => {
  const p = plano({ entradas: [ent({ NUMERO: '10m' }), ent({ NUMERO: '86P ' }), ent({ NUMERO: '12888A' }), ent({ NUMERO: '10M' })] });
  assert.deepEqual(p.entram.map(n => n.numero), ['10M', '86P', '12888A']);
  assert.deepEqual(p.ignoradas.map(i => [i.numero, i.motivo]), [['10M', 'repetida na origem']]);
});

test('importação: data com ano de 3 dígitos (0225-02-06) é ignorada como data inválida', () => {
  const p = plano({ entradas: [ent({ NUMERO: '351568', DATA: '0225-02-06' })] });
  assert.deepEqual([p.entram.length, p.ignoradas[0].motivo], [0, 'data inválida']);
});
