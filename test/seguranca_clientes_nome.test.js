// Tarefa 7: renomear cliente com histórico pede confirmação; relatório de nomes duplicados.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { REGEX_VALOR, CAMPOS_TECNICOS } = require('../seguranca/valores');
aceitarSidDeTeste(sessoes);

const USUARIOS = {
  1: { nome: 'Vera', permissoes: new Set(['clientes.ver', 'clientes.editar']), estados: [] },
  2: { nome: 'Ana', permissoes: new Set(['clientes.ver']), estados: [] },
  3: { nome: 'Rita', permissoes: new Set(['clientes.ver', 'clientes.editar']), estados: ['RJ'] }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2, sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t, regras) {
  const f = criarPoolFalso(regras);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => {
    const u = USUARIOS[id];
    return u && { codigo: id, nome: u.nome, cargo: '', empresa: 'ELEGANCE', perfil: null, estados: u.estados, ativo: true, permissoes: u.permissoes };
  });
  t.mock.method(console, 'warn', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho, corpo) => fetch(s.url + caminho, {
    method: corpo ? 'POST' : 'GET', body: corpo ? JSON.stringify(corpo) : undefined,
    headers: { Authorization: 'Bearer ' + token(id), 'Content-Type': 'application/json' } });
  return { f, chamar };
}

const corpo = extra => ({ codigo: 5, razaoSocial: 'NOVO NOME', classe: 'Esquadria', medicao: 'Vão', telefone: '1', estado: 'RJ', ...extra });
const gravada = [/SELECT CODIGO, RAZAO_SOCIAL FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, RAZAO_SOCIAL: 'NOME ANTIGO' }]];
const comPedido = [/FROM ped_orc WHERE RAZAO_SOCIAL/, [{ x: 1 }]];
const comLancamento = [/FROM fluxo_de_caixa WHERE RAZAO_SOCIAL/, [{ x: 1 }]];
const updates = f => f.chamadas.filter(c => /^UPDATE cadastro_clientes SET/.test(c.sql));
const auditorias = f => f.chamadas.filter(c => /INSERT INTO web_auditoria/.test(c.sql));

test('renomear cliente com pedido sem confirmar: 409 renomear_confirmar e nada gravado', async t => {
  const { f, chamar } = await preparar(t, [gravada, comPedido]);
  const r = await chamar(1, '/clientes/salvar', corpo());
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.codigo, 'renomear_confirmar');
  assert.equal(j.error, 'Este cliente tem histórico no nome atual. Confirme para renomear.');
  assert.equal(updates(f).length, 0);
  assert.equal(auditorias(f).length, 0);
  // a verificação usa o nome ANTIGO
  assert.deepEqual(f.chamadas.find(c => /FROM ped_orc WHERE RAZAO_SOCIAL/.test(c.sql)).params, ['NOME ANTIGO']);
});

test('renomear cliente só com lançamento no caixa também pede confirmação', async t => {
  const { f, chamar } = await preparar(t, [gravada, comLancamento]);
  const r = await chamar(1, '/clientes/salvar', corpo());
  assert.equal(r.status, 409);
  assert.equal((await r.json()).codigo, 'renomear_confirmar');
  assert.equal(updates(f).length, 0);
});

test('com confirmarRenomear: true grava e audita cliente_renomeado sem nomes', async t => {
  const { f, chamar } = await preparar(t, [gravada, comPedido]);
  const r = await chamar(1, '/clientes/salvar', corpo({ confirmarRenomear: true }));
  assert.equal(r.status, 200);
  assert.equal(updates(f).length, 1);
  const a = auditorias(f);
  assert.equal(a.length, 1);
  const ps = a[0].params;
  assert.ok(ps.includes('cliente_renomeado'));
  assert.ok(ps.includes('5'));
  assert.equal(ps[ps.length - 1], null);
  assert.ok(!JSON.stringify(ps).includes('NOME'));
});

test('só o booleano true libera: "true" e 1 continuam dando 409', async t => {
  const { f, chamar } = await preparar(t, [gravada, comPedido]);
  for (const valor of ['true', 1, 'sim']) {
    const r = await chamar(1, '/clientes/salvar', corpo({ confirmarRenomear: valor }));
    assert.equal(r.status, 409, String(valor));
  }
  assert.equal(updates(f).length, 0);
});

test('renomear cadastro sem histórico grava direto, com auditoria', async t => {
  const { f, chamar } = await preparar(t, [gravada]);
  const r = await chamar(1, '/clientes/salvar', corpo());
  assert.equal(r.status, 200);
  assert.equal(updates(f).length, 1);
  assert.equal(auditorias(f).length, 1);
});

test('salvar sem mudar a razão social não consulta histórico nem audita renomeação', async t => {
  const { f, chamar } = await preparar(t, [gravada, comPedido]);
  const r = await chamar(1, '/clientes/salvar', corpo({ razaoSocial: '  NOME ANTIGO ' }));
  assert.equal(r.status, 200);
  assert.equal(updates(f).length, 1);
  assert.ok(!f.chamadas.some(c => /FROM ped_orc WHERE RAZAO_SOCIAL/.test(c.sql)));
  assert.equal(auditorias(f).length, 0);
});

test('cadastro novo (código inexistente) nunca pede confirmação', async t => {
  const { f, chamar } = await preparar(t, [comPedido]);
  const r = await chamar(1, '/clientes/salvar', corpo());
  assert.equal(r.status, 200);
  assert.ok(f.chamadas.some(c => /^INSERT INTO cadastro_clientes/.test(c.sql)));
  assert.equal(auditorias(f).length, 0);
});

test('nomes_duplicados: devolve o agrupamento do banco e exige clientes.editar', async t => {
  const { f, chamar } = await preparar(t, [
    [/GROUP BY RAZAO_SOCIAL HAVING COUNT\(\*\) > 1/, [
      { razao: 'MARIA', qtd: 2, codigos: '7,9', estados: 'RJ,SP' },
      { razao: 'JOSE', qtd: 3, codigos: '1,2,3', estados: 'RJ,RJ,RJ' }
    ]]
  ]);
  const r = await chamar(1, '/clientes/nomes_duplicados');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j, { duplicados: [
    { razaoSocial: 'MARIA', qtdCadastros: 2, codigos: [7, 9] },
    { razaoSocial: 'JOSE', qtdCadastros: 3, codigos: [1, 2, 3] }
  ] });
  assert.ok(f.chamadas.some(c => /GROUP BY RAZAO_SOCIAL HAVING COUNT\(\*\) > 1/.test(c.sql)));
  assert.equal((await chamar(2, '/clientes/nomes_duplicados')).status, 403);
  // nenhum nome de campo é dinheiro: a rede de valores não apagaria nada
  for (const k of ['duplicados', 'razaoSocial', 'qtdCadastros', 'codigos']) assert.ok(!REGEX_VALOR.test(k) || CAMPOS_TECNICOS.has(k), k);
});

test('nomes_duplicados com estados restritos: só grupos com 2+ cadastros nos estados dele, sem códigos de fora', async t => {
  const { chamar } = await preparar(t, [
    [/GROUP BY RAZAO_SOCIAL HAVING COUNT\(\*\) > 1/, [
      { razao: 'MARIA', qtd: 2, codigos: '7,9', estados: 'RJ,SP' },
      { razao: 'JOSE', qtd: 3, codigos: '1,2,3', estados: 'RJ,RJ,SP' },
      { razao: 'LUIZ', qtd: 2, codigos: '4,6', estados: 'SP,MG' }
    ]]
  ]);
  const j = await (await chamar(3, '/clientes/nomes_duplicados')).json();
  assert.deepEqual(j, { duplicados: [{ razaoSocial: 'JOSE', qtdCadastros: 2, codigos: [1, 2] }] });
});

test('tela de clientes: ao receber renomear_confirmar pergunta e reenvia com confirmarRenomear', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'clientes.html'), 'utf8');
  assert.match(html, /e\.codigo\s*=\s*d\.codigo/);
  assert.match(html, /renomear_confirmar/);
  assert.match(html, /confirmarRenomear\s*=\s*true/);
});
