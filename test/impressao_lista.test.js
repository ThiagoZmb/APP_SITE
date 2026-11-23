// Impressão da lista de Pedidos e Orçamentos (painel_inicial.html + impressao_lista.js/.css): o que sai no papel é o que a tela mostra.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../impressao_lista.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const painel = ler('painel_inicial.html');

const COLS = [{ id: 'numero', rotulo: 'Número' }, { id: 'cliente', rotulo: 'Cliente' }, { id: 'valor', rotulo: 'Valor', num: true, valor: true }, { id: 'financeiro', rotulo: 'Financeiro', valor: true }];
const linha = (n, extra = {}) => ({ celulas: { numero: String(n), cliente: 'Cli ' + n, valor: 'R$ 100,00', financeiro: 'Em aberto' }, ...extra });

// ---------- lógica pura ----------
test('colunasVisiveis: coluna de valor só com valores.ver', () => {
  assert.deepEqual(I.colunasVisiveis(COLS, true).map(c => c.id), ['numero', 'cliente', 'valor', 'financeiro']);
  assert.deepEqual(I.colunasVisiveis(COLS, false).map(c => c.id), ['numero', 'cliente']);
});

test('documento sem valores.ver: nem o cabeçalho nem as células de dinheiro saem (nem o total)', () => {
  const sem = I.htmlDocumento({ titulo: 'Pedidos', geradoEm: '18/11/2026 10:00', filtros: [], colunas: COLS, podeValores: false, linhas: [linha(1)], filtradas: 1, total: '' });
  assert.doesNotMatch(sem, /Valor|Financeiro|R\$ 100|Em aberto|Total:/);
  assert.match(sem, /<th>Número<\/th><th>Cliente<\/th>/);
  const com = I.htmlDocumento({ titulo: 'Pedidos', geradoEm: 'x', filtros: [], colunas: COLS, podeValores: true, linhas: [linha(1)], filtradas: 1, total: 'R$ 100,00' });
  assert.match(com, /<th class="num">Valor<\/th><th>Financeiro<\/th>/);
  assert.match(com, /<td class="num">R\$ 100,00<\/td>/);
  assert.match(com, /Total: <b>R\$ 100,00<\/b>/);
});

test('cabeçalho: título, data/hora, filtros ativos em texto, total de linhas; filtro vazio não entra; HTML escapado', () => {
  const h = I.htmlDocumento({ titulo: 'Orçamentos', geradoEm: '18/11/2026 10:00:00', colunas: COLS, podeValores: true, linhas: [linha(1), linha(2)], filtradas: 2,
    filtros: [['Período', 'Últimos 6 meses'], ['Cliente', ''], ['Busca', '<b>x</b>']] });
  assert.match(h, /<h1 class="imp-titulo">Orçamentos<\/h1>/);
  assert.match(h, /Gerado em 18\/11\/2026 10:00:00/);
  assert.match(h, /2 registro\(s\)/);
  assert.match(h, /Período: Últimos 6 meses · Busca: &lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(h, /Cliente:/);
  assert.equal(I.textoFiltros([['A', ' '], ['B', null]]), 'Nenhum filtro ativo');
  assert.doesNotMatch(h, /imp-parcial/);
});

test('impressão parcial: avisa no cabeçalho quando a tela mostra menos do que o filtro tem', () => {
  const r = I.resumoQuantidade(500, 1234);
  assert.equal(r.parcial, true);
  assert.match(r.texto, /500 de 1\.234 registro\(s\).*PARCIAL/);
  assert.equal(I.resumoQuantidade(3, 3).parcial, false);
  const h = I.htmlDocumento({ titulo: 'Pedidos', geradoEm: 'x', colunas: COLS, podeValores: true, linhas: [linha(1)], filtradas: 9, filtros: [] });
  assert.match(h, /class="imp-qtd imp-parcial"/);
});

test('lista vazia: uma linha de aviso com o colspan das colunas visíveis', () => {
  const h = I.htmlDocumento({ titulo: 'Pedidos', geradoEm: 'x', colunas: COLS, podeValores: false, linhas: [], filtradas: 0, filtros: [] });
  assert.match(h, /<td colspan="2" class="vazio">Nenhum registro na tela<\/td>/);
});

test('imprimir: põe o bloco no body com a classe, chama print e limpa tudo no afterprint', () => {
  const ouvintes = {}; let impressoes = 0; const filhos = [];
  const body = { classes: new Set(), classList: { add: c => body.classes.add(c), remove: c => body.classes.delete(c) }, appendChild: el => { filhos.push(el); el.pai = body; } };
  const doc = { title: 'Pedidos e Orçamentos', body, getElementById: id => filhos.find(e => e.id === id) || null,
    createElement: () => ({ id: '', innerHTML: '', remove() { const i = filhos.indexOf(this); if (i >= 0) filhos.splice(i, 1); } }) };
  const win = { document: doc, print() { impressoes++; assert.ok(body.classes.has('imprimindo-lista')); assert.equal(filhos.length, 1); assert.match(filhos[0].innerHTML, /imp-tabela/); },
    addEventListener: (n, f) => { ouvintes[n] = f; }, removeEventListener: n => { delete ouvintes[n]; } };
  I.imprimir(win, { titulo: 'Pedidos', geradoEm: '18/11/2026 10:00', colunas: COLS, podeValores: true, linhas: [linha(1)], filtradas: 1, filtros: [] });
  assert.equal(impressoes, 1);
  assert.match(doc.title, /^Pedidos - 18-11-2026 10-00$/, 'título do arquivo ao salvar em PDF, sem caractere proibido');
  ouvintes.afterprint();
  assert.equal(body.classes.size, 0);
  assert.equal(filhos.length, 0);
  assert.equal(doc.title, 'Pedidos e Orçamentos');
  assert.equal(ouvintes.afterprint, undefined);
});

// ---------- a tela: o botão e a função que escolhe as linhas ----------
test('painel_inicial.html: botão "Imprimir" na barra da lista, ligado a imprimirLista; CSS e script com ?v= e sem script inline novo', () => {
  assert.match(painel, /<button type="button" class="btn btn-secondary btn-mini" id="print-btn"[^>]*>[^]*?Imprimir<\/button>/);
  assert.match(painel, /\$\('print-btn'\)\.addEventListener\('click', imprimirLista\)/);
  assert.match(painel, /<link rel="stylesheet" href="impressao_lista\.css\?v=\d+">\s*<link rel="stylesheet" href="tema\.css\?v=\d+">/);
  assert.match(painel, /<script src="impressao_lista\.js\?v=\d+" defer><\/script>/);
  const topo = painel.slice(painel.indexOf('class="lista-topo"'), painel.indexOf('id="chips-sit"'));
  assert.ok(topo.indexOf('id="refresh-btn"') < topo.indexOf('id="print-btn"'));
  assert.doesNotMatch(topo, /onclick=|style=/);
});

// executa listaDaTela/imprimirLista REAIS do painel_inicial.html com a tela simulada
function tela({ pedidos = [], orcamentos = [], pode = () => true, olho = false } = {}) {
  const ini = painel.indexOf('const COLUNAS = ['), fim = painel.indexOf('function renderLista()');
  assert.ok(ini > 0 && fim > ini);
  const campos = { 'search-input': { value: '' }, periodo: { selectedOptions: [{ textContent: 'Últimos 6 meses' }] }, 'periodo-txt': { textContent: '01/06/2026 a 18/11/2026' } };
  const chamadas = [];
  const plano = o => JSON.parse(JSON.stringify(o));
  const ctx = {
    $: id => campos[id], esc: I.esc, moeda: v => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ','), norm: t => String(t || '').toLowerCase().trim(),
    janela: () => ({ ini: null, fim: null, nome: 'últimos 6 meses' }), entre: l => l, soma: l => l.reduce((s, x) => s + x.v, 0),
    textoBusca: x => String(Object.values(x).join(' ')).toLowerCase(), iconesItens: () => ' <span class="itens-doc">ICONE</span>',
    semanaDaData: () => '', seloEntrega: () => '', seloAndamento: () => '', Situacoes: { selo: (_a, _b, t) => `<span class="selo">${t}</span>` },
    Acesso: { pode: p => pode(p) }, OlhoResumos: { visivel: () => olho },
    window: { ImpressaoLista: { imprimir: (_w, cfg) => chamadas.push({ ...cfg, colunas: cfg.colunas, linhas: plano(cfg.linhas), filtros: plano(cfg.filtros) }) } }
  };
  vm.createContext(ctx);
  vm.runInContext(`let tipoLista = 'Pedido', filtroSit = '', cliente = ''; let pedidos = ${JSON.stringify(pedidos)}, orcamentos = ${JSON.stringify(orcamentos)};
    const NOME_SIT = { producao: 'Em produção', pronto: 'Pronto' }, VALOR_SIT = { producao: 'em_producao', pronto: 'pronto' };
    const doCliente = l => cliente ? l.filter(x => x.cliente === cliente) : l;
    ${painel.slice(ini, fim)}
    this.api = { listaDaTela, imprimirLista, set(o) { if ('tipoLista' in o) tipoLista = o.tipoLista; if ('filtroSit' in o) filtroSit = o.filtroSit; if ('cliente' in o) cliente = o.cliente; } };`, ctx);
  return { api: ctx.api, campos, chamadas, ctx };
}
const reg = (numero, cliente, s, v = 100) => ({ numero, cliente, s, v, situacao: s === 'pronto' ? 'Pronto' : 'Em Produção', data: '10/11/2026', financeiro: 'Aberto', clienteFinal: '', observacao: '' });

test('imprimirLista usa só as linhas filtradas visíveis (chip de situação, cliente e busca), sem rebuscar nada', () => {
  const t = tela({ pedidos: [reg(1, 'Ana', 'pronto'), reg(2, 'Bia', 'producao'), reg(3, 'Ana', 'producao'), reg(4, 'Ana', 'pronto')] });
  t.api.imprimirLista();
  assert.equal(t.chamadas[0].linhas.length, 4);
  assert.equal(t.chamadas[0].titulo, 'Pedidos');
  t.api.set({ filtroSit: 'pronto', cliente: 'Ana' });
  t.api.imprimirLista();
  assert.deepEqual(t.chamadas[1].linhas.map(l => l.celulas.numero), ['1', '4']);
  assert.deepEqual(t.chamadas[1].filtros, [['Período', 'Últimos 6 meses (01/06/2026 a 18/11/2026)'], ['Cliente', 'Ana'], ['Situação', 'Pronto']]);
  // com texto na busca vale a BUSCA GLOBAL: cliente e chip são ignorados e o cabeçalho diz isso
  t.campos['search-input'].value = '4';
  t.api.imprimirLista();
  const c = t.chamadas[2];
  assert.deepEqual(c.linhas.map(l => l.celulas.numero), ['4']);
  assert.equal(c.filtradas, 1);
  assert.deepEqual(c.filtros, [['Busca em todos os registros', '4']]);
  assert.match(I.textoFiltros(c.filtros), /Busca em todos os registros: 4/);
  // a lista da tela e a do papel são a mesma função
  assert.deepEqual(Array.from(t.api.listaDaTela().visiveis, x => x.numero), [4]);
  assert.match(painel, /function renderLista\(\) \{\s*const \{ j, base, lista, visiveis, buscaGlobal \} = listaDaTela\(\);/);
  const corpo = painel.slice(painel.indexOf('function imprimirLista()'), painel.indexOf('function renderLista()'));
  assert.doesNotMatch(corpo, /\bapi\(|fetch\(|buscarTipo|carregar\(/, 'não vai ao servidor');
});

test('imprimirLista: aba Orçamentos imprime orçamentos (sem chip de situação) e o título muda', () => {
  const t = tela({ pedidos: [reg(1, 'Ana', 'pronto')], orcamentos: [reg(90, 'Zé', 'aberto'), reg(91, 'Zé', 'aberto')] });
  t.api.set({ tipoLista: 'Orçamento', filtroSit: 'pronto' });
  t.api.imprimirLista();
  assert.equal(t.chamadas[0].titulo, 'Orçamentos');
  assert.deepEqual(t.chamadas[0].linhas.map(l => l.celulas.numero), ['90', '91']);
  assert.ok(!t.chamadas[0].filtros.some(f => f[0] === 'Situação' && f[1]));
});

test('imprimirLista: limite de linhas da tela (500) vale no papel e `filtradas` avisa que é parcial', () => {
  const muitos = Array.from({ length: 520 }, (_, i) => reg(i + 1, 'Ana', 'producao'));
  const t = tela({ pedidos: muitos });
  t.api.imprimirLista();
  assert.equal(t.chamadas[0].linhas.length, 500);
  assert.equal(t.chamadas[0].filtradas, 520);
  assert.equal(I.resumoQuantidade(t.chamadas[0].linhas.length, t.chamadas[0].filtradas).parcial, true);
});

test('imprimirLista: ícones decorativos não saem no papel; a coluna de valor some sem valores.ver; total só com valores.ver E olho aberto', () => {
  const dados = { pedidos: [reg(1, 'Ana', 'pronto', 250), reg(2, 'Bia', 'pronto', 50)] };
  const html = cfg => I.htmlDocumento(cfg);
  const comTudo = tela({ ...dados, olho: true }); comTudo.api.imprimirLista();
  assert.doesNotMatch(comTudo.chamadas[0].linhas[0].celulas.numero, /ICONE/);
  assert.equal(comTudo.chamadas[0].total, 'R$ 300,00');
  assert.match(html(comTudo.chamadas[0]), /<th class="num">Valor<\/th>/);
  const olhoFechado = tela({ ...dados, olho: false }); olhoFechado.api.imprimirLista();
  assert.equal(olhoFechado.chamadas[0].total, '', 'olho fechado: nenhum total sai');
  assert.match(html(olhoFechado.chamadas[0]), /<th class="num">Valor<\/th>/, 'a coluna da lista continua (é a lista, não resumo)');
  const semValores = tela({ ...dados, olho: true, pode: p => p !== 'valores.ver' }); semValores.api.imprimirLista();
  const h = html(semValores.chamadas[0]);
  assert.equal(semValores.chamadas[0].total, '');
  assert.doesNotMatch(h, /Valor|Financeiro|R\$/);
  assert.match(h, /Situação/);
});

test('a tela usa as mesmas COLUNAS: colunas de dinheiro marcadas com valor:true e data-valor na tabela da tela', () => {
  const bloco = painel.slice(painel.indexOf('const COLUNAS = ['), painel.indexOf('const MAX_LINHAS_LISTA'));
  assert.match(bloco, /id: 'valor', rotulo: 'Valor', num: true, valor: true/);
  assert.match(bloco, /id: 'financeiro', rotulo: 'Financeiro', valor: true/);
  assert.equal((bloco.match(/valor: true/g) || []).length, 2);
  assert.match(painel, /\$\{c\.valor \? ' data-valor' : ''\}/);
  const th = painel.slice(painel.indexOf('<thead>', painel.indexOf('id="orders-table"')), painel.indexOf('</thead>', painel.indexOf('id="orders-table"')));
  for (const c of ['Número', 'Cliente', 'Cliente final', 'Data', 'Pronto em', 'Valor', 'Observação', 'Situação', 'Financeiro', 'Entrega']) assert.ok(bloco.includes(`rotulo: '${c}'`), c);
  assert.equal((th.match(/<th[ >]/g) || []).length, 10);
});

// ---------- o CSS de papel ----------
test('impressao_lista.css: A4 paisagem, tudo some menos o bloco, cabeçalho repete, linha não quebra, fundo branco, só dentro de @media print', () => {
  const css = ler('impressao_lista.css');
  assert.match(css, /#area-impressao \{ display: none; \}/, 'na tela o bloco não aparece');
  const print = css.slice(css.indexOf('\n@media print {'));
  assert.match(print, /@page \{ size: A4 landscape;/);
  assert.match(print, /body\.imprimindo-lista > \*:not\(#area-impressao\) \{ display: none !important; \}/);
  assert.match(print, /\.imp-tabela thead \{ display: table-header-group; \}/);
  assert.match(print, /\.imp-tabela tr \{ break-inside: avoid;/);
  assert.match(print, /background: #fff !important; color: #000 !important/);
  assert.match(print, /--white: #fff/);
  // nada de regra de papel solta fora do @media print (só o display:none do bloco)
  assert.equal(css.slice(0, css.indexOf('\n@media print {')).replace(/\/\*[^]*?\*\//g, '').trim(), '#area-impressao { display: none; }');
});

test('versão do ?v= do CSS e do JS de impressão sobem juntas', () => {
  const v = [...painel.matchAll(/impressao_lista\.(?:css|js)\?v=(\d+)/g)].map(m => m[1]);
  assert.equal(v.length, 2);
  assert.equal(new Set(v).size, 1);
});
