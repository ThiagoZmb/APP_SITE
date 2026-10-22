process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, registro, colunasPdf } = require('../index.js');
const { PERFIS_INICIAIS } = require('../seguranca/permissoes');

const perms = nome => new Set(PERFIS_INICIAIS.find(p => p.nome === nome).permissoes);
const USUARIOS = {
  1: { nome: 'Admin', perfil: 'Administrador', permissoes: perms('Administrador'), estados: [] },
  2: { nome: 'Ana', perfil: 'Representante', permissoes: perms('Representante'), estados: ['RJ'] },
  3: { nome: 'Caio', perfil: 'Estoquista', permissoes: perms('Estoquista'), estados: [] },
  4: { nome: 'Edu', perfil: 'Estoque sem valores', permissoes: new Set(['estoque.ver', 'estoque.editar', 'produtos.ver', 'clientes.ver']), estados: [] }
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
  const chamar = (id, caminho, opcoes = {}) => fetch(s.url + caminho, {
    ...opcoes, headers: { Authorization: 'Bearer ' + token(id), 'Content-Type': 'application/json', ...(opcoes.headers || {}) } });
  return { f, chamar };
}

test('registro.verificar() não lança: todas as rotas estão registradas', () => {
  assert.doesNotThrow(() => registro.verificar());
});

test('estoquista: estoque 200; fluxo e listas de pedidos 403', async t => {
  const { chamar } = await preparar(t, [[/FROM estoque/, [{ CODIGO: 1, NOME_PRODUTO: 'Perfil', QTD_ESTOQUE: 3 }]]]);
  assert.equal((await chamar(3, '/estoque')).status, 200);
  assert.equal((await chamar(3, '/fluxo')).status, 403);
  assert.equal((await chamar(3, '/dados_lista?tipo=Pedido')).status, 403);
  assert.equal((await chamar(3, '/calcular_preco', { method: 'POST', body: '{}' })).status, 403);
});

test('item de estoque sem valores.ver não traz VALOR, FRETE nem IPI', async t => {
  const { chamar } = await preparar(t, [[/FROM estoque WHERE CODIGO/, [{ CODIGO: 1, NOME_PRODUTO: 'Perfil', QTD_ESTOQUE: 3, VALOR: 10, FRETE: 2, IPI: 5 }]]]);
  const d = await (await chamar(3, '/estoque/item/1')).json();
  assert.ok(!JSON.stringify(d).match(/"(valor|VALOR|frete|FRETE|ipi|IPI)"/), JSON.stringify(d));
});

test('resumo do estoque sem valores.ver não tem valorTotal', async t => {
  const { chamar } = await preparar(t, [[/SUM\(CASE/, [{ total: 999, ativos: 2, falta: 0, minimo: 1 }]]]);
  const d = await (await chamar(3, '/estoque/resumo')).json();
  assert.equal(d.valorTotal, undefined);
  assert.equal(d.ativos, 2);
});

test('representante RJ: /dados_lista filtra ESTADO IN (?) com RJ e sem valor', async t => {
  const { f, chamar } = await preparar(t, [[/FROM ped_orc p/, [{ numero: 1, cliente: 'X', valor: 50 }]]]);
  const r = await chamar(2, '/dados_lista?tipo=Pedido');
  assert.equal(r.status, 200);
  const sql = f.chamadas.find(c => /FROM ped_orc p/.test(c.sql));
  assert.match(sql.sql, /c\.ESTADO IN \(\?\)/);
  assert.ok(sql.params.includes('RJ'));
  assert.equal((await r.json())[0].valor, 50); // representante tem valores.ver
});

test('usuário com clientes.ver sem valores.ver: análise sem dinheiro', async t => {
  const { chamar } = await preparar(t, [
    [/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, RAZAO_SOCIAL: 'CLI', ESTADO: 'ES', DESCONTO: 10, CREDITO: 100 }]],
    [/COUNT\(\*\) AS qtd, SUM\(TOTAL\)/, [{ primeiro: '2025-01-01', qtd: 3, total: 900 }]],
    [/AS pedidos, SUM\(IF/, [{ pedidos: 5000, orcamentos: 8000, clientes: 12 }]],
    [/AS posicao/, [{ posicao: 3 }]],
    [/SUM\(VALOR\) AS total, COUNT/, [{ total: 300, qtd: 2 }]],
    [/FROM ped_orc WHERE RAZAO_SOCIAL = \? AND DATA/, [{ NUMERO: 1, TIPO: 'Pedido', DATA: '2026-01-01', TOTAL: 300 }]]
  ]);
  const d = await (await chamar(4, '/clientes/analise/5')).json();
  const texto = JSON.stringify(d);
  for (const campo of ['pedidos12m', 'orcamentos12m', 'totalVida', 'receber', 'recebido12m', 'desconto', 'credito', 'valor']) {
    assert.ok(!texto.includes(`"${campo}"`), `não deveria ter ${campo}: ${texto}`);
  }
  assert.equal(d.cliente.pedidosVida, 3);
  assert.equal(d.empresa.clientesAtivos12m, 12);
});

test('cliente fora dos estados do usuário: 403', async t => {
  USUARIOS[4].estados = ['RJ'];
  t.after(() => { USUARIOS[4].estados = []; });
  const { chamar } = await preparar(t, [[/FROM cadastro_clientes WHERE CODIGO/, [{ CODIGO: 5, RAZAO_SOCIAL: 'CLI', ESTADO: 'ES' }]]]);
  assert.equal((await chamar(4, '/clientes/item/5')).status, 403);
});

test('colunasPdf: sem valores não tem Unitário nem Total', () => {
  assert.deepEqual(colunasPdf(false).map(c => c.label), ['Item', 'Qtd', 'Descrição', 'Observação']);
  assert.deepEqual(colunasPdf(true).map(c => c.label), ['Item', 'Qtd', 'Descrição', 'Observação', 'Unitário', 'Total']);
  const soma = cols => cols.reduce((s, c) => s + c.w, 0);
  assert.ok(Math.abs(soma(colunasPdf(false), 500) - soma(colunasPdf(true))) < 1e-9);
});

test('estoque/salvar sem valores.ver preserva VALOR, FRETE e IPI do banco', async t => {
  const { f, chamar } = await preparar(t, [
    [/SELECT VALOR, FRETE, IPI FROM estoque/, [{ VALOR: 25.5, FRETE: 1.5, IPI: 3 }]],
    [/SELECT CODIGO FROM estoque WHERE CODIGO/, [{ CODIGO: 7 }]]
  ]);
  const r = await chamar(4, '/estoque/salvar', { method: 'POST', body: JSON.stringify({
    codigo: 7, codBarras: '7890000000001', produto: 'Perfil X', classe: 'Perfil', unidade: 'Barra', qtd: 10, valor: 0, frete: 0, ipi: 0 }) });
  assert.equal(r.status, 200, await r.clone().text());
  const up = f.chamadas.find(c => /^\s*UPDATE estoque SET/.test(c.sql));
  assert.ok(up.params.includes(25.5) && up.params.includes(1.5) && up.params.includes(3), JSON.stringify(up.params));
});

test('estoque/salvar item novo sem valores.ver: 403', async t => {
  const { chamar } = await preparar(t, []);
  const r = await chamar(4, '/estoque/salvar', { method: 'POST', body: JSON.stringify({ codBarras: '7890000000001', produto: 'Novo', classe: 'Perfil', unidade: 'Barra', valor: 5 }) });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'Cadastrar item novo exige permissão de valores.' });
});

test('produtos/item sem valores.ver mantém descontoVidro e tira o valor', async t => {
  const { chamar } = await preparar(t, [[/FROM cadastro_de_produtos WHERE CODIGO/, [{ CODIGO: 9, MODELO: 'P', DESCONTO_VIDRO: 12, DESC_PERF_PUX: 4, VALOR_CHEIO: 80, VALOR_FIXO: 70 }]]]);
  const d = await (await chamar(4, '/produtos/item/9')).json();
  assert.equal(d.descontoVidro, 12);
  assert.equal(d.descPerfPux, 4);
  assert.equal(d.valorFixo, undefined);
});

test('produtos/item não devolve VALOR_CHEIO (só o VALOR_FIXO é usado na web)', async t => {
  const { chamar } = await preparar(t, [[/FROM cadastro_de_produtos WHERE CODIGO/, [{ CODIGO: 9, MODELO: 'P', VALOR_CHEIO: 80, VALOR_FIXO: 70 }]]]);
  const d = await (await chamar(1, '/produtos/item/9')).json();
  assert.equal(d.valorFixo, 70);
  assert.equal('valorCheio' in d, false);
});

const produtoSalvar = (mudar = {}) => ({ codigo: 9, modelo: 'P', classe: 'Perfis', classeAcabamento: 'Anodizado', valorFixo: 70, descontoVidro: 0, descPerfPux: 0,
  situacao: 'Ativo', ...mudar });

test('produtos/salvar: editar não mexe no VALOR_CHEIO; não exige valor cheio', async t => {
  const { f, chamar } = await preparar(t, [[/SELECT COUNT\(\*\) AS n FROM cadastro_de_produtos/, [{ n: 1 }]], [/FROM cadastro_de_produtos WHERE CODIGO/, [{ VALOR_FIXO: 60 }]]]);
  const r = await chamar(1, '/produtos/salvar', { method: 'POST', body: JSON.stringify(produtoSalvar()) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const up = f.chamadas.find(c => /^\s*UPDATE cadastro_de_produtos SET/.test(c.sql));
  assert.ok(!/VALOR_CHEIO/.test(up.sql), up.sql);
  assert.ok(up.params.includes(70));
  assert.ok(f.chamadas.every(c => !/SELECT[^]*VALOR_CHEIO/.test(c.sql)));
});

test('produtos/salvar: produto novo grava VALOR_CHEIO = VALOR_FIXO (o VB ainda lê a coluna)', async t => {
  const { f, chamar } = await preparar(t, [[/SELECT COUNT\(\*\) AS n FROM cadastro_de_produtos/, [{ n: 0 }]]]);
  const r = await chamar(1, '/produtos/salvar', { method: 'POST', body: JSON.stringify(produtoSalvar({ valorFixo: 55.5 })) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const ins = f.chamadas.find(c => /^\s*INSERT INTO cadastro_de_produtos/.test(c.sql));
  const cols = ins.sql.match(/\(([^)]+)\)\s*VALUES/)[1].split(',').map(c => c.trim());
  assert.equal(ins.params[cols.indexOf('VALOR_CHEIO')], 55.5);
  assert.equal(ins.params[cols.indexOf('VALOR_FIXO')], 55.5);
});
