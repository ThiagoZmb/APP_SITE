// Semana compartilhada (tela): conflito (409), linha apagada (404), atualização automática, rascunho próprio, menu e permissão.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('../tarefas_admin.js');
const T = require('../tarefas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// servidor falso com versão por linha, como rotas/semana_admin.js
function servidor() {
  const linhas = [];
  const chamadas = [];
  const estado = { preso: null, falhar: 0 };
  let id = 0;
  const erro = (status, dados) => { const e = new Error(dados.error); e.status = status; e.dados = dados; return e; };
  const como = nome => async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, caminho, corpo]);
    if (estado.preso) { const p = estado.preso; estado.preso = null; await p; }
    if (estado.falhar > 0) { estado.falhar--; throw new Error('Sem conexão. Tente de novo.'); }
    if (metodo === 'GET') return { linhas: linhas.map(l => ({ ...l })) };
    if (metodo === 'POST') {
      const l = { id: ++id, ...corpo, feita: false, alarme: null, versao: 1, criadaPor: nome, feitaPor: null };
      linhas.push(l);
      return { ...l };
    }
    const l = linhas.find(x => caminho === '/semana_admin/' + x.id);
    if (!l) throw erro(404, { error: 'Tarefa não encontrada.' });
    if (l.versao !== corpo.versao) throw erro(409, { error: 'Alterada.', atual: { ...l } });
    if (metodo === 'DELETE') { linhas.splice(linhas.indexOf(l), 1); return { ok: true }; }
    const { versao, ...mudanca } = corpo;
    Object.assign(l, mudanca, { versao: versao + 1 });
    if (mudanca.feita !== undefined) l.feitaPor = mudanca.feita ? nome : null;
    return { ...l };
  };
  const segurar = () => { let soltar; estado.preso = new Promise(r => { soltar = r; }); return soltar; };
  return { linhas, chamadas, estado, como, segurar };
}
function armazem() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const rascunhosDe = (st, id = 7) => A.criarRascunhos(() => st, id);
const nova = (chamar, dados = {}, opcoes) => A.criarLinha(chamar, { quadro: 'tarefas', data: null, texto: '', feita: false, ...dados }, opcoes);
// uma linha que as duas pessoas têm na tela
async function duasPessoas(opcoes) {
  const s = servidor();
  const ana = nova(s.como('Ana'));
  await ana.salvarTexto('original');
  const joao = nova(s.como('João'), s.linhas[0], opcoes);
  await ana.salvarTexto('da Ana');
  return { s, ana, joao };
}

test('linha: cria, muda e marca mandando a versão que está vendo; autoria discreta', async () => {
  const s = servidor();
  const l = nova(s.como('Ana'));
  await l.salvarTexto('a');
  await l.salvarTexto('b');
  await l.marcar(true);
  await l.salvarTexto('');
  assert.deepEqual(s.chamadas, [
    ['POST', '/semana_admin', { quadro: 'tarefas', data: null, texto: 'a' }],
    ['PUT', '/semana_admin/1', { texto: 'b', versao: 1 }],
    ['PUT', '/semana_admin/1', { feita: true, versao: 2 }],
    ['DELETE', '/semana_admin/1', { versao: 3 }]
  ]);
  assert.equal(A.autoria({ id: null, criadaPor: 'Ana' }), '');
  assert.equal(A.autoria({ id: 1, criadaPor: 'Ana', feita: false, feitaPor: null }), 'Ana');
  assert.equal(A.autoria({ id: 1, criadaPor: 'Ana', feita: true, feitaPor: 'João' }), 'Ana · feita por João');
});

test('409: o texto digitado fica, nada é sobrescrito e o atual é mostrado; Enter de novo não grava por cima', async () => {
  const r = rascunhosDe(armazem());
  const { s, joao } = await duasPessoas({ rascunhos: r, chave: 'k' });
  await joao.salvarTexto('do João');
  assert.equal(joao.erro, true);
  assert.equal(joao.conflito.texto, 'da Ana');
  assert.equal(joao.texto, 'do João');
  assert.equal(joao.pendente(), true);
  assert.equal(r.ler().k.texto, 'do João');
  const n = s.chamadas.length;
  await joao.salvarTexto('do João, mais');
  assert.equal(s.chamadas.length, n, 'enquanto a pessoa não decide, nada é enviado');
  assert.equal(s.linhas[0].texto, 'da Ana');
  assert.equal(r.ler().k.texto, 'do João, mais');
  await joao.manterMeu();
  assert.deepEqual(s.chamadas.at(-1), ['PUT', '/semana_admin/1', { texto: 'do João, mais', versao: 2 }]);
  assert.deepEqual([joao.conflito, joao.erro, joao.pendente()], [null, false, false]);
  assert.deepEqual(r.ler(), {});
});

test('409: "Usar o atual" descarta o meu; "Manter o meu" não desfaz a marca que só a outra pessoa mudou', async () => {
  const a = await duasPessoas();
  await a.joao.salvarTexto('do João');
  const n = a.s.chamadas.length;
  await a.joao.usarAtual();
  assert.deepEqual([a.joao.texto, a.joao.dados.versao, a.joao.conflito, a.joao.erro, a.joao.pendente()], ['da Ana', 2, null, false, false]);
  assert.equal(a.s.chamadas.length, n);

  const b = await duasPessoas();
  await b.ana.marcar(true);
  await b.joao.salvarTexto('do João');
  await b.joao.manterMeu();
  assert.deepEqual([b.s.linhas[0].texto, b.s.linhas[0].feita, b.joao.feita], ['do João', true, true]);
});

test('409 sem divergência (resposta perdida ou os dois escreveram o mesmo): adota sem perguntar', async () => {
  const { s, joao } = await duasPessoas();
  await joao.salvarTexto('da Ana');
  assert.deepEqual([joao.conflito, joao.erro, joao.dados.versao, joao.pendente()], [null, false, 2, false]);
  assert.equal(s.linhas[0].versao, 2);
});

test('409 ao apagar: não apaga o texto que a pessoa não viu', async () => {
  const { s, joao } = await duasPessoas();
  await joao.salvarTexto('');
  assert.equal(joao.conflito.texto, 'da Ana');
  assert.equal(s.linhas.length, 1);
  await joao.manterMeu();
  assert.equal(s.linhas.length, 0);
});

test('404: avisa que foi apagada e NÃO recria sozinho; a pessoa recria ou descarta', async () => {
  for (const decisao of ['recriar', 'descartar']) {
    const r = rascunhosDe(armazem());
    const { s, ana, joao } = await duasPessoas({ rascunhos: r, chave: 'k' });
    await ana.salvarTexto('');
    await joao.salvarTexto('do João');
    assert.deepEqual([joao.apagada, joao.erro, joao.pendente()], [true, true, true]);
    await joao.salvarTexto('do João');
    assert.equal(s.chamadas.filter(c => c[0] === 'POST').length, 1, 'só a criação original');
    assert.equal(r.ler().k.texto, 'do João');
    await joao[decisao]();
    assert.deepEqual([joao.apagada, joao.erro, joao.pendente()], [false, false, false]);
    assert.equal(s.linhas.length, decisao === 'recriar' ? 1 : 0);
    if (decisao === 'recriar') assert.equal(s.linhas[0].texto, 'do João');
    else assert.equal(joao.texto, '');
    assert.deepEqual(r.ler(), {});
  }
});

test('rascunho próprio, separado da página pessoal', () => {
  const st = armazem();
  rascunhosDe(st, 7).gravar('k', { id: null, quadro: 'notas', data: null, texto: 'compartilhado', feita: false });
  assert.deepEqual([...st.m.keys()], ['semana_admin_rascunho:7']);
  assert.deepEqual(T.criarRascunhos(() => st, 7).ler(), {}, 'a página pessoal não vê: nunca vira linha pessoal');
  const fonte = ler('tarefas_admin.js');
  assert.doesNotMatch(fonte, /['`]\/minha_semana|innerHTML|insertAdjacentHTML|outerHTML|toISOString/);
  assert.doesNotMatch(ler('tarefas.js'), /semana_admin/);
});

test('rascunho restaurado depois que outra pessoa mudou a linha: vira conflito, não grava por cima', async () => {
  const st = armazem();
  const { s, joao } = await duasPessoas({ rascunhos: rascunhosDe(st), chave: 'k' });
  s.estado.falhar = 1;
  await joao.salvarTexto('do João, sem rede');   // fica no rascunho com a versão que ele via (1)
  const entradas = rascunhosDe(st).ler();
  assert.equal(entradas.k.versao, 1);
  const [c] = A.casarRascunhos(entradas, s.linhas.map(l => ({ ...l })), '2026-11-23', 'João');
  const x = A.retomar(s.como('João'), c, rascunhosDe(st));
  await x.pronto;
  assert.equal(x.linha.conflito.texto, 'da Ana');
  assert.equal(x.linha.texto, 'do João, sem rede');
  assert.equal(s.linhas[0].texto, 'da Ana');
});

test('rascunho: POST sem resposta só adota linha criada por mim', () => {
  const entrada = { id: null, quadro: 'notas', data: null, texto: 'x', feita: false, enviado: 'x' };
  const linha = criadaPor => ({ id: 4, quadro: 'notas', data: null, texto: 'x', feita: false, versao: 1, criadaPor });
  assert.equal(A.casarRascunhos({ a: entrada }, [linha('Ana')], '2026-11-23', 'João')[0].base, null);
  assert.equal(A.casarRascunhos({ a: entrada }, [linha('João')], '2026-11-23', 'João')[0].base.id, 4);
});

// item de tela falso para o plano de atualização
const item = (linha, livre = true) => ({ linha, livre: () => livre });
const doServidor = (id, extra = {}) => ({ id, quadro: 'tarefas', data: null, texto: 't' + id, feita: false, versao: 1, criadaPor: 'Ana', feitaPor: null, ...extra });

test('atualização automática: só mexe em linha livre; foco e pendência ficam como estão', async () => {
  const chamar = servidor().como('Ana');
  const livre = nova(chamar, doServidor(1));
  const focada = nova(chamar, doServidor(2));
  const apagadaLa = nova(chamar, doServidor(3));
  const apagadaFocada = nova(chamar, doServidor(4));
  const vazia = nova(chamar);
  const itens = [item(livre), item(focada, false), item(apagadaLa), item(apagadaFocada, false), item(vazia)];
  const novidades = [doServidor(1, { texto: 'novo', versao: 2 }), doServidor(2, { texto: 'novo', versao: 2 }), doServidor(9), doServidor(8)];
  const plano = A.planejarAtualizacao(itens, novidades, new Set([1, 2, 3, 4]), new Set([8]));
  assert.deepEqual(plano.atualizar.map(([i, l]) => [i.linha.dados.id, l.texto]), [[1, 'novo']]);
  assert.deepEqual(plano.remover.map(i => i.linha.dados.id), [3]);
  assert.deepEqual(plano.incluir.map(l => l.id), [9], 'a 8 foi apagada aqui: resposta antiga não a ressuscita');
  livre.adotar(plano.atualizar[0][1]);
  assert.deepEqual([livre.texto, livre.dados.versao, livre.pendente()], ['novo', 2, false]);
});

test('atualização automática: resposta antiga não desfaz o que foi salvo nem apaga linha recém-criada', async () => {
  const s = servidor();
  const l = nova(s.como('Ana'));
  const conhecidos = new Set();   // o pedido saiu antes de a linha existir
  await l.salvarTexto('a');
  let plano = A.planejarAtualizacao([item(l)], [], conhecidos, new Set());
  assert.deepEqual([plano.remover, plano.incluir, plano.atualizar], [[], [], []]);
  await l.salvarTexto('b');
  plano = A.planejarAtualizacao([item(l)], [doServidor(1, { texto: 'a', versao: 1 })], new Set([1]), new Set());
  assert.deepEqual(plano.atualizar, [], 'versão menor que a minha é velha');
});

test('atualização automática: com linha nova ainda em envio, não duplica', async () => {
  const s = servidor();
  const l = nova(s.como('Ana'));
  const soltar = s.segurar();
  const p = l.salvarTexto('a');
  await new Promise(r => setImmediate(r));
  assert.equal(A.planejarAtualizacao([item(l)], [doServidor(1, { texto: 'a' })], new Set(), new Set()), null);
  soltar();
  await p;
  const perdido = nova(s.como('Ana'));
  s.estado.falhar = 1;
  await perdido.salvarTexto('b');   // pode ter chegado: não aparece uma segunda vez ao lado
  assert.deepEqual(A.planejarAtualizacao([item(perdido, false)], [doServidor(5, { texto: 'b' })], new Set(), new Set()).incluir, []);
});

test('403 e atualização: a tela para, limpa e não usa a rota pessoal', () => {
  const js = ler('tarefas_admin.js');
  assert.match(js, /status === 403/);
  assert.match(js, /proibir\(/);
  assert.match(js, /setInterval\(atualizar, 60000\)/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /&auto=1/);
  assert.match(js, /podePagina\('tarefas_admin\.html'\)/);
});

// ---------- menu e permissão ----------
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
  const achado = /<a class="menu-item[^"]*" href="tarefas_admin\.html"[^>]*>/.exec(nav.innerHTML);
  return { window, html: nav.innerHTML, item: achado && achado[0] };
}

test('menu: logo depois de Minha semana, só com a permissão, escondida no modo atendimento', () => {
  const com = montarMenu({ permissoes: ['tarefas_admin.usar', 'administrativo.ver'] });
  assert.doesNotMatch(com.item, /hidden/);
  assert.match(com.html, /<span>Minha semana<\/span><\/a><a class="menu-item( grupo)?" href="tarefas_admin\.html"><svg[^]*?<\/svg><span>Semana compartilhada<\/span>/);
  assert.equal(com.window.Acesso.podePagina('tarefas_admin.html'), true);
  assert.deepEqual([...com.window.ACESSO_PAGINAS['tarefas_admin.html']], ['tarefas_admin.usar']);
  const chaves = Object.keys(com.window.ACESSO_PAGINAS);
  assert.ok(chaves.indexOf('tarefas_admin.html') < chaves.indexOf('minhas_entregas.html'));

  const sem = montarMenu({ permissoes: ['administrativo.ver'] });
  assert.match(sem.item, / hidden/);
  assert.equal(sem.window.Acesso.podePagina('tarefas_admin.html'), false);

  const atendendo = montarMenu({ permissoes: ['tarefas_admin.usar', 'atendimento.modo'] });
  assert.match(atendendo.item, / hidden/);
  assert.ok(atendendo.window.Atendimento.paginasBloqueadas.includes('tarefas_admin.html'));
});

test('menu: não vira a primeira página de quem já tinha outra', () => {
  const { window } = montarMenu({ permissoes: [] });
  const de = p => window.Acesso.primeiraPaginaDe({ permissoes: p });
  for (const outras of [['pedidos.ver'], ['entregas.baixar'], ['administrativo.ver'], ['etapas.ver']])
    assert.equal(de([...outras, 'tarefas_admin.usar']), de(outras), outras.join());
});

test('tarefas_admin.html: mesma casca e CSP da pessoal, mesma versão do layout.js, ids que o script usa', () => {
  const h = ler('tarefas_admin.html'), p = ler('tarefas.html');
  assert.match(h, /<title>Elegance Dashboard - Semana compartilhada<\/title>/);
  assert.match(h, /<h1 class="welcome-title">Semana compartilhada<\/h1>/);
  const csp = x => /Content-Security-Policy" content="([^"]+)"/.exec(x)[1];
  assert.equal(csp(h), csp(p));
  assert.equal(/layout\.js\?v=\d+/.exec(h)[0], /layout\.js\?v=\d+/.exec(p)[0]);
  const folhas = [...h.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  assert.match(folhas.at(-1), /^tema\.css\?v=\d+$/);
  assert.deepEqual([...h.matchAll(/<script src="([^"?]+)\?v=\d+" defer><\/script>/g)].map(m => m[1]), ['layout.js', 'entregas_comum.js', 'agenda_comum.js', 'calculo/agenda_repeticao.js', 'tarefas_admin.js']);
  assert.equal(/agenda_comum\.js\?v=\d+/.exec(h)[0], /agenda_comum\.js\?v=\d+/.exec(p)[0], 'mesma versão da parte compartilhada');
  assert.doesNotMatch(h, / on\w+="|<script(?![^>]*src=)/);
  for (const id of new Set([...ler('tarefas_admin.js').matchAll(/\$\('([a-z0-9-]+)'\)/g)].map(m => m[1]))) assert.ok(h.includes(`id="${id}"`), id);
  assert.match(h, /repeat\(14, minmax\(0, 1fr\)\)/, 'mesma grade horizontal');
});
