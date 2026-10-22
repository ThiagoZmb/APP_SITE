const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularCusto, lerPercentual } = require('../calculo/custos');

const r4 = v => Math.round(v * 10000) / 10000;
const material = { CODIGO: 100, MODELO: 'Perfil 1036', CLASSE: 'Perfis', VALOR_FIXO: 30, SITUACAO: 'Ativo' };
const item = (mudar = {}) => ({ CODIGO: 1, NOME_PRODUTO: 'PERFIL 1036 BARRA', UNIDADE: 'Barra', VALOR: 60, IPI: 5, FRETE: 3, PERDA: '8', TAMANHO: 6000, ...mudar });
const compra = (data, qtd, valor, nome = 'PERFIL 1036 BARRA', nf = 'NF' + data) => ({ NOTA_FISCAL: nf, DATA: data, FABRICANTE: 'FORN', NOME_PRODUTO: nome, QTD: qtd, VALOR_UNITARIO: valor });
const base = (mudar = {}) => ({ material, config: null, ligacoes: [{ id: 1, estoque_codigo: 1, fator: 6 }], itens: new Map([[1, item()]]),
  compras: [compra('2026-08-01', 10, 60), compra('2026-09-15', 20, 66)], desde: '2026-04-22', divergenciaPct: 15, ...mudar });

test('lerPercentual aceita "8", "8%", "8,5"; vazio é 0; texto é ilegível (null)', () => {
  assert.deepEqual(['8', '8%', '8,5', '', null, 5, 'abc'].map(lerPercentual), [8, 8, 8.5, 0, 0, 5, null]);
});

test('média ponderada convertida para metro + IPI, frete e perda', () => {
  const r = calcularCusto(base());
  assert.equal(r.situacao, 'confiavel');
  assert.equal(r4(r.precoMedio), 10.6667); // R$ 10/m (60 m) e R$ 11/m (120 m)
  assert.equal(r4(r.custo), 12.5391);      // 10,6667 × 1,05 × 1,03 ÷ 0,92
  assert.equal(r.qtdCompras, 2);
  assert.equal(r.ultimaCompra, '2026-09-15');
  assert.deepEqual(r.usadas.map(u => [u.precoConvertido, u.qtdConvertida]), [[10, 60], [11, 120]]);
  assert.ok(r.passos.length >= 4);
  assert.equal(r.unidade, 'm');
});

test('referência do estoque e divergência', () => {
  let r = calcularCusto(base());
  assert.equal(r4(r.referencia), 11.7554); // 60 ÷ 6 × 1,05 × 1,03 ÷ 0,92
  assert.equal(r.divergente, false);
  r = calcularCusto(base({ itens: new Map([[1, item({ VALOR: 40 })]]) }));
  assert.equal(r.divergente, true);
});

test('dois itens de compra com percentuais diferentes', () => {
  const itens = new Map([[1, item()], [2, item({ CODIGO: 2, NOME_PRODUTO: 'PERFIL 1036 3M', IPI: 0, FRETE: 0, PERDA: '0', TAMANHO: 3000 })]]);
  const r = calcularCusto(base({ ligacoes: [{ id: 1, estoque_codigo: 1, fator: 6 }, { id: 2, estoque_codigo: 2, fator: 3 }], itens,
    compras: [compra('2026-08-01', 10, 60), compra('2026-08-02', 10, 36, 'PERFIL 1036 3M')] }));
  // item 1: R$10/m × 1,05 × 1,03 ÷ 0,92 = 11,7554 em 60 m; item 2: R$12/m em 30 m → (11,7554×60 + 12×30) ÷ 90
  assert.equal(r4(r.custo), r4((11.755434782608695 * 60 + 12 * 30) / 90));
  assert.equal(r4(r.precoMedio), r4((10 * 60 + 12 * 30) / 90));
});

test('item ligado nunca comprado não atrapalha o outro', () => {
  const itens = new Map([[1, item()], [2, item({ CODIGO: 2, NOME_PRODUTO: 'OUTRO' })]]);
  const r = calcularCusto(base({ ligacoes: [{ id: 1, estoque_codigo: 1, fator: 6 }, { id: 2, estoque_codigo: 2, fator: 6 }], itens }));
  assert.equal(r.situacao, 'confiavel');
  assert.equal(r4(r.custo), 12.5391);
});

test('sem compras no período: desatualizado pela última compra', () => {
  const r = calcularCusto(base({ compras: [compra('2025-12-01', 5, 54), compra('2026-01-20', 5, 60)] }));
  assert.equal(r.situacao, 'desatualizado');
  assert.equal(r.ultimaCompra, '2026-01-20');
  assert.equal(r4(r.custo), 11.7554); // só a última: R$ 10/m
  assert.equal(r.usadas.length, 1);
});

test('dados faltando: custo vazio e motivo', () => {
  const casos = [
    [{ compras: [] }, 'item nunca comprado'],
    [{ itens: new Map([[1, item({ PERDA: 'abc' })]]) }, 'perda ilegível'],
    [{ itens: new Map([[1, item({ PERDA: '100' })]]) }, 'perda ilegível'],
    [{ ligacoes: [{ id: 1, estoque_codigo: 1, fator: 0 }] }, 'fator inválido'],
    [{ itens: new Map() }, 'item de compra não encontrado'],
    [{ ligacoes: [] }, 'sem ligação confirmada']
  ];
  for (const [mudar, motivo] of casos) {
    const r = calcularCusto(base(mudar));
    assert.equal(r.situacao, 'faltando', motivo);
    assert.equal(r.custo, null, motivo);
    assert.ok(r.motivos.some(m => m.includes(motivo)), motivo + ' em ' + JSON.stringify(r.motivos));
  }
});

test('sem custo de compra marcado pelo Thiago', () => {
  const r = calcularCusto(base({ config: { unidadeVenda: null, semCompra: true } }));
  assert.deepEqual([r.situacao, r.custo], ['sem_compra', null]);
});

test('compras com quantidade ou valor zero ficam de fora (ignoradas)', () => {
  const r = calcularCusto(base({ compras: [compra('2026-08-01', 10, 60), compra('2026-08-05', 0, 60), compra('2026-08-06', 3, 0)] }));
  assert.equal(r.usadas.length, 1);
  assert.equal(r.ignoradas.length, 2);
  assert.equal(r4(r.custo), 11.7554);
});

test('nome da compra com maiúsculas/espaço diferente é encontrado (como o MySQL)', () => {
  const r = calcularCusto(base({ compras: [compra('2026-08-01', 10, 60, 'perfil 1036 barra ')] }));
  assert.equal(r.situacao, 'confiavel');
});

test('unidade de venda sobreposta pela configuração', () => {
  const r = calcularCusto(base({ config: { unidadeVenda: 'un', semCompra: false } }));
  assert.equal(r.unidade, 'un');
});

test('revisão I1: nomes que só diferem na pontuação são itens diferentes (não mistura compras)', () => {
  const itens = new Map([[1, item({ NOME_PRODUTO: 'PERFIL 3.5' })]]);
  const r = calcularCusto(base({ itens, compras: [compra('2026-08-01', 10, 60, 'PERFIL 3.5'), compra('2026-08-02', 10, 600, 'PERFIL 3,5')] }));
  assert.equal(r.usadas.length, 1);
  assert.equal(r4(r.custo), 11.7554);
});
