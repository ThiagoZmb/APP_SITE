const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { REGEX_VALOR } = require('../seguranca/valores');
const { hojeLocal } = require('../rotas/transacao');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const M21 = { codigo: 21, nome: 'Motorista Um' };
const PASSADO = '2000-01-01';
const FUTURO = '2999-01-01';

// Entregas: 1 = do 21 (atrasada), 2 = do 22, 3 = sem motorista, 4 = do 21 mas tipo retirada, 5 = do 21 (futuro)
function cenario(banco) {
  banco.semear.cliente({ TELEFONE: '2199999-0000', ENDERECO: 'Rua do Cadastro', NUMERO: '10', BAIRRO: 'Centro', CEP: '24000-000' });
  for (const n of [601, 602, 603, 604, 605]) banco.semear.pedido({ NUMERO: n, SITUACAO: 'Pronto' });
  banco.itens.push({ NUMERO: 601, TIPO: 'Pedido', ITEM: 1, DESCRICAO: 'Porta pivotante', QTD: 2 },
    { NUMERO: 601, TIPO: 'Pedido', ITEM: 2, DESCRICAO: 'Puxador', QTD: 1 });
  const base = { status: 'agendada', tipo: 'motorista', data_agendada: PASSADO };
  banco.semear.entrega({ ...base, numero: 601, motorista_codigo: 21, endereco_rua: 'Rua da Entrega', endereco_cidade: 'Niterói', endereco_uf: 'RJ', contato_local: 'Zé' });
  banco.semear.entrega({ ...base, numero: 602, motorista_codigo: 22 });
  banco.semear.entrega({ ...base, numero: 603, motorista_codigo: null });
  banco.semear.entrega({ ...base, numero: 604, motorista_codigo: 21, tipo: 'retirada' });
  banco.semear.entrega({ ...base, numero: 605, motorista_codigo: 21, data_agendada: FUTURO });
  return banco.entregas;
}
const foto = (banco, entrega_id, extra = {}) => {
  const a = { id: banco.anexos.length + 1, entrega_id, evento_id: null, tipo: 'foto', mime: 'image/jpeg', dados: JPEG, criado_por: '21', criado_em: '2026-10-26 09:00:00', ...extra };
  banco.anexos.push(a); return a;
};
const post = (chamar, id, acao, corpo = {}) => chamar(`/minhas_entregas/${id}/${acao}`, 'POST', corpo);

function chaves(o, acc = []) {
  if (Array.isArray(o)) o.forEach(x => chaves(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); chaves(v, acc); }
  return acc;
}
const semDinheiro = (json, onde) => assert.deepEqual(chaves(json).filter(k => REGEX_VALOR.test(k)), [], `chave de dinheiro em ${onde}`);

test('lista: o motorista 21 vê só as suas (hoje e atrasadas), com endereço da entrega', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  const r = await chamar('/minhas_entregas');
  assert.equal(r.status, 200);
  const { entregas } = await r.json();
  assert.deepEqual(entregas.map(e => e.numero), [601]);
  const e = entregas[0];
  assert.equal(e.cliente, 'CLIENTE TESTE LTDA');
  assert.equal(e.telefone, '2199999-0000');
  assert.equal(e.qtdItens, 2);
  assert.equal(e.dataAgendada, PASSADO);
  assert.equal(e.endereco.rua, 'Rua da Entrega');
  assert.equal(e.contatoLocal, 'Zé');
  assert.equal(e.enderecoCliente, undefined);
});

test('lista: com dia só aquele dia; dia inválido 400', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  assert.deepEqual((await (await chamar('/minhas_entregas?dia=' + FUTURO)).json()).entregas.map(e => e.numero), [605]);
  assert.deepEqual((await (await chamar('/minhas_entregas?dia=2026-01-01')).json()).entregas, []);
  assert.equal((await chamar('/minhas_entregas?dia=2026-02-30')).status, 400);
  assert.equal((await chamar('/minhas_entregas?dia=ontem')).status, 400);
  assert.ok(hojeLocal());
});

test('lista: sem endereço da entrega devolve endereco null e o cadastro como sugestão', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[0].endereco_rua = null; banco.entregas[0].endereco_cidade = null; banco.entregas[0].endereco_uf = null;
  const [e] = (await (await chamar('/minhas_entregas')).json()).entregas;
  assert.equal(e.endereco, null);
  assert.equal(e.enderecoCliente.rua, 'Rua do Cadastro');
  assert.equal(e.enderecoCliente.bairro, 'Centro');
});

test('detalhe: itens, eventos e anexos; entrega alheia, sem motorista, inexistente, não numérica e de outro tipo dão o mesmo 404', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.semear.evento({ entrega_id: 1, tipo: 'agendada', usuario: 'Caio' });
  const r = await chamar('/minhas_entregas/1');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.itens, [{ descricao: 'Porta pivotante', qtd: 2 }, { descricao: 'Puxador', qtd: 1 }]);
  assert.equal(j.numero, 601);
  assert.equal(j.eventos[0].tipo, 'agendada');
  assert.deepEqual(j.anexos, []);
  const respostas = [];
  for (const id of [2, 3, 4, 99, 'abc']) {
    const x = await chamar('/minhas_entregas/' + id);
    respostas.push([x.status, await x.json()]);
  }
  for (const [s, c] of respostas) { assert.equal(s, 404); assert.deepEqual(c, { error: 'Entrega não encontrada.' }); }
});

test('toda ação e o anexo nas entregas de outro motorista dão 404 idêntico e nada é gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[1].status = 'em_rota'; banco.entregas[2].status = 'em_rota';
  const alheio = foto(banco, 2, { criado_por: '22' });
  for (const id of [2, 3]) {
    for (const [acao, corpo] of [['saiu', {}], ['baixa', { entregueA: 'X', anexoIds: [alheio.id] }], ['ocorrencia', { tipo: 'ausente', motivo: 'ninguém' }]]) {
      const x = await post(chamar, id, acao, corpo);
      assert.equal(x.status, 404, `${acao} ${id}`);
      assert.deepEqual(await x.json(), { error: 'Entrega não encontrada.' });
    }
    const p = await chamar(`/minhas_entregas/${id}/anexo?tipo=foto`, 'PUT', JPEG, { 'Content-Type': 'image/jpeg' });
    assert.equal(p.status, 404);
    assert.equal((await chamar(`/minhas_entregas/${id}/anexo/${alheio.id}`)).status, 404);
  }
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.anexos.length, 1);
  assert.equal(banco.pedidos[1].SITUACAO, 'Pronto');
});

test('saiu: agendada vira em_rota com evento e auditoria; repetir dá 409', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  const r = await post(chamar, 1, 'saiu');
  assert.equal(r.status, 200);
  assert.equal(banco.entregas[0].status, 'em_rota');
  assert.equal(banco.eventos.length, 1);
  assert.equal(banco.eventos[0].tipo, 'saiu');
  assert.equal(banco.auditoria[0].acao, 'entrega_saiu');
  assert.equal((await post(chamar, 1, 'saiu')).status, 409);
  assert.equal(banco.eventos.length, 1);
});

test('entrega atribuída ao motorista mas de outro tipo: 404', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  assert.equal((await post(chamar, 4, 'saiu')).status, 404);
});

test('anexo: só em_rota (409 antes), grava como criado_por do motorista; imagem inválida 400; grande 413', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  const enviar = (corpo = JPEG, mime = 'image/jpeg', tipo = 'foto') => chamar(`/minhas_entregas/1/anexo?tipo=${tipo}`, 'PUT', corpo, { 'Content-Type': mime });
  assert.equal((await enviar()).status, 409);
  await post(chamar, 1, 'saiu');
  const r = await enviar();
  assert.equal(r.status, 201);
  assert.equal(banco.anexos[0].criado_por, '21');
  assert.equal((await enviar(JPEG, 'image/jpeg', 'outro')).status, 400);
  assert.equal((await enviar(Buffer.from('texto'), 'image/jpeg')).status, 400);
  const g = await enviar(Buffer.concat([JPEG, Buffer.alloc(1048576)]));
  assert.equal(g.status, 413);
  assert.match((await g.json()).error, /muito grande/);
});

test('anexo: limite de 10 pendentes e contagem+INSERT dentro de transação travando a entrega', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[0].status = 'em_rota';
  banco.f.chamadas.length = 0;
  assert.equal((await chamar('/minhas_entregas/1/anexo?tipo=foto', 'PUT', JPEG, { 'Content-Type': 'image/jpeg' })).status, 201);
  const sqls = banco.f.chamadas.map(c => c.sql);
  const i = (re) => sqls.findIndex(s => re.test(s));
  assert.ok(i(/^BEGIN$/) >= 0 && i(/FOR UPDATE/) > i(/^BEGIN$/), 'trava depois do BEGIN');
  assert.ok(i(/COUNT\(\*\)/) > i(/FOR UPDATE/) && i(/^INSERT INTO web_entrega_anexos/) > i(/COUNT\(\*\)/) && i(/^COMMIT$/) > i(/^INSERT INTO web_entrega_anexos/));
  for (let n = 0; n < 9; n++) foto(banco, 1);
  const r = await chamar('/minhas_entregas/1/anexo?tipo=foto', 'PUT', JPEG, { 'Content-Type': 'image/jpeg' });
  assert.equal(r.status, 409);
});

test('GET anexo: binário com cabeçalhos; solto só do próprio motorista; vinculado sim', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  const meu = foto(banco, 1);
  const deOutro = foto(banco, 1, { criado_por: '7' });
  const r = await chamar(`/minhas_entregas/1/anexo/${meu.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), JPEG);
  assert.equal((await chamar(`/minhas_entregas/1/anexo/${deOutro.id}`)).status, 404);
  deOutro.evento_id = 1;
  assert.equal((await chamar(`/minhas_entregas/1/anexo/${deOutro.id}`)).status, 200);
  assert.equal((await chamar('/minhas_entregas/1/anexo/abc')).status, 404);
});

test('baixa: sem foto 400, sem entregueA 400; correta vira entregue, pedido Entregue e evento com entregue_a; repetida 409', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  await post(chamar, 1, 'saiu');
  const f = foto(banco, 1);
  const assinatura = foto(banco, 1, { tipo: 'assinatura' });
  assert.equal((await post(chamar, 1, 'baixa', { entregueA: 'Maria', anexoIds: [999] })).status, 400); // anexo inexistente/alheio
  assert.equal((await post(chamar, 1, 'baixa', { anexoIds: [f.id] })).status, 400);
  assert.equal((await post(chamar, 1, 'baixa', { entregueA: '  ', anexoIds: [f.id] })).status, 400);
  assert.equal((await post(chamar, 1, 'baixa', { entregueA: 'x'.repeat(191), anexoIds: [f.id] })).status, 400);
  assert.equal((await post(chamar, 1, 'baixa', { entregueA: 'Maria', anexoIds: [f.id, f.id] })).status, 400);
  assert.equal(banco.entregas[0].status, 'em_rota');
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');

  const ok = await post(chamar, 1, 'baixa', { entregueA: ' Maria Souza ', anexoIds: [f.id, assinatura.id] });
  assert.equal(ok.status, 200);
  assert.equal(banco.entregas[0].status, 'entregue');
  assert.equal(banco.pedidos[0].SITUACAO, 'Entregue');
  const ev = banco.eventos.find(v => v.tipo === 'entregue');
  assert.equal(ev.entregue_a, 'Maria Souza');
  assert.equal(f.evento_id, ev.id);
  assert.equal(assinatura.evento_id, ev.id);

  assert.equal((await post(chamar, 1, 'baixa', { entregueA: 'Maria Souza', anexoIds: [f.id] })).status, 409);
  assert.equal(banco.eventos.filter(v => v.tipo === 'entregue').length, 1);
  assert.equal(banco.f.chamadas.filter(c => /^UPDATE ped_orc/.test(c.sql)).length, 1);
});

test('baixa: foto de outra entrega ou de outro usuário é recusada e nada é gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[0].status = 'em_rota';
  const alheia = foto(banco, 2);
  const deOutro = foto(banco, 1, { criado_por: '22' });
  assert.equal((await post(chamar, 1, 'baixa', { entregueA: 'M', anexoIds: [alheia.id] })).status, 400);
  assert.equal((await post(chamar, 1, 'baixa', { entregueA: 'M', anexoIds: [deOutro.id] })).status, 400);
  assert.equal(banco.entregas[0].status, 'em_rota');
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
});

test('baixa antes de sair (agendada): 409', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  const f = foto(banco, 1);
  const r = await post(chamar, 1, 'baixa', { entregueA: 'M', anexoIds: [f.id] });
  assert.equal(r.status, 409);
  assert.doesNotMatch((await r.json()).error, /undefined/);
});

test('ocorrência: motivo obrigatório, tipo válido, parcial exige itens; não muda o pedido', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  await post(chamar, 1, 'saiu');
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'ausente' })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'ausente', motivo: 'ab' })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'ausente', motivo: 'x'.repeat(501) })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'roubo', motivo: 'sumiu tudo' })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { motivo: 'sem tipo' })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'parcial', motivo: 'faltou item' })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'parcial', motivo: 'faltou item', itensEntregues: [] })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'parcial', motivo: 'faltou item', itensEntregues: [{ descricao: 'Porta', qtd: 0 }] })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'parcial', motivo: 'faltou item', itensEntregues: [{ descricao: '', qtd: 1 }] })).status, 400);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'parcial', motivo: 'faltou item', itensEntregues: [{ descricao: 'Porta', qtd: 1.5 }] })).status, 400);
  assert.equal(banco.entregas[0].status, 'em_rota');
  assert.equal(banco.eventos.length, 1); // só o "saiu"

  const r = await post(chamar, 1, 'ocorrencia', { tipo: 'parcial', motivo: ' faltou o puxador ', itensEntregues: [{ descricao: 'Porta pivotante', qtd: 2 }] });
  assert.equal(r.status, 200);
  assert.equal(banco.entregas[0].status, 'ocorrencia');
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
  const ev = banco.eventos.at(-1);
  assert.equal(ev.tipo, 'parcial');
  assert.equal(ev.motivo, 'faltou o puxador');
  assert.deepEqual(JSON.parse(ev.detalhe).itensEntregues, [{ descricao: 'Porta pivotante', qtd: 2 }]);
  assert.equal(banco.f.chamadas.filter(c => /^UPDATE ped_orc/.test(c.sql)).length, 0);
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'ausente', motivo: 'de novo' })).status, 409);
});

test('ocorrência ausente simples: grava motivo, sem detalhe de itens', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[0].status = 'em_rota';
  assert.equal((await post(chamar, 1, 'ocorrencia', { tipo: 'ausente', motivo: 'cliente não estava' })).status, 200);
  assert.equal(banco.eventos[0].tipo, 'ausente');
  assert.equal(banco.auditoria[0].acao, 'entrega_ausente');
});

for (const perfil of ['Motorista', 'Motorista com valores']) {
  test(`varredura: nenhuma resposta do motorista tem chave de dinheiro (${perfil}) e entregueA vem íntegro`, async t => {
    const { banco, chamar } = await prepararEntregas(t, { perfil, usuario: M21 });
    cenario(banco);
    const respostas = [];
    const anota = async (nome, r) => { assert.ok(r.status < 500, nome); if (r.headers.get('content-type')?.includes('json')) respostas.push([nome, await r.json()]); };
    await anota('lista', await chamar('/minhas_entregas'));
    await anota('lista dia', await chamar('/minhas_entregas?dia=' + FUTURO));
    await anota('saiu', await post(chamar, 1, 'saiu'));
    const f = foto(banco, 1);
    await anota('anexo', await chamar('/minhas_entregas/1/anexo?tipo=foto', 'PUT', JPEG, { 'Content-Type': 'image/jpeg' }));
    await anota('baixa', await post(chamar, 1, 'baixa', { entregueA: 'Maria Souza', anexoIds: [f.id] }));
    await anota('baixa repetida', await post(chamar, 1, 'baixa', { entregueA: 'Maria Souza', anexoIds: [f.id] }));
    await anota('detalhe', await chamar('/minhas_entregas/1'));
    await anota('404', await chamar('/minhas_entregas/2'));
    banco.entregas[4].status = 'em_rota';
    await anota('ocorrencia', await post(chamar, 5, 'ocorrencia', { tipo: 'ausente', motivo: 'ninguém em casa' }));
    await anota('detalhe 5', await chamar('/minhas_entregas/5'));
    for (const [nome, json] of respostas) semDinheiro(json, nome);
    const detalhe = respostas.find(([n]) => n === 'detalhe')[1];
    const ev = detalhe.eventos.find(v => v.tipo === 'entregue');
    assert.equal(ev.entregueA, 'Maria Souza');
    assert.ok(respostas.length >= 9);
  });
}

test('perfil sem entregas.baixar (Programador) recebe 403 em todas as rotas do motorista', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Programador', usuario: M21 });
  cenario(banco);
  assert.equal((await chamar('/minhas_entregas')).status, 403);
  assert.equal((await chamar('/minhas_entregas/1')).status, 403);
  assert.equal((await post(chamar, 1, 'saiu')).status, 403);
  assert.equal((await post(chamar, 1, 'baixa', {})).status, 403);
  assert.equal((await post(chamar, 1, 'ocorrencia', {})).status, 403);
  assert.equal((await chamar('/minhas_entregas/1/anexo?tipo=foto', 'PUT', JPEG, { 'Content-Type': 'image/jpeg' })).status, 403);
  assert.equal((await chamar('/minhas_entregas/1/anexo/1')).status, 403);
});

test('409 nunca diz "undefined" (equipe: retirada, enviada, comprovante; motorista: saiu, baixa, ocorrência)', async t => {
  const eq = await prepararEntregas(t);
  cenario(eq.banco);
  eq.banco.entregas.forEach(e => { e.status = 'cancelada'; });
  for (const [acao, corpo] of [['retirada', { entregueA: 'M' }], ['enviada', { transportadora: 'T' }], ['comprovante', { anexoIds: [1] }]]) {
    const r = await eq.chamar(`/entregas/1/${acao}`, 'POST', corpo);
    assert.equal(r.status, 409, acao);
    const msg = (await r.json()).error;
    assert.doesNotMatch(msg, /undefined/, acao);
    assert.match(msg, /não pode ser \S+/, acao);
  }
});

test('409 nunca diz "undefined" nas ações do motorista', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[0].status = 'entregue';
  const f = foto(banco, 1);
  const casos = [['saiu', {}], ['baixa', { entregueA: 'M', anexoIds: [f.id] }],
    ...['ausente', 'endereco_errado', 'recusa'].map(tipo => ['ocorrencia', { tipo, motivo: 'motivo ok' }]),
    ['ocorrencia', { tipo: 'parcial', motivo: 'motivo ok', itensEntregues: [{ descricao: 'Porta', qtd: 1 }] }]];
  for (const [acao, corpo] of casos) {
    const r = await post(chamar, 1, acao, corpo);
    assert.equal(r.status, 409, acao);
    const msg = (await r.json()).error;
    assert.doesNotMatch(msg, /undefined/, acao);
    assert.match(msg, /não pode ser \S+/, acao);
  }
});

// Corrida: a entrega muda entre a primeira leitura e a trava (FOR UPDATE); a decisão final é a de dentro da trava.
function aoTravar(banco, mudar) {
  banco.regras.unshift([/SELECT \* FROM web_entregas WHERE id = \? FOR UPDATE/, (sql, [id]) => {
    const e = banco.entregas.find(x => x.id === id); if (e) mudar(e); return e ? [{ ...e }] : [];
  }]);
}
const enviarAnexo = (chamar, id) => chamar(`/minhas_entregas/${id}/anexo?tipo=foto`, 'PUT', JPEG, { 'Content-Type': 'image/jpeg' });

test('corrida no anexo do motorista: trocou o motorista antes da trava -> 404 e nada gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[0].status = 'em_rota';
  aoTravar(banco, e => { e.motorista_codigo = 22; });
  const r = await enviarAnexo(chamar, 1);
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'Entrega não encontrada.' });
  assert.equal(banco.anexos.length, 0);
});

test('corrida no anexo do motorista: baixada antes da trava -> 409 e nada gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[0].status = 'em_rota';
  aoTravar(banco, e => { e.status = 'entregue'; });
  const r = await enviarAnexo(chamar, 1);
  assert.equal(r.status, 409);
  assert.equal(banco.anexos.length, 0);
});

test('corrida no anexo do motorista: tipo mudou antes da trava -> 404 e nada gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas[0].status = 'em_rota';
  aoTravar(banco, e => { e.tipo = 'retirada'; });
  assert.equal((await enviarAnexo(chamar, 1)).status, 404);
  assert.equal(banco.anexos.length, 0);
});

test('corrida no anexo da equipe: entrega ficou final antes da trava -> 409 e nada gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco);
  aoTravar(banco, e => { e.status = 'cancelada'; });
  const r = await chamar('/entregas/1/anexo?tipo=foto', 'PUT', JPEG, { 'Content-Type': 'image/jpeg' });
  assert.equal(r.status, 409);
  assert.equal(banco.anexos.length, 0);
});

test('baixa: sem foto nem assinatura é aceita (só quem recebeu); pedido vira Entregue', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  await post(chamar, 1, 'saiu');
  const r = await post(chamar, 1, 'baixa', { entregueA: 'Maria' });
  assert.equal(r.status, 200);
  assert.equal(banco.entregas[0].status, 'entregue');
  assert.equal(banco.pedidos[0].SITUACAO, 'Entregue');
  assert.equal((await post(chamar, 1, 'baixa', { entregueA: 'Maria' })).status, 409);
});
