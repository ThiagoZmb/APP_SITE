const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEstoque, FORN } = require('./apoio/bancoEstoque');

let n = 0;
const saida = (mudar = {}) => ({ chave: 'chave-' + (++n), data: '2026-10-20', itens: [{ produtoCodigo: 1, qtd: 4 }], ...mudar });
const erro = async r => (await r.json()).error;

test('chave obrigatória e reenvio da mesma chave não baixa duas vezes', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  assert.equal((await chamar('/estoque/saida', 'POST', saida({ chave: '' }))).status, 400);
  const corpo = saida();
  assert.equal((await chamar('/estoque/saida', 'POST', corpo)).status, 201);
  const r = await chamar('/estoque/saida', 'POST', corpo);
  assert.equal(r.status, 409);
  assert.equal(await erro(r), 'Este lançamento já foi gravado.');
  assert.equal(banco.estoque[0].QTD_ESTOQUE, 6);
});

test('validações', async t => {
  const { chamar } = await prepararEstoque(t);
  const casos = [
    [{ data: '2026-02-30' }, 'Data inválida!'],
    [{ itens: [] }, 'Favor inserir pelo menos um produto!'],
    [{ itens: [{ produtoCodigo: 1, qtd: 0 }] }, 'Item 1: quantidade precisa ser um número inteiro maior que zero.'],
    [{ itens: [{ produtoCodigo: 1, qtd: 1 }, { produtoCodigo: 1, qtd: 2 }] }, "O produto 'Perfil Slim' já foi inserido !"],
    [{ itens: [{ produtoCodigo: 1, qtd: 11 }] }, "A quantidade do item 'Perfil Slim' é menor que 0! (estoque: 10, saída: 11)"]
  ];
  for (const [mudar, msg] of casos) {
    const r = await chamar('/estoque/saida', 'POST', saida(mudar));
    assert.equal(r.status, 400, msg);
    assert.equal(await erro(r), msg);
  }
});

test('estoque insuficiente não grava nada', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  await chamar('/estoque/saida', 'POST', saida({ itens: [{ produtoCodigo: 3, qtd: 5 }, { produtoCodigo: 1, qtd: 11 }] }));
  assert.equal(banco.saidas.length, 0);
  assert.equal(banco.estoque[2].QTD_ESTOQUE, 500);
  assert.equal(banco.lancamentos.length, 0);
});

test('300 unidades viram 127 + 127 + 46, com a mesma DATA e o usuário do login', async t => {
  const { banco, chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  const r = await chamar('/estoque/saida', 'POST', saida({ itens: [{ produtoCodigo: 3, qtd: 300 }, { produtoCodigo: 1, qtd: 2 }] }));
  assert.equal(r.status, 201, await r.clone().text());
  assert.deepEqual(await r.json(), { itens: [{ produto: 'Parafuso', antes: 500, depois: 200 }, { produto: 'Perfil Slim', antes: 10, depois: 8 }] });
  assert.deepEqual(banco.saidas.map(x => [x.NOME_PRODUTO, x.QTD]), [['Parafuso', 127], ['Parafuso', 127], ['Parafuso', 46], ['Perfil Slim', 2]]);
  const datas = new Set(banco.saidas.map(x => x.DATA));
  assert.equal(datas.size, 1);
  assert.match([...datas][0], /^2026-10-20 \d{2}:\d{2}:\d{2}$/);
  assert.ok(banco.saidas.every(x => x.USUARIO === 'Caio' && x.STATUS === null));
  assert.deepEqual([banco.saidas[0].CODIGO_BARRA, banco.saidas[0].FORNECEDOR, banco.saidas[0].NOME_PRODUTO_FORNECEDOR], ['7890000000035', FORN, 'PARAFUSO']);
  assert.deepEqual(banco.lancamentos.map(l => [l.tipo, l.quem, l.referencia]), [['saida', 'Caio', [...datas][0]]]);
  assert.equal(banco.estoque[2].QTD_ESTOQUE, 200);
});

test('só ver o estoque: 403', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Somente ver' });
  assert.equal((await chamar('/estoque/saida', 'POST', saida())).status, 403);
});
