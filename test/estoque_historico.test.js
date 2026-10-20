const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEstoque, bancoEstoque, FORN } = require('./apoio/bancoEstoque');

function comMovimentos() {
  const b = bancoEstoque();
  b.entradas.push(
    { id: 1, NOTA_FISCAL: '1234', DATA: '2026-10-19', FABRICANTE: FORN, ITEM: 1, NOME_PRODUTO: 'Perfil Slim', NOME_PRODUTO_FABRICANTE: 'PS', QTD: 3, VALOR_UNITARIO: 12.5, VALOR_TOTAL: 37.5, OBSERVACAO: '' },
    { id: 2, NOTA_FISCAL: '1234', DATA: '2026-10-19', FABRICANTE: FORN, ITEM: 2, NOME_PRODUTO: 'Parafuso', NOME_PRODUTO_FABRICANTE: 'PAR', QTD: 100, VALOR_UNITARIO: 0.1, VALOR_TOTAL: 10, OBSERVACAO: '' });
  b.saidas.push(
    { ID: 1, NOME_PRODUTO: 'Parafuso', DATA: '2026-10-20 10:15:00', QTD: 127, USUARIO: 'Caio' },
    { ID: 2, NOME_PRODUTO: 'Parafuso', DATA: '2026-10-20 10:15:00', QTD: 46, USUARIO: 'Caio' },
    { ID: 3, NOME_PRODUTO: 'Perfil Slim', DATA: '2026-10-20 10:15:00', QTD: 2, USUARIO: 'Caio' });
  b.ajustes.push({ id: 1, quando: '2026-10-20 11:00:00', quem: 'Ana', produto_codigo: 1, nome_produto: 'Perfil Slim', qtd_antes: 10, qtd_depois: 8, motivo: 'Contagem' });
  b.estornos.push({ id: 1, quando: '2026-10-20 12:00:00', quem: 'Ana', tipo: 'saida', referencia: '2026-10-18 09:00:00 · Caio', motivo: 'Saída errada',
    dados: JSON.stringify({ linhas: [], resumo: [{ produto: 'Perfil Slim', antes: 5, depois: 7 }] }) });
  return b;
}
const PERIODO = 'de=2026-10-01&ate=2026-10-20';
const historico = async (chamar, extra = '') => { const r = await chamar(`/estoque/historico?${PERIODO}${extra}`); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };

test('agrupa nota e saída, do mais novo ao mais antigo', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comMovimentos() });
  const g = await historico(chamar);
  assert.deepEqual(g.map(x => x.tipo), ['estorno', 'ajuste', 'saida', 'entrada']);
  const ent = g[3];
  assert.deepEqual([ent.nota, ent.fornecedor, ent.quem, ent.itens.length], ['1234', FORN, '', 2]);
  const sai = g[2];
  assert.deepEqual([sai.data, sai.usuario, sai.quem], ['2026-10-20 10:15:00', 'Caio', 'Caio']);
  assert.deepEqual(sai.itens.map(i => [i.produto, i.qtd]), [['Parafuso', 173], ['Perfil Slim', 2]]); // linhas de 127 voltam a ser um item
  assert.deepEqual([g[1].motivo, g[1].itens[0].antes, g[1].itens[0].depois], ['Contagem', 10, 8]);
  assert.deepEqual([g[0].motivo, g[0].itens[0].produto, g[0].itens[0].qtd], ['Saída errada', 'Perfil Slim', 2]);
});

test('filtros', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comMovimentos() });
  assert.deepEqual((await historico(chamar, '&tipo=saida')).map(x => x.tipo), ['saida']);
  assert.deepEqual((await historico(chamar, '&produto=parafu')).map(x => x.tipo), ['saida', 'entrada']);
  assert.deepEqual((await historico(chamar, '&nota=1234')).map(x => x.tipo), ['entrada']);
  assert.deepEqual((await historico(chamar, '&usuario=caio')).map(x => x.tipo), ['saida']);
});

test('período inválido ou longo demais', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comMovimentos() });
  let r = await chamar('/estoque/historico?de=2026-02-30&ate=2026-10-20');
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'Data inválida!');
  r = await chamar('/estoque/historico?de=2025-01-01&ate=2026-10-20');
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'Período máximo: 366 dias.');
});

test('Estoquista: sem valores e sem desfazer; Interno completo: com os dois', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista', banco: comMovimentos() });
  const g = await historico(chamar);
  assert.ok(!JSON.stringify(g).match(/unitario|total/i));
  assert.ok(g.every(x => x.podeDesfazer === false));
});

test('Interno completo vê valores e pode desfazer entrada e saída', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comMovimentos() });
  const g = await historico(chamar);
  const ent = g.find(x => x.tipo === 'entrada');
  assert.deepEqual([ent.itens[0].unitario, ent.itens[0].total], [12.5, 37.5]);
  assert.deepEqual(g.map(x => x.podeDesfazer), [false, false, true, true]);
});

test('só ver o estoque: 403', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Somente ver' });
  assert.equal((await chamar(`/estoque/historico?${PERIODO}`)).status, 403);
});
