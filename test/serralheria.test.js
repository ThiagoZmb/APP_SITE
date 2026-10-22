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
