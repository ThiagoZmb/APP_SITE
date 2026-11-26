// Chegada reconhecida pela entrada de nota: baixa, desfazer, marca Aguardando e quantidade a caminho no estoque.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararCompras, TODAS, FORN } = require('./apoio/bancoCompras');

const OUTRO = 'OUTRO FORNECEDOR SA';
const HOJE = require('../rotas/transacao').hojeLocal();
const json = async r => { assert.ok(r.ok, r.status + ' ' + await r.clone().text()); return r.json(); };
let n = 0;
async function pedido(chamar, itens = [{ produtoCodigo: 1, quantidade: 20 }], { enviar = true } = {}) {
  const { numero } = await json(await chamar('/pedidos_compra', 'POST', { chave: 'c' + (++n), fornecedor: FORN, itens }));
  if (enviar) await json(await chamar(`/pedidos_compra/${numero}/situacao`, 'POST', { acao: 'enviar' }));
  return numero;
}
const entrada = (chamar, nota, qtds, mudar = {}) => chamar('/estoque/entrada', 'POST',
  { numero: nota, data: HOJE, fornecedor: FORN, itens: qtds.map((qtd, k) => ({ item: k + 1, produtoCodigo: 1, qtd })), ...mudar });
const desfazer = (chamar, nota) => chamar('/estoque/entrada/desfazer', 'POST', { numero: nota, fornecedor: FORN, motivo: 'lançada errada' });
const ver = async (chamar, numero) => json(await chamar('/pedidos_compra/' + numero));

test('chega em parte e depois o resto; desfazer devolve falta e situação', async t => {
  const { banco, chamar } = await prepararCompras(t);
  const p = await pedido(chamar);
  let r = await json(await entrada(chamar, '10', [12]));
  assert.deepEqual(r.pedidosAtualizados, [{ numero: p, situacao: 'parcial' }]);
  assert.equal((await ver(chamar, p)).itens[0].falta, 8);
  assert.equal(banco.estoque[0].AGUARDANDO, 'Aguardando');
  r = await json(await entrada(chamar, '11', [8]));
  assert.deepEqual(r.pedidosAtualizados, [{ numero: p, situacao: 'recebido' }]);
  assert.equal(banco.estoque[0].AGUARDANDO, '');
  await json(await desfazer(chamar, '11'));
  let d = await ver(chamar, p);
  assert.deepEqual([d.situacao, d.itens[0].chegou, d.itens[0].falta], ['parcial', 12, 8]);
  assert.equal(banco.estoque[0].AGUARDANDO, 'Aguardando');
  await json(await desfazer(chamar, '10'));
  d = await ver(chamar, p);
  assert.deepEqual([d.situacao, d.itens[0].chegou], ['enviado', 0]);
  assert.equal(banco.comprasBaixas.length, 0);
});

test('mesmo produto em duas linhas da nota e dois pedidos: o mais antigo primeiro, a sobra é ignorada', async t => {
  const { banco, chamar } = await prepararCompras(t);
  const a = await pedido(chamar, [{ produtoCodigo: 1, quantidade: 5 }]);
  const b = await pedido(chamar, [{ produtoCodigo: 1, quantidade: 5 }]);
  const r = await json(await entrada(chamar, '20', [5, 3]));
  assert.deepEqual(r.pedidosAtualizados, [{ numero: a, situacao: 'recebido' }, { numero: b, situacao: 'parcial' }]);
  await json(await entrada(chamar, '21', [30]));
  assert.equal((await ver(chamar, b)).itens[0].chegou, 5);
  assert.equal(banco.comprasBaixas.reduce((s, x) => s + x.qtd, 0), 10);
});

test('outro fornecedor, nota anterior ao pedido, rascunho e cancelado não recebem', async t => {
  const { banco, chamar } = await prepararCompras(t);
  const enviado = await pedido(chamar);
  const rascunho = await pedido(chamar, undefined, { enviar: false });
  const cancelado = await pedido(chamar);
  await json(await chamar(`/pedidos_compra/${cancelado}/situacao`, 'POST', { acao: 'cancelar' }));
  banco.pedidosCompra[0].criado_em = '2026-11-10 09:00:00';
  await json(await entrada(chamar, '30', [4], { data: '2026-11-09' }));
  await json(await entrada(chamar, '31', [4], { fornecedor: OUTRO, data: HOJE }));
  assert.equal(banco.comprasBaixas.length, 0);
  assert.equal((await ver(chamar, enviado)).situacao, 'enviado');
  assert.equal(banco.estoque[0].AGUARDANDO, 'Aguardando', 'a entrada limpa a marca, mas ainda há pedido a caminho');
  await json(await entrada(chamar, '32', [4], { data: HOJE }));
  assert.equal((await ver(chamar, rascunho)).itens[0].chegou, 0);
  assert.equal((await ver(chamar, cancelado)).itens[0].chegou, 0);
  assert.equal((await ver(chamar, enviado)).itens[0].chegou, 4);
});

test('pedido encerrado continua encerrado quando a entrada é desfeita', async t => {
  const { banco, chamar } = await prepararCompras(t);
  const p = await pedido(chamar);
  await json(await entrada(chamar, '40', [12]));
  await json(await chamar(`/pedidos_compra/${p}/situacao`, 'POST', { acao: 'encerrar' }));
  assert.equal(banco.estoque[0].AGUARDANDO, '');
  await json(await desfazer(chamar, '40'));
  assert.equal((await ver(chamar, p)).situacao, 'encerrado');
  assert.equal(banco.estoque[0].AGUARDANDO, '');
});

test('nota recusada não grava baixa; sem pedido a resposta é a de sempre', async t => {
  const { banco, chamar } = await prepararCompras(t);
  const r = await json(await entrada(chamar, '50', [1]));
  assert.deepEqual(Object.keys(r).sort(), ['codigosAtualizados', 'itens']);
  const p = await pedido(chamar);
  assert.equal((await entrada(chamar, '50', [5])).status, 409);
  assert.equal(banco.comprasBaixas.length, 0);
  assert.equal((await ver(chamar, p)).situacao, 'enviado');
});

test('quem dá entrada não precisa de compras.ver', async t => {
  const preparo = await prepararCompras(t);
  const p = await pedido(preparo.chamar);
  const so = await prepararCompras(t, { banco: preparo.banco, permissoes: TODAS.filter(x => !x.startsWith('compras.')) });
  await json(await entrada(so.chamar, '60', [20]));
  assert.equal(preparo.banco.pedidosCompra.find(x => x.numero === p).situacao, 'recebido');
});

test('GET /estoque mostra a quantidade a caminho só onde houver', async t => {
  const { chamar } = await prepararCompras(t);
  await pedido(chamar);
  const lista = await json(await chamar('/estoque?situacao=Ativo'));
  assert.equal(lista.find(i => i.codigo === 1).aCaminho, 20);
  assert.ok(!('aCaminho' in lista.find(i => i.codigo === 3)));
});
