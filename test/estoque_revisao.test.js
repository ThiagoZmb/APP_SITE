// Achados da revisão final da etapa 1 (concorrência, fuso, erros do corpo)
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEstoque, FORN } = require('./apoio/bancoEstoque');

const dup = () => Object.assign(new Error("Duplicate entry 'x' for key 'PRIMARY'"), { code: 'ER_DUP_ENTRY', errno: 1062 });
const deadlock = () => Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
const seq = banco => banco.f.chamadas.map(c => c.sql);
const pos = (banco, re) => seq(banco).findIndex(s => re.test(s));

test('saída reserva a chave com INSERT antes de travar o estoque (sem SELECT … FOR UPDATE na chave)', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  assert.equal((await chamar('/estoque/saida', 'POST', { chave: 'k1', data: '2026-10-20', itens: [{ produtoCodigo: 1, qtd: 1 }] })).status, 201);
  assert.ok(!seq(banco).some(s => /FROM web_estoque_lancamentos WHERE chave/.test(s)));
  assert.ok(pos(banco, /INSERT INTO web_estoque_lancamentos/) < pos(banco, /FROM estoque WHERE CODIGO IN/));
});

test('chave duplicada no INSERT vira 409', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.regras.unshift([/INSERT INTO web_estoque_lancamentos/, () => { throw dup(); }]);
  const r = await chamar('/estoque/ajuste', 'POST', { chave: 'k2', produtoCodigo: 1, qtdContada: 3, motivo: 'Contagem' });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'Este lançamento já foi gravado.');
});

test('entrada: nota repetida detectada pelo INSERT (sem SELECT … FOR UPDATE na nf_entrada)', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.regras.unshift([/INSERT INTO nf_entrada/, () => { throw dup(); }]);
  banco.nfs.push({ NUMERO: '1234', RAZAO_FABRICANTE: 'OUTRO FORNECEDOR SA' });
  const r = await chamar('/estoque/entrada', 'POST', { numero: '1234', data: '2026-10-20', fornecedor: FORN, itens: [{ item: 1, produtoCodigo: 1, qtd: 1 }] });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'Já existe a nota 1234 lançada para o fornecedor OUTRO FORNECEDOR SA.');
  assert.ok(!seq(banco).some(s => /FROM nf_entrada WHERE NUMERO = \? FOR UPDATE/.test(s)));
});

test('deadlock é tentado de novo e o lançamento passa', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  // a 1ª gravação da saída cai em deadlock; a 2ª tentativa segue o comportamento normal do banco simulado
  const normal = banco.regras.find(([re]) => re.source.startsWith('INSERT INTO saida_estoque'));
  let vezes = 0;
  banco.regras.unshift([/INSERT INTO saida_estoque/, (sql, p) => { if (vezes++ === 0) throw deadlock(); return normal[1](sql, p); }]);
  const r = await chamar('/estoque/saida', 'POST', { chave: 'k3', data: '2026-10-20', itens: [{ produtoCodigo: 1, qtd: 2 }] });
  assert.equal(r.status, 201, await r.clone().text());
  assert.equal(seq(banco).filter(s => s === 'ROLLBACK').length, 1);
  assert.equal(banco.saidas.length, 1);
});

test('desfazer entrada trava o estoque antes das linhas da entrada', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  banco.estoque[0].QTD_ESTOQUE = 15;
  banco.nfs.push({ NUMERO: '1234', RAZAO_FABRICANTE: FORN });
  banco.entradas.push({ id: 1, NOTA_FISCAL: '1234', DATA: '2026-10-19', FABRICANTE: FORN, ITEM: 1, NOME_PRODUTO: 'Perfil Slim', QTD: 5 });
  assert.equal((await chamar('/estoque/entrada/desfazer', 'POST', { numero: '1234', fornecedor: FORN, motivo: 'Teste' })).status, 200);
  assert.ok(pos(banco, /FROM estoque WHERE NOME_PRODUTO IN .* FOR UPDATE/) < pos(banco, /FROM entrada_estoque WHERE NOTA_FISCAL = \? AND FABRICANTE = \? FOR UPDATE/));
});

test('tabelas da web gravam a hora de Brasília, não o NOW() do MySQL', async t => {
  const { banco, chamar } = await prepararEstoque(t);
  await chamar('/estoque/ajuste', 'POST', { chave: 'k4', produtoCodigo: 1, qtdContada: 3, motivo: 'Contagem' });
  await chamar('/estoque/entrada', 'POST', { numero: '55', data: '2026-10-20', fornecedor: FORN, itens: [{ item: 1, produtoCodigo: 1, qtd: 1, codFabricante: 'PS-01' }] });
  const inserts = banco.f.chamadas.filter(c => /INSERT INTO web_estoque_/.test(c.sql));
  assert.ok(inserts.length >= 3);
  for (const c of inserts) {
    assert.ok(!/NOW\(\)/.test(c.sql), c.sql);
    assert.ok(c.params.some(p => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(p))), c.sql);
  }
});

test('erro do corpo do XML (charset desconhecido) responde JSON, sem página de erro', async t => {
  const { chamar } = await prepararEstoque(t);
  const r = await chamar('/estoque/entrada/xml', 'POST', '<NFe/>', { 'Content-Type': 'application/xml; charset=klingon' });
  assert.equal(r.status, 415);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.ok((await r.json()).error);
});
