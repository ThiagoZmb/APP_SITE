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

// ---------- composição: material = Σ quantidade × componente (quantidade na unidade de venda) ----------
const limpo = (cod, nome, mudar = {}) => ({ CODIGO: cod, NOME_PRODUTO: nome, UNIDADE: 'Barra', VALOR: 0, IPI: 0, FRETE: 0, PERDA: '', TAMANHO: 6000, ...mudar });
const comp = (id, nome, qtd, ordem = id) => ({ id, nome, quantidade: String(qtd), ordem });
const belluno = (mudar = {}) => ({
  material: { CODIGO: 200, MODELO: 'Belluno', CLASSE: 'Perfis', VALOR_FIXO: 80, SITUACAO: 'Ativo' }, config: null, desde: '2026-04-22', divergenciaPct: 15,
  componentes: [comp(1, 'A', 1), comp(2, 'B', 1), comp(3, 'C', 2)],
  ligacoes: [{ id: 1, estoque_codigo: 11, fator: 6, componente_id: 1 }, { id: 2, estoque_codigo: 12, fator: 6, componente_id: 2 }, { id: 3, estoque_codigo: 13, fator: 6, componente_id: 3 }],
  itens: new Map([[11, limpo(11, 'PERFIL A')], [12, limpo(12, 'PERFIL B')], [13, limpo(13, 'PERFIL C')]]),
  compras: [compra('2026-08-01', 10, 60, 'PERFIL A'), compra('2026-08-01', 10, 30, 'PERFIL B'), compra('2026-08-01', 10, 18, 'PERFIL C')],
  ...mudar });

test('composição: Belluno = 1 m de A (R$ 10/m) + 1 m de B (R$ 5/m) + 2 m de C (R$ 3/m) = R$ 21/m', () => {
  const r = calcularCusto(belluno());
  assert.equal(r.situacao, 'confiavel');
  assert.equal(r4(r.custo), 21);
  assert.equal(r4(r.precoMedio), 21);
  assert.deepEqual(r.componentes.map(c => [c.id, c.nome, c.quantidade, r4(c.custo), r4(c.parcela), c.situacao]),
    [[1, 'A', 1, 10, 10, 'confiavel'], [2, 'B', 1, 5, 5, 'confiavel'], [3, 'C', 2, 3, 6, 'confiavel']]);
  assert.ok(r.passos.includes('C: 2 × R$ 3,00/m = R$ 6,00/m'), r.passos.join(' | '));
  assert.equal(r.passos.at(-1), '= Custo: R$ 21,00/m');
  assert.equal(r.usadas.length, 3);
  assert.deepEqual(r.usadas.map(u => u.componente), ['A', 'B', 'C']);
});

test('composição: Canelado = 1 m² de vidro (chapa → m²) + 1 m² de pintura', () => {
  const r = calcularCusto({
    material: { CODIGO: 201, MODELO: 'Canelado 4mm Pintado Metálico', CLASSE: 'Vidros', VALOR_FIXO: 300, SITUACAO: 'Ativo' }, config: null, desde: '2026-04-22', divergenciaPct: 15,
    componentes: [comp(1, 'Vidro', 1), comp(2, 'Pintura', 1)],
    ligacoes: [{ id: 1, estoque_codigo: 21, fator: 7.062, componente_id: 1 }, { id: 2, estoque_codigo: 22, fator: 1, componente_id: 2 }],
    itens: new Map([[21, limpo(21, 'VIDRO CANELADO 4MM', { UNIDADE: 'Chapa' })], [22, limpo(22, 'PINTURA METALICA M2', { UNIDADE: 'm²' })]]),
    compras: [compra('2026-08-01', 2, 706.2, 'VIDRO CANELADO 4MM'), compra('2026-08-01', 10, 35, 'PINTURA METALICA M2')] });
  assert.equal(r.unidade, 'm2');
  assert.equal(r4(r.custo), 135);
});

test('composição: itens de um mesmo componente SE SOMAM, cada um com a sua quantidade', () => {
  const b = belluno({ componentes: [comp(1, 'Conjunto de perfis', 1), comp(3, 'C', 2)] });
  b.ligacoes = [{ id: 1, estoque_codigo: 11, fator: 6, componente_id: 1, quantidade: '1' }, { id: 2, estoque_codigo: 12, fator: 6, componente_id: 1, quantidade: '2' },
    { id: 3, estoque_codigo: 13, fator: 6, componente_id: 3 }];
  const r = calcularCusto(b);
  // conjunto: 1 × 10 (A) + 2 × 5 (B) = 20; C: 2 × 3 = 6 → 26
  assert.equal(r.situacao, 'confiavel');
  assert.equal(r4(r.componentes[0].custo), 20);
  assert.equal(r4(r.custo), 26);
  assert.deepEqual(r.componentes[0].itens.map(i => [i.ligacaoId, i.estoqueCodigo, i.nome, i.quantidade, r4(i.custo), r4(i.parcela), i.situacao]),
    [[1, 11, 'PERFIL A', 1, 10, 10, 'confiavel'], [2, 12, 'PERFIL B', 2, 5, 10, 'confiavel']]);
  assert.ok(r.passos.includes('Conjunto de perfis: 1 × R$ 10,00/m (PERFIL A) + 2 × R$ 5,00/m (PERFIL B) = R$ 20,00/m'), r.passos.join(' | '));
  assert.ok(r.passos.includes('C: 2 × R$ 3,00/m = R$ 6,00/m'), r.passos.join(' | '));
});

test('composição: item sem compra deixa o componente sem custo, com o nome do item no motivo', () => {
  const b = belluno({ componentes: [comp(1, 'Conjunto de perfis', 1)] });
  b.ligacoes = [{ id: 1, estoque_codigo: 11, fator: 6, componente_id: 1, quantidade: '1' }, { id: 2, estoque_codigo: 12, fator: 6, componente_id: 1, quantidade: '1' }];
  b.compras = b.compras.filter(c => c.NOME_PRODUTO !== 'PERFIL B');
  const r = calcularCusto(b);
  assert.equal(r.situacao, 'faltando');
  assert.equal(r.custo, null);
  assert.deepEqual(r.motivos, ['Conjunto de perfis: PERFIL B: item nunca comprado']);
  assert.deepEqual(r.componentes[0].itens.map(i => [i.nome, i.situacao, i.custo === null ? null : r4(i.custo)]), [['PERFIL A', 'confiavel', 10], ['PERFIL B', 'faltando', null]]);
});

test('composição: quantidade do item inválida vira motivo', () => {
  const b = belluno({ componentes: [comp(1, 'A', 1)] });
  b.ligacoes = [{ id: 1, estoque_codigo: 11, fator: 6, componente_id: 1, quantidade: '0' }];
  assert.deepEqual(calcularCusto(b).motivos, ['A: PERFIL A: quantidade inválida']);
});

test('composição: componente sem compra deixa o material sem custo, com o nome no motivo', () => {
  const b = belluno({ componentes: [comp(1, 'A', 1), comp(2, 'B', 1), comp(3, 'Pintura', 2)] });
  b.compras = b.compras.filter(c => c.NOME_PRODUTO !== 'PERFIL C');
  const r = calcularCusto(b);
  assert.equal(r.situacao, 'faltando');
  assert.equal(r.custo, null);
  assert.deepEqual(r.motivos, ['Pintura: PERFIL C: item nunca comprado']);
  assert.equal(r.componentes[2].situacao, 'faltando');
  assert.equal(r4(r.componentes[0].custo), 10); // os outros continuam informados no detalhe
});

test('composição: componente sem item e item excluído do estoque', () => {
  const b = belluno({ componentes: [comp(1, 'A', 1), comp(2, 'B', 1), comp(3, 'C', 2), comp(4, 'Pintura', 1)] });
  let r = calcularCusto(b);
  assert.equal(r.situacao, 'faltando');
  assert.deepEqual(r.motivos, ['componente Pintura sem item do estoque']);
  const sumiu = belluno();
  sumiu.itens.delete(13);
  r = calcularCusto(sumiu);
  assert.equal(r.situacao, 'faltando');
  assert.deepEqual(r.motivos, ['C: item de compra não encontrado (código 13)']);
});

test('composição: um componente desatualizado → material desatualizado, última compra = a mais antiga', () => {
  const b = belluno();
  b.compras = b.compras.map(c => c.NOME_PRODUTO === 'PERFIL B' ? { ...c, DATA: '2026-01-10' } : c);
  const r = calcularCusto(b);
  assert.equal(r.situacao, 'desatualizado');
  assert.equal(r.ultimaCompra, '2026-01-10');
  assert.equal(r4(r.custo), 21);
});

test('composição: referência = soma das referências; sem referência em um componente → null', () => {
  const b = belluno();
  b.itens.set(11, limpo(11, 'PERFIL A', { VALOR: 60 })); b.itens.set(12, limpo(12, 'PERFIL B', { VALOR: 30 })); b.itens.set(13, limpo(13, 'PERFIL C', { VALOR: 24 }));
  let r = calcularCusto(b);
  assert.equal(r4(r.referencia), 10 + 5 + 8); // C: R$ 4/m × 2
  assert.equal(r.divergente, true); // C diverge 25%
  b.itens.set(12, limpo(12, 'PERFIL B', { VALOR: 0 }));
  r = calcularCusto(b);
  assert.equal(r.referencia, null);
});

test('composição: quantidade inválida vira motivo', () => {
  const r = calcularCusto(belluno({ componentes: [comp(1, 'A', 1), comp(2, 'B', 0), comp(3, 'C', 2)] }));
  assert.equal(r.situacao, 'faltando');
  assert.deepEqual(r.motivos, ['B: quantidade inválida']);
});

test('composição: ligações sem componente dão exatamente o resultado de antes', () => {
  const antes = calcularCusto(base());
  const depois = calcularCusto(base({ ligacoes: [{ id: 1, estoque_codigo: 1, fator: 6, componente_id: null }], componentes: [] }));
  assert.deepEqual(depois, antes);
  assert.deepEqual(antes.componentes, []);
});

test('composição: componente gravado na forma antiga (só participação %) vale % ÷ 100', () => {
  const r = calcularCusto(belluno({ componentes: [{ id: 1, nome: 'A', participacao_pct: '100.000', quantidade: null, ordem: 1 },
    { id: 2, nome: 'B', participacao_pct: '100.000', ordem: 2 }, { id: 3, nome: 'C', participacao_pct: '200.000', quantidade: null, ordem: 3 }] }));
  assert.equal(r4(r.custo), 21);
  assert.deepEqual(r.componentes.map(c => c.quantidade), [1, 1, 2]);
});

// ---------- custo informado (sem estoque) ----------
const informado = (id, nome, qtd, valor, em = '2026-10-01 10:00:00') => ({ id, nome, quantidade: String(qtd), ordem: id, custo_informado: String(valor), informado_em: em, informado_por: 'Thiago' });

test('custo informado: produto inteiro, sem estoque', () => {
  const r = calcularCusto({ material: { CODIGO: 300, MODELO: 'Kit especial', CLASSE: 'Kit', VALOR_FIXO: 90, SITUACAO: 'Ativo' }, config: null,
    ligacoes: [], itens: new Map(), compras: [], desde: '2026-04-22', divergenciaPct: 15, componentes: [informado(1, null, 1, 42.5)] });
  assert.equal(r.situacao, 'confiavel');
  assert.equal(r.custo, 42.5);
  assert.equal(r.informado, true);
  assert.equal(r.ultimaCompra, null);
  assert.deepEqual(r.componentes.map(c => [c.custoInformado, c.informadoEm, c.informadoPor]), [[42.5, '2026-10-01 10:00:00', 'Thiago']]);
  assert.match(r.passos[0], /Componente 1: 1 × R\$ 42,50\/un \(informado em 01\/10\/2026\) = R\$ 42,50\/un/);
});

test('custo informado: num componente, somado ao do estoque (Canelado = vidro do estoque + pintura informada)', () => {
  const b = belluno({ componentes: [comp(1, 'A', 1), informado(2, 'Pintura', 1, 35)] });
  b.ligacoes = b.ligacoes.filter(l => l.componente_id === 1);
  const r = calcularCusto(b);
  assert.equal(r.situacao, 'confiavel');
  assert.equal(r4(r.custo), 45);
  assert.equal(r.informado, true);
  assert.equal(r.componentes[1].situacao, 'confiavel');
  // referência só existe se todos os componentes tiverem; o informado não tem
  assert.equal(r.referencia, null);
});

test('custo informado antigo (antes do período) → desatualizado', () => {
  const b = belluno({ componentes: [comp(1, 'A', 1), informado(2, 'Pintura', 2, 35, '2026-01-05 09:00:00')] });
  b.ligacoes = b.ligacoes.filter(l => l.componente_id === 1);
  const r = calcularCusto(b);
  assert.equal(r.situacao, 'desatualizado');
  assert.equal(r4(r.custo), 80);
  assert.equal(r.componentes[1].situacao, 'desatualizado');
});

test('material sem custo informado nem estoque continua sem custo; material simples não é "informado"', () => {
  assert.equal(calcularCusto(base()).informado, false);
});
