// Orçamento virando Pedido leva os desenhos dos itens que não mudaram (antes o Pedido nascia sem imagem no PDF).
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const { pngSolido } = require('./apoio/png');

const item = () => ({ frente: 'Porta de giro', qtd: 2, altura: 2234, largura: 545, profundidade: 0, soldas: 0, obs: '',
  furos: { lista: [100, 700], lados: ['Esquerdo', 'Esquerdo'] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Inox Escovado', puxador: '', revestimento: 'Vidro V', corRevest: '', divisor: '', divH: 0, divV: 0, posicoesFolhas: ['', ''] },
  acessorios: [], historico: '', valorTela: 1000 });
const corpoOrc = { modo: 'novo', tipo: 'Orçamento', clienteCodigo: 7, clienteFinal: 'Fulano', obsGeral: '', descontoPct: 0, dataEntrega: '2026-11-20', itens: [item()] };

async function orcamentoComDesenho(t) {
  const ctx = await prepararPedOrc(t, { banco: bancoPedOrc() });
  const { numero } = await (await ctx.chamar('/ped_orc/salvar', 'POST', corpoOrc)).json();
  assert.equal((await ctx.chamarBruto(`/ped_orc/Orçamento/${numero}/desenho/1`, 'PUT', pngSolido(33, 20), 'image/png')).status, 200);
  return { ...ctx, numeroOrc: numero };
}
const doPedido = banco => banco.desenhos.filter(d => d.tipo === 'Pedido');

test('virar_pedido (servidor): o Pedido nasce com o desenho do orçamento', async t => {
  const { banco, chamar, numeroOrc } = await orcamentoComDesenho(t);
  const r = await chamar(`/ped_orc/orcamentos/${numeroOrc}/virar_pedido`, 'POST', { dataPronto: '2026-12-01' });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const d = doPedido(banco);
  assert.equal(d.length, 1);
  assert.equal(d[0].item, 1);
  assert.equal(d[0].png.readUInt32BE(16), 33);
});

test('orçamento sem desenho valido (carimbo velho, o VB mexeu): o Pedido não herda imagem desatualizada', async t => {
  const { banco, chamar, numeroOrc } = await orcamentoComDesenho(t);
  banco.itensV4.find(l => l.TIPO === 'Orçamento').ALTURA = 2999;
  const r = await chamar(`/ped_orc/orcamentos/${numeroOrc}/virar_pedido`, 'POST', { dataPronto: '2026-12-01' });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(doPedido(banco).length, 0);
});

test('tela: itens abertos do orçamento com desenhoDe levam a imagem; item editado (sem desenhoDe) não', async t => {
  const { banco, chamar, numeroOrc } = await orcamentoComDesenho(t);
  const base = { ...corpoOrc, tipo: 'Pedido', situacao: 'Em Produção', financeiro: 'A Receber', origemDesenhos: { tipo: 'Orçamento', numero: numeroOrc } };
  const r = await chamar('/ped_orc/salvar', 'POST', { ...base, itens: [{ ...item(), desenhoDe: 1 }, item()] });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(doPedido(banco).map(d => d.item), [1]);
});
