// Depois da foto do checklist assinado a tela pergunta "Deseja já dar a baixa nesta entrega?" (2026-11-17).
// Nunca dá a baixa sozinha: "Sim" só abre o formulário de sempre; "Agora não" só fecha.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../camera_captura.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function elementoFalso(tag) {
  const e = { tag, className: '', children: [], attrs: {}, ouvintes: {}, removido: false, id: '', _t: '',
    setAttribute(k, v) { e.attrs[k] = v; }, append(...f) { e.children.push(...f); }, appendChild(x) { e.children.push(x); return x; },
    addEventListener(n, fn) { e.ouvintes[n] = fn; }, remove() { e.removido = true; }, focus() {} };
  Object.defineProperty(e, 'textContent', { get: () => e._t, set: v => { e._t = v; }, configurable: true });
  return e;
}
const todos = e => e.children.flatMap(c => [c, ...todos(c)]);
function ambiente() {
  const teclas = [];
  const doc = { body: elementoFalso('body'), createElement: elementoFalso,
    addEventListener(n, fn) { if (n === 'keydown') teclas.push(fn); }, removeEventListener(n, fn) { const i = teclas.indexOf(fn); if (i >= 0) teclas.splice(i, 1); } };
  return { win: { document: doc }, doc, teclas };
}
const botao = (doc, texto) => todos(doc.body).find(e => e.tag === 'button' && e.textContent === texto);

test('perguntarBaixa: pergunta, "Sim" chama aoSim uma vez e fecha; nada e dado sozinho', () => {
  const { win, doc, teclas } = ambiente();
  let sim = 0;
  K.perguntarBaixa(win, { aoSim: () => sim++ });
  assert.ok(todos(doc.body).some(e => e.textContent === 'Deseja já dar a baixa nesta entrega?'));
  assert.equal(sim, 0, 'so a pergunta aparece, sem acao');
  botao(doc, 'Sim, dar a baixa').ouvintes.click();
  assert.equal(sim, 1);
  assert.equal(doc.body.children[0].removido, true);
  assert.equal(teclas.length, 0);
});

test('perguntarBaixa: "Agora não" e Esc só fecham, sem chamar aoSim', () => {
  let r = ambiente(), sim = 0;
  K.perguntarBaixa(r.win, { aoSim: () => sim++ });
  botao(r.doc, 'Não dar baixa agora').ouvintes.click();
  assert.equal(r.doc.body.children[0].removido, true);
  r = ambiente();
  K.perguntarBaixa(r.win, { aoSim: () => sim++ });
  r.teclas[0]({ key: 'Escape' });
  assert.equal(r.doc.body.children[0].removido, true);
  assert.equal(sim, 0);
});

test('perguntarBaixa: "Hoje" (padrao) entrega dataEntrega null; "Outra data" exige data valida e nao futura e mantem a pergunta aberta se faltar', () => {
  const { win, doc } = ambiente();
  const recebidos = [];
  K.perguntarBaixa(win, { aoSim: x => recebidos.push(x) });
  const por = id => todos(doc.body).find(e => e.id === id);
  assert.ok(todos(doc.body).some(e => /^Hoje \(\d{2}\/\d{2}\/\d{4}\)$/.test(e.textContent)), 'rotulo Hoje com a data atual');
  assert.ok(todos(doc.body).some(e => e.textContent === 'Outra data'));
  assert.equal(por('cc-data-hoje').checked, true);
  assert.equal(por('cc-data-valor').max, K.hojeISO());
  // Outra data sem valor: erro, nada chamado, caixa continua
  por('cc-data-hoje').checked = false; por('cc-data-outra').checked = true;
  por('cc-data-outra').ouvintes.change();
  botao(doc, 'Sim, dar a baixa').ouvintes.click();
  assert.equal(recebidos.length, 0);
  assert.equal(doc.body.children[0].removido, false);
  assert.ok(todos(doc.body).some(e => e.className === 'cc-pergunta-erro' && /Informe a data/.test(e.textContent)));
  // futura: recusada
  por('cc-data-valor').value = '2999-01-01';
  botao(doc, 'Sim, dar a baixa').ouvintes.click();
  assert.equal(recebidos.length, 0);
  // valida
  por('cc-data-valor').value = '2026-11-10';
  botao(doc, 'Sim, dar a baixa').ouvintes.click();
  assert.deepEqual(recebidos, [{ dataEntrega: '2026-11-10' }]);
  assert.equal(doc.body.children[0].removido, true);
  // Hoje: sem data
  const r2 = ambiente(), rec2 = [];
  K.perguntarBaixa(r2.win, { aoSim: x => rec2.push(x) });
  botao(r2.doc, 'Sim, dar a baixa').ouvintes.click();
  assert.deepEqual(rec2, [{ dataEntrega: null }]);
});

test('telas: a data escolhida so entra no corpo da baixa via formulario aberto pela pergunta (abrirForm zera) e o servidor continua sendo a rota de baixa de sempre', () => {
  const e = ler('entregas.js');
  assert.match(e, /estado\.dataEntregaBaixa = null; \/\/ a data da pergunta/);
  assert.match(e, /comDataBaixa\(\{ entregueA: txt\(\$\('r-entregue'\)\.value\)/);
  assert.match(e, /comDataBaixa\(\{ entregueA: quem,/);
  assert.match(e, /comDataBaixa\(\{ entregueA: txt\(\$\('k-entregue'\)\.value\), anexoIds: \[id\] \}\)/);
  const m = ler('minhas_entregas.js');
  assert.match(m, /corpoBaixa\(f, ids, b\.dataEntrega\)/);
  for (const id of ['r-data-aviso', 'ba-data-aviso', 'k-data-aviso']) assert.match(ler('entregas.html'), new RegExp(`id="${id}"`));
  assert.match(ler('minhas_entregas.html'), /id="b-data-aviso"/);
});

test('camera_captura: sem estilo inline (CSP) e com classes do tema no css', () => {
  assert.ok(!/\.style\.|setAttribute\('style'/.test(ler('camera_captura.js')));
  assert.match(ler('camera_captura.css'), /\.cc-pergunta-fundo \{[^}]*z-index: 3100/);
});

test('minhas_entregas.js: pergunta só depois da foto enviada, só quando "baixar" está disponível, e "Sim" abre a baixa de sempre', () => {
  const j = ler('minhas_entregas.js');
  assert.match(j, /aoRegistrar: r => \{\s*registrou = true;/);
  assert.match(j, /if \(registrou\) perguntarBaixaDepoisDaFoto\(id\)/);
  const f = j.slice(j.indexOf('function perguntarBaixaDepoisDaFoto'));
  assert.match(f, /acoesMotorista\(e, adm\)\.includes\('baixar'\)/);
  assert.ok(f.includes('aoSim: ({ dataEntrega } = {}) => { ocupado(() => abrirBaixa(id, dataEntrega || null)); }'), 'repassa a data escolhida ao formulario de baixa');
  assert.ok(!/\/baixa'|metodo: 'POST'/.test(f.slice(0, f.indexOf('// ---------- eventos'))), 'a pergunta nunca chama a rota de baixa');
});

test('entregas.js: pergunta só depois da foto enviada e só com o botão de baixa visível; "Sim" faz o clique desse botão', () => {
  const j = ler('entregas.js');
  assert.match(j, /aoRegistrar: r => \{\s*registrou = true;/);
  assert.match(j, /if \(registrou\) perguntarBaixaDepoisDaFoto\(e\.id\)/);
  const f = j.slice(j.indexOf('function perguntarBaixaDepoisDaFoto'), j.indexOf('// ---------- baixas: retirada'));
  assert.match(f, /\['btn-baixa-adm', 'btn-retirada', 'btn-comprovante'\]/);
  assert.match(f, /alvo\.click\(\)/);
  assert.ok(!/chamar\(/.test(f), 'sem chamada ao servidor: a baixa so acontece no formulario');
});

test('paginas carregam as versoes novas dos scripts alterados', () => {
  for (const p of ['entregas.html', 'minhas_entregas.html']) {
    assert.match(ler(p), /camera_captura\.js\?v=202611271000/, p);
    assert.match(ler(p), /camera_captura\.css\?v=202611271000/, p);
  }
});
