// GET /etiquetas/pedido/:numero (rotas/etiquetas.js) com banco simulado.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { REGEX_VALOR } = require('../seguranca/valores');
aceitarSidDeTeste(sessoes);

const PERFIS = { 'Produção': ['pedidos.pdf'], 'Sem acesso': ['pedidos.ver'] };

function banco({ existe = true, itens = 2, estadoCliente = 'SP' } = {}) {
  const lista = Array.from({ length: itens }, (_, i) => ({ ITEM: String(i + 1), QTD: '1', TIPO_PRODUTO: 'Porta de giro', DESCRICAO: 'Porta ' + (i + 1), UNITARIO: '100', TOTAL: '100' }));
  const regras = [
    [/FROM ped_orc_lista_itens/, () => lista],
    [/FROM ped_orc_itens_v4/, () => lista.map(l => ({ ITEM_PEDIDO: l.ITEM, ALTURA: '2100', LARGURA: '900', PERFIL: 'Perfil 30' }))],
    [/FROM cadastro_clientes/, () => [{ ESTADO: estadoCliente }]],
    [/FROM ped_orc /, () => (existe ? [{ RAZAO_SOCIAL: 'Fulano Ação Ltda', CLIENTE_FINAL: 'Beltrano' }] : [])]
  ];
  return criarPoolFalso(regras);
}

async function preparar(t, { perfil = 'Produção', estados = [], ...opcoes } = {}) {
  const f = banco(opcoes);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Caio', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados, ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const token = jwt.sign({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
  return { chamar: caminho => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token } }), f };
}

const nomes = (v, acc = new Set()) => {
  if (Array.isArray(v)) v.forEach(x => nomes(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); nomes(x, acc); }
  return acc;
};

test('etiquetas: pedido com 2 itens devolve ZPL com 2 etiquetas, sem dinheiro', async t => {
  const { chamar } = await preparar(t);
  const r = await chamar('/etiquetas/pedido/23425');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.quantidade, 2);
  assert.equal((j.zpl.match(/\^XA/g) || []).length, 2);
  assert.ok(j.zpl.includes('Nome: Fulano Ação Ltda'));
  assert.ok(j.zpl.includes('Cliente: Beltrano'));
  assert.ok(!j.zpl.includes('R$'));
  for (const n of nomes(j)) assert.ok(!REGEX_VALOR.test(n), n);
});

test('etiquetas: sem pedidos.pdf é 403', async t => {
  const { chamar } = await preparar(t, { perfil: 'Sem acesso' });
  assert.equal((await chamar('/etiquetas/pedido/23425')).status, 403);
});

test('etiquetas: número inexistente é 404 e pedido sem itens é 404 com outra mensagem', async t => {
  let { chamar } = await preparar(t, { existe: false });
  let r = await chamar('/etiquetas/pedido/99');
  assert.equal(r.status, 404);
  const msgNaoAchou = (await r.json()).error;
  ({ chamar } = await preparar(t, { itens: 0 }));
  r = await chamar('/etiquetas/pedido/99');
  assert.equal(r.status, 404);
  const msgSemItens = (await r.json()).error;
  assert.ok(msgNaoAchou && msgSemItens && msgNaoAchou !== msgSemItens);
});

test('etiquetas: usuário restrito a outros estados é recusado como em /dados_pdf', async t => {
  const { chamar } = await preparar(t, { estados: ['SP'], estadoCliente: 'RJ' });
  assert.equal((await chamar('/etiquetas/pedido/23425')).status, 403);
});

test('etiquetas: número não numérico é 400', async t => {
  const { chamar } = await preparar(t);
  assert.equal((await chamar('/etiquetas/pedido/abc')).status, 400);
});
