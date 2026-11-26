// Regra de 2026-11-26: a Semana compartilhada é automática para quem tem administrativo.ver (só "bloquear" no usuário tira) e o
// modo atendimento não esconde as agendas (Minha semana e Semana compartilhada) de quem é administrativo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { CATALOGO, permissoesFinais } = require('../seguranca/permissoes');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const CHAVE = 'administrativo.ver', SEMANA = 'tarefas_admin.usar';
const finais = (permissoesPerfil, excecoes = [], ativo = true) => permissoesFinais({ permissoesPerfil, excecoes, ativo });
const liberar = permissao => ({ permissao, tipo: 'liberar' });
const bloquear = permissao => ({ permissao, tipo: 'bloquear' });

test('quem tem a chave administrativa (do perfil ou por exceção) ganha a Semana compartilhada sozinho', () => {
  assert.ok(finais([CHAVE]).has(SEMANA));
  assert.ok(finais(['estoque.ver'], [liberar(CHAVE)]).has(SEMANA));
});

test('só a exceção "bloquear" no usuário tira, em qualquer ordem das exceções', () => {
  assert.ok(!finais([CHAVE, SEMANA], [bloquear(SEMANA)]).has(SEMANA));
  assert.ok(!finais([], [bloquear(SEMANA), liberar(CHAVE)]).has(SEMANA));
});

test('sem a chave não vem nem com perfil ou "liberar"; chave bloqueada e usuário inativo também não', () => {
  assert.ok(!finais([SEMANA], [liberar(SEMANA)]).has(SEMANA));
  assert.ok(!finais([CHAVE, SEMANA], [bloquear(CHAVE)]).has(SEMANA));
  assert.equal(finais([CHAVE, SEMANA], [], false).size, 0);
});

test('descrições explicam a regra automática e o que o modo atendimento esconde', () => {
  const semana = CATALOGO.find(p => p.codigo === SEMANA);
  assert.match(semana.descricao, /Automática para quem tem Acesso administrativo/);
  assert.match(semana.descricao, /Bloquear/);
  const modo = CATALOGO.find(p => p.codigo === 'atendimento.modo');
  assert.match(modo.nome, /agendas/);
  assert.match(modo.descricao, /Minha semana e (a )?Semana compartilhada de quem não tem Acesso administrativo/);
});

function montarMenu(permissoes, arquivo = 'painel_inicial.html') {
  const guarda = (ini = {}) => { const m = new Map(Object.entries(ini)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const local = guarda({ auth: JSON.stringify({ token: 't', user: { nome: 'V' }, exp: Date.now() + 1e6, acesso: { permissoes } }) });
  const session = guarda();
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {}, prepend() {}, before() {}, querySelector: () => null, querySelectorAll: () => [], style: {} });
  const nav = { ...el(), innerHTML: '', querySelector: () => el() };
  const container = { ...el(), querySelector: sel => (/nav|sidebar/.test(sel) ? nav : null) };
  const document = { readyState: 'complete', body: el(), head: el(), documentElement: el(), querySelector: s => (s === '.container' ? container : null), querySelectorAll: () => [], getElementById: () => null, createElement: el, addEventListener() {} };
  const window = { document, localStorage: local, sessionStorage: session, location: { pathname: '/' + arquivo, href: '' }, fetch: () => new Promise(() => {}), addEventListener() {}, matchMedia: () => ({ matches: false }) };
  window.window = window;
  vm.runInNewContext(ler('layout.js'), { window, document, localStorage: local, sessionStorage: session, location: window.location, fetch: window.fetch, MutationObserver: class { observe() {} }, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Intl, Date, JSON, Promise, CustomEvent: class {} });
  const item = f => (new RegExp(`<a class="menu-item[^"]*" href="${f.replace('.', '\\.')}"[^>]*>`).exec(nav.innerHTML) || [''])[0];
  return { window, html: nav.innerHTML, item };
}
const AGENDAS = ['tarefas.html', 'tarefas_admin.html'];
const GERAIS = ['inicio.html', 'graficos_pedidos.html', 'financeiro.html', 'custos.html', 'gestao.html'];
const TELAS = ['paineis.ver', 'pedidos.ver', 'valores.ver', 'financeiro.ver', 'precos.ver', 'gestao.ver', SEMANA, 'atendimento.modo'];

test('modo atendimento ligado, com administrativo.ver: as agendas ficam no menu e abrem; o resto continua bloqueado', () => {
  const m = montarMenu([...TELAS, CHAVE]);
  assert.equal(m.window.Atendimento.ativo(), true);
  for (const p of AGENDAS) {
    assert.equal(m.window.Acesso.podePagina(p), true, p);
    assert.match(m.item(p), /href/, p);
    assert.doesNotMatch(m.item(p), / hidden/, p);
    assert.ok(!m.window.Atendimento.paginasBloqueadas.includes(p), p);
  }
  assert.doesNotMatch(m.html, /<div class="sb-secao" hidden>Pessoal<\/div>/);
  for (const p of GERAIS) {
    assert.equal(m.window.Acesso.podePagina(p), false, p);
    assert.ok(m.window.Atendimento.paginasBloqueadas.includes(p), p);
  }
});

test('modo atendimento ligado, sem administrativo.ver: as agendas continuam escondidas', () => {
  const m = montarMenu(TELAS);
  for (const p of [...AGENDAS, ...GERAIS]) {
    assert.equal(m.window.Acesso.podePagina(p), false, p);
    assert.ok(m.window.Atendimento.paginasBloqueadas.includes(p), p);
  }
  for (const p of AGENDAS) assert.match(m.item(p), / hidden/, p);
});

// ---- tela de usuários: a ficha e o perfil não podem calcular essa permissão só pelo perfil ----
test('usuarios.html: o resultado na ficha segue a regra automática', () => {
  const h = ler('usuarios.html');
  const constante = /const AUTOMATICA = [^\n]*;/.exec(h);
  const funcao = /function resultadoDe\([\s\S]*?\r?\n        }/.exec(h);
  assert.ok(constante && funcao);
  const ficha = (excecoes, doPerfil, ativo = true) => vm.runInNewContext(`${constante[0]}\n${funcao[0]}\nresultadoDe(AUTOMATICA, doPerfil)`,
    { estadoFicha: { ativo, excecoes: new Map(excecoes) }, doPerfil: new Set(doPerfil) });
  assert.equal(ficha([], [CHAVE]), true, 'automática com a chave no perfil');
  assert.equal(ficha([[CHAVE, 'liberar']], []), true, 'chave por exceção');
  assert.equal(ficha([[SEMANA, 'bloquear']], [CHAVE, SEMANA]), false);
  assert.equal(ficha([[SEMANA, 'liberar']], [SEMANA]), false, 'sem a chave, nem liberando');
  assert.equal(ficha([[CHAVE, 'bloquear']], [CHAVE, SEMANA]), false);
  assert.equal(ficha([], [CHAVE], false), false);
});

test('usuarios.html: coluna "Do perfil" diz Automática e a caixa do perfil segue o Acesso administrativo sem apagar o que estava gravado', () => {
  const h = ler('usuarios.html');
  assert.match(h, /p\.codigo === AUTOMATICA \? 'Automática'/);
  assert.match(h, /id="p-automatica" disabled\$\{marcadas\.has\('administrativo\.ver'\) \? ' checked' : ''\}/);
  assert.match(h, /e\.target\.dataset\.permissao === 'administrativo\.ver'/);
  assert.match(h, /original\?\.permissoes\.includes\(AUTOMATICA\)\) marcadas\.add\(AUTOMATICA\)/);
});
