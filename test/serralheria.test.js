const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');

// Metalon 20 a 30/m · altura 1000 × 2 barras + largura 500 × 3 barras = 3,5 m → 105 (peça)
// complementos (frmSerralheria: somados ao total, sem o desconto do cliente): Fechadura 10 × 2 = 20 → 125
const serr = (mudar = {}) => ({ frente: 'Serralheria', qtd: 1, altura: 1000, largura: 500, profundidade: 0, qtdAltura: 2, qtdLargura: 3, qtdProfundidade: 1,
  soldas: 0, obs: 'soldar bem', furos: { lista: [], lados: [] }, detalhes: { produto: 'Grade', material: 'Metalon 20', acabSerr: '', corSerr: '' },
  complementos: [{ id: 11, qtd: 2 }], acessorios: [], historico: '', valorTela: 125, ...mudar });
const corpo = (mudar = {}) => ({ modo: 'novo', tipo: 'Orçamento', clienteCodigo: 7, clienteFinal: '', obsGeral: '', descontoPct: 0, itens: [serr()], ...mudar });
const preco = (chamar, mudar = {}) => chamar('/calcular_preco', 'POST', { frente: 'Serralheria', clienteCodigo: 7, produto: 'Grade', material: 'Metalon 20', acabamento: '',
  altura: 1000, largura: 500, profundidade: 0, qtdAltura: 2, qtdLargura: 3, qtdProfundidade: 1, soldas: 0, qtd: 1, ...mudar });

test('componentes do produto (serralheria_modelos_componentes); "Produto editável" lista todos', async t => {
  const { chamar } = await prepararPedOrc(t);
  assert.deepEqual(await (await chamar('/ped_orc/serralheria_componentes?produto=Grade')).json(), [
    { id: 11, tipo: 'Fechadura', descricao: 'Fechadura tetra', unidade: 'UN', valorUnitario: 10 },
    { id: 12, tipo: 'Pintura', descricao: 'Pintura eletrostática', unidade: 'M2', valorUnitario: 25.5 }]);
  const todos = await (await chamar('/ped_orc/serralheria_componentes?produto=' + encodeURIComponent('Produto editável'))).json();
  assert.deepEqual(todos.map(c => c.id), [11, 12, 13]);
});

test('preço: barras por eixo na metragem e complementos com o valor do cadastro (o do navegador é ignorado)', async t => {
  const { chamar } = await prepararPedOrc(t);
  const j = await (await preco(chamar, { complementos: [{ id: 11, qtd: 2, valorUnitario: 999 }] })).json();
  assert.deepEqual([j.unitario, j.total], [125, 125]);
  assert.deepEqual(j.complementos, [{ id: 11, tipo: 'Fechadura', descricao: 'Fechadura tetra', unidade: 'UN', qtd: 2, valorUnitario: 10, valorTotal: 20 }]);
  const sem = await (await preco(chamar)).json();
  assert.deepEqual([sem.unitario, sem.total], [105, 105]);
});

test('desconto do cliente vale para as peças, não para os complementos', async t => {
  const banco = bancoPedOrc();
  banco.clientes[0].DESCONTO = 10;
  const { chamar } = await prepararPedOrc(t, { banco });
  const j = await (await preco(chamar, { complementos: [{ id: 11, qtd: 2 }] })).json();
  assert.equal(j.total, 114.5); // 105 × 0,9 + 20
});

test('complemento de outro produto é recusado', async t => {
  const { chamar } = await prepararPedOrc(t);
  assert.equal((await preco(chamar, { complementos: [{ id: 13, qtd: 1 }] })).status, 400);
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ itens: [serr({ complementos: [{ id: 13, qtd: 1 }] })] }));
  assert.equal(r.status, 422);
});

test('gravação: qtd por eixo na serralheria e complementos com a % do item', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ itens: [serr({ historico: '+10', valorTela: 137.5 })] }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const s = banco.serralheria[0];
  assert.deepEqual([s.QTD_ALTURA, s.QTD_LARGURA, s.QTD_PROFUNDIDADE, s.UNITARIO, s.TOTAL], [2, 3, 1, 115.5, 115.5]);
  assert.deepEqual(banco.serralheriaComp.map(c => [c.ITEM_PEDIDO, c.ITEM_SERRALHERIA, c.SUB_ITEM, c.TIPO_COMPONENTE, c.DESCRICAO, c.UNIDADE, c.QUANTIDADE, c.VALOR_UNITARIO, c.VALOR_TOTAL]),
    [[1, 1, 1, 'Fechadura', 'Fechadura tetra', 'UN', 2, 11, 22]]);
  assert.deepEqual([banco.listaItens[0].UNITARIO, banco.listaItens[0].TOTAL], [137.5, 137.5]);
});

test('reabrir: serralheria com barras por eixo e complementos abre para editar e regrava igual', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const { numero } = await (await chamar('/ped_orc/salvar', 'POST', corpo())).json();
  const aberto = await (await chamar(`/ped_orc/${encodeURIComponent('Orçamento')}/${numero}`)).json();
  const [it] = aberto.itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual([it.qtdAltura, it.qtdLargura, it.qtdProfundidade, it.valor], [2, 3, 1, 125]);
  assert.deepEqual(it.complementos.map(c => [c.id, c.qtd]), [[11, 2]]);
  const semId = r => Object.fromEntries(Object.entries(r).filter(([k]) => !['id', 'ID', 'DATA'].includes(k)));
  const antes = ['serralheria', 'serralheriaComp', 'listaItens'].map(t => banco[t].map(semId));
  // editado: passa pelo motor de novo e precisa gravar o mesmo
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ modo: 'atualizar', numero, impressao: aberto.impressao, manterData: true,
    itens: [{ ...it, valorTela: it.valor, origem: { ...it.origem, estado: 'editado' } }] }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(['serralheria', 'serralheriaComp', 'listaItens'].map(t => banco[t].map(semId)), antes);
});

// ---------- conjunto com várias peças (frmSerralheria: lista de itens → uma linha no pedido) ----------
// peça 1: Metalon 20 — 1000 × 2 + 500 × 3 = 3,5 m × 30 = 105 + 10 soldas × 2 = 125
// peça 2: Cantoneira — 2000 × 1 = 2 m × 20 = 40 + 20 soldas × 2 = 80 → peças 205 + Fechadura 10 × 2 = 20 → 225
const pecas = () => [
  { produto: 'Grade', material: 'Metalon 20', acabSerr: '', corSerr: '', altura: 1000, largura: 500, profundidade: 0, qtdAltura: 2, qtdLargura: 3, qtdProfundidade: 1, soldas: 10 },
  { produto: 'Grade', material: 'Cantoneira', acabSerr: '', corSerr: 'Preto', altura: 2000, largura: 0, profundidade: 0, qtdAltura: 1, qtdLargura: 1, qtdProfundidade: 1, soldas: 20 }];

test('conjunto: preço soma as peças e os complementos; devolve o valor de cada peça', async t => {
  const { chamar } = await prepararPedOrc(t);
  const j = await (await preco(chamar, { pecas: pecas(), complementos: [{ id: 11, qtd: 2 }] })).json();
  assert.deepEqual([j.unitario, j.total], [225, 225]);
  assert.deepEqual(j.pecas.map(p => p.total), [125, 80]);
  const dois = await (await preco(chamar, { pecas: pecas(), complementos: [{ id: 11, qtd: 2 }], qtd: 2 })).json();
  assert.deepEqual([dois.total, dois.unitario, dois.pecas.map(p => p.total)], [430, 215, [250, 160]]);
  assert.equal((await preco(chamar, { pecas: [] , produto: '', material: '' })).status, 400);
});

test('conjunto: grava uma linha no pedido e uma linha por peça (ITEM 1, 2…), e reabre igual', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const item = serr({ pecas: pecas(), valorTela: 225, detalhes: { produto: 'Grade', material: 'Metalon 20', acabSerr: '', corSerr: '' } });
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ itens: [item] }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(banco.listaItens.length, 1);
  assert.deepEqual([banco.listaItens[0].PRODUTO, banco.listaItens[0].QTD, banco.listaItens[0].UNITARIO, banco.listaItens[0].TOTAL], ['Grade', 1, 225, 225]);
  assert.deepEqual(banco.serralheria.map(s => [s.ITEM_PEDIDO, s.ITEM, s.QTD_ITENS, s.PRODUTO, s.MATERIAL, s.COR, s.ALTURA, s.QTD_ALTURA, s.QTD_SOLDAS, s.UNITARIO, s.TOTAL]),
    [[1, 1, 1, 'Grade', 'Metalon 20', '', 1000, 2, 10, 125, 125], [1, 2, 1, 'Grade', 'Cantoneira', 'Preto', 2000, 1, 20, 80, 80]]);
  assert.equal(banco.serralheriaComp.length, 1);
  const { numero } = await r.json();
  const aberto = await (await chamar(`/ped_orc/${encodeURIComponent('Orçamento')}/${numero}`)).json();
  const [it] = aberto.itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual(it.pecas.map(p => [p.material, p.soldas]), [['Metalon 20', 10], ['Cantoneira', 20]]);
  assert.equal(it.valor, 225);
  const semId = x => Object.fromEntries(Object.entries(x).filter(([k]) => !['id', 'ID', 'DATA'].includes(k)));
  const antes = ['serralheria', 'serralheriaComp', 'listaItens'].map(t => banco[t].map(semId));
  const r2 = await chamar('/ped_orc/salvar', 'POST', corpo({ modo: 'atualizar', numero, impressao: aberto.impressao, manterData: true,
    itens: [{ ...it, valorTela: it.valor, origem: { ...it.origem, estado: 'editado' } }] }));
  assert.equal(r2.status, 200, JSON.stringify(await r2.clone().json()));
  assert.deepEqual(['serralheria', 'serralheriaComp', 'listaItens'].map(t => banco[t].map(semId)), antes);
});

test('conjunto: peça sem material é recusada com o nº da peça', async t => {
  const { chamar } = await prepararPedOrc(t);
  const ps = pecas(); ps[1].material = '';
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ itens: [serr({ pecas: ps })] }));
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /peça 2/i);
});

test('desconto adicional (variável) vale também para cliente com desconto de tabela FIXO já aplicado nos itens', async t => {
  const banco = bancoPedOrc();
  Object.assign(banco.clientes[0], { TIPO_DESCONTO: 'Desconto fixo', DESCONTO: 10 });
  const { chamar } = await prepararPedOrc(t, { banco });
  // peça 105 × 0,9 (desconto do cliente) + complemento 20 = 114,5; adicional de 5% no fechamento
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ descontoPct: 5, itens: [serr({ valorTela: 114.5 })] }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const cab = banco.pedOrc[0];
  assert.deepEqual([cab.SUB_TOTAL, cab.DESCONTO, cab.TOTAL], [114.5, 5, 108.78]);
});

test('ponta a ponta: o corpo exatamente como a tela de orçamento envia (2 peças) é gravado', async t => {
  // capturado do orcamentos.html (testes_ui/orcamento_serralheria): Metalon 20 1000×500 10 soldas + Cantoneira 2000 20 soldas
  const corpoTela = JSON.parse(JSON.stringify(require('./apoio/corpo_serralheria_tela.json')));
  // o valor da tela veio do preço simulado do teste de tela; com este banco: 1,5 m × 30 + 10 soldas × 2 = 65; 2 m × 20 + 20 × 2 = 80
  corpoTela.itens[0].valorTela = 145; corpoTela.totalTela = 145;
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await chamar('/ped_orc/salvar', 'POST', corpoTela);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(banco.serralheria.map(s => [s.ITEM, s.MATERIAL, s.QTD_SOLDAS, s.UNITARIO]), [[1, 'Metalon 20', 10, 65], [2, 'Cantoneira', 20, 80]]);
  assert.deepEqual([banco.listaItens[0].UNITARIO, banco.listaItens[0].TOTAL], [145, 145]);
});
