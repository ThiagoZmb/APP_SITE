// Total dos pedidos entre duas datas: validação, soma (Cancelado fora), rota (valores.ver, estados, parâmetros) e tela (atrás do olho).
process.env.JWT_SECRET = 'teste'; process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { dataIso, validarIntervalo, somarPedidos, MAX_DIAS } = require('../calculo/total_periodo');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes, registro } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
aceitarSidDeTeste(sessoes);
const painel = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8').replace(/\r\n/g, '\n');

test('validarIntervalo: datas reais, inicial <= final, limite de 10 anos, nunca data inválida', () => {
  assert.deepEqual(validarIntervalo('2026-06-01', '2026-11-24'), { de: '2026-06-01', ate: '2026-11-24' });
  assert.deepEqual(validarIntervalo('2026-11-24', '2026-11-24'), { de: '2026-11-24', ate: '2026-11-24' });
  const ruins = [['', ''], [undefined, '2026-01-01'], ['2026-02-30', '2026-03-01'], ['2026-13-01', '2026-12-01'], ['01/06/2026', '2026-11-24'],
    ['2026-6-1', '2026-11-24'], ['2026-06-01', 'abc'], [['2026-01-01'], '2026-02-01'], ['1800-01-01', '2026-01-01'], ["2026-01-01'; DROP", '2026-02-01']];
  for (const [a, b] of ruins) assert.ok(validarIntervalo(a, b).erro, JSON.stringify([a, b]));
  assert.match(validarIntervalo('2026-11-25', '2026-11-24').erro, /inicial/);
  assert.match(validarIntervalo('2010-01-01', '2026-01-01').erro, /grande demais/);
  assert.equal(MAX_DIAS, 3660);
  assert.equal(dataIso('2024-02-29') instanceof Date, true);
  assert.equal(dataIso('2026-02-29'), null);
});

test('somarPedidos: Cancelado fora (qualquer caixa), valor inválido = 0, centavos arredondados', () => {
  assert.deepEqual(somarPedidos([{ situacao: 'Em Produção', valor: '100.10' }, { situacao: 'Pronto', valor: '200.20' }, { situacao: 'CANCELADO', valor: '999' },
    { situacao: 'Cancelado', valor: '1' }, { situacao: 'Entregue', valor: null }]), { qtd: 3, total: 300.3 });
  assert.deepEqual(somarPedidos([]), { qtd: 0, total: 0 });
});

const USUARIOS = {
  1: { nome: 'Admin', permissoes: new Set(['pedidos.ver', 'valores.ver']), estados: [] },
  2: { nome: 'Sem valores', permissoes: new Set(['pedidos.ver']), estados: [] },
  3: { nome: 'Sem pedidos', permissoes: new Set(['valores.ver']), estados: [] },
  4: { nome: 'Regional', permissoes: new Set(['pedidos.ver', 'valores.ver']), estados: ['RJ'] }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
const LINHAS = [{ situacao: 'Em Produção', valor: '100.00' }, { situacao: 'Cancelado', valor: '50.00' }, { situacao: 'Pronto', valor: '25.50' }];
async function preparar(t) {
  const f = criarPoolFalso([[/FROM ped_orc p/, LINHAS]]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => { const u = USUARIOS[id]; return u && { codigo: id, nome: u.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id, nome: 'P' + id }, estados: u.estados, ativo: true, permissoes: u.permissoes }; });
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const s = await subir(app); t.after(s.fechar);
  return { f, chamar: (id, c) => fetch(s.url + c, { headers: { Authorization: 'Bearer ' + token(id) } }) };
}
const consultas = f => f.chamadas.filter(c => /FROM ped_orc p/.test(c.sql));
const Q = '?de=2026-06-01&ate=2026-11-24';

test('rota registrada como GET e exige pedidos.ver e valores.ver', () => {
  const r = registro.rotasAutenticadas().find(x => x.caminho === '/pedidos/total_periodo');
  assert.ok(r); assert.equal(r.metodo, 'get'); assert.doesNotThrow(() => registro.verificar());
});

test('sem valores.ver ou sem pedidos.ver: 403 e nenhuma consulta; com ambas: total sem o Cancelado', async t => {
  const { f, chamar } = await preparar(t);
  assert.equal((await chamar(2, '/pedidos/total_periodo' + Q)).status, 403);
  assert.equal((await chamar(3, '/pedidos/total_periodo' + Q)).status, 403);
  assert.equal(consultas(f).length, 0);
  const r = await chamar(1, '/pedidos/total_periodo' + Q);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { de: '2026-06-01', ate: '2026-11-24', cliente: '', qtdPedidos: 2, valores: { total: 125.5 } });
  const c = consultas(f)[0];
  assert.match(c.sql, /p\.TIPO = 'Pedido'/); assert.doesNotMatch(c.sql, /LIMIT/i);
  assert.deepEqual(c.params.slice(0, 2), ['2026-06-01', '2026-11-24']);
});

test('datas inválidas: 400 sem consulta; cliente e estados viram parâmetros, nunca texto do SQL', async t => {
  const { f, chamar } = await preparar(t);
  const ruins = ['', '?de=2026-06-01', '?de=2026-02-30&ate=2026-03-01', '?de=2026-12-01&ate=2026-11-01', '?de=2000-01-01&ate=2026-01-01', Q + '&cliente=' + 'x'.repeat(201)];
  for (const q of ruins) assert.equal((await chamar(1, '/pedidos/total_periodo' + q)).status, 400, q);
  assert.equal(consultas(f).length, 0);
  assert.equal((await chamar(1, '/pedidos/total_periodo' + Q + '&cliente=' + encodeURIComponent("A'; DROP TABLE x"))).status, 200);
  assert.ok(consultas(f)[0].params.includes("A'; DROP TABLE x"));
  assert.doesNotMatch(consultas(f)[0].sql, /DROP/);
  assert.equal((await chamar(4, '/pedidos/total_periodo' + Q)).status, 200);
  const reg = consultas(f)[1];
  assert.match(reg.sql, /INNER JOIN cadastro_clientes/);
  assert.ok(reg.params.some(p => p === 'RJ'));
});

test('painel_inicial.html: duas datas dentro do bloco do olho e do dinheiro; carrega só em renderAnalises ou com o olho aberto; sem teto', () => {
  // as datas ficam sempre visíveis (só com valores.ver); só o resultado fica atrás do olho
  assert.match(painel, /<span class="total-periodo" data-valor title="[^"]*cancelados[^"]*">[^]*?id="tp-de"[^]*?id="tp-ate"[^]*?<span data-resumo>[^]*?id="tp-res"/);
  const analises = painel.slice(painel.indexOf('async function renderAnalises'), painel.indexOf('const analises = OlhoResumos.carga'));
  assert.match(analises, /carregarTotalPeriodo\(\)/);
  assert.match(painel, /if \(OlhoResumos\.visivel\(\)\) carregarTotalPeriodo\(\); else analises\.atualizar\(\)/);
  const fn = painel.slice(painel.indexOf('async function carregarTotalPeriodo'), painel.indexOf('// ================= RESUMO LOCAL'));
  assert.match(fn, /\/pedidos\/total_periodo\?de=/);
  assert.match(fn, /Acesso\.pode\('valores\.ver'\)/);
  assert.doesNotMatch(fn, /listaDaTela|MAX_LINHAS_LISTA|filtroSit|search-input/);
  assert.equal((painel.match(/carregarTotalPeriodo\(\)/g) || []).length, 3, 'definição, renderAnalises e o ouvinte das datas');
});
