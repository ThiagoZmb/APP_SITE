const test = require('node:test');
const assert = require('node:assert');
const { montarPecasVidro, chaveGrupoVidro, impressaoPecasVidro, normalizar } = require('../calculo/vidro_pecas');

const item = (n, rev = 'Incolor', cor = '') => ({ ITEM_PEDIDO: n, REVESTIMENTO: rev, COR_REVESTIMENTO: cor });
const vidro = (o = {}) => ({ id: 1, MEDICAO: 'M1', ITEM: 1, QTD: 1, MODELO: 'Incolor', COR_REVESTIMENTO: '', TAMANHO: '2645x495', ...o });

test('uma linha com QTD 2 vira 2 peças altura x largura', () => {
  const r = montarPecasVidro({ vidros: [vidro({ QTD: 2 })], itens: [item(1)] });
  assert.strictEqual(r.pendencias.length, 0);
  assert.strictEqual(r.pecas.length, 2);
  for (const p of r.pecas) {
    assert.strictEqual(p.altura, 2645);
    assert.strictEqual(p.largura, 495);
    assert.strictEqual(p.modelo, 'Incolor');
    assert.strictEqual(p.item, 1);
    assert.strictEqual(p.medicao, 'M1');
  }
});

test('cor em branco é válida e agrupa com cor vazia', () => {
  const r = montarPecasVidro({ vidros: [vidro({ COR_REVESTIMENTO: null })], itens: [item(1, 'Incolor', null)] });
  assert.strictEqual(r.pecas.length, 1);
  assert.strictEqual(r.pecas[0].cor, '');
  assert.strictEqual(chaveGrupoVidro(r.pecas[0]), 'Incolor|');
});

test('chave de grupo = modelo|cor', () => {
  assert.strictEqual(chaveGrupoVidro({ modelo: 'Fumê', cor: 'Verde' }), 'Fumê|Verde');
});

test('conferência ignora caixa e espaços', () => {
  const r = montarPecasVidro({ vidros: [vidro({ MODELO: ' incolor  ', COR_REVESTIMENTO: 'VERDE' })], itens: [item(1, 'Incolor', ' verde')] });
  assert.strictEqual(r.pecas.length, 1);
  assert.strictEqual(r.pendencias.length, 0);
});

test('modelo sem correspondência nos itens do Pedido vira pendência e não gera peça', () => {
  const r = montarPecasVidro({ vidros: [vidro({ MODELO: 'Fumê' })], itens: [item(1, 'Incolor')] });
  assert.strictEqual(r.pecas.length, 0);
  assert.strictEqual(r.pendencias.length, 1);
  assert.strictEqual(r.pendencias[0].item, 1);
  assert.strictEqual(r.pendencias[0].modelo, 'Fumê');
  assert.ok(r.pendencias[0].motivo);
});

test('cor diferente nos itens do Pedido vira pendência', () => {
  const r = montarPecasVidro({ vidros: [vidro({ COR_REVESTIMENTO: 'Verde' })], itens: [item(1, 'Incolor', 'Azul')] });
  assert.strictEqual(r.pecas.length, 0);
  assert.strictEqual(r.pendencias.length, 1);
});

test('item que não existe nos itens do Pedido vira pendência', () => {
  const r = montarPecasVidro({ vidros: [vidro({ ITEM: 7 })], itens: [item(1)] });
  assert.strictEqual(r.pecas.length, 0);
  assert.strictEqual(r.pendencias.length, 1);
  assert.strictEqual(r.pendencias[0].item, 7);
});

test('a conferência é dentro do mesmo item (modelo de outro item não vale)', () => {
  const r = montarPecasVidro({ vidros: [vidro({ ITEM: 2 })], itens: [item(1, 'Incolor'), item(2, 'Fumê')] });
  assert.strictEqual(r.pecas.length, 0);
  assert.strictEqual(r.pendencias.length, 1);
});

test('quantidades dos itens não são comparadas', () => {
  const r = montarPecasVidro({ vidros: [vidro({ QTD: 9 })], itens: [{ ...item(1), QTD: 3 }] });
  assert.strictEqual(r.pecas.length, 9);
  assert.strictEqual(r.pendencias.length, 0);
});

test('TAMANHO malformado vira pendência com motivo de tamanho', () => {
  for (const t of ['', 'abc', '0x500', '2645x', null]) {
    const r = montarPecasVidro({ vidros: [vidro({ TAMANHO: t })], itens: [item(1)] });
    assert.strictEqual(r.pecas.length, 0, `tamanho ${JSON.stringify(t)}`);
    assert.strictEqual(r.pendencias.length, 1, `tamanho ${JSON.stringify(t)}`);
    assert.match(r.pendencias[0].motivo, /tamanho/i);
  }
});

test('TAMANHO com X maiúsculo e espaços é aceito; vírgula decimal arredonda', () => {
  const a = montarPecasVidro({ vidros: [vidro({ TAMANHO: '2645X495 ' })], itens: [item(1)] });
  assert.strictEqual(a.pecas.length, 1);
  assert.strictEqual(a.pecas[0].largura, 495);
  const b = montarPecasVidro({ vidros: [vidro({ TAMANHO: '2645,5x495' })], itens: [item(1)] });
  assert.strictEqual(b.pecas[0].altura, 2646);
});

test('QTD 0, 1.5 ou nula vira pendência de quantidade', () => {
  for (const q of [0, 1.5, null]) {
    const r = montarPecasVidro({ vidros: [vidro({ QTD: q })], itens: [item(1)] });
    assert.strictEqual(r.pecas.length, 0, `qtd ${q}`);
    assert.strictEqual(r.pendencias.length, 1, `qtd ${q}`);
    assert.match(r.pendencias[0].motivo, /quantidade/i);
  }
});

test('impressão muda quando uma medida muda e não muda com a ordem das linhas', () => {
  const itens = [item(1)];
  const v1 = vidro({ id: 1, TAMANHO: '2000x500' }), v2 = vidro({ id: 2, TAMANHO: '1000x400' });
  const a = impressaoPecasVidro(montarPecasVidro({ vidros: [v1, v2], itens }).pecas);
  const b = impressaoPecasVidro(montarPecasVidro({ vidros: [v2, v1], itens }).pecas);
  const c = impressaoPecasVidro(montarPecasVidro({ vidros: [v1, { ...v2, TAMANHO: '1000x401' }], itens }).pecas);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test('normalizar: trim, espaços colapsados e minúsculas', () => {
  assert.strictEqual(normalizar('  Vidro   INCOLOR '), 'vidro incolor');
  assert.strictEqual(normalizar(null), '');
});
