// Recebimento dividido em várias formas (POST /fluxo/salvar_varios) e resumo do pedido (GET /fluxo/pedido_resumo).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { validarDivisao, saldoDoPedido, numeroUnicoDoPedido, MAX_LINHAS } = require('../calculo/fluxo_varios');
aceitarSidDeTeste(sessoes);

const base = ['financeiro.lancar', 'financeiro.ver', 'valores.ver'];
const USUARIOS = {
  1: { nome: 'Barbara', permissoes: new Set([...base, 'clientes.receber']) },
  2: { nome: 'Lia', permissoes: new Set(base) },
  3: { nome: 'Sem', permissoes: new Set(['financeiro.ver']) }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t, regras) {
  const f = criarPoolFalso(regras);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => {
    const u = USUARIOS[id];
    return u && { codigo: id, nome: u.nome, cargo: '', empresa: 'ELEGANCE', perfil: null, estados: [], ativo: true, permissoes: u.permissoes };
  });
  t.mock.method(console, 'warn', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho, corpo) => fetch(s.url + caminho, {
    method: corpo ? 'POST' : 'GET', body: corpo ? JSON.stringify(corpo) : undefined,
    headers: { Authorization: 'Bearer ' + token(id), 'Content-Type': 'application/json' } });
  return { f, chamar };
}

const corpo = extra => ({
  movimento: 'Entrada', nome: 'LMO Modulados Ltda EPP', pedido: '23376', pdv: '460', preNota: '', notaFiscal: '11527', observacao: '', codClassificacao: 7,
  linhas: [
    { formaPgto: 'PIX', banco: 'BANESTES', valor: 500, data: '2026-09-01', situacao: 'Recebido' },
    { formaPgto: 'Cartão', banco: '', valor: '323,60', data: '2026-09-01', situacao: 'Recebido' }
  ], ...extra });
const inserts = f => f.chamadas.filter(c => /^\s*INSERT INTO fluxo_de_caixa/.test(c.sql));
const maximo = m => [/SELECT MAX\(ID\) AS m FROM fluxo_de_caixa FOR UPDATE/, [{ m }]];
const quitacoes = f => f.chamadas.filter(c => /UPDATE ped_orc SET FINANCEIRO = 'Recebido'/.test(c.sql));

test('validação: aceita 2 a 10 linhas de Entrada e arredonda valores em texto brasileiro', () => {
  const v = validarDivisao(corpo());
  assert.equal(v.ok, true);
  assert.equal(v.linhas[1].valor, 323.6);
  assert.equal(v.soma, 823.6);
  assert.equal(v.quitar, null);
  assert.equal(validarDivisao(corpo({ linhas: [corpo().linhas[0]] })).ok, false);
  assert.equal(validarDivisao(corpo({ linhas: Array(MAX_LINHAS + 1).fill(corpo().linhas[0]) })).ok, false);
  assert.equal(validarDivisao(corpo({ linhas: Array(MAX_LINHAS).fill(corpo().linhas[0]) })).ok, true);
});

test('validação: só Entrada, categoria obrigatória e cada linha com forma, data, valor > 0 e situação de entrada', () => {
  assert.match(validarDivisao(corpo({ movimento: 'Saída' })).erro, /só para Entrada/);
  assert.match(validarDivisao(corpo({ codClassificacao: 0 })).erro, /categoria/);
  const com = campos => validarDivisao(corpo({ linhas: [corpo().linhas[0], { ...corpo().linhas[1], ...campos }] }));
  assert.match(com({ formaPgto: ' ' }).erro, /Linha 2: .*forma de pagamento/);
  assert.match(com({ data: '31/09/2026' }).erro, /Linha 2: .*data/);
  assert.match(com({ valor: 0 }).erro, /Linha 2: .*valor/);
  assert.match(com({ valor: -5 }).erro, /Linha 2: .*valor/);
  assert.match(com({ situacao: 'Pago' }).erro, /Linha 2: .*situação/);
  assert.match(com({ situacao: '' }).erro, /Linha 2: .*situação/);
});

test('quitar o pedido exige um único número de pedido; saldo do pedido', () => {
  assert.equal(numeroUnicoDoPedido('23376'), 23376);
  assert.equal(numeroUnicoDoPedido('23376/23316'), null);
  assert.equal(numeroUnicoDoPedido(''), null);
  assert.equal(validarDivisao(corpo({ quitarPedido: true })).quitar, 23376);
  assert.match(validarDivisao(corpo({ quitarPedido: true, pedido: '23376/23316' })).erro, /único número/);
  assert.deepEqual(saldoDoPedido(1000, 500), { total: 1000, recebido: 500, falta: 500, cobreTotal: false });
  assert.deepEqual(saldoDoPedido(1000, 500, 500), { total: 1000, recebido: 1000, falta: 0, cobreTotal: true });
  assert.equal(saldoDoPedido(0, 0).cobreTotal, false);
  assert.equal(saldoDoPedido(100.1, 0.1, 100).falta, 0);
});

test('POST /fluxo/salvar_varios: grava as linhas em transação, com IDs em sequência após o maior', async t => {
  const { f, chamar } = await preparar(t, [maximo(9267)]);
  const r = await chamar(2, '/fluxo/salvar_varios', corpo());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.ids, [9268, 9269]);
  assert.equal(j.quitado, false);
  const ins = inserts(f);
  assert.equal(ins.length, 2);
  assert.deepEqual(ins.map(c => c.params[0]), [9268, 9269]);
  assert.equal(ins[0].params[3], 'LMO Modulados Ltda EPP');   // RAZAO_SOCIAL (entrada)
  assert.equal(ins[0].params[2], null);                       // RAZAO_FABRICANTE vazio
  assert.equal(ins[1].params[11], 323.6);
  assert.ok(!ins.some(c => /ON DUPLICATE/.test(c.sql)), 'nunca sobrescreve uma linha existente');
  assert.deepEqual(f.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql), ['BEGIN', 'COMMIT']);
  assert.equal(quitacoes(f).length, 0, 'sem a caixinha, o pedido não muda');
});

test('POST /fluxo/salvar_varios: linha inválida = 400 e nada é gravado', async t => {
  const { f, chamar } = await preparar(t, [maximo(10)]);
  const r = await chamar(2, '/fluxo/salvar_varios', corpo({ linhas: [corpo().linhas[0], { ...corpo().linhas[1], valor: 0 }] }));
  assert.equal(r.status, 400);
  assert.equal(inserts(f).length, 0);
  assert.equal(f.chamadas.length, 0, 'nem abre transação');
});

test('POST /fluxo/salvar_varios: colisão de ID na 2ª linha = 409 e ROLLBACK (nada fica salvo)', async t => {
  let n = 0;
  const { f, chamar } = await preparar(t, [maximo(50), [/^\s*INSERT INTO fluxo_de_caixa/, () => { if (++n === 2) { const e = new Error('dup'); e.errno = 1062; throw e; } return []; }]]);
  const r = await chamar(2, '/fluxo/salvar_varios', corpo());
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Nada foi salvo/);
  const trans = f.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql);
  assert.deepEqual(trans, ['BEGIN', 'ROLLBACK']);
});

test('POST /fluxo/salvar_varios: quitar marca o pedido como Recebido na mesma transação, com clientes.receber', async t => {
  const { f, chamar } = await preparar(t, [maximo(100), [/SELECT NUMERO FROM ped_orc/, [{ NUMERO: 23376 }]]]);
  const r = await chamar(1, '/fluxo/salvar_varios', corpo({ quitarPedido: true }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.quitado, true);
  assert.match(j.mensagem, /Pedido 23376 marcado como Recebido/);
  assert.deepEqual(quitacoes(f).map(c => c.params), [[23376]]);
  const sqls = f.chamadas.map(c => c.sql);
  assert.ok(sqls.indexOf('COMMIT') > sqls.findIndex(s => /UPDATE ped_orc/.test(s)), 'o UPDATE entra antes do COMMIT');
});

test('POST /fluxo/salvar_varios: quitar sem clientes.receber = 403 e nada é gravado; pedido inexistente = 404 e desfaz', async t => {
  const a = await preparar(t, [maximo(1)]);
  const r1 = await a.chamar(2, '/fluxo/salvar_varios', corpo({ quitarPedido: true }));
  assert.equal(r1.status, 403);
  assert.equal(inserts(a.f).length, 0);
  const b = await preparar(t, [maximo(1), [/SELECT NUMERO FROM ped_orc/, []]]);
  const r2 = await b.chamar(1, '/fluxo/salvar_varios', corpo({ quitarPedido: true }));
  assert.equal(r2.status, 404);
  assert.equal(inserts(b.f).length, 0);
});

test('POST /fluxo/salvar_varios: exige financeiro.lancar', async t => {
  const { f, chamar } = await preparar(t, [maximo(1)]);
  const r = await chamar(3, '/fluxo/salvar_varios', corpo());
  assert.equal(r.status, 403);
  assert.equal(inserts(f).length, 0);
});

test('GET /fluxo/pedido_resumo: total, já recebido e falta; 400 sem número único; 404 sem pedido', async t => {
  const { f, chamar } = await preparar(t, [
    [/FROM ped_orc WHERE TIPO = 'Pedido' AND NUMERO = \?/, [{ TOTAL: '1000.00', FINANCEIRO: 'A Receber', SITUACAO: 'Em Produção' }]],
    [/SELECT COALESCE\(SUM\(VALOR\), 0\) AS soma FROM fluxo_de_caixa/, [{ soma: '500.00' }]]
  ]);
  const r = await chamar(2, '/fluxo/pedido_resumo?numero=23376');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { numero: 23376, total: 1000, recebido: 500, falta: 500, cobreTotal: false, financeiro: 'A Receber', situacao: 'Em Produção' });
  const soma = f.chamadas.find(c => /SUM\(VALOR\)/.test(c.sql));
  assert.deepEqual(soma.params, ['23376']);
  assert.equal((await chamar(2, '/fluxo/pedido_resumo?numero=23376/23316')).status, 400);
  const vazio = await preparar(t, []);
  assert.equal((await vazio.chamar(2, '/fluxo/pedido_resumo?numero=5')).status, 404);
});
