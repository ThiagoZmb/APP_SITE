// Carimbo do conteúdo dos itens (valida os desenhos guardados contra o documento atual).
const test = require('node:test');
const assert = require('node:assert/strict');
const { carimboItens } = require('../calculo/leitura_vb');

const doc = () => ({
  lista: [{ id: 1, ITEM: 1, QTD: 2, TIPO_PRODUTO: 'Porta de giro', DESCRICAO: 'x', UNITARIO: '100.00', TOTAL: '200.00' },
          { id: 2, ITEM: 2, QTD: 1, TIPO_PRODUTO: 'Porta de correr', DESCRICAO: 'y', UNITARIO: '50.00', TOTAL: '50.00' }],
  itensV4: [{ id: 1, ITEM_PEDIDO: 1, ITEM: 1, PORTA: 'Folha 1', ALTURA: 2286, LARGURA: 635, POSICAO_PUXADOR: 'Lateral' },
            { id: 2, ITEM_PEDIDO: 2, ITEM: 1, PORTA: 'Folha 1', ALTURA: 2100, LARGURA: 900, POSICAO_PUXADOR: '' }],
  furacao: [{ id: 1, ITEM: 1, FURO: 1, LADO: 'Direito' }]
});

test('carimbo: 64 hex, também para entrada vazia', () => {
  assert.match(carimboItens(doc()), /^[0-9a-f]{64}$/);
  assert.match(carimboItens({}), /^[0-9a-f]{64}$/);
});

test('carimbo: independe da ordem das linhas, do id e do tipo do número', () => {
  const a = doc();
  const b = doc();
  b.lista.reverse(); b.itensV4.reverse();
  b.lista.forEach(l => { l.id += 100; });
  b.itensV4[0].ALTURA = String(b.itensV4[0].ALTURA);
  assert.equal(carimboItens(a), carimboItens(b));
});

test('carimbo: muda com medida, quantidade, furo e posição do puxador', () => {
  const base = carimboItens(doc());
  for (const mexer of [d => { d.itensV4[0].ALTURA = 2287; }, d => { d.lista[0].QTD = 3; }, d => { d.furacao[0].FURO = 2; },
    d => { d.itensV4[0].POSICAO_PUXADOR = 'Topo'; }, d => { d.lista[1].TIPO_PRODUTO = 'Porta de giro'; }]) {
    const d = doc(); mexer(d);
    assert.notEqual(carimboItens(d), base);
  }
});

test('carimbo: não muda com descrição, valores nem com o resto do documento (cabeçalho, vidros)', () => {
  const base = carimboItens(doc());
  const d = doc();
  d.lista[0].DESCRICAO = 'outra'; d.lista[0].UNITARIO = '999.00'; d.lista[0].TOTAL = '1998.00';
  d.cab = { SITUACAO: 'Pronto', DATA_ENTREGA: '2026-10-27' };
  d.vidros = [{ id: 1, TAMANHO: '1x1' }];
  assert.equal(carimboItens(d), base);
});
