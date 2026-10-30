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

// plano de corte de vidros: mesma ligação (cancela o gerado, solta retalhos; excluir desliga o conferido do número)
function comPlanoDeVidros(banco, numero) {
  const v = { planos: [{ id: 1, pedido: numero, situacao: 'gerado' }, { id: 2, pedido: numero, situacao: 'conferido' }], retalhos: [{ id: 9, situacao: 'reservado', plano_reserva: 1 }] };
  banco.f.regras.unshift(
    [/^SELECT id FROM web_vidro_planos WHERE pedido = ?/, (sql, [n]) => v.planos.filter(p => p.pedido === Number(n) && p.situacao === 'gerado').map(p => ({ id: p.id }))],
    [/^UPDATE web_vidro_retalhos SET situacao = 'disponivel'/, (sql, [, id]) => { v.retalhos.filter(r => r.plano_reserva === id).forEach(r => { r.situacao = 'disponivel'; r.plano_reserva = null; }); return { affectedRows: 1 }; }],
    [/^UPDATE web_vidro_planos SET situacao = 'cancelado'/, (sql, [id]) => { v.planos.find(p => p.id === id).situacao = 'cancelado'; return { affectedRows: 1 }; }],
    [/^UPDATE web_vidro_planos SET excluido_em = ?/, (sql, [agora, n]) => { v.planos.filter(p => p.pedido === Number(n) && p.situacao === 'conferido' && !p.excluido_em).forEach(p => { p.excluido_em = agora; }); return { affectedRows: 1 }; }]);
  return v;
}

test('cancelar pedido libera o plano de vidros e os retalhos reservados, na mesma transação; o conferido fica', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); const v = comPlanoDeVidros(banco, 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5/cancelar', 'POST')).status, 200);
  assert.deepEqual(v.planos.map(p => p.situacao), ['cancelado', 'conferido']);
  assert.equal(v.planos[1].excluido_em, undefined);
  assert.deepEqual(v.retalhos[0], { id: 9, situacao: 'disponivel', plano_reserva: null });
  assert.deepEqual(banco.auditoria.map(a => a.acao).sort(), ['corte_vidros_plano_cancelado_com_pedido', 'pedido_cancelado']);
  const ordem = banco.f.chamadas.map(c => c.sql);
  const iCommit = ordem.lastIndexOf('COMMIT');
  assert.ok(ordem.findIndex(s => /web_vidro_planos SET situacao = 'cancelado'/.test(s)) < iCommit);
});

test('excluir pedido libera o plano de vidros e marca o conferido com excluido_em', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); const v = comPlanoDeVidros(banco, 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5', 'DELETE')).status, 200);
  assert.deepEqual(v.planos.map(p => p.situacao), ['cancelado', 'conferido']);
  assert.ok(v.planos[1].excluido_em);
  assert.equal(v.retalhos[0].situacao, 'disponivel');
});

test('excluir orçamento não mexe no plano de vidros do pedido de mesmo número', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5); comDocumento(banco, 'Orçamento', 5); const v = comPlanoDeVidros(banco, 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Orçamento/5', 'DELETE')).status, 200);
  assert.deepEqual(v.planos.map(p => p.situacao), ['gerado', 'conferido']);
  assert.equal(v.retalhos[0].situacao, 'reservado');
});

test('orçamento: Fechado / Aguardando resposta pela rota própria, auditado; outras situações e pedido não passam', async t => {
  const banco = bancoPedOrc(); comDocumento(banco, 'Orçamento', 6); comDocumento(banco, 'Pedido', 6);
  const { chamar } = await prepararPedOrc(t, { banco });
  let r = await chamar('/ped_orc/orcamentos/6/situacao', 'POST', { situacao: 'Fechado' });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(banco.pedOrc.find(p => p.TIPO === 'Orçamento').SITUACAO, 'Fechado');
  assert.equal(banco.pedOrc.find(p => p.TIPO === 'Pedido').SITUACAO, 'Em Produção'); // o pedido de mesmo número não é tocado
  assert.equal((await chamar('/ped_orc/orcamentos/6/situacao', 'POST', { situacao: 'Fechado' })).status, 409);
  r = await chamar('/ped_orc/orcamentos/6/situacao', 'POST', { situacao: 'Aguardando resposta' });
  assert.equal(r.status, 200);
  assert.equal(banco.pedOrc.find(p => p.TIPO === 'Orçamento').SITUACAO, 'Aguardando resposta');
  assert.deepEqual(banco.auditoria.map(a => a.acao), ['orcamento_situacao', 'orcamento_situacao']);
  assert.equal((await chamar('/ped_orc/orcamentos/6/situacao', 'POST', { situacao: 'Cancelado' })).status, 400);
  assert.equal((await chamar('/ped_orc/orcamentos/6/situacao', 'POST', {})).status, 400);
  assert.equal((await chamar('/ped_orc/orcamentos/99/situacao', 'POST', { situacao: 'Fechado' })).status, 404);
  assert.equal((await chamar('/ped_orc/orcamentos/abc/situacao', 'POST', { situacao: 'Fechado' })).status, 400);
});

test('lista: orçamento Fechado ganha a linha azul clara e o menu tem Fechado / Aguardando resposta', () => {
  const h = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'painel_inicial.html'), 'utf8');
  assert.match(h, /n === 'fechado' \? 'fechado' : 'outro'/);
  assert.match(h, /#orders-tbody tr\.linha-fechada \{ background: #eaf3ff; \}/);
  assert.match(h, /tipoLista === 'Orçamento' && x\.s === 'fechado' \? ' class="linha-fechada"'/);
  assert.ok(h.indexOf('tr.linha-fechada {') < h.indexOf('#orders-tbody tr.ctx'), 'a regra do clique direito vence a da linha fechada');
  assert.match(h, /mudarSituacaoOrcamento\(numero, 'Fechado'\)/);
  assert.match(h, /\/ped_orc\/orcamentos\/\$\{encodeURIComponent\(numero\)\}\/situacao/);
});

test('situação Entregue/Retirado com manterData: a DATA_ENTREGA gravada NÃO muda (o usuário escolheu manter); sem o campo, vira hoje', async t => {
  const { hojeLocal } = require('../rotas/transacao');
  const banco = bancoPedOrc(); comDocumento(banco, 'Pedido', 5, { DATA_ENTREGA: '2026-10-12' });
  const { chamar } = await prepararPedOrc(t, { banco });
  let r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Entregue', manterData: true });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(banco.pedOrc[0].SITUACAO, 'Entregue');
  assert.equal(banco.pedOrc[0].DATA_ENTREGA, '2026-10-12', 'manteve a data');
  assert.equal((await r.json()).dataEntrega, '2026-10-12');
  assert.deepEqual(JSON.parse(banco.auditoria[0].detalhe), { cliente: 'CLIENTE TESTE', de: 'Em Produção', para: 'Entregue', manterData: true });
  // sem manterData (ou diferente de true) continua atualizando para hoje, como o VB
  r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Retirado', manterData: 'true' });
  assert.equal(r.status, 200);
  assert.equal(banco.pedOrc[0].DATA_ENTREGA, hojeLocal());
});

test('janela de escolha da data de entrega: lista e início usam a mesma janela e só enviam manterData quando o usuário escolheu manter', () => {
  const fs = require('node:fs'), path = require('node:path');
  const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const js = ler('escolha_data_entrega.js');
  assert.ok(js.includes('window.EscolhaDataEntrega = { perguntar, dataBR };'));
  assert.ok(js.includes("'hoje'") && js.includes("'manter'") && js.includes('Atualizar a data para hoje'));
  for (const f of ['painel_inicial.html', 'inicio.html']) assert.ok(ler(f).includes('<script src="escolha_data_entrega.js'), f);
  for (const f of ['painel_inicial.html', 'inicio_menu.js']) {
    const t = ler(f);
    assert.ok(t.includes('window.EscolhaDataEntrega.perguntar('), f);
    assert.ok(t.includes("manterData = escolha === 'manter';") && t.includes('...(manterData ? { manterData: true } : {})'), f);
    assert.ok(!t.includes('A data de entrega passa a ser hoje.'), f + ': o aviso fixo saiu');
  }
});
