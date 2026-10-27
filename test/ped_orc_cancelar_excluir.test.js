const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');

// documento mínimo no "banco": cabeçalho + uma linha em cada tabela de itens
function comDocumento(banco, tipo, numero, extra = {}) {
  banco.pedOrc.push({ id: numero, TIPO: tipo, NUMERO: numero, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: tipo === 'Pedido' ? 'Em Produção' : 'Aguardando resposta', TOTAL: 100, ...extra });
  banco.listaItens.push({ id: 1, TIPO: tipo, NUMERO: numero, ITEM: 1 });
  banco.itensV4.push({ ID: 1, TIPO: tipo, NUMERO: numero, ITEM_PEDIDO: 1 });
  if (tipo === 'Pedido') { banco.vidros.push({ id: 1, NUMERO: numero, ITEM: 1 }); banco.perfis.push({ id: 1, NUMERO: numero, ITEM: 1 }); }
}

test('cancelar pedido: situação vira Cancelado, itens ficam e a ação é auditada', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar('/ped_orc/Pedido/5/cancelar', 'POST');
  assert.equal(r.status, 200);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Cancelado');
  assert.equal(banco.listaItens.length, 1);
  assert.equal(banco.auditoria.length, 1);
  assert.equal(banco.auditoria[0].acao, 'pedido_cancelado');
});

test('cancelar: pedido já cancelado → 409; orçamento → 400; inexistente → 404', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5, { SITUACAO: 'Cancelado' }); comDocumento(banco, 'Orçamento', 6);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5/cancelar', 'POST')).status, 409);
  assert.equal((await chamar('/ped_orc/Orçamento/6/cancelar', 'POST')).status, 400);
  assert.equal((await chamar('/ped_orc/Pedido/99/cancelar', 'POST')).status, 404);
  assert.equal(banco.auditoria.length, 0);
});

test('excluir pedido: apaga cabeçalho, itens, vidros e perfis; não mexe em outros documentos', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); comDocumento(banco, 'Pedido', 6); comDocumento(banco, 'Orçamento', 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar('/ped_orc/Pedido/5', 'DELETE');
  assert.equal(r.status, 200);
  assert.deepEqual(banco.pedOrc.map(p => `${p.TIPO}${p.NUMERO}`).sort(), ['Orçamento5', 'Pedido6']);
  assert.deepEqual(banco.listaItens.map(x => `${x.TIPO}${x.NUMERO}`).sort(), ['Orçamento5', 'Pedido6']);
  assert.deepEqual(banco.vidros.map(x => x.NUMERO), [6]);
  assert.deepEqual(banco.perfis.map(x => x.NUMERO), [6]);
  assert.equal(banco.auditoria.at(-1).acao, 'documento_excluido');
});

test('excluir orçamento: não apaga vidros/perfis de um pedido de mesmo número', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); comDocumento(banco, 'Orçamento', 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Orçamento/5', 'DELETE')).status, 200);
  assert.deepEqual(banco.pedOrc.map(p => p.TIPO), ['Pedido']);
  assert.equal(banco.vidros.length, 1);
});

test('excluir/cancelar: sem a permissão → 403; excluir inexistente → 404; tipo inválido → 400', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5);
  const { chamar } = await prepararPedOrc(t, { banco, perfil: 'Interno completo' });
  assert.equal((await chamar('/ped_orc/Pedido/5', 'DELETE')).status, 403);
  assert.equal((await chamar('/ped_orc/Pedido/5/cancelar', 'POST')).status, 403);
  assert.equal(banco.pedOrc.length, 1);
  const { chamar: adm } = await prepararPedOrc(t, { banco });
  assert.equal((await adm('/ped_orc/Pedido/99', 'DELETE')).status, 404);
  assert.equal((await adm('/ped_orc/Outro/5', 'DELETE')).status, 400);
});

test('representante só mexe em documento de cliente do seu estado', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); // cliente do RJ
  const { chamar } = await prepararPedOrc(t, { banco, perfil: 'Representante SP' });
  assert.equal((await chamar('/ped_orc/Pedido/5', 'DELETE')).status, 403);
  assert.equal((await chamar('/ped_orc/Pedido/5/cancelar', 'POST')).status, 403);
  assert.equal(banco.pedOrc.length, 1);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Em Produção');
});

test('situação: Em Produção -> Pronto grava só a situação; Entregue/Retirado gravam DATA_ENTREGA = hoje; sair deles limpa a data; tudo auditado', async t => {
  const { hojeLocal } = require('../rotas/transacao');
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  let r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Pronto' });
  assert.equal(r.status, 200);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Pronto');
  assert.equal(banco.pedOrc[0].DATA_ENTREGA, null);
  r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Entregue' });
  assert.equal(r.status, 200);
  assert.equal(banco.pedOrc[0].DATA_ENTREGA, hojeLocal());
  assert.equal((await r.json()).dataEntrega, hojeLocal());
  r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Retirado' });
  assert.equal(banco.pedOrc[0].SITUACAO, 'Retirado');
  assert.equal(banco.pedOrc[0].DATA_ENTREGA, hojeLocal());
  await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Em Produção' });
  assert.equal(banco.pedOrc[0].SITUACAO, 'Em Produção');
  assert.equal(banco.pedOrc[0].DATA_ENTREGA, null);
  assert.deepEqual(banco.auditoria.map(a => a.acao), ['pedido_situacao', 'pedido_situacao', 'pedido_situacao', 'pedido_situacao']);
  assert.deepEqual(JSON.parse(banco.auditoria[1].detalhe), { cliente: 'CLIENTE TESTE', de: 'Pronto', para: 'Entregue' });
});

test('situação: igual à atual 409; cancelado 409; valor inválido 400; orçamento 400; inexistente 404; itens intactos', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); comDocumento(banco, 'Pedido', 7, { SITUACAO: 'Cancelado' }); comDocumento(banco, 'Orçamento', 6);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Em Produção' })).status, 409);
  assert.equal((await chamar('/ped_orc/Pedido/7/situacao', 'POST', { situacao: 'Pronto' })).status, 409);
  assert.equal((await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Cancelado' })).status, 400); // cancelar tem rota e permissão próprias
  assert.equal((await chamar('/ped_orc/Pedido/5/situacao', 'POST', {})).status, 400);
  assert.equal((await chamar('/ped_orc/Orçamento/6/situacao', 'POST', { situacao: 'Pronto' })).status, 400);
  assert.equal((await chamar('/ped_orc/Pedido/99/situacao', 'POST', { situacao: 'Pronto' })).status, 404);
  assert.equal(banco.pedOrc.find(p => p.NUMERO === 7).SITUACAO, 'Cancelado');
  assert.equal(banco.auditoria.length, 0);
  assert.equal(banco.listaItens.length, 3);
});

test('situação: sem pedidos.situacao → 403 (Interno completo e Vendedor)', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5);
  for (const perfil of ['Interno completo', 'Vendedor']) {
    const { chamar } = await prepararPedOrc(t, { banco, perfil });
    assert.equal((await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Pronto' })).status, 403);
  }
  assert.equal(banco.pedOrc[0].SITUACAO, 'Em Produção');
});

// plano de corte: cancelar ou excluir o pedido cancela o plano gerado e solta os retalhos reservados (mesma transação)
function comPlanoDeCorte(banco, numero) {
  const corte = { planos: [{ id: 1, pedido: numero, situacao: 'gerado' }], retalhos: [{ id: 9, situacao: 'reservado', plano_reserva: 1 }] };
  banco.f.regras.unshift(
    [/^SELECT id FROM web_corte_planos WHERE pedido = \?/, (sql, [n]) => corte.planos.filter(p => p.pedido === Number(n) && p.situacao === 'gerado').map(p => ({ id: p.id }))],
    [/^UPDATE web_retalhos SET situacao = 'disponivel'/, (sql, [, id]) => { corte.retalhos.filter(r => r.plano_reserva === id).forEach(r => { r.situacao = 'disponivel'; r.plano_reserva = null; }); return { affectedRows: 1 }; }],
    [/^UPDATE web_corte_planos SET situacao = 'cancelado'/, (sql, [id]) => { corte.planos.find(p => p.id === id).situacao = 'cancelado'; return { affectedRows: 1 }; }]);
  return corte;
}

test('cancelar pedido libera o plano de corte e os retalhos reservados', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); const corte = comPlanoDeCorte(banco, 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5/cancelar', 'POST')).status, 200);
  assert.equal(corte.planos[0].situacao, 'cancelado');
  assert.deepEqual(corte.retalhos[0], { id: 9, situacao: 'disponivel', plano_reserva: null });
  assert.deepEqual(banco.auditoria.map(a => a.acao).sort(), ['corte_plano_cancelado_com_pedido', 'pedido_cancelado']);
});

test('excluir pedido libera o plano de corte e os retalhos reservados', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); const corte = comPlanoDeCorte(banco, 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5', 'DELETE')).status, 200);
  assert.equal(corte.planos[0].situacao, 'cancelado');
  assert.equal(corte.retalhos[0].situacao, 'disponivel');
});
