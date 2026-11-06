// Telas do calendário de pedidos: calendario.html/.js e calendario_dia.html/.js (+ calendario_comum.js, calendario.css) e o menu do botão direito.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const K = require('../calendario_comum.js');
const Mes = require('../calendario.js');
const Dia = require('../calendario_dia.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const csp = h => h.match(/Content-Security-Policy" content="([^"]+)"/)[1];

const ped = (numero, extra = {}) => ({ numero, cliente: 'Cliente ' + numero, clienteFinal: '', situacao: 'Em Produção', classe: 'producao', atrasado: false, prontoEm: '2026-11-05', dataEntrega: '', valor: 100, ...extra });
const dia = (data, pedidos) => ({ data, qtdPedidos: pedidos.length, qtdAtrasados: pedidos.filter(p => p.atrasado).length, pedidos });

// ---------- lógica pura ----------
test('montarGrade: semanas de domingo a sábado; novembro/2026 começa num domingo e a última semana termina em 05/12; hoje marcado', () => {
  const sem = K.montarGrade([dia('2026-11-05', [ped(1), ped(2)])], '2026-11', '2026-11-05');
  assert.ok(sem.every(s => s.length === 7));
  assert.equal(sem.length, 5);
  assert.equal(sem[0][0].dia, '2026-11-01');
  assert.equal(sem[4][6].dia, '2026-12-05');
  const c = sem.flat().find(x => x.dia === '2026-11-05');
  assert.equal(c.hoje, true);
  assert.equal(c.qtdPedidos, 2);
  assert.equal(sem.flat().filter(x => x.hoje).length, 1);
});

test('montarGrade: dias de fora do mês ficam vazios; fevereiro bissexto tem 29; virada de ano (dezembro)', () => {
  const bi = K.montarGrade([], '2028-02', '2028-02-29').flat();
  assert.ok(bi.some(c => c.dia === '2028-02-29' && c.doMes && c.hoje));
  assert.equal(bi.filter(c => c.doMes).length, 29);
  const nao = K.montarGrade([], '2027-02', '').flat();
  assert.equal(nao.filter(c => c.doMes).length, 28);
  // dezembro/2026 termina numa quinta: a última semana entra em janeiro/2027 e fica fora do mês
  const dez = K.montarGrade([dia('2027-01-01', [ped(9)]), dia('2026-12-31', [ped(8)])], '2026-12', '2026-12-31');
  const fim = dez[dez.length - 1];
  assert.equal(fim[6].dia, '2027-01-02');
  assert.equal(fim[6].doMes, false);
  assert.equal(dez.flat().find(c => c.dia === '2027-01-01').qtdPedidos, 0, 'pedido de outro mês não aparece na célula de fora');
  assert.equal(dez.flat().find(c => c.dia === '2026-12-31').qtdPedidos, 1);
});

test('somarMeses, somarDias, mesDe, nomeMes, dataExtenso e validadores', () => {
  assert.equal(K.somarMeses('2026-12', 1), '2027-01');
  assert.equal(K.somarMeses('2027-01', -1), '2026-12');
  assert.equal(K.somarMeses('2026-11', 0), '2026-11');
  assert.equal(K.somarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(K.somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(K.mesDe('2026-11-05'), '2026-11');
  assert.equal(K.nomeMes('2026-03'), 'Março de 2026');
  assert.equal(K.dataExtenso('2026-11-05'), 'quinta-feira, 5 de novembro de 2026');
  assert.equal(K.mesValido('2026-13'), false);
  assert.equal(K.mesValido('2026-12'), true);
  assert.equal(K.dataValida('2026-02-29'), false);
  assert.equal(K.situacaoValida('todos'), 'todos');
  assert.equal(K.situacaoValida('x'), 'abertos');
});

test('lerConsulta: mês e data da URL, inválidos caem no padrão', () => {
  assert.deepEqual(Mes.lerConsulta('?mes=2026-03&situacao=todos', '2026-11-05'), { mes: '2026-03', situacao: 'todos', visao: 'grade' });
  assert.deepEqual(Mes.lerConsulta('?mes=2026-03&visao=lista', '2026-11-05'), { mes: '2026-03', situacao: 'abertos', visao: 'lista' });
  assert.deepEqual(Mes.lerConsulta('?mes=2026-99&situacao=zzz', '2026-11-05'), { mes: '2026-11', situacao: 'abertos', visao: 'grade' });
  assert.deepEqual(Mes.lerConsulta('?visao=zzz', '2026-11-05'), { mes: '2026-11', situacao: 'abertos', visao: 'grade' });
  assert.deepEqual(Mes.lerConsulta('', '2026-11-05'), { mes: '2026-11', situacao: 'abertos', visao: 'grade' });
  assert.deepEqual(Dia.lerConsulta('?data=2028-02-29&situacao=todos'), { data: '2028-02-29', situacao: 'todos' });
  assert.deepEqual(Dia.lerConsulta('?data=2027-02-29'), { data: null, situacao: 'abertos' });
  assert.deepEqual(Dia.lerConsulta(''), { data: null, situacao: 'abertos' });
});

test('etiqueta: número, cliente abreviado, selo de atraso e escape de HTML; situação visível só em "todos"', () => {
  const p = ped(7, { cliente: '<img src=x onerror=alert(1)> Cliente com nome muito comprido', atrasado: true });
  const h = K.htmlEtiqueta(p, 'abertos');
  assert.match(h, /<li class="etq info atraso" data-numero="7" tabindex="0"/);
  assert.match(h, /#7/);
  assert.match(h, /Atrasado/);
  assert.ok(!h.includes('<img'), 'cliente escapado');
  assert.match(h, /<span class="etq-cli">[^<]+…<\/span>/, 'nome abreviado na etiqueta (o título guarda o nome inteiro)');
  assert.ok(!h.includes('etq-sit'));
  assert.match(K.htmlEtiqueta(ped(8, { situacao: 'Entregue', classe: 'entregue' }), 'todos'), /etq ok[^>]*>.*etq-sit">Entregue</s);
  assert.doesNotMatch(K.htmlEtiqueta(ped(9), 'abertos'), /Atrasado/);
});

test('célula: no máximo MAX_ETIQUETAS etiquetas e "+N mais" que leva ao dia; número do dia é link; dia de fora sem link', () => {
  assert.equal(K.MAX_ETIQUETAS, 8);
  const pedidos = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ped(n));
  const sem = K.montarGrade([dia('2026-11-05', pedidos)], '2026-11', '2026-11-05');
  const h = K.htmlCelula(sem.flat().find(c => c.dia === '2026-11-05'), 'todos');
  assert.equal((h.match(/<li class="etq/g) || []).length, 8);
  assert.match(h, /<a class="mais" href="calendario_dia\.html\?data=2026-11-05&amp;situacao=todos">\+2 mais<\/a>/);   // 10 pedidos: 8 etiquetas + "+2 mais"
  assert.match(h, /<a class="num" href="calendario_dia\.html\?data=2026-11-05&amp;situacao=todos"[^>]*aria-current="date"/);
  assert.match(h, /class="cel hoje"/);
  const fora = K.montarGrade([], '2026-12', '').flat().find(c => !c.doMes);
  const hf = K.htmlCelula(fora, 'abertos');
  assert.ok(!hf.includes('<a ') && !hf.includes('data-dia'));
});

test('lista do celular: só os dias com pedido, cada um com link para a página do dia', () => {
  const sem = K.montarGrade([dia('2026-11-03', [ped(1, { atrasado: true })]), dia('2026-11-20', [ped(2), ped(3)])], '2026-11', '2026-11-05');
  const h = K.htmlListaDias(sem, 'abertos');
  assert.equal((h.match(/<section class="dia-lista/g) || []).length, 2);
  assert.match(h, /href="calendario_dia\.html\?data=2026-11-20&amp;situacao=abertos"/);
  assert.match(h, /1 atrasado\(s\)/);
  assert.match(K.htmlListaDias(K.montarGrade([], '2026-11', ''), 'abertos'), /Nenhum pedido previsto neste mês/);
});

test('linha do dia: situação, atraso, valor só se a API mandou, botão Ações', () => {
  const com = K.htmlLinhaDia(ped(5, { atrasado: true, clienteFinal: 'Obra X' }));
  assert.match(com, /data-numero="5"/);
  assert.match(com, /selo info">Em Produção/);
  assert.match(com, /selo perigo">Atrasado/);
  assert.match(com, /ld-valor" data-valor>R\$\s?100,00/);
  assert.match(com, /Obra X/);
  assert.match(com, /class="btn btn-mini btn-secondary ld-acoes"/);
  const { valor, ...semValor } = ped(6);
  assert.doesNotMatch(K.htmlLinhaDia(semValor), /ld-valor|R\$/);
  assert.doesNotMatch(K.htmlLinhaDia(ped(7)), /Atrasado/);
});

test('alternador Em aberto | Todos marca o escolhido com aria-pressed', () => {
  const h = K.htmlSituacao('todos');
  assert.match(h, /data-sit="abertos"[^>]*aria-pressed="false"[^>]*>Em aberto/);
  assert.match(h, /data-sit="todos"[^>]*aria-pressed="true"[^>]*>Todos/);
});

// ---------- menu do botão direito: o mesmo inicio_menu.js, com os dados do calendário ----------
function carregarMenu(permissoes, voltar) {
  global.window = { addEventListener() {}, innerWidth: 1000, abrirPdfAutenticado() {} };
  global.document = { addEventListener() {} };
  delete require.cache[require.resolve('../inicio_menu.js')];
  require('../inicio_menu.js');
  return global.window.InicioMenu.iniciar({ apiBase: 'https://api', loginUrl: 'login', token: () => 't', docDe: () => null, recarregar() {}, esc: s => s, voltar,
    pode: p => String(p).split(' ').every(x => permissoes.has(x)) });
}
const rotulos = it => it.filter(x => x.rotulo).map(x => x.rotulo);
const TODAS = ['pedidos.ver', 'pedidos.pdf', 'pedidos.checklist', 'pedidos.situacao', 'orcamentos.criar', 'valores.ver', 'corte.ver', 'danfe.ver', 'entregas.ver'];

test('menu do calendário: tem todos os itens pedidos para quem tem todas as permissões', () => {
  const r = rotulos(carregarMenu(new Set(TODAS)).itensDoMenu(ped(7)));
  for (const esperado of ['Alterar data de pronto', 'Entregue', 'Pronto', 'Retirado', 'Em Produção', 'Abrir para editar', 'Abrir PDF', 'Guia de produção',
    'Imprimir etiquetas (Zebra)', 'Corte de perfil', 'Corte de vidros', 'Imprimir checklist', 'Abrir nota fiscal (DANFE)']) assert.ok(r.includes(esperado), esperado);
});

test('menu do calendário: cada item some sem a permissão correspondente', () => {
  const sem = (perm, rotulo, p = ped(7)) => {
    const resto = new Set(TODAS.filter(x => x !== perm));
    assert.ok(!rotulos(carregarMenu(resto).itensDoMenu(p)).includes(rotulo), `${rotulo} sem ${perm}`);
    assert.ok(rotulos(carregarMenu(new Set(TODAS)).itensDoMenu(p)).includes(rotulo), `${rotulo} com ${perm}`);
  };
  sem('pedidos.situacao', 'Alterar data de pronto');
  sem('pedidos.situacao', 'Entregue');
  sem('pedidos.pdf', 'Abrir PDF');
  sem('pedidos.pdf', 'Guia de produção');
  sem('pedidos.pdf', 'Imprimir etiquetas (Zebra)');
  sem('pedidos.checklist', 'Imprimir checklist');
  sem('danfe.ver', 'Abrir nota fiscal (DANFE)');
  sem('corte.ver', 'Corte de perfil');
  sem('corte.ver', 'Corte de vidros');
  sem('orcamentos.criar', 'Abrir para editar');
  assert.deepEqual(carregarMenu(new Set(['pedidos.ver'])).itensDoMenu(ped(7)), [], 'só pedidos.ver: menu vazio');
});

test('menu do calendário: pedido cancelado não tem data de pronto, situação nem cortes', () => {
  const r = rotulos(carregarMenu(new Set(TODAS)).itensDoMenu(ped(7, { situacao: 'Cancelado', classe: 'cancelado' })));
  for (const x of ['Alterar data de pronto', 'Entregue', 'Corte de perfil', 'Corte de vidros']) assert.ok(!r.includes(x), x);
});

test('"Abrir para editar" volta para a página de onde veio (voltar), com padrão inicio.html', () => {
  const abrir = voltar => {
    const it = carregarMenu(new Set(TODAS), voltar).itensDoMenu(ped(7)).find(x => x.rotulo === 'Abrir para editar');
    global.location = {}; it.fn(); const h = global.location.href; delete global.location; return h;
  };
  assert.equal(abrir(undefined), 'orcamentos.html?abrir=Pedido/7&voltar=inicio.html');
  assert.equal(abrir('calendario_dia.html?data=2026-11-05&situacao=todos'), 'orcamentos.html?abrir=Pedido/7&voltar=calendario_dia.html%3Fdata%3D2026-11-05%26situacao%3Dtodos');
});

test('ligarMenu: usa o InicioMenu com o pedido da tela, recarrega a tela e só liga com pedidos.ver', () => {
  let cfg = null;
  const win = { InicioMenu: { iniciar: c => { cfg = c; return {}; } }, Acesso: { pode: p => p === 'pedidos.ver' }, location: { pathname: '/APP_SITE/calendario.html', search: '?mes=2026-11' } };
  const pedido = ped(7);
  const recarregar = () => {};
  K.ligarMenu(win, { auth: () => ({ token: 'tk' }), recarregar, docDe: n => (String(n) === '7' ? pedido : undefined) });
  assert.equal(cfg.docDe('7'), pedido);
  assert.equal(cfg.recarregar, recarregar);
  assert.equal(cfg.token(), 'tk');
  assert.equal(cfg.voltar, 'calendario.html?mes=2026-11');
  assert.equal(cfg.pode('pedidos.ver'), true);
  assert.equal(K.ligarMenu({ ...win, Acesso: { pode: () => false } }, { auth: () => null, recarregar, docDe() {} }), null);
});

// ---------- páginas, CSP, layout ----------
for (const [html, js, ids] of [
  ['calendario.html', 'calendario.js', ['cal-corpo', 'cal-titulo', 'cal-resumo', 'cal-situacao', 'cal-grade', 'cal-lista', 'user-empresa', 'user-avatar', 'user-name', 'user-cargo', 'toasts']],
  ['calendario_dia.html', 'calendario_dia.js', ['dia-voltar', 'dia-anterior', 'dia-proximo', 'dia-hoje', 'dia-titulo', 'dia-resumo', 'dia-situacao', 'dia-lista', 'user-empresa', 'user-avatar', 'user-name', 'user-cargo', 'toasts']]
]) {
  test(`${html}: CSP igual à do Início, tema.css por último com ?v=, scripts do menu, ids usados pelo JS, sem inline`, () => {
    const h = ler(html), inicio = ler('inicio.html');
    assert.equal(csp(h), csp(inicio));
    // tema.css: a última folha de estilo, com a mesma versão do Início
    const css = [...h.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
    assert.equal(css[css.length - 1], inicio.match(/href="(tema\.css\?v=\d+)"/)[1]);
    assert.ok(css[0].startsWith('calendario.css?v='));
    assert.ok(h.indexOf('tema.css') > h.indexOf('calendario.css'));
    // scripts do menu do botão direito + os da tela, todos com ?v= e defer, e na ordem em que dependem uns dos outros
    const scripts = [...h.matchAll(/<script src="([^"?]+)\?v=\d+" defer><\/script>/g)].map(m => m[1]);
    assert.deepEqual(scripts, ['layout.js', 'entregas_comum.js', 'calendario_comum.js', 'inicio_menu.js', 'escolha_data_entrega.js', 'alterar_data_pronto.js',
      'danfe_pedido.js', 'etiqueta_zebra.js', 'checklist_pedido.js', js]);
    assert.equal((h.match(/<script/g) || []).length, scripts.length, 'nenhum script inline');
    assert.doesNotMatch(h, /\son[a-z]+=/i);
    assert.doesNotMatch(h, /\sstyle=/i);
    assert.doesNotMatch(h, /data-foco-busca/);
    for (const id of ids) assert.ok(h.includes(`id="${id}"`), id);
    assert.ok(h.includes('<nav class="sidebar">') && h.includes('<meta name="viewport"'));
    const codigo = ler(js) + ler('calendario_comum.js');
    for (const id of ids.filter(i => /^(cal|dia)-/.test(i))) assert.ok(codigo.includes(`'${id}'`) || codigo.includes(`"${id}"`), `${id} é usado pelo JS`);
  });
}

test('calendario.css: sem cores soltas (só variáveis do tema) e a grade vira lista no celular', () => {
  const c = ler('calendario.css');
  assert.doesNotMatch(c, /#[0-9a-fA-F]{3,8}\b/, 'nada de hex');
  assert.doesNotMatch(c, /\brgba?\(/);
  assert.doesNotMatch(c, /\bhsla?\(/);
  assert.match(c, /@media \(max-width: 900px\) \{\s*\.cal \{ display: none; \}\s*\.cal-lista \{ display: block; \}/);
  assert.doesNotMatch(c, /\.chip\b/, '"chip" é classe do tema.css');
});

test('layout.js: item no menu logo depois de Minhas entregas, em PAGINAS com pedidos.ver, subpágina acende o calendário; minhas_entregas segue por último', () => {
  const l = ler('layout.js');
  assert.match(l, /\{ href: 'minhas_entregas\.html'[^\n]*\n\s*\{ href: 'calendario\.html', texto: 'Calendário de pedidos', icone: 'calendario' \}/);
  assert.match(l, /'calendario\.html': \['pedidos\.ver'\]/);
  assert.match(l, /'calendario_dia\.html': \['pedidos\.ver'\]/);
  assert.match(l, /'calendario_dia\.html': 'calendario\.html'/);
  assert.match(l, /\n\s+calendario: ic\(/);
  assert.ok(l.indexOf("href: 'calendario.html'") < l.indexOf("secao: 'Gestão'"), 'na seção Comercial');
  const ctx = { window: {}, document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem: () => null }, location: { pathname: '/x/inicio.html' }, sessionStorage: { getItem: () => null }, setTimeout, console };
  ctx.window = ctx; vm.createContext(ctx);
  try { vm.runInContext(l, ctx); } catch { /* o layout monta o DOM só no navegador */ }
  const paginas = Object.keys(ctx.ACESSO_PAGINAS || {});
  if (paginas.length) {
    assert.equal(paginas[paginas.length - 1], 'minhas_entregas.html');
    assert.ok(paginas.includes('calendario.html') && paginas.includes('calendario_dia.html'));
  }
});

test('index.js registra o módulo do calendário e inicio_menu.js aceita "voltar"', () => {
  assert.match(ler('index.js'), /registrarCalendario\(\{ rota: registro\.rota, pool \}\)/);
  assert.match(ler('inicio_menu.js'), /voltar=\$\{enc\(cfg\.voltar \|\| 'inicio\.html'\)\}/);
});

test('visão em lista: um bloco por dia com pedido (data e dia da semana), uma linha "P número - cliente | cliente final"', () => {
  const p1 = { ...ped(23392), cliente: 'P & G Comércio', clienteFinal: 'Gilma Goulart' }, p2 = { ...ped(23405), cliente: 'Oceanstop', clienteFinal: '' };
  const sem = K.montarGrade([dia('2026-11-09', [p1, p2]), dia('2026-11-11', [ped(7)])], '2026-11', '2026-11-05');
  const h = K.htmlFolha(sem, 'abertos');
  assert.equal((h.match(/<section class="folha-dia/g) || []).length, 2);          // só os dias com pedido
  assert.match(h, /09\/11\/2026 \(segunda-feira\)/);
  assert.match(h, /11\/11\/2026 \(quarta-feira\)/);
  assert.match(h, /P 23392<\/span> - <span class="folha-cli">P &amp; G Comércio<\/span> \| <span class="folha-final">Gilma Goulart<\/span>/);   // escapa HTML
  assert.match(h, /data-numero="23405"/);                                          // o menu do botão direito acha a linha
  assert.ok(!/23405<\/span> - <span class="folha-cli">Oceanstop<\/span> \|/.test(h), 'sem cliente final não põe a barra');
  assert.match(K.htmlFolha(K.montarGrade([], '2026-11', ''), 'abertos'), /Nenhum pedido previsto/);
  assert.match(K.htmlFolha(sem, 'todos'), /folha-sit/);                            // situação visível só em "todos"
});

test('alternador Calendário | Lista e endereço da visão', () => {
  assert.equal(K.visaoValida('lista'), 'lista');
  assert.equal(K.visaoValida('x'), 'grade');
  assert.match(K.htmlVisao('lista'), /data-visao="lista"[^>]*aria-pressed="true"/);
  assert.match(K.htmlVisao('lista'), /data-visao="grade"[^>]*aria-pressed="false"/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'calendario.html'), 'utf8');   // o alternador fica ao lado do título e não na barra do mês
  assert.match(html, /<h1 class="welcome-title">Calendário de pedidos<\/h1>\s*<div id="cal-visao" class="tipo-toggle"/);
  assert.doesNotMatch(html.slice(html.indexOf('class="cal-topo"')), /id="cal-visao"/);
  assert.equal(K.urlMes('2026-11', 'abertos', 'lista'), 'calendario.html?mes=2026-11&situacao=abertos&visao=lista');
  assert.equal(K.urlMes('2026-11', 'abertos'), 'calendario.html?mes=2026-11&situacao=abertos');
});

test('alternadores: a opção escolhida tem a classe "ativo" e o contêiner não usa data-visao nem data-sit (o closest() engolia o clique de Em aberto/Todos)', () => {
  assert.match(K.htmlVisao('lista'), /class="toggle-btn active" data-visao="lista"/);
  assert.match(K.htmlVisao('lista'), /class="toggle-btn" data-visao="grade"/);
  assert.match(K.htmlSituacao('todos'), /class="btn btn-mini btn-primary ativo" data-sit="todos"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'calendario.js'), 'utf8');
  assert.match(js, /\$\('cal-corpo'\)\.dataset\.modo = /);
  assert.doesNotMatch(js, /cal-corpo'\)\.dataset\.(visao|sit)\b/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'calendario.css'), 'utf8');
  assert.doesNotMatch(css, /data-visao="lista"\]/);
  assert.match(css, /#cal-corpo:not\(\[data-modo="lista"\]\) \.btn-imprimir \{ display: none; \}/);
});
