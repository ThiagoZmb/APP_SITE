const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEstoque } = require('./apoio/bancoEstoque');

let n = 0;
const ajuste = (mudar = {}) => ({ chave: 'aj-' + (++n), produtoCodigo: 1, qtdContada: 7.5, motivo: 'Contagem mensal', ...mudar });

test('Estoquista não ajusta', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  assert.equal((await chamar('/estoque/ajuste', 'POST', ajuste())).status, 403);
});

test('ajuste grava a quantidade contada e o registro com antes e depois', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  const r = await chamar('/estoque/ajuste', 'POST', ajuste());
  assert.equal(r.status, 201, await r.clone().text());
  assert.deepEqual(await r.json(), { itens: [{ produto: 'Perfil Slim', antes: 10, depois: 7.5 }] });
  assert.equal(banco.estoque[0].QTD_ESTOQUE, 7.5);
  assert.deepEqual(banco.ajustes.map(a => [a.quem, a.produto_codigo, a.nome_produto, a.qtd_antes, a.qtd_depois, a.motivo]),
    [['Caio', 1, 'Perfil Slim', 10, 7.5, 'Contagem mensal']]);
  assert.deepEqual(banco.lancamentos.map(l => l.tipo), ['ajuste']);
});

test('validações do ajuste', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  const casos = [
    [{ motivo: 'ab' }, 400, 'Informe o motivo (3 a 500 caracteres).'],
    [{ qtdContada: -1 }, 400, 'Quantidade contada inválida.'],
    [{ qtdContada: 'x' }, 400, 'Quantidade contada inválida.'],
    [{ produtoCodigo: 99 }, 404, 'Produto não encontrado.']
  ];
  for (const [mudar, status, msg] of casos) {
    const r = await chamar('/estoque/ajuste', 'POST', ajuste(mudar));
    assert.equal(r.status, status, msg);
    assert.equal((await r.json()).error, msg);
  }
  assert.equal(banco.ajustes.length, 0);
  const corpo = ajuste();
  assert.equal((await chamar('/estoque/ajuste', 'POST', corpo)).status, 201);
  const r = await chamar('/estoque/ajuste', 'POST', corpo);
  assert.equal(r.status, 409);
  assert.equal(banco.ajustes.length, 1);
});
