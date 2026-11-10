// Janela "Ajustar desconto adicional" (desconto_pedido_tela.js): comportamento com um DOM falso mínimo + ligação nos menus e páginas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---------- DOM falso: só o que a janela usa ----------
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.className = ''; this.textContent = ''; this.value = ''; this.disabled = false; this.readOnly = false; this.checked = false; this.id = ''; this.removido = false; this.attrs = {};
    const cls = new Set(); this.classList = { add: c => cls.add(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) || this.className.split(/\s+/).includes(c) }; }
  append(...nos) { this.children.push(...nos); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  remove() { this.removido = true; }
  focus() { this.ctx.document.activeElement = this; }
  select() {}
}
function montar(respostas) {
  const ctx = { alertas: [], chamadas: [], recarregou: 0 };
  const docListeners = {};
  const document = {
    activeElement: null,
    createElement: tag => { const e = new El(tag); e.ctx = ctx; return e; },
    createTextNode: t => { const e = new El('#text'); e.textContent = t; e.ctx = ctx; return e; },
    body: { filhos: [], append(...n) { this.filhos.push(...n); } },
    addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter(f => f !== fn); }
  };
  ctx.document = document; ctx.docListeners = docListeners;
  const D = require('../calculo/desconto_pedido');
  const sandbox = {
    window: { DescontoPedido: D, location: { href: '' } }, document, localStorage: { removeItem() {} }, console,
    alert: m => ctx.alertas.push(m),
    fetch: async (url, opcoes = {}) => {
      ctx.chamadas.push({ url, metodo: opcoes.method, corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined });
      const r = respostas[(opcoes.method || 'GET')] || { status: 200, corpo: {} };
      return { ok: r.status < 400, status: r.status, json: async () => r.corpo };
    }
  };
  vm.runInNewContext(ler('desconto_pedido_tela.js'), sandbox, { filename: 'desconto_pedido_tela.js' });
  const achar = (no, pred) => { if (pred(no)) return no; for (const f of no.children || []) { const r = achar(f, pred); if (r) return r; } return null; };
  const emitir = (el, tipo, extra = {}) => (el.listeners[tipo] || []).forEach(fn => fn({ target: el, preventDefault() {}, stopPropagation() {}, ...extra }));
  const digitar = (el, texto) => { el.value = texto; emitir(el, 'input'); };
  const cfg = { numero: 5, apiBase: 'http://api', loginUrl: 'login.html', token: () => 'tok', recarregar: () => { ctx.recarregou++; } };
  return { ctx, sandbox, achar, emitir, digitar, cfg, janela: () => document.body.filhos[document.body.filhos.length - 1] };
}
const PEDIDO = { numero: 5, cliente: 'CLIENTE TESTE', subTotal: 1000, descontoPct: 2, total: 980, financeiro: 'A Receber', situacao: 'Em Produção' };
const resp = { GET: { status: 200, corpo: PEDIDO }, POST: { status: 200, corpo: { ok: true } } };
const porId = id => n => n.id === id;
const porRotulo = txt => n => n.tag === 'button' && n.textContent === txt;

test('abre com os valores atuais e o botão Aplicar desligado (sem mudança)', async () => {
  const T = montar(resp);
  await T.sandbox.window.AjustarDesconto.abrir(T.cfg);
  assert.equal(T.ctx.chamadas[0].url, 'http://api/ped_orc/Pedido/5/desconto');
  assert.equal(T.ctx.chamadas[0].metodo, 'GET');
  const j = T.janela();
  assert.equal(T.achar(j, porId('dv-pct')).value, '2');
  assert.equal(T.achar(j, porId('dv-total')).value, '980,00');
  assert.equal(T.achar(j, porId('dv-total')).readOnly, true, 'o total começa travado (forma do percentual)');
  assert.equal(T.achar(j, porRotulo('Aplicar')).disabled, true);
});

test('forma 1: digitar o % calcula o total, mostra a diferença e Aplicar envia só o %', async () => {
  const T = montar(resp);
  await T.sandbox.window.AjustarDesconto.abrir(T.cfg);
  const j = T.janela(), pct = T.achar(j, porId('dv-pct')), tot = T.achar(j, porId('dv-total')), ok = T.achar(j, porRotulo('Aplicar'));
  T.digitar(pct, '5');
  assert.equal(tot.value, '950,00');
  const novo = T.achar(j, n => n.className === 'dv-valor-novo'), variacao = T.achar(j, n => n.className === 'dv-var');
  assert.match(novo.textContent, /950,00/);
  assert.match(variacao.textContent, /▼.*30,00/);
  assert.equal(ok.disabled, false);
  T.emitir(ok, 'click');
  await new Promise(r => setImmediate(r));
  const post = T.ctx.chamadas.find(c => c.metodo === 'POST');
  assert.equal(post.url, 'http://api/ped_orc/Pedido/5/desconto');
  assert.deepEqual(post.corpo, { conferencia: { descontoPct: 2, total: 980 }, descontoPct: '5' });
  assert.equal(T.ctx.recarregou, 1);
  assert.equal(j.removido, true, 'a janela fecha');
});

test('forma 2 (Valor final): digitar o total calcula o % e Aplicar envia só o total', async () => {
  const T = montar(resp);
  await T.sandbox.window.AjustarDesconto.abrir(T.cfg);
  const j = T.janela(), pct = T.achar(j, porId('dv-pct')), tot = T.achar(j, porId('dv-total')), chk = T.achar(j, porId('dv-final-chk')), ok = T.achar(j, porRotulo('Aplicar'));
  chk.checked = true; T.emitir(chk, 'change');
  assert.equal(pct.readOnly, true);
  assert.equal(tot.readOnly, false);
  T.digitar(tot, '900,00');
  assert.equal(pct.value, '10');
  assert.equal(ok.disabled, false);
  T.emitir(ok, 'click');
  await new Promise(r => setImmediate(r));
  const post = T.ctx.chamadas.find(c => c.metodo === 'POST');
  assert.deepEqual(post.corpo, { conferencia: { descontoPct: 2, total: 980 }, totalFinal: '900,00' });
});

test('valor inválido mostra o erro e mantém Aplicar desligado; voltar ao atual também', async () => {
  const T = montar(resp);
  await T.sandbox.window.AjustarDesconto.abrir(T.cfg);
  const j = T.janela(), pct = T.achar(j, porId('dv-pct')), ok = T.achar(j, porRotulo('Aplicar'));
  const erro = T.achar(j, n => n.className === 'dv-erro');
  T.digitar(pct, '150');
  assert.match(erro.textContent, /entre 0% e 100%/);
  assert.equal(ok.disabled, true);
  T.digitar(pct, 'abc');
  assert.match(erro.textContent, /inválido/);
  assert.equal(ok.disabled, true);
  T.digitar(pct, '2');
  assert.equal(erro.textContent, '');
  assert.equal(ok.disabled, true, 'mesmo desconto de agora: nada a aplicar');
});

test('409 do servidor (pedido mudou / Recebido): avisa, fecha e recarrega a lista', async () => {
  const T = montar({ ...resp, POST: { status: 409, corpo: { error: 'O pedido nº 5 já está como Recebido: mudar o total agora desencontra o caixa.' } } });
  await T.sandbox.window.AjustarDesconto.abrir(T.cfg);
  const j = T.janela();
  T.digitar(T.achar(j, porId('dv-pct')), '5');
  T.emitir(T.achar(j, porRotulo('Aplicar')), 'click');
  await new Promise(r => setImmediate(r));
  assert.equal(T.ctx.alertas.length, 1);
  assert.match(T.ctx.alertas[0], /já está como Recebido/);
  assert.equal(T.ctx.recarregou, 1);
  assert.equal(j.removido, true);
});

test('falha ao abrir (GET) avisa e não monta a janela; Esc fecha', async () => {
  let T = montar({ GET: { status: 404, corpo: { error: 'Pedido nº 5 não encontrado.' } } });
  await T.sandbox.window.AjustarDesconto.abrir(T.cfg);
  assert.deepEqual(T.ctx.alertas, ['Pedido nº 5 não encontrado.']);
  assert.equal(T.ctx.document.body.filhos.length, 0);
  T = montar(resp);
  await T.sandbox.window.AjustarDesconto.abrir(T.cfg);
  const j = T.janela();
  (T.ctx.docListeners.keydown || []).forEach(fn => fn({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
  assert.equal(j.removido, true);
  assert.equal((T.ctx.docListeners.keydown || []).length, 0, 'o atalho de teclado é removido ao fechar');
});

test('nome do cliente vem do banco: entra por textContent, nunca por innerHTML', () => {
  const s = ler('desconto_pedido_tela.js');
  assert.doesNotMatch(s, /innerHTML/);
});

test('menus e páginas: item "Ajustar desconto adicional" (Pedido não cancelado, orcamentos.criar + valores.ver) e scripts carregados', () => {
  const m = ler('inicio_menu.js'), p = ler('painel_inicial.html');
  assert.match(m, /if \(!cancelado\) add\('orcamentos\.criar valores\.ver', '💲', 'Ajustar desconto adicional'/);
  assert.match(p, /if \(ehPedido && !cancelado\) add\('orcamentos\.criar valores\.ver', '💲', 'Ajustar desconto adicional'/);
  for (const f of ['inicio.html', 'calendario.html', 'calendario_dia.html', 'painel_inicial.html']) {
    const h = ler(f);
    const a = h.indexOf('calculo/desconto_pedido.js'), b = h.indexOf('desconto_pedido_tela.js');
    assert.ok(a > 0 && b > a, `${f}: a conta carrega antes da janela`);
  }
});

test('visual: rótulo e valor em elementos separados (nada colado), campos lado a lado e estilos no tema.css', () => {
  const css = ler('tema.css'), js = ler('desconto_pedido_tela.js');
  assert.match(js, /celula = \(rot, val\) => \{ const c = mk\('div'\); c\.append\(mk\('small', '', rot\), mk\('strong', '', val\)\)/);
  for (const cls of ['dv-caixa', 'dv-resumo', 'dv-campos', 'dv-campo', 'dv-final-chk', 'dv-dif', 'dv-novo', 'dv-var', 'dv-erro', 'dv-travado']) {
    assert.ok(new RegExp(String.raw`\.${cls}\b`).test(css), `falta .${cls} no tema.css`);
  }
  // rótulo pequeno em maiúsculas com espaçamento, números em fonte monoespaçada
  assert.match(css, /\.dv-resumo small \{[^}]*letter-spacing: \.05em[^}]*text-transform: uppercase/);
  assert.match(css, /\.dv-resumo strong \{ font: 600 15px\/1\.2 var\(--font-mono\)/);
  // somente leitura = número em âmbar (DESIGN.md); sem cor solta
  assert.match(css, /\.dv-campo \.dp-data\.dv-travado \{[^}]*color: var\(--primary-color\)/);
  const bloco = css.slice(css.indexOf('/* janela "Ajustar desconto adicional"'));
  assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,8}\b/, 'o bloco usa só variáveis do tema');
  // celular: resumo vira linhas (rótulo à esquerda, valor à direita) e os campos empilham
  assert.match(bloco, /@media \(max-width: 460px\)[\s\S]*\.dv-resumo \{ grid-template-columns: 1fr; \}[\s\S]*\.dv-campos \{ grid-template-columns: 1fr; \}/);
});

test('versão do tema.css única em todas as páginas e o script da janela com a versão nova nas quatro que o carregam', () => {
  const htmls = fs.readdirSync(path.join(__dirname, '..')).filter(n => n.endsWith('.html'));
  const versoes = new Set();
  for (const f of htmls) { const m = ler(f).match(/tema\.css\?v=(\d+)/); if (m) versoes.add(m[1]); }
  assert.equal(versoes.size, 1, 'uma única versão do tema: ' + [...versoes]);
  for (const f of ['inicio.html', 'calendario.html', 'calendario_dia.html', 'painel_inicial.html']) {
    assert.match(ler(f), /desconto_pedido_tela\.js\?v=202611161500/, f);
  }
});
