// Otimização do plano de corte de vidros (calculo/vidro_otimizacao.js). Função pura, sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { otimizarVidros, PADRAO, _internos } = require('../calculo/vidro_otimizacao');

const INCOLOR = { produtoCodigo: 10, produtoNome: 'Vidro Incolor 4mm', altura: 2400, largura: 3210 };
const peca = (altura, largura, o = {}) => ({ modelo: 'Incolor 4mm', cor: '', altura, largura, item: 1, medicao: '', ...o });
const retalho = (id, altura, largura, o = {}) => ({ id, produtoCodigo: 10, altura, largura, ...o });
const plano = (pecas, { retalhos = [], chapaDe = () => INCOLOR, parametros = PADRAO } = {}) =>
  otimizarVidros({ pecas, retalhos, chapaDe, parametros });
const chapas = r => r.grupos.flatMap(g => g.chapas);

// gerador congruencial com semente fixa: os cenários "aleatórios" são sempre os mesmos
function aleatorio(semente) {
  let s = semente >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
function pecasAleatorias(qtd, semente, { min = 150, maxA = 2000, maxL = 2600 } = {}) {
  const r = aleatorio(semente);
  return Array.from({ length: qtd }, (_, i) =>
    peca(min + Math.floor(r() * (maxA - min)), min + Math.floor(r() * (maxL - min)), { item: i + 1 }));
}

// dois retângulos separados por pelo menos `folga` em algum eixo (folga 0 = apenas não se sobrepõem)
const separados = (a, b, folga) =>
  a.x + a.largura + folga <= b.x || b.x + b.largura + folga <= a.x ||
  a.y + a.altura + folga <= b.y || b.y + b.altura + folga <= a.y;
const dentro = (r, ch) => r.x >= 0 && r.y >= 0 && r.largura > 0 && r.altura > 0 &&
  r.x + r.largura <= ch.largura && r.y + r.altura <= ch.altura;

// guilhotina: o conjunto se separa por um risco reto de ponta a ponta, e cada lado de novo, até sobrar uma peça
function guilhotinavel(rs) {
  if (rs.length <= 1) return true;
  for (const [pos, tam] of [['x', 'largura'], ['y', 'altura']]) {
    for (const c of new Set(rs.map(r => r[pos] + r[tam]))) {
      const antes = rs.filter(r => r[pos] + r[tam] <= c), depois = rs.filter(r => r[pos] >= c);
      if (antes.length && depois.length && antes.length + depois.length === rs.length) return guilhotinavel(antes) && guilhotinavel(depois);
    }
  }
  return false;
}

function conferirChapa(ch, serra, sobraMinima) {
  for (const p of ch.pecas) assert.ok(dentro(p, ch), `peça fora da chapa: ${JSON.stringify(p)} em ${ch.largura}x${ch.altura}`);
  for (let i = 0; i < ch.pecas.length; i++)
    for (let j = i + 1; j < ch.pecas.length; j++)
      assert.ok(separados(ch.pecas[i], ch.pecas[j], serra), `peças sobrepostas ou sem folga de serra ${serra}: ${JSON.stringify([ch.pecas[i], ch.pecas[j]])}`);
  assert.ok(guilhotinavel(ch.pecas), 'o arranjo não é de guilhotina');
  for (const s of ch.sobras) {
    assert.ok(s.altura >= sobraMinima && s.largura >= sobraMinima, `sobra menor que a mínima: ${JSON.stringify(s)}`);
    assert.ok(dentro(s, ch), `sobra fora da chapa: ${JSON.stringify(s)}`);
    for (const p of ch.pecas) assert.ok(separados(s, p, 0), `sobra cruza peça: ${JSON.stringify([s, p])}`);
  }
  for (let i = 0; i < ch.sobras.length; i++)
    for (let j = i + 1; j < ch.sobras.length; j++) assert.ok(separados(ch.sobras[i], ch.sobras[j], 0), 'sobras se cruzam');
  assert.ok(guilhotinavel([...ch.pecas, ...ch.sobras]), 'peças e sobras não formam guilhotina');
}

// 6 cenários fixos, todos com serra (inclusive um com retalhos)
const CENARIOS = [
  { nome: '40 aleatórias, serra 3', pecas: pecasAleatorias(40, 42), parametros: { serra: 3, sobraMinima: 300 } },
  { nome: '40 aleatórias pequenas, serra 5', pecas: pecasAleatorias(40, 7, { min: 100, maxA: 900, maxL: 1200 }), parametros: { serra: 5, sobraMinima: 300 } },
  { nome: '20 iguais 600x800, serra 4', pecas: Array.from({ length: 20 }, (_, i) => peca(600, 800, { item: i + 1 })), parametros: { serra: 4, sobraMinima: 300 } },
  { nome: '30 tiras 2400x100 (giram), serra 3', pecas: Array.from({ length: 30 }, (_, i) => peca(100, 2400, { item: i + 1 })), parametros: { serra: 3, sobraMinima: 200 } },
  { nome: 'mistas com retalhos, serra 3', pecas: pecasAleatorias(25, 99), parametros: { serra: 3, sobraMinima: 300 },
    retalhos: [retalho(1, 900, 1200), retalho(2, 1500, 2000), retalho(3, 400, 400)] },
  { nome: 'chapa 1900x2200, serra 2', pecas: pecasAleatorias(25, 2026, { maxA: 1800, maxL: 2100 }), parametros: { serra: 2, sobraMinima: 300 },
    chapaDe: () => ({ produtoCodigo: 20, produtoNome: 'Vidro Canelado 4mm', altura: 1900, largura: 2200 }) }
];
const rodar = c => plano(c.pecas, { retalhos: c.retalhos, chapaDe: c.chapaDe, parametros: c.parametros });

test('PADRAO: serra 0 e sobra mínima 300', () => {
  assert.deepEqual(PADRAO, { serra: 0, sobraMinima: 300 });
});

test('duas peças que cabem lado a lado usam uma chapa', () => {
  const r = plano([peca(1000, 1500), peca(1000, 1500, { item: 2 })]);
  assert.equal(r.grupos.length, 1);
  const g = r.grupos[0];
  assert.deepEqual(g.erros, []);
  assert.equal(g.aguardandoProduto, false);
  assert.equal(g.produtoCodigo, 10);
  assert.equal(g.produtoNome, 'Vidro Incolor 4mm');
  assert.deepEqual(g.chapa, { altura: 2400, largura: 3210 });
  assert.equal(g.chapas.length, 1);
  assert.equal(g.chapas[0].tipo, 'chapa');
  assert.equal(g.chapas[0].pecas.length, 2);
  assert.deepEqual(g.chapas[0].pecas.map(p => p.item).sort(), [1, 2]);
  assert.equal(g.chapas[0].aproveitamentoPct, Math.round(3000000 * 1000 / (2400 * 3210)) / 10);
  assert.deepEqual(r.resumo, { qtdChapasNovas: 1, qtdRetalhosUsados: 0, qtdPecas: 2, qtdPecasSemChapa: 0 });
});

test('gira a peça quando só assim cabe', () => {
  const r = plano([peca(3000, 500, { item: 4, medicao: 'M1' })]);
  const [p] = chapas(r)[0].pecas;
  assert.equal(p.girada, true);
  assert.equal(p.altura, 500);
  assert.equal(p.largura, 3000);
  assert.equal(p.item, 4);
  assert.equal(p.medicao, 'M1');
  assert.ok(dentro(p, chapas(r)[0]));
});

test('peça que cabe sem girar sai com girada: false', () => {
  const [p] = chapas(plano([peca(2000, 3000)]))[0].pecas;
  assert.equal(p.girada, false);
  assert.deepEqual([p.altura, p.largura], [2000, 3000]);
});

test('peça maior que a chapa mesmo girada gera erro no grupo e as outras peças continuam', () => {
  const r = plano([peca(3300, 2500, { item: 7 }), peca(1000, 1000, { item: 8 })]);
  const g = r.grupos[0];
  assert.equal(g.erros.length, 1);
  assert.match(g.erros[0], /maior que a chapa/);
  assert.match(g.erros[0], /item 7/);
  assert.deepEqual(chapas(r).flatMap(c => c.pecas).map(p => p.item), [8]);
  assert.equal(r.resumo.qtdPecas, 2);
  assert.equal(r.resumo.qtdPecasSemChapa, 1);
});

test('chapa com altura ou largura <= 0 gera erro e não lança', () => {
  for (const ruim of [{ altura: 0, largura: 3210 }, { altura: 2400, largura: -5 }, { altura: null, largura: 'x' }]) {
    const r = plano([peca(1000, 1000), peca(500, 500)], { chapaDe: () => ({ produtoCodigo: 10, produtoNome: 'Vidro X', ...ruim }) });
    const g = r.grupos[0];
    assert.equal(g.chapas.length, 0);
    assert.equal(g.erros.length, 1);
    assert.match(g.erros[0], /medida inválida/);
    assert.equal(g.aguardandoProduto, false);
    assert.deepEqual(r.resumo, { qtdChapasNovas: 0, qtdRetalhosUsados: 0, qtdPecas: 2, qtdPecasSemChapa: 2 });
  }
});

test('peça sem medida válida vira erro do grupo e não lança', () => {
  const r = plano([peca(0, 1000, { item: 3 }), peca(1000, 1000)]);
  assert.equal(r.grupos[0].erros.length, 1);
  assert.match(r.grupos[0].erros[0], /item 3/);
  assert.equal(r.resumo.qtdPecasSemChapa, 1);
});

test('serra: duas peças que só cabem sem folga não cabem com serra 3', () => {
  const pecas = [peca(2400, 1605), peca(2400, 1605, { item: 2 })];   // 1605 + 1605 = 3210
  assert.equal(plano(pecas, { parametros: { serra: 0, sobraMinima: 300 } }).resumo.qtdChapasNovas, 1);
  assert.equal(plano(pecas, { parametros: { serra: 3, sobraMinima: 300 } }).resumo.qtdChapasNovas, 2);
  // com 1 mm a menos em cada peça, a serra de 2 cabe
  const justas = [peca(2400, 1604), peca(2400, 1604, { item: 2 })];
  const r = plano(justas, { parametros: { serra: 2, sobraMinima: 300 } });
  assert.equal(r.resumo.qtdChapasNovas, 1);
  conferirChapa(chapas(r)[0], 2, 300);
});

test('nenhuma peça se sobrepõe nem sai da chapa', () => {
  for (const c of CENARIOS) {
    const r = rodar(c);
    const todas = chapas(r);
    assert.ok(todas.length > 0, c.nome);
    for (const ch of todas) {
      assert.ok(ch.pecas.length > 0, `${c.nome}: chapa vazia no resultado`);
      conferirChapa(ch, c.parametros.serra, c.parametros.sobraMinima);
    }
    // cada peça de entrada aparece exatamente uma vez (comparando item e medidas, giradas ou não)
    const assinatura = (a, l, item) => `${item}|${Math.min(a, l)}|${Math.max(a, l)}`;
    const saida = todas.flatMap(ch => ch.pecas).map(p => assinatura(p.altura, p.largura, p.item)).sort();
    const entrada = c.pecas.map(p => assinatura(p.altura, p.largura, p.item)).sort();
    assert.deepEqual(saida, entrada, c.nome);
    for (const g of r.grupos) assert.deepEqual(g.erros, [], c.nome);
  }
});

test('sobras só têm lados >= sobraMinima e não cruzam peças', () => {
  let qtdSobras = 0;
  for (const c of CENARIOS) for (const ch of chapas(rodar(c))) { conferirChapa(ch, c.parametros.serra, c.parametros.sobraMinima); qtdSobras += ch.sobras.length; }
  assert.ok(qtdSobras > 0, 'os cenários precisam gerar alguma sobra para o teste valer');
  // uma peça pequena na chapa: a sobra útil aparece, e com sobra mínima enorme some
  const um = chapas(plano([peca(1000, 1000)]))[0];
  assert.ok(um.sobras.length >= 1);
  const area = um.sobras.reduce((s, x) => s + x.altura * x.largura, 0);
  assert.equal(area, 2400 * 3210 - 1000 * 1000);   // serra 0: chapa = peça + sobras
  assert.deepEqual(chapas(plano([peca(1000, 1000)], { parametros: { serra: 0, sobraMinima: 2500 } }))[0].sobras, []);
});

test('retalho do mesmo produto é usado antes de chapa nova; retalho de outro produto nunca', () => {
  const retalhos = [retalho(7, 2400, 3210, { produtoCodigo: 99 }), retalho(5, 1200, 1600), retalho(6, 1300, 1700)];
  const r = plano([peca(1000, 1500)], { retalhos });
  assert.equal(chapas(r).length, 1);
  assert.equal(chapas(r)[0].tipo, 'retalho');
  assert.equal(chapas(r)[0].retalhoId, 5);   // área crescente: o menor que serve
  assert.deepEqual([chapas(r)[0].altura, chapas(r)[0].largura], [1200, 1600]);
  assert.deepEqual(r.resumo, { qtdChapasNovas: 0, qtdRetalhosUsados: 1, qtdPecas: 1, qtdPecasSemChapa: 0 });
  // só retalho de outro produto: chapa nova
  const outro = plano([peca(1000, 1500)], { retalhos: [retalho(7, 2400, 3210, { produtoCodigo: 99 })] });
  assert.deepEqual(chapas(outro).map(c => c.tipo), ['chapa']);
  assert.equal(chapas(outro)[0].retalhoId, undefined);
});

test('retalho pequeno demais para qualquer peça fica de fora', () => {
  const r = plano([peca(1000, 1500)], { retalhos: [retalho(3, 500, 500)] });
  assert.deepEqual(chapas(r).map(c => c.tipo), ['chapa']);
  assert.equal(r.resumo.qtdRetalhosUsados, 0);
});

test('um retalho não serve a dois grupos do mesmo produto', () => {
  const pecas = [peca(1000, 1500, { modelo: 'Extra Clear', cor: 'Branco' }), peca(1000, 1500, { modelo: 'Extra Clear', cor: 'New York' })];
  const r = plano(pecas, { retalhos: [retalho(5, 1200, 1600)] });
  assert.deepEqual(r.grupos.map(g => g.chave), ['Extra Clear|Branco', 'Extra Clear|New York']);
  assert.deepEqual(r.grupos.map(g => g.chapas.map(c => c.tipo)), [['retalho'], ['chapa']]);
  assert.deepEqual(r.resumo, { qtdChapasNovas: 1, qtdRetalhosUsados: 1, qtdPecas: 2, qtdPecasSemChapa: 0 });
});

test('n. de chapas novas >= teto de área', () => {
  for (const c of CENARIOS.filter(x => !x.retalhos)) {
    const r = rodar(c), ch = (c.chapaDe || (() => INCOLOR))();
    const area = c.pecas.reduce((s, p) => s + p.altura * p.largura, 0);
    assert.ok(r.resumo.qtdChapasNovas >= Math.ceil(area / (ch.altura * ch.largura)), c.nome);
  }
});

test('n. de chapas novas <= nº de peças', () => {
  for (const c of CENARIOS) assert.ok(rodar(c).resumo.qtdChapasNovas <= c.pecas.length, c.nome);
});

test('nunca usa mais chapas novas que a variante por faixas (shelf)', () => {
  for (const c of CENARIOS) {
    const r = rodar(c), ch = (c.chapaDe || (() => INCOLOR))();
    const ret = (c.retalhos || []).map(x => ({ ...x }));
    for (const modo of ['em_pe', 'deitada']) {
      const novas = _internos.melhorPorFaixas(c.pecas, ret, ch, c.parametros, modo);
      assert.ok(r.resumo.qtdChapasNovas <= novas, `${c.nome} (${modo}): ${r.resumo.qtdChapasNovas} > ${novas}`);
    }
  }
});

test('resultado idêntico em duas execuções', () => {
  for (const c of CENARIOS) {
    const copia = JSON.parse(JSON.stringify(c.pecas));
    assert.deepEqual(rodar(c), rodar(c), c.nome);
    assert.deepEqual(c.pecas, copia, `${c.nome}: a entrada não pode ser alterada`);
  }
});

test('grupo sem produto escolhido (chapaDe -> null) fica aguardandoProduto sem erro e sem chapas', () => {
  const pecas = [peca(1000, 1000, { modelo: 'Fumê', cor: '' }), peca(1000, 1000), peca(500, 500)];
  const r = plano(pecas, { chapaDe: chave => (chave === 'Fumê|' ? null : INCOLOR) });
  const fume = r.grupos.find(g => g.chave === 'Fumê|');
  assert.deepEqual(fume, { chave: 'Fumê|', modelo: 'Fumê', cor: '', produtoCodigo: null, produtoNome: null,
    aguardandoProduto: true, chapa: null, chapas: [], erros: [] });
  const inc = r.grupos.find(g => g.chave === 'Incolor 4mm|');
  assert.equal(inc.chapas.flatMap(c => c.pecas).length, 2);
  assert.deepEqual(r.resumo, { qtdChapasNovas: 1, qtdRetalhosUsados: 0, qtdPecas: 3, qtdPecasSemChapa: 1 });
});

test('sem peças: nenhum grupo e resumo zerado; parâmetros ausentes usam o padrão', () => {
  assert.deepEqual(otimizarVidros({ pecas: [], retalhos: [], chapaDe: () => INCOLOR }),
    { grupos: [], resumo: { qtdChapasNovas: 0, qtdRetalhosUsados: 0, qtdPecas: 0, qtdPecasSemChapa: 0 } });
  const r = otimizarVidros({ pecas: [peca(2400, 1605), peca(2400, 1605)], chapaDe: () => INCOLOR });
  assert.equal(r.resumo.qtdChapasNovas, 1);   // serra 0 do padrão
});
