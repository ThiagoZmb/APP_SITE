'use strict';
// Olho dos resumos (olho_resumos.js + regras em tema.css): lógica pura e conferência do HTML das páginas.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Olho = require('../olho_resumos.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('o olho só aparece se algum resumo é permitido ao usuário', () => {
  assert.equal(Olho.algumResumoPermitido([], false), false);
  assert.equal(Olho.algumResumoPermitido(undefined, false), false);
  assert.equal(Olho.algumResumoPermitido([{ oculto: true, soGeral: false }], false), false, 'data-perm negado pelo layout.js');
  assert.equal(Olho.algumResumoPermitido([{ oculto: true }, { oculto: false }], false), true);
  assert.equal(Olho.algumResumoPermitido([{ oculto: false, soGeral: true }], true), false, 'modo atendimento esconde o so-geral');
  assert.equal(Olho.algumResumoPermitido([{ oculto: false, soGeral: true }], false), true);
  assert.equal(Olho.algumResumoPermitido([{ oculto: false, soGeral: true }, { oculto: false, soGeral: false }], true), true);
});

test('estado inicia escondido e a escolha não é lembrada (cada criação recomeça escondida)', () => {
  const a = Olho.criarEstado();
  assert.equal(a.visivel(), false);
  a.definir(true);
  assert.equal(a.visivel(), true);
  assert.equal(Olho.criarEstado().visivel(), false);
});

test('escondido: adiar anota a busca e devolve true; ao mostrar a busca roda uma vez só', () => {
  const e = Olho.criarEstado();
  let n = 0;
  const busca = () => { n++; };
  assert.equal(e.adiar(busca), true);
  assert.equal(e.adiar(busca), true, 'chamadas repetidas não duplicam');
  assert.equal(e.qtdPendentes(), 1);
  assert.equal(n, 0, 'nada roda enquanto escondido');
  const lista = e.definir(true);
  assert.deepEqual(lista, [busca]);
  assert.equal(e.qtdPendentes(), 0);
  assert.equal(e.definir(false).length, 0);
  assert.equal(e.definir(true).length, 0, 'esconder e mostrar de novo não refaz a busca sem pedido novo');
});

test('visível: adiar devolve false (a tela busca na hora, como antes)', () => {
  const e = Olho.criarEstado();
  e.definir(true);
  assert.equal(e.adiar(() => {}), false);
  assert.equal(e.qtdPendentes(), 0);
});

test('adiar ignora o que não é função', () => {
  const e = Olho.criarEstado();
  assert.equal(e.adiar(null), true);
  assert.equal(e.qtdPendentes(), 0);
});

test('tema.css: resumos escondidos por padrão e botão com alvo de toque', () => {
  const css = ler('tema.css');
  assert.match(css, /body:not\(\.resumos-on\) \[data-resumo\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.olho-resumos\[aria-pressed="true"\] \.olho-ico-off/);
  assert.match(css, /pointer:\s*coarse\)[^}]*min-height:\s*44px/);
  const bloco = css.slice(css.indexOf('OLHO DOS RESUMOS'));
  assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,6}\b/, 'só variáveis do tema, sem hexadecimal solto');
});

test('olho_resumos.js: sem inline, sem armazenamento e com o rótulo acessível', () => {
  const js = ler('olho_resumos.js');
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|document\.cookie/, 'decisão do dono: não persistir a escolha');
  assert.match(js, /aria-pressed/);
  assert.match(js, /Mostrar resumos/);
  assert.match(js, /Ocultar resumos/);
  assert.doesNotMatch(js, /\beval\(|new Function|\.innerHTML\s*=\s*[^'A-Z]*\+\s*\w+\s*\+\s*['"]<\//);
});

const PAGINAS = ['painel_inicial', 'inicio', 'financeiro', 'estoque', 'produtos', 'cliente_analise', 'gestao', 'clientes', 'funcionarios'];
for (const p of PAGINAS) {
  test(`${p}.html: carrega olho_resumos.js antes dos scripts, tem data-resumo e a CSP deixa o script próprio`, () => {
    const h = ler(`${p}.html`);
    assert.match(h, /<script src="olho_resumos\.js\?v=\d+"><\/script>/, 'sem defer: OlhoResumos existe antes do script da página');
    assert.ok(h.includes('data-resumo'));
    assert.ok(h.indexOf('olho_resumos.js') < h.indexOf('</head>'));
    const csp = (h.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    assert.match(csp, /script-src 'self'/);
    // nenhum resumo ficou visível por padrão por engano: todo data-resumo está num elemento de abertura (não é texto solto)
    for (const m of h.matchAll(/<[a-z0-9]+[^>]*\bdata-resumo\b[^>]*>/g)) assert.doesNotMatch(m[0], /\bstyle="[^"]*display\s*:\s*(block|grid|flex)/);
  });
}

test('páginas com busca separada dos resumos adiam a carga quando escondidos', () => {
  assert.match(ler('financeiro.html'), /OlhoResumos\.adiar\(carregarResumo\)/);
  assert.match(ler('financeiro.html'), /OlhoResumos\.adiar\(carregarGastos\)/, 'maiores gastos (ranking e rosca) são análise');
  assert.match(ler('clientes.html'), /OlhoResumos\.adiar\(carregarRankingClientes\)/);
  // cargas que dependem de filtro/dado: marcam "desatualizado" e só rodam com o olho aberto
  assert.match(ler('painel_inicial.html'), /OlhoResumos\.carga\(renderAnalises\)/);
  assert.match(ler('inicio.html'), /OlhoResumos\.carga\(carregarFinanceiroMes\)/);
  assert.match(ler('inicio.html'), /OlhoResumos\.carga\(carregarGrafico\)/);
  assert.match(ler('inicio.html'), /OlhoResumos\.carga\(renderCartoes\)/);
  assert.match(ler('estoque.html'), /OlhoResumos\.carga\(carregarTotais\)/);
  assert.match(ler('estoque.html'), /OlhoResumos\.carga\(\(\) => produtoMov/);
  assert.match(ler('cliente_analise.html'), /OlhoResumos\.carga\(renderAnalises\)/);
  assert.match(ler('gestao.js'), /olho\.carga\(carregarPainel\)/);
});

test('painel_inicial: com o olho fechado só filtros e lista; análises e indicadores só dentro de renderAnalises', () => {
  const h = ler('painel_inicial.html');
  // a carga da lista não chama indicadores, gráficos nem rankings
  const carga = h.slice(h.indexOf('async function carregarAgora'), h.indexOf('// Parte de trabalho'));
  assert.doesNotMatch(carga, /carregarIndicadores|renderMensal|renderRankings|renderInsights|\/painel\/indicadores/);
  const tudo = h.slice(h.indexOf('function renderTudo'), h.indexOf('// Analises (Operacao'));
  assert.match(tudo, /renderLista\(\)/);
  assert.match(tudo, /analises\.atualizar\(\)/);
  assert.doesNotMatch(tudo, /calcularResumo\(|renderMensal\(|calcularOperacao\(|carregarIndicadores\(|renderInsights\(|renderStatus\(|renderDiario\(|renderRankings\(/);
  const analises = h.slice(h.indexOf('async function renderAnalises'), h.indexOf('const analises = OlhoResumos.carga'));
  for (const fn of ['calcularResumo', 'renderMensal', 'calcularOperacao', 'carregarIndicadores', 'renderInsights', 'renderStatus', 'renderDiario', 'renderRankings']) assert.ok(analises.includes(fn), fn);
  // só a lista do tipo ativo é buscada com o olho fechado; o outro tipo vem com as análises
  assert.match(h, /OlhoResumos\.visivel\(\) \? \[OUTRO_TIPO\[tipoLista\]\] : \[\]/);
  assert.match(h, /garantirTipos\(\['Pedido', 'Orçamento'\]\)/);
  // todo bloco analítico (operação, resultado, evolução, leitura, situação, diário, rankings) leva data-resumo; a lista não
  const corpo = h.slice(h.indexOf('id="conteudo"'));
  for (const marca of ['id="operacao"', 'id="kpis-periodo"', 'class="larga', 'class="duas', 'id="ranking-produtos"', 'id="ranking-clientes"']) { const p = corpo.indexOf(marca); assert.ok(p > 0, marca); assert.match(corpo.slice(Math.max(0, p - 400), p + 120), /data-resumo/, marca); }
  assert.doesNotMatch(corpo.slice(corpo.indexOf('id="lista-titulo"') - 200, corpo.indexOf('id="orders-tbody"')), /data-resumo/, 'a lista é trabalho');
});

test('estoque: atalhos "No mínimo"/"Em falta" na área de trabalho, faixa de filtro ativo com limpar e totais separados dos filtros', () => {
  const h = ler('estoque.html');
  assert.match(h, /id="chips-alerta"[\s\S]*data-alerta="minimo"[\s\S]*data-alerta="falta"/);
  assert.match(h, /id="filtro-alerta"[^>]*hidden/);
  assert.match(h, /id="limpar-alerta"/);
  assert.ok(h.indexOf('id="chips-alerta"') > h.indexOf('class="workspace"'), 'os chips ficam na lista (área usável), não nos cartões');
  assert.match(h, /\/estoque\/resumo\?parte=filtros/);
  assert.match(h, /\/estoque\/resumo\?parte=totais/);
  assert.match(h, /data-aba="movimento" data-resumo data-perm="administrativo\.ver"/, 'gráfico de movimentação do item é análise');
  assert.match(ler('tema.css'), /\.filtro-ativo\s*\{/);
});

test('clientes e funcionários: resumo da ficha, ranking e custo total atrás do olho, botão onde se trabalha', () => {
  const c = ler('clientes.html');
  assert.match(c, /id="ranking-clientes" data-resumo data-perm="administrativo\.ver"/);
  assert.match(c, /class="cf-resumo" data-resumo/);
  assert.match(c, /data-pag="historico" data-resumo/);
  assert.equal([...c.matchAll(/data-olho-destino/g)].length, 2, 'um botão na lista e outro dentro da ficha');
  assert.match(c, /if \(nome === 'historico' && !OlhoResumos\.visivel\(\)\) OlhoResumos\.mostrar\(\)/, 'abrir o histórico de propósito liga o olho');
  const f = ler('funcionarios.html');
  assert.match(f, /id="custo-lista" data-resumo data-valor/);
  assert.match(f, /<script src="olho_resumos\.js\?v=\d+"><\/script>/);
});

test('gestão: painel só com o olho aberto; categorias do formulário seguem para quem edita', () => {
  const js = ler('gestao.js');
  const carregar = js.slice(js.indexOf('function carregar()'), js.indexOf('async function salvarMeta'));
  assert.match(carregar, /painelCarga\.atualizar\(\)/);
  assert.match(carregar, /if \(podeEditar\(\)\) return Promise\.all\(\[carregarOrcamento\(\)\]\)/);
  assert.doesNotMatch(carregar, /chamar\('\/gestao\/painel/);
  const h = ler('gestao.html');
  for (const t of ['Caixa do mês', 'Alertas', 'Orçamento por categoria']) assert.match(h, new RegExp('<section class="painel" data-resumo>\\s*<h2>' + t));
});

test('carga adiada: fechado só marca desatualizado, abrir carrega uma vez, reabrir reaproveita, mudança fechado recarrega ao abrir', () => {
  const e = Olho.criarEstado();
  let n = 0;
  const carga = Olho.criarCarga(e, () => { n++; });
  assert.equal(carga.desatualizado(), true);
  assert.equal(carga.atualizar(), false, 'fechado: adiada');
  assert.equal(carga.atualizar(), false);
  assert.equal(n, 0, 'nada carregado com o olho fechado, mesmo com vários filtros mudando');
  for (const fn of e.definir(true)) fn();
  assert.equal(n, 1, 'primeira abertura carrega uma vez');
  assert.equal(carga.desatualizado(), false);
  e.definir(false);
  assert.equal(e.definir(true).length, 0, 'reabrir sem mudança nenhuma não recarrega');
  assert.equal(n, 1);
  // aberto: mudar filtro recarrega na hora
  assert.equal(carga.atualizar(), true);
  assert.equal(n, 2);
  // fechado: mudar filtro marca desatualizado e recarrega só na próxima abertura
  e.definir(false);
  assert.equal(carga.atualizar(), false);
  assert.equal(carga.desatualizado(), true);
  assert.equal(n, 2);
  const lista = e.definir(true);
  assert.equal(lista.length, 1);
  lista[0]();
  assert.equal(n, 3);
  assert.equal(carga.desatualizado(), false);
});

test('carga adiada: duas cargas independentes não se misturam e promessa rejeitada não derruba o olho', async () => {
  const e = Olho.criarEstado();
  const log = [];
  const a = Olho.criarCarga(e, () => { log.push('a'); });
  const b = Olho.criarCarga(e, async () => { log.push('b'); throw new Error('falha de rede'); });
  a.atualizar(); b.atualizar();
  e.definir(true).forEach(fn => { try { const r = fn(); if (r && r.catch) r.catch(() => {}); } catch (x) { /* ok */ } });
  assert.deepEqual(log.sort(), ['a', 'b']);
  assert.equal(b.atualizar(), true, 'aberto: roda direto e a rejeição é absorvida');
  await new Promise(r => setImmediate(r));
});

test('olho_resumos.js: vários destinos (um botão por destino) e aviso de mudança', () => {
  const js = ler('olho_resumos.js');
  assert.match(js, /querySelectorAll\('\[data-olho-destino\]'\)/);
  assert.match(js, /aoMudar/);
});

test('permissões continuam nos mesmos elementos (olho não as substitui)', () => {
  const pi = ler('painel_inicial.html');
  assert.equal([...pi.matchAll(/data-resumo data-perm="indicadores\.ver"/g)].length, 3);
  assert.match(ler('estoque.html'), /data-perm="administrativo\.ver" data-resumo/);
  assert.match(ler('inicio.html'), /data-resumo data-perm="pedidos\.ver"/);
  assert.match(ler('inicio.html'), /data-resumo data-perm="financeiro\.ver valores\.ver"/);
});

test('tema.css e todas as páginas internas usam a mesma versão do tema', () => {
  const versoes = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, '..')).filter(x => x.endsWith('.html'))) {
    const m = ler(f).match(/tema\.css\?v=(\d+)/);
    if (m) versoes.add(m[1]);
  }
  assert.equal(versoes.size, 1, [...versoes].join(','));
});
