// POST /peso/itens: peso dos itens da tela de orçamentos (banco simulado: test/apoio/bancoPedOrc.js + web_pesos em memória).
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const { REGEX_VALOR } = require('../seguranca/valores');

// Perfil P (desconto do vidro 20) · Puxador X (desconto do vidro 10, desconto do perfil 30)
const PESOS = [
  { tipo: 'perfil', produto: 'Perfil P', unidade_peso: 'kg_m', valor: 1.2 },
  { tipo: 'puxador', produto: 'Puxador X', unidade_peso: 'kg_m', valor: 0.5 },
  { tipo: 'vidro', produto: 'Vidro 4mm', unidade_peso: 'kg_m2_mm', valor: 2.5 }
];
function banco(pesos = PESOS) {
  const b = bancoPedOrc();
  b.consultasPeso = 0;
  b.f.regras.unshift([/FROM web_pesos/, () => { b.consultasPeso++; return pesos; }]);
  return b;
}
const giro = (mudar = {}, det = {}) => ({ frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, furos: { lista: [], lados: [] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: 'Puxador X', tamanhoPux: 1500, revestimento: 'Vidro 4mm', corRevest: 'Incolor',
    divisor: '', divH: 0, divV: 0, posicoesFolhas: ['Lateral Esquerda', 'Lateral Esquerda'], ...det }, ...mudar });
const correr = (mudar = {}, det = {}) => ({ frente: 'Porta de Correr', qtd: 2, altura: 2100, largura: 1600, furos: { lista: [], lados: [] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: '', sistema: 'Sem sistema', transpasse: 0, posicoesFolhas: ['', ''], ...det }, ...mudar });
const chamarPeso = (chamar, itens) => chamar('/peso/itens', 'POST', { itens });
const nomes = (v, acc = new Set()) => {
  if (Array.isArray(v)) v.forEach(x => nomes(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); nomes(x, acc); }
  return acc;
};

test('giro com perfil, vidro e puxador: medidas descontadas do vidro e do perfil, quantidade do item', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco() });
  const r = await chamarPeso(chamar, [giro()]);
  assert.equal(r.status, 200);
  const j = await r.json();
  // folha: perfil (2x2000 + 2x(500-30))/1000 = 4,94 m x 1,2 = 5,928 · puxador 1 x 1,5 m x 0,5 = 0,75
  // vidro (2000-40) x (500-40-10) = 1,96 x 0,45 = 0,882 m² x 4 mm x 2,5 = 8,82 · folha 15,498 · 2 portas = 30,996
  assert.deepEqual(j.itens[0], { pesoPorUnidadeKg: 15.498, pesoKg: 30.996, parcial: false, pendencias: [] });
  assert.equal(j.pesoDocumentoKg, 30.996);
  assert.equal(j.parcial, false);
  assert.match(j.observacao, /trilhos/);
});

test('correr com folhas de larguras diferentes: cada folha é uma porta', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco() });
  const j = await (await chamarPeso(chamar, [correr({}, { largurasFolhas: [800, 1000] })])).json();
  // 2 x (2100+800) + 2 x (2100+1000) = 12 m x 1,2 = 14,4 kg
  assert.deepEqual(j.itens[0], { pesoPorUnidadeKg: 7.2, pesoKg: 14.4, parcial: false, pendencias: [] });
  assert.equal(j.pesoDocumentoKg, 14.4);
});

test('correr com sistema: usa o desconto de altura do sistema; sistema inexistente vira null com motivo', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco() });
  const j = await (await chamarPeso(chamar, [correr({}, { sistema: 'S1', transpasse: 50 }), correr({}, { sistema: 'NAO EXISTE' })])).json();
  // folhas 2060 x 825 (como na gravação): 2 x (2060+825) = 5,77 m x 1,2 = 6,924 por folha, 2 folhas
  assert.equal(j.itens[0].pesoKg, 13.848);
  assert.equal(j.itens[1].pesoKg, null);
  assert.match(j.itens[1].motivo, /não encontrado/);
  assert.equal(j.parcial, true);
});

test('peso não cadastrado: pendência e parcial, nunca zero silencioso', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco(PESOS.filter(p => p.tipo !== 'vidro')) });
  const j = await (await chamarPeso(chamar, [giro()])).json();
  const it = j.itens[0];
  assert.equal(it.parcial, true);
  assert.deepEqual(it.pendencias, [{ tipo: 'vidro', produto: 'Vidro 4mm', motivo: 'Peso não cadastrado.' }]);
  assert.equal(it.pesoKg, 13.356); // só perfil + puxador
  assert.equal(j.parcial, true);
});

test('nenhum peso cadastrado: tudo pendência e parcial', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco([]) });
  const j = await (await chamarPeso(chamar, [giro()])).json();
  assert.equal(j.itens[0].parcial, true);
  assert.equal(j.itens[0].pendencias.length, 3);
  assert.equal(j.parcial, true);
});

test('serralheria e avulso: null com motivo, fora do total e sem marcar parcial', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco() });
  const j = await (await chamarPeso(chamar, [{ frente: 'Serralheria', qtd: 1, detalhes: {} }, correr({}, { largurasFolhas: [800, 1000] }), { frente: 'Avulso', qtd: 3, detalhes: {} }])).json();
  for (const i of [0, 2]) {
    assert.deepEqual(j.itens[i], { pesoPorUnidadeKg: null, pesoKg: null, parcial: false, pendencias: null, motivo: 'sem cálculo de peso para este tipo' });
  }
  assert.equal(j.pesoDocumentoKg, 14.4);
  assert.equal(j.parcial, false);
  // só serralheria: sem total
  const so = await (await chamarPeso(chamar, [{ frente: 'Serralheria', qtd: 1 }])).json();
  assert.equal(so.pesoDocumentoKg, null);
  assert.equal(so.parcial, false);
});

test('erro de engenharia e item incompleto viram null com motivo (nunca 500)', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco() });
  const r = await chamarPeso(chamar, [giro({}, { perfil: 'Perfil Inexistente' }), { frente: 'Porta de giro', qtd: 1 }, giro({ qtd: 0 }), null, 'x', { frente: 'Outra coisa', qtd: 1, detalhes: {} }, giro()]);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.itens[0].motivo, /Dados do perfil não encontrados/);
  assert.doesNotMatch(j.itens[0].motivo, /^Item \d/);
  for (let i = 1; i <= 5; i++) { assert.equal(j.itens[i].pesoKg, null, `item ${i}`); assert.ok(j.itens[i].motivo, `motivo ${i}`); }
  assert.equal(j.itens[6].pesoKg, 30.996);
  assert.equal(j.parcial, true);
  assert.equal(j.pesoDocumentoKg, 30.996);
});

test('sem valores.ver e sem pesos.ver ainda funciona; nenhum campo com nome de dinheiro', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco(), perfil: 'Monta sem valores' });
  const r = await chamarPeso(chamar, [giro(), { frente: 'Avulso', qtd: 1 }]);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.itens[0].pesoKg, 30.996);
  assert.equal(j.pesoDocumentoKg, 30.996);
  assert.deepEqual([...nomes(j)].filter(k => REGEX_VALOR.test(k)), []);
});

test('sem orcamentos.criar = 403', async t => {
  const { chamar } = await prepararPedOrc(t, { banco: banco(), perfil: 'Estoquista' });
  assert.equal((await chamarPeso(chamar, [giro()])).status, 403);
});

test('lista vazia, inválida e acima de 100 itens = 400; 100 itens passam; web_pesos lido uma vez', async t => {
  const b = banco();
  const { chamar } = await prepararPedOrc(t, { banco: b });
  assert.equal((await chamarPeso(chamar, [])).status, 400);
  assert.equal((await chamar('/peso/itens', 'POST', { itens: 'x' })).status, 400);
  assert.equal((await chamar('/peso/itens', 'POST', {})).status, 400);
  const curto = { frente: 'Serralheria', qtd: 1 };
  assert.equal((await chamarPeso(chamar, Array(101).fill(curto))).status, 400);
  assert.equal((await chamarPeso(chamar, Array(100).fill(curto))).status, 200);
  b.consultasPeso = 0;
  const j = await (await chamarPeso(chamar, [giro(), giro({ qtd: 1 }), correr()])).json();
  assert.equal(j.itens.length, 3);
  assert.equal(b.consultasPeso, 1);
});

test('a consulta de peso não grava nada (nenhum INSERT/UPDATE/DELETE)', async t => {
  const b = banco();
  const { chamar } = await prepararPedOrc(t, { banco: b });
  await chamarPeso(chamar, [giro(), correr()]);
  assert.deepEqual(b.f.chamadas.filter(c => /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER)/i.test(c.sql)), []);
  assert.equal(b.pedOrc.length, 0);
});
