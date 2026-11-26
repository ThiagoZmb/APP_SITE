// Seleção múltipla e ações em lote da aba Pedidos de painel_inicial.html (painel_lote.js), reaproveitando calendario_lote.js.
// Executa o script real com um DOM falso mínimo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../calendario_lote.js');
const P = require('../painel_lote.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

// ---------- DOM falso ----------
const VAZIAS = new Set(['input', 'col', 'br']);
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.attrs = {}; this.filhos = []; this.pai = null; this.ouvintes = {}; this._classes = new Set();
    this.hidden = false; this.disabled = false; this.checked = false; this.indeterminate = false; this.value = ''; this.textContent = '';
    const self = this;
    this.dataset = new Proxy({}, { get: (_, k) => self.attrs['data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())] });
    this.classList = {
      add: (...c) => c.forEach(x => self._classes.add(x)), remove: (...c) => c.forEach(x => self._classes.delete(x)), contains: c => self._classes.has(c),
      toggle: (c, v) => { const on = v === undefined ? !self._classes.has(c) : !!v; if (on) self._classes.add(c); else self._classes.delete(c); return on; }
    };
  }
  get id() { return this.attrs.id || ''; }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; if (k === 'hidden') this.hidden = true; if (k === 'type') this.type = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(e) { e.pai = this; this.filhos.push(e); return e; }
  insertBefore(e, ref) { e.pai = this; const i = this.filhos.indexOf(ref); this.filhos.splice(i < 0 ? this.filhos.length : i, 0, e); return e; }
  get firstChild() { return this.filhos[0] || null; }
  remove() { if (this.pai) this.pai.filhos.splice(this.pai.filhos.indexOf(this), 1); this.pai = null; }
  set innerHTML(h) {
    this._html = String(h); this.filhos = [];
    const pilha = [this];
    for (const m of this._html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)) {
      const [, fecha, tag, attrs] = m;
      if (fecha) { if (pilha.length > 1) pilha.pop(); continue; }
      const e = new El(tag);
      for (const a of attrs.matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)) e.setAttribute(a[1], a[2] ?? '');
      pilha[pilha.length - 1].appendChild(e);
      if (!VAZIAS.has(tag.toLowerCase())) pilha.push(e);
    }
  }
  get innerHTML() { return this._html || ''; }
  casa(sel) {
    return sel.split(',').some(s => {
      s = s.trim();
      const partes = s.split(/\s+/), ultimo = partes.pop();
      const m = /^([a-z0-9]*)((?:[.#][\w-]+|\[[^\]]+\])*)$/i.exec(ultimo);
      if (!m) return false;
      if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
      for (const p of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
        if (p[0] === '.') { if (!this._classes.has(p.slice(1))) return false; }
        else if (p[0] === '#') { if (this.id !== p.slice(1)) return false; }
        else { const [, k, v] = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(p); if (!(k in this.attrs) || (v !== undefined && this.attrs[k] !== v)) return false; }
      }
      let a = this.pai;
      while (partes.length) { const q = partes.pop(); while (a && !a.casa(q)) a = a.pai; if (!a) return false; a = a.pai; }
      return true;
    });
  }
  querySelectorAll(sel) { const r = []; const anda = e => { for (const f of e.filhos) { if (f.casa(sel)) r.push(f); anda(f); } }; anda(this); return r; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let e = this; while (e) { if (e.casa(sel)) return e; e = e.pai; } return null; }
  addEventListener(n, f) { (this.ouvintes[n] ||= []).push(f); }
  disparar(n, ev) { for (let e = this; e; e = e.pai) for (const f of e.ouvintes[n] || []) f(ev); }
  focus() { this.focado = true; }
  scrollIntoView() {}
}

function montarTela({ permissoes = ['pedidos.data_pronto', 'pedidos.situacao'], respostas = {}, dataNova = '2026-12-01', escolha = 'hoje', confirmar = true } = {}) {
  const corpoDoc = new El('body');
  const novo = (tag, attrs = {}, pai = corpoDoc) => { const e = new El(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return pai.appendChild(e); };
  const table = novo('table', { id: 'orders-table' });
  const colgroup = novo('colgroup', {}, table); for (let i = 0; i < 10; i++) novo('col', {}, colgroup);
  const trCab = novo('tr', {}, novo('thead', {}, table)); for (let i = 0; i < 10; i++) novo('th', {}, trCab);
  const tbody = novo('tbody', { id: 'orders-tbody' }, table);
  const barra = novo('div', { id: 'lote-barra', hidden: '' });
  const resumo = novo('div', { id: 'lote-resumo', hidden: '' });
  const busca = novo('input', { id: 'search-input' });
  const doc = {
    body: corpoDoc, createElement: t => new El(t),
    getElementById: id => corpoDoc.querySelector('#' + id), querySelector: s => corpoDoc.querySelector(s)
  };
  const log = { chamadas: [], recargas: 0, perguntasData: [], perguntasEntrega: [], confirms: [], estadoNaChamada: [], prontos: [] };
  const win = {
    document: doc, CalendarioLote: L,
    Acesso: { pode: p => permissoes.includes(p) },
    confirm: t => { log.confirms.push(t); return confirmar; },
    AlterarDataPronto: { perguntar: async c => { log.perguntasData.push(c); return dataNova; } },
    EscolhaDataEntrega: { perguntar: async c => { log.perguntasEntrega.push(c); return escolha; } }
  };
  const tela = { tipo: 'Pedido', numeros: [], aoChamar: null };
  const lote = P.criar({
    win,
    esc: s => String(s),
    tipo: () => tela.tipo,
    nomes: () => new Map(tela.numeros.map(n => [String(n), 'Cliente ' + n])),
    api: async (url, opcoes) => {
      log.chamadas.push({ url, opcoes });
      log.estadoNaChamada.push(barra.querySelectorAll('button, select').map(e => e.disabled));
      if (tela.aoChamar) await tela.aoChamar(url);
      const n = /Pedido\/([^/]+)\//.exec(url)[1];
      if (respostas[n]) throw respostas[n];
      return {};
    },
    recarregar: async () => { log.recargas++; tela.desenhar(tela.numeros); },
    aoPronto: async ns => { log.prontos.push({ ns, recargas: log.recargas }); }
  });
  // imita o renderLista do painel: preparar, linhas com a célula do lote, depoisDeDesenhar
  tela.desenhar = numeros => {
    tela.numeros = numeros;
    lote.preparar(numeros);
    tbody.filhos = [];
    for (const n of numeros) {
      const tr = novo('tr', { 'data-numero': String(n), tabindex: '0' }, tbody);
      const html = lote.celula(n);
      if (html) { const tmp = new El('x'); tmp.innerHTML = html; tr.appendChild(tmp.filhos[0]); }
      novo('td', { class: 'order-number' }, tr);
    }
    lote.depoisDeDesenhar();
  };
  const linha = n => tbody.querySelector(`tr[data-numero="${n}"]`);
  const caixa = n => linha(n).querySelector('.sel-pedido');
  const clique = (alvo, extra = {}) => { const ev = { target: alvo, preventDefault() { this.prevenido = true; }, ...extra }; return lote.clique(ev); };
  const marcar = (n, extra) => { const c = caixa(n); c.checked = !c.checked; return clique(c, extra); };
  const marcados = () => tbody.querySelectorAll('tr[data-numero]').filter(tr => tr.querySelector('.sel-pedido')?.checked).map(tr => Number(tr.dataset.numero));
  const todos = () => trCab.querySelector('#sel-todos');
  const clicarTodos = () => { const c = todos(); c.checked = !c.checked; c.indeterminate = false; c.disparar('change', { target: c }); };
  const acao = async nome => {
    if (nome === 'data' || nome === 'limpar') {
      const b = barra.querySelector(`[data-lote="${nome === 'data' ? 'data_pronto' : 'limpar'}"]`);
      barra.disparar('click', { target: b });
    } else {
      const s = barra.querySelector('[data-lote-sit]'); s.value = nome; barra.disparar('change', { target: s });
    }
    await lote.emAndamento();
  };
  const esc = (extra = {}) => lote.tecla({ key: 'Escape', target: corpoDoc, defaultPrevented: false, preventDefault() {}, ...extra });
  return { lote, tela, win, doc, corpoDoc, novo, barra, resumo, busca, table, colgroup, trCab, tbody, log, linha, caixa, clique, marcar, marcados, todos, clicarTodos, acao, esc };
}

test('sem pedidos.data_pronto nem pedidos.situacao: nenhuma caixa, coluna ou barra, e o clique segue para o PDF', () => {
  const t = montarTela({ permissoes: ['pedidos.pdf'] });
  t.tela.desenhar([1, 2]);
  assert.equal(t.lote.celula(1), '');
  assert.equal(t.lote.colunas(), 10);
  assert.equal(t.colgroup.filhos.length, 10);
  assert.equal(t.trCab.filhos.length, 10);
  assert.equal(t.barra.hidden, true);
  assert.equal(t.clique(t.linha(1), { ctrlKey: true }), false);
});

test('aba Pedidos: coluna de seleção (col + th + td), caixas rotuladas; aba Orçamentos tira tudo e limpa', () => {
  const t = montarTela();
  t.tela.desenhar([1, 2]);
  assert.equal(t.lote.colunas(), 11);
  assert.equal(t.colgroup.filhos.length, 11);
  assert.equal(t.trCab.filhos.length, 11);
  assert.ok(t.colgroup.filhos[0].classList.contains('col-sel'));
  assert.ok(t.trCab.filhos[0].classList.contains('col-sel'));
  assert.ok(t.table.classList.contains('com-sel'));
  assert.match(t.lote.celula(7), /^<td class="col-sel"><input type="checkbox" class="sel-pedido" aria-label="Selecionar o pedido 7"><\/td>$/);
  assert.equal(t.todos().getAttribute('aria-label'), 'Selecionar todos os pedidos da lista');
  t.tela.desenhar([1, 2]);
  assert.equal(t.trCab.filhos.length, 11, 'redesenhar não duplica a coluna');
  t.marcar(1);
  assert.equal(t.barra.hidden, false);
  t.tela.tipo = 'Orçamento'; t.lote.trocouAba();
  assert.equal(t.barra.hidden, true);
  assert.equal(t.trCab.filhos.length, 10);
  assert.equal(t.colgroup.filhos.length, 10);
  assert.ok(!t.table.classList.contains('com-sel'));
  t.tela.desenhar([1, 2]);   // orçamento com o mesmo número não herda a seleção
  assert.equal(t.lote.celula(1), '');
  t.tela.tipo = 'Pedido'; t.lote.trocouAba(); t.tela.desenhar([1, 2]);
  assert.deepEqual(t.marcados(), []);
});

test('caixa e célula selecionam sem abrir o PDF; clique normal não é consumido; Ctrl e Shift+clique selecionam (intervalo)', () => {
  const t = montarTela();
  t.tela.desenhar([10, 20, 30, 40]);
  assert.equal(t.clique(t.linha(10)), false);
  assert.deepEqual(t.marcados(), []);
  assert.equal(t.marcar(20), true);
  assert.deepEqual(t.marcados(), [20]);
  assert.ok(t.linha(20).classList.contains('selecionado'));
  assert.equal(t.clique(t.linha(40), { shiftKey: true }), true);
  assert.deepEqual(t.marcados(), [20, 30, 40]);
  assert.match(t.barra.innerHTML, /3 selecionados/);
  assert.equal(t.clique(t.linha(30), { ctrlKey: true }), true);
  assert.deepEqual(t.marcados(), [20, 40]);
  assert.equal(t.clique(t.linha(10).querySelector('td.col-sel')), true, 'clicar fora da caixa, na célula dela, também marca e não abre PDF');
  assert.deepEqual(t.marcados(), [10, 20, 40]);
  assert.equal(t.clique(t.linha(30), { metaKey: true }), true);
  assert.deepEqual(t.marcados(), [10, 20, 30, 40]);
});

test('caixa do cabeçalho: marca/desmarca todos os visíveis e fica indeterminada com parte marcada', () => {
  const t = montarTela();
  t.tela.desenhar([1, 2, 3]);
  assert.equal(t.todos().checked, false);
  t.marcar(2);
  assert.equal(t.todos().indeterminate, true);
  t.clicarTodos();
  assert.deepEqual(t.marcados(), [1, 2, 3]);
  assert.equal(t.todos().checked, true);
  assert.equal(t.todos().indeterminate, false);
  t.clicarTodos();
  assert.deepEqual(t.marcados(), []);
  assert.equal(t.barra.hidden, true);
  t.tela.desenhar([]);
  assert.equal(t.todos().disabled, true);
});

test('Esc limpa a seleção, menos com janela/menu aberto ou apagando texto da busca; botão "Limpar seleção" também limpa', async () => {
  const t = montarTela();
  t.tela.desenhar([1, 2]);
  assert.equal(t.esc(), false, 'sem seleção não consome');
  t.marcar(1);
  const menu = t.novo('div', { id: 'menu-ctx' });
  assert.equal(t.esc(), false); menu.remove();
  const dlg = t.novo('div', { class: 'dp-fundo' });
  assert.equal(t.esc(), false); dlg.remove();
  t.busca.value = 'ana';
  assert.equal(t.esc({ target: t.busca }), false);
  assert.equal(t.esc({ defaultPrevented: true }), false);
  assert.deepEqual(t.marcados(), [1]);
  t.busca.value = '';
  assert.equal(t.esc({ target: t.busca }), true);
  assert.deepEqual(t.marcados(), []);
  t.marcar(2);
  await t.acao('limpar');
  assert.deepEqual(t.marcados(), []);
});

test('mudança de busca/filtro/período (lista redesenhada): quem saiu da tela é desmarcado', () => {
  const t = montarTela();
  t.tela.desenhar([1, 2, 3]);
  t.marcar(1); t.marcar(3);
  t.tela.desenhar([2, 3]);
  assert.deepEqual(t.marcados(), [3]);
  t.tela.desenhar([1, 2, 3]);
  assert.deepEqual(t.marcados(), [3], 'o 1 não volta marcado');
});

test('barra: cada ação só com a sua permissão', () => {
  const t = montarTela({ permissoes: ['pedidos.situacao'] });
  t.tela.desenhar([1]);
  t.marcar(1);
  assert.equal(t.barra.querySelector('[data-lote="data_pronto"]'), null);
  assert.ok(t.barra.querySelector('[data-lote-sit]'));
  const d = montarTela({ permissoes: ['pedidos.data_pronto'] });
  d.tela.desenhar([1]);
  d.marcar(1);
  assert.ok(d.barra.querySelector('[data-lote="data_pronto"]'));
  assert.equal(d.barra.querySelector('[data-lote-sit]'), null);
});

test('data de pronto em lote: uma chamada por pedido pela rota individual, 409 de entregas vira falha, falhos seguem marcados, recarrega uma vez', async () => {
  const conflito = Object.assign(new Error('Mesmo assim?'), { status: 409, dados: { aviso: 'entregas_abertas', entregasAbertas: 1 } });
  const t = montarTela({ respostas: { 2: conflito } });
  t.tela.desenhar([1, 2, 3]);
  t.clicarTodos();
  await t.acao('data');
  assert.equal(t.log.perguntasData[0].subtitulo, '3 pedido(s) selecionado(s)');
  assert.deepEqual(t.log.chamadas.map(c => c.url), ['/ped_orc/Pedido/1/data_pronto', '/ped_orc/Pedido/2/data_pronto', '/ped_orc/Pedido/3/data_pronto']);
  assert.equal(t.log.chamadas[0].opcoes.method, 'POST');
  assert.equal(t.log.chamadas[0].opcoes.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(t.log.chamadas[0].opcoes.body), { dataPronto: '2026-12-01' });
  assert.equal(t.log.recargas, 1);
  assert.equal(t.resumo.hidden, false);
  assert.match(t.resumo.innerHTML, /2 de 3 alterados \(data de pronto\)/);
  assert.match(t.resumo.innerHTML, /Pedido 2<\/b> \(Cliente 2\): tem 1 entrega\(s\) em aberto/);
  assert.equal(t.resumo.getAttribute('role'), 'alert');
  assert.deepEqual(t.marcados(), [2]);
  assert.ok(t.log.estadoNaChamada[0].length > 0 && t.log.estadoNaChamada[0].every(Boolean), 'barra bloqueada enquanto roda');
  assert.ok(t.barra.querySelectorAll('button, select').every(e => !e.disabled), 'liberada no fim');
  const fechar = t.resumo.querySelector('[data-lote-fechar-resumo]');
  t.resumo.disparar('click', { target: fechar });
  assert.equal(t.resumo.hidden, true);
});

test('situação em lote: Pronto confirma com a quantidade; Entregue usa a janela de data; desistir não chama nada', async () => {
  const p = montarTela();
  p.tela.desenhar([1, 2]); p.clicarTodos();
  await p.acao('Pronto');
  assert.match(p.log.confirms[0], /2 pedido\(s\) para "Pronto"/);
  assert.deepEqual(p.log.chamadas.map(c => c.url), ['/ped_orc/Pedido/1/situacao', '/ped_orc/Pedido/2/situacao']);
  assert.deepEqual(JSON.parse(p.log.chamadas[0].opcoes.body), { situacao: 'Pronto' });
  assert.deepEqual(p.marcados(), [], 'tudo certo: nada continua marcado');
  assert.equal(p.barra.hidden, true);

  const e = montarTela({ escolha: 'manter' });
  e.tela.desenhar([1]); e.marcar(1);
  await e.acao('Entregue');
  assert.equal(e.log.perguntasEntrega[0].lote, 1);
  assert.deepEqual(JSON.parse(e.log.chamadas[0].opcoes.body), { situacao: 'Entregue', manterData: true });

  const d = montarTela({ confirmar: false });
  d.tela.desenhar([1]); d.marcar(1);
  await d.acao('Pronto');
  assert.equal(d.log.chamadas.length, 0);
  assert.equal(d.log.recargas, 0);
  assert.deepEqual(d.marcados(), [1]);

  const s = montarTela({ dataNova: null });
  s.tela.desenhar([1]); s.marcar(1);
  await s.acao('data');
  assert.equal(s.log.chamadas.length, 0);
});

test('sessão expirada interrompe o resto', async () => {
  const t = montarTela({ respostas: { 1: new Error('Sessão expirada') } });
  t.tela.desenhar([1, 2, 3]); t.clicarTodos();
  await t.acao('data');
  assert.equal(t.log.chamadas.length, 1);
  assert.match(t.resumo.innerHTML, /não processado/);
});

test('durante o lote: não aceita outra ação nem seleção, e a lista redesenhada não muda o que está sendo enviado', async () => {
  const t = montarTela();
  t.tela.desenhar([1, 2, 3]); t.clicarTodos();
  let soltar;
  t.tela.aoChamar = url => url.includes('/1/') ? new Promise(r => { soltar = r; }) : null;
  const b = t.barra.querySelector('[data-lote="data_pronto"]');
  t.barra.disparar('click', { target: b });
  await new Promise(r => setImmediate(r));
  assert.match(t.resumo.textContent, /Aplicando… 0 de 3/);
  t.tela.desenhar([2, 3]);   // busca digitada no meio do lote
  assert.ok(t.caixa(2).disabled && t.todos().disabled);
  assert.equal(t.clique(t.linha(2), { ctrlKey: true }), true, 'não abre PDF nem muda a seleção');
  assert.deepEqual(t.marcados(), [2, 3]);
  assert.equal(t.esc(), false);
  t.barra.disparar('click', { target: t.barra.querySelector('[data-lote="data_pronto"]') });
  assert.equal(t.log.perguntasData.length, 1);
  soltar();
  await t.lote.emAndamento();
  assert.equal(t.log.chamadas.length, 3);
  assert.ok(!t.caixa(2).disabled);
});

test('trocar para Orçamentos durante o lote: nada de pedido fica marcado na outra aba', async () => {
  const t = montarTela({ respostas: { 1: new Error('x') } });
  t.tela.desenhar([1, 2]); t.clicarTodos();
  t.tela.aoChamar = () => { t.tela.tipo = 'Orçamento'; t.lote.trocouAba(); };
  await t.acao('data');
  assert.equal(t.barra.hidden, true);
  t.tela.tipo = 'Pedido'; t.tela.desenhar([1, 2]);
  assert.deepEqual(t.marcados(), []);
});

// ---------- a página ----------
test('painel_inicial.html: scripts e CSS do lote com ?v=, barra e resumo, ligações no clique, teclado, desenho e troca de aba', () => {
  const h = ler('painel_inicial.html');
  const a = h.search(/<script src="calendario_lote\.js\?v=\d+" defer><\/script>/), b = h.search(/<script src="painel_lote\.js\?v=\d+" defer><\/script>/);
  assert.ok(a > 0 && b > a);
  assert.ok(h.search(/lote\.css\?v=\d+/) > 0 && h.search(/lote\.css\?v=\d+/) < h.indexOf('href="tema.css'));
  assert.match(h, /id="lote-barra" class="cal-lote" role="region" aria-label="Ações em lote nos pedidos selecionados" hidden/);
  assert.match(h, /id="lote-resumo" class="cal-lote-resumo" tabindex="-1" hidden/);
  assert.match(h, /\$\('orders-tbody'\)\.addEventListener\('click', e => \{\s*if \(lote && lote\.clique\(e\)\) return;/);
  assert.match(h, /if \(menuCtx\) fecharMenu\(true\); else if \(lote\) lote\.tecla\(e\);/);
  assert.match(h, /lote\?\.preparar\(visiveis\.map\(x => x\.numero\)\)/);
  assert.match(h, /lote\?\.depoisDeDesenhar\(\)/);
  assert.match(h, /lote\?\.trocouAba\(\)/);
  assert.match(h, /lote = window\.PainelLote\.criar\(/);
  const js = ler('painel_lote.js');
  assert.ok(js.includes("'data_pronto'") && js.includes("'situacao'") && !js.includes('/lote'), 'só as rotas individuais');
});

test('a coluna de seleção não entra na impressão nem no Salvar PDF (COLUNAS intocada) e o CSS não usa cor solta', () => {
  const h = ler('painel_inicial.html');
  const colunas = h.slice(h.indexOf('const COLUNAS = ['), h.indexOf('const MAX_LINHAS_LISTA'));
  assert.doesNotMatch(colunas, /sel-pedido|col-sel|lote/);
  const imprimir = h.slice(h.indexOf('function imprimirLista('), h.indexOf('function renderAvisoBusca('));
  assert.doesNotMatch(imprimir, /sel-pedido|col-sel|lote/);
  const css = ler('lote.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  assert.match(css, /@media print \{[^}]*\.cal-lote[^}]*\.sel-pedido/);
  const cal = ler('calendario.html');
  assert.ok(cal.search(/lote\.css\?v=\d+/) > cal.indexOf('calendario.css') && cal.search(/lote\.css\?v=\d+/) < cal.indexOf('href="tema.css'));
});

test('calendario_lote.js: perguntas e execução com resumo são compartilhadas pelas duas telas', () => {
  for (const f of ['perguntarData', 'perguntarSituacao', 'rodarLote']) assert.equal(typeof L[f], 'function', f);
  for (const arq of ['calendario.js', 'painel_lote.js']) {
    const js = ler(arq);
    for (const f of ['perguntarData', 'perguntarSituacao', 'rodarLote']) assert.match(js, new RegExp(`\\.${f}\\(`), `${arq} usa ${f}`);
  }
});

test('lote "Pronto": uma só chamada de aoPronto, depois de recarregar, só com os que deram certo', async () => {
  const t = montarTela({ respostas: { 2: new Error('falhou') } });
  t.tela.desenhar([1, 2, 3]);
  t.clicarTodos();
  await t.acao('Pronto');
  assert.deepEqual(t.log.prontos, [{ ns: ['1', '3'], recargas: 1 }]);
});

test('lote: outra situação, cancelamento ou tudo falhando não chamam aoPronto', async () => {
  for (const [opcoes, nome] of [[{}, 'Em Produção'], [{ confirmar: false }, 'Pronto'], [{ respostas: { 1: new Error('x') } }, 'Pronto']]) {
    const t = montarTela(opcoes);
    t.tela.desenhar([1]);
    t.marcar(1);
    await t.acao(nome);
    assert.deepEqual(t.log.prontos, [], nome);
  }
});
