// Várias entregas por pedido (entrega parcial), etapas 1 a 3:
//  1) blindagem: as listas que juntam ped_orc com web_entregas trazem UMA linha por pedido (entrega principal + contagens);
//  2) banco: coberto em test/instalacao.test.js (sequencia, uk_numero_seq, web_entrega_itens, migração);
//  3) regra da última baixa: o pedido só vira Entregue/Retirado quando todas as entregas não canceladas estão concluídas
//     e não sobra item sem entrega.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { entregaPrincipal, resumoEntregas, fechamentoDoPedido, pedidoPara } = require('../calculo/entregas');
const { projetarPedido } = require('../calculo/portal_pedidos');
const { REGEX_VALOR } = require('../seguranca/valores');
const { juntarEntregas, JUNCAO_PRINCIPAL } = require('./apoio/juncaoEntregas');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { hojeLocal } = require('../rotas/transacao');

// ======================= cálculo (puro) =======================
test('entregaPrincipal: ativa de data mais cedo > concluída mais recente > cancelada mais recente; uma só = ela', () => {
  assert.equal(entregaPrincipal([]), null);
  assert.equal(entregaPrincipal([{ id: 7, status: 'cancelada' }]).id, 7);
  assert.equal(entregaPrincipal([{ id: 3, status: 'entregue' }]).id, 3);
  // ativas: data mais cedo primeiro; sem data por último; empate pelo id menor
  const ativas = [{ id: 1, status: 'a_programar' }, { id: 2, status: 'agendada', data_agendada: '2026-11-20' },
    { id: 3, status: 'em_rota', data_agendada: '2026-11-12' }, { id: 4, status: 'agendada', data_agendada: '2026-11-12' }];
  assert.equal(entregaPrincipal(ativas).id, 3);
  assert.equal(entregaPrincipal([{ id: 5, status: 'a_programar' }, { id: 2, status: 'a_programar' }]).id, 2);
  // ativa ganha de concluída e de cancelada
  assert.equal(entregaPrincipal([{ id: 1, status: 'entregue' }, { id: 2, status: 'a_programar' }, { id: 3, status: 'cancelada' }]).id, 2);
  // sem ativa: a concluída mais recente (não a cancelada)
  assert.equal(entregaPrincipal([{ id: 1, status: 'entregue' }, { id: 2, status: 'retirado' }, { id: 3, status: 'cancelada' }]).id, 2);
  assert.equal(entregaPrincipal([{ id: 1, status: 'cancelada' }, { id: 4, status: 'cancelada' }]).id, 4);
  // 'enviada' (aguardando comprovante) ainda é ativa
  assert.equal(entregaPrincipal([{ id: 1, status: 'entregue' }, { id: 2, status: 'enviada' }]).id, 2);
});

test('resumoEntregas: canceladas não contam; concluída = entregue ou retirado', () => {
  assert.deepEqual(resumoEntregas([]), { qtdEntregas: 0, qtdEntregasConcluidas: 0 });
  assert.deepEqual(resumoEntregas([{ status: 'entregue' }, { status: 'agendada' }, { status: 'cancelada' }]), { qtdEntregas: 2, qtdEntregasConcluidas: 1 });
  assert.deepEqual(resumoEntregas([{ status: 'retirado' }, { status: 'enviada' }]), { qtdEntregas: 2, qtdEntregasConcluidas: 1 });
  for (const k of ['qtdEntregas', 'qtdEntregasConcluidas']) assert.ok(!REGEX_VALOR.test(k), k);
});

test('fechamentoDoPedido: com UMA entrega é igual a pedidoPara (o comportamento de antes)', () => {
  for (const status of ['entregue', 'retirado']) {
    const r = fechamentoDoPedido({ entregas: [{ id: 1, status }] });
    assert.deepEqual([r.fechar, r.situacao], [true, pedidoPara(status)]);
  }
});

test('fechamentoDoPedido: várias entregas', () => {
  const f = (entregas, extra = {}) => fechamentoDoPedido({ entregas, ...extra });
  assert.equal(f([{ id: 1, status: 'entregue' }, { id: 2, status: 'agendada' }]).fechar, false);
  assert.equal(f([{ id: 1, status: 'entregue' }, { id: 2, status: 'agendada' }]).motivo, 'entregas_abertas');
  assert.equal(f([{ id: 1, status: 'entregue' }, { id: 2, status: 'enviada' }]).fechar, false);
  assert.deepEqual(f([{ id: 1, status: 'entregue' }, { id: 2, status: 'retirado' }]), { fechar: true, situacao: 'Entregue', motivo: null });
  assert.deepEqual(f([{ id: 1, status: 'retirado' }, { id: 2, status: 'retirado' }]), { fechar: true, situacao: 'Retirado', motivo: null });
  // cancelada não conta (nem para fechar nem para Retirado)
  assert.deepEqual(f([{ id: 1, status: 'retirado' }, { id: 2, status: 'cancelada' }]), { fechar: true, situacao: 'Retirado', motivo: null });
  assert.equal(f([{ id: 1, status: 'cancelada' }]).fechar, false);
  // itens: todas com lista e sobra item -> não fecha; cobriu tudo (inclusive quantidade não inteira) -> fecha
  const itensPedido = [{ item: 1, qtd: 2 }, { item: 2, qtd: 3.5 }];
  const parcial = new Map([[1, [{ numero_item: 1, quantidade: 2 }]], [2, [{ numero_item: 2, quantidade: '1.5' }]]]);
  assert.deepEqual(f([{ id: 1, status: 'entregue' }, { id: 2, status: 'entregue' }], { itensPorEntrega: parcial, itensPedido }),
    { fechar: false, situacao: null, motivo: 'itens_sem_entrega' });
  const tudo = new Map([[1, [{ numero_item: 1, quantidade: 2 }, { numero_item: 2, quantidade: 2 }]], [2, [{ numero_item: 2, quantidade: '1.5' }]]]);
  assert.equal(f([{ id: 1, status: 'entregue' }, { id: 2, status: 'entregue' }], { itensPorEntrega: tudo, itensPedido }).fechar, true);
  // uma das entregas sem lista = pedido inteiro: fecha mesmo que as listas das outras não cubram tudo
  const umaSem = new Map([[1, [{ numero_item: 1, quantidade: 1 }]]]);
  assert.equal(f([{ id: 1, status: 'entregue' }, { id: 2, status: 'entregue' }], { itensPorEntrega: umaSem, itensPedido }).fechar, true);
});

// ======================= etapa 1: listas com UMA linha por pedido =======================
const { criarPoolFalso } = require('./apoio/poolFalso');
const { subir } = require('./apoio/servidor');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { PERFIS_INICIAIS } = require('../seguranca/permissoes');
aceitarSidDeTeste(sessoes);

// pedido 10 com DUAS entregas (uma entregue, outra agendada), 11 com uma, 12 sem entrega
const PEDIDOS = [
  { NUMERO: 10, RAZAO_SOCIAL: 'A', TOTAL: 1000, SITUACAO: 'Pronto', FINANCEIRO: 'A Receber' },
  { NUMERO: 11, RAZAO_SOCIAL: 'A', TOTAL: 200, SITUACAO: 'Pronto', FINANCEIRO: 'A Receber' },
  { NUMERO: 12, RAZAO_SOCIAL: 'A', TOTAL: 30, SITUACAO: 'Em Produção', FINANCEIRO: 'A Receber' }
];
const ENTREGAS = [
  { id: 1, numero: 10, status: 'entregue', data_agendada: '2026-11-05' },
  { id: 2, numero: 10, status: 'agendada', data_agendada: '2026-11-15' },
  { id: 3, numero: 11, status: 'a_programar', data_agendada: null }
];
const linhasLista = sql => PEDIDOS.flatMap(p => juntarEntregas(sql, p.NUMERO, ENTREGAS).map(({ en, qtd }) => ({
  numero: p.NUMERO, cliente: p.RAZAO_SOCIAL, valor: p.TOTAL, situacao: p.SITUACAO, prontoEm: '', dataEntrega: '',
  entregaStatus: en ? en.status : null, dataAgendada: en ? en.data_agendada : null, ...qtd })));

const ADMIN = new Set(PERFIS_INICIAIS.find(p => p.nome === 'Administrador').permissoes);
async function prepararLista(t, regras) {
  const f = criarPoolFalso(regras);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Admin', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'Administrador' },
    estados: [], ativo: true, permissoes: ADMIN }));
  t.mock.method(console, 'warn', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const tk = jwt.sign({ id: 1, nome: 'Admin', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
  return { f, chamar: caminho => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + tk } }) };
}

test('simulador fiel: o LEFT JOIN direto (jeito antigo) repetiria o pedido com 2 entregas', () => {
  const antigo = "FROM ped_orc p LEFT JOIN web_entregas en ON en.numero = p.NUMERO AND p.TIPO = 'Pedido'";
  assert.equal(juntarEntregas(antigo, 10, ENTREGAS).length, 2);
  const { juntarEntregaPrincipal } = require('../rotas/entregas_resumo');
  const novo = `FROM ped_orc p ${juntarEntregaPrincipal({ condicao: " AND p.TIPO = 'Pedido'" })}`;
  assert.match(novo, JUNCAO_PRINCIPAL);
  assert.equal(juntarEntregas(novo, 10, ENTREGAS).length, 1);
  assert.doesNotMatch(novo, /OVER\s*\(|ROW_NUMBER/i, 'sem window functions (MySQL 5.7)');
});

for (const caminho of ['/dados_lista?tipo=Pedido', '/dados_pedidos', '/dados_pedidos_rj']) {
  test(`${caminho}: pedido com 2 entregas aparece UMA vez, a soma dos valores não dobra e traz as contagens`, async t => {
    const { f, chamar } = await prepararLista(t, [[/as entregaStatus/, linhasLista]]);
    const r = await chamar(caminho);
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.deepEqual(d.map(x => x.numero), [10, 11, 12]);
    assert.equal(d.reduce((s, x) => s + x.valor, 0), 1230);
    const p10 = d.find(x => x.numero === 10);
    // principal = a entrega ainda ativa (a agendada), não a já entregue
    assert.deepEqual([p10.entregaStatus, p10.dataAgendada, p10.qtdEntregas, p10.qtdEntregasConcluidas], ['agendada', '2026-11-15', 2, 1]);
    const p11 = d.find(x => x.numero === 11);
    assert.deepEqual([p11.entregaStatus, p11.qtdEntregas, p11.qtdEntregasConcluidas], ['a_programar', 1, 0]);
    const p12 = d.find(x => x.numero === 12);
    assert.deepEqual([p12.entregaStatus, p12.qtdEntregas, p12.qtdEntregasConcluidas], [null, 0, 0]);
    const sql = f.chamadas.find(c => /as entregaStatus/.test(c.sql)).sql;
    assert.match(sql, JUNCAO_PRINCIPAL);
    assert.match(sql, /AS qtdEntregas, COALESCE\(er\.qtd_concluidas, 0\) AS qtdEntregasConcluidas/);
  });
}

test('/clientes/financeiro: pedido com 2 entregas aparece UMA vez, com contagens; valores não dobram', async t => {
  const { f, chamar } = await prepararLista(t, [
    [/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, RAZAO_SOCIAL: 'A', ESTADO: 'RJ' }]],
    [/FROM ped_orc p\b.*web_entregas/s, sql => PEDIDOS.flatMap(p => juntarEntregas(sql, p.NUMERO, ENTREGAS).map(({ en, qtd }) => ({
      NUMERO: p.NUMERO, DATA: '2026-10-01', TOTAL: p.TOTAL, SITUACAO: p.SITUACAO, FINANCEIRO: p.FINANCEIRO, ENTREGA_STATUS: en ? en.status : null,
      QTD_ENTREGAS: qtd.qtdEntregas, QTD_ENTREGAS_CONCLUIDAS: qtd.qtdEntregasConcluidas })))],
    [/AS qtd_entregas_pendentes/, [{ qtd_entregas_pendentes: 2 }]],
    [/AS atrasado/, [{ receber: 0, atrasado: 0 }]],
    [/SITUACAO <> 'Cancelado'/, [{ receber: 1230 }]]
  ]);
  const r = await chamar('/clientes/financeiro/5');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d.pedidos.map(p => p.numero), [10, 11, 12]);
  assert.equal(d.pedidos.reduce((s, p) => s + p.valor, 0), 1230);
  assert.deepEqual(d.pedidos.map(p => [p.entregaStatus, p.qtdEntregas, p.qtdEntregasConcluidas]), [['agendada', 2, 1], ['a_programar', 1, 0], [null, 0, 0]]);
  assert.match(f.chamadas.find(c => /FROM ped_orc p\b.*web_entregas/s.test(c.sql)).sql, JUNCAO_PRINCIPAL);
});

// ---- portal do cliente: lista e detalhe ----
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { criarPoolPedidos } = require('./apoio/poolPedidosPortal');
const { criarSessoesPortal } = require('../portal/sessoes');
const { criarAcessoPortal } = require('../portal/acesso');
const { cabecalhosPortal } = require('../portal/cabecalhos');
const { criarRegistro } = require('../seguranca/rotas');
const { registrarPortalPedidos } = require('../rotas/portal_pedidos');

async function montarPortal(t, { pedidos, entregas }) {
  const banco = criarBancoPortal();
  const d = banco.dados;
  d.clientes.push({ CODIGO: 40, RAZAO_SOCIAL: 'ACME LTDA' });
  d.empresas.push({ cliente_codigo: 40, situacao: 'ativa' });
  d.usuarios.push({ id: 1, email: 'ana@acme.com', cliente_codigo: 40, papel: 'admin_geral', situacao: 'ativo' });
  const poolPedidos = criarPoolPedidos({ pedidos, clientes: d.clientes, entregas });
  const config = { ativo: true, baseUrl: 'https://portal.exemplo.com', chaveCripto: '', termoVersao: 'T1' };
  const ap = express();
  ap.use(cabecalhosPortal);
  const sess = criarSessoesPortal({ pool: banco.pool });
  const { portalAtivo, portalAutenticar } = criarAcessoPortal({ pool: banco.pool, sessoes: sess, config });
  const registro = criarRegistro(ap, { autenticado: [], portalPublico: [portalAtivo], portalAutenticado: [portalAtivo, portalAutenticar] });
  registrarPortalPedidos({ portal: registro.portal, pool: poolPedidos });
  registro.verificar();
  const s = await subir(ap);
  t.after(s.fechar);
  const cookie = `__Host-portal=${await sess.criar(1, '1.2.3.4')}`;
  return { pool: poolPedidos, get: async caminho => (await fetch(s.url + caminho, { headers: { Cookie: cookie } })).json() };
}

test('portal: pedido com 2 entregas aparece UMA vez na lista e no detalhe, com o resumo "Entregue parcialmente: 1 de 2"', async t => {
  const ped = (NUMERO, extra = {}) => ({ NUMERO, TIPO: 'Pedido', RAZAO_SOCIAL: 'ACME LTDA', DATA: '2026-10-01', SITUACAO: 'Pronto', DATA_ENTREGA: null, TOTAL: 999, ...extra });
  const { pool: p, get } = await montarPortal(t, { pedidos: [ped(10), ped(11)], entregas: ENTREGAS });
  const lista = await get('/portal/api/pedidos');
  assert.deepEqual(lista.pedidos.map(x => x.numero), [11, 10]);
  const p10 = lista.pedidos.find(x => x.numero === 10);
  assert.equal(p10.entrega, 'Entregue parcialmente: 1 de 2');
  assert.equal(p10.dataAgendada, '2026-11-15'); // a próxima entrega (agendada)
  assert.deepEqual(Object.keys(p10).sort(), ['data', 'dataAgendada', 'dataEntrega', 'entrega', 'numero', 'situacao']); // lista fechada inalterada
  assert.equal(lista.pedidos.find(x => x.numero === 11).entrega, 'Aguardando agendamento'); // uma entrega: rótulo de sempre
  const det = await get('/portal/api/pedidos/10');
  assert.equal(det.pedido.numero, 10);
  assert.equal(det.pedido.entrega, 'Entregue parcialmente: 1 de 2');
  for (const c of p.chamadas.filter(x => /FROM ped_orc p/.test(x.sql))) {
    assert.match(c.sql, JUNCAO_PRINCIPAL);
    assert.doesNotMatch(c.sql, /TOTAL|OBS_GERAL|CLIENTE_FINAL/);
  }
});

test('portal (cálculo): resumo só com mais de uma entrega e pedido ainda não finalizado', () => {
  const base = { NUMERO: 1, DATA: '2026-10-01', SITUACAO: 'Pronto', DATA_ENTREGA: null, ENTREGA_STATUS: 'agendada', DATA_AGENDADA: '2026-11-01' };
  assert.equal(projetarPedido({ ...base, QTD_ENTREGAS: 1, QTD_ENTREGAS_CONCLUIDAS: 0 }).entrega, 'Entrega agendada');
  assert.equal(projetarPedido({ ...base, QTD_ENTREGAS: 2, QTD_ENTREGAS_CONCLUIDAS: 0 }).entrega, 'Entrega agendada');
  assert.equal(projetarPedido({ ...base, QTD_ENTREGAS: 3, QTD_ENTREGAS_CONCLUIDAS: 2 }).entrega, 'Entregue parcialmente: 2 de 3');
  assert.equal(projetarPedido({ ...base, SITUACAO: 'Entregue', ENTREGA_STATUS: 'entregue', QTD_ENTREGAS: 2, QTD_ENTREGAS_CONCLUIDAS: 2 }).entrega, 'Entregue');
  assert.equal(projetarPedido(base).entrega, 'Entrega agendada'); // sem contagens: igual a antes
});

// ======================= etapa 3: regra da última baixa =======================
const M21 = { codigo: 21, nome: 'Motorista Um' };
// pedido 501 Pronto com duas entregas: 1 = retirada agendada, 2 = motorista em rota
function duasEntregas(banco, { pedido = {}, um = {}, dois = {} } = {}) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto', ...pedido });
  const a = banco.semear.entrega({ numero: 501, sequencia: 1, status: 'agendada', tipo: 'retirada', ...um });
  const b = banco.semear.entrega({ numero: 501, sequencia: 2, status: 'em_rota', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-10', ...dois });
  return [a, b];
}
const fotoDe = (banco, entrega_id, criado_por = '21') => {
  const x = { id: banco.anexos.length + 1, entrega_id, evento_id: null, tipo: 'foto', mime: 'image/jpeg', dados: Buffer.from([0xff, 0xd8, 0xff]), criado_por, criado_em: '2026-11-10 10:00:00' };
  banco.anexos.push(x); return x;
};

test('baixa de uma entrega que NÃO é a última: pedido continua Pronto, evento gravado, auditoria diz que o pedido não fechou', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const [a, b] = duasEntregas(banco);
  const r = await chamar(`/entregas/${a.id}/retirada`, 'POST', { entregueA: 'Maria' });
  assert.equal(r.status, 200);
  assert.equal(a.status, 'retirado');
  assert.equal(b.status, 'em_rota');
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
  assert.equal(banco.pedidos[0].DATA_ENTREGA, null);
  assert.equal(banco.f.chamadas.filter(c => /^UPDATE ped_orc/.test(c.sql)).length, 0);
  assert.equal(banco.eventos.filter(v => v.entrega_id === a.id && v.tipo === 'retirada').length, 1);
  const aud = JSON.parse(banco.auditoria.at(-1).detalhe);
  assert.deepEqual([aud.pedidoFechado, aud.motivoPedidoAberto], [false, 'entregas_abertas']);
});

test('a última baixa fecha o pedido: Entregue (uma foi entrega) com DATA_ENTREGA de hoje', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const [a, b] = duasEntregas(banco);
  assert.equal((await chamar(`/entregas/${a.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  const motorista = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21, banco });
  const f = fotoDe(banco, b.id);
  const r = await motorista.chamar(`/minhas_entregas/${b.id}/baixa`, 'POST', { entregueA: 'João', anexoIds: [f.id] });
  assert.equal(r.status, 200);
  assert.equal(b.status, 'entregue');
  assert.equal(banco.pedidos[0].SITUACAO, 'Entregue');
  assert.equal(banco.pedidos[0].DATA_ENTREGA, hojeLocal());
  assert.equal(banco.f.chamadas.filter(c => /^UPDATE ped_orc/.test(c.sql)).length, 1);
});

test('Retirado só quando TODAS as entregas não canceladas foram retiradas (cancelada não conta)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto' });
  const a = banco.semear.entrega({ numero: 501, sequencia: 1, status: 'agendada', tipo: 'retirada' });
  const b = banco.semear.entrega({ numero: 501, sequencia: 2, status: 'agendada', tipo: 'retirada' });
  banco.semear.entrega({ numero: 501, sequencia: 3, status: 'cancelada' });
  assert.equal((await chamar(`/entregas/${a.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto');
  assert.equal((await chamar(`/entregas/${b.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Retirado');
  assert.equal(banco.pedidos[0].DATA_ENTREGA, hojeLocal());
});

test('todas concluídas mas sobra item sem entrega (todas com lista de itens): pedido continua Pronto', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto' });
  banco.itens.push({ NUMERO: 501, TIPO: 'Pedido', ITEM: 1, DESCRICAO: 'Porta', QTD: 2 }, { NUMERO: 501, TIPO: 'Pedido', ITEM: 2, DESCRICAO: 'Trilho', QTD: 1 });
  const a = banco.semear.entrega({ numero: 501, sequencia: 1, status: 'retirado', tipo: 'retirada' });
  const b = banco.semear.entrega({ numero: 501, sequencia: 2, status: 'agendada', tipo: 'retirada' });
  banco.semear.entregaItem({ entrega_id: a.id, numero_item: 1, quantidade: 1 });
  banco.semear.entregaItem({ entrega_id: b.id, numero_item: 2, quantidade: 1 });
  assert.equal((await chamar(`/entregas/${b.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Pronto'); // falta 1 porta
  assert.equal(JSON.parse(banco.auditoria.at(-1).detalhe).motivoPedidoAberto, 'itens_sem_entrega');
  // mesma situação, mas cobrindo tudo: fecha
  const { banco: b2, chamar: c2 } = await prepararEntregas(t);
  b2.semear.cliente();
  b2.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto' });
  b2.itens.push({ NUMERO: 501, TIPO: 'Pedido', ITEM: 1, DESCRICAO: 'Porta', QTD: 2 });
  const x = b2.semear.entrega({ numero: 501, sequencia: 1, status: 'retirado', tipo: 'retirada' });
  const y = b2.semear.entrega({ numero: 501, sequencia: 2, status: 'agendada', tipo: 'retirada' });
  b2.semear.entregaItem({ entrega_id: x.id, numero_item: 1, quantidade: 1 });
  b2.semear.entregaItem({ entrega_id: y.id, numero_item: 1, quantidade: 1 });
  assert.equal((await c2(`/entregas/${y.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(b2.pedidos[0].SITUACAO, 'Retirado');
});

test('baixa parcial de pedido Cancelado continua recusada (409) e nada é gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const [a] = duasEntregas(banco, { pedido: { SITUACAO: 'Cancelado' } });
  const r = await chamar(`/entregas/${a.id}/retirada`, 'POST', { entregueA: 'Maria' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /cancelado ou excluído/);
  assert.equal(a.status, 'agendada');
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.auditoria.length, 0);
});

test('ordem de trava: pedido (FOR UPDATE) antes da entrega; releitura das entregas do pedido com trava depois do UPDATE da entrega', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const [a] = duasEntregas(banco);
  banco.f.chamadas.length = 0;
  assert.equal((await chamar(`/entregas/${a.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  const sqls = banco.f.chamadas.map(c => c.sql);
  const i = re => sqls.findIndex(s => re.test(s));
  assert.ok(i(/^SELECT numero FROM web_entregas WHERE id = \?$/) < i(/^BEGIN$/), 'número lido fora da transação');
  assert.ok(i(/^BEGIN$/) < i(/FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido' FOR UPDATE/));
  assert.ok(i(/FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido' FOR UPDATE/) < i(/^SELECT \* FROM web_entregas WHERE id = \? FOR UPDATE/));
  assert.ok(i(/^UPDATE web_entregas SET/) < i(/FROM web_entregas e WHERE e\.numero = \? FOR UPDATE/));
  assert.ok(i(/FROM web_entregas e WHERE e\.numero = \? FOR UPDATE/) < i(/^COMMIT$/));
});

test('concorrência simulada: a segunda baixa relê dentro da trava e vê a primeira concluída (fecha o pedido)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const [a, b] = duasEntregas(banco, { dois: { status: 'agendada', tipo: 'retirada', motorista_codigo: null } });
  // enquanto a baixa de B espera a trava do pedido, a de A termina: a releitura (FOR UPDATE) já enxerga A retirada
  banco.regras.unshift([/FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido' FOR UPDATE/, (sql, [numero]) => {
    if (a.status === 'agendada') a.status = 'retirado';
    return banco.pedidos.filter(p => p.NUMERO === numero).map(p => ({ SITUACAO: p.SITUACAO }));
  }]);
  assert.equal((await chamar(`/entregas/${b.id}/retirada`, 'POST', { entregueA: 'Maria' })).status, 200);
  assert.equal(banco.pedidos[0].SITUACAO, 'Retirado');
});
