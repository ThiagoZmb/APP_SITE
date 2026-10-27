// Rotas do cadastro de tintas (banco simulado em test/apoio/bancoTintas.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoTintas, prepararTintas } = require('./apoio/bancoTintas');
const { REGEX_VALOR } = require('../seguranca/valores');

const TINTA = { fabricante: 'Sayerlack', classe: 'Verniz', tipo: 'Verniz Fosco', conjunto: 'Conjunto Vidro', valor: '40,5', porcentagem: '50',
  refFabricante: 'TX-10', corElegance: 'Branco Gelo', cor: 'ff1a2b3c', rendimento: '8' };
const salvar = (chamar, corpo) => chamar('/tintas/salvar', 'POST', corpo);

test('tintas: cria (código MAX+1, cor em maiúsculas, auditada sem valores); validação 400', async t => {
  const { banco, chamar } = await prepararTintas(t);
  let r = await salvar(chamar, TINTA);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.criado, j.codigo], [true, 1]);
  assert.equal(banco.tintas[0].COR, 'FF1A2B3C');
  assert.equal(banco.tintas[0].VALOR, 40.5);
  assert.equal(banco.auditoria[0].acao, 'tinta_criada');
  assert.ok(!JSON.stringify(banco.auditoria[0]).includes('40'));
  r = await salvar(chamar, { ...TINTA, refFabricante: 'TX-11' });
  assert.equal((await r.json()).codigo, 2);
  for (const mudanca of [{ classe: '' }, { valor: '1.234,56' }, { cor: 'ZZ' }, { porcentagem: '101' }]) {
    assert.equal((await salvar(chamar, { ...TINTA, refFabricante: 'OUTRA', ...mudanca })).status, 400, JSON.stringify(mudanca));
  }
  assert.equal(banco.tintas.length, 2);
});

test('tintas: referência repetida (caixa/espaços) dá 409; atualizar a própria tinta pode manter a referência', async t => {
  const banco = bancoTintas(); const x = banco.semear.tinta({ REF_FABRICANTE: 'TX-10' });
  const { chamar } = await prepararTintas(t, { banco });
  assert.equal((await salvar(chamar, { ...TINTA, refFabricante: ' tx-10 ' })).status, 409);
  assert.equal(banco.tintas.length, 1);
  assert.equal((await salvar(chamar, { ...TINTA, codigo: x.COD, refFabricante: 'TX-10', corElegance: 'Gelo' })).status, 200);
  assert.equal(banco.tintas[0].COR_ELEGANCE, 'Gelo');
});

test('tintas: fabricante inexistente ou "." dá 400', async t => {
  const banco = bancoTintas(); banco.semear.fornecedor('.');
  const { chamar } = await prepararTintas(t, { banco });
  assert.equal((await salvar(chamar, { ...TINTA, fabricante: 'Fantasma' })).status, 400);
  assert.equal((await salvar(chamar, { ...TINTA, fabricante: '.' })).status, 400);
  assert.equal(banco.tintas.length, 0);
});

test('tintas: atualiza (auditoria só com nomes dos campos); 404 e 400 de código', async t => {
  const banco = bancoTintas(); const x = banco.semear.tinta({ COR: 'FF1A2B3C', VALOR: 40.5, PORCENTAGEM: 50, RENDIMENTO: 8, COR_ELEGANCE: 'Branco Gelo' });
  const { chamar } = await prepararTintas(t, { banco });
  const r = await salvar(chamar, { ...TINTA, codigo: x.COD, rendimento: '9', valor: '41' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).criado, false);
  assert.equal(banco.tintas[0].RENDIMENTO, '9');
  assert.equal(banco.auditoria.at(-1).acao, 'tinta_alterada');
  assert.deepEqual(banco.auditoria.at(-1).detalhe.campos.sort(), ['rendimento', 'valor']);
  assert.equal((await salvar(chamar, { ...TINTA, codigo: 999 })).status, 404);
  assert.equal((await salvar(chamar, { ...TINTA, codigo: 'abc' })).status, 400);
});

test('tintas: lista (busca por referência e cor Elegance, filtro de classe, escape de %), detalhe e 404', async t => {
  const banco = bancoTintas();
  banco.semear.tinta({ REF_FABRICANTE: 'ZZ-1', COR_ELEGANCE: 'Azul', CLASSE: 'Tinta' });
  const a = banco.semear.tinta({ REF_FABRICANTE: 'AA-1', COR_ELEGANCE: 'Verde 100%' });
  const { chamar } = await prepararTintas(t, { banco, perfil: 'Somente ver tintas' });
  let j = await (await chamar('/tintas')).json();
  assert.deepEqual(j.tintas.map(x => x.refFabricante), ['AA-1', 'ZZ-1']);
  assert.equal(j.classes.length, 6); assert.equal(j.tipos.length, 19); assert.equal(j.conjuntos.length, 9);
  assert.deepEqual(j.fabricantes, ['Sayerlack']);
  j = await (await chamar('/tintas?busca=azul')).json();
  assert.deepEqual(j.tintas.map(x => x.refFabricante), ['ZZ-1']);
  j = await (await chamar('/tintas?busca=aa-')).json();
  assert.deepEqual(j.tintas.map(x => x.refFabricante), ['AA-1']);
  j = await (await chamar('/tintas?classe=Tinta')).json();
  assert.deepEqual(j.tintas.map(x => x.refFabricante), ['ZZ-1']);
  j = await (await chamar('/tintas?busca=' + encodeURIComponent('%'))).json();
  assert.deepEqual(j.tintas.map(x => x.refFabricante), ['AA-1']);
  const d = await (await chamar(`/tintas/${a.COD}`)).json();
  assert.equal(d.tinta.corElegance, 'Verde 100%');
  assert.equal((await chamar('/tintas/999')).status, 404);
  assert.equal((await chamar('/tintas/abc')).status, 404);
});

test('tintas: sem valores.ver não devolve o valor e editar não o zera; cadastro novo grava 0', async t => {
  const banco = bancoTintas(); const x = banco.semear.tinta({ VALOR: 40.5 });
  const { chamar } = await prepararTintas(t, { banco, perfil: 'Tintas' });
  assert.ok(!('valor' in (await (await chamar(`/tintas/${x.COD}`)).json()).tinta));
  assert.ok((await (await chamar('/tintas')).json()).tintas.every(l => !('valor' in l)));
  const { valor, ...semValor } = TINTA;
  assert.equal((await salvar(chamar, { ...semValor, codigo: x.COD, valor: '999', corElegance: 'Novo' })).status, 200);
  assert.equal(banco.tintas[0].VALOR, 40.5);
  assert.equal(banco.tintas[0].COR_ELEGANCE, 'Novo');
  assert.equal((await salvar(chamar, { ...semValor, refFabricante: 'NOVA' })).status, 200);
  assert.equal(banco.tintas[1].VALOR, 0);
});

test('tintas: com valores.ver devolve o valor; nenhum outro campo casa com REGEX_VALOR', async t => {
  const banco = bancoTintas(); banco.semear.tinta({ VALOR: 40.5 });
  const { chamar } = await prepararTintas(t, { banco });
  const j = await (await chamar('/tintas')).json();
  assert.equal(j.tintas[0].valor, 40.5);
  const nomes = Object.keys(j.tintas[0]).concat(Object.keys((await (await chamar('/tintas/1')).json()).tinta));
  assert.deepEqual([...new Set(nomes.filter(k => REGEX_VALOR.test(k)))], ['valor']);
});

test('tintas: exclui e audita; excluir de novo ou código inexistente dá 404', async t => {
  const banco = bancoTintas(); const x = banco.semear.tinta();
  const { chamar } = await prepararTintas(t, { banco });
  assert.equal((await chamar(`/tintas/${x.COD}`, 'DELETE')).status, 200);
  assert.equal(banco.tintas.length, 0);
  assert.equal(banco.auditoria.at(-1).acao, 'tinta_excluida');
  assert.equal((await chamar(`/tintas/${x.COD}`, 'DELETE')).status, 404);
  assert.equal((await chamar('/tintas/999', 'DELETE')).status, 404);
});

test('tintas: sem permissão 403; só ver não salva nem exclui', async t => {
  const banco = bancoTintas(); const x = banco.semear.tinta();
  let c = (await prepararTintas(t, { banco, perfil: 'Sem acesso' })).chamar;
  for (const [caminho, metodo] of [['/tintas', 'GET'], [`/tintas/${x.COD}`, 'GET'], ['/tintas/salvar', 'POST'], [`/tintas/${x.COD}`, 'DELETE']]) {
    assert.equal((await c(caminho, metodo, metodo === 'POST' ? TINTA : undefined)).status, 403, caminho);
  }
  c = (await prepararTintas(t, { banco, perfil: 'Somente ver tintas' })).chamar;
  assert.equal((await c('/tintas')).status, 200);
  assert.equal((await salvar(c, TINTA)).status, 403);
  assert.equal((await c(`/tintas/${x.COD}`, 'DELETE')).status, 403);
  assert.equal(banco.tintas.length, 1);
});

test('tintas: RENDIMENTO é texto no VB ("0,5"): lê como número, grava com vírgula e não zera ao editar outro campo', async t => {
  const banco = bancoTintas(); const x = banco.semear.tinta({ RENDIMENTO: '0,5' });
  const { chamar } = await prepararTintas(t, { banco });
  assert.equal((await (await chamar(`/tintas/${x.COD}`)).json()).tinta.rendimento, 0.5);
  assert.equal((await salvar(chamar, { ...TINTA, codigo: x.COD, rendimento: '0,5', corElegance: 'Só a cor' })).status, 200);
  assert.equal(banco.tintas[0].RENDIMENTO, '0,5');
  assert.equal((await salvar(chamar, { ...TINTA, codigo: x.COD, rendimento: '0.75' })).status, 200);
  assert.equal(banco.tintas[0].RENDIMENTO, '0,75');
});

test('tintas: referências que já se repetiam no banco não travam a edição; mudar para a de outra ainda dá 409', async t => {
  const banco = bancoTintas(); const a = banco.semear.tinta({ REF_FABRICANTE: 'TX-10' }); banco.semear.tinta({ REF_FABRICANTE: 'TX-10' }); banco.semear.tinta({ REF_FABRICANTE: 'OUTRA' });
  const { chamar } = await prepararTintas(t, { banco });
  assert.equal((await salvar(chamar, { ...TINTA, codigo: a.COD, refFabricante: 'TX-10', corElegance: 'Editada' })).status, 200);
  assert.equal((await salvar(chamar, { ...TINTA, codigo: a.COD, refFabricante: 'OUTRA' })).status, 409);
});

test('tintas: codigo que não é número (true, objeto) dá 400', async t => {
  const banco = bancoTintas(); banco.semear.tinta();
  const { chamar } = await prepararTintas(t, { banco });
  for (const codigo of [true, {}, [1]]) assert.equal((await salvar(chamar, { ...TINTA, codigo })).status, 400, JSON.stringify(codigo));
  assert.equal(banco.tintas[0].CLASSE, 'Verniz');
});
