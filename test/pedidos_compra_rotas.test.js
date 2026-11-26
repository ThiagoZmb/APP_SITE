const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararCompras, TODAS, FORN } = require('./apoio/bancoCompras');

const corpo = (mudar = {}) => ({ chave: 'k1', fornecedor: FORN, observacao: 'urgente', itens: [{ produtoCodigo: 1, quantidade: 20, porCaixa: 1 }], ...mudar });
const json = async r => { assert.ok(r.ok, r.status + ' ' + await r.clone().text()); return r.json(); };
const sugestao = async chamar => (await json(await chamar('/pedidos_compra/sugestao?fornecedor=' + encodeURIComponent(FORN)))).itens;
const situacao = (chamar, n, acao) => chamar(`/pedidos_compra/${n}/situacao`, 'POST', { acao });

test('criar, enviar e cancelar: marca Aguardando, mostra a caminho e desmarca', async t => {
  const { banco, chamar } = await prepararCompras(t);
  banco.estoque[0].QTD_ESTOQUE = 1; banco.estoque[0].AGUARDANDO = '';
  assert.equal((await sugestao(chamar)).find(i => i.codigo === 1).sugerido, 1);   // mínimo 2, estoque 1
  const { numero } = await json(await chamar('/pedidos_compra', 'POST', corpo()));
  assert.deepEqual([banco.comprasItens[0].nome_produto, banco.comprasItens[0].cod_fornecedor, banco.comprasItens[0].nome_fornecedor, banco.comprasItens[0].unidade, banco.comprasItens[0].qtd],
    ['Perfil Slim', 'PS-01', 'PERFIL SLIM 6M', 'Barra', 20]);
  assert.equal(banco.estoque[0].AGUARDANDO, '', 'rascunho não conta como a caminho');
  assert.equal((await sugestao(chamar)).find(i => i.codigo === 1).aviso, `em rascunho nº ${numero}`);
  assert.deepEqual(await json(await situacao(chamar, numero, 'enviar')), { situacao: 'enviado' });
  assert.equal(banco.estoque[0].AGUARDANDO, 'Aguardando');
  assert.equal(banco.pedidosCompra[0].enviado_por, 'Caio');
  const depois = (await sugestao(chamar)).find(i => i.codigo === 1);
  assert.deepEqual([depois.aCaminho, depois.sugerido, depois.marcado], [20, null, false]);
  assert.deepEqual(await json(await situacao(chamar, numero, 'cancelar')), { situacao: 'cancelado' });
  assert.equal(banco.estoque[0].AGUARDANDO, '');
});

test('lista, detalhe e edição do rascunho', async t => {
  const { banco, chamar } = await prepararCompras(t);
  const { numero } = await json(await chamar('/pedidos_compra', 'POST', corpo()));
  await json(await chamar(`/pedidos_compra/${numero}`, 'PUT', corpo({ observacao: 'novo', itens: [{ produtoCodigo: 3, quantidade: 2, porCaixa: 50 }] })));
  const d = await json(await chamar(`/pedidos_compra/${numero}`));
  assert.deepEqual([d.numero, d.fornecedor, d.situacao, d.observacao], [numero, FORN, 'rascunho', 'novo']);
  assert.deepEqual(d.itens, [{ codigo: 3, produto: 'Parafuso', codFornecedor: 'PAR-100', nomeFornecedor: 'PARAFUSO', unidade: 'Un', qtd: 100, porCaixa: 50, chegou: 0, falta: 100 }]);
  const [l] = await json(await chamar('/pedidos_compra'));
  assert.deepEqual([l.numero, l.situacao, l.qtdItens, l.enviadoEm], [numero, 'rascunho', 1, null]);
  await json(await chamar(`/pedidos_compra/${numero}`, 'DELETE'));
  assert.equal(banco.pedidosCompra.length + banco.comprasItens.length, 0);
  assert.equal((await chamar(`/pedidos_compra/${numero}`)).status, 404);
});

test('tela velha: editar, excluir ou enviar fora da situação dá 409 e nada muda', async t => {
  const { banco, chamar } = await prepararCompras(t);
  const { numero } = await json(await chamar('/pedidos_compra', 'POST', corpo()));
  await json(await situacao(chamar, numero, 'enviar'));
  const antes = JSON.stringify([banco.pedidosCompra, banco.comprasItens]);
  assert.equal((await chamar(`/pedidos_compra/${numero}`, 'PUT', corpo({ observacao: 'x' }))).status, 409);
  assert.equal((await chamar(`/pedidos_compra/${numero}`, 'DELETE')).status, 409);
  assert.equal((await situacao(chamar, numero, 'enviar')).status, 409);
  assert.equal((await situacao(chamar, numero, 'apagar')).status, 409);
  assert.equal((await situacao(chamar, 999, 'enviar')).status, 404);
  assert.equal(JSON.stringify([banco.pedidosCompra, banco.comprasItens]), antes);
});

test('duplo clique em Salvar grava um pedido só', async t => {
  const { banco, chamar } = await prepararCompras(t);
  assert.equal((await chamar('/pedidos_compra', 'POST', corpo())).status, 201);
  assert.equal((await chamar('/pedidos_compra', 'POST', corpo())).status, 409);
  assert.equal(banco.pedidosCompra.length, 1);
  assert.equal(banco.comprasItens.length, 1);
});

test('dados ruins: 400 e nada gravado', async t => {
  const { banco, chamar } = await prepararCompras(t);
  for (const mudar of [{ chave: '' }, { fornecedor: 'NAO EXISTE' }, { itens: [] }, { itens: [{ produtoCodigo: 99, quantidade: 1 }] },
    { itens: [{ produtoCodigo: 1, quantidade: 1 }, { produtoCodigo: 99, quantidade: 1 }] }]) {
    assert.equal((await chamar('/pedidos_compra', 'POST', corpo(mudar))).status, 400, JSON.stringify(mudar));
  }
  assert.equal(banco.pedidosCompra.length + banco.comprasItens.length, 0);
});

test('permissões: sem compras.ver nada; sem compras.criar não grava', async t => {
  const semVer = await prepararCompras(t, { permissoes: TODAS.filter(p => p !== 'compras.ver') });
  for (const c of ['/pedidos_compra', '/pedidos_compra/fornecedores', '/pedidos_compra/sugestao?fornecedor=x', '/pedidos_compra/produtos', '/pedidos_compra/1']) {
    assert.equal((await semVer.chamar(c)).status, 403, c);
  }
  const semCriar = await prepararCompras(t, { permissoes: TODAS.filter(p => p !== 'compras.criar') });
  assert.equal((await semCriar.chamar('/pedidos_compra')).status, 200);
  for (const [c, m, b] of [['/pedidos_compra', 'POST', corpo()], ['/pedidos_compra/1', 'PUT', corpo()], ['/pedidos_compra/1', 'DELETE'], ['/pedidos_compra/1/situacao', 'POST', { acao: 'enviar' }]]) {
    assert.equal((await semCriar.chamar(c, m, b)).status, 403, m + ' ' + c);
  }
});

test('sem valores.ver, chegou e falta chegam intactos', async t => {
  const { chamar } = await prepararCompras(t);   // o usuário de teste não tem valores.ver
  const { numero } = await json(await chamar('/pedidos_compra', 'POST', corpo()));
  const [i] = (await json(await chamar(`/pedidos_compra/${numero}`))).itens;
  assert.deepEqual([i.chegou, i.falta, i.qtd], [0, 20, 20]);
});

test('unidades por caixa: último pedido, senão o fator do XML, senão 1', async t => {
  const { banco, chamar } = await prepararCompras(t);
  const porCaixa = async () => (await json(await chamar('/pedidos_compra/produtos?fornecedor=' + encodeURIComponent(FORN)))).find(p => p.codigo === 3).porCaixa;
  assert.equal(await porCaixa(), 1);
  banco.ligacoes.push({ fornecedor: FORN, cod_fabricante: 'a', produto_codigo: 3, fator: 0.5, atualizado_em: '2026-11-02' },
    { fornecedor: FORN, cod_fabricante: 'b', produto_codigo: 3, fator: 50, atualizado_em: '2026-11-01' });
  assert.equal(await porCaixa(), 50);
  await json(await chamar('/pedidos_compra', 'POST', corpo({ itens: [{ produtoCodigo: 3, quantidade: 1, porCaixa: 100 }] })));
  assert.equal(await porCaixa(), 100);
});

test('fornecedores com a contagem de sugeridos; produtos só ativos', async t => {
  const { banco, chamar } = await prepararCompras(t);
  banco.estoque[0].QTD_ESTOQUE = 1; banco.estoque[0].AGUARDANDO = '';
  assert.deepEqual(await json(await chamar('/pedidos_compra/fornecedores')),
    [{ fornecedor: FORN, qtdSugeridos: 1 }, { fornecedor: 'OUTRO FORNECEDOR SA', qtdSugeridos: 0 }]);
  const p = await json(await chamar('/pedidos_compra/produtos?busca=par'));
  assert.deepEqual(p, [{ codigo: 3, produto: 'Parafuso', unidade: 'Un', qtd: 500, porCaixa: 1 }]);
});
