const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prepararEstoque, FORN } = require('./apoio/bancoEstoque');

const xml = nome => fs.readFileSync(path.join(__dirname, 'apoio', 'nfe', nome), 'utf8');
const importar = (chamar, corpo) => chamar('/estoque/entrada/xml', 'POST', corpo, { 'Content-Type': 'application/xml' });

test('reconhece fornecedor pelo CNPJ e produto pelo cadastro do VB', async t => {
  const { chamar } = await prepararEstoque(t);
  const r = await importar(chamar, xml('um_item.xml'));
  assert.equal(r.status, 200, await r.clone().text());
  const n = await r.json();
  assert.equal(n.numero, '1234');
  assert.equal(n.data, '2026-10-15');
  assert.equal(n.fornecedor, FORN);
  assert.equal(n.notaJaLancada, false);
  assert.deepEqual(n.itens[0].produto, { codigo: 1, nome: 'Perfil Slim', unidade: 'Barra' });
  assert.equal(n.itens[0].fator, 1);
  assert.equal(n.itens[0].origem, 'cadastro');
  assert.equal(n.itens[0].unitarioNota, 12.5);
  assert.equal(n.totalNota, 125);
});

test('ligação gravada vence o cadastro; código desconhecido fica pendente', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.ligacoes.push({ fornecedor: FORN, cod_fabricante: 'PS-01', produto_codigo: 3, fator: '100.0000' });
  const n = await (await importar(chamar, xml('varios_itens.xml'))).json();
  assert.deepEqual([n.itens[0].produto.codigo, n.itens[0].fator, n.itens[0].origem], [3, 100, 'ligacao']);
  assert.deepEqual([n.itens[1].produto.codigo, n.itens[1].origem], [3, 'cadastro']); // PAR-100 no cadastro do Parafuso
  assert.deepEqual([n.itens[2].produto, n.itens[2].origem, n.itens[2].fator], [null, null, 1]);
});

test('fornecedor sem CNPJ cadastrado: null e itens sem produto', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.fornecedores[0].CNPJ = '';
  const n = await (await importar(chamar, xml('um_item.xml'))).json();
  assert.equal(n.fornecedor, null);
  assert.equal(n.emitente.nome, 'FORNECEDOR TESTE LTDA');
  assert.equal(n.itens[0].produto, null);
});

test('nota já lançada é avisada na importação', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.nfs.push({ NUMERO: '1234', RAZAO_FABRICANTE: FORN });
  assert.equal((await (await importar(chamar, xml('um_item.xml'))).json()).notaJaLancada, true);
});

test('Estoquista não recebe valores da nota', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  const n = await (await importar(chamar, xml('um_item.xml'))).json();
  assert.equal(n.totalNota, undefined);
  assert.equal(n.itens[0].unitarioNota, undefined);
  assert.equal(n.itens[0].totalNota, undefined);
  assert.equal(n.itens[0].qtdNota, 10);
});

test('arquivo inválido e grande demais', async t => {
  const { chamar } = await prepararEstoque(t);
  let r = await importar(chamar, xml('nao_nfe.xml'));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'Este arquivo não é o XML de uma NF-e.');
  r = await importar(chamar, '<a>' + 'x'.repeat(1100 * 1024) + '</a>');
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error, 'Arquivo grande demais (máximo 1 MB).');
});

test('só ver o estoque: 403', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Somente ver' });
  assert.equal((await importar(chamar, xml('um_item.xml'))).status, 403);
});

// ----- código do fabricante trocado: reconhecimento pelo nome -----
const comCodigo = (cProd, xProd) => xml('um_item.xml').replace('<cProd>PS-01</cProd>', `<cProd>${cProd}</cProd>`)
  .replace('<xProd>PERFIL SLIM 6M</xProd>', `<xProd>${xProd}</xProd>`);

test('código mudou, nome igual (sem diferença de maiúsculas/pontuação): liga e informa o código antigo', async t => {
  const { chamar } = await prepararEstoque(t);
  const it = (await (await importar(chamar, comCodigo('PS-99', 'Perfil  slim - 6M'))).json()).itens[0];
  assert.deepEqual([it.produto?.codigo, it.origem, it.codigoAnterior], [1, 'nome', 'PS-01']);
});

test('nome igual pela ligação gravada (código antigo da ligação)', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.ligacoes.push({ fornecedor: FORN, cod_fabricante: 'PAR-OLD', nome_fabricante: 'PARAFUSO CAIXA', produto_codigo: 3, fator: '100.0000' });
  const it = (await (await importar(chamar, comCodigo('PAR-NEW', 'PARAFUSO CAIXA'))).json()).itens[0];
  assert.deepEqual([it.produto?.codigo, it.origem, it.codigoAnterior, it.fator], [3, 'nome', 'PAR-OLD', 100]);
});

test('nome igual em dois produtos: não liga, sugere os dois', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.estoque.push({ ...banco.estoque[0], CODIGO: 9, NOME_PRODUTO: 'Perfil Slim Preto', COD_FORNECEDOR: 'PS-02' });
  const it = (await (await importar(chamar, comCodigo('PS-99', 'PERFIL SLIM 6M'))).json()).itens[0];
  assert.equal(it.produto, null);
  assert.deepEqual(it.sugestoes.map(s => s.codigo).sort(), [1, 9]);
});

test('nome parecido: só sugere, nunca liga', async t => {
  const { chamar } = await prepararEstoque(t);
  const it = (await (await importar(chamar, comCodigo('XYZ', 'PERFIL SLIM 6M PRETO FOSCO'))).json()).itens[0];
  assert.equal(it.produto, null);
  assert.equal(it.origem, null);
  assert.ok(it.sugestoes.some(s => s.codigo === 1 && s.nome === 'Perfil Slim'), JSON.stringify(it.sugestoes));
  assert.ok(it.sugestoes.length <= 3);
});

test('nome igual de OUTRO fornecedor não liga sozinho', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.estoque[0].FORNECEDOR = 'OUTRO FORNECEDOR SA';
  const it = (await (await importar(chamar, comCodigo('PS-99', 'PERFIL SLIM 6M'))).json()).itens[0];
  assert.equal(it.produto, null);
  assert.ok(it.sugestoes.some(s => s.codigo === 1));
});

test('item reconhecido pelo código não traz sugestões', async t => {
  const { chamar } = await prepararEstoque(t);
  const it = (await (await importar(chamar, xml('um_item.xml'))).json()).itens[0];
  assert.equal(it.origem, 'cadastro');
  assert.deepEqual(it.sugestoes, []);
});
