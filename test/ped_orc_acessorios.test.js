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
    { nome: 'Trilho Sup', classe: 'Trilho superior', qtd: 2, tamanho: 1600, valorTabela: 40, valorUnitario: 64, valorTotal: 128 },
    { nome: 'Roldana', classe: 'Roldana', qtd: 4, tamanho: 0, valorTabela: 15, valorUnitario: 15, valorTotal: 60 }] });
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
  assert.deepEqual(j.acessorios, [{ nome: 'Dobradiça', qtd: 2, tamanho: 0, origem: 'MANUAL', valorTabela: 20, valorUnitario: 20, valorTotal: 40 }]);
});

test('/calcular_preco: QTD editada de acessório do sistema vale (acima ou abaixo da tabela); inválida volta à tabela', async t => {
  const { chamar } = await prepararPedOrc(t);
  const base = { frente: 'Porta de Correr', clienteCodigo: 7, altura: 2100, largura: 1600, qtd: 2, perfil: 'Perfil P',
    detalhes: { sistema: 'S1', transpasse: '50', desempenador: false } };
  const sis = (trilho, roldana) => [{ nome: 'Trilho Sup', qtd: trilho, origem: 'SISTEMA DE CORRER' }, { nome: 'Roldana', qtd: roldana, origem: 'SISTEMA DE CORRER' }];
  const qtds = async acessorios => {
    const r = await chamar('/calcular_preco', 'POST', { ...base, acessorios });
    assert.equal(r.status, 200);
    return (await r.json()).acessorios.map(a => [a.nome, a.qtd, a.valorTotal]);
  };
  const T = n => ['Trilho Sup', n, 40 * n], R = n => ['Roldana', n, 15 * n]; // total = unitário × qtd
  assert.deepEqual(await qtds(sis(2, 4)), [T(2), R(4)]); // tabela: Trilho 2, Roldana 4
  assert.deepEqual(await qtds(sis(3, 6)), [T(3), R(6)]); // editadas acima da tabela (antes o trilho era limitado a 2)
  assert.deepEqual(await qtds(sis(1, 1)), [T(1), R(1)]); // abaixo da tabela
  assert.deepEqual(await qtds(sis(0, 'x')), [T(2), R(4)]); // inválida = tabela
  assert.deepEqual(await qtds(sis(-1, 2.5)), [T(2), R(4)]);
});

test('/calcular_preco somenteAcessorios: preço dos acessórios sem perfil nem medidas da porta', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await chamar('/calcular_preco', 'POST', { frente: 'Porta de giro', clienteCodigo: 7, somenteAcessorios: true,
    acessorios: [{ nome: 'Dobradiça', qtd: 2, origem: 'MANUAL' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { acessorios: [{ nome: 'Dobradiça', qtd: 2, tamanho: 0, origem: 'MANUAL', valorTabela: 20, valorUnitario: 20, valorTotal: 40 }] });
});
