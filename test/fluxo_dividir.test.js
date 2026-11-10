// Dividir um movimento JÁ EXISTENTE (Editar movimento), Entrada ou Saída: POST /fluxo/dividir e validarDivisaoEdicao.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { validarDivisaoEdicao, MAX_LINHAS } = require('../calculo/fluxo_varios');
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
  const chamar = (id, caminho, corpo) => fetch(s.url + caminho, {
    method: 'POST', body: JSON.stringify(corpo), headers: { Authorization: 'Bearer ' + token(id), 'Content-Type': 'application/json' } });
  return { f, chamar };
}

const maximo = m => [/SELECT MAX\(ID\) AS m FROM fluxo_de_caixa FOR UPDATE/, [{ m }]];
const existente = (soc, fab) => [/SELECT ID, RAZAO_SOCIAL, RAZAO_FABRICANTE FROM fluxo_de_caixa WHERE ID = \? FOR UPDATE/, [{ ID: 9180, RAZAO_SOCIAL: soc, RAZAO_FABRICANTE: fab }]];
const inserts = f => f.chamadas.filter(c => /^\s*INSERT INTO fluxo_de_caixa/.test(c.sql));
const atualizacoes = f => f.chamadas.filter(c => /^\s*UPDATE fluxo_de_caixa SET/.test(c.sql));
const trans = f => f.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql);

const corpo = extra => ({
  id: 9180, movimento: 'Entrada', nome: 'Arquiteto', pedido: '23411', pdv: '430', preNota: '', notaFiscal: '11472', observacao: 'obs', codClassificacao: 7,
  linhas: [
    { formaPgto: 'Cartão de crédito', banco: 'BANESTES', valor: 600, data: '2026-11-16', situacao: 'A Receber' },
    { formaPgto: 'PIX', banco: 'BANESTES', valor: '549,28', data: '2026-11-20', situacao: 'A Receber' }
  ], ...extra });

test('validação: id, tipo, 2 a 10 parcelas e situação do tipo (Saída não aceita Recebido)', () => {
  assert.equal(validarDivisaoEdicao(corpo()).ok, true);
  assert.equal(validarDivisaoEdicao(corpo()).soma, 1149.28);
  assert.match(validarDivisaoEdicao(corpo({ id: 0 })).erro, /Registro inválido/);
  assert.match(validarDivisaoEdicao(corpo({ movimento: 'Outro' })).erro, /Tipo de movimento/);
  assert.match(validarDivisaoEdicao(corpo({ linhas: [corpo().linhas[0]] })).erro, /pelo menos duas/);
  assert.equal(validarDivisaoEdicao(corpo({ linhas: Array(MAX_LINHAS + 1).fill(corpo().linhas[0]) })).ok, false);
  assert.equal(validarDivisaoEdicao(corpo({ codClassificacao: 0 })).ok, false);
  const saida = linhas => corpo({ movimento: 'Saída', linhas });
  assert.equal(validarDivisaoEdicao(saida([{ ...corpo().linhas[0], situacao: 'Pago' }, { ...corpo().linhas[1], situacao: 'A Pagar' }])).ok, true);
  assert.match(validarDivisaoEdicao(saida([{ ...corpo().linhas[0], situacao: 'Recebido' }, { ...corpo().linhas[1], situacao: 'A Pagar' }])).erro, /Linha 1: .*situação/);
  assert.match(validarDivisaoEdicao(corpo({ linhas: [corpo().linhas[0], { ...corpo().linhas[1], situacao: 'Pago' }] })).erro, /Linha 2: .*situação/);
});

test('validação: forma em branco só em "A Receber" (Entrada) e "A Pagar" (Saída)', () => {
  const primeira = movimento => ({ ...corpo().linhas[0], situacao: movimento === 'Saída' ? 'Pago' : 'Recebido' });
  const semForma = (situacao, movimento) => validarDivisaoEdicao(corpo({ movimento, linhas: [primeira(movimento), { ...corpo().linhas[1], formaPgto: '', situacao }] }));
  assert.equal(semForma('A Receber', 'Entrada').ok, true);
  assert.equal(semForma('A Pagar', 'Saída').ok, true);
  assert.match(semForma('Recebido', 'Entrada').erro, /Linha 2: .*forma de pagamento/);
  assert.match(semForma('Pago', 'Saída').erro, /Linha 2: .*forma de pagamento/);
});

test('Entrada: atualiza o registro com a 1ª parcela e cria as outras, numa transação', async t => {
  const { f, chamar } = await preparar(t, [existente('Arquiteto', null), maximo(9267)]);
  const r = await chamar(2, '/fluxo/dividir', corpo());
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  assert.equal(j.id, 9180);
  assert.deepEqual(j.ids, [9268]);
  const up = atualizacoes(f);
  assert.equal(up.length, 1);
  assert.equal(up[0].params.at(-1), 9180, 'atualiza pelo ID existente');
  assert.equal(up[0].params[10], 600, 'VALOR da 1ª parcela');
  assert.equal(up[0].params[7], 'Cartão de crédito');
  assert.equal(up[0].params[2], 'Arquiteto', 'cliente em RAZAO_SOCIAL');
  assert.equal(up[0].params[1], null, 'RAZAO_FABRICANTE vazio na entrada');
  const ins = inserts(f);
  assert.equal(ins.length, 1);
  assert.deepEqual([ins[0].params[0], ins[0].params[10], ins[0].params[11], ins[0].params[1]], [9268, 'A Receber', 549.28, '2026-11-20']);
  assert.equal(ins[0].params[3], 'Arquiteto');
  assert.equal(ins[0].params[4], '23411');
  assert.ok(!ins.some(c => /ON DUPLICATE/.test(c.sql)));
  assert.deepEqual(trans(f), ['BEGIN', 'COMMIT']);
});

test('Saída: o fornecedor vai em RAZAO_FABRICANTE, nunca em RAZAO_SOCIAL', async t => {
  const { f, chamar } = await preparar(t, [existente(null, 'Fornecedor X'), maximo(9267)]);
  const linhas = [{ formaPgto: 'Boleto', banco: 'BANESTES', valor: 700, data: '2026-11-16', situacao: 'Pago' }, { formaPgto: '', banco: '', valor: 449.28, data: '2026-12-16', situacao: 'A Pagar' }];
  const r = await chamar(2, '/fluxo/dividir', corpo({ movimento: 'Saída', nome: 'Fornecedor X', linhas }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const up = atualizacoes(f)[0], ins = inserts(f)[0];
  assert.deepEqual([up.params[1], up.params[2]], ['Fornecedor X', null]);
  assert.deepEqual([ins.params[2], ins.params[3]], ['Fornecedor X', null]);
  assert.equal(ins.params[8], '', 'forma em branco na parcela A Pagar');
});

test('trocar Entrada por Saída (ou o contrário) = 409 e nada é gravado', async t => {
  const a = await preparar(t, [existente('Arquiteto', null), maximo(1)]);
  const linhasSaida = [{ ...corpo().linhas[0], situacao: 'A Pagar' }, { ...corpo().linhas[1], situacao: 'A Pagar' }];
  assert.equal((await a.chamar(2, '/fluxo/dividir', corpo({ movimento: 'Saída', linhas: linhasSaida }))).status, 409);
  assert.equal(atualizacoes(a.f).length + inserts(a.f).length, 0);
  const b = await preparar(t, [existente(null, 'Fornecedor X'), maximo(1)]);
  assert.equal((await b.chamar(2, '/fluxo/dividir', corpo())).status, 409);
  assert.equal(atualizacoes(b.f).length + inserts(b.f).length, 0);
  assert.deepEqual(trans(b.f), ['BEGIN', 'ROLLBACK']);
});

test('registro inexistente = 404; dados inválidos = 400 sem abrir transação; colisão de ID = 409 com ROLLBACK', async t => {
  const a = await preparar(t, [maximo(1)]);
  assert.equal((await a.chamar(2, '/fluxo/dividir', corpo())).status, 404);
  assert.equal(atualizacoes(a.f).length, 0);
  const b = await preparar(t, [existente('Arquiteto', null)]);
  assert.equal((await b.chamar(2, '/fluxo/dividir', corpo({ id: 0 }))).status, 400);
  assert.equal(b.f.chamadas.length, 0);
  let n = 0;
  const c = await preparar(t, [existente('Arquiteto', null), maximo(50), [/^\s*INSERT INTO fluxo_de_caixa/, () => { if (++n === 1) { const e = new Error('dup'); e.errno = 1062; throw e; } return []; }]]);
  const r = await c.chamar(2, '/fluxo/dividir', corpo());
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Nada foi salvo/);
  assert.deepEqual(trans(c.f), ['BEGIN', 'ROLLBACK']);
});

test('exige financeiro.lancar', async t => {
  const { f, chamar } = await preparar(t, [existente('Arquiteto', null), maximo(1)]);
  assert.equal((await chamar(3, '/fluxo/dividir', corpo())).status, 403);
  assert.equal(f.chamadas.length, 0);
});
