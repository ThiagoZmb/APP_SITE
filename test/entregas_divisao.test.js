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
  assert.deepEqual(d.itens, [{ item: 2, descricao: 'Trilho', qtd: 1.5 }]);
  assert.equal(d.qtdItens, 1);
  assert.equal((await separar(chamar, nova.id, [{ numeroItem: 2, quantidade: 1 }])).status, 403);
});

test('varredura com várias entregas: sai de Pronto para outra situação que não Em Produção cancela TODAS as A programar (Agendada fica); volta a Pronto reabre só as que ela cancelou; nada duplicado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco);
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1 }])).status, 201);
  assert.equal((await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1 }])).status, 201);
  const [um, dois, tres] = [1, 2, 3].map(s => banco.entregas.find(e => e.sequencia === s));
  Object.assign(banco.entregas.find(e => e.id === tres.id), { status: 'agendada', tipo: 'retirada', data_agendada: '2026-11-20' });
  assert.equal((await chamar(`/entregas/${dois.id}/cancelar`, 'POST', { motivo: 'equipe cancelou' })).status, 200);
  banco.pedidos[0].SITUACAO = 'Orçamento'; // (Em Produção não cancela mais: decisão do dono, 2026-11-11)
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
  banco.f.regras.unshift(
    // entregas do número, travadas depois do pedido (ordem ped_orc -> web_entregas)
    [/^SELECT id, status FROM web_entregas WHERE numero = \? FOR UPDATE$/, (sql, [n]) =>
      banco.entregas.filter(e => e.numero === Number(n)).map(e => ({ id: e.id, status: e.status }))],
    // encerramento junto com o menu: UPDATE ... WHERE id IN (...) AND status IN (...)
    [/^UPDATE web_entregas SET status = \?, atualizado_em = \? WHERE id IN \(([^)]*)\) AND status IN \(([^)]*)\)$/, (sql, params) => {
      const nIds = /id IN \(([^)]*)\)/.exec(sql)[1].split(',').length;
      const [para, quando, ...resto] = params; const ids = resto.slice(0, nIds), de = resto.slice(nIds);
      const alvo = banco.entregas.filter(e => ids.includes(e.id) && de.includes(e.status));
      alvo.forEach(e => { e.status = para; e.atualizado_em = quando; });
      return { affectedRows: alvo.length };
    }],
    [/^INSERT INTO web_entrega_eventos \(entrega_id, quando, usuario, tipo, motivo, detalhe, entregue_a\) VALUES/, (sql, params) => {
      for (let i = 0; i < params.length; i += 7) {
        const [entrega_id, quando, usuario, tipo, motivo, detalhe, entregue_a] = params.slice(i, i + 7);
        banco.entregaEventos.push({ id: banco.entregaEventos.length + 1, entrega_id, quando, usuario, tipo, motivo, detalhe, entregue_a });
      }
      return { affectedRows: params.length / 7 };
    }]);
  return banco;
}

test('menu "Entregue" com entrega aberta: 409 com aviso (nada gravado); com confirmarEntregasAbertas grava e ENCERRA junto a que esperava', async t => {
  const banco = pedidoComEntregas(['entregue', 'agendada']);
  const { chamar } = await prepararPedOrc(t, { banco });
  let r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Entregue' });
  assert.equal(r.status, 409);
  const d = await r.json();
  assert.deepEqual([d.aviso, d.entregasAbertas, d.entregasEncerrar, d.entregasEmCurso], ['entregas_abertas', 1, 1, 0]);
  assert.match(d.error, /1 entrega\(s\) em aberto/);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Pronto');
  assert.equal(banco.auditoria.length, 0);
  assert.equal(banco.entregas.find(e => e.id === 2).status, 'agendada', 'sem confirmação nada muda');
  r = await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Entregue', confirmarEntregasAbertas: true });
  assert.equal(r.status, 200);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Entregue');
  assert.equal(banco.pedOrc[0].DATA_ENTREGA, hojeLocal());
  assert.deepEqual(JSON.parse(banco.auditoria[0].detalhe), { cliente: 'CLIENTE TESTE', de: 'Pronto', para: 'Entregue' }, 'auditoria de sempre');
  assert.equal(banco.auditoria[1].acao, 'pedido_situacao_entregas_abertas');
  assert.deepEqual(JSON.parse(banco.auditoria[1].detalhe), { para: 'Entregue', entregasAbertas: 1, entregasEncerradas: 1 });
  // decisão 2026-11-11: pedido entregue não tem o que entregar -> a Agendada vira 'entregue' (nunca 'cancelada'), com evento explicando
  assert.equal(banco.entregas.find(e => e.id === 2).status, 'entregue');
  assert.equal(banco.entregas.find(e => e.id === 1).status, 'entregue', 'a já concluída não muda');
  const ev = banco.entregaEventos.filter(v => v.entrega_id === 2);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].tipo, ev[0].usuario, ev[0].motivo, JSON.parse(ev[0].detalhe).statusAnterior],
    ['encerrada', 'Thiago', 'Pedido marcado como Entregue pelo menu de situação', 'agendada']);
  // a trava das entregas vem DEPOIS da do pedido (ordem ped_orc -> web_entregas)
  const sqls = banco.f.chamadas.map(c => c.sql);
  const iPed = sqls.findIndex(s => /FROM ped_orc[\s\S]*FOR UPDATE/.test(s)), iEnt = sqls.findIndex(s => /^SELECT id, status FROM web_entregas WHERE numero = \? FOR UPDATE$/.test(s));
  assert.ok(iPed >= 0 && iEnt > iPed, 'ped_orc travado antes de web_entregas');
});

test('menu "Retirado" com A programar + Ocorrência + Em rota: encerra as duas que esperavam como retirado; Em rota fica aberta', async t => {
  const banco = pedidoComEntregas(['a_programar', 'ocorrencia', 'em_rota', 'cancelada']);
  const { chamar } = await prepararPedOrc(t, { banco });
  const d = await (await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Retirado' })).json();
  assert.deepEqual([d.entregasAbertas, d.entregasEncerrar, d.entregasEmCurso], [3, 2, 1]);
  assert.equal((await chamar('/ped_orc/Pedido/5/situacao', 'POST', { situacao: 'Retirado', confirmarEntregasAbertas: true })).status, 200);
  assert.deepEqual(banco.entregas.map(e => e.status), ['retirado', 'retirado', 'em_rota', 'cancelada']);
  assert.deepEqual(banco.entregaEventos.map(v => [v.entrega_id, v.tipo, JSON.parse(v.detalhe).statusAnterior]), [[1, 'encerrada', 'a_programar'], [2, 'encerrada', 'ocorrencia']]);
  assert.deepEqual(JSON.parse(banco.auditoria[1].detalhe), { para: 'Retirado', entregasAbertas: 3, entregasEncerradas: 2 });
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
  assert.match(h, /#painel \.sep-cartao \{ display: flex; flex-direction: column;/);
  assert.match(h, /\.sep-passo \{ flex: 0 0 auto; width: 44px; height: 44px;/, 'botões − e + com área de toque de 44 px');
  assert.doesNotMatch(h, /\.sep-linha/);
  assert.match(h, /id="sp-resumo"[^>]*aria-live="polite"/);
  assert.doesNotMatch(h, /\sstyle="/);
  assert.doesNotMatch(h, /R\$|valor|preço/i);
  assert.match(h, /entregas_comum\.js\?v=202611112000/);
  assert.match(h, /entregas\.js\?v=202611191800/);
  assert.match(ler('minhas_entregas.html'), /minhas_entregas\.js\?v=202611191400/);
  assert.match(ler('minhas_entregas.html'), /entregas_comum\.js\?v=202611112000/);
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
  assert.equal(M.avisoEntregasAbertas(2, 'Entregue'), 'Este pedido tem 2 entrega(s) em aberto. Marcar como Entregue mesmo assim?', 'sem contagens (servidor antigo): texto curto');
  assert.equal(M.avisoEntregasAbertas(2, 'Retirado', 1, 1), 'Este pedido tem 2 entrega(s) em aberto. 1 (a programar, agendada ou com ocorrência) será encerrada junto como Retirado.'
    + ' 1 em rota/enviada continua aberta: conclua ou cancele na tela de Entregas. Marcar como Retirado mesmo assim?');
  assert.equal(M.avisoEntregasAbertas(3, 'Entregue', 3, 0), 'Este pedido tem 3 entrega(s) em aberto. 3 (a programar, agendada ou com ocorrência) serão encerradas junto como Entregue. Marcar como Entregue mesmo assim?');
  assert.ok(ler('inicio_menu.js').includes('avisoEntregasAbertas(d.entregasAbertas, nome, d.entregasEncerrar, d.entregasEmCurso)'));
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
  for (const f of ['inicio.html', 'calendario.html', 'calendario_dia.html']) assert.match(ler(f), /inicio_menu\.js\?v=202611171200/, f);
});

test('portal: as páginas mostram o rótulo "entrega" que a API já devolve (inclusive "Entregue parcialmente: X de Y")', () => {
  assert.ok(ler('portal/public/pedidos.js').includes('texto(p.entrega)'));
  assert.ok(ler('portal/public/pedido.js').includes("getElementById('entrega').textContent = texto(p.entrega)"));
});

// ======================= observação POR ITEM (cartão do "Separar em outra entrega") =======================
test('lerSeparacao: observação por item é aparada, saneada (controles e quebras viram espaço), vazia vira ausente e acima de 255 = 400', () => {
  const r = lerSeparacao({ itens: [
    { numeroItem: 1, quantidade: 1, observacao: '  levar \n com\tferragem\u0007 separada  ' },
    { numeroItem: 2, quantidade: 1, observacao: '   ' },
    { numeroItem: 3, quantidade: 1 },
    { numeroItem: 4, quantidade: 1, observacao: null }] });
  assert.deepEqual(r.itens, [{ numeroItem: 1, quantidade: 1, observacao: 'levar com ferragem separada' }, { numeroItem: 2, quantidade: 1 },
    { numeroItem: 3, quantidade: 1 }, { numeroItem: 4, quantidade: 1 }]);
  assert.equal(lerSeparacao({ itens: [{ numeroItem: 1, quantidade: 1, observacao: 'x'.repeat(255) }] }).itens[0].observacao.length, 255);
  for (const ruim of ['x'.repeat(256), 123, { a: 1 }, ['x']]) {
    assert.throws(() => lerSeparacao({ itens: [{ numeroItem: 1, quantidade: 1, observacao: ruim }] }), e => e.status === 400, String(ruim).slice(0, 20));
  }
  // a observação da entrega nova (de fora) continua com o limite de 500
  assert.equal(lerSeparacao({ itens: [{ numeroItem: 1, quantidade: 1 }], observacao: 'y'.repeat(500) }).observacao.length, 500);
});

test('separarItens: a observação vai só para o item da entrega NOVA; o resto da origem mantém a que já tinha', () => {
  const disp = [{ item: 1, descricao: 'Porta', qtd: 3, unidade: null, observacao: 'da origem' }, { item: 2, descricao: 'Trilho', qtd: 2, unidade: null, observacao: null }];
  const s = separarItens(disp, [{ numeroItem: 1, quantidade: 1, observacao: 'nova' }]);
  assert.deepEqual(s.nova.map(i => [i.item, i.qtd, i.observacao]), [[1, 1, 'nova']]);
  assert.deepEqual(s.resto.map(i => [i.item, i.qtd, i.observacao]), [[1, 2, 'da origem'], [2, 2, null]]);
});

test('separar: observação por item gravada na cópia da entrega NOVA; devolvida em itensDetalhe e itens; produto e obs do orçamento só leitura', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco);
  Object.assign(banco.itens.find(i => i.ITEM === 1), { PRODUTO: 'Estrutura metálica editável', OBSERVACAO: 'conferir o gabarito' });
  const r = await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1, observacao: '  levar com a ferragem separada ' }, { numeroItem: 2, quantidade: 1 }]);
  assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
  const nova = banco.entregas.find(e => e.sequencia === 2);
  const grav = banco.entregaItens.filter(i => i.entrega_id === nova.id).sort((a, b) => a.numero_item - b.numero_item).map(i => [i.numero_item, i.observacao ?? null]);
  assert.deepEqual(grav, [[1, 'levar com a ferragem separada'], [2, null]]);
  assert.ok(banco.entregaItens.filter(i => i.entrega_id === origem.id).every(i => (i.observacao ?? null) === null), 'a origem não herda a observação');
  const d = await (await chamar(`/entregas/${nova.id}`)).json();
  assert.deepEqual(d.itensDetalhe.find(i => i.item === 1), { item: 1, descricao: 'Porta', qtd: 1, observacao: 'levar com a ferragem separada',
    produto: 'Estrutura metálica editável', obsPedido: 'conferir o gabarito' });
  assert.deepEqual(d.itensDetalhe.find(i => i.item === 2), { item: 2, descricao: 'Trilho', qtd: 1 }, 'sem observação nem produto: formato antigo');
  assert.deepEqual(d.itens, [{ descricao: 'Porta', qtd: 1, observacao: 'levar com a ferragem separada' }, { descricao: 'Trilho', qtd: 1 }]);
  // dividir de novo a nova: o que fica nela mantém a observação
  assert.equal((await separar(chamar, nova.id, [{ numeroItem: 2, quantidade: 1 }])).status, 201);
  assert.deepEqual(listaDe(banco, nova.id), [[1, 1]]);
  assert.equal(banco.entregaItens.find(i => i.entrega_id === nova.id && i.numero_item === 1).observacao, 'levar com a ferragem separada');
});

test('separar: observação do item acima de 255 caracteres ou que não é texto = 400 e nada é gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const origem = cenario(banco);
  for (const observacao of ['x'.repeat(256), 5]) {
    const r = await separar(chamar, origem.id, [{ numeroItem: 1, quantidade: 1, observacao }]);
    assert.equal(r.status, 400);
  }
  assert.equal(banco.entregas.length, 1);
  assert.equal(banco.entregaItens.length, 0);
  assert.equal(banco.f.chamadas.filter(c => /^(INSERT|DELETE|UPDATE)/.test(c.sql)).length, 0);
});

test('motorista: o detalhe da entrega mostra a observação de cada item (e a lista de itens continua igual sem ela)', async t => {
  const equipe = await prepararEntregas(t);
  const banco = equipe.banco;
  const origem = cenario(banco);
  assert.equal((await separar(equipe.chamar, origem.id, [{ numeroItem: 1, quantidade: 1, observacao: 'levar com a ferragem separada' }, { numeroItem: 2, quantidade: 1 }])).status, 201);
  const nova = banco.entregas.find(e => e.sequencia === 2);
  Object.assign(nova, { status: 'agendada', tipo: 'motorista', motorista_codigo: 21, data_agendada: hojeLocal() });
  Object.assign(banco.itens.find(i => i.ITEM === 1), { OBSERVACAO: 'conferir o gabarito' });
  const { chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: { codigo: 21, nome: 'Motorista Um' }, banco });
  const d = await (await chamar(`/minhas_entregas/${nova.id}`)).json();
  assert.deepEqual(d.itens, [{ item: 1, descricao: 'Porta', qtd: 1, observacao: 'levar com a ferragem separada' }, { item: 2, descricao: 'Trilho', qtd: 1 }]);
  assert.ok(!JSON.stringify(d).includes('conferir'), 'a observação do orçamento não vai ao motorista');
});

// ---- tela: ficha, passos, resumo e cartão ----
test('tela: fichaDoItem separa o nome e as etiquetas "Rótulo: valor" sem inventar nada', () => {
  const desc = 'Tam: 660x400mm | Per: 1036 Pintura Sólida Alumínio | Pux: 2018 E | Rev: Tela expandida (1,5mm) Pintado Sólido | Portas: 2 | Furos: 2';
  const f = E.fichaDoItem(desc, 'Estrutura metálica editável', 3);
  assert.equal(f.nome, 'Estrutura metálica editável');
  assert.deepEqual(f.etiquetas.map(e => [e.rotulo, e.texto]), [['Tamanho', '660x400mm'], ['Perfil', '1036 Pintura Sólida Alumínio'], ['Puxador', '2018 E'],
    ['Revestimento', 'Tela expandida (1,5mm) Pintado Sólido'], ['Portas', '2'], ['Furos', '2']]);
  assert.equal(E.fichaDoItem(desc, '', 7).nome, 'Item 7', 'sem produto nem nome no texto: "Item N"');
  const comNome = E.fichaDoItem('Porta de giro Tam: 800x2100 | Furos: 2', '', 1);
  assert.equal(comNome.nome, 'Porta de giro');
  assert.deepEqual(comNome.etiquetas.map(e => [e.rotulo, e.texto]), [['Tamanho', '800x2100'], ['Furos', '2']]);
  assert.deepEqual(E.fichaDoItem('Porta simples', '', 1), { nome: 'Porta simples', etiquetas: [] });
  assert.deepEqual(E.fichaDoItem('Tam: 1 | texto solto', '', 2).etiquetas.map(e => [e.rotulo, e.texto]), [['Tamanho', '1'], ['', 'texto solto']]);
  assert.deepEqual(E.fichaDoItem('', null, 4), { nome: 'Item 4', etiquetas: [] });
});

test('tela: passo e limites da quantidade (inteiro de 1 em 1; fracionado de 0,5 em 0,5; nunca abaixo de 0 nem acima do disponível)', () => {
  assert.equal(E.passoDe(2), 1);
  assert.equal(E.passoDe(1.5), 0.5);
  assert.equal(E.ajustarQuantidade(0, -1, 2, 1), 0);
  assert.equal(E.ajustarQuantidade(1, 1, 2, 1), 2);
  assert.equal(E.ajustarQuantidade(2, 1, 2, 1), 2);
  assert.equal(E.ajustarQuantidade(1, 1, 1.5, 0.5), 1.5);
  assert.equal(E.ajustarQuantidade(NaN, 1, 3, 1), 1, 'campo inválido conta como 0');
  assert.equal(E.ajustarQuantidade(2.5, 1, 2.5, 1), 2.5, 'máximo fracionado respeitado');
});

test('tela: resumo do "Separar" (itens · unidades), aviso de marcar tudo e botão só quando dá para dividir', () => {
  const l = E.linhasSeparacao(DET);
  const com = (a, b) => l.map((x, k) => ({ ...x, separar: [a, b][k] }));
  assert.deepEqual(E.resumoSeparacao(com(0, 0)), { itens: 0, unidades: 0, texto: 'Nenhum item selecionado', podeEnviar: false, aviso: '' });
  assert.deepEqual(E.resumoSeparacao(com(2, 0)), { itens: 1, unidades: 2, texto: '1 item selecionado · 2 unidades', podeEnviar: true, aviso: '' });
  assert.equal(E.resumoSeparacao(com(1, 0)).texto, '1 item selecionado · 1 unidade');
  assert.equal(E.resumoSeparacao(com(1.5, 2)).texto, '2 itens selecionados · 3,5 unidades');
  const tudo = E.resumoSeparacao(com(3, 2));
  assert.equal(tudo.podeEnviar, false);
  assert.match(tudo.aviso, /marcou todos os itens/);
  const alto = E.resumoSeparacao(com(4, 0));
  assert.equal(alto.podeEnviar, false);
  assert.match(alto.aviso, /Quantidade inválida/);
  // observação do item acima de 255 caracteres impede o envio
  const longa = E.validarSeparacao(l.map((x, k) => ({ ...x, separar: k === 0 ? 1 : 0, observacao: 'x'.repeat(256) })));
  assert.match(longa[0], /passa de 255 caracteres/);
  // observação de item que não vai (quantidade 0) não é enviada nem conta
  assert.deepEqual(E.corpoSeparar(l.map((x, k) => ({ ...x, separar: k === 0 ? 1 : 0, observacao: k === 0 ? ' levar com a ferragem ' : 'não vai' })), ''),
    { itens: [{ numeroItem: 1, quantidade: 1, observacao: 'levar com a ferragem' }] });
});

test('tela: cartão do item é estático (sem style=), escapa o texto, tem rótulos associados e o campo de observação', () => {
  const l = { item: 3, descricao: 'Tam: 660x400mm | Per: 1036 <b>x</b> | Pux: 2018 E', produto: 'Estrutura <i>metálica</i>', obsPedido: 'conferir "gabarito"', qtd: 2, separar: 1, observacao: 'a<b' };
  const h = E.htmlCartaoSeparacao(l, 0);
  assert.doesNotMatch(h, /\sstyle=/);
  assert.doesNotMatch(h, /<b>x<\/b>|<i>/, 'HTML vindo do banco não entra cru');
  assert.match(h, /Estrutura &lt;i&gt;metálica&lt;\/i&gt;/);
  assert.match(h, /<span class="rot">Tamanho:<\/span> <b>660x400mm<\/b>/);
  assert.match(h, /Item 3/);
  assert.match(h, /<li class="sep-etq-disp"><span class="rot">Disponível:<\/span> <b>2<\/b><\/li>/);
  assert.match(h, /<li class="sep-etq-obs"><span class="rot">Obs\. do pedido:<\/span> <b>conferir &quot;gabarito&quot;<\/b><\/li>/);
  assert.match(h, /id="sp-item-0"[^>]*min="0"[^>]*max="2"[^>]*step="any"[^>]*value="1"/);
  assert.match(h, /data-acao="menos"[^>]*aria-label="Diminuir/);
  assert.match(h, /data-acao="mais"[^>]*aria-label="Aumentar/);
  assert.match(h, /data-acao="todos"/);
  assert.match(h, /de 2<\/span>/);
  assert.doesNotMatch(h, /<textarea|sp-obs-0/, 'o cartão só tem o campo da quantidade');
  // quantidade fracionada: "de 1,5" e max com ponto
  const f = E.htmlCartaoSeparacao({ item: 1, descricao: 'Trilho', qtd: 1.5, separar: 0 }, 1);
  assert.match(f, /max="1\.5"/);
  assert.match(f, /Disponível:<\/span> <b>1,5<\/b>/);
  assert.doesNotMatch(f, /Obs\. do pedido/);
});

test('tela: "Gerar entrega do restante" pré-preenche os cartões e a tela liga o resumo, o botão e a delegação dos passos', () => {
  const r = E.restanteDaOcorrencia([{ item: 1, descricao: 'Porta', qtd: 3, produto: 'Estrutura', obsPedido: 'x' }, { item: 2, descricao: 'Trilho', qtd: 2 }],
    [{ id: 1, tipo: 'parcial', detalhe: { itensEntregues: [{ descricao: 'Porta', qtd: 2 }] } }]);
  assert.equal(r.inferido, true);
  assert.deepEqual(r.linhas.map(x => [x.item, x.separar, x.observacao]), [[1, 1, ''], [2, 2, '']]);
  assert.equal(r.linhas[0].produto, 'Estrutura');
  assert.match(E.htmlCartaoSeparacao(r.linhas[0], 0), /id="sp-item-0"[^>]*value="1"/);
  const js = ler('entregas.js');
  for (const trecho of ["$('sp-itens').addEventListener('click', mexerNoCartao)", "$('sp-itens').addEventListener('input', atualizarSeparacao)",
    "$('btn-confirmar-separar').disabled = !r.podeEnviar", 'atualizarSeparacao();', "'sp-resumo-texto'"]) assert.ok(js.includes(trecho), trecho);
  assert.ok(js.includes('restante ? restanteDaOcorrencia(det.itensDetalhe, det.eventos) : { inferido: false, linhas: linhasSeparacao(det.itensDetalhe) }'), 'restante e saldo usam o mesmo formulário');
  assert.ok(js.includes('Obs.: ${esc(i.observacao)}'), 'detalhe da equipe mostra a observação do item');
  assert.ok(ler('minhas_entregas.js').includes('Obs.: ${esc(i.observacao)}'), 'cartão do motorista mostra a observação do item');
  assert.match(ler('minhas_entregas.html'), /\.obs-item \{[^}]*var\(--/);
});
