// GET /etiquetas/pedido/:numero, GET .../itens e POST /etiquetas/pedido/:numero (rotas/etiquetas.js) com banco simulado.
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

function banco({ existe = true, itens = 2, estadoCliente = 'SP', qtdItem = '1' } = {}) {
  const lista = Array.from({ length: itens }, (_, i) => ({ ITEM: String(i + 1), QTD: qtdItem, TIPO_PRODUTO: 'Porta de giro', DESCRICAO: 'Porta ' + (i + 1), UNITARIO: '100', TOTAL: '100' }));
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
  const postar = (caminho, corpo) => fetch(s.url + caminho, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  return { chamar: caminho => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token } }), postar, f };
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

// ---------- janela de ajustes: GET .../itens e POST ----------
const textosZpl = zpl => [...new Set([...zpl.matchAll(/\^FD([^^]*)\^FS/g)].map(m => m[1]))];

test('etiquetas: GET padrão: 1 etiqueta por item, sem Medidas nem Destino, Qtd do item e VOL 1/1', async t => {
  const { chamar } = await preparar(t, { itens: 1 });
  const j = await (await chamar('/etiquetas/pedido/23425')).json();
  assert.deepEqual(textosZpl(j.zpl).filter(x => !/^[0-9A-F]{40,}/.test(x)), ['Pedido: 23425', 'Nome: Fulano Ação Ltda', 'Cliente: Beltrano', 'Qtd: 1', 'VOL 1/1', '23425']);
  assert.ok(!j.zpl.includes('Medidas') && !j.zpl.includes('Destino'));
});

test('etiquetas: GET /itens traz itens, medidas sugeridas (ALTURA × LARGURA) e a UF do cliente; sem dinheiro', async t => {
  const { chamar } = await preparar(t, { itens: 2, estadoCliente: 'ES' });
  const r = await chamar('/etiquetas/pedido/23425/itens');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ufSugerida, 'ES');
  assert.deepEqual(j.itens.map(i => [i.item, i.qtd, i.descricao, i.medidasSugeridas]), [['1', '1', 'Porta 1', '2100 × 900'], ['2', '1', 'Porta 2', '2100 × 900']]);
  for (const n of nomes(j)) assert.ok(!REGEX_VALOR.test(n), n);
});

test('etiquetas: UF do cadastro que não é sigla de UF não vira sugestão', async t => {
  const { chamar } = await preparar(t, { itens: 1, estadoCliente: 'Espírito Santo' });
  assert.equal((await (await chamar('/etiquetas/pedido/23425/itens')).json()).ufSugerida, '');
});

const blocosZpl = zpl => zpl.split('^XZ').filter(b => b.includes('^XA'));
const volDe = b => /\^FDVOL (\d+\/\d+)\^FS/.exec(b)[1];

test('etiquetas: POST gera N etiquetas por item (qtd = volumes), medidas ligadas e UF geral; Qtd = quantidade do item; UF por item é ignorada', async t => {
  const { postar } = await preparar(t, { itens: 2 });
  const r = await postar('/etiquetas/pedido/23425', { uf: 'ES', itens: [
    { item: '1', qtd: 5, incluirMedidas: true, medidas: '2287 × 706' },
    { item: 2, qtd: '12', incluirMedidas: false, medidas: '999 x 999', uf: 'rj' }] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.quantidade, 17);
  const bs = blocosZpl(j.zpl);
  assert.equal(bs.length, 17);
  assert.deepEqual(bs.slice(0, 5).map(volDe), ['1/5', '2/5', '3/5', '4/5', '5/5']);
  assert.deepEqual(bs.slice(5).map(volDe), Array.from({ length: 12 }, (_, i) => `${i + 1}/12`));
  for (const b of bs.slice(0, 5)) assert.deepEqual(textosZpl(b).filter(x => /^(Qtd|Medidas|Destino)/.test(x)), ['Medidas: 2287 × 706', 'Qtd: 1', 'Destino: ES']);
  for (const b of bs.slice(5)) assert.deepEqual(textosZpl(b).filter(x => /^(Qtd|Medidas|Destino)/.test(x)), ['Qtd: 1', 'Destino: ES']);
  assert.ok(!j.zpl.includes('999 x 999'), 'medidas desligadas não saem');
  assert.ok(!j.zpl.includes('Destino: RJ'), 'a UF por item não vale mais');
});

test('etiquetas: "Qtd:" mostra a quantidade do item do pedido, não o nº de volumes', async t => {
  const { postar } = await preparar(t, { itens: 1, qtdItem: '4' });
  const j = await (await postar('/etiquetas/pedido/23425', { itens: [{ item: '1', qtd: 3 }] })).json();
  assert.equal(j.quantidade, 3);
  for (const [i, b] of blocosZpl(j.zpl).entries()) {
    assert.ok(textosZpl(b).includes('Qtd: 4'));
    assert.equal(volDe(b), `${i + 1}/3`);
  }
});

test('etiquetas: POST sem corpo = 1 etiqueta por item (VOL 1/1); item não listado também; N=1 explícito idem', async t => {
  const { postar } = await preparar(t, { itens: 2 });
  const j = await (await postar('/etiquetas/pedido/23425', {})).json();
  assert.equal(j.quantidade, 2);
  assert.ok(!j.zpl.includes('Destino') && !j.zpl.includes('Medidas'));
  assert.deepEqual(blocosZpl(j.zpl).map(volDe), ['1/1', '1/1']);
  const k = await (await postar('/etiquetas/pedido/23425', { itens: [{ item: '2', qtd: 9 }] })).json();
  assert.equal(k.quantidade, 10);
  assert.deepEqual(blocosZpl(k.zpl).map(volDe), ['1/1', ...Array.from({ length: 9 }, (_, i) => `${i + 1}/9`)]);
  const u = await (await postar('/etiquetas/pedido/23425', { itens: [{ item: '1', qtd: 1 }] })).json();
  assert.equal(u.quantidade, 2);
});

test('etiquetas: teto de 200 etiquetas por requisição (soma dos itens): 200 passa, 201 é 400 com mensagem clara', async t => {
  const { postar } = await preparar(t, { itens: 2 });
  const ok = await postar('/etiquetas/pedido/23425', { itens: [{ item: '1', qtd: 100 }, { item: '2', qtd: 100 }] });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).quantidade, 200);
  const r = await postar('/etiquetas/pedido/23425', { itens: [{ item: '1', qtd: 100 }, { item: '2', qtd: 101 }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Total de 201 etiquetas passa do limite de 200/);
});

test('etiquetas: POST recusa com 400 e mensagem clara: qtd, UF, medidas, item e tipos', async t => {
  const { postar } = await preparar(t, { itens: 1 });
  const casos = [
    [{ itens: [{ item: '1', qtd: 0 }] }, /Qtd de etiquetas \(volumes\)/], [{ itens: [{ item: '1', qtd: 1000 }] }, /Qtd de etiquetas \(volumes\)/],
    [{ itens: [{ item: '1', qtd: 1.5 }] }, /Qtd de etiquetas \(volumes\)/], [{ itens: [{ item: '1', qtd: 'abc' }] }, /Qtd de etiquetas \(volumes\)/],
    [{ uf: 'XX' }, /Estado de destino/], [{ uf: 'Espírito' }, /Estado de destino/],
    [{ itens: [{ item: '1', incluirMedidas: true, medidas: '10; DROP' }] }, /Medidas do item 1/],
    [{ itens: [{ item: '1', incluirMedidas: true, medidas: '^FO10 x 20' }] }, /Medidas do item 1/],
    [{ itens: [{ item: '1', incluirMedidas: true, medidas: '1'.repeat(31) }] }, /Medidas do item 1/],
    [{ itens: [{ item: '9', qtd: 1 }] }, /item 9 não existe/], [{ itens: [{ item: '1' }, { item: '1' }] }, /repetido/],
    [{ itens: 'x' }, /itens/], [{ itens: [{ item: '1', incluirMedidas: 'sim' }] }, /incluirMedidas/]
  ];
  for (const [corpo, msg] of casos) {
    const r = await postar('/etiquetas/pedido/23425', corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.match((await r.json()).error, msg, JSON.stringify(corpo));
  }
});

test('etiquetas: POST e GET /itens sem pedidos.pdf são 403; restrito a outros estados também; número ruim é 400', async t => {
  let { postar, chamar } = await preparar(t, { perfil: 'Sem acesso' });
  assert.equal((await postar('/etiquetas/pedido/23425', {})).status, 403);
  assert.equal((await chamar('/etiquetas/pedido/23425/itens')).status, 403);
  ({ postar, chamar } = await preparar(t, { estados: ['SP'], estadoCliente: 'RJ' }));
  assert.equal((await postar('/etiquetas/pedido/23425', {})).status, 403);
  assert.equal((await chamar('/etiquetas/pedido/23425/itens')).status, 403);
  ({ postar, chamar } = await preparar(t));
  assert.equal((await postar('/etiquetas/pedido/abc', {})).status, 400);
  assert.equal((await chamar('/etiquetas/pedido/abc/itens')).status, 400);
});

test('etiquetas: texto digitado com ^ ~ nunca chega ao ZPL como comando (medidas recusadas antes; UF só siglas)', async t => {
  const { postar } = await preparar(t, { itens: 1 });
  assert.equal((await postar('/etiquetas/pedido/23425', { itens: [{ item: '1', incluirMedidas: true, medidas: '1^XZ' }] })).status, 400);
  assert.equal((await postar('/etiquetas/pedido/23425', { uf: '~D' })).status, 400);
});
