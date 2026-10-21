const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc } = require('./apoio/bancoPedOrc');

test('acessórios permitidos do tipo, em ordem, com preço da regra manual', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await chamar('/ped_orc/acessorios_permitidos?tipo=' + encodeURIComponent('Porta de giro') + '&clienteCodigo=7');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), [{ nome: 'Dobradiça', valorUnitario: 20 }, { nome: 'Fechadura', valorUnitario: 30 }]);
});

test('acessórios: Estoquista não acessa; quem não vê valores não recebe preço', async t => {
  let { chamar } = await prepararPedOrc(t, { perfil: 'Estoquista' });
  assert.equal((await chamar('/ped_orc/acessorios_permitidos?tipo=Porta%20de%20giro')).status, 403);
});

test('acessórios sem valores.ver: só o nome', async t => {
  const { chamar } = await prepararPedOrc(t, { perfil: 'Monta sem valores' });
  const r = await chamar('/ped_orc/acessorios_permitidos?tipo=Porta%20de%20giro&clienteCodigo=7');
  assert.deepEqual(await r.json(), [{ nome: 'Dobradiça' }, { nome: 'Fechadura' }]);
});

test('sistema de correr: config pelo nº de folhas, trilho no vão, desempenador opcional', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await chamar('/ped_orc/sistema_correr?nome=S1&folhas=2&larguraVao=1600&desempenador=0&clienteCodigo=7');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { descontoAltura: 40, temDesempenador: true, acessorios: [
    { nome: 'Trilho Sup', classe: 'Trilho superior', qtd: 2, tamanho: 1600, valorUnitario: 40 },
    { nome: 'Roldana', classe: 'Roldana', qtd: 4, tamanho: 0, valorUnitario: 15 }] });
  const c = await (await chamar('/ped_orc/sistema_correr?nome=S1&folhas=3&larguraVao=2400&desempenador=1&clienteCodigo=7')).json();
  assert.deepEqual(c.acessorios.map(a => [a.nome, a.qtd]), [['Trilho Sup', 1], ['Roldana', 6], ['Desemp', 3]]);
});

test('sistema inexistente → 404', async t => {
  const { chamar } = await prepararPedOrc(t);
  assert.equal((await chamar('/ped_orc/sistema_correr?nome=NADA&folhas=2&larguraVao=1600')).status, 404);
});

test('/calcular_preco soma os acessórios ao item (base = portas + acessórios; unitário = base / folhas)', async t => {
  const { chamar } = await prepararPedOrc(t);
  // folha 1000×500 sem revestimento: perfil 3 m × 100 = 300; 2 folhas = 600 + Dobradiça 20 × 2 = 640 → 320
  const r = await chamar('/calcular_preco', 'POST', { frente: 'Porta de giro', clienteCodigo: 7, altura: 1000, largura: 500, qtd: 2, perfil: 'Perfil P',
    acessorios: [{ nome: 'Dobradiça', qtd: 2, origem: 'MANUAL' }] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.unitario, j.total], [320, 640]);
  assert.deepEqual(j.acessorios, [{ nome: 'Dobradiça', qtd: 2, origem: 'MANUAL', valorUnitario: 20 }]);
});
