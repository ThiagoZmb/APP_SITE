// Salvar e excluir cuidam dos desenhos guardados (web_item_desenhos): cópia nos itens sem alteração, renumeração, órfãs e exclusão.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const { carimboItens } = require('../calculo/leitura_vb');

const { pngSolido } = require('./apoio/png');
const png = marca => pngSolido(10 + marca, 20);   // cada item recebe um PNG reconhecível pela "marca" (largura = 10 + marca)

const giro = (mudar = {}) => ({ frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, profundidade: 0, soldas: 0, obs: '',
  furos: { lista: [100, 900], lados: ['Esquerdo', 'Esquerdo'] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: 'Vidro V', corRevest: 'Incolor',
    divisor: '', divH: 0, divV: 0, posicoesFolhas: ['', ''] },
  acessorios: [{ nome: 'Fechadura', qtd: 1, origem: 'MANUAL' }], historico: '', valorTela: 705.08, ...mudar });
const correr = { frente: 'Porta de Correr', qtd: 2, altura: 2100, largura: 1600, obs: '', furos: { lista: [], lados: [] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: '', sistema: 'S1', transpasse: '50', desempenador: false, posicoesFolhas: ['', ''] },
  acessorios: [], historico: '', valorTela: 671 };
const corpo = (mudar = {}) => ({ modo: 'novo', tipo: 'Pedido', clienteCodigo: 7, clienteFinal: 'Fulano', obsGeral: 'obs', descontoPct: 0,
  dataEntrega: '2026-11-05', situacao: 'Em Produção', financeiro: 'A Receber', itens: [giro(), correr], ...mudar });
const comoTela = j => j.itens.map(it => ({ ...it, valorTela: it.valor }));
const atualizar = (aberto, mudar = {}) => corpo({ modo: 'atualizar', numero: aberto.cabecalho.numero, impressao: aberto.impressao, manterData: true, itens: comoTela(aberto), ...mudar });
const carimboAtual = (banco, numero) => carimboItens({
  lista: banco.listaItens.filter(l => l.NUMERO === numero), itensV4: banco.itensV4.filter(l => l.NUMERO === numero), furacao: banco.furacao.filter(l => l.NUMERO === numero) });

// pedido salvo pela web (2 itens), aberto, com PNG enviado para cada item
async function salvoComDesenhos(t, { perfil } = {}) {
  const banco = bancoPedOrc();
  const c = await prepararPedOrc(t, { banco, ...(perfil ? { perfil } : {}) });
  const { numero } = await (await c.chamar('/ped_orc/salvar', 'POST', corpo())).json();
  for (const item of [1, 2]) {
    const r = await c.chamarBruto(`/ped_orc/Pedido/${numero}/desenho/${item}`, 'PUT', png(item), 'image/png');
    assert.equal(r.status, 200);
  }
  const aberto = await (await c.chamar(`/ped_orc/Pedido/${numero}`)).json();
  return { banco, chamar: c.chamar, numero, aberto };
}
const marcas = (banco, numero) => banco.desenhos.filter(d => d.numero === numero).sort((a, b) => a.item - b.item).map(d => [d.item, d.png.readUInt32BE(16) - 10]);

test('atualizar sem mexer nos itens: as imagens continuam, com o carimbo do documento regravado', async t => {
  const { banco, chamar, numero, aberto } = await salvoComDesenhos(t);
  const r = await chamar('/ped_orc/salvar', 'POST', atualizar(aberto));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(marcas(banco, numero), [[1, 1], [2, 2]]);
  assert.ok(banco.desenhos.every(d => d.carimbo === carimboAtual(banco, numero)));
});

test('item removido no meio: a imagem acompanha a renumeração (a do item 2 passa a ser do item 1; não sobra a do item 2)', async t => {
  const { banco, chamar, numero, aberto } = await salvoComDesenhos(t);
  const r = await chamar('/ped_orc/salvar', 'POST', atualizar(aberto, { itens: [comoTela(aberto)[1]] }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(marcas(banco, numero), [[1, 2]]);
});

test('item novo (sem origem) fica sem imagem até o envio; os copiados mantêm a deles', async t => {
  const { banco, chamar, numero, aberto } = await salvoComDesenhos(t);
  const itens = [comoTela(aberto)[0], giro()];   // o 2º é um item novo
  const r = await chamar('/ped_orc/salvar', 'POST', atualizar(aberto, { itens }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(marcas(banco, numero), [[1, 1]]);
});

test('documento alterado pelo VB depois do envio (carimbo velho): a imagem não é copiada', async t => {
  const { banco, chamar, numero } = await salvoComDesenhos(t);
  banco.itensV4.find(l => l.NUMERO === numero).ALTURA = 2222;   // o VB mexeu na medida
  const reaberto = await (await chamar(`/ped_orc/Pedido/${numero}`)).json();
  const r = await chamar('/ped_orc/salvar', 'POST', atualizar(reaberto));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(marcas(banco, numero), []);
});

test('salvar com número novo a partir de um aberto: copia as imagens para o número novo e o original fica', async t => {
  const { banco, chamar, numero, aberto } = await salvoComDesenhos(t);
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ modo: 'novo', origemDocumento: { tipo: 'Pedido', numero }, impressao: aberto.impressao, itens: comoTela(aberto) }));
  const j = await r.json();
  assert.equal(j.numero, numero + 1);
  assert.deepEqual(marcas(banco, numero), [[1, 1], [2, 2]]);
  assert.deepEqual(marcas(banco, numero + 1), [[1, 1], [2, 2]]);
  assert.ok(banco.desenhos.filter(d => d.numero === numero + 1).every(d => d.carimbo === carimboAtual(banco, numero + 1)));
});

test('imagens órfãs de um número reaproveitado são apagadas pelo salvar', async t => {
  const { banco, chamar, numero, aberto } = await salvoComDesenhos(t);
  banco.desenhos.push({ tipo: 'Pedido', numero: numero + 1, item: 5, png: png(9), carimbo: 'x'.repeat(64), criado_em: 'x' });   // sobra de um pedido excluído pelo VB
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ modo: 'novo', origemDocumento: { tipo: 'Pedido', numero }, impressao: aberto.impressao, itens: comoTela(aberto) }));
  assert.equal((await r.json()).numero, numero + 1);
  assert.deepEqual(marcas(banco, numero + 1), [[1, 1], [2, 2]]);
});

test('excluir o pedido apaga as imagens dele (e só as dele)', async t => {
  const { banco, chamar, numero } = await salvoComDesenhos(t);
  banco.desenhos.push({ tipo: 'Pedido', numero: numero + 50, item: 1, png: png(5), carimbo: 'y'.repeat(64), criado_em: 'x' });
  const r = await chamar(`/ped_orc/Pedido/${numero}`, 'DELETE');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(marcas(banco, numero), []);
  assert.equal(banco.desenhos.length, 1);
});
