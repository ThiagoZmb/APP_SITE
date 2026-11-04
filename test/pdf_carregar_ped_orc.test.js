// Dados do PDF do pedido, extraídos de GET /dados_pdf (pdf/carregar_ped_orc.js).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { pngSolido, pngComIdatCorrompido } = require('./apoio/png');
const { carimboItens } = require('../calculo/leitura_vb');
const { carregarCabecalhoPedOrc, carregarCorpoPedOrc } = require('../pdf/carregar_ped_orc');

const CAB = { RAZAO_SOCIAL: 'CLI', CLIENTE_FINAL: 'F', DATA: '2026-10-05', DATA_PRONTO: null, OBS_GERAL: '', SUB_TOTAL: '1', TOTAL: '1', DESCONTO: '0' };
const ITENS = [{ ITEM: 1, QTD: 1 }];
const V4 = [{ ITEM_PEDIDO: 1, ITEM: 1, PORTA: 'Folha 1', ALTURA: 2100, LARGURA: 900 }];

function pool(desenhos = []) {
  return criarPoolFalso([
    [/FROM ped_orc WHERE NUMERO/, [CAB]],
    [/FROM ped_orc_lista_itens/, ITENS],
    [/FROM ped_orc_itens_v4/, V4],
    [/FROM ped_orc_serralheria WHERE/, [{ id: 1 }]],
    [/FROM ped_orc_complementos/, [{ id: 2 }]],
    [/FROM ped_orc_serralheria_complementos/, [{ id: 3 }]],
    [/FROM furacao_pedidos_orcamentos/, []],
    [/SELECT MEDICAO FROM cadastro_clientes/, [{ MEDICAO: 'Cliente mede' }]],
    [/FROM web_item_desenhos/, desenhos]
  ]);
}

test('cabeçalho inexistente devolve null', async () => {
  const p = criarPoolFalso([]);
  assert.equal(await carregarCabecalhoPedOrc(p, '1', 'Pedido'), null);
});

test('cabeçalho existente devolve a primeira linha, com número e tipo como parâmetros', async () => {
  const p = pool();
  assert.deepEqual(await carregarCabecalhoPedOrc(p, '77', 'Pedido'), CAB);
  assert.deepEqual(p.chamadas[0].params, ['77', 'Pedido']);
});

test('corpo devolve as listas e medicao vazia sem producao', async () => {
  const p = pool();
  const r = await carregarCorpoPedOrc(p, { numero: '77', tipo: 'Pedido', cab: CAB, producao: false });
  assert.deepEqual(Object.keys(r).sort(), ['comps', 'compSerr', 'desenhos', 'furos', 'itens', 'medicao', 'serr', 'v4'].sort());
  assert.deepEqual(r.itens, ITENS);
  assert.deepEqual(r.v4, V4);
  assert.equal(r.serr.length, 1);
  assert.equal(r.comps.length, 1);
  assert.equal(r.compSerr.length, 1);
  assert.deepEqual(r.furos, []);
  assert.equal(r.medicao, '');
  assert.ok(!p.chamadas.some(c => /cadastro_clientes/.test(c.sql)));
});

test('com producao a medicao vem do cadastro do cliente', async () => {
  const r = await carregarCorpoPedOrc(pool(), { numero: '77', tipo: 'Pedido', cab: CAB, producao: true });
  assert.equal(r.medicao, 'Cliente mede');
});

test('desenho só entra com carimbo igual e PNG válido', async () => {
  const carimbo = carimboItens({ lista: ITENS, itensV4: V4, furacao: [] });
  const bom = pngSolido(20, 40);
  const r = await carregarCorpoPedOrc(pool([
    { item: 1, png: bom, carimbo },
    { item: 2, png: bom, carimbo: 'outro' },
    { item: 3, png: pngComIdatCorrompido(20, 40), carimbo }
  ]), { numero: '77', tipo: 'Pedido', cab: CAB, producao: false });
  assert.deepEqual(Object.keys(r.desenhos), ['1']);
});

test('erro ao ler os desenhos deixa desenhos vazio sem derrubar', async () => {
  const p = pool();
  const orig = p.execute;
  p.execute = async (sql, params) => { if (/web_item_desenhos/.test(sql)) throw new Error('falha'); return orig(sql, params); };
  const r = await carregarCorpoPedOrc(p, { numero: '77', tipo: 'Pedido', cab: CAB, producao: false });
  assert.deepEqual(r.desenhos, {});
});
