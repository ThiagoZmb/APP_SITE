process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso } = require('../index.js');
const { PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { REGEX_VALOR } = require('../seguranca/valores');

const perms = nome => new Set(PERFIS_INICIAIS.find(p => p.nome === nome).permissoes);
const USUARIOS = {
  1: { nome: 'Admin', perfil: 'Administrador', permissoes: perms('Administrador'), estados: [] },
  2: { nome: 'Ana', perfil: 'Representante', permissoes: perms('Representante'), estados: ['RJ'] }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t, regras = []) {
  const f = criarPoolFalso(regras);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => {
    const u = USUARIOS[id];
    return u && { codigo: id, nome: u.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id, nome: u.perfil }, estados: u.estados, ativo: true, permissoes: u.permissoes };
  });
  t.mock.method(console, 'warn', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho) => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token(id) } });
  return { f, chamar };
}

const linhas = [
  { numero: 10, cliente: 'A', valor: 5, situacao: 'Pronto', prontoEm: '', dataEntrega: '2026-10-30', entregaStatus: 'agendada', dataAgendada: '2026-11-02' },
  { numero: 11, cliente: 'B', valor: 6, situacao: 'Pronto', prontoEm: '', dataEntrega: '', entregaStatus: null, dataAgendada: null }
];
const JOIN_ENTREGA = /LEFT JOIN web_entregas en ON en\.numero = p\.NUMERO AND p\.TIPO = 'Pedido'/;

test('/dados_lista: entregaStatus e dataAgendada vêm do LEFT JOIN web_entregas, null sem registro', async t => {
  const { f, chamar } = await preparar(t, [[/FROM ped_orc p/, linhas]]);
  const d = await (await chamar(1, '/dados_lista?tipo=Pedido')).json();
  assert.equal(d[0].entregaStatus, 'agendada');
  assert.equal(d[0].dataAgendada, '2026-11-02');
  assert.equal(d[1].entregaStatus, null);
  assert.equal(d[1].dataAgendada, null);
  const sql = f.chamadas.find(c => /FROM ped_orc p/.test(c.sql)).sql;
  assert.match(sql, JOIN_ENTREGA);
});

test('/dados_lista de orçamentos: o JOIN só casa com TIPO Pedido (orçamento nunca recebe entregaStatus)', async t => {
  const { f, chamar } = await preparar(t, [[/FROM ped_orc p/, [{ numero: 1, cliente: 'X', entregaStatus: null, dataAgendada: null }]]]);
  const r = await chamar(1, '/dados_lista?tipo=' + encodeURIComponent('Orçamento'));
  assert.equal(r.status, 200);
  const c = f.chamadas.find(x => /FROM ped_orc p/.test(x.sql));
  assert.match(c.sql, JOIN_ENTREGA);
  assert.equal(c.params[0], 'Orçamento');
});

for (const caminho of ['/dados_pedidos', '/dados_pedidos_rj']) {
  test(`${caminho}: traz entregaStatus e dataAgendada`, async t => {
    const { f, chamar } = await preparar(t, [[/FROM ped_orc p/, linhas]]);
    const d = await (await chamar(1, caminho)).json();
    assert.equal(d[0].entregaStatus, 'agendada');
    assert.equal(d[1].entregaStatus, null);
    assert.match(f.chamadas.find(c => /FROM ped_orc p/.test(c.sql)).sql, JOIN_ENTREGA);
    assert.match(f.chamadas.find(c => /FROM ped_orc p/.test(c.sql)).sql, /DATE_FORMAT\(en\.data_agendada[^)]*\) as dataAgendada/);
  });
}

test('representante com estados restritos continua filtrado e com os campos de entrega', async t => {
  const { f, chamar } = await preparar(t, [[/FROM ped_orc p/, linhas]]);
  const d = await (await chamar(2, '/dados_lista?tipo=Pedido')).json();
  assert.equal(d[0].entregaStatus, 'agendada');
  const c = f.chamadas.find(x => /FROM ped_orc p/.test(x.sql));
  assert.match(c.sql, /c\.ESTADO IN \(\?\)/);
  assert.ok(c.params.includes('RJ'));
});

test('/clientes/financeiro: entregaStatus por pedido e qtdEntregasPendentes', async t => {
  const { f, chamar } = await preparar(t, [
    [/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, RAZAO_SOCIAL: 'CLI', ESTADO: 'RJ' }]],
    [/FROM ped_orc p\b.*web_entregas/s, [
      { NUMERO: 10, DATA: '2026-10-01', TOTAL: 5, SITUACAO: 'Pronto', FINANCEIRO: 'A Receber', ENTREGA_STATUS: 'em_rota' },
      { NUMERO: 11, DATA: '2026-10-02', TOTAL: 6, SITUACAO: 'Entregue', FINANCEIRO: 'A Receber', ENTREGA_STATUS: 'entregue' },
      { NUMERO: 12, DATA: '2026-10-03', TOTAL: 7, SITUACAO: 'Pronto', FINANCEIRO: 'A Receber', ENTREGA_STATUS: null }
    ]],
    [/AS qtd_entregas_pendentes/, [{ qtd_entregas_pendentes: 2 }]],
    [/AS atrasado/, [{ receber: 0, atrasado: 0 }]],
    [/SITUACAO <> 'Cancelado'/, [{ receber: 0 }]]
  ]);
  const d = await (await chamar(1, '/clientes/financeiro/5')).json();
  assert.deepEqual(d.pedidos.map(p => p.entregaStatus), ['em_rota', 'entregue', null]);
  assert.equal(d.qtdEntregasPendentes, 2);
  const sql = f.chamadas.find(c => /qtd_entregas_pendentes/.test(c.sql)).sql;
  assert.match(sql, /a_programar/);
  assert.match(sql, /enviada/);
  assert.doesNotMatch(sql, /entregue|retirado|cancelada/);
});

test('nenhuma chave nova casa com REGEX_VALOR', () => {
  for (const k of ['entregaStatus', 'dataAgendada', 'qtdEntregasPendentes']) {
    assert.ok(!REGEX_VALOR.test(k), k);
  }
});

test('rotas de entregas passam pelo registro (verificar não lança) e exigem permissão', async t => {
  const { registro } = require('../index.js');
  assert.doesNotThrow(() => registro.verificar());
  const { chamar } = await preparar(t);
  assert.equal((await chamar(2, '/entregas')).status, 403);
  assert.equal((await chamar(2, '/minhas_entregas')).status, 403);
});
