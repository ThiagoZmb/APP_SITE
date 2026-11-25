// Minha semana (tela): datas sem fuso, fila de gravação de cada linha, menu e cabeçalho de tarefas.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../tarefas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// API falsa: registra as chamadas; `falhar` derruba as próximas N; `segurar()` prende a próxima resposta
function apiFalsa() {
  const chamadas = [];
  const estado = { falhar: 0, status: undefined, preso: null };
  let id = 0;
  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, caminho, corpo]);
    if (estado.preso) { const p = estado.preso; estado.preso = null; await p; }
    if (estado.falhar > 0) { estado.falhar--; const e = new Error('Sem conexão. Tente de novo.'); e.status = estado.status; throw e; }
    if (metodo === 'POST') return { id: ++id, ...corpo, feita: false };
    return { ok: true };
  }
  const segurar = () => { let soltar; estado.preso = new Promise(r => { soltar = r; }); return soltar; };
  return { chamar, chamadas, estado, segurar };
}
const nova = (api, dados = {}) => T.criarLinha(api.chamar, { quadro: 'dia', data: '2026-11-23', texto: '', feita: false, ...dados });
const tique = () => new Promise(r => setImmediate(r));

test('datas: segunda da semana, somar dias e rótulo, sem voltar um dia', () => {
  assert.equal(T.segundaDe(new Date(2026, 10, 29, 23, 30)), '2026-11-23');   // domingo à noite
  assert.equal(T.segundaDe(new Date(2026, 10, 23, 0, 0)), '2026-11-23');     // segunda à meia-noite
  assert.equal(T.segundaDe(new Date(2027, 0, 1, 12, 0)), '2026-12-28');
  assert.equal(T.somarDias('2026-12-28', 6), '2027-01-03');
  assert.equal(T.somarDias('2027-01-04', -7), '2026-12-28');
  assert.equal(T.rotuloSemana('2026-11-23'), '23/11 a 29/11');
  assert.equal(T.rotuloSemana('2026-12-28'), '28/12 a 03/01');
  assert.doesNotMatch(ler('tarefas.js'), /toISOString/);
});

test('duas gravações seguidas fazem um POST só; texto diferente depois faz PUT no id devolvido', async () => {
  const api = apiFalsa();
  const l = nova(api);
  const soltar = api.segurar();   // conexão lenta: Enter e saída da linha chegam antes da resposta
  const a = l.salvarTexto('Ligar');
  const b = l.salvarTexto('Ligar');
  await tique();
  assert.equal(api.chamadas.length, 1);
  soltar();
  await Promise.all([a, b]);
  assert.deepEqual(api.chamadas, [['POST', '/minha_semana', { quadro: 'dia', data: '2026-11-23', texto: 'Ligar' }]]);
  assert.equal(l.dados.id, 1);
  await l.salvarTexto('  Ligar ');
  assert.equal(api.chamadas.length, 1, 'igual ao salvo (depois do trim) não chama');
  const c = l.salvarTexto('Ligar cedo');
  await c;
  assert.deepEqual(api.chamadas[1], ['PUT', '/minha_semana/1', { texto: 'Ligar cedo' }]);
});

test('texto diferente com o POST pendente: um POST e depois o PUT no id devolvido', async () => {
  const api = apiFalsa();
  const l = nova(api);
  await Promise.all([l.salvarTexto('a'), l.salvarTexto('b')]);
  assert.deepEqual(api.chamadas.map(c => [c[0], c[1], c[2].texto]), [['POST', '/minha_semana', 'a'], ['PUT', '/minha_semana/1', 'b']]);
});

test('marcar durante o POST pendente não se perde', async () => {
  const api = apiFalsa();
  const l = nova(api);
  const soltar = api.segurar();
  const a = l.salvarTexto('a');
  const b = l.marcar(true);
  assert.equal(l.pendente(), true);
  soltar();
  await Promise.all([a, b]);
  assert.deepEqual(api.chamadas.map(c => c[0]), ['POST', 'PUT']);
  assert.deepEqual(api.chamadas[1], ['PUT', '/minha_semana/1', { feita: true }]);
  assert.equal(l.dados.feita, true);
  assert.equal(l.pendente(), false);
  await l.marcar(false);
  assert.deepEqual(api.chamadas[2], ['PUT', '/minha_semana/1', { feita: false }]);
});

test('falha mantém o texto, marca erro e a nova tentativa salva', async () => {
  const api = apiFalsa();
  const l = nova(api);
  api.estado.falhar = 1;
  await l.salvarTexto('importante');
  assert.equal(l.erro, true);
  assert.equal(l.texto, 'importante');
  assert.equal(l.pendente(), true);
  assert.equal(l.dados.id, null);
  await l.salvarTexto('importante');
  assert.equal(l.erro, false);
  assert.equal(l.pendente(), false);
  assert.deepEqual(api.chamadas.map(c => c[0]), ['POST', 'POST']);
  assert.equal(l.dados.texto, 'importante');

  api.estado.falhar = 1;
  await l.marcar(true);
  assert.equal(l.erro, true);
  await l.salvarTexto('importante');   // Enter de novo: a marca que falhou vai junto
  assert.deepEqual(api.chamadas.at(-1), ['PUT', '/minha_semana/1', { feita: true }]);
  assert.equal(l.erro, false);
});

test('apagar o texto exclui; linha nova vazia não chama nada', async () => {
  const api = apiFalsa();
  const vazia = nova(api);
  await vazia.salvarTexto('');
  await vazia.salvarTexto('   ');
  assert.equal(api.chamadas.length, 0);
  assert.equal(vazia.pendente(), false);

  const l = nova(api, { id: 9, texto: 'velha', feita: true });
  await l.salvarTexto('velha');
  assert.equal(api.chamadas.length, 0);
  await l.salvarTexto('');
  assert.deepEqual(api.chamadas, [['DELETE', '/minha_semana/9', undefined]]);
  assert.deepEqual([l.dados.id, l.dados.texto, l.dados.feita, l.feita], [null, '', false, false]);
  await l.salvarTexto('outra');
  assert.equal(api.chamadas[1][0], 'POST');
});

test('linha excluída em outro aparelho: excluir de novo vale; editar recria sem perder o texto', async () => {
  const api = apiFalsa();
  const a = nova(api, { id: 9, texto: 'x' });
  api.estado.falhar = 1; api.estado.status = 404;
  await a.salvarTexto('');
  assert.equal(a.erro, false);
  const b = nova(api, { id: 10, texto: 'y' });
  api.estado.falhar = 1;
  await b.salvarTexto('y mudado');
  assert.deepEqual(api.chamadas.slice(1).map(c => c[0]), ['PUT', 'POST']);
  assert.equal(b.erro, false);
  assert.equal(b.dados.texto, 'y mudado');
});

test('texto com <, aspas e emoji vai e volta igual; nada de innerHTML na tela', async () => {
  const api = apiFalsa();
  const l = nova(api);
  await l.salvarTexto('<b> "x" \u{1F600}');
  assert.equal(api.chamadas[0][2].texto, '<b> "x" \u{1F600}');
  assert.doesNotMatch(ler('tarefas.js'), /innerHTML|insertAdjacentHTML|outerHTML/);
});

// layout.js real num contexto simulado, com um <nav> que guarda o HTML do menu desenhado
function montarMenu({ permissoes, sessao = {} }) {
  const guarda = inicial => { const m = new Map(Object.entries(inicial)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const local = guarda({ auth: JSON.stringify({ token: 't', user: { nome: 'V' }, exp: Date.now() + 1e6, acesso: { permissoes } }) });
  const session = guarda(sessao);
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {}, prepend() {}, before() {}, querySelector: () => null, querySelectorAll: () => [], style: {} });
  const nav = { ...el(), innerHTML: '', querySelector: () => el() };
  const container = { ...el(), querySelector: sel => (/nav|sidebar/.test(sel) ? nav : null) };
  const document = { readyState: 'complete', body: el(), head: el(), documentElement: el(), querySelector: s => (s === '.container' ? container : null), querySelectorAll: () => [], getElementById: () => null, createElement: el, addEventListener() {} };
  const window = { document, localStorage: local, sessionStorage: session, location: { pathname: '/estoque.html', href: '' }, fetch: () => new Promise(() => {}), addEventListener() {}, matchMedia: () => ({ matches: false }) };
  window.window = window;
  vm.runInNewContext(ler('layout.js'), { window, document, localStorage: local, sessionStorage: session, location: window.location, fetch: window.fetch, MutationObserver: class { observe() {} }, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Intl, Date, JSON, Promise, CustomEvent: class {} });
  const item = /<a class="menu-item[^"]*" href="tarefas\.html"[^>]*>/.exec(nav.innerHTML);
  return { window, html: nav.innerHTML, item: item && item[0] };
}

test('layout: Minha semana aparece para quem não tem permissão nenhuma e some no modo atendimento', () => {
  const semNada = montarMenu({ permissoes: [] });
  assert.ok(semNada.item, 'item no menu');
  assert.doesNotMatch(semNada.item, /hidden/);
  assert.match(semNada.html, /<div class="sb-secao">Pessoal<\/div>/);
  assert.ok(semNada.html.indexOf('>Pessoal<') < semNada.html.indexOf('>Comercial<'));
  assert.match(semNada.html, /href="tarefas\.html"><svg[^]*?<\/svg><span>Minha semana<\/span>/);
  assert.equal(semNada.window.Acesso.podePagina('tarefas.html'), true);
  assert.equal(semNada.window.Acesso.primeiraPagina(), null, 'não vira a primeira página de ninguém');
  assert.ok(!('tarefas.html' in semNada.window.ACESSO_PAGINAS));

  const atendendo = montarMenu({ permissoes: ['atendimento.modo'] });
  assert.match(atendendo.item, / hidden/);
  assert.match(atendendo.html, /<div class="sb-secao" hidden>Pessoal<\/div>/);
  assert.equal(atendendo.window.Acesso.podePagina('tarefas.html'), false);

  const desligado = montarMenu({ permissoes: ['atendimento.modo'], sessao: { atendimento: '0' } });
  assert.doesNotMatch(desligado.item, / hidden/);
});

test('tarefas.html carrega tema.css por último entre as folhas, layout.js e entregas_comum.js, e a CSP não tem cdn.jsdelivr', () => {
  const h = ler('tarefas.html');
  const folhas = [...h.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  assert.equal(folhas.at(-1), /href="(tema\.css\?v=\d+)"/.exec(ler('tintas.html'))[1]);
  assert.ok(h.lastIndexOf('<style') < h.indexOf('href="tema.css'));
  const scripts = [...h.matchAll(/<script src="([^"?]+)\?v=\d+" defer><\/script>/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['layout.js', 'entregas_comum.js', 'tarefas.js']);
  assert.equal(/layout\.js\?v=\d+/.exec(h)[0], /layout\.js\?v=\d+/.exec(ler('tintas.html'))[0]);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
  const base = /Content-Security-Policy" content="([^"]+)"/.exec(ler('tintas.html'))[1];
  assert.equal(csp, base.replace(' https://cdn.jsdelivr.net', ''));
  assert.doesNotMatch(csp, /cdn\.jsdelivr/);
  assert.doesNotMatch(h, / on\w+="|<script(?![^>]*src=)/);
  for (const id of new Set([...ler('tarefas.js').matchAll(/\$\('([a-z0-9-]+)'\)/g)].map(m => m[1]))) assert.ok(h.includes(`id="${id}"`), id);
});

// ---------- rascunho: nada digitado se perde com sessão expirada, aba descartada ou resposta perdida ----------
const C = require('../entregas_comum.js');

function armazem() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const rascunhosDe = (st, id = 7) => T.criarRascunhos(() => st, id);
const comRascunho = (api, r, chave = 'k1', dados = {}) => T.criarLinha(api.chamar, { quadro: 'dia', data: '2026-11-23', texto: '', feita: false, ...dados }, { rascunhos: r, chave });
const jwtFalso = id => 'x.' + Buffer.from(JSON.stringify({ id, nome: 'João' })).toString('base64url') + '.y';
const lista = r => Object.values(r.ler());

test('rascunho: chave por usuário (id do login); o de outro nunca é lido; armazenamento que falha não quebra', async () => {
  assert.equal(T.idDoToken(jwtFalso(7)), 7);
  for (const t of ['', 'abc', null, undefined, 'a.%%%.c']) assert.equal(T.idDoToken(t), null, String(t));
  const st = armazem();
  rascunhosDe(st, 7).gravar('k', { id: null, quadro: 'notas', data: null, texto: 'meu', feita: false });
  assert.deepEqual(rascunhosDe(st, 8).ler(), {});
  assert.equal(lista(rascunhosDe(st, 7))[0].texto, 'meu');
  assert.deepEqual([...st.m.keys()], ['minha_semana_rascunho:7']);
  rascunhosDe(st, 7).remover('k');
  assert.equal(st.m.size, 0, 'sem rascunho não sobra chave no navegador');
  st.setItem('minha_semana_rascunho:7', '{quebrado');
  assert.deepEqual(rascunhosDe(st).ler(), {});
  const semId = rascunhosDe(armazem(), null);
  semId.gravar('k', { texto: 'x' });
  assert.deepEqual(semId.ler(), {});
  const quebrado = T.criarRascunhos(() => { throw new Error('bloqueado'); }, 7);
  assert.deepEqual(quebrado.ler(), {});
  const api = apiFalsa();
  const l = comRascunho(api, quebrado);
  l.anotar('a');
  await l.salvarTexto('a');
  assert.equal(l.erro, false);
});

test('rascunho: nasce ao digitar e marcar, só some quando o servidor confirma', async () => {
  const api = apiFalsa(), r = rascunhosDe(armazem());
  const l = comRascunho(api, r);
  l.anotar('Lig');
  assert.deepEqual(lista(r), [{ id: null, quadro: 'dia', data: '2026-11-23', texto: 'Lig', feita: false }]);
  assert.equal(api.chamadas.length, 0, 'digitar não chama o servidor');
  api.estado.falhar = 1; api.estado.status = 500;
  await l.salvarTexto('Ligar');
  assert.deepEqual(lista(r), [{ id: null, quadro: 'dia', data: '2026-11-23', texto: 'Ligar', feita: false }]);
  await l.salvarTexto('Ligar');
  assert.deepEqual(r.ler(), {});
  l.anotar('Ligar', true);
  assert.deepEqual([lista(r)[0].id, lista(r)[0].feita], [1, true]);
  await l.marcar(true);
  assert.deepEqual(r.ler(), {});
  api.estado.falhar = 1;
  await l.salvarTexto('');
  assert.deepEqual([lista(r)[0].id, lista(r)[0].texto], [1, ''], 'exclusão que falhou fica anotada');
  await l.salvarTexto('');
  assert.deepEqual(r.ler(), {});
});

test('M1: sessão expirada (401) apaga o login e redireciona, mas o texto fica no rascunho', async () => {
  const st = armazem();
  st.setItem('auth', JSON.stringify({ token: jwtFalso(7), user: { nome: 'V' }, exp: Date.now() + 1e6 }));
  const win = { localStorage: st, location: { href: '' }, fetch: async () => ({ status: 401, ok: false, json: async () => ({}) }) };
  const r = rascunhosDe(st);
  const l = T.criarLinha(C.criarApi(win).chamar, { quadro: 'tarefas', data: null, texto: '', feita: false }, { rascunhos: r, chave: 'k' });
  await l.salvarTexto('não perder');
  assert.equal(st.getItem('auth'), null);
  assert.equal(win.location.href, C.LOGIN_URL);
  assert.equal(lista(r)[0].texto, 'não perder');
});

test('restaurar: cada rascunho volta ao quadro e à semana certos, é salvo e some', async () => {
  const entradas = {
    a: { id: null, quadro: 'dia', data: '2026-11-24', texto: 'terça', feita: true },
    b: { id: null, quadro: 'dia', data: '2026-12-01', texto: 'outra semana', feita: false },
    c: { id: null, quadro: 'notas', data: null, texto: 'nota', feita: false },
    d: { id: 5, quadro: 'tarefas', data: null, texto: 'editada', feita: false }
  };
  const casados = T.casarRascunhos(entradas, [{ id: 5, quadro: 'tarefas', data: null, texto: 'antiga', feita: false }], '2026-11-23');
  assert.deepEqual(casados.map(c => [c.chave, c.base && c.base.id, c.descartar]), [['a', null, false], ['c', null, false], ['d', 5, false]]);
  const api = apiFalsa(), r = rascunhosDe(armazem());
  for (const c of casados) r.gravar(c.chave, c.entrada);
  for (const c of casados) {
    const x = T.retomar(api.chamar, c, r);
    assert.equal(x.linha.pendente(), true, 'volta marcado como não salvo');
    await x.pronto;
    assert.equal(x.linha.erro, false);
  }
  assert.deepEqual(api.chamadas, [
    ['POST', '/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'terça' }],
    ['PUT', '/minha_semana/1', { feita: true }],
    ['POST', '/minha_semana', { quadro: 'notas', data: null, texto: 'nota' }],
    ['PUT', '/minha_semana/5', { texto: 'editada' }]
  ]);
  assert.deepEqual(r.ler(), {});
});

test('POST chegou ao servidor e a página saiu antes da resposta: adota a linha, sem duplicar', async () => {
  const api = apiFalsa(), r = rascunhosDe(armazem());
  const l = comRascunho(api, r);
  api.segurar();   // a resposta nunca chega
  l.salvarTexto('Lig');
  await tique();
  l.anotar('Ligar cedo', true);   // continuou digitando e marcou
  assert.deepEqual([lista(r)[0].enviado, lista(r)[0].texto, lista(r)[0].feita], ['Lig', 'Ligar cedo', true]);
  const [c] = T.casarRascunhos(r.ler(), [{ id: 40, quadro: 'dia', data: '2026-11-23', texto: 'Lig', feita: false }], '2026-11-23');
  assert.equal(c.base.id, 40);
  const depois = apiFalsa();
  await T.retomar(depois.chamar, c, r).pronto;
  assert.deepEqual(depois.chamadas, [['PUT', '/minha_semana/40', { texto: 'Ligar cedo' }], ['PUT', '/minha_semana/40', { feita: true }]]);
  assert.deepEqual(r.ler(), {});
});

test('adoção: cada linha é adotada uma vez; outro quadro/data não vale; nunca enviado vira linha nova', () => {
  const linha = { id: 40, quadro: 'dia', data: '2026-11-23', texto: 'x', feita: false };
  const e = (extra = {}) => ({ id: null, quadro: 'dia', data: '2026-11-23', texto: 'x', feita: false, enviado: 'x', ...extra });
  const bases = entradas => T.casarRascunhos(entradas, [linha], '2026-11-23').map(c => c.base && c.base.id);
  assert.deepEqual(bases({ a: e(), b: e() }), [40, null]);
  assert.deepEqual(bases({ a: e({ data: '2026-11-24' }), b: e({ quadro: 'notas', data: null }) }), [null, null]);
  assert.deepEqual(bases({ a: e({ enviado: undefined }) }), [null], 'sem POST enviado não há o que adotar: duas tarefas iguais são legítimas');
  assert.deepEqual(bases({ a: e(), b: e({ id: 40, enviado: undefined }) }), [null, 40], 'quem já tem o id fica com a linha');
  // apagado antes da resposta: adota e exclui; exclusão já feita no servidor: descarta
  assert.deepEqual(T.casarRascunhos({ a: e({ texto: '' }) }, [linha], '2026-11-23').map(c => [c.base.id, c.descartar]), [[40, false]]);
  assert.deepEqual(T.casarRascunhos({ a: { id: 99, quadro: 'notas', data: null, texto: '', feita: false } }, [], '2026-11-23').map(c => c.descartar), [true]);
});

test('rascunho de outra semana é salvo ao abrir; se falhar, continua guardado para aquela semana', async () => {
  const r = rascunhosDe(armazem());
  r.gravar('a', { id: null, quadro: 'dia', data: '2026-11-18', texto: 'semana passada', feita: false });
  r.gravar('n', { id: null, quadro: 'notas', data: null, texto: 'fica para o desenho', feita: false });
  let herdados = r.ler();
  const estado = { falhar: true, chamadas: [] };
  const chamar = async (caminho, { metodo = 'GET', corpo } = {}) => {
    estado.chamadas.push([metodo, caminho]);
    if (metodo === 'GET') return { linhas: [] };
    if (estado.falhar) throw new Error('Sem conexão.');
    return { id: 3, ...corpo, feita: false };
  };
  assert.deepEqual(await T.recuperarFora(chamar, herdados, r, '2026-11-23'), ['2026-11-16']);
  assert.deepEqual(Object.keys(herdados), ['a', 'n']);
  assert.equal(r.ler().a.texto, 'semana passada');
  estado.falhar = false; estado.chamadas.length = 0;
  herdados = r.ler();
  assert.deepEqual(await T.recuperarFora(chamar, herdados, r, '2026-11-23'), []);
  assert.deepEqual(estado.chamadas, [['GET', '/minha_semana?inicio=2026-11-16'], ['POST', '/minha_semana']]);
  assert.deepEqual(Object.keys(herdados), ['n']);
  assert.deepEqual(Object.keys(r.ler()), ['n']);
});

test('M2: aba escondida ou fechada salva o que falta pela mesma fila, sem POST repetido', async () => {
  const ouvintes = {};
  const doc = { visibilityState: 'visible', addEventListener: (n, f) => { ouvintes[n] = f; } };
  const win = { document: doc, addEventListener: (n, f) => { ouvintes[n] = f; } };
  const api = apiFalsa();
  const l = nova(api);
  const feitas = [];
  T.ligarSaida(win, () => feitas.push(l.salvarTexto('sem blur')));
  ouvintes.visibilitychange();
  assert.equal(feitas.length, 0, 'voltar a aparecer não salva');
  const soltar = api.segurar();
  doc.visibilityState = 'hidden';
  ouvintes.visibilitychange();
  ouvintes.pagehide();
  await tique();
  soltar();
  await Promise.all(feitas);
  assert.equal(feitas.length, 2);
  assert.deepEqual(api.chamadas.map(c => c[0]), ['POST']);
  assert.match(ler('tarefas.js'), /ligarSaida\(win, /);
});

// ---------- grade horizontal (como a semana do Google Agenda) e texto que quebra linha ----------
test('grade: 7 colunas Segunda -> Domingo na tela larga, Tarefas e Notas lado a lado embaixo; nada de coluna a coluna', () => {
  const h = ler('tarefas.html'), js = ler('tarefas.js');
  assert.doesNotMatch(h, /grid-template-areas|grid-area:|grid-auto-flow: *column|column-count/, 'a ordem na tela é a ordem do DOM (Tab segue Segunda -> Domingo)');
  assert.match(js, /\['seg', 'Segunda'\], \['ter', 'Terça'\], \['qua', 'Quarta'\], \['qui', 'Quinta'\], \['sex', 'Sexta'\], \['sab', 'Sábado'\], \['dom', 'Domingo'\]/);
  assert.ok(js.indexOf("nome: 'Tarefas'") < js.indexOf("nome: 'Notas'"));
  assert.match(h, /\.semana-area \{ container-type: inline-size; \}/);
  // intermediário: 4 colunas, Tarefas e Notas com metade cada
  assert.match(h, /\.semana \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(h, /\.q-tar, \.q-not \{ grid-column: span 2; \}/);
  // largo: 14 trilhas = 7 dias de 2 e Tarefas/Notas de 7
  assert.match(h, /@container \(min-width: 960px\) \{[^@]*repeat\(14, minmax\(0, 1fr\)\)[^@]*\.quadro \{ grid-column: span 2;[^@]*\.q-tar, \.q-not \{ grid-column: span 7; \}/);
  assert.match(h, /@media \(max-width: 700px\) \{\s*\.semana \{ display: flex; flex-direction: column; \}/);
});

test('linha: textarea que cresce, maxlength 300, Enter sem quebra (e sem atrapalhar o IME), texto só por value', () => {
  const h = ler('tarefas.html'), js = ler('tarefas.js');
  assert.match(js, /criar\('textarea'\)/);
  assert.match(js, /input\.rows = 1/);
  assert.match(js, /input\.maxLength = 300/);
  assert.match(js, /ev\.key !== 'Enter' \|\| ev\.isComposing/);
  assert.match(js, /insertLineBreak/);   // teclado de celular que não manda a tecla Enter
  assert.match(js, /scrollHeight/);
  assert.match(js, /addEventListener\('resize'/);
  assert.doesNotMatch(js, /input\.textContent|input\.innerText/);
  assert.match(h, /\.linha textarea \{[^}]*resize: none;[^}]*overflow: hidden;[^}]*overflow-wrap: anywhere/);
  assert.match(h, /tarefas\.js\?v=202611291200/);
});

test('semQuebra: texto colado com várias linhas vira uma linha só, mantendo os espaços digitados', () => {
  assert.equal(T.semQuebra('a\r\nb\nc d '), 'a b c d ');
});
