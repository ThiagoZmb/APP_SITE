const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEstoque, FORN } = require('./apoio/bancoEstoque');
const { validarData } = require('../rotas/estoque_movimentos');

const nota = (mudar = {}) => ({ numero: '1234', data: '2026-10-20', fornecedor: FORN,
  itens: [{ item: 1, produtoCodigo: 1, qtd: 3, nomeFabricante: 'PERFIL SLIM 6M', observacao: '' }], ...mudar });
const erro = async r => (await r.json()).error;

test('validarData aceita só datas de calendário', () => {
  assert.equal(validarData('2026-10-20'), '2026-10-20');
  for (const d of ['2026-02-30', '20/10/2026', '', null, '2026-13-01']) assert.equal(validarData(d), null, String(d));
});

test('validações na ordem do VB', async t => {
  const { chamar } = await prepararEstoque(t);
  const casos = [
    [{ numero: '  ' }, 'Favor inserir o número da nota fiscal!'],
    [{ data: '2026-02-30' }, 'Data inválida!'],
    [{ fornecedor: 'NAO EXISTE' }, 'Favor escolher um fornecedor!'],
    [{ itens: [] }, 'Favor inserir pelo menos um produto!'],
    [{ itens: [{ item: 1, produtoCodigo: 1, qtd: 1.5 }] }, 'Item 1: quantidade precisa ser um número inteiro maior que zero.'],
    [{ itens: [{ item: 1, produtoCodigo: 99, qtd: 1 }] }, 'Item 1: produto não encontrado no estoque.']
  ];
  for (const [mudar, msg] of casos) {
    const r = await chamar('/estoque/entrada', 'POST', nota(mudar));
    assert.equal(r.status, 400, msg);
    assert.equal(await erro(r), msg);
  }
});

test('nota repetida: mesmo fornecedor e outro fornecedor', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.nfs.push({ NUMERO: '1234', RAZAO_FABRICANTE: FORN });
  let r = await chamar('/estoque/entrada', 'POST', nota());
  assert.equal(r.status, 409); assert.equal(await erro(r), 'Esta nota fiscal já foi inserida !');
  banco.nfs[0].RAZAO_FABRICANTE = 'OUTRO FORNECEDOR SA';
  r = await chamar('/estoque/entrada', 'POST', nota());
  assert.equal(r.status, 409); assert.equal(await erro(r), 'Já existe a nota 1234 lançada para o fornecedor OUTRO FORNECEDOR SA.');
  assert.equal(banco.entradas.length, 0);
});

test('Estoquista: valores vêm do cadastro, nunca do que a tela mandou', async t => {
  const { banco, chamar } = await prepararEstoque(t, { perfil: 'Estoquista' });
  const r = await chamar('/estoque/entrada', 'POST', nota({ itens: [{ item: 1, produtoCodigo: 1, qtd: 3, unitario: 999, total: 2997, nomeFabricante: 'X' }] }));
  assert.equal(r.status, 201, await r.clone().text());
  assert.equal(banco.entradas[0].VALOR_UNITARIO, 12.5);
  assert.equal(banco.entradas[0].VALOR_TOTAL, 37.5);
  assert.equal(banco.nfs[0].VALOR_TOTAL, 37.5);
  assert.deepEqual(await r.json(), { itens: [{ produto: 'Perfil Slim', antes: 10, depois: 13 }] });
});

test('Interno completo: usa os valores da nota', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  const r = await chamar('/estoque/entrada', 'POST', nota({ itens: [
    { item: 1, produtoCodigo: 1, qtd: 3, unitario: 11.333, total: 34, nomeFabricante: 'A' },
    { item: 2, produtoCodigo: 3, qtd: 100, unitario: 0.105, total: 10.5, nomeFabricante: 'B' }] }));
  assert.equal(r.status, 201);
  assert.deepEqual(banco.entradas.map(e => [e.VALOR_UNITARIO, e.VALOR_TOTAL]), [[11.333, 34], [0.105, 10.5]]);
  assert.equal(banco.nfs[0].VALOR_TOTAL, 44.5);
});

test('ordem da transação e AGUARDANDO zerado', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  assert.equal((await chamar('/estoque/entrada', 'POST', nota())).status, 201);
  const seq = banco.f.chamadas.map(c => c.sql);
  const i = re => seq.findIndex(s => re.test(s));
  const ordem = [/^BEGIN$/, /FOR UPDATE/, /INSERT INTO nf_entrada/, /INSERT INTO entrada_estoque/, /UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE \+/, /^COMMIT$/].map(i);
  assert.ok(ordem.every((v, k) => v >= 0 && (k === 0 || v > ordem[k - 1])), ordem.join(','));
  assert.equal(banco.estoque[0].AGUARDANDO, '');
  const e = banco.entradas[0];
  assert.deepEqual([e.NOTA_FISCAL, e.DATA, e.FABRICANTE, e.ITEM, e.NOME_PRODUTO, e.NOME_PRODUTO_FABRICANTE, e.QTD], ['1234', '2026-10-20', FORN, 1, 'Perfil Slim', 'PERFIL SLIM 6M', 3]);
});

test('mesmo produto em duas linhas: duas linhas gravadas, estoque somado uma vez', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  const r = await chamar('/estoque/entrada', 'POST', nota({ itens: [{ item: 1, produtoCodigo: 1, qtd: 3 }, { item: 2, produtoCodigo: 1, qtd: 2 }] }));
  assert.equal(r.status, 201);
  assert.equal(banco.entradas.length, 2);
  assert.equal(banco.estoque[0].QTD_ESTOQUE, 15);
  assert.deepEqual((await r.json()).itens, [{ produto: 'Perfil Slim', antes: 10, depois: 15 }]);
  assert.equal(banco.f.chamadas.filter(c => /UPDATE estoque SET QTD_ESTOQUE/.test(c.sql)).length, 1);
  assert.equal(banco.entradas[1].NOME_PRODUTO_FABRICANTE, 'PERFIL SLIM 6M'); // sem nome no fabricante: usa o do cadastro
});

test('número com espaços é gravado limpo', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  assert.equal((await chamar('/estoque/entrada', 'POST', nota({ numero: ' 1234 ' }))).status, 201);
  assert.equal(banco.nfs[0].NUMERO, '1234');
  assert.equal(banco.entradas[0].NOTA_FISCAL, '1234');
});

test('itens do XML gravam a ligação com o fator', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  const r = await chamar('/estoque/entrada', 'POST', nota({ itens: [{ item: 1, produtoCodigo: 3, qtd: 300, codFabricante: 'PAR-100', nomeFabricante: 'PARAFUSO CX 100', fator: 100 }] }));
  assert.equal(r.status, 201);
  assert.deepEqual(banco.ligacoes.map(l => [l.fornecedor, l.cod_fabricante, l.nome_fabricante, l.produto_codigo, Number(l.fator), l.atualizado_por]),
    [[FORN, 'PAR-100', 'PARAFUSO CX 100', 3, 100, 'Caio']]);
});

test('falha no meio desfaz tudo', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.regras.unshift([/INSERT INTO entrada_estoque/, () => { throw new Error('falha simulada'); }]);
  const r = await chamar('/estoque/entrada', 'POST', nota());
  assert.equal(r.status, 500);
  assert.ok(banco.f.chamadas.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!banco.f.chamadas.some(c => c.sql === 'COMMIT'));
  assert.equal(banco.estoque[0].QTD_ESTOQUE, 10);
});

test('só ver o estoque: 403', async t => {
  const { chamar } = await prepararEstoque(t, { perfil: 'Somente ver' });
  assert.equal((await chamar('/estoque/entrada', 'POST', nota())).status, 403);
});
