// Ações em lote do calendário (calendario_lote.js): seleção por intervalo, sequência com falha parcial, resumo, corpo da situação e a ligação na tela.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../calendario_lote.js');
const K = require('../calendario_comum.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const ped = (numero, extra = {}) => ({ numero, cliente: 'Cliente ' + numero, clienteFinal: '', situacao: 'Em Produção', classe: 'producao', atrasado: false, ...extra });
const cel = (dia, pedidos, doMes = true) => ({ dia, doMes, pedidos });

test('numerosNaOrdem: ordem da tela (dia a dia), ignora dias de fora do mês e repetidos', () => {
  const semanas = [[cel('2026-11-01', []), cel('2026-11-02', [ped(30), ped(10)]), cel('2026-10-31', [ped(99)], false)], [cel('2026-11-09', [ped(20), ped(10)])]];
  assert.deepEqual(L.numerosNaOrdem(semanas), ['30', '10', '20']);
  assert.deepEqual(L.numerosNaOrdem(null), []);
});

test('intervalo: nos dois sentidos, inclusive, e tolera âncora ou alvo fora da lista', () => {
  const o = ['1', '2', '3', '4', '5'];
  assert.deepEqual(L.intervalo(o, '2', '4'), ['2', '3', '4']);
  assert.deepEqual(L.intervalo(o, '4', '2'), ['2', '3', '4']);
  assert.deepEqual(L.intervalo(o, 3, 3), ['3']);
  assert.deepEqual(L.intervalo(o, '9', '4'), ['4']);
  assert.deepEqual(L.intervalo(o, '2', '9'), []);
});

test('aplicarSelecao: clique simples marca/desmarca e define a âncora; Shift aplica o estado do clicado à faixa; não muta o estado anterior', () => {
  const o = ['1', '2', '3', '4', '5'];
  let s = { marcados: new Set(), ancora: '' };
  s = L.aplicarSelecao(s, o, '2', { marcar: true });
  assert.deepEqual([...s.marcados], ['2']);
  assert.equal(s.ancora, '2');
  const antes = s;
  s = L.aplicarSelecao(s, o, '5', { marcar: true, faixa: true });
  assert.deepEqual([...s.marcados].sort(), ['2', '3', '4', '5']);
  assert.equal(s.ancora, '5');
  assert.deepEqual([...antes.marcados], ['2']);   // imutável
  s = L.aplicarSelecao(s, o, '3', { marcar: false, faixa: true });   // faixa 5..3 desmarcando
  assert.deepEqual([...s.marcados].sort(), ['2']);
  s = L.aplicarSelecao(s, o, '4', { marcar: true, faixa: true });   // âncora agora é 3
  assert.deepEqual([...s.marcados].sort(), ['2', '3', '4']);
  // Shift sem âncora = só o clicado; número fora da lista é ignorado
  assert.deepEqual([...L.aplicarSelecao({ marcados: new Set(), ancora: '' }, o, '4', { marcar: true, faixa: true }).marcados], ['4']);
  assert.deepEqual([...L.aplicarSelecao(s, o, '77', { marcar: true }).marcados].sort(), ['2', '3', '4']);
});

test('manterVisiveis: só continua selecionado quem ainda está na tela, na ordem da tela', () => {
  assert.deepEqual(L.manterVisiveis(new Set(['3', '1', '8']), ['1', '2', '3']), ['1', '3']);
});

test('executarLote: um por um e em ordem; falha parcial não impede os outros; nunca lança', async () => {
  const chamadas = [];
  let emAndamento = 0, maximo = 0;
  const fn = async n => {
    emAndamento++; maximo = Math.max(maximo, emAndamento);
    await new Promise(r => setImmediate(r));
    chamadas.push(n); emAndamento--;
    if (n === '2') throw new Error('O pedido nº 2 está cancelado e não muda de data.');
    if (n === '4') { const e = new Error('Marcar como Entregue mesmo assim?'); e.status = 409; e.dados = { aviso: 'entregas_abertas', entregasAbertas: 2 }; throw e; }
  };
  const progresso = [];
  const r = await L.executarLote(['1', '2', '3', '4', '5'], fn, { aoProgresso: (f, t) => progresso.push([f, t]) });
  assert.deepEqual(chamadas, ['1', '2', '3', '4', '5']);
  assert.equal(maximo, 1);   // sequência, nunca em paralelo
  assert.deepEqual(r.map(x => x.ok), [true, false, true, false, true]);
  assert.match(r[1].erro, /cancelado/);
  assert.match(r[3].erro, /2 entrega\(s\) em aberto/);
  assert.doesNotMatch(r[3].erro, /mesmo assim/);   // 409 não é confirmado às cegas
  assert.deepEqual(progresso.at(-1), [5, 5]);
});

test('executarLote: parar() interrompe o resto (sessão expirada) e marca os demais como não processados; lista vazia = []', async () => {
  const fn = async n => { if (n === '2') throw new Error('Sessão expirada'); };
  const r = await L.executarLote(['1', '2', '3', '4'], fn, { parar: e => e.message === 'Sessão expirada' });
  assert.deepEqual(r.map(x => x.ok), [true, false, false, false]);
  assert.match(r[2].erro, /não processado/);
  assert.deepEqual(await L.executarLote([], fn), []);
});

test('motivoErro: mensagem limpa e cortada; erro sem mensagem não quebra', () => {
  assert.equal(L.motivoErro(new Error('  vários   espaços ')), 'vários espaços');
  assert.equal(L.motivoErro(null), 'Erro desconhecido');
  assert.equal(L.motivoErro(new Error('x'.repeat(500))).length, 200);
});

test('resumoLote: "N de M alterados" com a lista de falhas (número, cliente, motivo)', () => {
  const nomes = new Map([['2', 'Ana'], ['4', 'Beto']]);
  const r = L.resumoLote([{ numero: '1', ok: true }, { numero: '2', ok: false, erro: 'Cancelado' }, { numero: '3', ok: true }, { numero: '4', ok: false, erro: 'mesma data' }], 'data de pronto', nomes);
  assert.equal(r.titulo, '2 de 4 alterados (data de pronto)');
  assert.equal(r.qtdOk, 2);
  assert.equal(r.qtdFalhas, 2);
  assert.equal(r.todosOk, false);
  assert.deepEqual(r.numerosFalha, ['2', '4']);
  assert.deepEqual(r.falhas[0], { numero: '2', cliente: 'Ana', erro: 'Cancelado' });
  const tudo = L.resumoLote([{ numero: '1', ok: true }], '');
  assert.equal(tudo.titulo, '1 de 1 alterado');
  assert.equal(tudo.todosOk, true);
  assert.equal(L.resumoLote([], 'x').todosOk, false);
});

test('htmlResumo: dado do servidor só entra escapado; lista longa é cortada', () => {
  const r = L.resumoLote([{ numero: '1', ok: false, erro: '<img src=x onerror=alert(1)>' }], 'x', new Map([['1', '<b>Cli</b>']]));
  const h = L.htmlResumo(r);
  assert.ok(!h.includes('<img') && !h.includes('<b>Cli'));
  assert.ok(h.includes('&lt;img'));
  const muitos = L.resumoLote(Array.from({ length: 40 }, (_, i) => ({ numero: String(i), ok: false, erro: 'e' })), 'x');
  assert.match(L.htmlResumo(muitos), /e mais 10 pedido\(s\) com falha/);
});

test('corpoSituacao: só Entregue/Retirado levam data (hoje = nada; manter; pronto; data escolhida válida)', () => {
  assert.deepEqual(L.corpoSituacao('Pronto', 'manter'), { situacao: 'Pronto' });
  assert.deepEqual(L.corpoSituacao('Entregue', 'hoje'), { situacao: 'Entregue' });
  assert.deepEqual(L.corpoSituacao('Entregue', 'manter'), { situacao: 'Entregue', manterData: true });
  assert.deepEqual(L.corpoSituacao('Retirado', 'pronto'), { situacao: 'Retirado', usarDataPronto: true });
  assert.deepEqual(L.corpoSituacao('Retirado', 'data:2026-11-10'), { situacao: 'Retirado', dataEntrega: '2026-11-10' });
  assert.deepEqual(L.corpoSituacao('Retirado', 'data:lixo'), { situacao: 'Retirado' });
});

test('htmlBarra: só mostra as ações que o usuário pode; singular/plural; situações do menu (sem Cancelado)', () => {
  assert.match(L.htmlBarra(1, { dataPronto: true, situacao: true }), /1 selecionado</);
  assert.match(L.htmlBarra(3, { dataPronto: true, situacao: true }), /3 selecionados</);
  const so = L.htmlBarra(2, { dataPronto: true, situacao: false });
  assert.ok(so.includes('data-lote="data_pronto"') && !so.includes('data-lote-sit'));
  const sit = L.htmlBarra(2, { dataPronto: false, situacao: true });
  assert.ok(!sit.includes('data_pronto') && sit.includes('data-lote-sit') && !sit.includes('Cancelado'));
  assert.ok(sit.includes('data-lote="limpar"'));
});

test('htmlLinhaFolha: sem seleção ligada não tem caixa; com seleção tem caixa rotulada e marca o pedido selecionado', () => {
  assert.ok(!K.htmlLinhaFolha(ped(7), 'abertos', '').includes('sel-pedido'));
  const h = K.htmlLinhaFolha(ped(7), 'abertos', '', new Set(['7']));
  assert.match(h, /<input type="checkbox" class="sel-pedido" data-sel="7" aria-label="Selecionar o pedido 7" checked>/);
  assert.match(h, /folha-linha[^"]* sel"/);
  const nao = K.htmlLinhaFolha(ped(8), 'abertos', '', new Set(['7']));
  assert.ok(nao.includes('sel-pedido') && !/ checked>/.test(nao));
  const folha = K.htmlFolha([[{ dia: '2026-11-05', num: 5, doMes: true, hoje: false, qtdPedidos: 1, qtdAtrasados: 0, pedidos: [ped(7)] }]], 'abertos', '', new Set(['7']));
  assert.ok(folha.includes('data-sel="7"') && folha.includes(' checked>'));
});

test('calendario.html: carrega o lote antes do calendario.js, tem a barra e o resumo; o lote só chama rotas já existentes e só liga com a permissão', () => {
  const h = ler('calendario.html');
  assert.ok(h.indexOf('calendario_lote.js') > 0 && h.indexOf('calendario_lote.js') < h.indexOf('src="calendario.js'));
  assert.ok(h.includes('id="cal-lote"') && h.includes('id="cal-lote-resumo"'));
  const js = ler('calendario.js');
  assert.ok(js.includes('/data_pronto`') && js.includes('/situacao`'));
  assert.ok(!js.includes('/lote'));   // nenhuma rota nova
  assert.ok(js.includes("pode('pedidos.data_pronto')") && js.includes("pode('pedidos.situacao')"));
});
