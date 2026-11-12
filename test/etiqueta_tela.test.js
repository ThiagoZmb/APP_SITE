// Tela das etiquetas Zebra: conferência estática dos menus + comportamento real de etiqueta_zebra.js (janela de ajustes com DOM falso, fetch/alert falsos).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const [inicio, painel, menu, modulo] = ['inicio.html', 'painel_inicial.html', 'inicio_menu.js', 'etiqueta_zebra.js'].map(ler);

test('menus: item "Imprimir etiquetas (Zebra)" com pedidos.pdf chamando EtiquetaZebra.imprimir', () => {
  for (const [nome, fonte] of [['inicio_menu.js', menu], ['painel_inicial.html', painel]]) {
    const i = fonte.indexOf('Imprimir etiquetas (Zebra)');
    assert.ok(i > 0, nome);
    const linha = fonte.slice(fonte.lastIndexOf('\n', i), fonte.indexOf('\n', i));
    assert.ok(linha.includes("'pedidos.pdf'"), nome + ' permissão');
    assert.ok(linha.includes('EtiquetaZebra.imprimir'), nome + ' chamada');
  }
});

test('páginas carregam etiqueta_zebra.js e liberam o serviço local na CSP', () => {
  for (const [nome, h] of [['inicio.html', inicio], ['painel_inicial.html', painel]]) {
    assert.match(h, /<script src="etiqueta_zebra\.js/, nome);
    assert.match(h, /connect-src[^"]*http:\/\/127\.0\.0\.1:3917/, nome);
  }
});

// ---------- DOM falso mínimo (só o que a janela usa) ----------
class El {
  constructor(tag, ctx) { this.tag = tag; this.tagName = tag.toUpperCase(); this.ctx = ctx; this.children = []; this.listeners = {}; this.className = ''; this.textContent = ''; this.value = ''; this.disabled = false; this.checked = false; this.hidden = false; this.id = ''; this.removido = false; this.attrs = {}; this.type = ''; }
  append(...nos) { this.children.push(...nos); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  remove() { this.removido = true; }
  focus() { this.ctx.document.activeElement = this; }
}
const achar = (no, pred) => { if (pred(no)) return no; for (const f of no.children || []) { const r = achar(f, pred); if (r) return r; } return null; };

function carregar(respostas) {
  const chamadas = [], avisos = [], loc = {}, removidos = [], docListeners = {};
  const ctx = {};
  const document = {
    activeElement: null,
    createElement: tag => new El(tag, ctx),
    body: { filhos: [], append(...n) { this.filhos.push(...n); } },
    addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter(f => f !== fn); }
  };
  ctx.document = document;
  const fetchFalso = async (url, opcoes = {}) => {
    chamadas.push({ url, metodo: opcoes.method || 'GET', corpo: opcoes.body, auth: opcoes.headers?.Authorization });
    const r = respostas(url, opcoes);
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => r.corpo ?? {} };
  };
  const janelaGlobal = {};
  vm.runInNewContext(modulo, { window: janelaGlobal, document, fetch: fetchFalso, alert: m => avisos.push(m), location: loc,
    localStorage: { removeItem: k => removidos.push(k) }, AbortController, setTimeout, clearTimeout });
  const imprimir = () => janelaGlobal.EtiquetaZebra.imprimir('23425', { apiBase: 'https://api', loginUrl: 'login.html', token: () => 'tk' });
  const emitir = (el, tipo, extra = {}) => (el.listeners[tipo] || []).forEach(fn => fn({ target: el, preventDefault() {}, stopPropagation() {}, ...extra }));
  const tecla = (key, extra = {}) => (docListeners.keydown || []).forEach(fn => fn({ key, target: document.activeElement, preventDefault() {}, stopPropagation() {}, ...extra }));
  const janela = () => document.body.filhos.filter(f => !f.removido).pop();
  const botao = txt => achar(janela(), n => n.tag === 'button' && n.textContent === txt);
  const porId = id => achar(janela(), n => n.id === id);
  const turnos = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
  const esperarJanela = async () => { for (let i = 0; i < 20 && !janela(); i++) await new Promise(r => setImmediate(r)); return janela(); };
  return { chamadas, avisos, loc, removidos, imprimir, emitir, tecla, janela, botao, porId, document, docListeners, esperarJanela, turnos };
}
const PING = u => u.endsWith('/ping');
const ITENS = { numero: '23425', ufSugerida: 'ES', itens: [
  { item: '1', qtd: '2', descricao: 'Porta de giro 2 folhas', medidasSugeridas: '2287 × 706' },
  { item: '2', qtd: '1,5', descricao: 'Fixo', medidasSugeridas: '' }] };
// API: GET /itens e o POST do ZPL; serviço local: ping e /etiqueta
function cenario({ itens = ITENS, post = { status: 200, corpo: { zpl: '^XA^XZ', quantidade: 2 } }, local = { status: 200, corpo: { ok: true, impressora: 'ZDesigner ZD220', porta: 'USB001' } } } = {}) {
  return carregar(u => (PING(u) ? { status: 200 }
    : u === 'https://api/etiquetas/pedido/23425/itens' ? { status: 200, corpo: itens }
      : u === 'https://api/etiquetas/pedido/23425' ? post
        : local));
}

test('serviço local sem resposta: avisa e não chama a API nem abre a janela', async () => {
  const t = carregar(u => (PING(u) ? new Error('recusado') : { status: 200, corpo: {} }));
  await t.imprimir();
  assert.match(t.avisos[0], /Serviço local não encontrado neste PC/);
  assert.ok(!t.chamadas.some(c => c.url.startsWith('https://api')));
  assert.equal(t.document.body.filhos.length, 0);
});

test('401 da API limpa a sessão e vai para o login', async () => {
  const t = carregar(u => (PING(u) ? { status: 200 } : { status: 401 }));
  await t.imprimir();
  assert.deepEqual(t.removidos, ['auth']);
  assert.equal(t.loc.href, 'login.html');
});

test('404 da API mostra a mensagem do servidor e não abre a janela', async () => {
  const t = carregar(u => (PING(u) ? { status: 200 } : { status: 404, corpo: { error: 'Este pedido não tem itens para etiquetar.' } }));
  await t.imprimir();
  assert.match(t.avisos[0], /não tem itens/);
  assert.equal(t.document.body.filhos.length, 0);
});

test('abre a janela acessível com um cartão por item: volumes = QTD do item, medidas desligadas com a sugestão pronta, UF geral = a do cliente', async () => {
  const t = cenario();
  const fim = t.imprimir();
  const j = await t.esperarJanela();
  assert.equal(j.className, 'dp-fundo');
  const caixa = j.children[0];
  assert.equal(caixa.attrs.role, 'dialog');
  assert.equal(caixa.attrs['aria-modal'], 'true');
  assert.equal(caixa.attrs['aria-labelledby'], 'ez-titulo');
  assert.equal(t.porId('ez-titulo').textContent, 'Imprimir etiquetas (Zebra)');
  assert.equal(t.chamadas.find(c => c.url.endsWith('/itens')).auth, 'Bearer tk');
  assert.equal(t.porId('ez-uf-geral').value, 'ES');
  assert.equal(t.porId('ez-uf-geral').children.length, 28, 'vazio + 27 UFs');
  assert.equal(t.porId('ez-qtd-1').value, '2');
  assert.equal(t.porId('ez-qtd-2').value, '2', '1,5 sobe para 2 volumes');
  assert.equal(t.porId('ez-qtd-1').min, '1');
  assert.equal(t.porId('ez-qtd-1').max, '999');
  assert.equal(t.porId('ez-inc-1').checked, false);
  assert.equal(t.porId('ez-med-1').value, '2287 × 706');
  assert.equal(t.porId('ez-med-1').disabled, true);
  assert.equal(t.porId('ez-med-2').value, '', 'sem sugestão: vazio, nada inventado');
  assert.equal(t.porId('ez-uf-1').value, '');
  assert.equal(t.document.activeElement, t.porId('ez-qtd-1'), 'foco no primeiro campo');
  assert.ok(!t.chamadas.some(c => c.metodo === 'POST'), 'nada foi enviado ainda');
  t.tecla('Escape');
  await fim;
});

test('Cancelar e Esc fecham sem enviar nada à API nem à impressora; o ouvinte de teclado é removido', async () => {
  for (const sair of ['cancelar', 'esc']) {
    const t = cenario();
    const fim = t.imprimir();
    await t.esperarJanela();
    const j = t.janela();
    if (sair === 'cancelar') t.emitir(t.botao('Cancelar'), 'click'); else t.tecla('Escape');
    await fim;
    assert.equal(j.removido, true);
    assert.ok(!t.chamadas.some(c => c.metodo === 'POST'));
    assert.deepEqual(t.docListeners.keydown, []);
    assert.deepEqual(t.avisos, []);
  }
});

test('Tab circula dentro da janela (foco preso) e Shift+Tab volta', async () => {
  const t = cenario();
  const fim = t.imprimir();
  await t.esperarJanela();
  t.botao('Imprimir').focus();
  t.tecla('Tab');
  assert.equal(t.document.activeElement, t.porId('ez-uf-geral'));
  t.tecla('Tab', { shiftKey: true });
  assert.equal(t.document.activeElement, t.botao('Imprimir'));
  t.tecla('Escape');
  await fim;
});

test('ligar "Incluir medidas" habilita o campo; Imprimir envia ao servidor os ajustes e só depois o ZPL pronto ao serviço local', async () => {
  const t = cenario();
  const fim = t.imprimir();
  await t.esperarJanela();
  t.porId('ez-uf-geral').value = 'RJ';
  t.porId('ez-qtd-1').value = '5';
  const liga = t.porId('ez-inc-1'); liga.checked = true; t.emitir(liga, 'change');
  assert.equal(t.porId('ez-med-1').disabled, false);
  t.porId('ez-med-1').value = '2287 x 700';
  t.porId('ez-uf-2').value = 'SP';
  t.emitir(t.botao('Imprimir'), 'click');
  await fim;
  const post = t.chamadas.find(c => c.metodo === 'POST' && c.url === 'https://api/etiquetas/pedido/23425');
  assert.equal(post.auth, 'Bearer tk');
  assert.deepEqual(JSON.parse(post.corpo), { uf: 'RJ', itens: [
    { item: '1', qtd: 5, incluirMedidas: true, medidas: '2287 x 700', uf: '' },
    { item: '2', qtd: 2, incluirMedidas: false, medidas: '', uf: 'SP' }] });
  const envio = t.chamadas.find(c => c.url === 'http://127.0.0.1:3917/etiqueta');
  assert.deepEqual(JSON.parse(envio.corpo), { zpl: '^XA^XZ' }, 'o serviço local só recebe o ZPL montado pelo servidor');
  assert.ok(t.chamadas.indexOf(post) < t.chamadas.indexOf(envio));
  assert.match(t.avisos[0], /2 etiqueta\(s\).*ZDesigner ZD220.*USB001/);
  assert.equal(t.document.body.filhos.every(f => f.removido), true, 'janela fechou');
});

test('medidas desligadas não vão no envio mesmo com sugestão no campo', async () => {
  const t = cenario();
  const fim = t.imprimir();
  await t.esperarJanela();
  t.emitir(t.botao('Imprimir'), 'click');
  await fim;
  const corpo = JSON.parse(t.chamadas.find(c => c.metodo === 'POST' && c.url.startsWith('https://api')).corpo);
  assert.equal(corpo.uf, 'ES');
  assert.deepEqual(corpo.itens.map(i => [i.incluirMedidas, i.medidas]), [[false, ''], [false, '']]);
});

test('Enter num campo imprime; Enter na caixa de marcar não', async () => {
  const t = cenario();
  const fim = t.imprimir();
  await t.esperarJanela();
  const caixaLiga = t.porId('ez-inc-1'); caixaLiga.focus();
  t.tecla('Enter', { target: caixaLiga });
  assert.ok(!t.chamadas.some(c => c.metodo === 'POST'));
  const q = t.porId('ez-qtd-1'); q.focus();
  t.tecla('Enter', { target: q });
  await fim;
  assert.ok(t.chamadas.some(c => c.metodo === 'POST' && c.url.startsWith('https://api')));
});

test('quantidade fora de 1 a 999 (ou não inteira) bloqueia o envio e mostra o erro com o foco no campo', async () => {
  const t = cenario();
  const fim = t.imprimir();
  await t.esperarJanela();
  for (const ruim of ['0', '1000', '1.5', '', 'abc', '-3']) {
    t.porId('ez-qtd-2').value = ruim;
    t.emitir(t.botao('Imprimir'), 'click');
    const erro = achar(t.janela(), n => n.className === 'ez-erro');
    assert.equal(erro.hidden, false, ruim);
    assert.match(erro.textContent, /Item 2: a quantidade de volumes deve ser um número inteiro de 1 a 999/);
    assert.equal(t.document.activeElement, t.porId('ez-qtd-2'));
  }
  assert.ok(!t.chamadas.some(c => c.metodo === 'POST'));
  t.tecla('Escape');
  await fim;
});

test('erro 400 do servidor (ex.: medidas) fica na janela, que continua aberta para corrigir', async () => {
  const t = cenario({ post: { status: 400, corpo: { error: 'Medidas do item 1 inválidas: até 30 caracteres.' } } });
  const fim = t.imprimir();
  await t.esperarJanela();
  t.emitir(t.botao('Imprimir'), 'click');
  await t.turnos();
  const erro = achar(t.janela(), n => n.className === 'ez-erro');
  assert.equal(erro.hidden, false);
  assert.match(erro.textContent, /Medidas do item 1 inválidas/);
  assert.equal(t.janela().removido, false);
  assert.ok(!t.chamadas.some(c => c.url.endsWith('/etiqueta')), 'nada foi para a impressora');
  assert.equal(t.botao('Imprimir').disabled, false);
  t.tecla('Escape');
  await fim;
});

test('erro do serviço local na impressão é mostrado dentro da janela', async () => {
  const t = cenario({ post: { status: 200, corpo: { zpl: '^XA^XZ', quantidade: 1 } }, local: { status: 500, corpo: { error: 'Nenhuma impressora Zebra encontrada.' } } });
  const fim = t.imprimir();
  await t.esperarJanela();
  t.emitir(t.botao('Imprimir'), 'click');
  await t.turnos();
  assert.match(achar(t.janela(), n => n.className === 'ez-erro').textContent, /Nenhuma impressora Zebra encontrada/);
  t.tecla('Escape');
  await fim;
});

test('visual: janela sem estilo inline nem innerHTML, reaproveita dp-* e os ez-* existem no tema.css (versão do tema igual em todas as páginas)', () => {
  assert.ok(!/\.style\b|style=|innerHTML|#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(modulo), 'sem estilo nem cor solta no JS');
  const css = ler('tema.css');
  for (const cls of ['dp-fundo', 'dp-caixa', 'ez-caixa', 'ez-lista', 'ez-item', 'ez-campos', 'ez-campo', 'ez-liga', 'ez-erro', 'ez-geral']) assert.match(css, new RegExp('\\.' + cls + '\\b'), cls);
  const bloco = css.slice(css.indexOf('janela "Imprimir etiquetas (Zebra)"'));
  assert.ok(!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(bloco), 'só variáveis do tema');
  const htmls = fs.readdirSync(path.join(__dirname, '..')).filter(n => n.endsWith('.html'));
  const temas = new Set(htmls.flatMap(f => [...ler(f).matchAll(/tema\.css\?v=(\d+)/g)].map(m => m[1])));
  assert.equal(temas.size, 1);
  for (const f of ['inicio.html', 'painel_inicial.html', 'calendario.html', 'calendario_dia.html']) assert.match(ler(f), /etiqueta_zebra\.js\?v=202611201200/, f);
});
