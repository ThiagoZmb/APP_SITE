// Peças de perfil de um pedido (calculo/corte_pecas.js). Funções puras, sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { montarPecas, chaveGrupo, impressaoPecas } = require('../calculo/corte_pecas');

const perfil = (o = {}) => ({ id: 1, ITEM: 1, QTD_PORTAS: 3, PERFIL: 'P100', QTD_ALTURA: 2, TAM_ALTURA: 2100, QTD_LARGURA: 2, TAM_LARGURA: 900,
  PUXADOR: null, QTD_PUXADOR: 0, TAM_PUXADOR: 0, ...o });
const item = (o = {}) => ({ ITEM_PEDIDO: 1, ITEM: 1, QTD: 3, ALTURA: 2100, LARGURA: 900, PERFIL: 'P100', ACABAMENTO_PERFIL: 'Anodizado', COR_PERFIL: 'Natural',
  PUXADOR: null, ACABAMENTO_PUXADOR: null, COR_PUXADOR: null, DIVISOR: null, ACABAMENTO_DIVISOR: null, COR_DIVISOR: null,
  QTD_HORIZONTAL: 0, QTD_VERTICAL: 0, TAM_DIV_HORIZONTAL: 0, TAM_DIV_VERTICAL: 0, ...o });

test('porta: altura e largura são por porta e multiplicam por QTD_PORTAS', () => {
  const { pecas, pendencias } = montarPecas({ perfis: [perfil()], itens: [item()] });
  assert.deepEqual(pendencias, []);
  const alt = pecas.filter(p => p.origem === 'porta-altura'), lar = pecas.filter(p => p.origem === 'porta-largura');
  assert.equal(alt.length, 6);
  assert.equal(lar.length, 6);
  assert.ok(alt.every(p => p.tamanho === 2100 && p.perfil === 'P100' && p.acabamento === 'Anodizado' && p.cor === 'Natural' && p.item === 1));
  assert.ok(lar.every(p => p.tamanho === 900));
});

test('QTD_ALTURA 0 não gera peça de altura', () => {
  const { pecas } = montarPecas({ perfis: [perfil({ QTD_ALTURA: 0, TAM_ALTURA: 0 })], itens: [item()] });
  assert.equal(pecas.filter(p => p.origem === 'porta-altura').length, 0);
  assert.equal(pecas.filter(p => p.origem === 'porta-largura').length, 6);
});

test('puxador: QTD_PUXADOR por porta, com acabamento e cor do puxador', () => {
  const { pecas } = montarPecas({
    perfis: [perfil({ PUXADOR: 'PX1', QTD_PUXADOR: 1, TAM_PUXADOR: 1500 })],
    itens: [item({ PUXADOR: 'PX1', ACABAMENTO_PUXADOR: 'Anodizado', COR_PUXADOR: 'Preto' })]
  });
  const px = pecas.filter(p => p.origem === 'puxador');
  assert.equal(px.length, 3);
  assert.ok(px.every(p => p.perfil === 'PX1' && p.tamanho === 1500 && p.cor === 'Preto' && p.acabamento === 'Anodizado'));
});

test('puxador com quantidade mas sem tamanho vira pendência', () => {
  const { pecas, pendencias } = montarPecas({
    perfis: [perfil({ PUXADOR: 'PX1', QTD_PUXADOR: 1, TAM_PUXADOR: 0 })],
    itens: [item({ PUXADOR: 'PX1', ACABAMENTO_PUXADOR: 'A', COR_PUXADOR: 'B' })]
  });
  assert.equal(pecas.filter(p => p.origem === 'puxador').length, 0);
  assert.equal(pendencias.length, 1);
  assert.match(pendencias[0].motivo, /puxador/i);
});

test('divisor: horizontais e verticais × QTD das portas, com acabamento e cor do divisor', () => {
  const { pecas } = montarPecas({
    perfis: [perfil()],
    itens: [item({ DIVISOR: 'DV1', ACABAMENTO_DIVISOR: 'Anodizado', COR_DIVISOR: 'Bronze', QTD_HORIZONTAL: 1, TAM_DIV_HORIZONTAL: 900, QTD_VERTICAL: 2, TAM_DIV_VERTICAL: 2100 })]
  });
  const dv = pecas.filter(p => p.origem === 'divisor');
  assert.equal(dv.length, 3 * (1 + 2));
  assert.equal(dv.filter(p => p.tamanho === 900).length, 3);
  assert.equal(dv.filter(p => p.tamanho === 2100).length, 6);
  assert.ok(dv.every(p => p.perfil === 'DV1' && p.cor === 'Bronze'));
});

test('dois grupos do mesmo item ligam acabamento/cor pela ordem das linhas', () => {
  const { pecas, pendencias } = montarPecas({
    perfis: [perfil({ id: 1, QTD_PORTAS: 1, TAM_ALTURA: 2000 }), perfil({ id: 2, QTD_PORTAS: 1, TAM_ALTURA: 2200 })],
    itens: [item({ ITEM: 1, QTD: 1, COR_PERFIL: 'Natural' }), item({ ITEM: 2, QTD: 1, COR_PERFIL: 'Preto' })]
  });
  assert.deepEqual(pendencias, []);
  assert.ok(pecas.filter(p => p.tamanho === 2000).every(p => p.cor === 'Natural'));
  assert.ok(pecas.filter(p => p.tamanho === 2200).every(p => p.cor === 'Preto'));
});

test('tamanho nulo, zero ou negativo vira pendência e a peça não entra', () => {
  for (const tam of [null, 0, -5]) {
    const { pecas, pendencias } = montarPecas({ perfis: [perfil({ TAM_ALTURA: tam })], itens: [item()] });
    assert.equal(pecas.filter(p => p.origem === 'porta-altura').length, 0, `tam ${tam}`);
    assert.equal(pendencias.length, 1, `tam ${tam}`);
    assert.equal(pendencias[0].item, 1);
    assert.equal(pendencias[0].perfil, 'P100');
  }
});

test('item sem acabamento ou sem cor: pendência e nenhuma peça desse perfil entra', () => {
  for (const campo of ['ACABAMENTO_PERFIL', 'COR_PERFIL']) {
    for (const vazio of [null, '', '  ']) {
      const { pecas, pendencias } = montarPecas({ perfis: [perfil()], itens: [item({ [campo]: vazio })] });
      assert.equal(pecas.length, 0, `${campo}=${JSON.stringify(vazio)}`);
      assert.ok(pendencias.length >= 1);
    }
  }
});

test('contagens de perfis e de itens que não batem: item inteiro vira pendência', () => {
  const { pecas, pendencias } = montarPecas({ perfis: [perfil({ id: 1 }), perfil({ id: 2 })], itens: [item()] });
  assert.equal(pecas.length, 0);
  assert.equal(pendencias.length, 1);
  assert.match(pendencias[0].motivo, /acabamento|cor|ligar/i);
});

test('pedido sem perfis (antigo): lista vazia e sem pendências', () => {
  assert.deepEqual(montarPecas({ perfis: [], itens: [item()] }), { pecas: [], pendencias: [] });
  assert.deepEqual(montarPecas({ perfis: [], itens: [] }), { pecas: [], pendencias: [] });
});

test('chaveGrupo junta perfil, acabamento e cor', () => {
  assert.equal(chaveGrupo({ perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural' }), 'P100|Anodizado|Natural');
});

test('impressaoPecas: igual em outra ordem, diferente se um tamanho muda', () => {
  const a = { perfil: 'P', acabamento: 'A', cor: 'C', tamanho: 100, item: 1, origem: 'porta-altura' };
  const b = { ...a, tamanho: 200 }, c = { ...a, tamanho: 101 };
  assert.equal(impressaoPecas([a, b]), impressaoPecas([b, a]));
  assert.notEqual(impressaoPecas([a, b]), impressaoPecas([a, c]));
  assert.match(impressaoPecas([a]), /^[0-9a-f]{64}$/);
});

// ---- revisão final: dados do VB que não podem enganar o plano ----
test('perfis de OUTRO documento (orçamento de mesmo número): perfil, quantidade ou puxador diferentes viram pendência, nunca peças', () => {
  for (const [p, i] of [[{ PERFIL: 'P100' }, { PERFIL: 'P200' }], [{ QTD_PORTAS: 3 }, { QTD: 2 }], [{ PUXADOR: 'PX1', QTD_PUXADOR: 1, TAM_PUXADOR: 1500 }, { PUXADOR: null }]]) {
    const { pecas, pendencias } = montarPecas({ perfis: [perfil(p)], itens: [item(i)] });
    assert.equal(pecas.length, 0, JSON.stringify([p, i]));
    assert.equal(pendencias.length, 1, JSON.stringify([p, i]));
    assert.match(pendencias[0].motivo, /não conferem|ligar/i);
  }
});

test('divisor: a medida gravada só vale se bate com a porta (horizontal = largura, vertical = altura)', () => {
  const div = o => item({ DIVISOR: 'DV1', ACABAMENTO_DIVISOR: 'A', COR_DIVISOR: 'B', ...o });
  const ok = montarPecas({ perfis: [perfil()], itens: [div({ QTD_HORIZONTAL: 1, TAM_DIV_HORIZONTAL: 900, QTD_VERTICAL: 1, TAM_DIV_VERTICAL: 2100 })] });
  assert.equal(ok.pecas.filter(p => p.origem === 'divisor').length, 6);
  assert.deepEqual(ok.pendencias, []);
  // H e V trocados (o VB recarrega invertido): nenhuma peça de divisor, uma pendência por medida
  const troca = montarPecas({ perfis: [perfil()], itens: [div({ QTD_HORIZONTAL: 1, TAM_DIV_HORIZONTAL: 2100, QTD_VERTICAL: 1, TAM_DIV_VERTICAL: 900 })] });
  assert.equal(troca.pecas.filter(p => p.origem === 'divisor').length, 0);
  assert.equal(troca.pendencias.length, 2);
  assert.match(troca.pendencias[0].motivo, /divisor/i);
});
