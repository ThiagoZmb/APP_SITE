// Confirmar o plano de corte de vidros com baixa de chapas novas no estoque (banco simulado em test/apoio/bancoVidros.js, que inclui o estoque do VB).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoVidros, prepararVidros, corpoConfirmacao } = require('./apoio/bancoVidros');
const { REGEX_VALOR } = require('../seguranca/valores');

const EXTRA = 'Extra Clear 4mm|';
const INCOLOR = 'Incolor 4mm|';
const ESC = { [EXTRA]: 11 };
const prever = async (chamar, escolhas = ESC) => (await chamar('/corte_vidros/pedido/100?escolhas=' + encodeURIComponent(JSON.stringify(escolhas)))).json();
const salvar = async (chamar, escolhas = ESC) => {
  const previa = await prever(chamar, escolhas);
  return (await chamar('/corte_vidros/pedido/100/salvar', 'POST', { impressao: previa.impressao, retalhosUsados: previa.retalhosUsados, escolhas })).json();
};
const confirmar = (chamar, id, corpo) => chamar(`/corte_vidros/plano/${id}/confirmar`, 'POST', corpo);
const nomesDeCampo = dados => {
  const nomes = new Set();
  const varrer = d => { if (Array.isArray(d)) d.forEach(varrer); else if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) { nomes.add(k); varrer(v); } };
  varrer(dados);
  return [...nomes];
};
const qtdEstoque = (b, cod) => b.estado.estoque.find(e => e.CODIGO === cod).QTD_ESTOQUE;

// pedido 100: 2 peças Incolor 4mm (2000x800, produto 10, uma chapa) + 1 peça Extra Clear 4mm (1000x500, produto 11, uma chapa)
function cenario(b = bancoVidros()) {
  b.semear.pedido();
  b.semear.item({ ITEM_PEDIDO: 1, REVESTIMENTO: 'Incolor 4mm' });
  b.semear.item({ ITEM_PEDIDO: 2, REVESTIMENTO: 'Extra Clear 4mm' });
  b.semear.vidro({ ITEM: 1, QTD: 2, MODELO: 'Incolor 4mm', TAMANHO: '2000 x 800' });
  b.semear.vidro({ ITEM: 2, QTD: 1, MODELO: 'Extra Clear 4mm', TAMANHO: '1000 x 500' });
  return b;
}
const baixasDoCenario = [{ chave: INCOLOR, produtoCodigo: 10 }, { chave: EXTRA, produtoCodigo: 11 }];

// dois grupos do mesmo produto 11: Extra Clear Branco (3 chapas) e Extra Clear New York (2 chapas); cada peça ocupa uma chapa inteira
const BRANCO = 'Extra Clear 4mm|Branco', NY = 'Extra Clear 4mm|New York';
function cenarioSoma(b = bancoVidros()) {
  b.semear.pedido();
  b.semear.item({ ITEM_PEDIDO: 1, REVESTIMENTO: 'Extra Clear 4mm', COR_REVESTIMENTO: 'Branco' });
  b.semear.item({ ITEM_PEDIDO: 2, REVESTIMENTO: 'Extra Clear 4mm', COR_REVESTIMENTO: 'New York' });
  b.semear.vidro({ ITEM: 1, QTD: 3, MODELO: 'Extra Clear 4mm', COR_REVESTIMENTO: 'Branco', TAMANHO: '3000 x 2300' });
  b.semear.vidro({ ITEM: 2, QTD: 2, MODELO: 'Extra Clear 4mm', COR_REVESTIMENTO: 'New York', TAMANHO: '3000 x 2300' });
  return b;
}
const ESC_SOMA = { [BRANCO]: 11, [NY]: 11 };

test('baixa correta: 1 por chapa nova, saida_estoque, QTD_ESTOQUE e auditoria só com nomes e quantidades', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  const r = await confirmar(chamar, id, await corpoConfirmacao(chamar, id, { baixas: baixasDoCenario }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.baixas, [{ produto: 'Vidro Extra Clear 4mm - 2400mm', qtd: 1 }, { produto: 'Vidro Incolor 4mm', qtd: 1 }]);   // ordem das chaves dos grupos
  assert.equal(j.situacao, 'conferido');
  assert.equal(qtdEstoque(b, 10), 25);
  assert.equal(qtdEstoque(b, 11), 9);
  assert.equal(qtdEstoque(b, 12), 10);
  assert.equal(b.estado.saidas.length, 2);
  assert.deepEqual({ ...b.estado.saidas[0], DATA: undefined }, { ID: 1, CODIGO_BARRA: '11', FORNECEDOR: 'FORN', NOME_PRODUTO_FORNECEDOR: 'VIDRO EXTRA CLEAR 4MM - 2400MM', NOME_PRODUTO: 'Vidro Extra Clear 4mm - 2400mm', DATA: undefined, QTD: 1, USUARIO: 'Caio', STATUS: null });
  assert.match(b.estado.saidas[0].DATA, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(b.estado.planos[0].situacao, 'conferido');
  assert.equal(b.estado.planos[0].conferido_por, 'Caio');
  const aud = b.estado.auditoria.filter(a => a.acao === 'corte_vidros_baixa_estoque');
  assert.equal(aud.length, 1);
  assert.deepEqual(aud[0].detalhe.itens, j.baixas);
  assert.equal(b.estado.auditoria.filter(a => a.acao === 'corte_vidros_conferido').length, 1);
  assert.deepEqual(nomesDeCampo([aud[0].detalhe, b.estado.auditoria.find(a => a.acao === 'corte_vidros_conferido').detalhe, j]).filter(k => REGEX_VALOR.test(k)), []);
});

test('dois grupos com o mesmo produto somam as chapas: 3 + 2 = uma saída de 5 e conferência do saldo sobre a soma', async t => {
  const b = cenarioSoma();
  const { chamar } = await prepararVidros(t, { banco: b });
  const previa = await prever(chamar, ESC_SOMA);
  assert.equal(previa.plano.resumo.qtdChapasNovas, 5);
  const { id } = await salvar(chamar, ESC_SOMA);
  const r = await confirmar(chamar, id, { baixas: [{ chave: BRANCO, produtoCodigo: 11 }, { chave: NY, produtoCodigo: 11 }] });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).baixas, [{ produto: 'Vidro Extra Clear 4mm - 2400mm', qtd: 5 }]);
  assert.equal(qtdEstoque(b, 11), 5);
  assert.deepEqual(b.estado.saidas.map(s => s.QTD), [5]);
});

test('saldo insuficiente na SOMA por produto: 400 e nada muda (cada grupo sozinho caberia)', async t => {
  const b = cenarioSoma();
  b.estado.estoque.find(e => e.CODIGO === 11).QTD_ESTOQUE = 4;   // 3 e 2 cabem separados, 5 não
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar, ESC_SOMA);
  const r = await confirmar(chamar, id, { baixas: [{ chave: BRANCO, produtoCodigo: 11 }, { chave: NY, produtoCodigo: 11 }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /A quantidade do item 'Vidro Extra Clear 4mm - 2400mm' é menor que 0! \(estoque: 4, saída: 5\)/);
  assert.equal(qtdEstoque(b, 11), 4);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  assert.ok(!b.estado.auditoria.some(a => a.acao === 'corte_vidros_baixa_estoque' || a.acao === 'corte_vidros_conferido'));
});

test('baixas ausentes, incompletas ou inválidas: 400 com mensagem clara e nada muda', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  const casos = [
    [{}, /Informe o produto do estoque/],
    [{ baixas: [] }, /Falta informar a baixa/],
    [{ baixas: [{ chave: INCOLOR, produtoCodigo: 10 }] }, /Falta informar a baixa .*Extra Clear/],
    [{ baixas: [{ chave: 'nao-existe', produtoCodigo: 10 }, { chave: EXTRA, produtoCodigo: 11 }] }, /grupo desconhecido/],
    [{ baixas: [{ produtoCodigo: 10 }] }, /grupo desconhecido/],
    [{ baixas: [{ chave: INCOLOR, produtoCodigo: 10 }, { chave: INCOLOR, produtoCodigo: 10 }, { chave: EXTRA, produtoCodigo: 11 }] }, /mais de uma vez/],
    [{ baixas: [{ chave: INCOLOR }, { chave: EXTRA, produtoCodigo: 11 }] }, /Produto do estoque inválido/],
    [{ baixas: [{ chave: INCOLOR, produtoCodigo: 'abc' }, { chave: EXTRA, produtoCodigo: 11 }] }, /Produto do estoque inválido/],
    [{ baixas: [{ chave: INCOLOR, produtoCodigo: 13 }, { chave: EXTRA, produtoCodigo: 11 }] }, /não é o produto com que o plano foi gerado/],   // outro vidro ativo
    [{ baixas: [{ chave: INCOLOR, produtoCodigo: 10 }, { chave: EXTRA, produtoCodigo: 12 }] }, /não é o produto com que o plano foi gerado/]
  ];
  for (const [corpo, msg] of casos) {
    const r = await confirmar(chamar, id, corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.match((await r.json()).error, msg, JSON.stringify(corpo));
  }
  assert.equal(b.estado.saidas.length, 0);
  assert.deepEqual(b.estado.estoque.map(e => e.QTD_ESTOQUE), [26, 10, 10, 10, 10, 10]);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
});

test('produto desativado entre salvar e confirmar: 400 e nada é gravado', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  b.estado.estoque.find(e => e.CODIGO === 11).SITUACAO = 'Inativo';
  const r = await confirmar(chamar, id, { baixas: baixasDoCenario });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /inativo/);
  assert.equal(qtdEstoque(b, 10), 26);
  assert.equal(qtdEstoque(b, 11), 10);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
});

test('plano só com retalhos: confirma sem baixa e sem exigir permissão de estoque; retalho vira usado', async t => {
  const b = bancoVidros();
  b.semear.pedido(); b.semear.item({ ITEM_PEDIDO: 1, REVESTIMENTO: 'Extra Clear 4mm' });
  b.semear.vidro({ ITEM: 1, QTD: 1, MODELO: 'Extra Clear 4mm', TAMANHO: '1000 x 500' });
  const ret = b.semear.retalho({ produto_codigo: 11, produto_nome: 'Vidro Extra Clear 4mm - 2400mm', altura: 1500, largura: 1000 });
  const { chamar } = await prepararVidros(t, { perfil: 'Planeja sem estoque', banco: b });
  const { id } = await salvar(chamar);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'reservado');
  const r = await confirmar(chamar, id, {});
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.baixas, []);
  assert.equal(j.qtdRetalhosUsados, 1);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal(qtdEstoque(b, 11), 10);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'usado');
  assert.ok(!b.estado.auditoria.some(a => a.acao === 'corte_vidros_baixa_estoque'));
  assert.equal(b.estado.planos[0].situacao, 'conferido');
});

test('retalho não usado volta a ficar disponível e não baixa estoque; retalho de outro plano em retalhosNaoUsados: 400', async t => {
  const b = bancoVidros();
  b.semear.pedido(); b.semear.item({ ITEM_PEDIDO: 1, REVESTIMENTO: 'Extra Clear 4mm' });
  b.semear.vidro({ ITEM: 1, QTD: 1, MODELO: 'Extra Clear 4mm', TAMANHO: '1000 x 500' });
  const ret = b.semear.retalho({ produto_codigo: 11, produto_nome: 'Vidro Extra Clear 4mm - 2400mm', altura: 1500, largura: 1000 });
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal((await confirmar(chamar, id, { retalhosNaoUsados: [999] })).status, 400);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  const r = await confirmar(chamar, id, { retalhosNaoUsados: [ret.id] });
  assert.equal(r.status, 200);
  const x = b.estado.retalhos.find(y => y.id === ret.id);
  assert.deepEqual([x.situacao, x.plano_reserva], ['disponivel', null]);
  assert.equal((await r.json()).qtdRetalhosUsados, 0);
});

test('plano com chapa nova sem estoque.movimentar (ou só estoque.ver): 403 e nada muda', async t => {
  for (const perfil of ['Planeja sem estoque', 'Planeja, estoque só ver']) {
    const b = cenario();
    const { chamar } = await prepararVidros(t, { perfil, banco: b });
    const { id } = await salvar(chamar);
    const r = await confirmar(chamar, id, { baixas: baixasDoCenario });
    assert.equal(r.status, 403, perfil);
    assert.match((await r.json()).error, /permissão/);
    assert.equal(qtdEstoque(b, 10), 26);
    assert.equal(b.estado.saidas.length, 0);
    assert.equal(b.estado.planos[0].situacao, 'gerado');
  }
});

test('sem corte.planejar: 403; plano inexistente 404; id inválido 404', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { perfil: 'Só ver corte', banco: b });
  assert.equal((await confirmar(chamar, 1, {})).status, 403);
  const { chamar: c2 } = await prepararVidros(t, { banco: b });
  assert.equal((await confirmar(c2, 77, {})).status, 404);
  assert.equal((await confirmar(c2, 'abc', {})).status, 404);
});

test('rollback total: retalho que perdeu a reserva DEPOIS da baixa desfaz estoque, saídas, retalhos e plano', async t => {
  const b = cenario();
  const ret = b.semear.retalho({ produto_codigo: 11, produto_nome: 'Vidro Extra Clear 4mm - 2400mm', altura: 1500, largura: 1000 });
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  const plano = await (await chamar(`/corte_vidros/plano/${id}`)).json();
  assert.equal(plano.plano.resumo.qtdRetalhosUsados, 1);
  const baixas = [{ chave: INCOLOR, produtoCodigo: 10 }];   // Extra Clear é atendido pelo retalho; só o Incolor baixa
  ret.situacao = 'disponivel'; ret.plano_reserva = null;   // alguém soltou a reserva por fora
  const r = await confirmar(chamar, id, { baixas });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /não está mais reservado/);
  assert.ok(b.f.chamadas.some(c => /^INSERT INTO saida_estoque/.test(c.sql)), 'a baixa chegou a ser gravada antes da falha');
  assert.equal(qtdEstoque(b, 10), 26);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  assert.equal(b.estado.retalhos.length, 1);
  assert.equal(b.estado.retalhos[0].situacao, 'disponivel');
  assert.ok(!b.estado.auditoria.some(a => a.acao === 'corte_vidros_baixa_estoque' || a.acao === 'corte_vidros_conferido'));
  assert.ok(b.f.chamadas.some(c => c.sql === 'ROLLBACK'));
});

test('confirmar duas vezes: a segunda dá 409 e não baixa o estoque de novo', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  const corpo = await corpoConfirmacao(chamar, id, { baixas: baixasDoCenario });
  assert.equal((await confirmar(chamar, id, corpo)).status, 200);
  const depois = [qtdEstoque(b, 10), qtdEstoque(b, 11)], saidas = b.estado.saidas.length;
  assert.equal((await confirmar(chamar, id, corpo)).status, 409);
  assert.deepEqual([qtdEstoque(b, 10), qtdEstoque(b, 11)], depois);
  assert.equal(b.estado.saidas.length, saidas);
  assert.equal(b.estado.auditoria.filter(a => a.acao === 'corte_vidros_baixa_estoque').length, 1);
});

test('sobras guardadas viram retalhos do produto certo, com plano_origem; sobra não citada ou descartada não vira retalho', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  const corpo = await corpoConfirmacao(chamar, id, { baixas: baixasDoCenario });
  assert.ok(corpo.sobras.length >= 2);
  const plano = await (await chamar(`/corte_vidros/plano/${id}`)).json();
  const doIncolor = corpo.sobras.filter(s => s.grupo === INCOLOR), doExtra = corpo.sobras.filter(s => s.grupo === EXTRA);
  assert.ok(doIncolor.length && doExtra.length);
  // guarda a primeira sobra do Incolor com 10 mm a menos em cada lado (medida real menor que a calculada), descarta a primeira do Extra Clear e omite o resto
  const guardada = { ...doIncolor[0], altura: doIncolor[0].altura - 10, largura: doIncolor[0].largura - 10 };
  const enviadas = [guardada, { ...doExtra[0], destino: 'descartar', altura: 5000, largura: 5000 }];
  const r = await confirmar(chamar, id, { sobras: enviadas, baixas: baixasDoCenario });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.qtdRetalhosNovos, 1);
  assert.equal(b.estado.retalhos.length, 1);
  const x = b.estado.retalhos[0];
  assert.deepEqual([x.produto_codigo, x.produto_nome, x.altura, x.largura, x.situacao, x.plano_origem],
    [10, 'Vidro Incolor 4mm', guardada.altura, guardada.largura, 'disponivel', id]);
  assert.ok(plano.plano.grupos.length === 2);
});

test('sobra guardada abaixo da mínima (dos parâmetros gravados no plano), em qualquer lado: 400 e nada muda', async t => {
  const b = cenario();
  b.estado.config.push({ id: 1, serra: 0, sobra_minima: 250 });   // o plano grava 250; mudar a config depois não vale
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  b.estado.config[0].sobra_minima = 1;
  const corpo = await corpoConfirmacao(chamar, id, { baixas: baixasDoCenario });
  const s0 = corpo.sobras.find(s => s.grupo === INCOLOR);
  for (const medida of [{ altura: 249 }, { largura: 249 }]) {
    const r = await confirmar(chamar, id, { ...corpo, sobras: [{ ...s0, ...medida }] });
    assert.equal(r.status, 400, JSON.stringify(medida));
    assert.match((await r.json()).error, /abaixo da mínima \(250 mm/);
  }
  assert.equal(b.estado.retalhos.length, 0);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  // exatamente na mínima é aceito
  const ok = await confirmar(chamar, id, { ...corpo, sobras: [{ ...s0, altura: 250, largura: 250 }] });
  assert.equal(ok.status, 200);
  assert.equal(b.estado.retalhos.length, 1);
});

test('conferência inválida (sobra inexistente, medida real maior que a calculada): 400 antes de baixar', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  const corpo = await corpoConfirmacao(chamar, id, { baixas: baixasDoCenario });
  const s0 = corpo.sobras[0];
  assert.equal((await confirmar(chamar, id, { ...corpo, sobras: [{ ...s0, sobra: 99 }] })).status, 400);
  assert.equal((await confirmar(chamar, id, { ...corpo, sobras: [{ ...s0, altura: s0.altura + 1 }] })).status, 400);
  assert.equal(b.estado.saidas.length, 0);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
});

test('retalhosNaoUsados que não é lista de inteiros positivos: 400 e nada gravado; ausente vale lista vazia', async t => {
  const b = cenario();
  const ret = b.semear.retalho({ produto_codigo: 10, produto_nome: 'Vidro Incolor 4mm', altura: 2500, largura: 1000 });
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  const antes = JSON.stringify([b.estado.estoque, b.estado.saidas, b.estado.retalhos, b.estado.planos]);
  for (const invalido of ['texto', { 0: ret.id }, 7, null, ['a'], [1.5], [0], [-2], [ret.id, 'x']]) {
    const r = await confirmar(chamar, id, { baixas: baixasDoCenario, retalhosNaoUsados: invalido });
    assert.equal(r.status, 400, JSON.stringify(invalido));
    assert.match((await r.json()).error, /Lista de retalhos não usados inválida/);
    assert.equal(JSON.stringify([b.estado.estoque, b.estado.saidas, b.estado.retalhos, b.estado.planos]), antes, JSON.stringify(invalido));
  }
  const ok = await confirmar(chamar, id, { baixas: baixasDoCenario });   // ausente = []
  assert.equal(ok.status, 200);
});
