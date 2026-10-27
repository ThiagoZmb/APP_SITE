// Rotas da Central de Gestão (banco simulado em test/apoio/bancoGestao.js). "Hoje" nos testes = 2026-10-15.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoGestao, prepararGestao } = require('./apoio/bancoGestao');
const { REGEX_VALOR } = require('../seguranca/valores');

// banco com dados de setembro/2026 (fechado), agosto/2026 e setembro/2025 para as comparações
function bancoComDados() {
  const b = bancoGestao();
  b.semear.classificacao({ TIPO: 'Entrada', CLASSE1: 'Vendas' });                              // id 1
  b.semear.classificacao({ CLASSE1: 'Materiais', CLASSE2: 'Perfis' });                         // id 2
  b.semear.classificacao({ CLASSE1: 'Materiais', CLASSE2: 'Vidros', CLASSE3: 'Temperado' });   // id 3
  b.semear.classificacao({ CLASSE1: 'Pessoal' });                                              // id 4
  // faturamento
  b.semear.pedido({ TOTAL: 10000, DATA: '2026-09-05' });
  b.semear.pedido({ TOTAL: 5000.5, DATA: '2026-09-20' });
  b.semear.pedido({ TOTAL: 999, DATA: '2026-09-21', SITUACAO: 'Cancelado' });              // fora
  b.semear.pedido({ TOTAL: 888, DATA: '2026-09-22', FINANCEIRO: 'Sem custo' });            // fora
  b.semear.pedido({ TOTAL: 777, DATA: '2026-09-23', TIPO: 'Orçamento' });                  // fora
  b.semear.pedido({ TOTAL: 12000, DATA: '2026-08-10' });
  b.semear.pedido({ TOTAL: 9000, DATA: '2025-09-10' });
  // caixa de setembro
  b.semear.fluxo({ SITUACAO: 'Recebido', RAZAO_SOCIAL: 'Cliente X', RAZAO_FABRICANTE: null, VALOR: 8000, COD_CLASSIFICACAO: 1 });
  b.semear.fluxo({ SITUACAO: 'Pago', VALOR: 600, COD_CLASSIFICACAO: 2 });
  b.semear.fluxo({ SITUACAO: 'Pago', VALOR: 200.5, COD_CLASSIFICACAO: 3 });
  b.semear.fluxo({ SITUACAO: 'Pago', VALOR: 150, COD_CLASSIFICACAO: 4 });
  b.semear.fluxo({ SITUACAO: 'Pago', VALOR: 40, COD_CLASSIFICACAO: null });                // sem categoria
  b.semear.fluxo({ SITUACAO: 'A pagar', VALOR: 300, COD_CLASSIFICACAO: 2 });
  b.semear.fluxo({ SITUACAO: 'A receber', RAZAO_SOCIAL: 'Cliente Y', RAZAO_FABRICANTE: null, VALOR: 1200, DATA: '2026-09-25', COD_CLASSIFICACAO: 1 });
  b.semear.fluxo({ SITUACAO: 'A Receber', RAZAO_SOCIAL: 'Cliente Z', RAZAO_FABRICANTE: null, VALOR: 800, DATA: '2026-10-30', COD_CLASSIFICACAO: 1 });   // futuro: não vence
  b.semear.fluxo({ SITUACAO: 'Atrasado', RAZAO_SOCIAL: 'Cliente W', RAZAO_FABRICANTE: null, VALOR: 70, DATA: '2026-07-01', COD_CLASSIFICACAO: 1 });
  // agosto
  b.semear.fluxo({ SITUACAO: 'Recebido', RAZAO_SOCIAL: 'Cliente X', RAZAO_FABRICANTE: null, VALOR: 4000, DATA: '2026-08-12', COD_CLASSIFICACAO: 1 });
  b.semear.fluxo({ SITUACAO: 'Pago', VALOR: 500, DATA: '2026-08-12', COD_CLASSIFICACAO: 2 });
  return b;
}
const SEP = '2026-09';
const painel = async (chamar, mes = SEP) => (await chamar('/gestao/painel?mes=' + mes)).json();

test('painel: faturamento só de pedidos válidos, caixa realizado separado do previsto, comparações', async t => {
  const { chamar } = await prepararGestao(t, { banco: bancoComDados() });
  const r = await chamar('/gestao/painel?mes=' + SEP);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.faturamento.realizado, 15000.5);
  assert.equal(j.faturamento.qtdPedidos, 2);
  assert.deepEqual([j.faturamento.mesAnterior.valor, j.faturamento.anoAnterior.valor], [12000, 9000]);
  assert.equal(j.faturamento.mesAnterior.variacao.absoluta, 3000.5);
  assert.equal(j.faturamento.mesAnterior.variacao.percentual, 25);
  assert.equal(j.faturamento.comparacao.estado, 'sem_meta');
  assert.deepEqual(j.caixa.realizado.entradas, 8000);
  assert.equal(j.caixa.realizado.saidas, 990.5);
  assert.equal(j.caixa.realizado.resultado, 7009.5);
  assert.deepEqual(j.caixa.previsto, { rotulo: j.caixa.previsto.rotulo, aReceber: 1200, aPagar: 300 });
  assert.match(j.caixa.previsto.rotulo, /Previsão não é caixa/);
  assert.equal(j.caixa.mesAnterior.entradas, 4000);
  assert.equal(j.caixa.mesAnterior.variacaoEntradas.percentual, 100);
  assert.equal(j.caixa.anoAnterior.disponivel, false);   // sem dado em 2025: não inventa
  assert.equal(j.caixa.anoAnterior.variacaoEntradas.absoluta, null);
  assert.equal(j.parcial, false);
  assert.equal(j.avisoPeriodo, null);
  assert.ok(j.limitacoes.length >= 3);
});

test('painel: A Receber vencido hoje (sem tolerância), futuro não vence, marcados atrasados à parte', async t => {
  const { chamar } = await prepararGestao(t, { banco: bancoComDados() });
  const j = await painel(chamar);
  assert.equal(j.recebiveisVencidos.aReceberVencido, 1200);   // 25/09 < hoje 15/10; o de 30/10 não
  assert.equal(j.recebiveisVencidos.marcadosAtrasado, 70);
  assert.equal(j.recebiveisVencidos.maisAntigo, '2026-09-25');
  const cod = j.alertas.map(a => a.codigo);
  assert.ok(cod.includes('a_receber_vencido') && cod.includes('recebiveis_marcados_atrasados') && cod.includes('sem_categoria'));
  const sem = j.alertas.find(a => a.codigo === 'sem_categoria');
  assert.match(sem.motivo, /1 lançamento/);
  for (const a of j.alertas) assert.ok(a.titulo && a.motivo && a.periodo === SEP && a.fonte);
});

test('painel: metas gravadas geram % e alerta de despesa; mês fechado projeta o próprio consumo', async t => {
  const banco = bancoComDados();
  banco.metas.push({ id: 1, periodo: SEP, tipo: 'faturamento', valor: 20000, origem: 'web' }, { id: 2, periodo: SEP, tipo: 'despesa', valor: 1000, origem: 'vb' });
  const { chamar } = await prepararGestao(t, { banco });
  const j = await painel(chamar);
  assert.deepEqual([j.faturamento.meta, j.faturamento.comparacao.percentual, j.faturamento.comparacao.diferenca], [20000, 75, -4999.5]);
  assert.equal(j.despesa.meta, 1000);
  assert.equal(j.despesa.origemMeta, 'vb');
  assert.deepEqual([j.despesa.progresso.consumidoPct, j.despesa.progresso.risco, j.despesa.progresso.saldo], [99.05, 'alerta', 9.5]);
  const cod = j.alertas.map(a => a.codigo);
  assert.ok(cod.includes('despesa_perto_meta') && cod.includes('faturamento_abaixo_meta'));
});

test('painel: meta zero = não calculável; sem lançamentos no mês não quebra', async t => {
  const banco = bancoComDados();
  banco.metas.push({ id: 1, periodo: '2026-03', tipo: 'faturamento', valor: 0, origem: 'web' });
  const { chamar } = await prepararGestao(t, { banco });
  const j = await painel(chamar, '2026-03');
  assert.equal(j.faturamento.comparacao.estado, 'nao_calculavel');
  assert.equal(j.faturamento.comparacao.percentual, null);
  assert.equal(j.faturamento.semPedidos, true);
  assert.equal(j.caixa.semLancamentos, true);
  assert.deepEqual(j.caixa.realizado, { rotulo: j.caixa.realizado.rotulo, entradas: 0, saidas: 0, resultado: 0 });
  assert.equal(j.despesa.progresso.risco, 'sem_orcamento');
  assert.ok(!JSON.stringify(j).includes('Infinity') && !JSON.stringify(j).includes('NaN'));
});

function bancoMesCorrente(meta) {
  const banco = bancoComDados();
  banco.metas.push({ id: 1, periodo: '2026-10', tipo: 'despesa', valor: meta, origem: 'web' });
  banco.semear.fluxo({ SITUACAO: 'Pago', VALOR: 400, DATA: '2026-10-02', COD_CLASSIFICACAO: 2 });
  return banco;
}

test('painel: mês corrente é parcial e avisa; poucos dias = dados insuficientes na projeção', async t => {
  const { chamar } = await prepararGestao(t, { banco: bancoMesCorrente(1000), hoje: '2026-10-04' });
  const j = await painel(chamar, '2026-10');
  assert.equal(j.parcial, true);
  assert.ok(j.avisoPeriodo.startsWith('Mês em andamento (dia 4 de 31)'));
  assert.equal(j.despesa.progresso.dadosInsuficientes, true);
  assert.equal(j.despesa.progresso.projecao, null);
  assert.ok(!j.alertas.some(a => a.codigo === 'despesa_ritmo'));
});

test('painel: mês corrente com ritmo acima da meta gera risco pelo ritmo', async t => {
  // dia 15: 400 pagos em 15 dias projetam 826,67; meta 800 => risco pelo ritmo (ainda não estourou: 50%)
  const { chamar } = await prepararGestao(t, { banco: bancoMesCorrente(800), hoje: '2026-10-15' });
  const j = await painel(chamar, '2026-10');
  assert.equal(j.despesa.progresso.projecao, 826.67);
  assert.equal(j.despesa.progresso.risco, 'risco_ritmo');
  assert.ok(j.alertas.some(a => a.codigo === 'despesa_ritmo'));
});

test('painel: mês inválido dá 400; sem mês usa o mês de hoje', async t => {
  const { chamar } = await prepararGestao(t, { banco: bancoComDados() });
  for (const m of ['2026-13', 'abc', '2026-1', '1999-01']) assert.equal((await chamar('/gestao/painel?mes=' + m)).status, 400, m);
  assert.equal((await (await chamar('/gestao/painel')).json()).mes, '2026-10');
});

test('orçamento por categoria: orçado x pago x a pagar, saldo, risco, sem categoria', async t => {
  const banco = bancoComDados();
  banco.orcamentos.push({ id: 1, periodo: SEP, classificacao_id: 2, nivel: 1, valor: 1000, limiar_atencao: null, limiar_alerta: null });
  const { chamar } = await prepararGestao(t, { banco });
  const j = await (await chamar('/gestao/orcamento?mes=' + SEP)).json();
  const mat = j.itens.find(i => i.rotulo === 'Materiais');
  assert.deepEqual([mat.orcado, mat.realizadoPago, mat.aPagar, mat.saldo, mat.consumidoPct, mat.risco], [1000, 800.5, 300, 199.5, 80.05, 'atencao']);
  assert.equal(mat.comprometidoPct, 110.05);
  const pes = j.itens.find(i => i.rotulo === 'Pessoal');
  assert.deepEqual([pes.orcado, pes.risco], [null, 'sem_orcamento']);
  assert.deepEqual(j.semCategoria, { rotulo: 'Sem categoria', realizadoPago: 40, aPagar: 0, qtdLancamentos: 1 });
  assert.equal(j.qtdSemOrcamento, 1);
  assert.deepEqual(j.categorias.map(c => c.id), [2, 3, 4]);   // só saídas
  assert.equal(j.limiaresPadrao.alerta, 85);
});

test('metas_vb: lê previsao_financeiro (mm/aaaa) como sugestão e mostra a meta já gravada na web', async t => {
  const banco = bancoComDados();
  banco.previsao.push({ MES: '09/2026', META_FATURAMENTO: '150.000,00', META_DESPESA: 90000 });
  banco.metas.push({ id: 1, periodo: SEP, tipo: 'despesa', valor: 80000, origem: 'web' });
  const { chamar } = await prepararGestao(t, { banco });
  const j = await (await chamar('/gestao/metas_vb?mes=' + SEP)).json();
  assert.deepEqual([j.origem, j.disponivel, j.sugestao.faturamento, j.sugestao.despesa], ['vb', true, 150000, 90000]);
  assert.deepEqual(j.naWeb, { faturamento: null, despesa: 80000 });
  assert.equal(banco.metas.length, 1);   // sugestão não grava nada
  assert.equal(banco.auditoria.length, 0);
});

test('metas_vb: mês com zero à esquerda ausente ("9/2026"), valor ambíguo/zero/vazio e mês sem linha', async t => {
  const banco = bancoComDados();
  banco.previsao.push({ MES: '9/2026', META_FATURAMENTO: '1.500', META_DESPESA: '' }, { MES: '10/2026', META_FATURAMENTO: 0, META_DESPESA: null });
  const { chamar } = await prepararGestao(t, { banco });
  let j = await (await chamar('/gestao/metas_vb?mes=' + SEP)).json();
  assert.deepEqual([j.disponivel, j.sugestao.faturamento, j.sugestao.despesa], [true, null, null]);   // "1.500" é ambíguo: não adivinha
  assert.match(j.motivo, /sem metas legíveis/);
  j = await (await chamar('/gestao/metas_vb?mes=2026-10')).json();
  assert.deepEqual([j.sugestao.faturamento, j.sugestao.despesa], [null, null]);
  j = await (await chamar('/gestao/metas_vb?mes=2026-01')).json();
  assert.equal(j.disponivel, true);
  assert.match(j.motivo, /não tem previsão/);
});

test('metas_vb: tabela previsao_financeiro inexistente não quebra (200, sem meta, nada inventado)', async t => {
  const banco = bancoComDados();
  banco.estado.previsao = null;
  const { chamar } = await prepararGestao(t, { banco });
  const r = await chamar('/gestao/metas_vb?mes=' + SEP);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.disponivel, j.sugestao.faturamento, j.sugestao.despesa], [false, null, null]);
  assert.match(j.motivo, /previsao_financeiro/);
  // o painel continua funcionando sem a tabela do VB
  assert.equal((await chamar('/gestao/painel?mes=' + SEP)).status, 200);
});

test('PUT /gestao/meta: cria, atualiza, audita (números anterior/novo) e valida', async t => {
  const banco = bancoComDados();
  const { chamar } = await prepararGestao(t, { banco });
  let r = await chamar('/gestao/meta', 'PUT', { mes: SEP, tipo: 'faturamento', valor: '150.000,50' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, mes: SEP, tipo: 'faturamento', valor: 150000.5, origem: 'web', criado: true });
  assert.equal(banco.metas.length, 1);
  assert.equal(banco.auditoria.at(-1).acao, 'gestao_meta_definida');
  assert.equal(banco.auditoria.at(-1).quem, 'Caio');
  assert.deepEqual(banco.auditoria.at(-1).detalhe, { campos: ['valor', 'origem'], anterior: null, novo: 150000.5, origem: 'web' });
  r = await chamar('/gestao/meta', 'PUT', { mes: SEP, tipo: 'faturamento', valor: 160000, origem: 'vb' });
  assert.equal((await r.json()).criado, false);
  assert.equal(banco.metas.length, 1);
  assert.equal(banco.metas[0].valor, 160000);
  assert.equal(banco.metas[0].origem, 'vb');
  assert.equal(banco.auditoria.at(-1).acao, 'gestao_meta_alterada');
  assert.deepEqual([banco.auditoria.at(-1).detalhe.anterior, banco.auditoria.at(-1).detalhe.novo], [150000.5, 160000]);
  // outra combinação mês+tipo é outra linha
  await chamar('/gestao/meta', 'PUT', { mes: SEP, tipo: 'despesa', valor: 0 });
  assert.equal(banco.metas.length, 2);
  const antes = banco.auditoria.length;
  for (const corpo of [{ mes: '2026-13', tipo: 'despesa', valor: 1 }, { mes: SEP, tipo: 'lucro', valor: 1 }, { mes: SEP, tipo: 'despesa', valor: '-5' }, { mes: SEP, tipo: 'despesa', valor: '1.500' }, {}]) {
    const x = await chamar('/gestao/meta', 'PUT', corpo);
    assert.equal(x.status, 400, JSON.stringify(corpo));
    assert.ok((await x.json()).error.length > 5);
  }
  assert.equal(banco.metas.length, 2);
  assert.equal(banco.auditoria.length, antes);
  // a transação foi usada
  assert.ok(banco.f.chamadas.some(c => c.sql === 'BEGIN') && banco.f.chamadas.some(c => c.sql === 'COMMIT'));
});

test('PUT /gestao/orcamento: grava a categoria canônica, atualiza no mesmo mês, audita e valida', async t => {
  const banco = bancoComDados();
  const { chamar } = await prepararGestao(t, { banco });
  let r = await chamar('/gestao/orcamento', 'PUT', { mes: SEP, classificacaoId: 3, nivel: 1, valor: '20.000,00', limiarAtencao: 60, limiarAlerta: '80' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.classificacaoId, j.categoria, j.criado, j.valor], [2, 'Materiais', true, 20000]);   // id 3 pertence ao grupo Materiais, cuja canônica é 2
  assert.deepEqual([banco.orcamentos[0].classificacao_id, banco.orcamentos[0].limiar_atencao, banco.orcamentos[0].limiar_alerta], [2, 60, 80]);
  assert.equal(banco.auditoria.at(-1).acao, 'gestao_orcamento_definido');
  assert.deepEqual([banco.auditoria.at(-1).detalhe.anterior, banco.auditoria.at(-1).detalhe.novo, banco.auditoria.at(-1).detalhe.categoria], [null, 20000, 'Materiais']);
  r = await chamar('/gestao/orcamento', 'PUT', { mes: SEP, classificacaoId: 2, valor: 18000 });
  assert.equal((await r.json()).criado, false);
  assert.equal(banco.orcamentos.length, 1);
  assert.equal(banco.orcamentos[0].valor, 18000);
  assert.equal(banco.orcamentos[0].limiar_atencao, null);   // voltou ao padrão
  assert.equal(banco.auditoria.at(-1).acao, 'gestao_orcamento_alterado');
  assert.equal(banco.auditoria.at(-1).detalhe.anterior, 20000);
  // o painel/orçamento passa a enxergar o orçamento gravado
  const o = await (await chamar('/gestao/orcamento?mes=' + SEP)).json();
  assert.equal(o.itens.find(i => i.rotulo === 'Materiais').orcado, 18000);
  // validações
  const antes = banco.auditoria.length;
  for (const corpo of [{ classificacaoId: 999 }, { classificacaoId: 1 }, { classificacaoId: 4, nivel: 2 }, { classificacaoId: 2, valor: -1 }, { classificacaoId: 2, limiarAtencao: 95, limiarAlerta: 90 }, { classificacaoId: 'x' }, { mes: 'ruim', classificacaoId: 2 }]) {
    const x = await chamar('/gestao/orcamento', 'PUT', { mes: SEP, valor: 10, ...corpo });
    assert.equal(x.status, 400, JSON.stringify(corpo));
  }
  assert.equal(banco.orcamentos.length, 1);
  assert.equal(banco.auditoria.length, antes);
});

test('permissões: sem gestao.ver ou sem valores.ver dá 403 em todas as rotas, sem vazar dinheiro', async t => {
  const banco = bancoComDados();
  banco.orcamentos.push({ id: 1, periodo: SEP, classificacao_id: 2, nivel: 1, valor: 1000 });
  const rotas = [['/gestao/painel?mes=' + SEP, 'GET'], ['/gestao/orcamento?mes=' + SEP, 'GET'], ['/gestao/metas_vb?mes=' + SEP, 'GET'],
    ['/gestao/meta', 'PUT', { mes: SEP, tipo: 'despesa', valor: 1 }], ['/gestao/orcamento', 'PUT', { mes: SEP, classificacaoId: 2, valor: 1 }]];
  for (const perfil of ['Sem acesso', 'Só valores', 'Gestão sem valores']) {
    const { chamar } = await prepararGestao(t, { banco, perfil });
    for (const [caminho, metodo, corpo] of rotas) {
      const r = await chamar(caminho, metodo, corpo);
      assert.equal(r.status, 403, `${perfil} ${metodo} ${caminho}`);
      const j = await r.json();
      assert.deepEqual(Object.keys(j).sort(), ['error', 'faltando']);   // só a recusa: nenhum campo de dinheiro
    }
  }
  assert.equal(banco.metas.length, 0);
  assert.equal(banco.orcamentos.length, 1);
  assert.equal(banco.auditoria.length, 0);
});

test('permissões: só ver lê mas não grava; só editar (sem ver) não grava', async t => {
  const banco = bancoComDados();
  let c = (await prepararGestao(t, { banco, perfil: 'Só ver gestão' })).chamar;
  assert.equal((await c('/gestao/painel?mes=' + SEP)).status, 200);
  assert.equal((await c('/gestao/orcamento?mes=' + SEP)).status, 200);
  assert.equal((await c('/gestao/metas_vb?mes=' + SEP)).status, 200);
  assert.equal((await c('/gestao/meta', 'PUT', { mes: SEP, tipo: 'despesa', valor: 1 })).status, 403);
  assert.equal((await c('/gestao/orcamento', 'PUT', { mes: SEP, classificacaoId: 2, valor: 1 })).status, 403);
  c = (await prepararGestao(t, { banco, perfil: 'Só editar' })).chamar;
  assert.equal((await c('/gestao/meta', 'PUT', { mes: SEP, tipo: 'despesa', valor: 1 })).status, 403);
  assert.equal(banco.metas.length, 0);
});

test('nomes de campo: o que casa com REGEX_VALOR é dinheiro conhecido; contagens usam qtd*', async t => {
  const banco = bancoComDados();
  const { chamar } = await prepararGestao(t, { banco });
  const nomes = new Set();
  const varrer = d => { if (Array.isArray(d)) d.forEach(varrer); else if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) { nomes.add(k); varrer(v); } };
  varrer(await painel(chamar)); varrer(await (await chamar('/gestao/orcamento?mes=' + SEP)).json());
  const dinheiro = [...nomes].filter(k => REGEX_VALOR.test(k));
  assert.ok(dinheiro.length > 0);
  assert.ok(nomes.has('qtdLancamentos') && nomes.has('qtdPedidos'));
  assert.ok(!dinheiro.includes('qtdLancamentos') && !dinheiro.includes('qtdPedidos'));
});

test('app sobe com as rotas novas registradas (registro.verificar)', () => {
  const { registro } = require('../index.js');
  assert.doesNotThrow(() => registro.verificar());
});
