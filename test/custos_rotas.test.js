const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararCustos, bancoCustos } = require('./apoio/bancoCustos');

const r4 = v => Math.round(v * 10000) / 10000;
const porCodigo = (lista, c) => lista.find(m => m.codigo === c);

test('lista: situações, resumo (só ativos) e custo calculado', async t => {
  const { chamar } = await prepararCustos(t);
  const r = await chamar('/custos/materiais');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.parametros.periodoMeses, 6);
  assert.deepEqual(j.resumo, { total: 4, confiavel: 1, desatualizado: 1, faltando: 1, semCompra: 1, divergentes: 0 });
  const p = porCodigo(j.materiais, 100);
  assert.deepEqual([p.situacao, p.unidade, r4(p.custo), p.qtdCompras, p.valorFixo, p.ativo], ['confiavel', 'm', 12.5391, 2, 30, true]);
  assert.equal(porCodigo(j.materiais, 101).situacao, 'desatualizado');
  assert.deepEqual(porCodigo(j.materiais, 102).motivos, ['sem ligação confirmada']);
  assert.equal(porCodigo(j.materiais, 102).custo, null);
  assert.equal(porCodigo(j.materiais, 103).situacao, 'sem_compra');
  assert.equal(porCodigo(j.materiais, 104).ativo, false);
});

test('período de 12 meses deixa o vidro confiável', async t => {
  const { chamar } = await prepararCustos(t);
  const j = await (await chamar('/custos/materiais?meses=12')).json();
  assert.equal(porCodigo(j.materiais, 101).situacao, 'confiavel');
  assert.equal(j.parametros.periodoMeses, 12);
});

test('detalhe: ligações com a frase, compras usadas e ignoradas, passos', async t => {
  const { chamar } = await prepararCustos(t);
  const d = await (await chamar('/custos/materiais/100')).json();
  assert.deepEqual(d.ligacoes.map(l => [l.estoqueCodigo, l.nome, l.fator, l.frase]), [[1, 'PERFIL 1036 BARRA', 6, '1 Barra = 6 metros']]);
  assert.deepEqual(d.usadas.map(u => u.nf), ['500', '510']); // a de nome em minúsculas também entra
  assert.deepEqual(d.ignoradas.map(u => u.nf), ['520']);
  assert.ok(d.passos.at(-1).startsWith('= Custo'));
  assert.equal((await chamar('/custos/materiais/999')).status, 404);
});

test('ligações para revisar: sugestão forte, sem sugestão; confirmadas; sem custo de compra', async t => {
  const { chamar } = await prepararCustos(t);
  const rev = await (await chamar('/custos/ligacoes?situacao=revisar')).json();
  const fech = porCodigo(rev, 102);
  assert.deepEqual(fech.sugestoes.map(s => [s.estoqueCodigo, s.forca, s.fatorSugerido, s.frase]), [[3, 'forte', 1, '1 Peça = 1 unidade']]);
  assert.ok(!rev.some(m => [100, 101, 103, 104].includes(m.codigo))); // ligados, sem compra e inativos fora da revisão
  const conf = await (await chamar('/custos/ligacoes?situacao=confirmadas')).json();
  assert.deepEqual(conf.map(m => m.codigo).sort(), [100, 101]);
  const sem = await (await chamar('/custos/ligacoes?situacao=sem_compra')).json();
  assert.deepEqual(sem.map(m => m.codigo), [103]);
});

test('busca no estoque', async t => {
  const { chamar } = await prepararCustos(t);
  const r = await (await chamar('/custos/estoque?q=concha')).json();
  assert.deepEqual(r.map(i => [i.codigo, i.nome, i.unidade]), [[4, 'PUXADOR CONCHA', 'Peça']]);
});

test('sem valores.ver: 403; leituras não escrevem nada', async t => {
  let { chamar } = await prepararCustos(t, { perfil: 'Sem valores' });
  assert.equal((await chamar('/custos/materiais')).status, 403);
  const banco = bancoCustos();
  ({ chamar } = await prepararCustos(t, { banco }));
  await chamar('/custos/materiais'); await chamar('/custos/materiais/100'); await chamar('/custos/ligacoes?situacao=revisar');
  assert.ok(!banco.f.chamadas.some(c => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)));
});

// ---------- escrita (Task 5) ----------
test('confirmar ligação: grava, audita e o material sai da revisão', async t => {
  const { banco, chamar } = await prepararCustos(t);
  const r = await chamar('/custos/ligacoes', 'POST', { materialCodigo: 102, estoqueCodigo: 3, fator: 1 });
  assert.equal(r.status, 201);
  assert.ok((await r.json()).id > 0);
  assert.ok(banco.ligacoes.some(l => l.material_codigo === 102 && l.estoque_codigo === 3));
  assert.ok(banco.auditoria.some(a => a.includes('custo_ligacao_confirmada')));
  const rev = await (await chamar('/custos/ligacoes?situacao=revisar')).json();
  assert.ok(!rev.some(m => m.codigo === 102));
  assert.equal((await chamar('/custos/ligacoes', 'POST', { materialCodigo: 102, estoqueCodigo: 3, fator: 1 })).status, 409);
});

test('confirmar com dados inválidos: 400 com o motivo', async t => {
  const { chamar } = await prepararCustos(t);
  for (const corpo of [{ materialCodigo: 102, estoqueCodigo: 3, fator: 0 }, { materialCodigo: 102, estoqueCodigo: 3, fator: 20000 },
    { materialCodigo: 999, estoqueCodigo: 3, fator: 1 }, { materialCodigo: 102, estoqueCodigo: 999, fator: 1 }]) {
    const r = await chamar('/custos/ligacoes', 'POST', corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.ok((await r.json()).error);
  }
});

test('desfazer ligação e marcar sem custo de compra', async t => {
  const { banco, chamar } = await prepararCustos(t);
  assert.equal((await chamar('/custos/ligacoes/1', 'DELETE')).status, 200);
  assert.ok(!banco.ligacoes.some(l => l.id === 1));
  assert.ok(banco.auditoria.some(a => a.includes('custo_ligacao_desfeita')));
  assert.equal((await chamar('/custos/ligacoes/1', 'DELETE')).status, 404);
  assert.equal((await chamar('/custos/material/102', 'PUT', { semCompra: true })).status, 200);
  const j = await (await chamar('/custos/materiais')).json();
  assert.equal(j.materiais.find(m => m.codigo === 102).situacao, 'sem_compra');
  assert.equal((await chamar('/custos/material/102', 'PUT', { unidadeVenda: 'm' })).status, 200);
  assert.equal(banco.configs.find(c => c.material_codigo === 102).unidade_venda, 'm');
  assert.equal((await chamar('/custos/material/102', 'PUT', { unidadeVenda: 'kg' })).status, 400);
  assert.ok(banco.auditoria.some(a => a.includes('custo_material_alterado')));
});

test('parâmetros: grava e valida a faixa', async t => {
  const { banco, chamar } = await prepararCustos(t);
  assert.equal((await chamar('/custos/parametros', 'PUT', { periodoMeses: 12, divergenciaPct: 20 })).status, 200);
  const j = await (await chamar('/custos/materiais')).json();
  assert.deepEqual([j.parametros.periodoMeses, j.parametros.divergenciaPct], [12, 20]);
  assert.equal((await chamar('/custos/parametros', 'PUT', { periodoMeses: 40, divergenciaPct: 20 })).status, 400);
  assert.equal((await chamar('/custos/parametros', 'PUT', { periodoMeses: 6, divergenciaPct: 0 })).status, 400);
  assert.ok(banco.auditoria.some(a => a.includes('custo_parametros_alterados')));
});

test('só ver custos não altera nada (403); escritas só em tabelas web_', async t => {
  let { chamar } = await prepararCustos(t, { perfil: 'Só ver custos' });
  assert.equal((await chamar('/custos/ligacoes', 'POST', { materialCodigo: 102, estoqueCodigo: 3, fator: 1 })).status, 403);
  assert.equal((await chamar('/custos/ligacoes/1', 'DELETE')).status, 403);
  assert.equal((await chamar('/custos/material/102', 'PUT', { semCompra: true })).status, 403);
  assert.equal((await chamar('/custos/parametros', 'PUT', { periodoMeses: 6, divergenciaPct: 15 })).status, 403);
  const banco = bancoCustos();
  ({ chamar } = await prepararCustos(t, { banco }));
  await chamar('/custos/ligacoes', 'POST', { materialCodigo: 102, estoqueCodigo: 3, fator: 1 });
  await chamar('/custos/ligacoes/1', 'DELETE');
  await chamar('/custos/material/103', 'PUT', { semCompra: false });
  await chamar('/custos/parametros', 'PUT', { periodoMeses: 6, divergenciaPct: 15 });
  const escritas = banco.f.chamadas.filter(c => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));
  assert.ok(escritas.length >= 4);
  assert.ok(escritas.every(c => /(INTO|UPDATE|FROM)\s+web_/i.test(c.sql)), escritas.map(c => c.sql).join('\n'));
});

test('revisão I1: dois materiais ligados a "X 3.5" e "X 3,5" não misturam as compras', async t => {
  const banco = bancoCustos();
  banco.itens.push({ CODIGO: 8, NOME_PRODUTO: 'TUBO 3.5', FORNECEDOR: 'F', UNIDADE: 'Barra', VALOR: 0, IPI: 0, FRETE: 0, PERDA: '0', TAMANHO: 6000, ALTURA: 0, LARGURA: 0, SITUACAO: 'Ativo' },
    { CODIGO: 9, NOME_PRODUTO: 'TUBO 3,5', FORNECEDOR: 'F', UNIDADE: 'Barra', VALOR: 0, IPI: 0, FRETE: 0, PERDA: '0', TAMANHO: 6000, ALTURA: 0, LARGURA: 0, SITUACAO: 'Ativo' });
  banco.materiais.push({ CODIGO: 200, MODELO: 'Tubo A', CLASSE: 'Perfis', VALOR_FIXO: 1, SITUACAO: 'Ativo' }, { CODIGO: 201, MODELO: 'Tubo B', CLASSE: 'Perfis', VALOR_FIXO: 1, SITUACAO: 'Ativo' });
  banco.ligacoes.push({ id: 8, material_codigo: 200, estoque_codigo: 8, fator: '6' }, { id: 9, material_codigo: 201, estoque_codigo: 9, fator: '6' });
  const { mesesAtras } = require('./apoio/bancoCustos');
  banco.compras.push({ id: 8, NOTA_FISCAL: '800', DATA: mesesAtras(1), FABRICANTE: 'F', NOME_PRODUTO: 'TUBO 3.5', QTD: 1, VALOR_UNITARIO: 60 },
    { id: 9, NOTA_FISCAL: '900', DATA: mesesAtras(1), FABRICANTE: 'F', NOME_PRODUTO: 'TUBO 3,5', QTD: 1, VALOR_UNITARIO: 600 });
  const { chamar } = await prepararCustos(t, { banco });
  const j = await (await chamar('/custos/materiais')).json();
  assert.deepEqual([200, 201].map(c => [j.materiais.find(m => m.codigo === c).custo, j.materiais.find(m => m.codigo === c).qtdCompras]), [[10, 1], [100, 1]]);
});

test('revisão I3: trocar a unidade de venda com ligações confirmadas é recusado', async t => {
  const { banco, chamar } = await prepararCustos(t);
  const r = await chamar('/custos/material/100', 'PUT', { unidadeVenda: 'un' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /desfaça as ligações/);
  assert.ok(!banco.configs.some(c => c.material_codigo === 100));
  assert.equal((await chamar('/custos/material/100', 'PUT', { semCompra: false })).status, 200); // outras mudanças continuam valendo
});
