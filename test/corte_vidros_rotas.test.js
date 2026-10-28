// Rotas de leitura do plano de corte de vidros: parâmetros, retalhos, produtos e pré-visualização (banco simulado em test/apoio/bancoVidros.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoVidros, prepararVidros } = require('./apoio/bancoVidros');
const { REGEX_VALOR } = require('../seguranca/valores');

const nomesDeCampo = dados => {
  const nomes = new Set();
  const varrer = d => { if (Array.isArray(d)) d.forEach(varrer); else if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) { nomes.add(k); varrer(v); } };
  varrer(dados);
  return [...nomes];
};
const escritas = banco => banco.f.chamadas.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql) && !/web_auditoria/.test(c.sql));
const semNomesDeDinheiro = (j, onde) => assert.deepEqual(nomesDeCampo(j).filter(n => REGEX_VALOR.test(n)), [], `nome de dinheiro em ${onde}`);
const prever = async (chamar, n = 100, escolhas) => (await chamar(`/corte_vidros/pedido/${n}` + (escolhas === undefined ? '' : '?escolhas=' + encodeURIComponent(typeof escolhas === 'string' ? escolhas : JSON.stringify(escolhas)))));

// pedido 100: item 1 = 2 peças Incolor 4mm (2000x800); item 2 = 1 peça Extra Clear 4mm (1000x500)
function cenario(b = bancoVidros()) {
  b.semear.pedido();
  b.semear.item({ ITEM_PEDIDO: 1, REVESTIMENTO: 'Incolor 4mm' });
  b.semear.item({ ITEM_PEDIDO: 2, REVESTIMENTO: 'Extra Clear 4mm' });
  b.semear.vidro({ ITEM: 1, QTD: 2, MODELO: 'Incolor 4mm', TAMANHO: '2000 x 800' });
  b.semear.vidro({ ITEM: 2, QTD: 1, MODELO: 'Extra Clear 4mm', TAMANHO: '1000 x 500' });
  return b;
}

test('config: sem linha devolve os padrões; PUT grava (upsert) com auditoria; GET devolve o gravado', async t => {
  const b = bancoVidros();
  const { chamar } = await prepararVidros(t, { banco: b });
  const j = await (await chamar('/corte_vidros/config')).json();
  assert.deepEqual(j.padraoDeFabrica, { serra: 0, sobraMinima: 300 });
  assert.deepEqual(j.padrao, { serra: 0, sobraMinima: 300 });
  const r = await chamar('/corte_vidros/config', 'PUT', { serra: 3, sobraMinima: 250 });
  assert.equal(r.status, 200);
  assert.deepEqual((await (await chamar('/corte_vidros/config')).json()).padrao, { serra: 3, sobraMinima: 250 });
  assert.equal(b.estado.config.length, 1);
  await chamar('/corte_vidros/config', 'PUT', { serra: 4, sobraMinima: 200 });   // segunda vez atualiza a mesma linha
  assert.equal(b.estado.config.length, 1);
  assert.equal(b.estado.config[0].serra, 4);
  assert.equal(b.estado.auditoria.filter(a => a.acao === 'corte_vidros_config_alterada').length, 2);
});

test('config: valor inválido dá 400; sem corte.parametros dá 403 no PUT mas 200 no GET', async t => {
  const b = bancoVidros();
  const { chamar } = await prepararVidros(t, { banco: b, perfil: 'Planeja' });
  assert.equal((await chamar('/corte_vidros/config')).status, 200);
  assert.equal((await chamar('/corte_vidros/config', 'PUT', { serra: 3, sobraMinima: 250 })).status, 403);
  const c = await prepararVidros(t, { banco: b });
  assert.equal((await c.chamar('/corte_vidros/config', 'PUT', { serra: -1, sobraMinima: 250 })).status, 400);
  assert.equal((await c.chamar('/corte_vidros/config', 'PUT', { serra: 1, sobraMinima: 0 })).status, 400);
  assert.deepEqual(b.estado.config, []);
});

test('sem permissão de corte.ver todas as rotas dão 403', async t => {
  const { chamar } = await prepararVidros(t, { perfil: 'Sem acesso' });
  for (const c of ['/corte_vidros/config', '/corte_vidros/retalhos', '/corte_vidros/estoque/produtos', '/corte_vidros/pedido/100']) assert.equal((await chamar(c)).status, 403, c);
});

test('retalhos: criar, listar com filtro, alterar e descartar; produto precisa ser candidato', async t => {
  const b = bancoVidros();
  const { chamar } = await prepararVidros(t, { banco: b });
  const criado = await (await chamar('/corte_vidros/retalhos', 'POST', { produtoCodigo: 10, altura: 1500, largura: 900 })).json();
  assert.equal(criado.ok, true);
  assert.equal(b.estado.retalhos[0].produto_nome, 'Vidro Incolor 4mm');
  assert.equal((await chamar('/corte_vidros/retalhos', 'POST', { produtoCodigo: 14, altura: 1500, largura: 900 })).status, 400);   // inativo
  assert.equal((await chamar('/corte_vidros/retalhos', 'POST', { produtoCodigo: 15, altura: 1500, largura: 900 })).status, 400);   // outra classe
  assert.equal((await chamar('/corte_vidros/retalhos', 'POST', { produtoCodigo: 99, altura: 1500, largura: 900 })).status, 400);   // inexistente
  assert.equal((await chamar('/corte_vidros/retalhos', 'POST', { produtoCodigo: 10, altura: 0, largura: 900 })).status, 400);
  const lista = await (await chamar('/corte_vidros/retalhos')).json();
  assert.deepEqual(lista.retalhos.map(r => [r.id, r.produtoCodigo, r.produtoNome, r.altura, r.largura, r.situacao]), [[criado.id, 10, 'Vidro Incolor 4mm', 1500, 900, 'disponivel']]);
  assert.equal((await chamar('/corte_vidros/retalhos?situacao=xx')).status, 400);
  assert.equal((await (await chamar('/corte_vidros/retalhos?situacao=usado')).json()).retalhos.length, 0);
  const alt = await chamar(`/corte_vidros/retalhos/${criado.id}`, 'PUT', { produtoCodigo: 13, altura: 1400, largura: 800 });
  assert.equal(alt.status, 200);
  assert.equal(b.estado.retalhos[0].produto_nome, 'Vidro Reflecta Fumê 4mm');
  assert.equal((await chamar(`/corte_vidros/retalhos/${criado.id}/descartar`, 'POST')).status, 200);
  assert.equal(b.estado.retalhos[0].situacao, 'descartado');
  assert.equal((await chamar(`/corte_vidros/retalhos/${criado.id}`, 'PUT', { produtoCodigo: 10, altura: 1, largura: 1 })).status, 409);
  assert.equal((await chamar(`/corte_vidros/retalhos/${criado.id}/descartar`, 'POST')).status, 409);
  assert.equal((await chamar('/corte_vidros/retalhos/999/descartar', 'POST')).status, 404);
  assert.ok(['corte_vidros_retalho_criado', 'corte_vidros_retalho_alterado', 'corte_vidros_retalho_descartado'].every(a => b.estado.auditoria.some(x => x.acao === a)));
});

test('retalhos: criar, alterar e descartar exigem corte.parametros; listar só corte.ver', async t => {
  const b = bancoVidros(); const ret = b.semear.retalho();
  const { chamar } = await prepararVidros(t, { banco: b, perfil: 'Só ver corte' });
  assert.equal((await chamar('/corte_vidros/retalhos')).status, 200);
  assert.equal((await chamar('/corte_vidros/retalhos', 'POST', { produtoCodigo: 10, altura: 1500, largura: 900 })).status, 403);
  assert.equal((await chamar(`/corte_vidros/retalhos/${ret.id}`, 'PUT', { produtoCodigo: 10, altura: 1500, largura: 900 })).status, 403);
  assert.equal((await chamar(`/corte_vidros/retalhos/${ret.id}/descartar`, 'POST')).status, 403);
});

test('produtos: só Revestimento ativo com medida; exige planejar + estoque', async t => {
  const b = bancoVidros();
  b.estado.estoque.push({ CODIGO: 16, NOME_PRODUTO: 'Vidro sem medida', UNIDADE: 'Chapa', CLASSE: 'Revestimento', SITUACAO: 'Ativo', ALTURA: 0, LARGURA: 2400, QTD_ESTOQUE: 1 });
  const { chamar } = await prepararVidros(t, { banco: b });
  const j = await (await chamar('/corte_vidros/estoque/produtos')).json();
  assert.deepEqual(j.produtos.map(p => p.codigo), [10, 11, 12, 13].sort((x, y) => b.estado.estoque.find(e => e.CODIGO === x).NOME_PRODUTO.localeCompare(b.estado.estoque.find(e => e.CODIGO === y).NOME_PRODUTO)));
  assert.deepEqual(j.produtos.find(p => p.codigo === 10), { codigo: 10, nome: 'Vidro Incolor 4mm', unidade: 'Chapa', altura: 3210, largura: 2400, qtdEstoque: 26 });
  semNomesDeDinheiro(j, 'produtos');
  const sem = await prepararVidros(t, { banco: b, perfil: 'Planeja sem estoque' });
  assert.equal((await sem.chamar('/corte_vidros/estoque/produtos')).status, 403);
  const ver = await prepararVidros(t, { banco: b, perfil: 'Planeja, estoque só ver' });
  assert.equal((await ver.chamar('/corte_vidros/estoque/produtos')).status, 403);
});

test('pré-visualização: pré-seleciona o produto único pelo nome; dois candidatos e modelo sem produto ficam sem pré-seleção', async t => {
  const b = cenario();
  b.semear.vidro({ ITEM: 3, QTD: 1, MODELO: 'Pintado Sólido (RAL 9003)', COR_REVESTIMENTO: 'Branco', TAMANHO: '500 x 500' });
  b.semear.item({ ITEM_PEDIDO: 3, REVESTIMENTO: 'Pintado Sólido (RAL 9003)', COR_REVESTIMENTO: 'Branco' });
  const { chamar } = await prepararVidros(t, { banco: b });
  const r = await prever(chamar);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.vazio, false);
  assert.equal(j.qtdPecas, 4);
  assert.deepEqual(j.pendencias, []);
  const g = Object.fromEntries(j.grupos.map(x => [x.chave, x]));
  assert.equal(g['Incolor 4mm|'].preSelecionado, 10);
  assert.deepEqual(g['Incolor 4mm|'].candidatos.map(c => c.codigo), [10]);
  assert.equal(g['Extra Clear 4mm|'].preSelecionado, null);
  assert.deepEqual(g['Extra Clear 4mm|'].candidatos.map(c => c.codigo), [11, 12]);
  assert.equal(g['Pintado Sólido (RAL 9003)|Branco'].preSelecionado, null);
  assert.deepEqual(g['Pintado Sólido (RAL 9003)|Branco'].candidatos, []);
  assert.equal(g['Incolor 4mm|'].qtdPecas, 2);
  assert.deepEqual(j.pedido, { numero: 100, cliente: 'Cliente X', situacao: 'Em Produção' });
  assert.equal(j.planoSalvo, null);
  assert.match(j.impressao, /^[0-9a-f]{64}$/);
});

test('pré-visualização: sem escolhas só o grupo pré-selecionado é planejado; os outros ficam aguardandoProduto sem erro', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const j = await (await prever(chamar)).json();
  const gr = Object.fromEntries(j.plano.grupos.map(x => [x.chave, x]));
  assert.equal(gr['Incolor 4mm|'].aguardandoProduto, false);
  assert.equal(gr['Incolor 4mm|'].produtoCodigo, 10);
  assert.ok(gr['Incolor 4mm|'].chapas.length >= 1);
  assert.equal(gr['Extra Clear 4mm|'].aguardandoProduto, true);
  assert.deepEqual(gr['Extra Clear 4mm|'].erros, []);
  assert.equal(j.plano.resumo.qtdPecasSemChapa, 1);
});

test('pré-visualização: escolhas definem o produto e usam retalho compatível (e só dele)', async t => {
  const b = cenario();
  const ret = b.semear.retalho({ produto_codigo: 11, produto_nome: 'Vidro Extra Clear 4mm - 2400mm', altura: 1200, largura: 600 });
  b.semear.retalho({ produto_codigo: 12, produto_nome: 'Vidro Extra Clear 4mm - 2540mm', altura: 1200, largura: 600 });   // outro produto: não serve
  const { chamar } = await prepararVidros(t, { banco: b });
  const j = await (await prever(chamar, 100, { 'Extra Clear 4mm|': 11 })).json();
  const g = j.plano.grupos.find(x => x.chave === 'Extra Clear 4mm|');
  assert.equal(g.produtoCodigo, 11);
  assert.equal(g.aguardandoProduto, false);
  assert.deepEqual(j.retalhosUsados, [ret.id]);
  assert.equal(j.plano.resumo.qtdRetalhosUsados, 1);
});

test('pré-visualização: produto escolhido inativo, de outra classe ou inexistente vira erro do grupo, não 500', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  for (const [codigo, trecho] of [[14, /inativo/i], [15, /Revestimento/], [999, /não encontrado/i]]) {
    const r = await prever(chamar, 100, { 'Incolor 4mm|': codigo });
    assert.equal(r.status, 200);
    const g = (await r.json()).plano.grupos.find(x => x.chave === 'Incolor 4mm|');
    assert.equal(g.erros.length, 1);
    assert.match(g.erros[0], trecho);
    assert.deepEqual(g.chapas, []);
  }
});

test('pré-visualização: peça maior que a chapa vira erro do grupo', async t => {
  const b = cenario();
  b.estado.vidros[0].TAMANHO = '4000 x 3500';
  const { chamar } = await prepararVidros(t, { banco: b });
  const g = (await (await prever(chamar)).json()).plano.grupos.find(x => x.chave === 'Incolor 4mm|');
  assert.ok(g.erros.length >= 1);
  assert.match(g.erros[0], /maior que a chapa/);
});

test('pré-visualização: vidros de item que só existe como orçamento do mesmo número viram pendência', async t => {
  const b = bancoVidros(); b.semear.pedido();
  b.semear.item({ TIPO: 'Orçamento', ITEM_PEDIDO: 1, REVESTIMENTO: 'Incolor 4mm' });   // o VB grava vidros também para orçamento de mesmo número
  b.semear.vidro({ ITEM: 1, QTD: 2 });
  const { chamar } = await prepararVidros(t, { banco: b });
  const j = await (await prever(chamar)).json();
  assert.equal(j.vazio, false);
  assert.equal(j.qtdPecas, 0);
  assert.equal(j.pendencias.length, 1);
});

test('pré-visualização: 404 para pedido inexistente/inválido e para pedido sem vidros (mensagem exata); orçamento: ver teste próprio', async t => {
  const b = bancoVidros(); b.semear.pedido({ NUMERO: 100 });
  const { chamar } = await prepararVidros(t, { banco: b });
  assert.equal((await prever(chamar, 999)).status, 404);
  assert.equal((await prever(chamar, 'abc')).status, 404);
  const r = await prever(chamar, 100);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'Este pedido não tem vidros.');
});

test('pré-visualização: número que só existe como Orçamento dá 404 (mesmo com vidros gravados)', async t => {
  const b = bancoVidros();
  b.semear.pedido({ NUMERO: 200, TIPO: 'Orçamento' });
  b.semear.item({ NUMERO: 200, ITEM_PEDIDO: 1, REVESTIMENTO: 'Incolor 4mm' });
  b.semear.vidro({ NUMERO: 200, ITEM: 1, QTD: 2 });
  const { chamar } = await prepararVidros(t, { banco: b });
  const r = await prever(chamar, 200);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'Pedido não encontrado.');
});

test('pré-visualização: escolhas ilegíveis dão 400', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  for (const ruim of ['{nao json', '[1,2]', '"x"', JSON.stringify({ 'Incolor 4mm|': 'abc' }), JSON.stringify({ 'Incolor 4mm|': 0 })]) {
    assert.equal((await prever(chamar, 100, ruim)).status, 400, ruim);
  }
});

test('pré-visualização: plano salvo aparece e a impressão diferente marca desatualizado', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const j0 = await (await prever(chamar)).json();
  b.estado.planos.push({ id: 1, pedido: 100, situacao: 'gerado', impressao_pecas: j0.impressao, criado_por: 'Caio', criado_em: '2026-10-15 10:00:00', conferido_em: null });
  const j1 = await (await prever(chamar)).json();
  assert.deepEqual(j1.planoSalvo, { id: 1, situacao: 'gerado', criadoPor: 'Caio', criadoEm: '2026-10-15 10:00:00', conferidoEm: null });
  assert.equal(j1.qtdPlanosGravados, 1);
  assert.equal(j1.qtdConferidos, 0);
  b.estado.vidros[0].TAMANHO = '1900 x 800';
  assert.equal((await (await prever(chamar)).json()).planoSalvo.situacao, 'desatualizado');
});

test('pré-visualização: nada é escrito no banco e nenhum nome de campo é de dinheiro', async t => {
  const b = cenario(); b.semear.retalho({ produto_codigo: 11, produto_nome: 'Vidro Extra Clear 4mm - 2400mm' });
  const { chamar } = await prepararVidros(t, { banco: b });
  const respostas = [];
  respostas.push(await (await prever(chamar)).json());
  respostas.push(await (await prever(chamar, 100, { 'Extra Clear 4mm|': 11 })).json());
  respostas.push(await (await chamar('/corte_vidros/config')).json());
  respostas.push(await (await chamar('/corte_vidros/retalhos')).json());
  assert.deepEqual(escritas(b), []);
  assert.equal(b.f.chamadas.some(c => /BEGIN|ROLLBACK/.test(c.sql)), false);
  respostas.forEach((j, i) => semNomesDeDinheiro(j, 'resposta ' + i));
});

test('pré-visualização: cada candidato traz qtdEstoque numérico (saldo do estoque) e nenhum nome casa REGEX_VALOR', async t => {
  const { chamar } = await prepararVidros(t, { banco: cenario() });
  const j = await (await prever(chamar)).json();
  const cand = j.grupos.find(x => x.chave === 'Incolor 4mm|').candidatos;
  assert.equal(cand.length, 1);
  assert.equal(typeof cand[0].qtdEstoque, 'number');
  assert.equal(cand[0].qtdEstoque, 26);
  semNomesDeDinheiro(j, 'previa com qtdEstoque');
});
