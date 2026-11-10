// Várias entregas por pedido, etapas 4 a 6: dividir ("Separar em outra entrega"), saldo (gerar/encerrar), hash dos itens,
// motorista vendo só os itens da própria entrega, "Entrega n de N", ?pedido=N, varredura com várias entregas, selos e o aviso
// do menu manual de situação. Banco simulado (test/apoio/bancoEntregas.js e bancoPedOrc.js); nada toca MySQL real.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hashItensPedido, situacaoDivisao, lerSeparacao, separarItens, fechamentoDoPedido, ordemNoPedido, STATUS_DIVISIVEIS } = require('../calculo/entregas');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { REGEX_VALOR } = require('../seguranca/valores');
const { hojeLocal } = require('../rotas/transacao');
const E = require('../entregas.js');
const C = require('../entregas_comum.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ITENS = [{ item: 1, descricao: 'Porta', qtd: 3 }, { item: 2, descricao: 'Trilho', qtd: 2 }];

// ======================= cálculo (puro) =======================
test('hashItensPedido: não depende da ordem; muda com quantidade, descrição ou item', () => {
  const h = hashItensPedido(ITENS);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashItensPedido([...ITENS].reverse()), h);
  assert.equal(hashItensPedido([{ item: 1, descricao: ' Porta ', qtd: '3.0000' }, ITENS[1]]), h);
  assert.notEqual(hashItensPedido([{ ...ITENS[0], qtd: 4 }, ITENS[1]]), h);
  assert.notEqual(hashItensPedido([{ ...ITENS[0], descricao: 'Porta 2' }, ITENS[1]]), h);
  assert.notEqual(hashItensPedido([ITENS[0]]), h);
});

test('situacaoDivisao: pedido nunca dividido = pedido inteiro, sem sobra; dividido calcula sobra e itens por entrega', () => {
  const um = situacaoDivisao({ entregas: [{ id: 1, status: 'a_programar' }], itensPedido: ITENS });
  assert.equal(um.dividido, false);
  assert.equal(um.alterado, false);
  assert.deepEqual(um.porEntrega.get(1).map(i => [i.item, i.qtd]), [[1, 3], [2, 2]]);
  assert.deepEqual(um.sobra, []);
  const hash = hashItensPedido(ITENS);
  const listas = new Map([[1, [{ numero_item: 1, descricao: 'Porta', quantidade: '2' }]], [2, [{ numero_item: 1, descricao: 'Porta', quantidade: '1' }, { numero_item: 2, descricao: 'Trilho', quantidade: '2' }]]]);
  const dois = situacaoDivisao({ entregas: [{ id: 1, status: 'agendada', hash_itens: hash }, { id: 2, status: 'a_programar', hash_itens: hash }], itensPorEntrega: listas, itensPedido: ITENS });
  assert.equal(dois.dividido, true);
  assert.deepEqual(dois.sobra, []);
  assert.deepEqual(dois.porEntrega.get(2).map(i => [i.item, i.qtd]), [[1, 1], [2, 2]]);
  // cancelando a 2 os itens dela voltam ao saldo (calculado, nada é movido)
  const canc = situacaoDivisao({ entregas: [{ id: 1, status: 'agendada', hash_itens: hash }, { id: 2, status: 'cancelada', hash_itens: hash }], itensPorEntrega: listas, itensPedido: ITENS });
  assert.deepEqual(canc.sobra.map(i => [i.item, i.qtd]), [[1, 1], [2, 2]]);
  // sobra encerrada conta como coberta
  const enc = situacaoDivisao({ entregas: [{ id: 1, status: 'agendada', hash_itens: hash }, { id: 2, status: 'cancelada', hash_itens: hash }], itensPorEntrega: listas, itensPedido: ITENS,
    encerradas: [{ numero_item: 1, quantidade: '1', hash_itens: hash }] });
  assert.deepEqual(enc.sobra.map(i => [i.item, i.qtd]), [[2, 2]]);
  // pedido editado depois da divisão
  const alt = situacaoDivisao({ entregas: [{ id: 1, status: 'agendada', hash_itens: hash }], itensPorEntrega: listas, itensPedido: [{ ...ITENS[0], qtd: 5 }, ITENS[1]] });
  assert.equal(alt.alterado, true);
  // hash de entrega CANCELADA não conta
  const cancAlt = situacaoDivisao({ entregas: [{ id: 1, status: 'agendada', hash_itens: hash }, { id: 2, status: 'cancelada', hash_itens: 'velho' }], itensPorEntrega: listas, itensPedido: ITENS });
  assert.equal(cancAlt.alterado, false);
});

test('lerSeparacao: aceita decimais (até 4 casas) e texto numérico; recusa vazio, zero, negativo, repetido e casas demais', () => {
  assert.deepEqual(lerSeparacao({ itens: [{ numeroItem: 1, quantidade: 1.5 }, { numeroItem: 2, quantidade: '0.25' }], observacao: ' obs ' }),
    { itens: [{ numeroItem: 1, quantidade: 1.5 }, { numeroItem: 2, quantidade: 0.25 }], observacao: 'obs' });
  for (const ruim of [{}, { itens: [] }, { itens: [{ numeroItem: 1, quantidade: 0 }] }, { itens: [{ numeroItem: 1, quantidade: -1 }] },
    { itens: [{ numeroItem: 0, quantidade: 1 }] }, { itens: [{ numeroItem: 1, quantidade: 1 }, { numeroItem: 1, quantidade: 1 }] },
    { itens: [{ numeroItem: 1, quantidade: 1.12345 }] }, { itens: [{ numeroItem: 1, quantidade: 'abc' }] }, { itens: [{ numeroItem: 1, quantidade: 1 }], observacao: 'x'.repeat(501) }]) {
    assert.throws(() => lerSeparacao(ruim), e => e.status === 400, JSON.stringify(ruim).slice(0, 80));
  }
});

test('separarItens: divide; quantidade acima da disponível ou item fora da entrega = 409; marcar tudo = 400', () => {
  const disp = [{ item: 1, descricao: 'Porta', qtd: 3 }, { item: 2, descricao: 'Trilho', qtd: 2 }];
  const ok = separarItens(disp, [{ numeroItem: 1, quantidade: 1 }, { numeroItem: 2, quantidade: 2 }]);
  assert.deepEqual(ok.nova.map(i => [i.item, i.qtd]), [[1, 1], [2, 2]]);
  assert.deepEqual(ok.resto.map(i => [i.item, i.qtd]), [[1, 2]]);
  assert.equal(separarItens(disp, [{ numeroItem: 1, quantidade: 3.5 }]).erro.status, 409);
  assert.equal(separarItens(disp, [{ numeroItem: 9, quantidade: 1 }]).erro.status, 409);
  const tudo = separarItens(disp, [{ numeroItem: 1, quantidade: 3 }, { numeroItem: 2, quantidade: 2 }]);
  assert.equal(tudo.erro.status, 400);
  assert.match(tudo.erro.msg, /não é divisão/);
  assert.deepEqual(STATUS_DIVISIVEIS, ['a_programar', 'agendada', 'ocorrencia']);
});

test('fechamentoDoPedido: sobra encerrada conta como coberta; pedido alterado depois da divisão nunca fecha sozinho', () => {
  const entregas = [{ id: 1, status: 'retirado' }];
  const itensPorEntrega = new Map([[1, [{ numero_item: 1, quantidade: 2 }]]]);
  const itensPedido = [{ item: 1, qtd: 3 }];
  assert.equal(fechamentoDoPedido({ entregas, itensPorEntrega, itensPedido }).motivo, 'itens_sem_entrega');
  assert.deepEqual(fechamentoDoPedido({ entregas, itensPorEntrega, itensPedido, itensEncerrados: [{ numero_item: 1, quantidade: '1' }] }),
    { fechar: true, situacao: 'Retirado', motivo: null });
  assert.deepEqual(fechamentoDoPedido({ entregas, itensPorEntrega, itensPedido, itensEncerrados: [{ numero_item: 1, quantidade: 1 }], alterado: true }),
    { fechar: false, situacao: null, motivo: 'itens_alterados' });
  // com entrega aberta o motivo continua sendo a entrega aberta
  assert.equal(fechamentoDoPedido({ entregas: [...entregas, { id: 2, status: 'agendada' }], alterado: true }).motivo, 'entregas_abertas');
});

test('ordemNoPedido e rotuloSequencia: "Entrega n de N" conta só as não canceladas; uma entrega = sem rótulo', () => {
  const l = [{ id: 1, sequencia: 1, status: 'entregue' }, { id: 2, sequencia: 2, status: 'cancelada' }, { id: 3, sequencia: 3, status: 'a_programar' }];
  assert.deepEqual(ordemNoPedido(l, 3), { ordemEntrega: 2, qtdEntregasPedido: 2 });
  assert.deepEqual(ordemNoPedido(l, 2), { ordemEntrega: 0, qtdEntregasPedido: 2 });
  assert.equal(C.rotuloSequencia({ ordemEntrega: 2, qtdEntregasPedido: 2 }), 'Entrega 2 de 2');
  assert.equal(C.rotuloSequencia({ ordemEntrega: 1, qtdEntregasPedido: 1 }), '');
  assert.equal(C.rotuloSequencia({}), '');
  for (const k of ['ordemEntrega', 'qtdEntregasPedido', 'itensSemEntrega', 'qtdItensSemEntrega', 'itensDetalhe', 'entregasAbertas']) assert.ok(!REGEX_VALOR.test(k), k);
});

// ======================= rotas =======================
// pedido 501 Pronto (Porta × 3, Trilho × 2) com UMA entrega A programar (sem lista = pedido inteiro), endereço de entrega preenchido
function cenario(banco, { status = 'a_programar', tipo = null, extra = {} } = {}) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto' });
  banco.semear.item({ NUMERO: 501, ITEM: 1, DESCRICAO: 'Porta', QTD: 3 });
  banco.semear.item({ NUMERO: 501, ITEM: 2, DESCRICAO: 'Trilho', QTD: 2 });
  const e = banco.semear.entrega({ numero: 501, status, tipo, endereco_rua: 'Rua A', endereco_cidade: 'Niterói', endereco_uf: 'RJ', contato_local: 'Zé', ...extra });
  banco.semear.evento({ entrega_id: e.id });
  return e;
}
const listaDe = (banco, id) => banco.entregaItens.filter(i => i.entrega_id === id).sort((a, b) => a.numero_item - b.numero_item).map(i => [i.numero_item, Number(i.quantidade)]);
const separar = (chamar, id, itens, extra = {}) => chamar(`/entregas/${id}/separar`, 'POST', { itens, ...extra });

test('separar: cria a entrega 2 A programar (sem data, motorista e tipo) com os itens marcados; a origem fica com o resto; hash, eventos e auditoria', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco, { status: 'agendada', tipo: 'motorista', extra: { data_agendada: '2026-11-20', motorista_codigo: 21 } });
  const r = await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1 }, { numeroItem: 2, quantidade: 0.5 }], { observacao: 'vai depois' });
  assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  const nova = banco.entregas.find(e => e.id === j.entrega.id);
  assert.deepEqual([nova.numero, nova.sequencia, nova.status, nova.tipo, nova.data_agendada, nova.motorista_codigo, nova.observacao], [501, 2, 'a_programar', null, null, null, 'vai depois']);
  assert.deepEqual([nova.endereco_rua, nova.endereco_cidade, nova.contato_local], ['Rua A', 'Niterói', 'Zé'], 'endereço e contato copiados da origem');
  assert.deepEqual(listaDe(banco, nova.id), [[1, 1], [2, 0.5]]);
  assert.deepEqual(listaDe(banco, origem.id), [[1, 2], [2, 1.5]], 'origem sem lista ganhou a lista do pedido menos o separado');
  // a origem continua como estava (Agendada, mesma data e motorista)
  assert.deepEqual([origem.status, origem.data_agendada, origem.motorista_codigo], ['agendada', '2026-11-20', 21]);
  const hash = hashItensPedido(ITENS);
  assert.equal(origem.hash_itens, hash);
  assert.equal(nova.hash_itens, hash);
  assert.ok(banco.eventos.some(v => v.entrega_id === origem.id && v.tipo === 'dividida'));
  assert.ok(banco.eventos.some(v => v.entrega_id === nova.id && v.tipo === 'criada' && /Separada da entrega 1/.test(v.motivo)));
  const aud = banco.auditoria.find(a => a.acao === 'entrega_dividida');
  assert.equal(aud.alvo, '501');
  assert.equal(JSON.parse(aud.detalhe).novaId, nova.id);
  // o pedido não mudou
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
  assert.equal(banco.f.chamadas.filter(c => /^UPDATE ped_orc/.test(c.sql)).length, 0);
});

test('separar: ordem de trava pedido -> entregas, tudo numa transação; a segunda divisão relê o que a primeira gravou', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco);
  banco.f.chamadas.length = 0;
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 2 }])).status, 201);
  const sqls = banco.f.chamadas.map(c => c.sql);
  const i = re => sqls.findIndex(s => re.test(s));
  assert.ok(i(/^SELECT numero FROM web_entregas WHERE id = \?$/) < i(/^BEGIN$/), 'número lido fora da transação');
  assert.ok(i(/^BEGIN$/) < i(/FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido' FOR UPDATE/));
  assert.ok(i(/FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido' FOR UPDATE/) < i(/^SELECT \* FROM web_entregas WHERE numero = \? ORDER BY sequencia, id FOR UPDATE$/));
  assert.ok(i(/^SELECT \* FROM web_entregas WHERE numero = \? ORDER BY sequencia, id FOR UPDATE$/) < i(/^DELETE FROM web_entrega_itens/));
  assert.ok(i(/^INSERT INTO web_entregas \(/) < i(/^COMMIT$/));
  // a origem agora tem Porta × 1 e Trilho × 2: pedir 2 portas de novo esbarra no que já foi separado (409, nada gravado)
  const antes = banco.entregas.length;
  const r = await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 2 }]);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /maior que a disponível/);
  assert.equal(banco.entregas.length, antes);
  assert.deepEqual(listaDe(banco, origem.id), [[1, 1], [2, 2]]);
  // uma segunda divisão válida da mesma origem cria a entrega 3
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 2, quantidade: 1 }])).status, 201);
  assert.deepEqual(banco.entregas.filter(e => e.numero === 501).map(e => e.sequencia), [1, 2, 3]);
});

test('concorrência simulada: enquanto a divisão B espera a trava do pedido, a divisão A termina; B relê dentro da trava (sequência 3, resto certo)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco);
  let vez = 0;
  // a 1ª trava do pedido é a de B: antes de devolvê-la, A roda inteira (como se A tivesse pegado a trava primeiro e feito commit)
  banco.regras.unshift([/^SELECT SITUACAO FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido' FOR UPDATE$/, async (sql, [numero]) => {
    if (vez++ === 0) assert.equal((await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 2 }])).status, 201, 'A');
    return banco.pedidos.filter(p => p.NUMERO === numero).map(p => ({ SITUACAO: p.SITUACAO }));
  }]);
  const b = await separar(chamar, origem.id, [{ numeroItem: 2, quantidade: 1 }]);
  assert.equal(b.status, 201, 'B');
  assert.deepEqual(banco.entregas.filter(e => e.numero === 501).map(e => e.sequencia).sort(), [1, 2, 3]);
  assert.deepEqual(listaDe(banco, origem.id), [[1, 1], [2, 1]], 'B partiu do que A deixou na origem');
});

test('separar: Em rota, Enviada, Entregue, Retirado e Cancelada = 409 com mensagem; nada gravado', async t => {
  for (const [status, tipo] of [['em_rota', 'motorista'], ['enviada', 'outro_estado'], ['entregue', 'motorista'], ['retirado', 'retirada'], ['cancelada', null]]) {
    const { banco, chamar } = await prepararEntregas(t);
    const e = cenario(banco, { status, tipo });
    const r = await separar(chamar, e.id, [{ numeroItem: 1, quantidade: 1 }]);
    assert.equal(r.status, 409, status);
    assert.match((await r.json()).error, /não pode ser dividida/);
    assert.equal(banco.entregas.length, 1);
    assert.equal(banco.entregaItens.length, 0);
    assert.equal(banco.auditoria.length, 0);
  }
});

test('separar: quantidades e itens inválidos; marcar tudo não é divisão; pedido fora de Pronto; entrega inexistente', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const casos = [
    [[{ numeroItem: 1, quantidade: 0 }], 400], [[{ numeroItem: 1, quantidade: -1 }], 400], [[], 400],
    [[{ numeroItem: 1, quantidade: 4 }], 409], [[{ numeroItem: 7, quantidade: 1 }], 409],
    [[{ numeroItem: 1, quantidade: 3 }, { numeroItem: 2, quantidade: 2 }], 400]];
  for (const [itens, st] of casos) {
    const r = await separar(chamar, e.id, itens);
    assert.equal(r.status, st, JSON.stringify(itens));
  }
  assert.equal(banco.entregas.length, 1);
  assert.equal(banco.entregaItens.length, 0);
  assert.equal((await separar(chamar, 99, [{ numeroItem: 1, quantidade: 1 }])).status, 404);
  banco.pedidos[0].SITUACAO = 'Em Produção';
  const r = await separar(chamar, e.id, [{ numeroItem: 1, quantidade: 1 }]);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Só pedido Pronto/);
});

test('permissões: sem entregas.programar = 403 (Somente ver e Motorista) em separar, gerar saldo e encerrar saldo', async t => {
  for (const perfil of ['Somente ver', 'Motorista']) {
    const { banco, chamar } = await prepararEntregas(t, { perfil, usuario: { codigo: 21, nome: 'Motorista Um' } });
    const e = cenario(banco, { status: 'agendada', tipo: 'motorista', extra: { motorista_codigo: 21, data_agendada: hojeLocal() } });
    assert.equal((await separar(chamar, e.id, [{ numeroItem: 1, quantidade: 1 }])).status, 403, perfil);
    assert.equal((await chamar('/entregas/pedido/501/saldo', 'POST', {})).status, 403, perfil);
    assert.equal((await chamar('/entregas/pedido/501/saldo/encerrar', 'POST', { motivo: 'xxx' })).status, 403, perfil);
    assert.equal(banco.entregas.length, 1);
  }
});

test('GET /entregas: "Entrega n de N" só no pedido dividido; GET /entregas/:id traz só os itens da entrega e a divisão', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco);
  banco.semear.pedido({ NUMERO: 502, SITUACAO: 'Pronto' });
  banco.semear.entrega({ numero: 502 });
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 2, quantidade: 2 }])).status, 201);
  const { entregas } = await (await chamar('/entregas')).json();
  const de501 = entregas.filter(e => e.numero === 501).map(e => [e.ordemEntrega, e.qtdEntregasPedido]);
  assert.deepEqual(de501.sort(), [[1, 2], [2, 2]]);
  const so = entregas.find(e => e.numero === 502);
  assert.ok(!('ordemEntrega' in so) && !('qtdEntregasPedido' in so), 'pedido de uma entrega: chaves de sempre');
  const det = await (await chamar(`/entregas/${origem.id}`)).json();
  assert.deepEqual(det.itens, [{ descricao: 'Porta', qtd: 3 }]);
  assert.deepEqual(det.itensDetalhe, [{ item: 1, descricao: 'Porta', qtd: 3 }]);
  assert.deepEqual([det.divisao.ordemEntrega, det.divisao.qtdEntregasPedido, det.divisao.dividido, det.divisao.alterado, det.divisao.podeSeparar], [1, 2, true, false, true]);
  const nova = banco.entregas.find(e => e.sequencia === 2);
  assert.deepEqual((await (await chamar(`/entregas/${nova.id}`)).json()).itens, [{ descricao: 'Trilho', qtd: 2 }]);
});

test('saldo: cancelar a entrega separada devolve os itens ao saldo; "Gerar entrega do saldo" cria a entrega 3 e o saldo some', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco);
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1 }, { numeroItem: 2, quantidade: 2 }])).status, 201);
  const nova = banco.entregas.find(e => e.sequencia === 2);
  assert.deepEqual((await (await chamar('/entregas')).json()).sobras, [], 'tudo coberto: sem saldo');
  assert.equal((await chamar(`/entregas/${nova.id}/cancelar`, 'POST', { motivo: 'cliente pediu' })).status, 200);
  const { sobras } = await (await chamar('/entregas')).json();
  assert.equal(sobras.length, 1);
  assert.deepEqual([sobras[0].numero, sobras[0].qtdItensSemEntrega, sobras[0].alterado], [501, 2, false]);
  assert.deepEqual(sobras[0].itensSemEntrega, [{ item: 1, descricao: 'Porta', qtd: 1 }, { item: 2, descricao: 'Trilho', qtd: 2 }]);
  // o detalhe da origem também avisa
  assert.equal((await (await chamar(`/entregas/${origem.id}`)).json()).divisao.itensSemEntrega.length, 2);
  const g = await chamar('/entregas/pedido/501/saldo', 'POST', {});
  assert.equal(g.status, 201);
  const terceira = banco.entregas.find(e => e.sequencia === 3);
  assert.deepEqual([terceira.status, terceira.tipo, terceira.motorista_codigo, terceira.data_agendada], ['a_programar', null, null, null]);
  assert.deepEqual(listaDe(banco, terceira.id), [[1, 1], [2, 2]]);
  assert.ok(banco.auditoria.some(a => a.acao === 'entrega_saldo_gerada'));
  assert.deepEqual((await (await chamar('/entregas')).json()).sobras, []);
  // sem saldo: 409
  assert.equal((await chamar('/entregas/pedido/501/saldo', 'POST', {})).status, 409);
  assert.equal((await chamar('/entregas/pedido/501/saldo/encerrar', 'POST', { motivo: 'nada' })).status, 409);
});

test('encerrar saldo: motivo obrigatório; com as outras entregas concluídas o pedido fecha (Retirado, DATA_ENTREGA de hoje)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco, { status: 'agendada', tipo: 'retirada', extra: { data_agendada: '2026-11-20' } });
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 2, quantidade: 2 }])).status, 201);
  const nova = banco.entregas.find(e => e.sequencia === 2);
  assert.equal((await chamar(`/entregas/${origem.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto', 'a entrega 2 ainda está aberta');
  assert.equal((await chamar(`/entregas/${nova.id}/cancelar`, 'POST', { motivo: 'cliente desistiu do trilho' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto', 'cancelar não fecha o pedido: sobra o trilho');
  assert.equal((await chamar('/entregas/pedido/501/saldo/encerrar', 'POST', { motivo: '' })).status, 400);
  const r = await chamar('/entregas/pedido/501/saldo/encerrar', 'POST', { motivo: 'cliente desistiu do trilho' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, pedidoFechado: true, situacao: 'Retirado' });
  assert.equal(banco.pedidos[0].SITUACAO, 'Retirado');
  assert.equal(banco.pedidos[0].DATA_ENTREGA, hojeLocal());
  assert.deepEqual(banco.encerradas.map(x => [x.numero, x.numero_item, Number(x.quantidade), x.motivo]), [[501, 2, 2, 'cliente desistiu do trilho']]);
  assert.ok(banco.eventos.some(v => v.tipo === 'sobra_encerrada'));
  assert.equal(JSON.parse(banco.auditoria.find(a => a.acao === 'entrega_saldo_encerrado').detalhe).pedidoFechado, true);
});

test('encerrar saldo com outra entrega aberta: não fecha agora; a última baixa fecha contando o encerrado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco, { status: 'agendada', tipo: 'retirada', extra: { data_agendada: '2026-11-20' } });
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 2, quantidade: 1 }])).status, 201); // 2: Trilho × 1
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 2, quantidade: 1 }])).status, 201); // 3: Trilho × 1
  const tres = banco.entregas.find(e => e.sequencia === 3);
  assert.equal((await chamar(`/entregas/${tres.id}/cancelar`, 'POST', { motivo: 'faltou peça' })).status, 200);
  const r = await chamar('/entregas/pedido/501/saldo/encerrar', 'POST', { motivo: 'não vai mais' });
  assert.deepEqual(await r.json(), { ok: true, pedidoFechado: false, situacao: null });
  const dois = banco.entregas.find(e => e.sequencia === 2);
  banco.entregas.find(e => e.id === dois.id).status = 'agendada';
  banco.entregas.find(e => e.id === dois.id).tipo = 'retirada';
  assert.equal((await chamar(`/entregas/${origem.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
  assert.equal((await chamar(`/entregas/${dois.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Retirado', 'a última baixa fecha: Porta × 3 + Trilho × 1 entregues e Trilho × 1 encerrado');
});

test('hash: pedido editado depois da divisão = aviso, divisão/saldo recusados e a última baixa NÃO fecha o pedido', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco, { status: 'agendada', tipo: 'retirada', extra: { data_agendada: '2026-11-20' } });
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 2, quantidade: 2 }])).status, 201);
  const nova = banco.entregas.find(e => e.sequencia === 2);
  banco.entregas.find(e => e.id === nova.id).status = 'agendada';
  banco.entregas.find(e => e.id === nova.id).tipo = 'retirada';
  banco.itens.find(i => i.ITEM === 1).QTD = 4; // o vendedor editou o pedido
  const det = await (await chamar(`/entregas/${origem.id}`)).json();
  assert.equal(det.divisao.alterado, true);
  assert.equal(det.divisao.podeSeparar, false);
  const r = await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1 }]);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /alterado depois da divisão/);
  assert.equal((await (await chamar('/entregas')).json()).sobras[0].alterado, true);
  assert.equal((await chamar(`/entregas/${origem.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal((await chamar(`/entregas/${nova.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto', 'fica Pronto até a conferência manual');
  assert.equal(JSON.parse(banco.auditoria.at(-1).detalhe).motivoPedidoAberto, 'itens_alterados');
});

test('motorista: lista e detalhe mostram SÓ os itens da própria entrega, com "Entrega n de N"; sem permissão de dividir', async t => {
  const M21 = { codigo: 21, nome: 'Motorista Um' };
  const equipe = await prepararEntregas(t);
  const banco = equipe.banco;
  const origem = cenario(banco);
  assert.equal((await separar(equipe.chamar, origem.id, [{ numeroItem: 2, quantidade: 1.5 }])).status, 201);
  const nova = banco.entregas.find(e => e.sequencia === 2);
  Object.assign(banco.entregas.find(e => e.id === nova.id), { status: 'agendada', tipo: 'motorista', motorista_codigo: 21, data_agendada: hojeLocal() });
  const { chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21, banco });
  const { entregas } = await (await chamar('/minhas_entregas')).json();
  assert.equal(entregas.length, 1);
  assert.deepEqual([entregas[0].qtdItens, entregas[0].ordemEntrega, entregas[0].qtdEntregasPedido], [1, 2, 2]);
  const d = await (await chamar(`/minhas_entregas/${nova.id}`)).json();
  assert.deepEqual(d.itens, [{ descricao: 'Trilho', qtd: 1.5 }]);
  assert.equal(d.qtdItens, 1);
  assert.equal((await separar(chamar, nova.id, [{ numeroItem: 2, quantidade: 1 }])).status, 403);
});

test('varredura com várias entregas: sai de Pronto cancela TODAS as A programar (Agendada fica); volta a Pronto reabre só as que ela cancelou; nada duplicado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco);
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1 }])).status, 201);
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1 }])).status, 201);
  const [um, dois, tres] = [1, 2, 3].map(s => banco.entregas.find(e => e.sequencia === s));
  Object.assign(banco.entregas.find(e => e.id === tres.id), { status: 'agendada', tipo: 'retirada', data_agendada: '2026-11-20' });
  assert.equal((await chamar(`/entregas/${dois.id}/cancelar`, 'POST', { motivo: 'equipe cancelou' })).status, 200);
  banco.pedidos[0].SITUACAO = 'Em Produção';
  await chamar('/entregas');
  const st = () => [um, dois, tres].map(x => banco.entregas.find(e => e.id === x.id).status);
  assert.deepEqual(st(), ['cancelada', 'cancelada', 'agendada']);
  assert.equal(banco.entregas.length, 3, 'nenhuma entrega nova');
  banco.pedidos[0].SITUACAO = 'Pronto';
  await chamar('/entregas');
  assert.deepEqual(st(), ['a_programar', 'cancelada', 'agendada'], 'reabre só a que a varredura cancelou');
  await chamar('/entregas');
  assert.equal(banco.entregas.length, 3, 'varredura idempotente: pedido dividido não ganha outra entrega');
  // pedido Cancelado: A programar, Agendada e Ocorrência de todas as entregas são canceladas
  banco.pedidos[0].SITUACAO = 'Cancelado';
  await chamar('/entregas');
  assert.deepEqual(st(), ['cancelada', 'cancelada', 'cancelada']);
});

// ======================= etapa 6: aviso do menu manual de situação =======================
const { bancoPedOrc, prepararPedOrc } = require('./apoio/bancoPedOrc');
function pedidoComEntregas(statuses) {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ id: 5, TIPO: 'Pedido', NUMERO: 5, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Pronto', TOTAL: 100 });
  statuses.forEach((status, i) => banco.entregas.push({ id: i + 1, numero: 5, status }));
  banco.f.regras.unshift([/^SELECT COUNT\(\*\) AS n FROM web_entregas WHERE numero = \? AND status IN \(([^)]*)\)/, (sql, [n]) => {
    const abertos = /status IN \(([^)]*)\)/.exec(sql)[1].split(',').map(x => x.trim().replace(/'/g, ''));
    return [{ n: banco.entregas.filter(e => e.numero === Number(n) && abertos.includes(e.status)).length }];
  }]);
  return banco;
}

test('menu "Entregue" com entrega aberta: 409 com aviso (nada gravado); com confirmarEntregasAbertas grava como antes e audita o número', async t => {
  const banco = pedidoComEntregas(['entregue', 'agendada']);
  const { chamar } = await prepararPedOrc(t, { banco });
  let r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Entregue' });
  assert.equal(r.status, 409);
  const d = await r.json();
  assert.deepEqual([d.aviso, d.entregasAbertas], ['entregas_abertas', 1]);
  assert.match(d.error, /1 entrega\(s\) em aberto/);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Pronto');
  assert.equal(banco.auditoria.length, 0);
  r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Entregue', confirmarEntregasAbertas: true });
  assert.equal(r.status, 200);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Entregue');
  assert.equal(banco.pedOrc[0].DATA_ENTREGA, hojeLocal());
  assert.deepEqual(JSON.parse(banco.auditoria[0].detalhe), { cliente: 'CLIENTE TESTE', de: 'Pronto', para: 'Entregue' }, 'auditoria de sempre');
  assert.equal(banco.auditoria[1].acao, 'pedido_situacao_entregas_abertas');
  assert.deepEqual(JSON.parse(banco.auditoria[1].detalhe), { para: 'Entregue', entregasAbertas: 1 });
  assert.equal(banco.entregas.find(e => e.id === 2).status, 'agendada', 'a entrega aberta não é mexida pelo menu');
});

test('menu "Retirado" sem entrega aberta segue direto; "Em Produção" nunca pergunta; confirmação que não é true não vale', async t => {
  const banco = pedidoComEntregas(['entregue', 'cancelada']);
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Retirado' })).status, 200);
  assert.deepEqual(JSON.parse(banco.auditoria[0].detalhe), { cliente: 'CLIENTE TESTE', de: 'Pronto', para: 'Retirado' });
  assert.equal(banco.auditoria.length, 1);
  const b2 = pedidoComEntregas(['a_programar']);
  const p2 = await prepararPedOrc(t, { banco: b2 });
  assert.equal((await p2.chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Em Produção' })).status, 200);
  const b3 = pedidoComEntregas(['em_rota']);
  const p3 = await prepararPedOrc(t, { banco: b3 });
  assert.equal((await p3.chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Retirado', confirmarEntregasAbertas: 'true' })).status, 409);
});

test('excluir pedido pela web apaga também a sobra encerrada do número (o NUMERO é reaproveitado)', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ id: 5, TIPO: 'Pedido', NUMERO: 5, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Pronto', TOTAL: 100 });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar('/ped_orc/Pedido/5', 'DELETE')).status, 200);
  const c = banco.f.chamadas.find(x => /^DELETE FROM web_entrega_sobras_encerradas WHERE numero = \?$/.test(x.sql));
  assert.ok(c);
  assert.deepEqual(c.params, [5]);
});

// ======================= telas (lógica pura e HTML) =======================
const DET = [{ item: 1, descricao: 'Porta', qtd: 3 }, { item: 2, descricao: 'Trilho', qtd: 2 }];
test('tela: linhas, validação e corpo do "Separar em outra entrega"', () => {
  const l = E.linhasSeparacao(DET);
  assert.deepEqual(l.map(x => x.separar), [0, 0]);
  const comValores = (a, b) => l.map((x, k) => ({ ...x, separar: [a, b][k] }));
  assert.deepEqual(E.validarSeparacao(comValores(0, 0)), ['Informe a quantidade a separar de pelo menos um item.']);
  assert.match(E.validarSeparacao(comValores(3, 2))[0], /deixe ao menos um item/);
  assert.match(E.validarSeparacao(comValores(4, 0))[0], /Quantidade inválida em "Porta"/);
  assert.match(E.validarSeparacao(comValores(NaN, 0))[0], /Quantidade inválida/);
  assert.deepEqual(E.validarSeparacao(comValores(1.5, 0)), []);
  assert.deepEqual(E.corpoSeparar(comValores(1.5, 0), ' obs '), { itens: [{ numeroItem: 1, quantidade: 1.5 }], observacao: 'obs' });
  assert.deepEqual(E.corpoSeparar(comValores(0, 2), ''), { itens: [{ numeroItem: 2, quantidade: 2 }] });
  assert.equal(E.lerNumero('1,5'), 1.5);
  assert.equal(E.lerNumero(''), 0);
  assert.ok(Number.isNaN(E.lerNumero('abc')));
});

test('tela: "Gerar entrega do restante" infere o que NÃO foi entregue; descrição ambígua abre a lista completa', () => {
  const parcial = (itensEntregues, extra = {}) => ({ id: 9, tipo: 'parcial', detalhe: { itensEntregues }, ...extra });
  const r = E.restanteDaOcorrencia(DET, [{ id: 1, tipo: 'saiu' }, parcial([{ descricao: 'porta', qtd: 2 }])]);
  assert.equal(r.inferido, true);
  assert.deepEqual(r.linhas.map(x => [x.item, x.separar]), [[1, 1], [2, 2]]);
  const amb = E.restanteDaOcorrencia([...DET, { item: 3, descricao: 'Porta', qtd: 1 }], [parcial([{ descricao: 'Porta', qtd: 1 }])]);
  assert.equal(amb.inferido, false);
  assert.deepEqual(amb.linhas.map(x => x.separar), [0, 0, 0]);
  assert.equal(E.restanteDaOcorrencia(DET, [{ id: 1, tipo: 'ausente' }]).inferido, false);
  const det = (status, eventos, podeSeparar = true) => ({ entrega: { status }, eventos, divisao: { podeSeparar } });
  assert.equal(E.podeGerarRestante(det('ocorrencia', [parcial([])])), true);
  assert.equal(E.podeGerarRestante(det('ocorrencia', [parcial([]), { tipo: 'ausente' }])), false, 'só se a ÚLTIMA ocorrência foi parcial');
  assert.equal(E.podeGerarRestante(det('agendada', [parcial([])])), false);
  assert.equal(E.podeGerarRestante(det('ocorrencia', [parcial([])], false)), false);
});

test('tela: ?pedido=N lista TODAS as entregas do pedido e abre a primeira ainda aberta', () => {
  const lista = [{ id: 4, numero: 501, status: 'a_programar' }, { id: 1, numero: 501, status: 'entregue' }, { id: 2, numero: 502, status: 'agendada' }, { id: 3, numero: 501, status: 'cancelada' }];
  const doPedido = E.entregasDoPedido(lista, '501');
  assert.deepEqual(doPedido.map(e => e.id), [1, 3, 4]);
  assert.equal(E.entregaParaAbrir(doPedido).id, 4);
  assert.equal(E.entregaParaAbrir(E.entregasDoPedido(lista.slice(1, 2), 501)).id, 1);
  assert.equal(E.entregaParaAbrir([]), null);
  assert.deepEqual(E.filtrarSobras([{ numero: 501, cliente: 'ACME' }, { numero: 7, cliente: 'Outro' }], 'acm').map(s => s.numero), [501]);
  const js = ler('entregas.js');
  assert.ok(js.includes('estado.pedidoFiltro = pedidoDoLink') && js.includes('entregaParaAbrir(entregasDoPedido(estado.lista, pedidoDoLink))'));
});

test('entregas.html: botões de divisão/saldo com entregas.programar, formulários em grade, sem estilo inline; versões novas', () => {
  const h = ler('entregas.html');
  for (const id of ['btn-separar', 'btn-restante', 'btn-confirmar-separar', 'btn-confirmar-encerrar']) assert.match(h, new RegExp(`id="${id}"[^>]*data-perm="entregas\\.programar"`), id);
  for (const id of ['vista-separar', 'vista-encerrar', 'sp-itens', 'sp-obs', 'en-motivo', 'd-aviso', 'd-itens-titulo']) assert.match(h, new RegExp(`id="${id}"`), id);
  assert.match(h, /\.sep-linha \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 110px/);
  assert.doesNotMatch(h, /\sstyle="/);
  assert.doesNotMatch(h, /R\$|valor|preço/i);
  assert.match(h, /entregas_comum\.js\?v=202611101800/);
  assert.match(h, /entregas\.js\?v=202611101800/);
  assert.match(ler('minhas_entregas.html'), /entregas_comum\.js\?v=202611101800/);
  const js = ler('entregas.js');
  assert.ok(js.includes("data-sobra=\"gerar\"") && js.includes('Gerar entrega do saldo') && js.includes('Encerrar saldo'));
  assert.ok(js.includes('/saldo/encerrar') && js.includes('/separar'));
  assert.ok(ler('minhas_entregas.js').includes('rotuloSequencia(e)'));
});

// ---- selos "1 de 2 entregues" e menu "Ver entregas" ----
function carregarMenu(permissoes) {
  global.window = { addEventListener() {}, innerWidth: 1000, abrirPdfAutenticado() {} };
  global.document = { addEventListener() {} };
  delete require.cache[require.resolve('../inicio_menu.js')];
  require('../inicio_menu.js');
  return global.window.InicioMenu;
}

test('menu do Início: "Ver entregas (1 de 2 entregues)" com várias entregas; uma entrega = rótulo de sempre; aviso de entregas abertas', () => {
  const M = carregarMenu();
  const m = M.iniciar({ apiBase: 'https://api', loginUrl: 'login', token: () => 't', docDe: () => null, recarregar() {}, esc: s => s, pode: () => true });
  const ver = x => m.itensDoMenu({ numero: 7, cliente: 'X', situacao: 'Pronto', ...x }).find(i => /^Ver entrega/.test(i.rotulo || '')).rotulo;
  assert.equal(ver({ entregaStatus: 'agendada', qtdEntregas: 2, qtdEntregasConcluidas: 1 }), 'Ver entregas (1 de 2 entregues)');
  assert.equal(ver({ entregaStatus: 'agendada', qtdEntregas: 1, qtdEntregasConcluidas: 0 }), 'Ver entrega (Agendada)');
  assert.equal(ver({ entregaStatus: 'agendada' }), 'Ver entrega (Agendada)');
  assert.equal(M.andamentoEntregas({ qtdEntregas: 3, qtdEntregasConcluidas: 0 }), '0 de 3 entregues');
  assert.equal(M.avisoEntregasAbertas(2, 'Entregue'), 'Este pedido tem 2 entrega(s) em aberto. Marcar como Entregue mesmo assim?');
  const js = ler('inicio_menu.js');
  assert.ok(js.includes("d.aviso === 'entregas_abertas'") && js.includes('confirmarEntregasAbertas: true'));
});

test('selos "X de Y entregues" no Início, Pedidos e Financeiro do cliente (só com mais de uma entrega); Pedidos confirma entregas abertas', () => {
  for (const f of ['inicio.html', 'painel_inicial.html', 'clientes.html']) {
    const h = ler(f);
    assert.ok(h.includes('Number(') && /qtdEntregas\) > 1 \? `\$\{Number\([a-z]+\.qtdEntregasConcluidas\) \|\| 0\} de \$\{Number\([a-z]+\.qtdEntregas\)\} entregues`/.test(h), f);
  }
  assert.ok(ler('painel_inicial.html').includes('${seloAndamento(x)}'));
  assert.ok(ler('clientes.html').includes('${seloAndamento(p)}'));
  const p = ler('painel_inicial.html');
  assert.ok(p.includes("err.dados.aviso === 'entregas_abertas'") && p.includes('confirmarEntregasAbertas: true'));
  for (const f of ['inicio.html', 'calendario.html', 'calendario_dia.html']) assert.match(ler(f), /inicio_menu\.js\?v=202611101800/, f);
});

test('portal: as páginas mostram o rótulo "entrega" que a API já devolve (inclusive "Entregue parcialmente: X de Y")', () => {
  assert.ok(ler('portal/public/pedidos.js').includes('texto(p.entrega)'));
  assert.ok(ler('portal/public/pedido.js').includes("getElementById('entrega').textContent = texto(p.entrega)"));
});
