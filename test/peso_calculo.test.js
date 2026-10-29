// Peso das portas (calculo/peso.js): contas feitas à mão, pendências e peso parcial.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pesoFolha, pesoItem, pesoDocumento, espessuraDoNome, montarTabela, validarPeso } = require('../calculo/peso');
const { agruparFolhas } = require('../calculo/engenharia');

const TABELA = montarTabela([
  { tipo: 'perfil', produto: 'Perfil 30', unidadePeso: 'kg_m', kgPorUnidade: 1.2 },
  { tipo: 'perfil', produto: 'Divisor X', unidadePeso: 'kg_m', kgPorUnidade: 0.5 },
  { tipo: 'puxador', produto: 'Puxador A', unidadePeso: 'kg_m', kgPorUnidade: 0.8 },
  { tipo: 'vidro', produto: 'Reflecta Bronze 4mm', unidadePeso: 'kg_m2_mm', kgPorUnidade: 2.5 }
]);
// 2100 x 900: perfil com 2 peças de altura + 2 de largura
const FOLHA = { altura: 2100, largura: 900, perfil: 'Perfil 30', qtdAltura: 2, qtdLargura: 2, puxador: 'Puxador A', qtdPuxador: 1, tamanhoPuxador: 1500,
  revestimento: 'Reflecta Bronze 4mm', divisor: 'Divisor X', qtdDivH: 1, qtdDivV: 1 };

test('espessura vem do nome do vidro; sem "mm" não há espessura', () => {
  assert.equal(espessuraDoNome('Reflecta Bronze 4mm'), 4);
  assert.equal(espessuraDoNome('Incolor 8,5 MM'), 8.5);
  assert.equal(espessuraDoNome('Vidro 10 mm temperado'), 10);
  assert.equal(espessuraDoNome('Espelho Prata'), null);
  assert.equal(espessuraDoNome('Vidro 0mm'), null);
});

test('folha completa: perfil 6 m x 1,2 + puxador 1,5 m x 0,8 + divisores 3 m x 0,5 + vidro 1,89 m² x 4 mm x 2,5', () => {
  const r = pesoFolha(FOLHA, TABELA);
  assert.deepEqual(r.partes, [
    { tipo: 'perfil', produto: 'Perfil 30', kg: 7.2 },
    { tipo: 'puxador', produto: 'Puxador A', kg: 1.2 },
    { tipo: 'perfil', produto: 'Divisor X', kg: 1.5 },
    { tipo: 'vidro', produto: 'Reflecta Bronze 4mm', kg: 18.9 }
  ]);
  assert.equal(r.pesoKg, 28.8);
  assert.equal(r.parcial, false);
  assert.deepEqual(r.pendencias, []);
});

test('medida de perfil já calculada (tamLargura menor por causa do puxador) e arredondamento a 3 casas', () => {
  // 2 x 2000 + 2 x 985 = 5970 mm -> 5,97 m x 1,2 = 7,164 kg
  const r = pesoFolha({ altura: 2000, largura: 1000, perfil: 'Perfil 30', qtdAltura: 2, qtdLargura: 2, tamLargura: 985 }, TABELA);
  assert.equal(r.pesoKg, 7.164);
  // 1,7777 m x 1,2 = 2,13324 -> 2,133
  const t = montarTabela([{ tipo: 'puxador', produto: 'P', unidadePeso: 'kg_m', kgPorUnidade: 1.2 }]);
  assert.equal(pesoFolha({ puxador: 'P', qtdPuxador: 1, tamanhoPuxador: 1777.7 }, t).pesoKg, 2.133);
});

test('sem cadastro vira pendência e peso parcial, nunca zero silencioso', () => {
  const r = pesoFolha(FOLHA, montarTabela([{ tipo: 'perfil', produto: 'Perfil 30', unidadePeso: 'kg_m', kgPorUnidade: 1.2 }]));
  assert.equal(r.pesoKg, 7.2);
  assert.equal(r.parcial, true);
  assert.deepEqual(r.pendencias.map(p => `${p.tipo}:${p.produto}`).sort(), ['perfil:Divisor X', 'puxador:Puxador A', 'vidro:Reflecta Bronze 4mm']);
  assert.ok(r.pendencias.every(p => /não cadastrado/.test(p.motivo)));
  const vazia = pesoFolha(FOLHA, montarTabela([]));
  assert.equal(vazia.pesoKg, 0); assert.equal(vazia.parcial, true); assert.equal(vazia.partes.length, 0);
});

test('vidro sem espessura no nome é pendência (mesmo com cadastro) e unidade errada também', () => {
  const tabela = montarTabela([{ tipo: 'vidro', produto: 'Espelho Prata', unidadePeso: 'kg_m2_mm', kgPorUnidade: 2.5 }, { tipo: 'perfil', produto: 'Perfil 30', unidadePeso: 'kg_un', kgPorUnidade: 3 }]);
  const r = pesoFolha({ altura: 1000, largura: 1000, perfil: 'Perfil 30', qtdAltura: 2, qtdLargura: 2, revestimento: 'Espelho Prata' }, tabela);
  assert.equal(r.pesoKg, 0); assert.equal(r.parcial, true);
  assert.match(r.pendencias.find(p => p.tipo === 'vidro').motivo, /Espessura/);
  assert.match(r.pendencias.find(p => p.tipo === 'perfil').motivo, /kg_un/);
});

test('dados ausentes na folha viram pendência: sem quantidades, sem tamanho de puxador, divisor sem medida, vidro sem altura', () => {
  let r = pesoFolha({ altura: 1000, largura: 500, perfil: 'Perfil 30' }, TABELA);
  assert.equal(r.parcial, true); assert.match(r.pendencias[0].motivo, /Quantidade/);
  r = pesoFolha({ altura: 1000, largura: 500, puxador: 'Puxador A', qtdPuxador: 2 }, TABELA);
  assert.equal(r.parcial, true); assert.match(r.pendencias[0].motivo, /sem tamanho/);
  r = pesoFolha({ largura: 0, altura: 0, divisor: 'Divisor X', qtdDivH: 1 }, TABELA);
  assert.equal(r.parcial, true); assert.match(r.pendencias[0].motivo, /sem tamanho/);
  r = pesoFolha({ altura: 0, largura: 800, revestimento: 'Reflecta Bronze 4mm' }, TABELA);
  assert.equal(r.parcial, true); assert.match(r.pendencias[0].motivo, /sem altura/);
});

test('folha sem perfil/puxador/vidro não tem peso nem pendência; chave do produto ignora caixa e espaços', () => {
  const r = pesoFolha({ altura: 1000, largura: 1000 }, TABELA);
  assert.deepEqual(r, { pesoKg: 0, partes: [], pendencias: [], parcial: false });
  assert.equal(pesoFolha({ altura: 1000, largura: 1000, perfil: '  perfil   30 ', qtdAltura: 1, qtdLargura: 0 }, TABELA).pesoKg, 1.2);
});

test('pesoItem: grupos com QTD multiplicam; folha simples usa qtdPortas; pendências não se repetem', () => {
  const a = { altura: 2000, largura: 1000, perfil: 'Perfil 30', qtdAltura: 2, qtdLargura: 2 }; // 6 m -> 7,2 kg
  const b = { altura: 1000, largura: 500, perfil: 'Perfil 30', qtdAltura: 2, qtdLargura: 2 };  // 3 m -> 3,6 kg
  let r = pesoItem([{ folha: a, qtd: 2 }, { folha: b, qtd: 3 }], null, TABELA);
  assert.equal(r.pesoKg, 25.2); // 14,4 + 10,8
  assert.deepEqual(r.partes, [{ tipo: 'perfil', produto: 'Perfil 30', kg: 25.2 }]);
  r = pesoItem([a], 4, TABELA);
  assert.equal(r.pesoKg, 28.8);
  r = pesoItem([{ folha: { ...a, revestimento: 'Fantasma 4mm' }, qtd: 2 }, { folha: { ...b, revestimento: 'Fantasma 4mm' }, qtd: 1 }], null, TABELA);
  assert.equal(r.parcial, true);
  assert.equal(r.pendencias.length, 1);
  assert.equal(r.pesoKg, 18); // 14,4 + 3,6 só do perfil
});

test('pesoItem aceita a saída de agruparFolhas (folhas iguais viram um grupo)', () => {
  const f = { altura: 2000, largura: 1000, perfil: 'Perfil 30', qtdAltura: 2, qtdLargura: 2, acabPerfil: '', corPerfil: '' };
  const grupos = agruparFolhas([f, { ...f }, { ...f, largura: 500 }]);
  assert.equal(grupos.length, 2);
  // 2 x 7,2 + (2 x 2 + 2 x 0,5) x 1,2 = 14,4 + 6 = 20,4
  assert.equal(pesoItem(grupos, 1, TABELA).pesoKg, 20.4);
});

test('pesoDocumento soma os itens, mostra o peso de cada um e marca parcial com o item da pendência', () => {
  const a = { altura: 2000, largura: 1000, perfil: 'Perfil 30', qtdAltura: 2, qtdLargura: 2 };
  const r = pesoDocumento([
    { item: 1, folhas: [a], qtdPortas: 2 },
    { item: 2, folhas: [{ ...a, puxador: 'Sem Peso', qtdPuxador: 1, tamanhoPuxador: 1000 }], qtdPortas: 1 }
  ], TABELA);
  assert.equal(r.pesoKg, 21.6);
  assert.equal(r.parcial, true);
  assert.deepEqual(r.itens.map(i => [i.item, i.pesoKg, i.parcial]), [[1, 14.4, false], [2, 7.2, true]]);
  assert.deepEqual(r.pendencias.map(p => [p.item, p.produto]), [[2, 'Sem Peso']]);
  assert.deepEqual(pesoDocumento([], TABELA), { pesoKg: 0, partes: [], pendencias: [], parcial: false, itens: [] });
});

test('validarPeso: tipo/unidade, valor > 0 com vírgula ou ponto, recusa milhar e texto', () => {
  const ok = validarPeso({ tipo: 'perfil', produto: ' Perfil 30 ', unidadePeso: 'kg_m', kgPorUnidade: '1,2345' });
  assert.deepEqual(ok, { erros: [], dados: { tipo: 'perfil', produto: 'Perfil 30', unidadePeso: 'kg_m', kgPorUnidade: 1.2345 } });
  assert.equal(validarPeso({ tipo: 'vidro', produto: 'V 4mm', unidadePeso: 'kg_m2_mm', kgPorUnidade: 2.5 }).erros.length, 0);
  assert.equal(validarPeso({ tipo: 'acessorio', produto: 'Fecho', unidadePeso: 'kg_un', kgPorUnidade: '0.3' }).erros.length, 0);
  for (const ruim of [{ tipo: 'x' }, { produto: '' }, { unidadePeso: 'kg_un' }, { unidadePeso: 'g' }, { kgPorUnidade: 0 }, { kgPorUnidade: '-1' }, { kgPorUnidade: 'abc' },
    { kgPorUnidade: '1.234,5' }, { kgPorUnidade: '1.500' }, { produto: 'x'.repeat(191) }, { kgPorUnidade: '' }]) {
    assert.ok(validarPeso({ tipo: 'perfil', produto: 'P', unidadePeso: 'kg_m', kgPorUnidade: 1, ...ruim }).erros.length > 0, JSON.stringify(ruim));
  }
});
