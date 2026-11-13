// Lançar o mesmo movimento em várias datas: POST /fluxo/salvar_datas, validarVariasDatas e as contas puras de fluxo_datas.js.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { validarVariasDatas, MAX_DATAS, MIN_DATAS } = require('../calculo/fluxo_varios');
const FluxoDatas = require('../fluxo_datas.js');
aceitarSidDeTeste(sessoes);

const base = ['financeiro.lancar', 'financeiro.ver', 'valores.ver'];
const USUARIOS = { 2: { nome: 'Lia', permissoes: new Set(base) }, 3: { nome: 'Sem', permissoes: new Set(['financeiro.ver']) } };
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
  const chamar = (id, corpo) => fetch(s.url + '/fluxo/salvar_datas', {
    method: 'POST', body: JSON.stringify(corpo), headers: { Authorization: 'Bearer ' + token(id), 'Content-Type': 'application/json' } });
  return { f, chamar };
}

const maximo = m => [/SELECT MAX\(ID\) AS m FROM fluxo_de_caixa FOR UPDATE/, [{ m }]];
const inserts = f => f.chamadas.filter(c => /^\s*INSERT INTO fluxo_de_caixa/.test(c.sql));
const trans = f => f.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql);

const corpo = extra => ({
  movimento: 'Saída', nome: 'Fornecedor X', pedido: '', pdv: '', preNota: '', notaFiscal: '555', observacao: 'boletos', codClassificacao: 7,
  formaPgto: 'Boleto', banco: 'BANESTES', valor: '1.250,50', situacao: 'A Pagar',
  datas: ['2026-12-10', '2027-01-10', '2027-02-10'], ...extra });

test('validação: 2 a 24 datas, categoria, tipo, situação do tipo e data válida', () => {
  const v = validarVariasDatas(corpo());
  assert.equal(v.ok, true);
  assert.equal(v.linhas.length, 3);
  assert.equal(v.soma, 3751.5);
  assert.equal(validarVariasDatas(corpo({ datas: ['2026-12-10'] })).ok, false);
  assert.equal(validarVariasDatas(corpo({ datas: Array(MIN_DATAS).fill('2026-12-10') })).ok, true, 'datas repetidas são permitidas');
  assert.equal(validarVariasDatas(corpo({ datas: Array(MAX_DATAS).fill('2026-12-10') })).ok, true);
  assert.match(validarVariasDatas(corpo({ datas: Array(MAX_DATAS + 1).fill('2026-12-10') })).erro, /No máximo 24/);
  assert.equal(validarVariasDatas(corpo({ datas: undefined })).ok, false);
  assert.equal(validarVariasDatas(corpo({ codClassificacao: 0 })).ok, false);
  assert.match(validarVariasDatas(corpo({ movimento: 'X' })).erro, /Tipo de movimento/);
  assert.match(validarVariasDatas(corpo({ situacao: 'Recebido' })).erro, /Data 1: .*situação/);
  assert.match(validarVariasDatas(corpo({ datas: ['2026-12-10', '2026-02-31x'] })).erro, /Data 2: .*data válida/);
  assert.match(validarVariasDatas(corpo({ valor: 0 })).erro, /maior que zero/);
  assert.match(validarVariasDatas(corpo({ formaPgto: '', situacao: 'Pago' })).erro, /forma de pagamento/);
  assert.equal(validarVariasDatas(corpo({ formaPgto: '', situacao: 'A Pagar' })).ok, true);
});

test('Saída: grava N linhas em ordem, mesmos dados, só a data muda, numa transação', async t => {
  const { f, chamar } = await preparar(t, [maximo(9000)]);
  const r = await chamar(2, corpo());
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  assert.deepEqual(j.ids, [9001, 9002, 9003]);
  const ins = inserts(f);
  assert.equal(ins.length, 3);
  assert.deepEqual(ins.map(c => c.params[1]), ['2026-12-10', '2027-01-10', '2027-02-10']);
  for (const c of ins) {
    assert.deepEqual([c.params[2], c.params[3]], ['Fornecedor X', null], 'fornecedor em RAZAO_FABRICANTE');
    assert.deepEqual([c.params[7], c.params[8], c.params[9], c.params[10], c.params[11], c.params[13]], ['555', 'Boleto', 'BANESTES', 'A Pagar', 1250.5, 7]);
  }
  assert.ok(!ins.some(c => /ON DUPLICATE/.test(c.sql)));
  assert.deepEqual(trans(f), ['BEGIN', 'COMMIT']);
});

test('Entrada: cliente em RAZAO_SOCIAL', async t => {
  const { f, chamar } = await preparar(t, [maximo(10)]);
  const r = await chamar(2, corpo({ movimento: 'Entrada', nome: 'Cliente Y', situacao: 'A Receber', datas: ['2026-12-10', '2026-12-10'] }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const ins = inserts(f);
  assert.equal(ins.length, 2);
  assert.deepEqual([ins[0].params[2], ins[0].params[3]], [null, 'Cliente Y']);
});

test('tudo ou nada: falha no meio faz ROLLBACK; colisão de ID = 409', async t => {
  let n = 0;
  const a = await preparar(t, [maximo(50), [/^\s*INSERT INTO fluxo_de_caixa/, () => { if (++n === 2) { const e = new Error('dup'); e.errno = 1062; throw e; } return []; }]]);
  const r = await a.chamar(2, corpo());
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Nada foi salvo/);
  assert.deepEqual(trans(a.f), ['BEGIN', 'ROLLBACK']);
  let m = 0;
  const b = await preparar(t, [maximo(50), [/^\s*INSERT INTO fluxo_de_caixa/, () => { if (++m === 3) throw new Error('queda'); return []; }]]);
  t.mock.method(console, 'error', () => {});
  const r2 = await b.chamar(2, corpo());
  assert.equal(r2.status, 500);
  assert.deepEqual(trans(b.f), ['BEGIN', 'ROLLBACK']);
});

test('dados inválidos = 400 sem abrir transação; acima do limite não grava nada; exige financeiro.lancar', async t => {
  const a = await preparar(t, [maximo(1)]);
  assert.equal((await a.chamar(2, corpo({ datas: Array(MAX_DATAS + 1).fill('2026-12-10') }))).status, 400);
  assert.equal((await a.chamar(2, corpo({ datas: ['2026-12-10', 'abc'] }))).status, 400);
  assert.equal(a.f.chamadas.length, 0);
  const b = await preparar(t, [maximo(1)]);
  assert.equal((await b.chamar(3, corpo())).status, 403);
  assert.equal(b.f.chamadas.length, 0);
});

test('tela (contas puras): datas sugeridas no mesmo dia dos meses seguintes, limite da quantidade e resumo', () => {
  const { sugerirData, limitarQtd, textoResumo } = FluxoDatas;
  assert.equal(sugerirData('2026-11-10', 0), '2026-11-10');
  assert.equal(sugerirData('2026-11-10', 2), '2027-01-10');
  assert.equal(sugerirData('2026-11-10', 14), '2028-01-10');
  assert.equal(sugerirData('2026-01-31', 1), '2026-02-28', 'dia 31 vira o último dia do mês curto');
  assert.equal(sugerirData('2028-01-31', 1), '2028-02-29');
  assert.equal(sugerirData('', 1), '');
  assert.equal(limitarQtd('1'), 2);
  assert.equal(limitarQtd('99'), 24);
  assert.equal(limitarQtd(''), 2);
  assert.equal(limitarQtd('5'), 5);
  assert.equal(textoResumo(3, 100.1, n => 'R$ ' + n.toFixed(2)), '3 lançamentos de R$ 100.10 = total R$ 300.30.');
});
