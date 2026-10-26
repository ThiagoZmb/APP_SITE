const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntregas } = require('./apoio/bancoEntregas');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 2)]);

function cenario(banco, entrega = {}) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto' });
  return banco.semear.entrega({ numero: 501, status: 'agendada', tipo: 'retirada', ...entrega });
}
const post = (chamar, id, acao, corpo) => chamar(`/entregas/${id}/${acao}`, 'POST', corpo);
const anexar = (chamar, id, tipo, corpo = JPEG, mime = 'image/jpeg') =>
  chamar(`/entregas/${id}/anexo?tipo=${tipo}`, 'PUT', corpo, { 'Content-Type': mime });
const pendente = (banco, entrega_id, extra = {}) => {
  const a = { id: banco.anexos.length + 1, entrega_id, evento_id: null, tipo: 'foto', mime: 'image/jpeg', dados: JPEG, criado_por: '7', criado_em: '2026-10-26 09:00:00', ...extra };
  banco.anexos.push(a); return a;
};

test('retirada: agendada+retirada vira retirado, grava quem recebeu e dá baixa no pedido', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const foto = pendente(banco, e.id);
  const r = await post(chamar, e.id, 'retirada', { entregueA: '  João da Silva ', anexoIds: [foto.id] });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).entrega.status, 'retirado');
  assert.equal(e.status, 'retirado');
  assert.equal(banco.pedidos[0].SITUACAO, 'Retirado');
  assert.equal(banco.eventos.length, 1);
  assert.equal(banco.eventos[0].tipo, 'retirada');
  assert.equal(banco.eventos[0].entregue_a, 'João da Silva');
  assert.equal(foto.evento_id, banco.eventos[0].id);
  assert.equal(banco.auditoria[0].acao, 'entrega_retirada');
});

test('retirada repetida: 409, um só evento e pedido gravado uma vez', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'Maria' })).status, 200);
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'Maria' })).status, 409);
  assert.equal(banco.eventos.length, 1);
  assert.equal(banco.f.chamadas.filter(c => /^UPDATE ped_orc/.test(c.sql)).length, 1);
});

test('retirada em registro de motorista: 409; sem entregueA: 400', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const m = cenario(banco, { tipo: 'motorista' });
  assert.equal((await post(chamar, m.id, 'retirada', { entregueA: 'Maria' })).status, 409);
  const e = banco.semear.entrega({ numero: 501, id: 2, status: 'agendada', tipo: 'retirada' });
  assert.equal((await post(chamar, e.id, 'retirada', {})).status, 400);
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: '   ' })).status, 400);
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'x'.repeat(191) })).status, 400);
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
});

test('enviada: exige transportadora, grava dados na entrega e não mexe no pedido', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { tipo: 'outro_estado' });
  assert.equal((await post(chamar, e.id, 'enviada', {})).status, 400);
  assert.equal((await post(chamar, e.id, 'enviada', { transportadora: 'TransX', previsao: '2026-02-30' })).status, 400);
  const r = await post(chamar, e.id, 'enviada', { transportadora: 'TransX', rastreio: 'AB123', previsao: '2026-11-10' });
  assert.equal(r.status, 200);
  assert.equal(e.status, 'enviada');
  assert.equal(e.transportadora, 'TransX');
  assert.equal(e.rastreio, 'AB123');
  assert.equal(e.previsao, '2026-11-10');
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
  assert.equal(banco.auditoria.at(-1).acao, 'entrega_enviada');
  assert.equal((await post(chamar, e.id, 'enviada', { transportadora: 'TransX' })).status, 409);
});

test('comprovante: sem anexo 400; com anexo vira entregue e pedido Entregue', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { tipo: 'outro_estado', status: 'enviada' });
  assert.equal((await post(chamar, e.id, 'comprovante', {})).status, 400);
  assert.equal((await post(chamar, e.id, 'comprovante', { anexoIds: [] })).status, 400);
  const foto = pendente(banco, e.id);
  const r = await post(chamar, e.id, 'comprovante', { entregueA: 'Recepção', anexoIds: [foto.id] });
  assert.equal(r.status, 200);
  assert.equal(e.status, 'entregue');
  assert.equal(banco.pedidos[0].SITUACAO, 'Entregue');
  assert.equal(banco.eventos[0].tipo, 'comprovante');
  assert.equal(banco.eventos[0].entregue_a, 'Recepção');
  assert.equal(foto.evento_id, banco.eventos[0].id);
  assert.equal(banco.auditoria[0].acao, 'entrega_comprovante');
});

test('comprovante com anexo inválido: 400 e nada gravado (outra entrega, outro usuário, já vinculado, inexistente, repetido, mais de 3)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { tipo: 'outro_estado', status: 'enviada' });
  const outra = banco.semear.entrega({ numero: 501, id: 2 });
  const deOutraEntrega = pendente(banco, outra.id);
  const deOutroUsuario = pendente(banco, e.id, { criado_por: '8' });
  const jaVinculado = pendente(banco, e.id, { evento_id: 99 });
  const boa = pendente(banco, e.id);
  for (const ids of [[deOutraEntrega.id], [deOutroUsuario.id], [jaVinculado.id], [999], [boa.id, boa.id], [boa.id, deOutraEntrega.id], 'x', [1.5], [boa.id, boa.id + 1, boa.id + 2, boa.id + 3]]) {
    const r = await post(chamar, e.id, 'comprovante', { anexoIds: ids });
    assert.equal(r.status, 400, JSON.stringify(ids));
  }
  assert.equal(e.status, 'enviada');
  assert.equal(banco.eventos.length, 0);
  assert.equal(boa.evento_id, null);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
});

test('falha no UPDATE de ped_orc desfaz tudo: status, evento e vínculo do anexo', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const foto = pendente(banco, e.id);
  banco.regras.unshift([/^UPDATE ped_orc/, () => { throw new Error('falha forçada'); }]);
  const r = await post(chamar, e.id, 'retirada', { entregueA: 'Maria', anexoIds: [foto.id] });
  assert.equal(r.status, 500);
  assert.equal(e.status, 'agendada');
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.auditoria.length, 0);
  assert.equal(foto.evento_id, null);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
});

test('PUT anexo: JPEG válido 201; PNG 201; texto com mime jpeg 400; tipo ruim 400; sem corpo 400; mime não suportado 400', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const r = await anexar(chamar, e.id, 'foto');
  assert.equal(r.status, 201);
  const { anexoId } = await r.json();
  const a = banco.anexos.find(x => x.id === anexoId);
  assert.equal(a.entrega_id, e.id);
  assert.equal(a.evento_id, null);
  assert.equal(a.tipo, 'foto');
  assert.equal(a.mime, 'image/jpeg');
  assert.equal(a.criado_por, '7');
  assert.equal((await anexar(chamar, e.id, 'assinatura', PNG, 'image/png')).status, 201);
  assert.equal((await anexar(chamar, e.id, 'foto', Buffer.from('texto qualquer'))).status, 400);
  assert.equal((await anexar(chamar, e.id, 'documento')).status, 400);
  assert.equal((await anexar(chamar, e.id, 'foto', Buffer.alloc(0))).status, 400);
  assert.equal((await anexar(chamar, e.id, 'foto', JPEG, 'image/gif')).status, 400);
  assert.equal(banco.anexos.length, 2);
});

test('PUT anexo: acima de 1 MB dá 413 em português', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const grande = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]);
  const r = await anexar(chamar, e.id, 'foto', grande);
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /1 MB/);
  assert.equal(banco.anexos.length, 0);
});

test('PUT anexo: entrega inexistente 404, final 409, limite de 10 pendentes 409, sem permissão 403', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  assert.equal((await anexar(chamar, 999, 'foto')).status, 404);
  for (let i = 0; i < 10; i++) assert.equal((await anexar(chamar, e.id, 'foto')).status, 201);
  assert.equal((await anexar(chamar, e.id, 'foto')).status, 409);
  assert.equal(banco.anexos.length, 10);
  const f = banco.semear.entrega({ numero: 501, id: 2, status: 'retirado', tipo: 'retirada' });
  assert.equal((await anexar(chamar, f.id, 'foto')).status, 409);
});

test('PUT anexo e baixa exigem entregas.programar', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Somente ver' });
  const e = cenario(banco);
  assert.equal((await anexar(chamar, e.id, 'foto')).status, 403);
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'Maria' })).status, 403);
  assert.equal((await post(chamar, e.id, 'enviada', { transportadora: 'X' })).status, 403);
  assert.equal((await post(chamar, e.id, 'comprovante', { anexoIds: [1] })).status, 403);
});

test('detalhe traz só metadados dos anexos vinculados; GET anexo devolve o binário', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const vinc = pendente(banco, e.id, { evento_id: 1 });
  const solto = pendente(banco, e.id);
  const outra = banco.semear.entrega({ numero: 501, id: 2 });
  const d = await (await chamar(`/entregas/${e.id}`)).json();
  assert.deepEqual(d.anexos, [{ id: vinc.id, tipo: 'foto', mime: 'image/jpeg', criadoEm: '2026-10-26 09:00:00' }]);
  assert.ok(!JSON.stringify(d).includes(JPEG.toString('base64')));

  const b = await chamar(`/entregas/${e.id}/anexo/${vinc.id}`);
  assert.equal(b.status, 200);
  assert.equal(b.headers.get('content-type'), 'image/jpeg');
  assert.match(b.headers.get('content-disposition'), /^inline/);
  assert.deepEqual(Buffer.from(await b.arrayBuffer()), JPEG);
  assert.equal((await chamar(`/entregas/${outra.id}/anexo/${vinc.id}`)).status, 404);
  assert.equal((await chamar(`/entregas/${e.id}/anexo/${solto.id + 50}`)).status, 404);
});
