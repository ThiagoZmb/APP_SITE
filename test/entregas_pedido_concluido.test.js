// Pedido concluído fora das Entregas (2026-11-11): pedido Entregue/Retirado pelo VB ou pelo menu "Mudar situação" não pode
// continuar com entrega "A programar"/"Agendada"/"Ocorrência" (caso real: pedido 23392, Retirado com selo "A programar").
// Regras em docs/regras/entregas.md, seção "Pedido concluído fora das Entregas".
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../calculo/entregas');
const { projetarPedido } = require('../calculo/portal_pedidos');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { sincronizarFila } = require('../rotas/entregas');

const SITUACOES = ['Em Produção', 'Pronto', 'Entregue', 'Retirado', 'Cancelado', '', null];
const STATUS = ['a_programar', 'agendada', 'em_rota', 'ocorrencia', 'enviada', 'entregue', 'retirado', 'cancelada', null];

// ---------------- funções puras ----------------
test('statusConcluidoPara: só Entregue e Retirado (exatos) viram status de entrega', () => {
  assert.equal(C.statusConcluidoPara('Entregue'), 'entregue');
  assert.equal(C.statusConcluidoPara('Retirado'), 'retirado');
  for (const s of ['Pronto', 'Em Produção', 'Cancelado', '', null, undefined, 'entregue']) assert.equal(C.statusConcluidoPara(s), null, String(s));
});

test('statusNaLista: tabela completa situação x status (só A programar/Agendada/Ocorrência de pedido concluído mudam)', () => {
  for (const sit of SITUACOES) for (const st of STATUS) {
    const esperado = (sit === 'Entregue' || sit === 'Retirado') && ['a_programar', 'agendada', 'ocorrencia'].includes(st)
      ? (sit === 'Entregue' ? 'entregue' : 'retirado') : st;
    assert.equal(C.statusNaLista(sit, st), esperado, `${sit} x ${st}`);
  }
});

test('statusDeReabertura: volta ao status de espera gravado; qualquer outra coisa = A programar', () => {
  assert.equal(C.statusDeReabertura({ statusAnterior: 'agendada' }), 'agendada');
  assert.equal(C.statusDeReabertura('{"statusAnterior":"ocorrencia"}'), 'ocorrencia');
  for (const d of [{ statusAnterior: 'cancelada' }, { statusAnterior: 'em_rota' }, null, '', '{ruim', {}, 'x']) assert.equal(C.statusDeReabertura(d), 'a_programar');
});

test('portal: pedido Entregue/Retirado nunca mostra entrega pendente nem cancelada nem data agendada', () => {
  const base = { NUMERO: 1, DATA: '2026-11-01', DATA_ENTREGA: '2026-11-11', DATA_AGENDADA: '2026-11-20' };
  for (const st of ['a_programar', 'agendada', 'em_rota', 'ocorrencia', 'enviada', 'cancelada']) {
    assert.equal(projetarPedido({ ...base, SITUACAO: 'Retirado', ENTREGA_STATUS: st }).entrega, 'Retirado', st);
    assert.equal(projetarPedido({ ...base, SITUACAO: 'Entregue', ENTREGA_STATUS: st }).entrega, 'Entregue', st);
    assert.equal(projetarPedido({ ...base, SITUACAO: 'Entregue', ENTREGA_STATUS: st }).dataAgendada, null, st);
  }
  assert.equal(projetarPedido({ ...base, SITUACAO: 'Retirado', ENTREGA_STATUS: null }).entrega, null, 'sem entrega continua sem rótulo');
  assert.equal(projetarPedido({ ...base, SITUACAO: 'Retirado', ENTREGA_STATUS: 'entregue' }).entrega, 'Entregue', 'baixa real fica como foi');
  // pedido ainda aberto: tudo como antes
  assert.equal(projetarPedido({ ...base, SITUACAO: 'Pronto', ENTREGA_STATUS: 'a_programar' }).entrega, 'Aguardando agendamento');
  assert.equal(projetarPedido({ ...base, SITUACAO: 'Pronto', ENTREGA_STATUS: 'agendada' }).dataAgendada, '2026-11-20');
});

// ---------------- varredura (sincronizarFila) ----------------
function cenario(banco, situacao, entregas) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: situacao });
  return entregas.map(e => {
    const x = banco.semear.entrega({ numero: 501, ...e });
    banco.semear.evento({ entrega_id: x.id, tipo: 'criada' });
    return x;
  });
}

test('caso 23392: pedido Retirado com entrega A programar -> encerrada como retirado (não cancelada), evento explica; idempotente', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, 'Retirado', [{ status: 'a_programar' }]);
  const r = await chamar('/entregas');
  assert.equal(r.status, 200);
  const lista = (await r.json()).entregas;
  assert.equal(banco.entregas[0].status, 'retirado');
  assert.equal(lista[0].status, 'retirado');
  const ev = banco.eventos.filter(v => v.tipo === 'encerrada');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].usuario, ev[0].motivo, JSON.parse(ev[0].detalhe).statusAnterior], ['sistema', 'Pedido marcado como Retirado fora das Entregas', 'a_programar']);
  assert.equal(banco.eventos.filter(v => v.tipo === 'cancelada').length, 0, 'nunca cancelada');
  await chamar('/entregas');
  assert.equal(banco.eventos.filter(v => v.tipo === 'encerrada').length, 1, 'segunda varredura não repete');
});

test('pedido Entregue: Agendada e Ocorrência viram entregue; Em rota, Enviada, concluídas e cancelada pela equipe não mudam', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, 'Entregue', [{ status: 'agendada', data_agendada: '2026-11-20' }, { status: 'ocorrencia', sequencia: 2 }, { status: 'em_rota', sequencia: 3 },
    { status: 'enviada', sequencia: 4 }, { status: 'retirado', sequencia: 5 }, { status: 'cancelada', sequencia: 6 }]);
  banco.semear.evento({ entrega_id: 6, tipo: 'cancelada', usuario: 'Caio', motivo: 'cliente desistiu' });
  await chamar('/entregas');
  assert.deepEqual(banco.entregas.map(e => e.status), ['entregue', 'entregue', 'em_rota', 'enviada', 'retirado', 'cancelada']);
  assert.equal(banco.entregas[0].data_agendada, '2026-11-20', 'data e motorista ficam (servem para reabrir)');
});

test('legado: cancelada pela varredura por "saiu de Pronto" de pedido Entregue vira entregue (estava "Cancelada" nas listas)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, 'Entregue', [{ status: 'cancelada' }]);
  banco.semear.evento({ entrega_id: 1, tipo: 'cancelada', usuario: 'sistema', motivo: 'Pedido saiu de Pronto' });
  await chamar('/entregas');
  assert.equal(banco.entregas[0].status, 'entregue');
  assert.equal(JSON.parse(banco.eventos.at(-1).detalhe).statusAnterior, 'cancelada');
});

test('pedido em outra situação (nem Pronto nem Em Produção): A programar cancelada por "saiu de Pronto"; Agendada fica', async t => {
  const a = await prepararEntregas(t);
  cenario(a.banco, 'Orçamento', [{ status: 'a_programar' }, { status: 'agendada', sequencia: 2 }]);
  await a.chamar('/entregas');
  assert.deepEqual(a.banco.entregas.map(e => e.status), ['cancelada', 'agendada']);
  assert.equal(a.banco.eventos.filter(v => v.tipo === 'encerrada').length, 0);
});

test('pedido volta de Retirado para Pronto: a encerrada com o pedido reabre no status que tinha (Agendada); a baixa real não reabre', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, 'Retirado', [{ status: 'agendada', data_agendada: '2026-11-20' }, { status: 'retirado', sequencia: 2 }]);
  banco.semear.evento({ entrega_id: 2, tipo: 'retirada', usuario: 'Caio' });
  await chamar('/entregas');
  assert.deepEqual(banco.entregas.map(e => e.status), ['retirado', 'retirado']);
  banco.pedidos[0].SITUACAO = 'Pronto';
  await chamar('/entregas');
  assert.deepEqual(banco.entregas.map(e => e.status), ['agendada', 'retirado']);
  assert.equal(banco.eventos.at(-1).tipo, 'reaberta');
  await chamar('/entregas');
  assert.equal(banco.eventos.filter(v => v.tipo === 'reaberta').length, 1, 'idempotente');
});

test('pedido volta de Entregue para Em Produção: reabre A programar e ela fica (Em Produção não cancela mais); em outra situação a regra "saiu de Pronto" a cancela', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, 'Entregue', [{ status: 'a_programar' }]);
  await chamar('/entregas');
  banco.pedidos[0].SITUACAO = 'Em Produção';
  await chamar('/entregas');
  assert.equal(banco.entregas[0].status, 'a_programar');
  assert.deepEqual(banco.eventos.map(v => v.tipo), ['criada', 'encerrada', 'reaberta']);
  banco.pedidos[0].SITUACAO = 'Orçamento';
  await chamar('/entregas');
  assert.equal(banco.entregas[0].status, 'cancelada');
  assert.deepEqual(banco.eventos.map(v => v.tipo), ['criada', 'encerrada', 'reaberta', 'cancelada']);
  banco.pedidos[0].SITUACAO = 'Pronto';
  await chamar('/entregas');
  assert.equal(banco.entregas[0].status, 'a_programar', 'e volta à fila quando fica Pronto de novo (regra antiga)');
});

test('várias entregas: pedido marcado Entregue fora com 1 baixada + 1 A programar -> as duas concluídas ("2 de 2"), sobra/saldo não muda', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco, 'Entregue', [{ status: 'entregue' }, { status: 'a_programar', sequencia: 2 }]);
  banco.semear.entregaItem({ entrega_id: 1, numero_item: 1, quantidade: 1 });
  banco.semear.entregaItem({ entrega_id: 2, numero_item: 2, quantidade: 1 });
  await chamar('/entregas');
  assert.deepEqual(banco.entregas.map(e => e.status), ['entregue', 'entregue']);
  assert.deepEqual(C.resumoEntregas(banco.entregas), { qtdEntregas: 2, qtdEntregasConcluidas: 2 });
  assert.equal(banco.entregaItens.length, 2, 'listas de itens intactas');
});

test('sincronizarFila devolve a contagem de encerradas', async t => {
  const { banco } = await prepararEntregas(t);
  cenario(banco, 'Retirado', [{ status: 'a_programar' }]);
  const r = await sincronizarFila(require('../index.js').pool);
  assert.equal(r.encerradas, 1);
});

// ---------------- listas (projeção) ----------------
const { app, pool: poolApp, acesso, sessoes } = require('../index.js');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { PERFIS_INICIAIS } = require('../seguranca/permissoes');
aceitarSidDeTeste(sessoes);
async function prepararLista(t, regras) {
  const f = criarPoolFalso(regras);
  poolApp.execute = f.execute; poolApp.getConnection = f.getConnection;
  const permissoes = new Set(PERFIS_INICIAIS.find(p => p.nome === 'Administrador').permissoes);
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Admin', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'Administrador' }, estados: [], ativo: true, permissoes }));
  t.mock.method(console, 'warn', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const token = jwt.sign({ id: 1, nome: 'Admin', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
  return { f, chamar: caminho => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token } }) };
}
const LINHAS = [
  { numero: 23392, cliente: 'A', situacao: 'Retirado', dataEntrega: '2026-11-11', entregaStatus: 'a_programar', dataAgendada: null, qtdEntregas: 1, qtdEntregasConcluidas: 0 },
  { numero: 2, cliente: 'B', situacao: 'Entregue', dataEntrega: '2026-11-10', entregaStatus: 'em_rota', dataAgendada: '2026-11-10', qtdEntregas: 1, qtdEntregasConcluidas: 0 },
  { numero: 3, cliente: 'C', situacao: 'Pronto', dataEntrega: null, entregaStatus: 'a_programar', dataAgendada: null, qtdEntregas: 1, qtdEntregasConcluidas: 0 }
];
for (const caminho of ['/dados_lista?tipo=Pedido', '/dados_pedidos', '/dados_pedidos_rj']) {
  test(`${caminho}: pedido Retirado não aparece "A programar"; Em rota fica visível; pedido Pronto como antes`, async t => {
    const { chamar } = await prepararLista(t, [[/FROM ped_orc p/, LINHAS]]);
    const d = await (await chamar(caminho)).json();
    assert.deepEqual(d.map(x => x.entregaStatus), ['retirado', 'em_rota', 'a_programar']);
  });
}

test('/clientes/financeiro: entregaStatus projetado e pendentes sem as que só esperavam de pedido concluído', async t => {
  const { f, chamar } = await prepararLista(t, [
    [/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, RAZAO_SOCIAL: 'CLI', ESTADO: 'RJ' }]],
    [/FROM ped_orc p\b.*web_entregas/s, [{ NUMERO: 23392, DATA: '2026-11-01', TOTAL: 5, SITUACAO: 'Retirado', FINANCEIRO: 'A Receber', ENTREGA_STATUS: 'a_programar' }]],
    [/AS qtd_entregas_pendentes/, [{ qtd_entregas_pendentes: 0 }]],
    [/AS atrasado/, [{ receber: 0, atrasado: 0 }]],
    [/SITUACAO <> 'Cancelado'/, [{ receber: 0 }]]
  ]);
  const d = await (await chamar('/clientes/financeiro/5')).json();
  assert.equal(d.pedidos[0].entregaStatus, 'retirado');
  const sql = f.chamadas.find(c => /qtd_entregas_pendentes/.test(c.sql)).sql;
  assert.match(sql, /COALESCE\(p\.SITUACAO, ''\) NOT IN \('Entregue', 'Retirado'\)/);
});

// ---------------- ligações e telas ----------------
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('tela de Entregas: eventos "encerrada" e "reaberta" têm rótulo', () => {
  const E = require('../entregas.js');
  assert.equal(E.rotuloEvento('encerrada'), 'Encerrada com o pedido');
  assert.equal(E.rotuloEvento('reaberta'), 'Reaberta');
});

test('Pedidos (painel_inicial.html) explica na pergunta o que acontece com as entregas abertas', () => {
  const p = ler('painel_inicial.html');
  assert.ok(p.includes('err.dados.entregasEncerrar') && p.includes('err.dados.entregasEmCurso') && p.includes('junto como ${nome}'));
});

// ---------------- varredura só por ação do usuário (decisão do dono, 2026-11-11) ----------------
const ESCRITA_ENTREGAS = /^INSERT IGNORE INTO web_entregas/;
const LISTA = /p\.NUMERO as numero/, FIN = /^\s*SELECT p\.NUMERO, p\.CLIENTE_FINAL/;
for (const [caminho, regraLista] of [['/dados_lista?tipo=Pedido', LISTA], ['/dados_pedidos', LISTA], ['/dados_pedidos_rj', LISTA], ['/clientes/financeiro/5', FIN]]) {
  test(`${caminho}: carregamento normal NÃO varre; com varrer=1 (botão Atualizar) varre ANTES da lista e aguarda`, async t => {
    const regras = [[/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, RAZAO_SOCIAL: 'CLI', ESTADO: 'RJ' }]], [regraLista, []],
      [/AS qtd_entregas_pendentes/, [{ qtd_entregas_pendentes: 0 }]], [/AS atrasado/, [{ receber: 0, atrasado: 0 }]], [/SITUACAO <> 'Cancelado'/, [{ receber: 0 }]],
      [/SELECT CREDITO FROM cadastro_clientes/, [{ CREDITO: 0 }]]];
    const { f, chamar } = await prepararLista(t, regras);
    assert.equal((await chamar(caminho)).status, 200);
    assert.equal(f.chamadas.filter(c => ESCRITA_ENTREGAS.test(c.sql)).length, 0, 'sem clique, nenhuma escrita');
    const antes = f.chamadas.length;
    assert.equal((await chamar(caminho + (caminho.includes('?') ? '&' : '?') + 'varrer=1')).status, 200);
    const novas = f.chamadas.slice(antes).map(c => c.sql);
    const iVar = novas.findIndex(s => ESCRITA_ENTREGAS.test(s)), iLista = novas.findIndex(s => regraLista.test(s));
    assert.ok(iVar >= 0 && iLista > iVar, 'varredura antes da lista');
    assert.ok(novas.includes('COMMIT'), 'a varredura terminou (commit) antes da resposta');
  });
}

test('varredura que falha não derruba a lista (varrer=1)', async t => {
  t.mock.method(console, 'error', () => {});
  const { chamar } = await prepararLista(t, [[ESCRITA_ENTREGAS, () => { throw Object.assign(new Error('x'), { code: 'ER_X' }); }], [/FROM ped_orc p/, LINHAS]]);
  const r = await chamar('/dados_lista?tipo=Pedido&varrer=1');
  assert.equal(r.status, 200);
  assert.equal((await r.json())[0].entregaStatus, 'retirado', 'a projeção cobre');
});

test('nada roda sozinho: sem disparo por tempo/segundo plano/subida; só ?varrer=1, Entregas, menu e etapa', () => {
  const i = ler('index.js');
  assert.doesNotMatch(i, /varrerEntregas|criarDisparadorFila/);
  assert.equal((i.match(/^\s+await varrerSePedido\(req\);/gm) || []).length, 4, '4 rotas de lista');
  assert.match(i, /if \(req\.query\.varrer !== '1'\) return;/);
  const e = ler('rotas/entregas.js');
  assert.doesNotMatch(e, /setInterval|setTimeout|criarDisparadorFila/);
  assert.doesNotMatch(ler('rotas/ped_orc.js'), /varrer/);
  assert.doesNotMatch(ler('rotas/portal_pedidos.js'), /varrer|sincronizarFila/, 'o portal (cliente) nunca dispara escrita');
  const p = ler('painel_inicial.html');
  assert.ok(p.includes("$('refresh-btn').addEventListener('click', () => carregar({ varrer: true }));"));
  // a varredura só acompanha a lista de Pedido (o tipo é buscado por buscarTipo, com o olho dos resumos fechado só o tipo ativo)
  assert.ok(p.includes("api('/dados_lista?tipo=' + encodeURIComponent(tipo) + (varrer === true && tipo === 'Pedido' ? '&varrer=1' : ''))"));
});
