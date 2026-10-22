const test = require('node:test');
const assert = require('node:assert/strict');
const { arred2, margemDo, margemCom, formarPreco } = require('../calculo/precos_formacao');

const quase = (a, b, casas = 4) => assert.ok(a !== null && Math.abs(a - b) < 10 ** -casas, `${a} ≠ ${b}`);
const custo = (extra = {}) => ({ situacao: 'confiavel', motivos: [], custo: 19.76, divergente: false, unidade: 'm', ...extra });
const margens = (extra = {}) => ({ padrao: 15, classes: new Map(), materiais: new Map(), ...extra });
const parametros = (extra = {}) => ({ impostoPct: 8.5, comissaoPct: 5, custoFixoPct: 20, descontoPct: 28, ...extra });
const material = (extra = {}) => ({ CODIGO: 100, CLASSE: 'Perfis', VALOR_FIXO: 114.43, ...extra });
const formar = (o = {}) => formarPreco({ custoInfo: custo(o.custo), material: material(o.material), parametros: parametros(o.parametros),
  encargos: o.encargos || [], margens: o.margens || margens(), descontoMax: o.descontoMax === undefined ? 40 : o.descontoMax });

test('exemplo da spec: custo 19,76 → alvo 38,37 → VALOR_FIXO sugerido 53,29', () => {
  const r = formar();
  quase(r.minimo, 22.8439); quase(r.equilibrio, 29.7143); quase(r.alvo, 38.3689);
  assert.equal(r.sugerido, 53.29);
  quase(r.variacao, -53.4300); quase(r.margemAtual, 42.5164); quase(r.margemPior, 37.7197);
  assert.equal(r.V, 13.5); assert.equal(r.F, 20); assert.equal(r.M, 15); assert.equal(r.D, 28);
  assert.equal(r.origemMargem, 'padrao');
  assert.equal(r.gravavelPorPadrao, true);
  assert.equal(r.atual, 114.43);
  assert.deepEqual(r.motivos, []);
  assert.ok(r.passos.some(p => p.includes('÷ (1 − 48,5%)')), r.passos.join(' | '));
});

test('encargos extras: só os ativos entram em V', () => {
  const r = formar({ encargos: [{ nome: 'Frete de entrega', pct: 2, ativo: 1 }, { nome: 'Cartão', pct: 3, ativo: 0 }] });
  assert.equal(r.V, 15.5);
});

test('margem em cascata: material > classe > padrão; classe sem diferença de caixa/acento', () => {
  const m = margens({ classes: new Map([['PERFIS', 18]]), materiais: new Map([[100, 12]]) });
  assert.deepEqual(margemDo(material(), m), { pct: 12, origem: 'material' });
  assert.deepEqual(margemDo(material({ CODIGO: 7 }), m), { pct: 18, origem: 'classe' });
  assert.deepEqual(margemDo(material({ CODIGO: 7, CLASSE: 'Acessórios' }), m), { pct: 15, origem: 'padrao' });
  assert.deepEqual(margemDo(material({ CODIGO: 7, CLASSE: 'Acessórios' }), margens({ padrao: null })), null);
  // margem cadastrada para "Acessorios" (sem acento, maiúsculas) vale para "Acessórios"
  assert.deepEqual(margemDo(material({ CODIGO: 7, CLASSE: 'Acessórios' }), margens({ classes: new Map([['ACESSORIOS', 25]]) })), { pct: 25, origem: 'classe' });
  assert.equal(formar({ margens: m }).origemMargem, 'material');
});

test('bloqueio: custo faltando → motivos da parte A, sem preços', () => {
  const r = formar({ custo: { situacao: 'faltando', motivos: ['sem ligação confirmada'], custo: null } });
  assert.deepEqual(r.motivos, ['sem ligação confirmada']);
  for (const k of ['minimo', 'equilibrio', 'alvo', 'sugerido', 'variacao', 'margemAtual', 'margemPior']) assert.equal(r[k], null, k);
  assert.equal(r.gravavelPorPadrao, false);
});

test('bloqueio: sem custo de compra → sem preços', () => {
  const r = formar({ custo: { situacao: 'sem_compra', motivos: [], custo: null } });
  assert.equal(r.sugerido, null);
  assert.ok(r.motivos.length >= 1);
});

test('bloqueio: V ≥ 100 → só motivo', () => {
  const r = formar({ parametros: { impostoPct: 60, comissaoPct: 40 } });
  assert.equal(r.minimo, null);
  assert.match(r.motivos.join(), /encargos somam 100%/);
});

test('bloqueio: V + F ≥ 100 → só o mínimo', () => {
  const r = formar({ parametros: { custoFixoPct: 86.5 } });
  quase(r.minimo, 22.8439);
  assert.equal(r.equilibrio, null); assert.equal(r.alvo, null); assert.equal(r.sugerido, null);
  assert.match(r.motivos.join(), /encargos \+ custo fixo somam 100%/);
});

test('bloqueio: V + F + M ≥ 100 → mínimo e equilíbrio', () => {
  const r = formar({ margens: margens({ padrao: 66.5 }) });
  quase(r.equilibrio, 29.7143);
  assert.equal(r.alvo, null); assert.equal(r.sugerido, null);
  assert.match(r.motivos.join(), /percentuais somam 100%/);
});

test('bloqueio: D ≥ 100 → sem sugerido, com alvo', () => {
  const r = formar({ parametros: { descontoPct: 100 } });
  quase(r.alvo, 38.3689);
  assert.equal(r.sugerido, null);
  assert.match(r.motivos.join(), /desconto/);
});

test('custo desatualizado ou divergente: calcula, avisa e não marca para gravar', () => {
  const r = formar({ custo: { situacao: 'desatualizado', ultimaCompra: '2026-04-20' } });
  assert.equal(r.sugerido, 53.29);
  assert.equal(r.gravavelPorPadrao, false);
  assert.ok(r.avisos.length >= 1);
  const d = formar({ custo: { divergente: true } });
  assert.equal(d.gravavelPorPadrao, false);
  assert.ok(d.avisos.length >= 1);
});

test('VALOR_FIXO atual 0 ou null → sem variação nem margem atual; sugerido normal', () => {
  for (const v of [0, null]) {
    const r = formar({ material: { VALOR_FIXO: v } });
    assert.equal(r.sugerido, 53.29);
    assert.equal(r.variacao, null); assert.equal(r.margemAtual, null); assert.equal(r.margemPior, null);
    assert.equal(r.atual, null);
  }
});

test('sem pior cliente conhecido → margemPior null', () => {
  assert.equal(formar({ descontoMax: null }).margemPior, null);
});

test('parâmetro não definido → motivo, sem preços; zero digitado vale', () => {
  const r = formar({ parametros: { impostoPct: null } });
  assert.equal(r.minimo, null);
  assert.match(r.motivos.join(), /defina o parâmetro imposto/);
  for (const [campo, nome] of [['comissaoPct', 'comissão'], ['custoFixoPct', 'custo fixo'], ['descontoPct', 'desconto']])
    assert.match(formar({ parametros: { [campo]: null } }).motivos.join(), new RegExp(`defina o parâmetro ${nome}`));
  const zero = formar({ parametros: { comissaoPct: 0 } });
  assert.equal(zero.V, 8.5);
  assert.ok(zero.sugerido > 0);
  const semMargem = formar({ margens: margens({ padrao: null }) });
  assert.match(semMargem.motivos.join(), /defina a margem padrão/);
  assert.equal(semMargem.alvo, null);
});

test('arred2 e margemCom', () => {
  assert.equal(arred2(1.005), 1.01);
  assert.equal(arred2(53.2902), 53.29);
  assert.equal(arred2(2.675), 2.68);
  assert.equal(margemCom(0, { custo: 19.76, V: 13.5, F: 20 }, 28), null);
  assert.equal(margemCom(null, { custo: 19.76, V: 13.5, F: 20 }, 28), null);
  quase(margemCom(114.43, { custo: 19.76, V: 13.5, F: 20 }, 28), 42.5164);
});

test('revisão: arred2 meio para cima também acima de 4 (10,075 → 10,08)', () => {
  assert.equal(arred2(10.075), 10.08);
  assert.equal(arred2(1234.565), 1234.57);
  assert.equal(arred2(53.2902), 53.29);
});
