// Livro de regras: rotas de consulta (somente leitura).
const test = require('node:test');
const assert = require('node:assert');
const { prepararEstoque } = require('./apoio/bancoEstoque');

const portaSemAcabamento = { frente: 'Porta de giro', detalhes: { perfil: 'Perfil Slim' } };

test('verificar_item: porta sem acabamento devolve regra que bloqueia, sem dinheiro', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Interno completo' });
  const r = await chamar('/regras/verificar_item', 'POST', portaSemAcabamento);
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(Object.keys(corpo), ['regras']);
  assert.ok(corpo.regras.some(x => x.nivel === 'bloqueia'));
  for (const x of corpo.regras) assert.deepEqual(Object.keys(x).sort(), ['codigo', 'mensagem', 'nivel']);
});

test('verificar_item: item copiado do banco (origem.estado) não gera regras', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Interno completo' });
  for (const estado of ['intacto', 'so_pct', 'travado']) {
    const r = await chamar('/regras/verificar_item', 'POST', { ...portaSemAcabamento, origem: { estado, item: 1 } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { regras: [] });
  }
});

test('verificar_item: corpo que não é objeto dá 400', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Interno completo' });
  for (const c of ['null', '[]', '"x"', '5']) assert.equal((await chamar('/regras/verificar_item', 'POST', c)).status, 400);
});

test('verificar_item: sem orcamentos.criar dá 403', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  assert.equal((await chamar('/regras/verificar_item', 'POST', portaSemAcabamento)).status, 403);
});

test('livro: administrativo vê regras e limites', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Interno completo' });
  const r = await chamar('/regras/livro');
  assert.equal(r.status, 200);
  const corpo = await r.json();
  const codigos = corpo.regras.map(x => x.codigo);
  assert.ok(codigos.includes('itens_minimo') && codigos.includes('numero_inteiro'));
  for (const x of corpo.regras) assert.deepEqual(Object.keys(x).sort(), ['codigo', 'escopo', 'nivel', 'titulo']);
  assert.equal(typeof corpo.limites, 'object');
});

test('livro: sem administrativo.ver dá 403', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  assert.equal((await chamar('/regras/livro')).status, 403);
});
