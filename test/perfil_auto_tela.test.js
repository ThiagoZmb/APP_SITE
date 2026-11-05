// Tela do desenho automático (perfil_auto.js + HTML da aba "Desenho 3D"): conferência estática do HTML e do script, funções puras e o
// FLUXO dos botões num DOM de mentira (sem navegador): escolher imagem → gerar → conferir → junta → aceitar/tentar de novo/ajustar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../calculo/perfil_imagem');
const { png, leituraPixels1036 } = require('./apoio/imagemPerfil');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');   // checkout com CRLF (autocrlf) nao quebra os trechos com \n
const html = ler('produtos.html');
const auto = ler('perfil_auto.js');
const editor = ler('perfil_editor.js');
const PA = require('../perfil_auto.js');

// ================= HTML =================
test('HTML: os 3 passos existem, o fluxo automático vem ANTES do traçador e o traçador manual fica recolhido', () => {
  const iAuto = html.indexOf('id="pa-raiz"'), iManual = html.indexOf('<details class="pe-manual" id="pe-manual">'), iGrade = html.indexOf('<div class="pe-grade">');
  assert.ok(iAuto > 0 && iManual > iAuto && iGrade > iManual, 'ordem: automático, manual (recolhido), configurações/prévia');
  assert.doesNotMatch(html.slice(iManual, iManual + 80), /\sopen[\s>]/, 'recolhido por padrão');
  const manual = html.slice(iManual, html.indexOf('</details>', iManual));
  for (const id of ['pe-canvas', 'pe-tabelas', 'pe-calibrar', 'pe-img-produto', 'pe-msg']) assert.ok(manual.includes(`id="${id}"`), `${id} dentro do manual`);
  assert.ok(!html.slice(iAuto, iManual).includes('id="pe-canvas"'));
  const fluxo = html.slice(iAuto, iManual);
  assert.match(fluxo, /<span class="pa-num">1<\/span> Imagem do perfil/);
  assert.match(fluxo, /<span class="pa-num">2<\/span> Gerar o desenho/);
  assert.match(fluxo, /<span class="pa-num">3<\/span> Conferir/);
  assert.match(fluxo, /Gerar desenho automaticamente/);
  assert.match(fluxo, /Enviar imagem…/);
  assert.match(fluxo, /Aceitar e salvar/);
  assert.match(fluxo, /Tentar de novo/);
  assert.match(fluxo, /Ajustar manualmente/);
  assert.match(fluxo, /Corte a 45° ou reto\?/);
  assert.match(fluxo, /id="pa-raiz" data-pe-edita/, 'quem só pode ler não vê o fluxo (regra .pe-leitura [data-pe-edita])');
  assert.match(fluxo, /accept="image\/png,image\/jpeg"/);
  // prévia 3D, parede, cores e junta continuam editáveis logo abaixo
  const abaixo = html.slice(iGrade, html.indexOf('id="pe-salvar"'));
  for (const id of ['pe-parede', 'pe-junta', 'pe-cor-padrao', 'pe-cena']) assert.ok(abaixo.includes(`id="${id}"`), id);
});

test('HTML: todo id do perfil_auto.js existe uma vez só; script carregado depois do editor; nenhum script inline novo', () => {
  const bloco = auto.slice(auto.indexOf('const IDS = {'), auto.indexOf('function ligarEventos'));
  const ids = [...bloco.matchAll(/'(pa-[a-z0-9-]+)'/g)].map(m => m[1]);
  assert.ok(ids.length >= 25);
  for (const id of ids) assert.equal(html.split(`id="${id}"`).length, 2, `id ${id}: presente exatamente uma vez`);
  assert.ok(html.indexOf('<script src="perfil_editor.js') < html.indexOf('<script src="perfil_auto.js'));
  assert.ok(html.indexOf('<script src="perfil_auto.js') < html.indexOf('<script>\n        const API_BASE'));
  assert.equal((html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || []).length, 1);
  assert.match(html, /PerfilAuto\.iniciar\(\{ api, toast, confirmar, pode: c => Acesso\.pode\(c\), editor: PerfilEditor \}\)/);
  assert.match(html, /if \(window\.PerfilAuto\) PerfilAuto\.produtoMudou\(info\)/);
  assert.match(html, /err\.dados = dados/, 'o api() guarda o corpo do erro (o 422 traz os motivos e o que foi achado)');
});

test('CSS do fluxo automático: fundos sólidos do tema, nada de cor solta; sem faixa colorida lateral', () => {
  const ini = html.indexOf('/* --- desenho automático a partir da imagem'), fim = html.indexOf('</style>', ini);
  const css = html.slice(ini, fim);
  assert.ok(css.length > 1500);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css) && !/rgba?\(|hsla?\(|transparent/.test(css));
  for (const sel of ['.pa-fluxo', '.pa-palco', '.pa-bloco', '.pa-junta', '.pa-erro', '.pa-aviso', 'details.pe-manual']) {
    const m = css.match(new RegExp(sel.replace('.', '\\.') + ' \\{[^}]*\\}'));
    assert.ok(m && /background: var\(--(bg|surface-2)\)/.test(m[0]), `${sel} com fundo sólido`);
  }
  assert.ok(!/border-(left|right): [2-9]px/.test(css));
  assert.match(css, /prefers-reduced-motion/);
});

test('perfil_auto.js: compila, chama só a rota nova e as existentes, sem innerHTML nem cor solta; editor expõe o que ele usa', () => {
  assert.doesNotThrow(() => new vm.Script(auto, { filename: 'perfil_auto.js' }));
  const semComentario = auto.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(semComentario));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(semComentario) && !/rgba?\(|hsla?\(/.test(semComentario));
  assert.match(auto, /'\/perfil_secoes\/' \+ encodeURIComponent\(produto\.codigo\) \+ '\/ler_imagem'/);
  assert.match(auto, /'\/produtos\/imagem\/'/);
  assert.match(auto, /'\/perfil_secoes\/leitura_imagem\/disponivel'/);
  assert.match(auto, /ed\.salvar\(\)/, '"Aceitar e salvar" usa o salvar do editor (PUT /perfil_secoes/:codigo)');
  assert.ok(!/method: 'PUT'/.test(auto), 'a tela automática nunca grava sozinha');
  for (const f of ['carregarProposta', 'definirJunta', 'juntaAtual', 'salvar', 'abrirManual']) assert.match(editor, new RegExp(`return \\{[^}]*\\b${f}\\b`));
  assert.match(editor, /manual: 'pe-manual'/);
});

// ================= funções puras =================
test('puras: arquivo, confiança, linhas de cotas (verde/âmbar), estado dos botões e mensagens de erro', () => {
  assert.equal(PA.validarArquivo({ type: 'image/png', size: 1000 }), '');
  assert.match(PA.validarArquivo({ type: 'image/gif', size: 1000 }), /PNG ou JPEG/);
  assert.match(PA.validarArquivo({ type: 'image/png', size: 4 * 1024 * 1024 }), /3 MB/);
  assert.equal(PA.rotuloConfianca({ valor: 0.82, nivel: 'alta' }).texto, 'Confiança da leitura: alta (82%)');
  assert.equal(PA.rotuloConfianca({ valor: 0.4, nivel: 'baixa' }).nivel, 'baixa');
  const l = PA.linhasCotas([{ texto: '45', valor: 45, desenho: 45, bate: true }, { texto: '12,9', valor: 12.9, desenho: 13.4, bate: false }, { texto: '7,8', valor: 7.8, desenho: null, bate: false }]);
  assert.deepEqual(l.map(x => x.classe), ['bate', 'difere', 'difere']);
  assert.equal(l[0].resultado, '✓ bate');
  assert.match(l[1].resultado, /difere 0,5 mm/);
  assert.match(l[2].resultado, /não achei/);
  assert.equal(l[1].desenho, '13,4 mm');
  const base = { podeEditar: true, lendo: false, temImagem: true, disponivel: true, temProposta: false };
  assert.equal(PA.estadoControles(base).gerar, true);
  assert.equal(PA.estadoControles({ ...base, temImagem: false }).gerar, false, 'sem imagem não gera');
  assert.equal(PA.estadoControles({ ...base, lendo: true }).gerar, false);
  assert.equal(PA.estadoControles({ ...base, disponivel: false }).gerar, false, 'servidor sem chave');
  assert.equal(PA.estadoControles({ ...base, podeEditar: false }).gerar, false);
  assert.equal(PA.estadoControles(base).aceitar, false);
  assert.equal(PA.estadoControles({ ...base, temProposta: true }).aceitar, true);
  const e = PA.mensagemErro(Object.assign(new Error('x'), { status: 422, dados: { erros: ['vazado 0 fora do contorno'], achado: { contornoPontos: 8, vazados: 1, cotas: [1, 2], canalVidro: false } } }));
  assert.match(e.titulo, /Nada foi salvo/);
  assert.deepEqual(e.itens, ['vazado 0 fora do contorno']);
  assert.match(e.achado, /8 ponto\(s\), 1 vazado\(s\), 2 cota\(s\), sem canal/);
  assert.equal(PA.mensagemErro(new Error('Leitura de imagem não configurada no servidor.')).titulo, 'Leitura de imagem não configurada no servidor.');
});

// ================= fluxo num DOM de mentira =================
class Elem {
  constructor(tag = 'div', id = '') { this.tag = tag; this.id = id; this.hidden = false; this.disabled = false; this._filhos = []; this._texto = ''; this.attrs = {}; this.ou = {}; this.dataset = {}; this.value = ''; this.files = [];
    const cls = new Set(); this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); } }; this._cls = cls; }
  get className() { return [...this._cls].join(' '); } set className(v) { this._cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => this._cls.add(c)); }
  get textContent() { return this._texto + this._filhos.map(f => f.textContent).join(''); } set textContent(v) { this._texto = String(v); this._filhos = []; }
  get children() { return this._filhos; }
  appendChild(f) { this._filhos.push(f); return f; }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.ou[t] ||= []).push(f); }
  async disparar(t, ev = {}) { for (const f of this.ou[t] || []) await f({ preventDefault() {}, target: this, ...ev }); }
  click() { return this.disparar('click'); }
  querySelector(sel) { return sel === 'tbody' ? (this._tbody ||= new Elem('tbody')) : null; }
  scrollIntoView() {}
  getContext() { return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }); }
}
const IDS_FLUXO = ['pa-raiz', 'pa-indisponivel', 'pa-mini', 'pa-mini-vazio', 'pa-usar-produto', 'pa-enviar', 'pa-arq', 'pa-solta', 'pa-gerar', 'pa-progresso', 'pa-prog-txt', 'pa-erro', 'pa-passo3', 'pa-canvas', 'pa-selo', 'pa-cotas', 'pa-avisos-box', 'pa-avisos', 'pa-junta-box', 'pa-junta-dica', 'pa-junta-45', 'pa-junta-reta', 'pa-aceitar', 'pa-tentar', 'pa-ajustar'];

async function montarTela({ pode = () => true, respostaApi } = {}) {
  const els = {}; IDS_FLUXO.forEach(i => { els[i] = new Elem('div', i); });
  els['pa-mini'].complete = true; els['pa-mini'].naturalWidth = 1200; els['pa-mini'].naturalHeight = 800;
  els['pa-passo3'].hidden = true;
  const globais = { document: global.document, getComputedStyle: global.getComputedStyle };
  global.document = { getElementById: id => els[id] || null, querySelectorAll: () => [], querySelector: () => null, createElement: t => new Elem(t), createTextNode: t => { const e = new Elem('#text'); e.textContent = t; return e; }, documentElement: {} };
  global.getComputedStyle = () => ({ getPropertyValue: () => 'white' });
  const chamadas = [], toasts = [], confirmacoes = [];
  const ed = { carregou: [], salvou: 0, juntas: [], manual: 0, alterado: false, junta: 'reta', salvarOk: true,
    temAlteracao() { return this.alterado; }, async carregarProposta(secao, o) { this.carregou.push({ secao, o }); this.alterado = true; return true; },
    definirJunta(j) { this.junta = j; this.juntas.push(j); return true; }, juntaAtual() { return this.junta; }, async salvar() { this.salvou++; if (this.salvarOk) this.alterado = false; return this.salvarOk; }, abrirManual() { this.manual++; } };
  const sim = { confirma: true };
  const ctx = { pode, editor: ed, toast: (m, t) => toasts.push([m, t]), confirmar: async (a, b) => { confirmacoes.push(a); return sim.confirma; },
    api: async (caminho, opts = {}, comoBlob = false) => { chamadas.push({ caminho, opts, comoBlob }); const r = typeof respostaApi === 'function' ? respostaApi(caminho, opts, comoBlob) : respostaApi; if (r instanceof Error) throw r; return r; } };
  delete require.cache[require.resolve('../perfil_auto.js')];
  const tela = require('../perfil_auto.js');
  tela.iniciar(ctx);
  tela.produtoMudou({ codigo: 13, modelo: '1036', classe: 'Perfil', classeSalva: 'Perfil', salvo: true, temImagem: true, acabamentos: [], recarregar: true });
  const esperar = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
  const escolherArquivo = async (blob = new Blob([png(1200, 800)], { type: 'image/png' })) => { els['pa-arq'].files = [blob]; await els['pa-arq'].disparar('change', { target: { files: [blob], value: '' } }); await esperar(); };
  const restaurar = () => { global.document = globais.document; global.getComputedStyle = globais.getComputedStyle; };
  return { els, ed, chamadas, toasts, confirmacoes, sim, escolherArquivo, esperar, restaurar, tela };
}
const propostaReal = () => { const j = M.montarProposta(leituraPixels1036(), { codigo: 13, modelo: '1036', largura: 1200, altura: 800 }); const { ok, ...resto } = j; return { ok: true, ...resto }; };

test('fluxo: sem imagem não gera; enviar imagem libera; gerar manda a imagem crua, mostra a conferência e carrega a proposta no editor', async t => {
  const T = await montarTela({ respostaApi: () => propostaReal() }); t.after(T.restaurar);
  const { els } = T;
  assert.equal(els['pa-gerar'].disabled, true, 'sem imagem o botão grande fica desligado');
  assert.equal(els['pa-passo3'].hidden, true);
  await T.escolherArquivo();
  assert.equal(els['pa-gerar'].disabled, false);
  assert.equal(els['pa-mini'].hidden, false);
  await els['pa-gerar'].click(); await T.esperar();
  const ch = T.chamadas.find(c => /ler_imagem/.test(c.caminho));
  assert.equal(ch.caminho, '/perfil_secoes/13/ler_imagem');
  assert.equal(ch.opts.method, 'POST');
  assert.ok(ch.opts.body instanceof Blob, 'o arquivo vai cru no corpo');
  assert.deepEqual(ch.opts.headers, { 'Content-Type': 'image/png' });
  // proposta no editor (ainda não salva) com a calibração para o traçador manual
  assert.equal(T.ed.carregou.length, 1);
  assert.equal(T.ed.carregou[0].secao.largura, 18.9);
  assert.ok(T.ed.carregou[0].o.calibracao.mmPorPx > 0 && T.ed.carregou[0].o.blob);
  assert.equal(T.ed.salvou, 0, 'gerar NÃO salva');
  // conferência
  assert.equal(els['pa-passo3'].hidden, false);
  assert.match(els['pa-selo'].textContent, /Confiança da leitura: (alta|média)/);
  const linhas = els['pa-cotas'].querySelector('tbody').children;
  assert.equal(linhas.length, 4);
  assert.ok(linhas.every(l => l.classList.contains('bate')), 'as 4 cotas do 1036 batem (verde)');
  assert.equal(els['pa-avisos-box'].hidden, false);
  assert.ok(els['pa-avisos'].children.some(li => /junta/.test(li.textContent)));
  assert.equal(els['pa-progresso'].hidden, true);
  assert.equal(els['pa-aceitar'].disabled, false);
});

test('fluxo: junta é pergunta destacada; salvar sem escolher pede confirmação; escolher marca e dispensa o aviso; aceitar usa o salvar do editor', async t => {
  const T = await montarTela({ respostaApi: () => propostaReal() }); t.after(T.restaurar);
  const { els } = T;
  await T.escolherArquivo(); await els['pa-gerar'].click(); await T.esperar();
  assert.equal(els['pa-junta-box'].classList.contains('definida'), false, 'a junta não foi confirmada: caixa destacada');
  // recusa na confirmação: não salva
  T.sim.confirma = false;
  await els['pa-aceitar'].click(); await T.esperar();
  assert.deepEqual(T.confirmacoes, ['Salvar com a junta sem confirmar?']);
  assert.equal(T.ed.salvou, 0);
  // escolhe 45°
  await els['pa-junta-45'].click();
  assert.deepEqual(T.ed.juntas, ['meia_esquadria']);
  assert.equal(els['pa-junta-box'].classList.contains('definida'), true);
  assert.equal(els['pa-junta-45'].classList.contains('ativo'), true);
  assert.equal(els['pa-junta-reta'].classList.contains('ativo'), false);
  await els['pa-aceitar'].click(); await T.esperar();
  assert.equal(T.confirmacoes.length, 1, 'sem nova pergunta');
  assert.equal(T.ed.salvou, 1);
  assert.equal(els['pa-passo3'].hidden, true, 'depois de salvar a conferência fecha');
  assert.ok(T.toasts.some(([m]) => /aceito e salvo/.test(m)));
  assert.ok(!T.chamadas.some(c => c.opts && c.opts.method === 'PUT'), 'a tela automática não faz PUT por conta própria');
});

test('fluxo: se o salvar do editor falha, a conferência continua aberta', async t => {
  const T = await montarTela({ respostaApi: () => propostaReal() }); t.after(T.restaurar);
  await T.escolherArquivo(); await T.els['pa-gerar'].click(); await T.esperar();
  await T.els['pa-junta-reta'].click();
  T.ed.salvarOk = false;
  await T.els['pa-aceitar'].click(); await T.esperar();
  assert.equal(T.els['pa-passo3'].hidden, false);
  assert.equal(T.els['pa-aceitar'].disabled, false);
});

test('fluxo: "Tentar de novo" lê outra vez sem pedir confirmação; "Ajustar manualmente" abre o traçador', async t => {
  const T = await montarTela({ respostaApi: () => propostaReal() }); t.after(T.restaurar);
  await T.escolherArquivo(); await T.els['pa-gerar'].click(); await T.esperar();
  await T.els['pa-ajustar'].click();
  assert.equal(T.ed.manual, 1);
  await T.els['pa-tentar'].click(); await T.esperar();
  assert.equal(T.chamadas.filter(c => /ler_imagem/.test(c.caminho)).length, 2);
  assert.equal(T.confirmacoes.length, 0, 'tentar de novo não pergunta nada');
  assert.equal(T.ed.carregou.length, 2);
});

test('fluxo: gerar com desenho em edição pergunta antes de substituir', async t => {
  const T = await montarTela({ respostaApi: () => propostaReal() }); t.after(T.restaurar);
  T.ed.alterado = true; T.sim.confirma = false;
  await T.escolherArquivo(); await T.els['pa-gerar'].click(); await T.esperar();
  assert.deepEqual(T.confirmacoes, ['Substituir o desenho em edição?']);
  assert.equal(T.chamadas.filter(c => /ler_imagem/.test(c.caminho)).length, 0, 'recusou: não chama a API');
});

test('fluxo: imagem do produto vai SEM corpo (o servidor usa a salva); 422 mostra motivos e o que foi achado; nada vai ao editor', async t => {
  const erro422 = Object.assign(new Error('A leitura não resultou num desenho válido: x'), { status: 422, dados: { erros: ['O canal do vidro ficou estreito demais'], achado: { contornoPontos: 6, vazados: 0, cotas: [{}], canalVidro: false } } });
  const T = await montarTela({ respostaApi: (c, o, blob) => (blob ? new Blob([png(1200, 800)], { type: 'image/jpeg' }) : /ler_imagem/.test(c) ? erro422 : { disponivel: true }) }); t.after(T.restaurar);
  await T.els['pa-usar-produto'].click(); await T.esperar();
  assert.equal(T.chamadas.find(c => c.comoBlob).caminho, '/produtos/imagem/13');
  assert.equal(T.els['pa-gerar'].disabled, false);
  await T.els['pa-gerar'].click(); await T.esperar();
  const ch = T.chamadas.find(c => /ler_imagem/.test(c.caminho));
  assert.equal(ch.opts.body, undefined);
  assert.deepEqual(ch.opts, { method: 'POST' });
  assert.equal(T.els['pa-erro'].hidden, false);
  assert.match(T.els['pa-erro'].textContent, /Nada foi salvo/);
  assert.match(T.els['pa-erro'].textContent, /canal do vidro ficou estreito/);
  assert.match(T.els['pa-erro'].textContent, /O que a leitura achou: contorno com 6 ponto/);
  assert.match(T.els['pa-erro'].textContent, /Dicas: envie só a seção transversal/);
  assert.equal(T.ed.carregou.length, 0);
  assert.equal(T.els['pa-passo3'].hidden, true);
  assert.equal(T.els['pa-gerar'].disabled, false, 'pode tentar de novo');
});

test('fluxo: arquivo inválido é recusado na tela; sem permissão perfis.desenho nada liga', async t => {
  const T = await montarTela({ respostaApi: () => propostaReal() }); t.after(T.restaurar);
  await T.escolherArquivo(new Blob(['gif'], { type: 'image/gif' }));
  assert.ok(T.toasts.some(([m]) => /PNG ou JPEG/.test(m)));
  assert.equal(T.els['pa-gerar'].disabled, true);
  const L = await montarTela({ pode: () => false, respostaApi: () => propostaReal() }); t.after(L.restaurar);
  await L.escolherArquivo();
  assert.equal(L.els['pa-gerar'].disabled, true);
  assert.equal(L.els['pa-enviar'].disabled, true);
});
