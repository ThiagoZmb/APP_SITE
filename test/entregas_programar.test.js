const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntregas } = require('./apoio/bancoEntregas');

const ENDERECO = { rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Niterói', uf: 'rj', cep: '24000-000', ref: 'Portão azul' };

function cenario(banco, entrega = {}) {
  banco.semear.cliente({ ENDERECO: 'Rua do Cliente', NUMERO: '99', BAIRRO: 'Icaraí', CEP: '24220-000', TELEFONE: '21999990000' });
  banco.semear.pedido({ NUMERO: 501 });
  return banco.semear.entrega({ numero: 501, ...entrega });
}
const post = (chamar, id, acao, corpo) => chamar(`/entregas/${id}/${acao}`, 'POST', corpo);

test('agendar a_programar como motorista: status agendada, data, motorista, evento e auditoria', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const r = await post(chamar, e.id, 'agendar', { tipo: 'motorista', dataAgendada: '2026-11-05', motoristaCodigo: 21, observacao: 'Ligar antes' });
  assert.equal(r.status, 200);
  const { entrega } = await r.json();
  assert.equal(entrega.status, 'agendada');
  assert.equal(entrega.tipo, 'motorista');
  assert.equal(entrega.dataAgendada, '2026-11-05');
  assert.equal(entrega.motoristaCodigo, 21);
  assert.equal(e.status, 'agendada');
  assert.equal(e.data_agendada, '2026-11-05');
  assert.equal(e.motorista_codigo, 21);
  assert.equal(e.observacao, 'Ligar antes');
  assert.equal(banco.eventos.length, 1);
  assert.equal(banco.eventos[0].tipo, 'agendada');
  assert.equal(banco.eventos[0].usuario, 'Caio');
  assert.equal(banco.auditoria.length, 1);
  assert.equal(banco.auditoria[0].acao, 'entrega_agendada');
  assert.equal(banco.auditoria[0].alvo, '501');
  assert.equal(banco.auditoria[0].quem, 'Caio');
});

test('agendar sem endereço é válido e grava o endereço quando vem (UF em maiúsculas)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'retirada', dataAgendada: '2026-11-05' })).status, 200);
  assert.equal(e.endereco_rua, null);
  assert.equal(e.motorista_codigo, null);

  const f = banco.semear.entrega({ numero: 501, id: 2 });
  const r = await post(chamar, f.id, 'agendar', { tipo: 'outro_estado', dataAgendada: '2026-11-06', endereco: ENDERECO, transportadora: 'TransX', rastreio: 'AB123', previsao: '2026-11-10' });
  assert.equal(r.status, 200);
  assert.equal(f.endereco_uf, 'RJ');
  assert.equal(f.endereco_rua, 'Rua A');
  assert.equal(f.endereco_ref, 'Portão azul');
  assert.equal(f.transportadora, 'TransX');
  assert.equal(f.previsao, '2026-11-10');
});

test('tipo motorista exige motoristaCodigo válido', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'motorista', dataAgendada: '2026-11-05' })).status, 400);
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'motorista', dataAgendada: '2026-11-05', motoristaCodigo: 999 })).status, 400);
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'motorista', dataAgendada: '2026-11-05', motoristaCodigo: 30 })).status, 400); // sem entregas.baixar
  assert.equal(e.status, 'a_programar');
  assert.equal(banco.eventos.length, 0);
});

test('exceção bloquear tira o motorista; liberar põe', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  banco.excecoes.push({ usuario_codigo: 21, permissao: 'entregas.baixar', tipo: 'bloquear' });
  banco.excecoes.push({ usuario_codigo: 30, permissao: 'entregas.baixar', tipo: 'liberar' });
  banco.acessos.find(a => a.usuario_codigo === 22).ativo = 0; // 22 inativo
  const r = await chamar('/entregas/motoristas');
  assert.deepEqual((await r.json()).motoristas, [{ codigo: 30, nome: 'Sem Acesso' }]);
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'motorista', dataAgendada: '2026-11-05', motoristaCodigo: 21 })).status, 400);
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'motorista', dataAgendada: '2026-11-05', motoristaCodigo: 30 })).status, 200);
});

test('GET /entregas/motoristas não cai em /entregas/:id', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco);
  const r = await chamar('/entregas/motoristas');
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).motoristas, [{ codigo: 22, nome: 'Motorista Dois' }, { codigo: 21, nome: 'Motorista Um' }]); // por nome
});

test('corpo inválido: data de calendário, tipo, UF, texto longo', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const base = { tipo: 'retirada', dataAgendada: '2026-11-05' };
  for (const corpo of [
    { ...base, dataAgendada: '2026-02-30' }, { ...base, dataAgendada: undefined }, { ...base, tipo: 'foguete' }, { dataAgendada: '2026-11-05' },
    { ...base, endereco: { ...ENDERECO, uf: 'RJX' } }, { ...base, endereco: { ...ENDERECO, uf: '1A' } }, { ...base, previsao: '2026-13-01' }
  ]) assert.equal((await post(chamar, e.id, 'agendar', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal(e.status, 'a_programar');
  // texto acima do limite é cortado
  assert.equal((await post(chamar, e.id, 'agendar', { ...base, observacao: 'x'.repeat(900) })).status, 200);
  assert.equal(e.observacao.length, 500);
});

test('agendar duas vezes → 409 em português; id inexistente ou não numérico → 404', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const corpo = { tipo: 'retirada', dataAgendada: '2026-11-05' };
  assert.equal((await post(chamar, e.id, 'agendar', corpo)).status, 200);
  const r = await post(chamar, e.id, 'agendar', corpo);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /não pode ser agendada/);
  assert.equal(banco.eventos.length, 1);
  const n = await post(chamar, 999, 'agendar', corpo);
  assert.equal(n.status, 404);
  assert.equal((await n.json()).error, 'Entrega não encontrada.');
  assert.equal((await post(chamar, 'abc', 'agendar', corpo)).status, 404);
  assert.equal((await chamar('/entregas/abc')).status, 404);
});

test('reagendar de ocorrencia → agendada com evento reagendada; de a_programar → 409', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { status: 'ocorrencia', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-05' });
  assert.equal((await post(chamar, e.id, 'reagendar', { tipo: 'motorista' })).status, 400); // sem data
  const r = await post(chamar, e.id, 'reagendar', { dataAgendada: '2026-11-12', motoristaCodigo: 22 });
  assert.equal(r.status, 200);
  const { entrega } = await r.json();
  assert.equal(entrega.status, 'agendada');
  assert.equal(entrega.tipo, 'motorista'); // mantido
  assert.equal(entrega.dataAgendada, '2026-11-12');
  assert.equal(entrega.motoristaCodigo, 22);
  assert.equal(banco.eventos.at(-1).tipo, 'reagendada');
  assert.equal(banco.auditoria.at(-1).acao, 'entrega_reagendada');

  const g = banco.semear.entrega({ numero: 501, id: 2 });
  assert.equal((await post(chamar, g.id, 'reagendar', { dataAgendada: '2026-11-12' })).status, 409);
});

test('cancelar exige motivo (3 a 500) e vem de agendada', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { status: 'agendada', tipo: 'retirada', data_agendada: '2026-11-05' });
  assert.equal((await post(chamar, e.id, 'cancelar', {})).status, 400);
  assert.equal((await post(chamar, e.id, 'cancelar', { motivo: 'ab' })).status, 400);
  assert.equal((await post(chamar, e.id, 'cancelar', { motivo: 'x'.repeat(501) })).status, 400);
  assert.equal(e.status, 'agendada');
  const r = await post(chamar, e.id, 'cancelar', { motivo: 'Cliente desistiu' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).entrega.status, 'cancelada');
  assert.equal(e.status, 'cancelada');
  assert.equal(banco.eventos[0].tipo, 'cancelada');
  assert.equal(banco.eventos[0].motivo, 'Cliente desistiu');
  assert.equal(banco.auditoria[0].acao, 'entrega_cancelada');
  assert.equal((await post(chamar, e.id, 'cancelar', { motivo: 'de novo' })).status, 409);
});

test('PUT endereco altera só o endereço, sem mudar status, e registra evento e auditoria', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { status: 'agendada', tipo: 'retirada', data_agendada: '2026-11-05' });
  const r = await chamar(`/entregas/${e.id}/endereco`, 'PUT', { ...ENDERECO, contatoLocal: 'Maria 21 98888-0000' });
  assert.equal(r.status, 200);
  const { entrega } = await r.json();
  assert.equal(entrega.status, 'agendada');
  assert.equal(entrega.endereco.rua, 'Rua A');
  assert.equal(entrega.endereco.uf, 'RJ');
  assert.equal(entrega.contatoLocal, 'Maria 21 98888-0000');
  assert.equal(e.status, 'agendada');
  assert.equal(e.data_agendada, '2026-11-05');
  assert.equal(e.tipo, 'retirada');
  assert.equal(e.endereco_cep, '24000-000');
  assert.equal(banco.eventos.at(-1).tipo, 'endereco');
  assert.equal(banco.auditoria.at(-1).acao, 'entrega_endereco');
  assert.equal((await chamar(`/entregas/${e.id}/endereco`, 'PUT', { ...ENDERECO, uf: 'R' })).status, 400);
});

test('Somente ver: 403 nas escritas, mas lê detalhe e motoristas', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Somente ver' });
  const e = cenario(banco);
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'retirada', dataAgendada: '2026-11-05' })).status, 403);
  assert.equal((await post(chamar, e.id, 'reagendar', { dataAgendada: '2026-11-05' })).status, 403);
  assert.equal((await post(chamar, e.id, 'cancelar', { motivo: 'teste' })).status, 403);
  assert.equal((await chamar(`/entregas/${e.id}/endereco`, 'PUT', ENDERECO)).status, 403);
  assert.equal(e.status, 'a_programar');
  assert.equal((await chamar(`/entregas/${e.id}`)).status, 200);
  assert.equal((await chamar('/entregas/motoristas')).status, 200);
});

test('GET /entregas/:id: entrega, eventos, itens (sem valores) e clienteEndereco sem copiar para a entrega', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  banco.semear.evento({ entrega_id: e.id });
  banco.itens.push({ NUMERO: 501, TIPO: 'Pedido', ITEM: 2, DESCRICAO: 'Janela', QTD: 1, VALOR: 900 },
    { NUMERO: 501, TIPO: 'Pedido', ITEM: 1, DESCRICAO: 'Porta', QTD: 3, VALOR: 500 },
    { NUMERO: 502, TIPO: 'Pedido', ITEM: 1, DESCRICAO: 'Outro pedido', QTD: 1 });
  const r = await chamar(`/entregas/${e.id}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.entrega.id, e.id);
  assert.equal(j.entrega.numero, 501);
  assert.equal(j.entrega.status, 'a_programar');
  assert.equal(j.entrega.endereco.rua, null);
  assert.equal(j.eventos.length, 1);
  assert.equal(j.eventos[0].tipo, 'criada');
  assert.deepEqual(j.itens, [{ descricao: 'Porta', qtd: 3 }, { descricao: 'Janela', qtd: 1 }]);
  assert.deepEqual(j.clienteEndereco, { rua: 'Rua do Cliente', numero: '99', bairro: 'Icaraí', cidade: 'Niterói', uf: 'RJ', cep: '24220-000', telefone: '21999990000' });
  assert.equal(e.endereco_rua, null);
  assert.ok(!/valor|preco/i.test(JSON.stringify(j.itens)));
});

test('estados restritos: entrega de cliente de outro estado → 404 no detalhe e nas escritas', async t => {
  const { banco, chamar } = await prepararEntregas(t, { estados: ['SP'] });
  const e = cenario(banco); // cliente em RJ
  assert.equal((await chamar(`/entregas/${e.id}`)).status, 404);
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'retirada', dataAgendada: '2026-11-05' })).status, 404);
  assert.equal(e.status, 'a_programar');
  assert.equal(banco.eventos.length, 0);
});

test('falha no meio da gravação desfaz tudo (transação)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  banco.regras.unshift([/INSERT INTO web_auditoria/, () => { throw new Error('falha simulada'); }]);
  const r = await post(chamar, e.id, 'agendar', { tipo: 'retirada', dataAgendada: '2026-11-05' });
  assert.equal(r.status, 500);
  assert.equal(e.status, 'a_programar');
  assert.equal(banco.eventos.length, 0);
});
