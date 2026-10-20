const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEstoque, bancoEstoque, FORN } = require('./apoio/bancoEstoque');

function comNota(estoquePerfil = 15) {
  const b = bancoEstoque();
  b.estoque[0].QTD_ESTOQUE = estoquePerfil;
  b.nfs.push({ NUMERO: '1234', RAZAO_FABRICANTE: FORN, DATA: '2026-10-19', VALOR_TOTAL: 62.5 });
  b.entradas.push(
    { id: 1, NOTA_FISCAL: '1234', DATA: '2026-10-19', FABRICANTE: FORN, ITEM: 1, NOME_PRODUTO: 'Perfil Slim', NOME_PRODUTO_FABRICANTE: 'PS', QTD: 3, VALOR_UNITARIO: 12.5, VALOR_TOTAL: 37.5, OBSERVACAO: '' },
    { id: 2, NOTA_FISCAL: '1234', DATA: '2026-10-19', FABRICANTE: FORN, ITEM: 2, NOME_PRODUTO: 'Perfil Slim', NOME_PRODUTO_FABRICANTE: 'PS', QTD: 2, VALOR_UNITARIO: 12.5, VALOR_TOTAL: 25, OBSERVACAO: '' });
  return b;
}
function comSaida(usuario = 'Caio') {
  const b = bancoEstoque();
  b.estoque[2].QTD_ESTOQUE = 327;
  b.saidas.push(
    { ID: 1, NOME_PRODUTO: 'Parafuso', DATA: '2026-10-20 10:15:00', QTD: 127, USUARIO: usuario },
    { ID: 2, NOME_PRODUTO: 'Parafuso', DATA: '2026-10-20 10:15:00', QTD: 46, USUARIO: usuario },
    { ID: 3, NOME_PRODUTO: 'Parafuso', DATA: '2026-10-20 10:16:00', QTD: 5, USUARIO: usuario });
  return b;
}
const MOTIVO = 'Nota lançada em dobro';

test('Estoquista não desfaz', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista', banco: comNota() });
  assert.equal((await chamar('/estoque/entrada/desfazer', 'POST', { numero: '1234', fornecedor: FORN, motivo: MOTIVO })).status, 403);
  assert.equal((await chamar('/estoque/saida/desfazer', 'POST', { data: '2026-10-20 10:15:00', usuario: 'Caio', motivo: MOTIVO })).status, 403);
});

test('desfazer entrada: tira a quantidade, apaga a nota e guarda a cópia', async t => {
  const { banco, chamar } = await prepararEstoque(t, { banco: comNota() });
  const r = await chamar('/estoque/entrada/desfazer', 'POST', { numero: '1234', fornecedor: FORN, motivo: MOTIVO });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { itens: [{ produto: 'Perfil Slim', antes: 15, depois: 10 }] });
  assert.equal(banco.estoque[0].QTD_ESTOQUE, 10);
  assert.equal(banco.entradas.length, 0);
  assert.equal(banco.nfs.length, 0);
  const e = banco.estornos[0];
  assert.deepEqual([e.tipo, e.referencia, e.motivo, e.quem], ['entrada', '1234 · FORNECEDOR TESTE LTDA', MOTIVO, 'Caio']);
  const dados = JSON.parse(e.dados);
  assert.equal(dados.linhas.length, 2);
  assert.equal(dados.linhas[0].VALOR_TOTAL, 37.5);
  assert.deepEqual(dados.nota.NUMERO, '1234');
  assert.deepEqual(dados.resumo, [{ produto: 'Perfil Slim', antes: 15, depois: 10 }]);
  const seq = banco.f.chamadas.map(c => c.sql);
  const i = re => seq.findIndex(s => re.test(s));
  assert.ok(i(/^BEGIN$/) < i(/FOR UPDATE/) && i(/FOR UPDATE/) < i(/DELETE FROM entrada_estoque/) && i(/DELETE FROM entrada_estoque/) < i(/^COMMIT$/));
});

test('desfazer entrada com o estoque já usado é recusado', async t => {
  const { banco, chamar } = await prepararEstoque(t, { banco: comNota(3) });
  const r = await chamar('/estoque/entrada/desfazer', 'POST', { numero: '1234', fornecedor: FORN, motivo: MOTIVO });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "Não dá para desfazer: o estoque de 'Perfil Slim' já foi usado (atual 3, entrada 5). Corrija pelo Ajuste.");
  assert.equal(banco.entradas.length, 2);
  assert.equal(banco.estoque[0].QTD_ESTOQUE, 3);
});

test('desfazer saída devolve a soma das linhas daquele lançamento', async t => {
  const { banco, chamar } = await prepararEstoque(t, { banco: comSaida() });
  const r = await chamar('/estoque/saida/desfazer', 'POST', { data: '2026-10-20 10:15:00', usuario: 'Caio', motivo: 'Saída errada' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { itens: [{ produto: 'Parafuso', antes: 327, depois: 500 }] });
  assert.equal(banco.estoque[2].QTD_ESTOQUE, 500);
  assert.deepEqual(banco.saidas.map(x => x.ID), [3]);
  assert.deepEqual([banco.estornos[0].tipo, banco.estornos[0].referencia], ['saida', '2026-10-20 10:15:00 · Caio']);
  assert.equal(JSON.parse(banco.estornos[0].dados).linhas.length, 2);
});

test('saída antiga do VB sem usuário', async t => {
  const { banco, chamar } = await prepararEstoque(t, { banco: comSaida(null) });
  const r = await chamar('/estoque/saida/desfazer', 'POST', { data: '2026-10-20 10:15:00', usuario: '', motivo: 'Saída errada' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(banco.estoque[2].QTD_ESTOQUE, 500);
});

test('não encontrado e motivo curto', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comNota() });
  let r = await chamar('/estoque/entrada/desfazer', 'POST', { numero: '9999', fornecedor: FORN, motivo: MOTIVO });
  assert.equal(r.status, 404); assert.equal((await r.json()).error, 'Movimento não encontrado (talvez já desfeito).');
  r = await chamar('/estoque/saida/desfazer', 'POST', { data: '2026-10-01 08:00:00', usuario: 'Caio', motivo: MOTIVO });
  assert.equal(r.status, 404);
  r = await chamar('/estoque/entrada/desfazer', 'POST', { numero: '1234', fornecedor: FORN, motivo: 'ab' });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'Informe o motivo (3 a 500 caracteres).');
});
