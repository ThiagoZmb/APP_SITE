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
  assert.deepEqual(Mes.lerConsulta('?mes=2026-03&situacao=todos', '2026-11-05'), { mes: '2026-03', situacao: 'todos', visao: 'lista' });
  assert.deepEqual(Mes.lerConsulta('?mes=2026-03&visao=grade', '2026-11-05'), { mes: '2026-03', situacao: 'abertos', visao: 'grade' });
  assert.deepEqual(Mes.lerConsulta('?mes=2026-99&situacao=zzz', '2026-11-05'), { mes: '2026-11', situacao: 'abertos', visao: 'lista' });
  assert.deepEqual(Mes.lerConsulta('?visao=zzz', '2026-11-05'), { mes: '2026-11', situacao: 'abertos', visao: 'lista' });
  assert.deepEqual(Mes.lerConsulta('', '2026-11-05'), { mes: '2026-11', situacao: 'abertos', visao: 'lista' });
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
    assert.deepEqual(scripts, ['layout.js', 'entregas_comum.js', 'calendario_comum.js', 'inicio_menu.js', 'escolha_data_entrega.js', 'alterar_data_pronto.js', 'calculo/desconto_pedido.js', 'desconto_pedido_tela.js',
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

test('layout.js: item no menu logo depois de Corte de vidros (seção Comercial), em PAGINAS com pedidos.ver, subpágina acende o calendário; minhas_entregas segue por último', () => {
  const l = ler('layout.js');
  assert.match(l, /\{ href: 'corte_vidros\.html'[^\n]*\n\s*\{ href: 'calendario\.html', texto: 'Calendário de pedidos', icone: 'calendario' \}/);
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
  assert.equal(K.visaoValida('x'), 'lista');   // padrão = Lista (inversão deliberada no commit a31b881)
  assert.equal(K.visaoValida('grade'), 'grade');
  assert.match(K.htmlVisao('lista'), /data-visao="lista"[^>]*aria-pressed="true"/);
  assert.match(K.htmlVisao('lista'), /data-visao="grade"[^>]*aria-pressed="false"/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'calendario.html'), 'utf8');   // o alternador fica ao lado do título e não na barra do mês
  assert.match(html, /<h1 class="welcome-title">Calendário de pedidos<\/h1>\s*<div id="cal-visao" class="tipo-toggle"/);
  assert.doesNotMatch(html.slice(html.indexOf('class="cal-topo"')), /id="cal-visao"/);
  assert.equal(K.urlMes('2026-11', 'abertos', 'grade'), 'calendario.html?mes=2026-11&situacao=abertos&visao=grade');   // só a visão que NÃO é o padrão vai na URL
  assert.equal(K.urlMes('2026-11', 'abertos', 'lista'), 'calendario.html?mes=2026-11&situacao=abertos');
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

// ---------- pesquisa (só destaca, nunca filtra) ----------
const pesq = [
  ped(23392, { cliente: 'P & G Comércio', clienteFinal: 'Gilma Goulart' }),
  ped(23400, { cliente: 'Comunica', clienteFinal: 'Dávila' }),
  ped(23405, { cliente: 'Oceanstop' }),
  ped(777, { cliente: 'Wellington Lucena', clienteFinal: 'Comunicação Visual' })
];

test('pedidoCasa: número, cliente e cliente final; sem acento, sem maiúscula; "#" e "P " valem como o número; vazio nunca casa', () => {
  assert.equal(K.pedidoCasa(pesq[0], '2339'), true);               // parte do número
  assert.equal(K.pedidoCasa(pesq[0], '#23392'), true);
  assert.equal(K.pedidoCasa(pesq[0], 'P 23392'), true);
  assert.equal(K.pedidoCasa(pesq[0], 'p & g'), true);              // cliente, sem diferenciar maiúscula
  assert.equal(K.pedidoCasa(pesq[1], 'DAVILA'), true);             // cliente final, sem acento
  assert.equal(K.pedidoCasa(pesq[1], 'dávila'), true);
  assert.equal(K.pedidoCasa(pesq[3], 'comunicacao'), true);        // "Comunicação" sem cedilha/til
  assert.equal(K.pedidoCasa(pesq[2], 'gilma'), false);
  assert.equal(K.pedidoCasa(pesq[2], ''), false);
  assert.equal(K.pedidoCasa(pesq[2], '   '), false);
  assert.equal(K.pedidoCasa(pesq[2], null), false);
  assert.equal(K.pedidoCasa({ numero: 1 }, 'x'), false);           // sem cliente/cliente final não quebra
  assert.equal(K.pedidoCasa(ped(5, { cliente: 'Pedro' }), 'pedro'), true, '"p" no começo de um nome não é prefixo de número');
});

test('localizar: conta pedidos e dias na ordem da tela, sem alterar a grade', () => {
  const sem = K.montarGrade([dia('2026-11-05', [pesq[0], pesq[1]]), dia('2026-11-09', [pesq[2], pesq[3]])], '2026-11', '2026-11-05');
  const antes = JSON.stringify(sem);
  const r = K.localizar(sem.flat(), 'comunic');
  assert.deepEqual(r.numeros, ['23400', '777']);
  assert.equal(r.qtdPedidos, 2);
  assert.equal(r.qtdDias, 2);
  assert.equal(JSON.stringify(sem), antes);
  assert.deepEqual(K.localizar(sem.flat(), 'zzz'), { numeros: [], qtdPedidos: 0, qtdDias: 0 });
  assert.equal(K.localizar(sem.flat(), '').qtdPedidos, 0);
  assert.equal(K.localizar(null, 'a').qtdPedidos, 0);
});

test('textoBusca: contagem, vazio sem termo e aviso quando nada casa no mês (com dica do filtro Em aberto)', () => {
  assert.equal(K.textoBusca('', { qtdPedidos: 0, qtdDias: 0 }, 'abertos'), '');
  assert.equal(K.textoBusca('x', { qtdPedidos: 3, qtdDias: 2 }, 'abertos'), '3 pedido(s) encontrado(s) em 2 dia(s).');
  assert.match(K.textoBusca('x', { qtdPedidos: 0, qtdDias: 0 }, 'abertos'), /Nenhum pedido encontrado no mês exibido.*Todos/);
  assert.doesNotMatch(K.textoBusca('x', { qtdPedidos: 0, qtdDias: 0 }, 'todos'), /Todos/);
});

test('destaque nas três visões: pedido e dia marcados, todos os pedidos continuam na tela, rótulo acessível diz "encontrado"', () => {
  const sem = K.montarGrade([dia('2026-11-05', [pesq[0], pesq[1]]), dia('2026-11-09', [pesq[2]])], '2026-11', '');
  const conta = (h, re) => (h.match(re) || []).length;
  for (const [nome, h, rePed] of [
    ['grade', K.htmlGrade(sem, 'abertos', 'davila'), /<li class="etq /g],
    ['folha', K.htmlFolha(sem, 'abertos', 'davila'), /<li class="folha-linha/g],
    ['celular', K.htmlListaDias(sem, 'abertos', 'davila'), /<li class="etq /g]
  ]) {
    assert.equal(conta(h, rePed), 3, `${nome}: nenhum pedido some`);
    assert.equal(conta(h, /class="[^"]* achou[" ]/g), 1, `${nome}: só o pedido que casou`);
    assert.equal(conta(h, /dia-achou/g), 1, `${nome}: só o dia do pedido`);
    assert.match(h, /encontrado na pesquisa/);
  }
  const grade = K.htmlGrade(sem, 'abertos', 'davila');
  assert.match(grade, /<div class="cel dia-achou" data-dia="2026-11-05">/);
  assert.doesNotMatch(grade, /<div class="cel dia-achou" data-dia="2026-11-09">/);
  // sem termo, nada é destacado
  assert.doesNotMatch(K.htmlGrade(sem, 'abertos', ''), /achou/);
  assert.doesNotMatch(K.htmlFolha(sem, 'abertos'), /achou/);
});

test('célula cheia: pedido que casou com a pesquisa não fica escondido em "+N mais"', () => {
  const muitos = Array.from({ length: 12 }, (_, i) => ped(100 + i, { cliente: i === 11 ? 'Alvo Final' : 'Outro' }));
  const sem = K.montarGrade([dia('2026-11-05', muitos)], '2026-11', '');
  const normal = K.htmlGrade(sem, 'abertos', '');
  assert.match(normal, /\+4 mais/);
  assert.doesNotMatch(normal, /data-numero="111"/);
  const achando = K.htmlGrade(sem, 'abertos', 'alvo');
  assert.match(achando, /data-numero="111"/);
  assert.match(achando, /\+3 mais/);
});

test('pesquisa: campo, botões e resultado existem em calendario.html e o CSS só usa variáveis do tema (sem cor solta)', () => {
  const html = ler('calendario.html');
  for (const id of ['cal-busca', 'cal-busca-limpar', 'cal-busca-ant', 'cal-busca-prox', 'cal-busca-resultado']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<label for="cal-busca"/);
  assert.match(html, /id="cal-busca-resultado"[^>]*aria-live="polite"/);
  const css = ler('calendario.css');
  const bloco = css.slice(css.indexOf('/* pesquisa:'), css.indexOf('/* celular: lista'));
  assert.ok(bloco.length > 200);
  assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.match(bloco, /font-weight: 800/);   // o destaque do pedido não depende só de cor
  assert.match(ler('calendario.js'), /cal-busca/);
});

// ---------- pesquisa: rolagem automática até o resultado ----------
test('deveRolarBusca: só com termo novo (normalizado) e destaque visível; mesmo termo, vazio ou sem resultado não rola', () => {
  assert.equal(K.deveRolarBusca('', '23270', 1), true);
  assert.equal(K.deveRolarBusca('', 'Dávila', 3), true);
  assert.equal(K.deveRolarBusca('23270', '23270', 1), false, 'mesmo termo: trocar visão/mês/filtro não pula a tela');
  assert.equal(K.deveRolarBusca('davila', ' DÁVILA ', 2), false, 'mesmo termo depois de normalizar');
  assert.equal(K.deveRolarBusca('2327', '23270', 1), true, 'termo mudou');
  assert.equal(K.deveRolarBusca('', '23270', 0), false, 'sem resultado visível (ou só em visão escondida)');
  assert.equal(K.deveRolarBusca('23270', '', 5), false, 'termo vazio');
  assert.equal(K.deveRolarBusca('', '   ', 5), false);
});

test('comportamentoRolagem: suave, ou instantâneo com prefers-reduced-motion', () => {
  assert.equal(K.comportamentoRolagem(false), 'smooth');
  assert.equal(K.comportamentoRolagem(true), 'auto');
});

test('calendario.js: a digitação rola até o 1º destaque visível sem mover o foco; Anterior/Próximo/Enter rolam e focam', () => {
  const js = ler('calendario.js');
  assert.match(js, /scrollIntoView\(\{ block: 'center', behavior: K\.comportamentoRolagem\(reduzirMovimento\(\)\) \}\)/);
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(js, /\.filter\(el => el\.offsetParent !== null\)/, 'só elemento visível (a visão escondida não conta)');
  const rolar = js.slice(js.indexOf('function rolarSeTermoNovo'), js.indexOf('function redesenharBusca'));
  assert.match(rolar, /K\.deveRolarBusca\(estado\.termoRolado, estado\.busca, lista\.length\)/);
  assert.match(rolar, /achados\(\)/);
  assert.doesNotMatch(rolar, /\.focus\(/, 'a digitação não rouba o foco do campo');
  assert.match(js, /redesenharBusca\(true\); \}, 200\)/, 'só o fim da digitação (debounce) rola');
  assert.doesNotMatch(js.slice(js.indexOf('function desenhar'), js.indexOf('// Pesquisa:')), /rolarSeTermoNovo|scrollIntoView/, 'recarregar/trocar visão não rola');
  assert.match(js.slice(js.indexOf('function irParaAchado'), js.indexOf('function rolarSeTermoNovo')), /marcarAtual\(el\);\s*el\.focus\(\{ preventScroll: true \}\)/);
  assert.match(js, /function limparBusca\(\) \{[^}]*estado\.termoRolado = ''/);
});

test('calendario.css: destaque com scroll-margin (topo fixo não cobre o resultado) e versões ?v= subidas juntas', () => {
  assert.match(ler('calendario.css'), /\.etq\.achou, \.folha-linha\.achou \{ scroll-margin-block: calc\(var\(--cal-topo-tema\) \+ var\(--cal-fixo-altura\) \+ 16px\) 24px; \}/);
  const v = h => [...h.matchAll(/calendario(?:_comum)?\.(?:css|js)\?v=(\d+)/g)].map(m => m[1]);
  const mes = v(ler('calendario.html')), diaV = v(ler('calendario_dia.html'));
  assert.equal(new Set([...mes, ...diaV]).size, 1, 'mesma versão em calendario.html e calendario_dia.html');
});

// ---------- barra fixa (sticky) do topo e lupa da pesquisa ----------
test('alturaBarraFixa: px medido vira valor de variável CSS; medida inválida vira vazio (não sobrescreve a reserva)', () => {
  assert.equal(K.alturaBarraFixa(131.2), '132px');
  assert.equal(K.alturaBarraFixa(88), '88px');
  for (const ruim of [0, -5, NaN, undefined, null, Infinity]) assert.equal(K.alturaBarraFixa(ruim), '', String(ruim));
});

test('calendario.html: topo e pesquisa dentro de UMA barra #cal-fixo; a lupa tem o próprio .busca (não é o da linha inteira)', () => {
  const html = ler('calendario.html');
  const fixo = html.slice(html.indexOf('id="cal-fixo"'), html.indexOf('id="cal-grade"'));
  assert.match(html, /<div class="cal-fixo" id="cal-fixo">/);
  for (const trecho of ['class="cal-topo"', 'id="cal-titulo"', 'id="cal-resumo"', 'id="cal-situacao"', 'data-imprimir', 'role="search"', 'id="cal-busca"', 'id="cal-busca-limpar"', 'id="cal-busca-ant"', 'id="cal-busca-prox"', 'id="cal-busca-resultado"']) assert.ok(fixo.includes(trecho), trecho + ' dentro da barra fixa');
  assert.doesNotMatch(html, /class="busca cal-busca"/, 'a linha da pesquisa não pode ser .busca: a lupa iria para o canto, por cima do rótulo');
  assert.match(html, /<div class="busca cal-busca-campo">\s*<input type="search" id="cal-busca"/, 'a lupa fica dentro do campo');
  assert.doesNotMatch(html, /style=/, 'sem estilo inline');
});

test('calendario.css: barra sticky logo abaixo do cabeçalho do tema, opaca, abaixo de menu/cabeçalho; painel sem overflow:hidden puro', () => {
  const css = ler('calendario.css');
  const regra = css.match(/\.cal-fixo \{([^}]*)\}/)[1];
  assert.match(regra, /position: sticky/);
  assert.match(regra, /top: var\(--cal-topo-tema\)/);
  assert.match(regra, /background: var\(--white\)/, 'fundo opaco pela variável do tema');
  assert.match(regra, /border-bottom: 1px solid var\(--border-color\)/);
  const z = Number(regra.match(/z-index: (\d+)/)[1]);
  assert.ok(z > 0 && z < 30, 'abaixo do cabeçalho do tema (30)');
  assert.ok(z < Number(css.match(/#menu-ctx \{[^}]*z-index: (\d+)/)[1]), 'abaixo do menu do botão direito');
  assert.match(css, /:root \{ --cal-topo-tema: 24px; --cal-fixo-altura: \d+px; \}/);
  assert.match(ler('tema.css'), /height: 24px;/, 'cabeçalho do tema segue com 24px (o top da barra)');
  assert.match(css, /\.painel \{[^}]*overflow: clip;/, 'overflow:hidden no painel desligaria o sticky');
  assert.doesNotMatch(regra, /#[0-9a-f]{3,6}\b|rgb\(/i, 'sem cor solta');
});

test('calendario.css: lupa só dentro do campo e impressão sem barra fixa', () => {
  const css = ler('calendario.css');
  assert.match(css, /\.cal-busca-campo \{[^}]*flex: 1 1 260px/);
  assert.doesNotMatch(css, /\.cal-busca input \{/);
  assert.match(ler('tema.css'), /body \.busca::before[^{]*\{[^}]*position: absolute/, 'a lupa do tema é absoluta em relação ao .busca');
  const imp = css.slice(css.indexOf('@media print'));
  assert.match(imp, /\.cal-fixo \{ position: static;/);
  assert.match(imp, /\.cal-busca[^{]*\{ display: none !important; \}/, 'pesquisa não sai impressa');
});

test('calendario.js: mede a barra fixa (ResizeObserver, resize e antes de rolar) e grava --cal-fixo-altura', () => {
  const js = ler('calendario.js');
  assert.match(js, /\$\('cal-fixo'\)/);
  assert.match(js, /K\.alturaBarraFixa\(barraFixa\.getBoundingClientRect\(\)\.height\)/);
  assert.match(js, /style\.setProperty\('--cal-fixo-altura', v\)/);
  assert.match(js, /new win\.ResizeObserver\(medirBarraFixa\)\.observe\(barraFixa\)/);
  assert.match(js, /addEventListener\('resize', medirBarraFixa\)/);
  assert.match(js.slice(js.indexOf('function marcarAtual'), js.indexOf('function irParaAchado')), /medirBarraFixa\(\);\s*doc\.querySelectorAll/, 'mede antes de rolar');
});
