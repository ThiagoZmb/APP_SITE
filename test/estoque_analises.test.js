const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEstoque, bancoEstoque } = require('./apoio/bancoEstoque');

function comHistorico() {
  const b = bancoEstoque();
  // saídas de teste: datas relativas a hoje para não depender do relógio
  const d = n => { const x = new Date(Date.now() - n * 864e5); return x.toISOString().slice(0, 10) + ' 10:00:00'; };
  b.saidas.push({ ID: 1, NOME_PRODUTO: 'Perfil Slim', DATA: d(200), QTD: 2, USUARIO: 'Caio' },
    { ID: 2, NOME_PRODUTO: 'Perfil Slim', DATA: d(10), QTD: 9, USUARIO: 'Caio' },
    { ID: 3, NOME_PRODUTO: 'Parafuso', DATA: d(5), QTD: 90, USUARIO: 'Caio' });
  b.entradas.push({ id: 1, NOTA_FISCAL: '1', DATA: d(3).slice(0, 10), FABRICANTE: 'F', NOME_PRODUTO: 'Parafuso', QTD: 100 });
  return b;
}

test('permissões: Estoquista vê, só ver o estoque não', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista', banco: comHistorico() });
  assert.equal((await chamar('/estoque/analises')).status, 200);
});
test('só ver o estoque: 403', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Somente ver' });
  assert.equal((await chamar('/estoque/analises')).status, 403);
});

test('janela inválida vira 90; resposta com mensal de 12 meses e itens', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comHistorico() });
  const r = await (await chamar('/estoque/analises?janela=45')).json();
  assert.equal(r.janela, 90);
  assert.equal(r.mensal.length, 12);
  assert.equal(r.mensal.at(-1).qtdEntradas, 100);
  assert.equal(r.diasDados, 90);
  const slim = r.itens.find(i => i.codigo === 1);
  assert.equal(slim.consumoDia, 0.1);       // 9 na janela ÷ 90
  assert.equal(slim.diasCobertura, 100);   // 10 ÷ 0,1
  assert.equal((await (await chamar('/estoque/analises?janela=60')).json()).janela, 60);
});

test('filtro de classe, inclusive com caractere especial', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comHistorico() });
  assert.deepEqual((await (await chamar('/estoque/analises?classe=Perfil')).json()).itens.map(i => i.codigo), [1]);
  const r = await chamar('/estoque/analises?classe=' + encodeURIComponent(`x'"`));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).itens, []);
});

test('valores só com valores.ver', async t => {
  const e = await prepararEstoque(t, { perfil: 'Estoquista', banco: comHistorico() });
  const sem = await (await e.chamar('/estoque/analises')).json();
  assert.ok(!JSON.stringify(sem).match(/"valor|"abcValor/));
});
test('Interno completo recebe valores', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comHistorico() });
  const com = await (await chamar('/estoque/analises')).json();
  assert.equal(typeof com.resumo.valorParado, 'number');
  assert.equal(com.itens.find(i => i.codigo === 1).valor, 12.5);
});

test('consultas às tabelas de movimento são agregadas', async t => {
  const { banco, chamar } = await prepararEstoque(t, { banco: comHistorico() });
  await chamar('/estoque/analises');
  const mov = banco.f.chamadas.filter(c => /FROM (saida_estoque|entrada_estoque)/.test(c.sql));
  assert.ok(mov.length >= 4);
  assert.ok(mov.every(c => /SUM\(|MIN\(/.test(c.sql)), mov.map(c => c.sql).join('\n'));
});

// ----- prazo de reposição -----
const MSG_PRAZO = 'Prazo de reposição: número inteiro de 1 a 365 dias.';
test('Estoquista (sem editar estoque) não altera o prazo', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  assert.equal((await chamar('/estoque/analises/prazo/1', 'PUT', { prazoDias: 20 })).status, 403);
});

test('grava o prazo e a análise passa a usá-lo', async t => {
  const { banco, chamar } = await prepararEstoque(t, { banco: comHistorico() });
  const r = await chamar('/estoque/analises/prazo/1', 'PUT', { prazoDias: 20 });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { codigo: 1, prazoDias: 20 });
  const linha = banco.estado.reposicao[0];
  assert.deepEqual([linha.produto_codigo, linha.prazo_dias, linha.atualizado_por], [1, 20, 'Caio']);
  assert.match(linha.atualizado_em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const a = await (await chamar('/estoque/analises')).json();
  assert.equal(a.itens.find(i => i.codigo === 1).prazoDias, 20);
});

test('prazo inválido e produto inexistente', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  for (const v of [0, 366, 1.5, 'abc', null]) {
    const r = await chamar('/estoque/analises/prazo/1', 'PUT', { prazoDias: v });
    assert.equal(r.status, 400, String(v));
    assert.equal((await r.json()).error, MSG_PRAZO);
  }
  const r = await chamar('/estoque/analises/prazo/99', 'PUT', { prazoDias: 10 });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'Produto não encontrado.');
  assert.equal(banco.estado.reposicao.length, 0);
});

// ----- achados da revisão final -----
test('nome da saída com maiúsculas/espaço diferente do cadastro conta para o produto (JOIN no banco)', async t => {
  const b = comHistorico();
  b.saidas.forEach(x => { if (x.NOME_PRODUTO === 'Perfil Slim') x.NOME_PRODUTO = 'perfil slim '; });
  const { banco, chamar } = await prepararEstoque(t, { banco: b });
  const r = await (await chamar('/estoque/analises')).json();
  assert.equal(r.itens.find(i => i.codigo === 1).consumoDia, 0.1);
  assert.ok(banco.f.chamadas.some(c => /JOIN estoque/.test(c.sql)));
});

test('datas absurdas do VB (0000-00-00 e futuro) não entram nas contas', async t => {
  const b = comHistorico();
  b.saidas.push({ ID: 8, NOME_PRODUTO: 'Parafuso', DATA: '0000-00-00 00:00:00', QTD: 50, USUARIO: null },
    { ID: 9, NOME_PRODUTO: 'Parafuso', DATA: '2062-01-01 10:00:00', QTD: 70, USUARIO: null });
  const { chamar } = await prepararEstoque(t, { banco: b });
  const r = await (await chamar('/estoque/analises')).json();
  const par = r.itens.find(i => i.codigo === 3);
  assert.equal(par.consumoDia, 1);                    // só os 90 de 5 dias atrás ÷ 90
  assert.notEqual(par.ultimaSaida, '2062-01-01');
  assert.equal(r.mensal.reduce((s, m) => s + m.qtdSaidas, 0), 101); // 2 + 9 + 90; 0000-00-00 e 2062 ficam de fora
});

test('filtro de classe não muda a curva ABC do item', async t => {
  const { chamar } = await prepararEstoque(t, { banco: comHistorico() });
  const todos = (await (await chamar('/estoque/analises')).json()).itens.find(i => i.codigo === 1).abc;
  const so = (await (await chamar('/estoque/analises?classe=Perfil')).json()).itens.find(i => i.codigo === 1).abc;
  assert.equal(so, todos);
});
