// Agendas (tela): coluna de categorias à esquerda, quadro único de dias e horas e a rolagem que abre perto das 07:00.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AG = require('../agenda_comum.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const PAGINAS = ['tarefas.html', 'tarefas_admin.html'];

// rolador como o do navegador: sem layout (altura 0) ou sem sobra, o scrollTop pedido é descartado
function rolador(altura) {
  let topo = 0;
  const ouvintes = {};
  return {
    clientHeight: altura, scrollHeight: altura ? 1152 : 0, firstElementChild: {},
    get scrollTop() { return topo; },
    set scrollTop(v) {
      topo = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight));
      for (const f of ouvintes.scroll || []) f();
    },
    addEventListener(tipo, f) { (ouvintes[tipo] ||= []).push(f); },
    ganharLayout(h) { this.clientHeight = h; this.scrollHeight = 1152; }
  };
}
function janelaFalsa() {
  const quadros = [], observadores = [];
  return {
    requestAnimationFrame: f => quadros.push(f),
    ResizeObserver: class { constructor(f) { this.f = f; this.ligado = true; observadores.push(this); } observe() {} disconnect() { this.ligado = false; } },
    proximoQuadro: () => quadros.splice(0).forEach(f => f()),
    redimensionou: () => observadores.filter(o => o.ligado).forEach(o => o.f())
  };
}

test('rolagem: grade ainda sem layout não perde a abertura perto das 07:00 (aplica quando ganhar tamanho)', () => {
  const el = rolador(0), win = janelaFalsa(), vistos = [];
  AG.manterRolagem(el, win, { alvo: 330, aoRolar: v => vistos.push(v) });
  assert.equal(el.scrollTop, 0);
  win.proximoQuadro();
  el.ganharLayout(600);
  win.redimensionou();
  assert.equal(el.scrollTop, 330);
  assert.deepEqual(vistos, [330]);
});

test('rolagem: aplicada uma vez; o que a pessoa rolou fica guardado e não volta para as 07:00', () => {
  const el = rolador(600), win = janelaFalsa(), vistos = [];
  const r = AG.manterRolagem(el, win, { alvo: 330, aoRolar: v => vistos.push(v) });
  assert.equal(el.scrollTop, 330);
  el.scrollTop = 500;
  r.aplicar();
  win.proximoQuadro();
  win.redimensionou();
  assert.equal(el.scrollTop, 500);
  assert.equal(vistos.at(-1), 500);
});

test('altura da grade: vai até o fim da janela, com mínimo de 320px', () => {
  assert.equal(AG.alturaGrade(1000, 360), 628);
  assert.equal(AG.alturaGrade(768, 340), 416);
  assert.equal(AG.alturaGrade(500, 340), 320);
});

test('grade a partir de 760px de área (a coluna de categorias tira largura da semana)', () => {
  assert.equal(AG.querGrade(860, false), true, '1366px de janela: ~865px de área');
  assert.equal(AG.querGrade(759, false), false);
  assert.equal(AG.querGrade(1600, true), false);
});

test('páginas: categorias numa coluna à esquerda, recolhível (fechada) na tela estreita, com o botão de gerenciar junto', () => {
  for (const f of PAGINAS) {
    const h = ler(f);
    const lateral = h.slice(h.indexOf('<aside class="ag-lateral"'), h.indexOf('</aside>'));
    assert.ok(lateral.length > 50, f + ': coluna');
    assert.match(lateral, /class="ag-lat-alternar"[^>]*aria-expanded="false"[^>]*aria-controls="lateral-corpo"/, f);
    assert.match(lateral, /id="legenda"/, f);
    assert.match(lateral, /id="btn-categorias" data-perm="tarefas_admin\.usar"/, f);
    assert.ok(h.indexOf('</aside>') < h.indexOf('id="semana"'), f + ': antes do calendário');
    assert.match(h, /agenda_comum\.js\?v=202612031200/, f);
    assert.match(h, /tema\.css\?v=202612031200/, f);
  }
});

test('legenda: cada categoria leva a cor na caixa de marcar e o nome inteiro no title', () => {
  const no = tag => ({ tag, dataset: {}, filhos: [], append(...f) { this.filhos.push(...f); }, replaceChildren() { this.filhos = []; }, addEventListener() {}, setAttribute() {} });
  const ui = AG.criarUi({ createElement: no }, {});
  const alvo = no('div');
  const nome = 'EXTRATO CRÉDITO COLABORADOR!';
  ui.desenharLegenda(alvo, { categorias: AG.indexar([{ id: 1, nome, cor: 'azul' }]), legenda: { ocultas: () => new Set(), mostrar() {} }, aoMudar() {} });
  assert.deepEqual(alvo.filhos.map(l => [l.title, l.dataset.cor, l.filhos.map(x => x.tag).join()]),
    [[nome, 'azul', 'input,span'], ['Sem categoria', '', 'input,span']]);
});

test('telas: a grade usa a rolagem que se repete até pegar, ocupa a janela e o tema desenha um quadro só', () => {
  for (const js of ['tarefas.js', 'tarefas_admin.js']) {
    const s = ler(js);
    assert.doesNotMatch(s, /scrollTop = 7 \*/, js);
    assert.match(s, /AG\.manterRolagem\(/, js);
    assert.match(s, /AG\.alturaGrade\(/, js);
    assert.match(s, /ligarLateral\(/, js);
  }
  const css = ler('tema.css');
  for (const sel of ['.ag-corpo', '.ag-lateral', '.ag-lat-alternar', '.agenda.ag-com-grade::before', '.agenda.ag-com-grade > .q-dom'])
    assert.ok(css.includes(sel), sel);
});
