// Baixa no estoque das varas novas ao confirmar o plano de corte (banco simulado em test/apoio/bancoCorte.js, que inclui o estoque do VB).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoCorte, prepararCorte, corpoConfirmacao } = require('./apoio/bancoCorte');
const { REGEX_VALOR } = require('../seguranca/valores');
const { gravarSaidas, LIMITE_LINHA_SAIDA } = require('../rotas/estoque_saida');

// pedido 100: 2 portas de P100 Anodizado/Natural → 4 peças de 2100 e 4 de 900 (precisa de varas novas)
function cenario(b = bancoCorte()) { b.semear.pedido(); b.semear.perfil(); b.semear.item(); return b; }
// segundo perfil (item 2): 1 porta pequena de P200 — cabe num retalho de 3000, sem vara nova
function comP200(b) {
  b.semear.perfil({ ITEM: 2, QTD_PORTAS: 1, PERFIL: 'P200', QTD_ALTURA: 1, TAM_ALTURA: 1000, QTD_LARGURA: 1, TAM_LARGURA: 800 });
  b.semear.item({ ITEM_PEDIDO: 2, ITEM: 1, QTD: 1, PERFIL: 'P200', ALTURA: 1000, LARGURA: 800 });
  return b;
}
const prever = async chamar => (await chamar('/corte/pedido/100')).json();
const salvar = async chamar => {
  const p = await prever(chamar);
  return (await chamar('/corte/pedido/100/salvar', 'POST', { impressao: p.impressao, retalhosUsados: p.retalhosUsados })).json();
};
const nomesDeCampo = dados => {
  const nomes = new Set();
  const varrer = d => { if (Array.isArray(d)) d.forEach(varrer); else if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) { nomes.add(k); varrer(v); } };
  varrer(dados);
  return [...nomes];
};
const confirmar = (chamar, id, corpo) => chamar(`/corte/plano/${id}/confirmar`, 'POST', corpo);
const P100 = 'P100|Anodizado|Natural', P200 = 'P200|Anodizado|Natural';

test('baixa correta: abate as varas novas do produto escolhido, grava saida_estoque e audita só nomes e quantidades', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { banco: b });
  const varas = (await prever(chamar)).plano.resumo.qtdVarasNovas;
  assert.ok(varas >= 2);
  const { id } = await salvar(chamar);
  const r = await confirmar(chamar, id, await corpoConfirmacao(chamar, id));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.baixas, [{ produto: 'P100', qtd: varas }]);
  assert.equal(b.estado.estoque.find(e => e.CODIGO === 1).QTD_ESTOQUE, 50 - varas);
  assert.equal(b.estado.estoque.find(e => e.CODIGO === 2).QTD_ESTOQUE, 50);
  assert.equal(b.estado.saidas.length, 1);
  assert.deepEqual({ ...b.estado.saidas[0], DATA: undefined }, { ID: 1, CODIGO_BARRA: '111', FORNECEDOR: 'FORN', NOME_PRODUTO_FORNECEDOR: 'PERFIL 100', NOME_PRODUTO: 'P100', DATA: undefined, QTD: varas, USUARIO: 'Caio', STATUS: null });
  assert.match(b.estado.saidas[0].DATA, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(b.estado.planos[0].situacao, 'conferido');
  const aud = b.estado.auditoria.filter(a => a.acao === 'corte_baixa_estoque');
  assert.equal(aud.length, 1);
  assert.deepEqual(aud[0].detalhe.itens, [{ produto: 'P100', qtd: varas }]);
  assert.deepEqual(nomesDeCampo([aud[0].detalhe, j]).filter(k => REGEX_VALOR.test(k)), []);
});

test('baixa de mais de 127 varas é dividida em linhas de saida_estoque (QTD é tinyint) e a soma fecha', async () => {
  const gravadas = [], atualizacoes = [];
  const conn = { execute: async (sql, params) => { (/^INSERT/.test(sql) ? gravadas : atualizacoes).push(params); return [{}, []]; } };
  const p = { CODIGO: 1, NOME_PRODUTO: 'P100', QTD_ESTOQUE: 1000 };
  const resumo = await gravarSaidas(conn, [{ p, qtd: 300 }], { quando: '2026-10-15 10:00:00', usuario: 'Caio' });
  assert.deepEqual(gravadas.map(g => g[5]), [LIMITE_LINHA_SAIDA, LIMITE_LINHA_SAIDA, 300 - 2 * LIMITE_LINHA_SAIDA]);
  assert.deepEqual(atualizacoes, [[300, 1]]);
  assert.deepEqual(resumo, [{ produto: 'P100', antes: 1000, depois: 700 }]);
});

test('saldo insuficiente: 400 com a mesma mensagem da saída de estoque e nada muda', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  b.estado.estoque[0].QTD_ESTOQUE = 1;
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  const r = await confirmar(chamar, id, await corpoConfirmacao(chamar, id));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /A quantidade do item 'P100' é menor que 0! \(estoque: 1, saída: \d+\)/);
  assert.equal(b.estado.estoque[0].QTD_ESTOQUE, 1);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'reservado');
  assert.equal(b.estado.retalhos.length, 1);
  assert.ok(!b.estado.auditoria.some(a => a.acao === 'corte_baixa_estoque' || a.acao === 'corte_plano_conferido'));
});

test('baixas ausentes, incompletas ou inválidas: 400 com mensagem clara e nada muda', async t => {
  const b = comP200(cenario()); b.semear.retalho({ perfil: 'P200', comprimento: 3000 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  const grupos = (await (await chamar(`/corte/plano/${id}`)).json()).plano.grupos;
  assert.deepEqual(grupos.map(g => g.chave), [P100, P200]);
  const casos = [
    [{}, /Informe o produto do estoque/],
    [{ baixas: [] }, /Falta escolher o produto do estoque para P100/],
    [{ baixas: [{ chave: 'nao-existe', produtoCodigo: 1 }] }, /grupo desconhecido/],
    [{ baixas: [{ chave: P200, produtoCodigo: 2 }] }, /grupo desconhecido ou sem varas novas/],   // grupo só com retalho não tem baixa
    [{ baixas: [{ chave: P100, produtoCodigo: 1 }, { chave: P100, produtoCodigo: 1 }] }, /mais de uma vez/],
    [{ baixas: [{ chave: P100 }] }, /Produto do estoque inválido/],
    [{ baixas: [{ chave: P100, produtoCodigo: 'abc' }] }, /Produto do estoque inválido/],
    [{ baixas: [{ chave: P100, produtoCodigo: 999 }] }, /não encontrado/]
  ];
  for (const [corpo, msg] of casos) {
    const r = await confirmar(chamar, id, corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.match((await r.json()).error, msg);
  }
  assert.equal(b.estado.saidas.length, 0);
  assert.deepEqual(b.estado.estoque.map(e => e.QTD_ESTOQUE), [50, 50, 500, 5]);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
});

test('produto repetido em dois grupos com varas novas: 400', async t => {
  const b = comP200(cenario());   // sem retalho: os dois grupos usam vara nova
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  const r = await confirmar(chamar, id, { baixas: [{ chave: P100, produtoCodigo: 1 }, { chave: P200, produtoCodigo: 1 }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /mesmo produto do estoque/);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal((await confirmar(chamar, id, { baixas: [{ chave: P100, produtoCodigo: 1 }] })).status, 400);   // falta o P200
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  const ok = await confirmar(chamar, id, { baixas: [{ chave: P100, produtoCodigo: 1 }, { chave: P200, produtoCodigo: 2 }] });
  assert.equal(ok.status, 200);
  assert.equal(b.estado.saidas.length, 2);
});

test('retalho não baixa o estoque: grupo atendido só por retalho não exige nem aceita baixa; as varas do outro grupo baixam', async t => {
  const b = comP200(cenario()); const ret = b.semear.retalho({ perfil: 'P200', comprimento: 3000 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const varas = (await prever(chamar)).plano.grupos.find(g => g.chave === P100).barras.filter(x => x.tipo === 'vara').length;
  const { id } = await salvar(chamar);
  const grupoP200 = (await (await chamar(`/corte/plano/${id}`)).json()).plano.grupos.find(g => g.chave === P200);
  assert.deepEqual(grupoP200.barras.map(x => x.tipo), ['retalho']);
  const r = await confirmar(chamar, id, await corpoConfirmacao(chamar, id));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).baixas, [{ produto: 'P100', qtd: varas }]);
  assert.equal(b.estado.estoque.find(e => e.CODIGO === 2).QTD_ESTOQUE, 50);   // P200 só usou retalho
  assert.equal(b.estado.saidas.length, 1);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'usado');
});

test('plano só com retalhos: confirma sem baixas e sem exigir permissão de estoque', async t => {
  const b = bancoCorte(); b.semear.pedido();
  b.semear.perfil({ QTD_PORTAS: 1, QTD_ALTURA: 1, TAM_ALTURA: 1000, QTD_LARGURA: 1, TAM_LARGURA: 800 }); b.semear.item({ QTD: 1, ALTURA: 1000, LARGURA: 800 });
  b.semear.retalho({ comprimento: 3000 });
  const { chamar } = await prepararCorte(t, { perfil: 'Planeja sem estoque', banco: b });
  const { id } = await salvar(chamar);
  const r = await confirmar(chamar, id, {});
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).baixas, []);
  assert.equal(b.estado.saidas.length, 0);
  assert.ok(!b.estado.auditoria.some(a => a.acao === 'corte_baixa_estoque'));
  assert.equal(b.estado.planos[0].situacao, 'conferido');
});

test('rollback total: se algo falha depois da baixa (retalho não está mais reservado), estoque, saídas e plano voltam ao que eram', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  ret.situacao = 'disponivel'; ret.plano_reserva = null;   // alguém soltou a reserva por fora
  const r = await confirmar(chamar, id, await corpoConfirmacao(chamar, id));
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /não está mais reservado/);
  assert.equal(b.estado.estoque[0].QTD_ESTOQUE, 50);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  assert.ok(!b.estado.auditoria.some(a => a.acao === 'corte_baixa_estoque'));
  assert.ok(b.f.chamadas.some(c => c.sql === 'ROLLBACK'));
});

test('confirmar duas vezes: a segunda dá 409 e não baixa o estoque de novo', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  const corpo = await corpoConfirmacao(chamar, id);
  assert.equal((await confirmar(chamar, id, corpo)).status, 200);
  const depois = b.estado.estoque[0].QTD_ESTOQUE, saidas = b.estado.saidas.length;
  assert.equal((await confirmar(chamar, id, corpo)).status, 409);
  assert.equal(b.estado.estoque[0].QTD_ESTOQUE, depois);
  assert.equal(b.estado.saidas.length, saidas);
  assert.equal(b.estado.auditoria.filter(a => a.acao === 'corte_baixa_estoque').length, 1);
});

test('sem a permissão de dar saída no estoque: 403 ao confirmar um plano com varas novas, e nada muda', async t => {
  for (const perfil of ['Planeja sem estoque', 'Planeja, estoque só ver']) {
    const b = cenario();
    const { chamar } = await prepararCorte(t, { perfil, banco: b });
    const { id } = await salvar(chamar);
    const r = await confirmar(chamar, id, { baixas: [{ chave: P100, produtoCodigo: 1 }] });
    assert.equal(r.status, 403, perfil);
    assert.match((await r.json()).error, /permissão/);
    assert.equal(b.estado.estoque[0].QTD_ESTOQUE, 50);
    assert.equal(b.estado.saidas.length, 0);
    assert.equal(b.estado.planos[0].situacao, 'gerado');
  }
});

test('GET /corte/estoque/produtos: só ativos, só código/nome/unidade/quantidade; exige corte.planejar e permissão de estoque', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { banco: b });
  const r = await chamar('/corte/estoque/produtos');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.produtos.map(p => p.nome), ['P100', 'P200', 'Parafuso']);   // 'Antigo' é inativo
  assert.deepEqual(j.produtos[0], { codigo: 1, nome: 'P100', unidade: 'Barra', qtdEstoque: 50 });
  assert.deepEqual(nomesDeCampo(j).filter(k => REGEX_VALOR.test(k)), []);
});

test('GET /corte/estoque/produtos sem a permissão de estoque ou sem corte.planejar: 403', async t => {
  for (const perfil of ['Planeja sem estoque', 'Planeja, estoque só ver', 'Só ver corte']) {
    const { chamar } = await prepararCorte(t, { perfil, banco: cenario() });
    assert.equal((await chamar('/corte/estoque/produtos')).status, 403, perfil);
  }
});
