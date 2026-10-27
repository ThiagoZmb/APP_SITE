// Central de Gestão: fórmulas puras (calculo/gestao_caixa.js e calculo/gestao_validacao.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../calculo/gestao_caixa');
const V = require('../calculo/gestao_validacao');

const fechado = G.periodoDoMes('2026-09', '2026-10-15');
const aberto = G.periodoDoMes('2026-10', '2026-10-15');   // dia 15 de 31
const inicio = G.periodoDoMes('2026-10', '2026-10-03');   // dia 3: poucos dias

test('período: mês fechado, em andamento e futuro', () => {
  assert.deepEqual([fechado.completo, fechado.emAndamento, fechado.futuro, fechado.dia, fechado.diasNoMes], [true, false, false, 30, 30]);
  assert.deepEqual([aberto.completo, aberto.emAndamento, aberto.dia, aberto.diasNoMes], [false, true, 15, 31]);
  assert.equal(G.periodoDoMes('2026-12', '2026-10-15').futuro, true);
  assert.equal(G.periodoDoMes('2024-02', '2026-10-15').diasNoMes, 29);
  assert.equal(G.mesAnterior('2026-01'), '2025-12');
  assert.equal(G.mesmoMesAnoAnterior('2026-10'), '2025-10');
  assert.equal(G.somarMeses('2026-11', 3), '2027-02');
});

test('situação: caixa mista, acento e espaços normalizam', () => {
  for (const [entrada, esperado] of [['A receber', 'a_receber'], ['A Receber', 'a_receber'], ['  a RECEBER ', 'a_receber'], ['Pago', 'pago'], ['A pagar', 'a_pagar'], ['Recebido', 'recebido'],
    ['Atrasado', 'atrasado'], ['Protestado', 'protestado'], ['Faturado', 'faturado'], ['Algo', 'outra'], [null, 'outra']]) {
    assert.equal(G.classificarSituacao(entrada), esperado, String(entrada));
  }
});

test('dinheiro em centavos: 0,1 + 0,2 = 0,3 e arredondamento a 2 casas', () => {
  const m = G.agregarCaixaPorMes([{ mes: '2026-09', situacao: 'Pago', soma: 0.1, qtd: 1 }, { mes: '2026-09', situacao: 'pago', soma: 0.2, qtd: 1 }]);
  assert.equal(m['2026-09'].pago, 0.3);
  assert.equal(G.centavos(1234.567), 123457);
  assert.equal(G.centavos('abc'), 0);
  assert.equal(G.centavos(null), 0);
  assert.equal(G.arred2(2.675), 2.68);
});

test('caixa por mês: realizado (Recebido/Pago) separado do previsto, caixa mista somada, atrasados só de cliente', () => {
  const grupos = [
    { mes: '2026-09', situacao: 'Recebido', entrada: true, qtd: 2, soma: 1000.1 },
    { mes: '2026-09', situacao: 'Pago', entrada: false, qtd: 3, soma: 400.05 },
    { mes: '2026-09', situacao: 'A receber', entrada: true, qtd: 1, soma: 300 },
    { mes: '2026-09', situacao: 'A Receber', entrada: true, qtd: 1, soma: 200 },   // outra grafia, mesma situação
    { mes: '2026-09', situacao: 'A pagar', entrada: false, qtd: 1, soma: 50 },
    { mes: '2026-09', situacao: 'Atrasado', entrada: true, qtd: 1, soma: 70 },
    { mes: '2026-09', situacao: 'Protestado', entrada: false, qtd: 1, soma: 999 },   // saída: não é recebível
    { mes: '2026-09', situacao: 'Faturado', entrada: true, qtd: 1, soma: 5 },
    { mes: 'lixo', situacao: 'Pago', soma: 1 }
  ];
  const por = G.agregarCaixaPorMes(grupos);
  assert.deepEqual(Object.keys(por), ['2026-09']);
  const c = G.caixaDoMes(por, '2026-09');
  assert.deepEqual(c.realizado, { entradas: 1000.1, saidas: 400.05, resultado: 600.05 });
  assert.deepEqual(c.previsto, { aReceber: 500, aPagar: 50 });   // previsto nunca soma no realizado
  assert.equal(c.marcadosAtrasado, 70);
  assert.equal(c.semLancamentos, false);
  assert.equal(c.qtdLancamentos, 11);
});

test('caixa: mês sem lançamento = semLancamentos (zeros não são dado)', () => {
  const c = G.caixaDoMes({}, '2026-08');
  assert.equal(c.semLancamentos, true);
  assert.deepEqual(c.realizado, { entradas: 0, saidas: 0, resultado: 0 });
});

test('variação: absoluta e percentual; base zero ou ausente = percentual null com motivo', () => {
  assert.deepEqual(G.variacao(120, 100), { absoluta: 20, percentual: 20, motivo: null });
  assert.deepEqual(G.variacao(80, 100), { absoluta: -20, percentual: -20, motivo: null });
  assert.equal(G.variacao(100, 300).percentual, -66.67);
  const zero = G.variacao(50, 0);
  assert.equal(zero.absoluta, 50); assert.equal(zero.percentual, null); assert.match(zero.motivo, /zero/);
  const aus = G.variacao(50, null);
  assert.equal(aus.absoluta, null); assert.equal(aus.percentual, null); assert.match(aus.motivo, /Sem dado/);
  assert.equal(G.variacao(null, 10).absoluta, null);
  assert.equal(G.variacao(10, -100).percentual, 110);   // base negativa: denominador em módulo
  assert.ok(!JSON.stringify(G.variacao(1, 0)).includes('Infinity'));
});

test('realizado x meta: ok, sem meta, meta zero e realizado ausente', () => {
  assert.deepEqual(G.compararMeta({ realizado: 750, meta: 1000 }), { estado: 'ok', realizado: 750, meta: 1000, percentual: 75, diferenca: -250, motivo: null });
  assert.equal(G.compararMeta({ realizado: 1100.5, meta: 1000 }).percentual, 110.05);
  const sem = G.compararMeta({ realizado: 10, meta: null });
  assert.equal(sem.estado, 'sem_meta'); assert.equal(sem.percentual, null); assert.equal(sem.diferenca, null);
  assert.equal(G.compararMeta({ realizado: 10 }).estado, 'sem_meta');
  const zero = G.compararMeta({ realizado: 10, meta: 0 });
  assert.equal(zero.estado, 'nao_calculavel'); assert.equal(zero.percentual, null); assert.equal(zero.diferenca, 10);
  assert.equal(G.compararMeta({ realizado: null, meta: 10 }).estado, 'nao_calculavel');
});

test('progresso do orçamento: % consumido, saldo, níveis 70/85/100 e limiares próprios', () => {
  const p = (consumido, extra = {}) => G.progressoOrcamento({ orcado: 1000, consumido, periodo: fechado, ...extra });
  assert.equal(p(500).risco, 'ok');
  assert.equal(p(699.99).risco, 'ok');
  assert.equal(p(700).risco, 'atencao');
  assert.equal(p(850).risco, 'alerta');
  assert.equal(p(999.99).risco, 'alerta');
  assert.equal(p(1000).risco, 'estourado');
  const e = p(1250);
  assert.deepEqual([e.risco, e.consumidoPct, e.saldo], ['estourado', 125, -250]);
  assert.equal(p(600, { limiares: { atencao: 50, alerta: 90 } }).risco, 'atencao');
  assert.equal(p(920, { limiares: { atencao: 50, alerta: 90 } }).risco, 'alerta');
  // limiares inválidos (atenção >= alerta, alerta > 100) voltam ao padrão
  assert.deepEqual(G.limiaresEfetivos({ atencao: 90, alerta: 80 }), G.LIMIARES_PADRAO);
  assert.deepEqual(G.limiaresEfetivos({ atencao: 10, alerta: 150 }), G.LIMIARES_PADRAO);
  assert.deepEqual(G.limiaresEfetivos({ atencao: 60 }), { atencao: 60, alerta: 85, estouro: 100 });
});

test('progresso: sem orçamento e orçamento zero = não calculável (nunca 0% nem Infinity)', () => {
  const sem = G.progressoOrcamento({ orcado: null, consumido: 300, periodo: fechado });
  assert.deepEqual([sem.risco, sem.consumidoPct, sem.saldo], ['sem_orcamento', null, null]);
  const zero = G.progressoOrcamento({ orcado: 0, consumido: 300, periodo: fechado });
  assert.deepEqual([zero.risco, zero.consumidoPct, zero.saldo], ['nao_calculavel', null, -300]);
  assert.ok(!JSON.stringify([sem, zero]).includes('Infinity') && !JSON.stringify([sem, zero]).includes('NaN'));
});

test('projeção linear: mês em andamento usa consumido/dia*dias; risco pelo ritmo só abaixo de 100%', () => {
  // dia 15 de 31: 400 gastos -> projeção 826,67 (> orçado 800) com 50% consumido: risco pelo ritmo
  const r = G.progressoOrcamento({ orcado: 800, consumido: 400, periodo: aberto });
  assert.equal(r.projecao, 826.67);
  assert.equal(r.riscoRitmo, true);
  assert.equal(r.risco, 'risco_ritmo');
  // no ritmo não estoura
  const ok = G.progressoOrcamento({ orcado: 1000, consumido: 400, periodo: aberto });
  assert.deepEqual([ok.projecao, ok.riscoRitmo, ok.risco], [826.67, false, 'ok']);
  // já estourado: risco é 'estourado', não 'risco_ritmo'
  const est = G.progressoOrcamento({ orcado: 800, consumido: 900, periodo: aberto });
  assert.deepEqual([est.risco, est.riscoRitmo], ['estourado', false]);
  // mês fechado: projeção = consumido
  assert.equal(G.progressoOrcamento({ orcado: 800, consumido: 500, periodo: fechado }).projecao, 500);
});

test('mês corrente incompleto com poucos dias = dados insuficientes (sem projeção nem risco pelo ritmo)', () => {
  const r = G.progressoOrcamento({ orcado: 1000, consumido: 600, periodo: inicio });
  assert.equal(r.projecao, null);
  assert.equal(r.dadosInsuficientes, true);
  assert.equal(r.riscoRitmo, false);
  assert.match(r.motivo, /Menos de 7 dias/);
  assert.equal(r.risco, 'ok');
  const fut = G.progressoOrcamento({ orcado: 1000, consumido: 0, periodo: G.periodoDoMes('2026-12', '2026-10-15') });
  assert.equal(fut.dadosInsuficientes, true); assert.equal(fut.projecao, null);
  // exatamente 7 dias já projeta
  assert.notEqual(G.progressoOrcamento({ orcado: 1000, consumido: 100, periodo: G.periodoDoMes('2026-10', '2026-10-07') }).projecao, null);
});

const CLASS = [
  { id: 1, tipo: 'Entrada', classe1: 'Vendas', classe2: '', classe3: '' },
  { id: 2, tipo: 'Saída', classe1: 'Materiais', classe2: 'Perfis', classe3: '' },
  { id: 3, tipo: 'Saída', classe1: 'Materiais', classe2: 'Vidros', classe3: 'Temperado' },
  { id: 4, tipo: 'Saída', classe1: 'Pessoal', classe2: '', classe3: '' }
];

test('orçamento por categoria: agrega por CLASSE1, separa pago x a pagar, sem categoria e sem orçamento', () => {
  const grupos = [
    { classificacaoId: 2, situacao: 'Pago', qtd: 2, soma: 300 },
    { classificacaoId: 3, situacao: 'Pago', qtd: 1, soma: 200.5 },
    { classificacaoId: 3, situacao: 'A pagar', qtd: 1, soma: 100 },
    { classificacaoId: 4, situacao: 'Pago', qtd: 1, soma: 80 },
    { classificacaoId: null, situacao: 'Pago', qtd: 2, soma: 45.25 },
    { classificacaoId: 999, situacao: 'A pagar', qtd: 1, soma: 10 },       // categoria que não existe mais
    { classificacaoId: 2, situacao: 'Recebido', qtd: 1, soma: 5000 }      // não é saída: ignorado
  ];
  const r = G.orcamentoPorCategoria({ classificacoes: CLASS, grupos, orcamentos: [{ id: 1, classificacaoId: 2, nivel: 1, valor: 600 }], periodo: fechado });
  const mat = r.itens.find(i => i.rotulo === 'Materiais');
  assert.deepEqual([mat.orcado, mat.realizadoPago, mat.aPagar, mat.saldo, mat.consumidoPct, mat.risco, mat.qtdLancamentos], [600, 500.5, 100, 99.5, 83.42, 'atencao', 4]);
  assert.equal(mat.comprometidoPct, 100.08);   // (pago + a pagar) / orçado, informativo
  const pes = r.itens.find(i => i.rotulo === 'Pessoal');
  assert.deepEqual([pes.orcado, pes.risco, pes.consumidoPct, pes.realizadoPago], [null, 'sem_orcamento', null, 80]);
  assert.equal(r.qtdSemOrcamento, 1);
  assert.deepEqual(r.semCategoria, { rotulo: 'Sem categoria', realizadoPago: 45.25, aPagar: 10, qtdLancamentos: 3 });
  assert.deepEqual(r.totais, { orcado: 600, realizadoPago: 625.75, aPagar: 110 });
});

test('orçamento nível 2: só a subcategoria e a categoria pai não aparece duplicada como "sem orçamento"', () => {
  const grupos = [{ classificacaoId: 2, situacao: 'Pago', qtd: 1, soma: 90 }, { classificacaoId: 3, situacao: 'Pago', qtd: 1, soma: 40 }];
  const r = G.orcamentoPorCategoria({ classificacoes: CLASS, grupos, orcamentos: [{ id: 5, classificacaoId: 2, nivel: 2, valor: 100 }], periodo: fechado });
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].rotulo, 'Materiais › Perfis');
  assert.equal(r.itens[0].realizadoPago, 90);
  assert.equal(r.itens[0].risco, 'alerta');
});

test('orçamento: ordena do mais grave ao menos; categoria removida mantém o orçado e avisa', () => {
  const r = G.orcamentoPorCategoria({
    classificacoes: CLASS,
    grupos: [{ classificacaoId: 4, situacao: 'Pago', qtd: 1, soma: 150 }, { classificacaoId: 2, situacao: 'Pago', qtd: 1, soma: 10 }],
    orcamentos: [{ id: 1, classificacaoId: 2, nivel: 1, valor: 1000 }, { id: 2, classificacaoId: 4, nivel: 1, valor: 100 }, { id: 3, classificacaoId: 777, nivel: 1, valor: 50 }],
    periodo: fechado
  });
  assert.equal(r.itens[0].rotulo, 'Pessoal');   // estourado primeiro
  assert.equal(r.itens[0].risco, 'estourado');
  const sumida = r.itens.find(i => i.categoriaRemovida);
  assert.deepEqual([sumida.orcado, sumida.realizadoPago], [50, 0]);
});

test('alertas: despesa/orçamento, vencidos, sem categoria; ordenados por gravidade; sem dados = lista vazia', () => {
  const orcamento = G.orcamentoPorCategoria({ classificacoes: CLASS, grupos: [{ classificacaoId: 4, situacao: 'Pago', qtd: 1, soma: 150 }, { classificacaoId: null, situacao: 'Pago', qtd: 2, soma: 1 }],
    orcamentos: [{ id: 2, classificacaoId: 4, nivel: 1, valor: 100 }], periodo: fechado });
  const alertas = G.gerarAlertas({
    periodo: fechado,
    despesa: { progresso: G.progressoOrcamento({ orcado: 100, consumido: 90, periodo: fechado }) },
    faturamento: { comparacao: G.compararMeta({ realizado: 500, meta: 1000 }) },
    orcamento, vencidos: { aReceberVencido: 300, marcadosAtrasado: 70, maisAntigo: '2026-01-05' }, qtdSemCategoria: 2
  });
  const codigos = alertas.map(a => a.codigo);
  for (const c of ['despesa_perto_meta', 'orcamento_estourado', 'a_receber_vencido', 'recebiveis_marcados_atrasados', 'sem_categoria', 'faturamento_abaixo_meta']) assert.ok(codigos.includes(c), c);
  assert.equal(alertas[0].gravidade, 'critico');
  for (const a of alertas) { assert.ok(a.motivo && a.fonte); assert.equal(a.periodo, '2026-09'); }
  assert.match(alertas.find(a => a.codigo === 'a_receber_vencido').motivo, /2026-01-05/);
  assert.deepEqual(G.gerarAlertas({ periodo: aberto, despesa: { progresso: G.progressoOrcamento({ orcado: null, consumido: 0, periodo: aberto }) },
    faturamento: { comparacao: G.compararMeta({ realizado: 0, meta: null }) }, orcamento: { itens: [] }, vencidos: { aReceberVencido: 0, marcadosAtrasado: 0 }, qtdSemCategoria: 0 }), []);
  // faturamento abaixo da meta só avisa em mês fechado (mês aberto ainda está chegando lá)
  assert.ok(!G.gerarAlertas({ periodo: aberto, faturamento: { comparacao: G.compararMeta({ realizado: 500, meta: 1000 }) } }).some(a => a.codigo === 'faturamento_abaixo_meta'));
});

test('validação: dinheiro (vírgula, ponto, milhar com vírgula, ambíguo, negativo, 3 casas)', () => {
  const ok = [['1500', 1500], ['1500,5', 1500.5], ['1500.50', 1500.5], ['1.500,50', 1500.5], ['R$ 20,00', 20], [0, 0], [12.34, 12.34], ['0', 0]];
  for (const [e, s] of ok) assert.equal(V.lerDinheiro(e), s, String(e));
  for (const e of ['1.500', '-5', 'abc', '', '1,234', '1.2.3', 12.345, -1, NaN, Infinity, null, '1e5', '100000000000']) assert.ok(Number.isNaN(V.lerDinheiro(e)), String(e));
});

test('validação: meta (mês, tipo, valor, origem)', () => {
  assert.deepEqual(V.validarMeta({ mes: '2026-10', tipo: 'Faturamento', valor: '1.500,00' }), { erros: [], dados: { mes: '2026-10', tipo: 'faturamento', valor: 1500, origem: 'web' } });
  assert.equal(V.validarMeta({ mes: '2026-10', tipo: 'despesa', valor: 0, origem: 'vb' }).dados.origem, 'vb');
  const ruim = V.validarMeta({ mes: '2026-13', tipo: 'lucro', valor: '-1', origem: 'x' });
  assert.equal(ruim.erros.length, 4);
  assert.ok(V.validarMeta({ mes: '1999-12', tipo: 'despesa', valor: 1 }).erros[0].includes('Mês inválido'));
  assert.ok(V.validarMeta({}).erros.length >= 3);
  assert.equal(V.validarMeta({ mes: '2026-1', tipo: 'despesa', valor: 1 }).erros.length, 1);
});

test('validação: orçamento (categoria existente, só saída, nível, canônica do grupo, limiares)', () => {
  const ok = V.validarOrcamento({ mes: '2026-10', classificacaoId: 3, nivel: 1, valor: '800' }, CLASS);
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.dados.classificacaoId, 2);   // canônica = menor id de Materiais
  assert.equal(ok.dados.rotulo, 'Materiais');
  assert.equal(V.validarOrcamento({ mes: '2026-10', classificacaoId: 3, nivel: 2, valor: 1 }, CLASS).dados.classificacaoId, 3);
  const msg = (b) => V.validarOrcamento({ mes: '2026-10', valor: 10, classificacaoId: 2, ...b }, CLASS).erros.join(' ');
  assert.match(msg({ classificacaoId: 999 }), /não encontrada/);
  assert.match(msg({ classificacaoId: 1 }), /saída/);
  assert.match(msg({ classificacaoId: 4, nivel: 2 }), /não tem subcategoria/);
  assert.match(msg({ classificacaoId: 0 }), /Escolha a categoria/);
  assert.match(msg({ classificacaoId: 'abc' }), /Escolha a categoria/);
  assert.match(msg({ nivel: 3 }), /Nível inválido/);
  assert.match(msg({ valor: '-1' }), /Valor inválido/);
  assert.match(msg({ limiarAtencao: 90, limiarAlerta: 80 }), /menor que o de alerta/);
  assert.match(msg({ limiarAtencao: 0 }), /entre 1 e 100/);
  assert.match(msg({ limiarAlerta: 101 }), /entre 1 e 100/);
  assert.match(msg({ mes: 'x' }), /Mês inválido/);
  assert.deepEqual(msg({ limiarAtencao: '60', limiarAlerta: '80' }), '');
});
