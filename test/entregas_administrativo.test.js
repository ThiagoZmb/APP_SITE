// Administrativo em "Minhas entregas" (2026-11-13): vê as entregas de TODOS os motoristas e dá a baixa (Agendada ou Em rota),
// com autoria "em nome do motorista X". Motorista comum e operador seguem como antes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { REGEX_VALOR } = require('../seguranca/valores');
const { proximo } = require('../calculo/entregas');
const M = require('../minhas_entregas.js');
const E = require('../entregas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const ADM = { codigo: 7, nome: 'Caio' };
const M21 = { codigo: 21, nome: 'Motorista Um' };
const PASSADO = '2000-01-01';

// 1 = do 21 (Agendada), 2 = do 22 (Em rota), 3 = do 21 mas tipo retirada, 4 = do 22 em Ocorrência, 5 = do 22 Em rota de cliente de São Paulo
function cenario(banco) {
  banco.semear.cliente({ TELEFONE: '2199999-0000' });
  banco.semear.cliente({ RAZAO_SOCIAL: 'CLIENTE SP LTDA', ESTADO: 'SP', CIDADE: 'Santos' });
  for (const n of [601, 602, 603, 604]) banco.semear.pedido({ NUMERO: n, SITUACAO: 'Pronto' });
  banco.semear.pedido({ NUMERO: 605, SITUACAO: 'Pronto', RAZAO_SOCIAL: 'CLIENTE SP LTDA' });
  banco.itens.push({ NUMERO: 601, TIPO: 'Pedido', ITEM: 1, DESCRICAO: 'Porta pivotante', QTD: 2 });
  const base = { tipo: 'motorista', data_agendada: PASSADO };
  banco.semear.entrega({ ...base, status: 'agendada', numero: 601, motorista_codigo: 21 });
  banco.semear.entrega({ ...base, status: 'em_rota', numero: 602, motorista_codigo: 22 });
  banco.semear.entrega({ ...base, status: 'agendada', numero: 603, motorista_codigo: 21, tipo: 'retirada' });
  banco.semear.entrega({ ...base, status: 'ocorrencia', numero: 604, motorista_codigo: 22 });
  banco.semear.entrega({ ...base, status: 'em_rota', numero: 605, motorista_codigo: 22 });
}
const foto = (banco, entrega_id, criado_por) => {
  const a = { id: banco.anexos.length + 1, entrega_id, evento_id: null, tipo: 'foto', mime: 'image/jpeg', dados: JPEG, criado_por: String(criado_por), criado_em: '2026-11-13 09:00:00' };
  banco.anexos.push(a); return a;
};
const baixa = (chamar, id, corpo = { entregueA: 'Maria' }) => chamar(`/minhas_entregas/${id}/baixa`, 'POST', corpo);
const chaves = (o, acc = []) => {
  if (Array.isArray(o)) o.forEach(x => chaves(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); chaves(v, acc); }
  return acc;
};

// ---- calculo ----
test('calculo: baixa_administrativa vale em Agendada e Em rota (tipo motorista); resto continua recusado', () => {
  assert.deepEqual(proximo({ status: 'agendada', tipo: 'motorista' }, 'baixa_administrativa'), { status: 'entregue', evento: 'entregue' });
  assert.deepEqual(proximo({ status: 'em_rota', tipo: 'motorista' }, 'baixa_administrativa'), { status: 'entregue', evento: 'entregue' });
  for (const s of ['a_programar', 'ocorrencia', 'entregue', 'retirado', 'enviada', 'cancelada']) assert.equal(proximo({ status: s, tipo: 'motorista' }, 'baixa_administrativa'), null, s);
  for (const t of ['retirada', 'outro_estado', null]) assert.equal(proximo({ status: 'agendada', tipo: t }, 'baixa_administrativa'), null, String(t));
  // a ação do motorista não mudou
  assert.equal(proximo({ status: 'agendada', tipo: 'motorista' }, 'entregue'), null);
});

// ---- lista ----
test('administrativo vê as entregas de todos os motoristas (só tipo Entrega), com o nome do motorista; nada de dinheiro', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM });
  cenario(banco);
  const r = await chamar('/minhas_entregas');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.entregas.map(e => e.numero), [601, 602, 604, 605]); // 603 é retirada: fora
  const e602 = j.entregas.find(e => e.numero === 602);
  assert.equal(e602.motorista, 'Motorista Dois');
  assert.equal(e602.motoristaCodigo, 22);
  assert.equal(e602.minha, false);
  assert.equal(j.entregas.find(e => e.numero === 601).motorista, 'Motorista Um');
  assert.deepEqual(chaves(j).filter(k => REGEX_VALOR.test(k)), []);
  // "só as minhas": o administrativo não é motorista de nenhuma
  assert.deepEqual((await (await chamar('/minhas_entregas?escopo=minhas')).json()).entregas, []);
  // com dia
  assert.deepEqual((await (await chamar('/minhas_entregas?dia=2026-01-01')).json()).entregas, []);
  assert.equal((await chamar('/minhas_entregas?dia=ontem')).status, 400);
});

test('administrativo que também é motorista: "só as minhas" devolve as dele; "todos" marca minha', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo com baixa', usuario: M21 });
  cenario(banco);
  const todos = (await (await chamar('/minhas_entregas')).json()).entregas;
  assert.deepEqual(todos.map(e => [e.numero, e.minha]), [[601, true], [602, false], [604, false], [605, false]]);
  const minhas = (await (await chamar('/minhas_entregas?escopo=minhas')).json()).entregas;
  assert.deepEqual(minhas.map(e => e.numero), [601]);
  assert.equal(minhas[0].motorista, undefined); // formato do motorista, sem mudança
});

test('administrativo respeita o filtro de estados (lista, detalhe, anexo e baixa)', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM, estados: ['RJ'] });
  cenario(banco);
  assert.deepEqual((await (await chamar('/minhas_entregas')).json()).entregas.map(e => e.numero), [601, 602, 604]);
  const sp = banco.entregas[4]; // pedido 605, cliente de SP
  assert.equal(sp.numero, 605);
  assert.equal((await chamar(`/minhas_entregas/${sp.id}`)).status, 404);
  assert.equal((await chamar(`/minhas_entregas/${sp.id}/anexo?tipo=foto`, 'PUT', JPEG, { 'Content-Type': 'image/jpeg' })).status, 404);
  assert.equal((await baixa(chamar, sp.id)).status, 404);
  assert.equal(sp.status, 'em_rota');
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.pedidos.find(p => p.NUMERO === 605).SITUACAO, 'Pronto');
});

// ---- isolamento do motorista e do operador ----
test('motorista comum continua isolado: só as dele, sem nome de motorista; as dos outros dão 404 (detalhe, anexo, baixa)', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  const { entregas } = await (await chamar('/minhas_entregas')).json();
  assert.deepEqual(entregas.map(e => e.numero), [601]);
  assert.equal(entregas[0].motorista, undefined);
  assert.equal(entregas[0].minha, undefined);
  assert.equal((await chamar('/minhas_entregas?escopo=todos')).status, 200);
  assert.deepEqual((await (await chamar('/minhas_entregas?escopo=todos')).json()).entregas.map(e => e.numero), [601]); // o parâmetro não amplia nada
  assert.equal((await chamar('/minhas_entregas/2')).status, 404);
  assert.equal((await chamar('/minhas_entregas/2/anexo?tipo=foto', 'PUT', JPEG, { 'Content-Type': 'image/jpeg' })).status, 404);
  assert.equal((await baixa(chamar, 2)).status, 404);
  assert.equal(banco.entregas[1].status, 'em_rota');
});

test('operador sem a chave (entregas.ver + programar) e administrativo sem entregas.ver: 403 em todas as rotas de Minhas entregas', async t => {
  for (const perfil of ['Programador', 'Somente ver', 'Administrativo sem ver']) {
    const { banco, chamar } = await prepararEntregas(t, { perfil, usuario: ADM });
    cenario(banco);
    for (const [caminho, metodo, corpo] of [['/minhas_entregas', 'GET'], ['/minhas_entregas/1', 'GET'], ['/minhas_entregas/1/anexo/1', 'GET'],
      ['/minhas_entregas/1/baixa', 'POST', { entregueA: 'M' }]]) {
      assert.equal((await chamar(caminho, metodo, corpo)).status, 403, `${perfil} ${metodo} ${caminho}`);
    }
    assert.equal((await chamar('/minhas_entregas/2/anexo?tipo=foto', 'PUT', JPEG, { 'Content-Type': 'image/jpeg' })).status, 403, perfil);
    assert.equal(banco.eventos.length, 0);
  }
});

test('"saiu" e ocorrência continuam só do motorista dono: administrativo puro 403; administrativo-motorista em entrega alheia 404', async t => {
  const puro = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM });
  cenario(puro.banco);
  assert.equal((await puro.chamar('/minhas_entregas/1/saiu', 'POST', {})).status, 403);
  assert.equal((await puro.chamar('/minhas_entregas/2/ocorrencia', 'POST', { tipo: 'ausente', motivo: 'ninguém' })).status, 403);
  const dual = await prepararEntregas(t, { perfil: 'Administrativo com baixa', usuario: M21 });
  cenario(dual.banco);
  assert.equal((await dual.chamar('/minhas_entregas/2/ocorrencia', 'POST', { tipo: 'ausente', motivo: 'ninguém' })).status, 404);
  assert.equal(dual.banco.eventos.length, 0);
});

// ---- baixa ----
test('baixa do administrativo numa entrega Em rota de OUTRO motorista: grava, vincula a foto, fecha o pedido e registra "em nome do motorista"', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM });
  cenario(banco);
  const up = await chamar('/minhas_entregas/2/anexo?tipo=foto', 'PUT', JPEG, { 'Content-Type': 'image/jpeg' });
  assert.equal(up.status, 201);
  assert.equal(banco.anexos[0].criado_por, '7');
  const { anexoId } = await up.json();
  assert.equal((await baixa(chamar, 2, { entregueA: ' Maria Souza ', anexoIds: [anexoId] })).status, 200);
  assert.equal(banco.entregas[1].status, 'entregue');
  assert.equal(banco.pedidos.find(p => p.NUMERO === 602).SITUACAO, 'Entregue');
  assert.ok(banco.pedidos.find(p => p.NUMERO === 602).DATA_ENTREGA);
  assert.equal(banco.eventos.length, 1); // Em rota: sem evento de saída
  const ev = banco.eventos[0];
  assert.equal(ev.tipo, 'entregue');
  assert.equal(ev.usuario, 'Caio');
  assert.equal(ev.entregue_a, 'Maria Souza');
  assert.match(ev.motivo, /em nome do motorista Motorista Dois/);
  assert.deepEqual(JSON.parse(ev.detalhe).emNomeDe, { codigo: 22, nome: 'Motorista Dois' });
  assert.equal(banco.anexos[0].evento_id, ev.id);
  const aud = banco.auditoria.find(a => a.acao === 'entrega_entregue');
  assert.equal(aud.quem, 'Caio');
  assert.equal(aud.alvo, '602');
  const d = JSON.parse(aud.detalhe);
  assert.equal(d.porAdministrativo, true);
  assert.deepEqual(d.emNomeDe, { codigo: 22, nome: 'Motorista Dois' });
  assert.equal((await baixa(chamar, 2)).status, 409); // repetida
  assert.equal(banco.eventos.length, 1);
});

test('baixa do administrativo numa entrega ainda Agendada: grava o evento de saída e depois a baixa, mesmo autor, na ordem certa', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM });
  cenario(banco);
  assert.equal((await baixa(chamar, 1, { entregueA: 'Zé' })).status, 200);
  assert.equal(banco.entregas[0].status, 'entregue');
  assert.equal(banco.pedidos.find(p => p.NUMERO === 601).SITUACAO, 'Entregue');
  assert.deepEqual(banco.eventos.map(v => v.tipo), ['saiu', 'entregue']);
  assert.ok(banco.eventos[0].id < banco.eventos[1].id);
  for (const v of banco.eventos) {
    assert.equal(v.usuario, 'Caio');
    assert.match(v.motivo, /em nome do motorista Motorista Um/);
  }
  assert.equal(JSON.parse(banco.eventos[0].detalhe).saiuJuntoComABaixa, true);
  assert.equal(JSON.parse(banco.eventos[1].detalhe).saiuJuntoComABaixa, true);
  assert.equal(JSON.parse(banco.auditoria.find(a => a.acao === 'entrega_entregue').detalhe).saiuJuntoComABaixa, true);
});

test('anexo do administrativo vale em Agendada e Em rota; Ocorrência e entrega de outro tipo recusam', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM });
  cenario(banco);
  const enviar = id => chamar(`/minhas_entregas/${id}/anexo?tipo=foto`, 'PUT', JPEG, { 'Content-Type': 'image/jpeg' });
  assert.equal((await enviar(1)).status, 201); // Agendada
  assert.equal((await enviar(2)).status, 201); // Em rota
  assert.equal((await enviar(4)).status, 409); // Ocorrência
  assert.equal((await enviar(3)).status, 404); // retirada não é "Entrega"
});

test('recusas inalteradas: Ocorrência, concluída, pedido Em Produção, sem "quem recebeu", foto alheia; nada é gravado (nem o evento de saída)', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM });
  cenario(banco);
  assert.equal((await baixa(chamar, 4)).status, 409); // Ocorrência: segue o fluxo da equipe (reagendar)
  assert.equal((await baixa(chamar, 3)).status, 404); // retirada
  assert.equal((await baixa(chamar, 1, {})).status, 400);
  assert.equal((await baixa(chamar, 1, { entregueA: '   ' })).status, 400);
  assert.equal((await baixa(chamar, 1, { entregueA: 'x'.repeat(191) })).status, 400);
  const alheia = foto(banco, 1, 22);
  assert.equal((await baixa(chamar, 1, { entregueA: 'M', anexoIds: [alheia.id] })).status, 400);
  assert.equal((await baixa(chamar, 1, { entregueA: 'M', anexoIds: [999] })).status, 400);
  // pedido ainda Em Produção: a baixa é recusada e o evento de saída gravado antes é desfeito junto
  banco.pedidos.find(p => p.NUMERO === 601).SITUACAO = 'Em Produção';
  const r = await baixa(chamar, 1, { entregueA: 'M' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /ainda não está Pronto/);
  assert.equal(banco.entregas[0].status, 'agendada');
  assert.equal(banco.eventos.length, 0);
  // pedido cancelado
  banco.pedidos.find(p => p.NUMERO === 601).SITUACAO = 'Cancelado';
  assert.equal((await baixa(chamar, 1, { entregueA: 'M' })).status, 409);
  assert.equal(banco.entregas[0].status, 'agendada');
  assert.equal(banco.eventos.length, 0);
  // concluída
  banco.pedidos.find(p => p.NUMERO === 601).SITUACAO = 'Pronto';
  banco.entregas[0].status = 'entregue';
  assert.equal((await baixa(chamar, 1)).status, 409);
});

test('pedido com duas entregas: a baixa do administrativo só fecha o pedido na última (regra de sempre)', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM });
  cenario(banco);
  const segunda = banco.semear.entrega({ numero: 601, sequencia: 2, status: 'em_rota', tipo: 'motorista', motorista_codigo: 22, data_agendada: PASSADO });
  assert.equal((await baixa(chamar, 1, { entregueA: 'A' })).status, 200);
  assert.equal(banco.pedidos.find(p => p.NUMERO === 601).SITUACAO, 'Pronto');
  assert.equal(JSON.parse(banco.auditoria.find(a => a.acao === 'entrega_entregue').detalhe).motivoPedidoAberto, 'entregas_abertas');
  assert.equal((await baixa(chamar, segunda.id, { entregueA: 'B' })).status, 200);
  assert.equal(banco.pedidos.find(p => p.NUMERO === 601).SITUACAO, 'Entregue');
});

test('administrativo que é o próprio motorista: sem "em nome de"; Agendada ainda grava a saída junto', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo com baixa', usuario: M21 });
  cenario(banco);
  assert.equal((await baixa(chamar, 1, { entregueA: 'Zé' })).status, 200);
  assert.deepEqual(banco.eventos.map(v => v.tipo), ['saiu', 'entregue']);
  for (const v of banco.eventos) assert.doesNotMatch(String(v.motivo), /em nome/);
  assert.equal(JSON.parse(banco.auditoria.find(a => a.acao === 'entrega_entregue').detalhe).emNomeDe, undefined);
  // o motorista comum (sem a chave) continua sem poder dar baixa em Agendada
  const m = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(m.banco);
  assert.equal((await baixa(m.chamar, 1, { entregueA: 'Zé' })).status, 409);
  assert.equal(m.banco.eventos.length, 0);
});

// ---- telas ----
test('minhas_entregas.js: ações do administrativo, aviso e escolha única de resultado', () => {
  assert.deepEqual(M.acoesMotorista({ status: 'agendada', minha: false }, true), ['baixar']);
  assert.deepEqual(M.acoesMotorista({ status: 'agendada', minha: true }, true), ['iniciar', 'baixar']);
  assert.deepEqual(M.acoesMotorista({ status: 'em_rota', minha: false }, true), ['baixar']);
  for (const s of ['ocorrencia', 'entregue', 'cancelada']) assert.deepEqual(M.acoesMotorista({ status: s }, true), []);
  assert.deepEqual(M.acoesMotorista({ status: 'agendada' }), ['iniciar']); // sem administrativo: igual a antes
  assert.equal(M.baixaSoEntregue({ minha: false }, true, true), true);
  assert.equal(M.baixaSoEntregue({ minha: true }, true, true), false); // administrativo-motorista na própria: todas as opções
  assert.equal(M.baixaSoEntregue({ minha: true }, true, false), true);
  assert.equal(M.baixaSoEntregue({}, false, true), false);
  assert.match(M.avisoBaixaAdministrativa({ status: 'agendada', minha: false, motorista: 'Fulano' }), /ainda não saiu.*em nome do motorista Fulano/);
  assert.equal(M.avisoBaixaAdministrativa({ status: 'em_rota', minha: true }), '');
});

test('minhas_entregas.html: filtro Todos / Só as minhas só com a chave; confirmar sem data-perm do motorista; sem estilo novo por atributo', () => {
  const h = ler('minhas_entregas.html');
  assert.match(h, /id="filtro-escopo" data-perm="administrativo\.ver entregas\.ver" hidden/);
  assert.match(h, /data-escopo="todos"[^>]*>Todos</);
  assert.match(h, /data-escopo="minhas"[^>]*>Só as minhas</);
  assert.doesNotMatch(h, /id="btn-confirmar"[^>]*data-perm/);
  const j = ler('minhas_entregas.js');
  assert.match(j, /data-perm="\$\{adm \? 'administrativo\.ver' : 'entregas\.baixar'\}">Dar baixa/);
  assert.match(j, /escopo=minhas/);
  assert.doesNotMatch(j, /\.(valor|preco|preço|total|desconto)\b/i);
});

test('entregas.html/.js: "Dar baixa da entrega" com administrativo.ver, só Entrega Agendada ou Em rota, mesma rota da baixa', () => {
  const h = ler('entregas.html');
  assert.match(h, /id="btn-baixa-adm" data-perm="administrativo\.ver" hidden/);
  assert.match(h, /<form id="vista-baixa-adm" hidden>/);
  assert.match(h, /id="btn-confirmar-baixa-adm" data-perm="administrativo\.ver"/);
  assert.equal(E.podeBaixaAdministrativa({ status: 'agendada', tipo: 'motorista' }), true);
  assert.equal(E.podeBaixaAdministrativa({ status: 'em_rota', tipo: 'motorista' }), true);
  for (const e of [{ status: 'agendada', tipo: 'retirada' }, { status: 'ocorrencia', tipo: 'motorista' }, { status: 'entregue', tipo: 'motorista' }, { status: 'enviada', tipo: 'outro_estado' }, null]) {
    assert.equal(E.podeBaixaAdministrativa(e), false);
  }
  assert.match(E.avisoBaixaAdministrativa({ status: 'agendada' }, 'Fulano'), /ainda não saiu.*em nome do motorista Fulano/);
  const j = ler('entregas.js');
  assert.match(j, /\/minhas_entregas\/\$\{encodeURIComponent\(e\.id\)\}\/baixa/);
  assert.doesNotMatch(h.match(/<form id="vista-baixa-adm"[\s\S]*?<\/form>/)[0], /style=/);
});

test('layout.js: Minhas entregas abre para o administrativo (menu e página) e o motorista continua entrando', () => {
  const vm = require('node:vm');
  const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { pathname: '/x.html' }, fetch: async () => ({}), URL, console, setTimeout, clearTimeout,
    document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } } };
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(ler('layout.js'), ctx);
  const exige = ctx.ACESSO_PAGINAS['minhas_entregas.html'];
  const atende = tem => exige.every(i => (typeof i === 'string' ? tem.includes(i) : i.algum.some(c => tem.includes(c))));
  assert.equal(atende(['entregas.baixar']), true);
  assert.equal(atende(['administrativo.ver', 'entregas.ver']), true);
  assert.equal(atende(['entregas.ver', 'entregas.programar']), false); // operador
  assert.equal(ctx.Acesso.primeiraPaginaDe({ permissoes: ['entregas.baixar'] }), 'minhas_entregas.html');
});
