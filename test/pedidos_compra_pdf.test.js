const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararCompras, TODAS, FORN } = require('./apoio/bancoCompras');
const { desenharPedidoCompra, novoDocumento, textoQuantidade } = require('../pdf/pedido_compra');

const item = (k, mudar = {}) => ({ codigo: k, produto: 'Casa ' + k, codFornecedor: 'F-' + k, nomeFornecedor: 'Do fornecedor ' + k, unidade: 'un', qtd: 100, porCaixa: 1, ...mudar });
const dados = (itens, mudar = {}) => ({ numero: 12, fornecedor: 'FORN ŁTDA', observacao: 'Entregar pela manhã', criadoEm: '2026-11-20 10:00:00', enviadoEm: null, itens, ...mudar });
function desenhar(d) {
  const doc = novoDocumento(), partes = [];
  doc.on('data', p => partes.push(p));
  let paginas = 1;
  doc.on('pageAdded', () => paginas++);
  const textos = desenharPedidoCompra(doc, d);
  const fim = new Promise(r => doc.on('end', () => r(Buffer.concat(partes))));
  doc.end();
  return { textos, fim, paginas };
}

test('texto da quantidade: avulso, uma caixa, várias caixas', () => {
  assert.equal(textoQuantidade({ qtd: 100, porCaixa: 1, unidade: 'un' }), '100 un');
  assert.equal(textoQuantidade({ qtd: 50, porCaixa: 50, unidade: 'un' }), '1 caixa com 50 (50 un)');
  assert.equal(textoQuantidade({ qtd: 100, porCaixa: 50, unidade: 'un' }), '2 caixas com 50 (100 un)');
  assert.equal(textoQuantidade({ qtd: 3, porCaixa: 1, unidade: '' }), '3');
});

test('conteúdo: número, data, fornecedor, descrição do fornecedor ou da casa, observação e nenhum preço', () => {
  const { textos } = desenhar(dados([item(1, { qtd: 100, porCaixa: 50 }), item(2, { nomeFornecedor: '', codFornecedor: '' })]));
  const t = textos.join('\n');
  for (const s of ['PEDIDO DE COMPRA Nº 12', '20/11/2026', 'Fornecedor: FORN', 'F-1', 'Do fornecedor 1', '2 caixas com 50 (100 un)', 'Casa 2', 'Entregar pela manhã']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('Casa 1'), 'com nome do fornecedor, o da casa não aparece');
  assert.ok(!t.includes('R$') && !/pre[cç]o|valor|total/i.test(t));
});

test('80 itens com nomes enormes: várias páginas, nenhum item perdido, cabeçalho repetido', async () => {
  const longo = 'PERFIL DE ALUMINIO ACABAMENTO ANODIZADO '.repeat(5).slice(0, 190);
  const r = desenhar(dados(Array.from({ length: 80 }, (_, k) => item(k + 1, { nomeFornecedor: longo }))));
  assert.ok(r.paginas > 1);
  for (let k = 1; k <= 80; k++) assert.ok(r.textos.includes('F-' + k), 'F-' + k);
  assert.equal(r.textos.filter(x => x === 'Descrição').length, r.paginas);
  assert.equal((await r.fim).subarray(0, 4).toString(), '%PDF');
});

test('rota: 200 em PDF, 404 e 403', async t => {
  const { chamar } = await prepararCompras(t);
  const { numero } = await (await chamar('/pedidos_compra', 'POST', { chave: 'p', fornecedor: FORN, itens: [{ produtoCodigo: 1, quantidade: 2 }] })).json();
  const r = await chamar(`/pedidos_compra/${numero}/pdf`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), new RegExp(`Pedido_compra_${numero}\\.pdf`));
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  assert.equal((await chamar('/pedidos_compra/999/pdf')).status, 404);
  const so = await prepararCompras(t, { permissoes: TODAS.filter(p => p !== 'compras.ver') });
  assert.equal((await so.chamar(`/pedidos_compra/${numero}/pdf`)).status, 403);
});
