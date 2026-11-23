// Busca global da lista de Pedidos e Orçamentos (painel_inicial.html): com texto na busca, período, cliente e chip de situação
// são ignorados. O servidor já devolve TODOS os registros do tipo (sem limite de data); estados e valores.ver são aplicados lá.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
aceitarSidDeTeste(sessoes);

const painel = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8');

// ---------- servidor: a rota não limita por data, é parametrizada e respeita estados e valores.ver ----------
const USUARIOS = {
  1: { nome: 'Ana', permissoes: new Set(['pedidos.ver', 'valores.ver']), estados: ['RJ'] },
  2: { nome: 'Edu', permissoes: new Set(['pedidos.ver']), estados: [] }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
async function preparar(t, regras) {
  const f = criarPoolFalso(regras);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => {
    const u = USUARIOS[id];
    return u && { codigo: id, nome: u.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id, nome: 'X' }, estados: u.estados, ativo: true, permissoes: u.permissoes };
  });
  t.mock.method(console, 'warn', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  return { f, chamar: (id, caminho) => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token(id) } }) };
}
const LINHAS = [
  { numero: 1, cliente: 'Antigo', data: '01/01/2020', valor: 10, situacao: 'Entregue' },
  { numero: 2, cliente: 'Novo', data: '10/11/2026', valor: 20, situacao: 'Em Produção' }
];

test('/dados_lista devolve registros antigos e novos (nenhum filtro de data no SQL) e só parametriza tipo e estados', async t => {
  const { f, chamar } = await preparar(t, [[/FROM ped_orc p/, LINHAS]]);
  const r = await chamar(1, '/dados_lista?tipo=Pedido&q=%27%3B%20DROP%20TABLE%20x');
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo.map(x => x.numero), [1, 2], 'a lista inclui o pedido de 2020');
  const c = f.chamadas.find(x => /FROM ped_orc p/.test(x.sql));
  const onde = c.sql.slice(c.sql.lastIndexOf('WHERE'));
  assert.doesNotMatch(onde, /DATA|INTERVAL|LIMIT|BETWEEN/i, 'sem período nem limite no WHERE principal');
  assert.doesNotMatch(c.sql, /DROP|LIKE/i, 'texto de busca nunca entra no SQL');
  assert.deepEqual(c.params, ['Pedido', 'RJ'], 'só tipo e estados do usuário, por parâmetro');
  assert.match(c.sql, /c\.ESTADO IN \(\?\)/);
});

test('/dados_lista: estados restritos continuam valendo e sem valores.ver o valor some', async t => {
  const { f, chamar } = await preparar(t, [[/FROM ped_orc p/, LINHAS]]);
  const comValor = await (await chamar(1, '/dados_lista?tipo=Orçamento')).json();
  assert.equal(comValor[0].valor, 10);
  assert.ok(f.chamadas.find(x => /FROM ped_orc p/.test(x.sql)).params.includes('RJ'));
  const semValor = await (await chamar(2, '/dados_lista?tipo=Pedido')).json();
  assert.ok(!JSON.stringify(semValor).match(/"valor"/), 'sem valores.ver não há dinheiro, então a busca não acha por valor');
  const semEstado = f.chamadas.filter(x => /FROM ped_orc p/.test(x.sql)).pop();
  assert.doesNotMatch(semEstado.sql, /c\.ESTADO IN/);
});

// ---------- tela: listaDaTela real do painel_inicial.html ----------
function tela({ pedidos = [], orcamentos = [] } = {}) {
  const ini = painel.indexOf('const COLUNAS = ['), fim = painel.indexOf('function renderAvisoBusca(');
  assert.ok(ini > 0 && fim > ini);
  const campos = { 'search-input': { value: '' } };
  const norm = t => String(t || '').toLowerCase().trim();
  const ctx = {
    $: id => campos[id], norm, esc: String, moeda: String, soma: l => l.length,
    // janela real: só do dia 01/11/2026 em diante; `entre` filtra por dt como o painel
    janela: () => ({ ini: new Date(2026, 10, 1), fim: new Date(2026, 10, 30), nome: 'este mês' }),
    entre: (l, a, b) => a ? l.filter(x => x.dt && x.dt >= a && x.dt <= b) : [],
    textoBusca: x => norm(Object.entries(x).filter(([k]) => !['dt', 's'].includes(k)).map(([, v]) => v).join(' ')),
    iconesItens: () => '', semanaDaData: () => '', seloEntrega: () => '', seloAndamento: () => '', Situacoes: { selo: () => '' },
    Acesso: { pode: () => true }, OlhoResumos: { visivel: () => false }, window: {}
  };
  vm.createContext(ctx);
  vm.runInContext(`let tipoLista = 'Pedido', filtroSit = '', cliente = ''; let pedidos = ${JSON.stringify(pedidos)}, orcamentos = ${JSON.stringify(orcamentos)};
    pedidos.concat(orcamentos).forEach(x => x.dt = new Date(x.dtIso));
    const NOME_SIT = {}, VALOR_SIT = {};
    const doCliente = l => cliente ? l.filter(x => x.cliente === cliente) : l;
    ${painel.slice(ini, fim)}
    this.api = { listaDaTela, set(o) { if ('tipoLista' in o) tipoLista = o.tipoLista; if ('filtroSit' in o) filtroSit = o.filtroSit; if ('cliente' in o) cliente = o.cliente; } };`, ctx);
  return { api: ctx.api, campos };
}
const reg = (numero, cliente, s, dtIso, extra = {}) => ({ numero, cliente, s, v: 100, dtIso, situacao: s, data: '', observacao: '', ...extra });
const PEDIDOS = [reg(1, 'Antigo', 'entregue', '2020-01-05', { observacao: 'cobertura vidro' }), reg(2, 'Novo', 'producao', '2026-11-10'), reg(3, 'Novo', 'pronto', '2026-11-12', { observacao: 'cobertura' })];
const nums = r => Array.from(r.visiveis, x => x.numero);

test('sem texto na busca: período, cliente e chip valem como antes', () => {
  const t = tela({ pedidos: PEDIDOS });
  assert.deepEqual(nums(t.api.listaDaTela()), [2, 3]);
  t.api.set({ filtroSit: 'pronto' });
  assert.deepEqual(nums(t.api.listaDaTela()), [3]);
  assert.equal(t.api.listaDaTela().buscaGlobal, false);
});

test('com texto: ignora período, cliente e chip de situação e acha registro de 2020', () => {
  const t = tela({ pedidos: PEDIDOS });
  t.api.set({ filtroSit: 'producao', cliente: 'Novo' });
  t.campos['search-input'].value = 'cobertura';
  const r = t.api.listaDaTela();
  assert.equal(r.buscaGlobal, true);
  assert.deepEqual(nums(r), [1, 3], 'acha o de 2020 e o de outra situação, mesmo com cliente e chip diferentes');
  t.campos['search-input'].value = 'cobertura vidro';
  assert.deepEqual(nums(t.api.listaDaTela()), [1], 'várias palavras: todas precisam aparecer');
  // limpou a busca: volta ao comportamento com filtros
  t.campos['search-input'].value = '   ';
  const volta = t.api.listaDaTela();
  assert.equal(volta.buscaGlobal, false);
  assert.deepEqual(nums(volta), [2]);
});

test('a busca global fica na aba: Orçamentos busca só orçamentos', () => {
  const t = tela({ pedidos: PEDIDOS, orcamentos: [reg(90, 'Zé', 'aberto', '2019-03-03', { observacao: 'cobertura' })] });
  t.api.set({ tipoLista: 'Orçamento' });
  t.campos['search-input'].value = 'cobertura';
  assert.deepEqual(nums(t.api.listaDaTela()), [90]);
});

test('teto de 500 linhas: visiveis corta e lista guarda o total para o aviso', () => {
  const muitos = Array.from({ length: 520 }, (_, i) => reg(i + 1, 'A', 'producao', '2020-01-01', { observacao: 'x' }));
  const t = tela({ pedidos: muitos });
  t.campos['search-input'].value = 'x';
  const r = t.api.listaDaTela();
  assert.equal(r.visiveis.length, 500);
  assert.equal(r.lista.length, 520);
});

test('a página: aviso visível, debounce de 300 ms com descarte de resposta antiga, indicadores e olho fora da busca', () => {
  assert.match(painel, /id="busca-aviso" role="status" hidden/);
  assert.match(painel, /Busca em todos os registros: ignora período, cliente e situação\./);
  assert.match(painel, /Resultado cortado: mostrando/);
  const ent = painel.slice(painel.indexOf('let tBusca = null'), painel.indexOf("$('busca-aviso').addEventListener"));
  assert.match(ent, /setTimeout\([^]*300\)/);
  assert.match(ent, /meu === seqBusca/);
  // a busca não mexe nos indicadores nem nas análises do olho: renderAnalises/carregarIndicadores não leem o campo de busca
  const analises = painel.slice(painel.indexOf('async function renderAnalises()'), painel.indexOf('const analises = OlhoResumos.carga'));
  assert.doesNotMatch(analises, /search-input|palavrasDaBusca|listaDaTela/);
  const ind = painel.slice(painel.indexOf('async function carregarIndicadores()'), painel.indexOf('async function carregarIndicadores()') + 800);
  assert.doesNotMatch(ind, /search-input|palavrasDaBusca/);
});
