const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularAnalises } = require('../rotas/estoque_analises');

const HOJE = '2026-10-21';
const item = (CODIGO, NOME_PRODUTO, QTD_ESTOQUE, extra = {}) =>
  ({ CODIGO, NOME_PRODUTO, CLASSE: 'Perfil', UNIDADE: 'Un', QTD_ESTOQUE, MIN_ESTOQUE: 0, SITUACAO: 'Ativo', VALOR: 2, ...extra });
const saida = (CODIGO, janela, anterior, ano, ultima) => ({ CODIGO, janela, anterior, ano, ultima });

function base(mudar = {}) {
  return {
    hoje: HOJE, janela: 90, verValores: false,
    itens: [
      item(1, 'Item A', 90), item(2, 'Item B', 20), item(3, 'Item C', 0), item(4, 'Item D', -3),
      item(5, 'Item E', 50), item(6, 'Item F', 5, { VALOR: 10 }), item(7, 'Item G', 5)
    ],
    saidasPorProduto: [
      saida(1, 180, 90, 700, '2026-10-20 10:00:00'),
      saida(2, 180, 0, 150, '2026-10-19 10:00:00'),
      saida(3, 50, 40, 90, '2026-10-01 10:00:00'),
      saida(6, 0, 3, 3, '2026-07-13 09:00:00'),   // 100 dias atrás
      saida(7, 9, 0, 9, '2026-07-24 09:00:00')    // 89 dias atrás
    ],
    saidasPorMes: [], entradasPorMes: [],
    primeiraSaida: '2026-01-05 08:00:00',
    prazos: [],
    ...mudar
  };
}
const porCodigo = r => Object.fromEntries(r.itens.map(i => [i.codigo, i]));

test('consumo, cobertura, data de falta, alerta e tendência', () => {
  const r = calcularAnalises(base());
  const i = porCodigo(r);
  assert.equal(r.diasDados, 90);
  assert.deepEqual([i[1].consumoDia, i[1].diasCobertura, i[1].dataFalta, i[1].prazoDias, i[1].alerta, i[1].tendencia], [2, 45, '2026-12-05', 15, 'ok', 1]);
  assert.deepEqual([i[2].diasCobertura, i[2].alerta, i[2].tendencia], [10, 'comprar', null]);
  assert.deepEqual([i[3].alerta, i[3].diasCobertura, i[3].dataFalta], ['falta', null, null]);
  assert.deepEqual([i[4].alerta, i[4].diasCobertura, i[4].dataFalta], ['falta', null, null]);
  assert.deepEqual([i[5].alerta, i[5].parado, i[5].ultimaSaida], ['sem_consumo', true, null]);
  assert.deepEqual([i[6].alerta, i[6].parado, i[6].ultimaSaida], ['sem_consumo', true, '2026-07-13']);
  assert.deepEqual([i[7].alerta, i[7].parado, i[7].diasCobertura], ['ok', false, 50]);
});

test('prazo gravado muda o alerta', () => {
  const i = porCodigo(calcularAnalises(base({ prazos: [{ produto_codigo: 2, prazo_dias: 5 }] })));
  assert.deepEqual([i[2].prazoDias, i[2].alerta], [5, 'atencao']);
});

test('ordem: falta, comprar, atenção, poucos dados, ok, sem consumo; empate por cobertura', () => {
  const r = calcularAnalises(base());
  assert.deepEqual(r.itens.map(i => i.codigo), [3, 4, 2, 1, 7, 5, 6]);
  assert.deepEqual(r.resumo, { falta: 2, comprar: 1, atencao: 0, parados: 2 });
});

test('curva ABC por quantidade: classe pelo acumulado ANTES do item (80% A, 95% B)', () => {
  const r = calcularAnalises(base({
    itens: [item(1, 'P1', 10), item(2, 'P2', 10), item(3, 'P3', 10), item(4, 'P4', 10), item(5, 'P5', 10)],
    saidasPorProduto: [saida(1, 1, 1, 70, '2026-10-01 10:00:00'), saida(2, 1, 1, 15, '2026-10-01 10:00:00'),
      saida(3, 1, 1, 10, '2026-10-01 10:00:00'), saida(4, 1, 1, 5, '2026-10-01 10:00:00')]
  }));
  const i = porCodigo(r);
  assert.deepEqual([1, 2, 3, 4, 5].map(c => i[c].abc), ['A', 'A', 'B', 'C', 'C']); // antes: 0%, 70%, 85%, 95%
  const um = porCodigo(calcularAnalises(base({ itens: [item(1, 'P1', 10)], saidasPorProduto: [saida(1, 1, 1, 100, '2026-10-01 10:00:00')] })));
  assert.equal(um[1].abc, 'A'); // um item com 100% do consumo é A
  const dois = porCodigo(calcularAnalises(base({ itens: [item(1, 'P1', 10), item(2, 'P2', 10)],
    saidasPorProduto: [saida(1, 1, 1, 90, '2026-10-01 10:00:00'), saida(2, 1, 1, 10, '2026-10-01 10:00:00')] })));
  assert.deepEqual([dois[1].abc, dois[2].abc], ['A', 'B']);
});

test('valores só com valores.ver', () => {
  const sem = calcularAnalises(base());
  assert.ok(!('valorParado' in sem.resumo));
  assert.ok(sem.itens.every(i => !('valor' in i) && !('abcValor' in i)));
  const com = calcularAnalises(base({ verValores: true }));
  assert.equal(com.resumo.valorParado, 150); // E: 50 × 2 + F: 5 × 10
  assert.equal(porCodigo(com)[1].valor, 2);
  assert.ok(['A', 'B', 'C'].includes(porCodigo(com)[1].abcValor));
});

test('nenhuma saída registrada: poucos dados, sem divisão por zero', () => {
  const r = calcularAnalises(base({ saidasPorProduto: [], primeiraSaida: null }));
  assert.equal(r.diasDados, 0);
  const i = porCodigo(r);
  assert.equal(i[1].alerta, 'poucos_dados');
  assert.equal(i[3].alerta, 'falta');
  assert.equal(r.sazonalidade, null);
  assert.ok(!JSON.stringify(r).includes('NaN') && !JSON.stringify(r).includes('Infinity'));
  assert.ok(r.itens.every(x => x.consumoDia === 0));
});

test('saída de produto que não existe mais: só no mensal, não nos itens', () => {
  const r = calcularAnalises(base({
    saidasPorProduto: [...base().saidasPorProduto, saida(99, 30, 0, 30, '2026-10-10 10:00:00')],
    saidasPorMes: [{ mes: '2026-10', qtd: 300 }]
  }));
  assert.equal(r.itens.length, 7);
  assert.equal(r.mensal.find(m => m.mes === '2026-10').qtdSaidas, 300);
});

test('primeira saída há 10 dias: poucos dados, sem previsão', () => {
  const r = calcularAnalises(base({ primeiraSaida: '2026-10-12 08:00:00' }));
  assert.equal(r.diasDados, 10);
  const i = porCodigo(r);
  assert.deepEqual([i[1].alerta, i[2].alerta, i[3].alerta], ['poucos_dados', 'poucos_dados', 'falta']);
});

test('filtro de classe: a curva ABC continua sendo do estoque inteiro', () => {
  const dados = base({ itens: [item(1, 'P1', 10), item(2, 'P2', 10, { CLASSE: 'Puxador' })],
    saidasPorProduto: [saida(1, 1, 1, 90, '2026-10-01 10:00:00'), saida(2, 1, 1, 10, '2026-10-01 10:00:00')] });
  const filtrado = calcularAnalises({ ...dados, classe: 'Puxador' });
  assert.deepEqual(filtrado.itens.map(i => [i.codigo, i.abc]), [[2, 'B']]);
  assert.equal(filtrado.resumo.falta + filtrado.resumo.comprar + filtrado.resumo.atencao, 0);
});

test('janela de 60 dias usa 60 como divisor', () => {
  const i = porCodigo(calcularAnalises(base({ janela: 60 })));
  assert.equal(i[1].consumoDia, 3); // 180 ÷ 60
});

test('mensal: 12 meses terminando no atual, com zeros', () => {
  const r = calcularAnalises(base({ saidasPorMes: [{ mes: '2026-09', qtd: 12 }], entradasPorMes: [{ mes: '2026-01', qtd: 7 }] }));
  assert.deepEqual(r.mensal.map(m => m.mes), ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(r.mensal.find(m => m.mes === '2026-09'), { mes: '2026-09', qtdEntradas: 0, qtdSaidas: 12 });
  assert.deepEqual(r.mensal.find(m => m.mes === '2026-01'), { mes: '2026-01', qtdEntradas: 7, qtdSaidas: 0 });
});

test('sazonalidade: com 12 meses ou mais; pico destacado pelo índice', () => {
  const meses = [];
  for (let d = new Date(2025, 7, 1); d <= new Date(2026, 9, 1); d.setMonth(d.getMonth() + 1)) {
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    meses.push({ mes, qtd: mes === '2026-03' ? 40 : 10 });
  }
  const r = calcularAnalises(base({ primeiraSaida: '2025-08-05 08:00:00', saidasPorMes: meses }));
  assert.equal(r.sazonalidade.length, 12);
  const marco = r.sazonalidade.find(s => s.mes === 3);
  assert.ok(marco.indice > 1.2, JSON.stringify(marco));
  assert.ok(r.sazonalidade.find(s => s.mes === 8).indice < 1);
  const curto = calcularAnalises(base({ primeiraSaida: '2025-12-01 08:00:00', saidasPorMes: meses.slice(4) }));
  assert.equal(curto.sazonalidade, null);
});
