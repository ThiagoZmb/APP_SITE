// EPIs: validações e contas puras (calculo/epis.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calculo/epis');

const HOJE = '2026-11-27';
const CHAVE = 'abcdef12-3456';
const entrega = (x = {}) => C.validarEntrega({ funcionarioCodigo: 3, itens: [{ epiId: 1, quantidade: 2 }], chave: CHAVE, ...x }, HOJE);

test('EPI: nome e C.A. obrigatórios (C.A. só números, até 7), mínimo inteiro >= 0', () => {
  assert.deepEqual(C.validarEpi({ nome: '  Luva  ', ca: '12345', minimo: '3' }).dados, { nome: 'Luva', ca: '12345', minimo: 3 });
  assert.equal(C.validarEpi({ nome: 'Luva', ca: '1' }).dados.minimo, 0);
  for (const ruim of [{ ca: '1' }, { nome: 'x' }, { nome: 'x', ca: '12a' }, { nome: 'x', ca: '12345678' }, { nome: 'x', ca: '1', minimo: -1 }, { nome: 'x', ca: '1', minimo: 1.5 }]) {
    assert.ok(C.validarEpi(ruim).erro, JSON.stringify(ruim));
  }
});

test('quantidade: só inteiro de 1 em diante', () => {
  assert.equal(C.quantidade('5'), 5);
  assert.equal(C.quantidade(1), 1);
  for (const ruim of [0, -1, 1.5, '1,5', '', null, undefined, true, 'abc', 1000000, [2]]) assert.equal(C.quantidade(ruim), null, String(ruim));
});

test('entrega: data vazia = hoje; passada vale; futura e inexistente não', () => {
  assert.equal(entrega().dados.data, HOJE);
  assert.equal(entrega({ data: '2024-01-05' }).dados.data, '2024-01-05');
  assert.match(entrega({ data: '2026-11-28' }).erro, /futura/i);
  assert.match(entrega({ data: '2026-02-30' }).erro, /data/i);
  assert.match(entrega({ data: '27/11/2026' }).erro, /data/i);
});

test('entrega: funcionário, itens, repetição, chave e observação', () => {
  const d = entrega({ observacao: '  troca\u0000 por desgaste ', itens: [{ epiId: '2', quantidade: '1' }, { epiId: 1, quantidade: 4 }] }).dados;
  assert.deepEqual(d.itens, [{ epiId: 2, quantidade: 1 }, { epiId: 1, quantidade: 4 }]);
  assert.equal(d.observacao, 'troca  por desgaste');
  assert.ok(entrega({ funcionarioCodigo: 0 }).erro);
  assert.ok(entrega({ itens: [] }).erro);
  assert.ok(entrega({ itens: 'x' }).erro);
  assert.ok(entrega({ itens: [null] }).erro);
  assert.ok(entrega({ itens: [{ epiId: 1, quantidade: 0 }] }).erro);
  assert.match(entrega({ itens: [{ epiId: 1, quantidade: 1 }, { epiId: 1, quantidade: 1 }] }).erro, /repetido/i);
  assert.ok(entrega({ itens: Array.from({ length: 31 }, (_, i) => ({ epiId: i + 1, quantidade: 1 })) }).erro);
  assert.ok(entrega({ chave: 'curta' }).erro);
  assert.ok(entrega({ chave: undefined }).erro);
  assert.ok(entrega({ observacao: 'x'.repeat(201) }).erro);
});

test('motivo do cancelamento é obrigatório', () => {
  assert.equal(C.validarMotivo('  errei  ').motivo, 'errei');
  assert.ok(C.validarMotivo('   ').erro);
  assert.ok(C.validarMotivo('x'.repeat(201)).erro);
});

test('saldo e "Dura (est.)" como no piloto', () => {
  const lista = C.montarEstoque(
    [{ id: 1, nome: 'Luva', ca: '1', minimo: 5, ativo: 1 }, { id: 2, nome: 'Óculos', ca: '2', minimo: 0, ativo: 0 }],
    [{ epi_id: 1, qtd: '20' }], [{ epi_id: 1, qtd: '15', qtd_30: '10' }]);
  assert.deepEqual(lista[0], { id: 1, nome: 'Luva', ca: '1', minimo: 5, ativo: true, qtdEstoque: 5, baixo: true, duraDias: 15 });
  assert.deepEqual(lista[1], { id: 2, nome: 'Óculos', ca: '2', minimo: 0, ativo: false, qtdEstoque: 0, baixo: false, duraDias: null }); // inativo nunca conta como baixo
  assert.equal(C.diasAtras('2026-03-01', 30), '2026-01-30');
});

test('resumo: indicadores, 6 meses, top 6 e estoque atual', () => {
  const item = (data, func, epi, qtd) => ({ data_entrega: data, funcionario_codigo: func, funcionario_nome: 'F' + func, epi_id: epi, nome: 'E' + epi, quantidade: qtd });
  const r = C.montarResumo({
    hoje: HOJE, qtdFuncionarios: 9,
    estoque: [{ id: 1, nome: 'Luva', ativo: true, baixo: true, qtdEstoque: 1 }, { id: 2, nome: 'Velho', ativo: false, baixo: false, qtdEstoque: 7 }],
    itens: [item('2026-11-20', 1, 1, 2), item('2026-10-01', 1, 1, 3), item('2026-06-15', 2, 2, 4), item('2025-01-01', 3, 1, 100),
      ...[4, 5, 6, 7, 8, 9].map(n => item('2026-11-01', n, n, 1))]
  });
  assert.equal(r.qtdUnidades, 115);
  assert.equal(r.qtdUltimos30, 8);
  assert.equal(r.qtdFuncionarios, 9);
  assert.deepEqual(r.baixos, ['Luva']);
  assert.deepEqual(r.porMes.map(m => m.mes), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(r.porMes.map(m => m.qtd), [4, 0, 0, 0, 3, 8]);
  assert.equal(r.porFuncionario.length, 6);
  assert.deepEqual(r.porFuncionario[0], { nome: 'F3', qtd: 100 });
  assert.deepEqual(r.porEpi[0], { nome: 'E1', qtd: 105 });
  assert.deepEqual(r.estoque, [{ nome: 'Luva', qtd: 1, baixo: true }]);
});
