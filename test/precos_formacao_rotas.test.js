const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararCustos, bancoCustos } = require('./apoio/bancoCustos');

const r4 = v => Math.round(v * 10000) / 10000;
const porCodigo = (lista, c) => lista.find(m => m.codigo === c);
const escritas = banco => banco.f.chamadas.filter(c => /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP)/i.test(c.sql));

// ---------- leitura (Task 4) ----------

test('lista: preços do material com custo (premissas da conversa) e resumo', async t => {
  const { chamar, banco } = await prepararCustos(t);
  const r = await chamar('/precos/formacao');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.parametros, { impostoPct: 8.5, comissaoPct: 5, custoFixoPct: 20, descontoPct: 28, margemPct: 15, referenciaMeses: 12 });
  const p = porCodigo(j.materiais, 100);
  // custo 12,5391/m (parte A) ÷ (1 − 48,5%) = 24,3478 → ÷ (1 − 28%) = 33,82
  assert.deepEqual([r4(p.custo), r4(p.alvo), p.sugerido, p.atual, p.origemMargem, p.gravavelPorPadrao], [12.5391, 24.3478, 33.82, 30, 'padrao', true]);
  assert.equal(r4(p.margemAtual), 8.4485);
  assert.equal(r4(p.margemPior), -3.1618); // pior cliente de desconto fixo: 40%
  assert.equal(p.modelo, 'Perfil 1036'); assert.equal(p.unidade, 'm');
  const semLigacao = porCodigo(j.materiais, 102);
  assert.deepEqual(semLigacao.motivos, ['sem ligação confirmada']);
  assert.equal(semLigacao.sugerido, null);
  assert.equal(porCodigo(j.materiais, 101).gravavelPorPadrao, false); // vidro: custo desatualizado
  assert.equal(porCodigo(j.materiais, 104), undefined); // inativo fora
  assert.deepEqual(j.resumo, { total: 4, comPreco: 2, semPreco: 2, comAviso: 1 });
  assert.deepEqual(escritas(banco), []);
  assert.ok(banco.f.chamadas.length <= 12, `consultas: ${banco.f.chamadas.length}`);
});

test('lista: referências de comissão, desconto e custo fixo vindas do banco', async t => {
  const { chamar } = await prepararCustos(t);
  const { referencias: ref } = await (await chamar('/precos/formacao')).json();
  assert.deepEqual([r4(ref.comissao.media), ref.comissao.maisFrequente, ref.comissao.qtd, ref.comissao.ilegiveis], [4.3333, 5, 3, 2]);
  assert.deepEqual([ref.desconto.media, ref.desconto.maisFrequente, ref.desconto.maior, ref.desconto.qtd], [32, 28, 40, 3]);
  assert.deepEqual([r4(ref.custoFixo.pct), ref.custoFixo.despesasMes, ref.custoFixo.receitasMes, ref.custoFixo.receitasSemClassificacao], [10, 10000, 100000, 200000]);
  assert.deepEqual(ref.custoFixo.contas, [{ nome: 'Despesas › Aluguel', total: 120000 }]);
});

test('lista: margem de classe e de material, com a origem', async t => {
  const banco = bancoCustos();
  banco.estado.margens.push({ id: 1, escopo: 'classe', chave: 'PERFIS', margem_pct: '18.000' }, { id: 2, escopo: 'material', chave: '102', margem_pct: '30.000' });
  banco.estado.ligacoes.push({ id: 9, material_codigo: 102, estoque_codigo: 3, fator: '1.000000' });
  banco.estado.compras.push({ id: 9, NOTA_FISCAL: '600', DATA: banco.estado.compras[0].DATA, FABRICANTE: 'FORN C', NOME_PRODUTO: 'FECHADURA TETRA', QTD: 5, VALOR_UNITARIO: 20 });
  const { chamar } = await prepararCustos(t, { banco });
  const j = await (await chamar('/precos/formacao')).json();
  assert.deepEqual([porCodigo(j.materiais, 100).M, porCodigo(j.materiais, 100).origemMargem], [18, 'classe']);
  assert.deepEqual([porCodigo(j.materiais, 102).M, porCodigo(j.materiais, 102).origemMargem], [30, 'material']);
  assert.deepEqual(j.margens, { padrao: 15, classes: [{ classe: 'PERFIS', pct: 18 }], materiais: [{ codigo: 102, pct: 30 }] });
});

test('lista: premissa não definida → motivo, sem preços', async t => {
  const banco = bancoCustos();
  banco.estado.parametros = banco.estado.parametros.filter(p => p.chave !== 'imposto_pct');
  const { chamar } = await prepararCustos(t, { banco });
  const j = await (await chamar('/precos/formacao')).json();
  assert.equal(j.parametros.impostoPct, null);
  assert.deepEqual(porCodigo(j.materiais, 100).motivos, ['defina o parâmetro imposto']);
});

test('detalhe: passos, histórico com a última gravação marcada; 404', async t => {
  const banco = bancoCustos();
  banco.estado.historico.push(
    { id: 1, lote: 'a', material_codigo: 100, valor_anterior: 25, valor_novo: 28, custo: 12, memoria: '{}', gravado_em: '2026-10-01 10:00:00', gravado_por: 'Thiago', desfeito_em: null, desfeito_por: null },
    { id: 2, lote: 'b', material_codigo: 100, valor_anterior: 28, valor_novo: 30, custo: 12, memoria: '{}', gravado_em: '2026-10-02 10:00:00', gravado_por: 'Thiago', desfeito_em: null, desfeito_por: null });
  const { chamar } = await prepararCustos(t, { banco });
  const d = await (await chamar('/precos/formacao/100')).json();
  assert.equal(d.material.codigo, 100);
  assert.ok(d.custo.passos.length > 0 && d.preco.passos.length > 0);
  assert.equal(d.preco.sugerido, 33.82);
  assert.deepEqual(d.historico.map(h => [h.id, h.valorAnterior, h.valorNovo, h.ultimo]), [[2, 28, 30, true], [1, 25, 28, false]]);
  assert.equal((await chamar('/precos/formacao/999')).status, 404);
});

test('leitura sem valores.ver → 403', async t => {
  const { chamar } = await prepararCustos(t, { perfil: 'Sem valores' });
  assert.equal((await chamar('/precos/formacao')).status, 403);
  assert.equal((await chamar('/precos/formacao/100')).status, 403);
});

// ---------- parâmetros, encargos e margens (Task 5) ----------

const soWeb = banco => escritas(banco).filter(c => !/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+web_/i.test(c.sql));
const parametro = (banco, chave) => banco.estado.parametros.find(p => p.chave === chave)?.valor;

test('parâmetros: grava, campo ausente fica, null apaga; auditoria com antes e depois', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Editar preços' });
  const r = await chamar('/precos/parametros', 'PUT', { impostoPct: 6, custoFixoPct: null, referenciaMeses: 6 });
  assert.equal(r.status, 200);
  assert.equal(parametro(banco, 'imposto_pct'), '6');
  assert.equal(parametro(banco, 'custo_fixo_pct'), undefined);
  assert.equal(parametro(banco, 'comissao_pct'), '5');
  assert.equal(parametro(banco, 'referencia_meses'), '6');
  const a = banco.estado.auditoria.find(x => x[2] === 'preco_parametros_alterados');
  const det = JSON.parse(a[4]);
  assert.equal(det.antes.impostoPct, 8.5); assert.equal(det.depois.impostoPct, 6); assert.equal(det.depois.custoFixoPct, null);
  assert.deepEqual(soWeb(banco), []);
});

test('parâmetros: fora da faixa → 400 com o campo', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Editar preços' });
  for (const corpo of [{ impostoPct: -1 }, { impostoPct: 100 }, { comissaoPct: 'abc' }, { referenciaMeses: 0 }, { referenciaMeses: 37 }]) {
    const r = await chamar('/precos/parametros', 'PUT', corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.match((await r.json()).error, /imposto|comissão|meses/i);
  }
  assert.equal(parametro(banco, 'imposto_pct'), '8.5');
});

test('encargos: criar, alterar, desativar e excluir, com auditoria; validação; 404', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Editar preços' });
  const r = await chamar('/precos/encargos', 'POST', { nome: 'Frete de entrega', pct: 2 });
  assert.equal(r.status, 201);
  const { id } = await r.json();
  assert.deepEqual(banco.estado.encargos.map(e => [e.nome, Number(e.pct), e.ativo]), [['Frete de entrega', 2, 1]]);
  assert.equal((await chamar(`/precos/encargos/${id}`, 'PUT', { pct: 2.5, ativo: false })).status, 200);
  assert.deepEqual(banco.estado.encargos.map(e => [e.nome, Number(e.pct), e.ativo]), [['Frete de entrega', 2.5, 0]]);
  // V do material 100 não muda com o encargo inativo
  assert.equal(porCodigo((await (await chamar('/precos/formacao')).json()).materiais, 100).V, 13.5);
  assert.equal((await chamar(`/precos/encargos/${id}`, 'DELETE')).status, 200);
  assert.deepEqual(banco.estado.encargos, []);
  assert.deepEqual(banco.estado.auditoria.map(a => a[2]), ['preco_encargo_criado', 'preco_encargo_alterado', 'preco_encargo_excluido']);
  for (const corpo of [{ nome: '', pct: 1 }, { nome: 'x'.repeat(61), pct: 1 }, { nome: 'Cartão', pct: 100 }, { nome: 'Cartão' }])
    assert.equal((await chamar('/precos/encargos', 'POST', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal((await chamar('/precos/encargos/999', 'PUT', { pct: 1 })).status, 404);
  assert.equal((await chamar('/precos/encargos/999', 'DELETE')).status, 404);
});

test('margens: classe (como está no cadastro) e material; inexistente → 400; null remove', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Editar preços' });
  assert.equal((await chamar('/precos/margens', 'PUT', { escopo: 'classe', chave: 'PERFIS', margemPct: 18 })).status, 200);
  assert.equal((await chamar('/precos/margens', 'PUT', { escopo: 'material', chave: 102, margemPct: 30 })).status, 200);
  assert.deepEqual(banco.estado.margens.map(m => [m.escopo, m.chave, Number(m.margem_pct)]), [['classe', 'Perfis', 18], ['material', '102', 30]]);
  assert.equal((await chamar('/precos/margens', 'PUT', { escopo: 'classe', chave: 'Portas', margemPct: 10 })).status, 400);
  assert.equal((await chamar('/precos/margens', 'PUT', { escopo: 'material', chave: 999, margemPct: 10 })).status, 400);
  assert.equal((await chamar('/precos/margens', 'PUT', { escopo: 'outro', chave: 'x', margemPct: 10 })).status, 400);
  assert.equal((await chamar('/precos/margens', 'PUT', { escopo: 'classe', chave: 'Perfis', margemPct: 100 })).status, 400);
  assert.equal((await chamar('/precos/margens', 'PUT', { escopo: 'classe', chave: 'perfis', margemPct: null })).status, 200);
  assert.deepEqual(banco.estado.margens.map(m => m.escopo), ['material']);
  assert.equal(banco.estado.auditoria.filter(a => a[2] === 'preco_margem_alterada').length, 3);
  assert.deepEqual(soWeb(banco), []);
});

test('escritas de premissa sem precos.editar → 403', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Só ver custos' });
  assert.equal((await chamar('/precos/parametros', 'PUT', { impostoPct: 1 })).status, 403);
  assert.equal((await chamar('/precos/encargos', 'POST', { nome: 'x', pct: 1 })).status, 403);
  assert.equal((await chamar('/precos/encargos/1', 'PUT', { pct: 1 })).status, 403);
  assert.equal((await chamar('/precos/encargos/1', 'DELETE')).status, 403);
  assert.equal((await chamar('/precos/margens', 'PUT', { escopo: 'classe', chave: 'Perfis', margemPct: 1 })).status, 403);
  const g = await prepararCustos(t, { perfil: 'Gravar preços' });
  assert.equal((await g.chamar('/precos/parametros', 'PUT', { impostoPct: 1 })).status, 403);
  assert.deepEqual(escritas(banco), []);
});

// ---------- gravar e desfazer VALOR_FIXO (Task 6) ----------

const valorFixo = (banco, c) => banco.estado.materiais.find(m => m.CODIGO === c).VALOR_FIXO;
// única escrita permitida fora de web_
const foraDeWeb = banco => soWeb(banco).filter(c => c.sql.trim() !== 'UPDATE cadastro_de_produtos SET VALOR_FIXO = ? WHERE CODIGO = ?');

test('gravar 2 itens: VALOR_FIXO muda, histórico no mesmo lote com a memória do cálculo, auditoria', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Gravar preços' });
  const r = await chamar('/precos/gravar', 'POST', { itens: [{ codigo: 100, valorNovo: 33.82, valorEsperado: 30 }, { codigo: 101, valorNovo: 125.5, valorEsperado: 120 }] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.gravados, 2);
  assert.match(j.lote, /^[0-9a-f-]{36}$/);
  assert.equal(valorFixo(banco, 100), 33.82); assert.equal(valorFixo(banco, 101), 125.5);
  const h = banco.estado.historico;
  assert.deepEqual(h.map(x => [x.material_codigo, x.valor_anterior, x.valor_novo, x.lote === j.lote]), [[100, 30, 33.82, true], [101, 120, 125.5, true]]);
  const mem = JSON.parse(h[0].memoria);
  assert.equal(mem.sugerido, 33.82); assert.equal(mem.valorNovo, 33.82); assert.equal(mem.situacaoCusto, 'confiavel');
  assert.deepEqual(mem.margem, { pct: 15, origem: 'padrao' });
  assert.equal(mem.parametros.impostoPct, 8.5);
  assert.equal(r4(h[0].custo), 12.5391);
  assert.equal(banco.estado.auditoria.filter(a => a[2] === 'preco_gravado').length, 2);
  assert.ok(banco.f.chamadas.some(c => /FOR UPDATE/.test(c.sql)));
  assert.deepEqual(foraDeWeb(banco), []);
});

test('lote com 1 item em conflito: 409 com conflitos, nada gravado', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Gravar preços' });
  const r = await chamar('/precos/gravar', 'POST', { itens: [
    { codigo: 100, valorNovo: 33.82, valorEsperado: 30 }, { codigo: 101, valorNovo: 125.5, valorEsperado: 119 }, { codigo: 102, valorNovo: 50, valorEsperado: 45 }] });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.match(j.error, /mudou/);
  assert.deepEqual(j.conflitos, [{ codigo: 101, atual: 120 }]);
  assert.deepEqual([valorFixo(banco, 100), valorFixo(banco, 101), valorFixo(banco, 102)], [30, 120, 45]);
  assert.deepEqual(banco.estado.historico, []);
  assert.deepEqual(banco.estado.auditoria, []);
  assert.ok(banco.f.chamadas.some(c => c.sql === 'ROLLBACK'));
});

test('VALOR_FIXO NULL: grava com valor anterior NULL e o desfazer volta a NULL', async t => {
  const banco = bancoCustos();
  banco.estado.materiais.find(m => m.CODIGO === 102).VALOR_FIXO = null;
  const { chamar } = await prepararCustos(t, { perfil: 'Gravar preços', banco });
  assert.equal((await chamar('/precos/gravar', 'POST', { itens: [{ codigo: 102, valorNovo: 50, valorEsperado: null }] })).status, 200);
  assert.equal(banco.estado.historico[0].valor_anterior, null);
  const d = await chamar(`/precos/desfazer/${banco.estado.historico[0].id}`, 'POST');
  assert.equal(d.status, 200);
  assert.deepEqual(await d.json(), { codigo: 102, valorRestaurado: null });
  assert.equal(valorFixo(banco, 102), null);
  // esperado 0 com atual NULL é conflito (nulidade diferente)
  assert.equal((await chamar('/precos/gravar', 'POST', { itens: [{ codigo: 102, valorNovo: 50, valorEsperado: 0 }] })).status, 409);
});

test('desfazer: só a última gravação não desfeita e só com o valor intacto', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Gravar preços' });
  await chamar('/precos/gravar', 'POST', { itens: [{ codigo: 100, valorNovo: 32, valorEsperado: 30 }] });
  const a = banco.estado.historico.at(-1).id;
  await chamar('/precos/gravar', 'POST', { itens: [{ codigo: 100, valorNovo: 33.82, valorEsperado: 32 }] });
  const b = banco.estado.historico.at(-1).id;
  const antiga = await chamar(`/precos/desfazer/${a}`, 'POST');
  assert.equal(antiga.status, 409);
  assert.match((await antiga.json()).error, /última gravação/);
  assert.equal(valorFixo(banco, 100), 33.82);
  const ok = await chamar(`/precos/desfazer/${b}`, 'POST');
  assert.equal(ok.status, 200);
  assert.equal(valorFixo(banco, 100), 32);
  assert.ok(banco.estado.historico.find(h => h.id === b).desfeito_em);
  assert.equal((await chamar(`/precos/desfazer/${b}`, 'POST')).status, 409); // desfazer de novo
  // agora a gravação A é a última não desfeita; mas o valor foi mudado por fora
  banco.estado.materiais.find(m => m.CODIGO === 100).VALOR_FIXO = 40;
  const fora = await chamar(`/precos/desfazer/${a}`, 'POST');
  assert.equal(fora.status, 409);
  assert.match((await fora.json()).error, /mudou para R\$ 40,00/);
  assert.equal(valorFixo(banco, 100), 40);
  assert.equal((await chamar('/precos/desfazer/9999', 'POST')).status, 404);
  assert.equal(banco.estado.auditoria.filter(x => x[2] === 'preco_desfeito').length, 1);
  assert.deepEqual(foraDeWeb(banco), []);
});

test('gravar: validações → 400', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Gravar preços' });
  const muitos = Array.from({ length: 501 }, (_, i) => ({ codigo: i + 1, valorNovo: 1, valorEsperado: 1 }));
  for (const itens of [[], muitos, [{ codigo: 100, valorNovo: 0, valorEsperado: 30 }], [{ codigo: 100, valorNovo: 33.825, valorEsperado: 30 }],
    [{ codigo: 100, valorNovo: 33, valorEsperado: 30 }, { codigo: 100, valorNovo: 34, valorEsperado: 30 }], [{ codigo: 999, valorNovo: 10, valorEsperado: 1 }],
    [{ codigo: 100, valorNovo: 33, valorEsperado: 'x' }]])
    assert.equal((await chamar('/precos/gravar', 'POST', { itens })).status, 400, JSON.stringify(itens).slice(0, 80));
  assert.equal((await chamar('/precos/gravar', 'POST', {})).status, 400);
  assert.equal(valorFixo(banco, 100), 30);
});

test('gravar e desfazer sem precos.gravar → 403 (mesmo com precos.editar)', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Editar preços' });
  assert.equal((await chamar('/precos/gravar', 'POST', { itens: [{ codigo: 100, valorNovo: 33.82, valorEsperado: 30 }] })).status, 403);
  assert.equal((await chamar('/precos/desfazer/1', 'POST')).status, 403);
  assert.equal(valorFixo(banco, 100), 30);
  assert.deepEqual(escritas(banco), []);
});

test('VALOR_FIXO 0 no cadastro: a lista traz o valor bruto (0) e gravar com esse valor esperado funciona', async t => {
  const banco = bancoCustos();
  banco.estado.materiais.find(m => m.CODIGO === 100).VALOR_FIXO = 0;
  const { chamar } = await prepararCustos(t, { perfil: 'Administrador', banco });
  const p = porCodigo((await (await chamar('/precos/formacao')).json()).materiais, 100);
  assert.equal(p.atual, null);
  assert.equal(p.valorFixo, 0);
  assert.equal((await chamar('/precos/gravar', 'POST', { itens: [{ codigo: 100, valorNovo: p.sugerido, valorEsperado: p.valorFixo }] })).status, 200);
  assert.equal(valorFixo(banco, 100), 33.82);
});

// ---------- custo fixo calculado com os dados reais ----------

test('custo fixo: cálculo na hora com os dados reais (12 meses)', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Só ver custos' });
  const r = await chamar('/precos/custo-fixo');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.meses, r4(j.pct), j.despesasMes, j.receitasMes], [12, 10, 10000, 100000]);
  assert.deepEqual(j.contas, [{ nome: 'Despesas › Aluguel', total: 120000 }]);
  assert.deepEqual(escritas(banco), []);
});

test('custo fixo: aplicar grava o percentual calculado no servidor, com auditoria dos números', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Editar preços' });
  const r = await chamar('/precos/custo-fixo/aplicar', 'POST', { pctVisto: 10 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).custoFixoPct, 10);
  assert.equal(parametro(banco, 'custo_fixo_pct'), '10');
  const a = banco.estado.auditoria.find(x => x[2] === 'preco_custo_fixo_calculado');
  const det = JSON.parse(a[4]);
  assert.deepEqual([det.antes, det.depois, det.meses, det.despesasMes, det.receitasMes, det.contas.length], [20, 10, 12, 10000, 100000, 1]);
  assert.deepEqual(soWeb(banco), []);
});

test('custo fixo: números mudaram desde que a tela calculou → 409 com o novo cálculo, nada gravado', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Editar preços' });
  const r = await chamar('/precos/custo-fixo/aplicar', 'POST', { pctVisto: 9.5 });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.match(j.error, /mudaram/);
  assert.equal(r4(j.referencia.pct), 10);
  assert.equal(parametro(banco, 'custo_fixo_pct'), '20');
  assert.equal((await chamar('/precos/custo-fixo/aplicar', 'POST', {})).status, 400);
});

test('custo fixo: sem classificação fixa → 409 com o motivo, nada gravado', async t => {
  const banco = bancoCustos();
  banco.estado.fluxoGrupos[0].COMPORTAMENTO = null;
  const { chamar } = await prepararCustos(t, { perfil: 'Editar preços', banco });
  const r = await chamar('/precos/custo-fixo/aplicar', 'POST', { pctVisto: 10 });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /nenhuma classificação marcada como fixa/);
  assert.equal(parametro(banco, 'custo_fixo_pct'), '20');
});

test('custo fixo: aplicar sem precos.editar → 403; ler sem valores.ver → 403', async t => {
  const { chamar, banco } = await prepararCustos(t, { perfil: 'Só ver custos' });
  assert.equal((await chamar('/precos/custo-fixo/aplicar', 'POST', { pctVisto: 10 })).status, 403);
  assert.deepEqual(escritas(banco), []);
  const s = await prepararCustos(t, { perfil: 'Sem valores' });
  assert.equal((await s.chamar('/precos/custo-fixo')).status, 403);
});
