process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PASTA = path.join(__dirname, '..', 'portal', 'public');
const existe = nome => fs.existsSync(path.join(PASTA, nome));
const ler = nome => fs.readFileSync(path.join(PASTA, nome), 'utf8');

test('pedido.html e pedido.js existem', () => {
  assert.ok(existe('pedido.html'), 'falta pedido.html');
  assert.ok(existe('pedido.js'), 'falta pedido.js');
});

test('pedido.html: sem script inline, style= nem on*=; tem os campos, os documentos e o erro', () => {
  const h = ler('pedido.html');
  for (const m of h.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\bsrc="[^"]+"/);
  assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(h), 'script com conteúdo');
  assert.ok(!/\sstyle\s*=/i.test(h), 'style=');
  assert.ok(!/\son[a-z]+\s*=/i.test(h), 'on*=');
  assert.match(h, /<script src="pedido\.js">/);
  assert.match(h, /<p id="erro" class="erro" role="alert"/);
  for (const id of ['numero', 'data', 'situacao', 'entrega', 'previsao', 'documentos', 'lista-documentos']) assert.ok(h.includes(`id="${id}"`), 'falta #' + id);
  assert.match(h, /<section id="documentos" hidden>/);
  assert.match(h, /href="pedidos\.html"/);
  assert.match(h, /<title>Detalhe do pedido<\/title>/);
});

test('pedido.js: APIs proibidas, textContent, rotas, validação do número e 401', () => {
  const j = ler('pedido.js');
  assert.doesNotThrow(() => new vm.Script(j));
  for (const p of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'document.write', 'new Date']) assert.ok(!j.includes(p), p);
  assert.ok(j.includes('textContent'));
  assert.ok(j.includes('/portal/api/pedidos/'));
  assert.ok(j.includes('/portal/api/eu'));
  assert.ok(j.includes('/portal/login.html'));
  assert.ok(j.includes('documentos.ver'));
});

test('pedidos.js: o número da lista vira link para pedido.html', () => {
  const j = ler('pedidos.js');
  assert.ok(j.includes('pedido.html?numero='));
});

const esperar = () => new Promise(r => setImmediate(r));

function rodar({ busca, detalhe, eu, documentos }) {
  const el = {};
  const novo = () => ({ _t: '', get textContent() { return this._t; }, set textContent(v) { this._t = v; this.children = []; },
    hidden: false, children: [], atributos: {},
    appendChild(f) { this.children.push(f); }, setAttribute(k, v) { this.atributos[k] = String(v); } });
  const get = id => (el[id] = el[id] || novo());
  get('documentos').hidden = true;
  const chamadas = [];
  const resp = (v, c) => (typeof v === 'function' ? v(c) : v);
  const janela = { location: { search: busca, replace: u => chamadas.push('replace:' + u) },
    PortalApi: { chamar: async c => {
      chamadas.push(c);
      if (c === '/portal/api/eu') return resp(eu, c);
      if (/\/documentos$/.test(c)) return resp(documentos, c);
      return resp(detalhe, c);
    } } };
  const documento = { getElementById: get, createElement: tag => ({ tag, textContent: '', children: [], atributos: {}, appendChild(f) { this.children.push(f); }, setAttribute(k, v) { this.atributos[k] = String(v); } }) };
  vm.runInNewContext(ler('pedido.js'), { window: janela, document: documento, URLSearchParams });
  return { get, chamadas };
}

const detalheOk = { status: 200, dados: { pedido: { numero: 12, data: '2026-03-09', situacao: 'Em produção', dataEntrega: null, entrega: 'Entrega agendada', dataAgendada: '2026-03-20' } } };
const euCom = permissoes => ({ status: 200, dados: { usuario: { email: 'a@b.c', permissoes } } });
const CHAVE = '1'.repeat(44);
const CHAVE2 = '2'.repeat(44);

test('pedido.js (vm): número inválido ou ausente mostra erro e não chama a API', async () => {
  for (const busca of ['?numero=12abc', '', '?numero=', '?numero=1234567890', '?numero=../x']) {
    const { get, chamadas } = rodar({ busca, detalhe: detalheOk, eu: euCom(['documentos.ver']), documentos: { status: 200, dados: {} } });
    await esperar();
    assert.deepEqual(chamadas, [], busca);
    assert.equal(get('erro').textContent, 'Pedido não encontrado.', busca);
  }
});

test('pedido.js (vm): mostra os dados do pedido por textContent', async () => {
  const { get, chamadas } = rodar({ busca: '?numero=12', detalhe: detalheOk, eu: euCom(['pedidos.ver']), documentos: { status: 200, dados: {} } });
  await esperar();
  assert.equal(chamadas[0], '/portal/api/pedidos/12');
  assert.equal(get('numero').textContent, '12');
  assert.equal(get('data').textContent, '09/03/2026');
  assert.equal(get('situacao').textContent, 'Em produção');
  assert.equal(get('entrega').textContent, 'Entrega agendada');
  assert.equal(get('previsao').textContent, '20/03/2026');
  assert.equal(get('erro').textContent, '');
});

test('pedido.js (vm): sem documentos.ver não chama /documentos e não mostra botões', async () => {
  const { get, chamadas } = rodar({ busca: '?numero=12', detalhe: detalheOk, eu: euCom(['pedidos.ver']), documentos: { status: 200, dados: { pdfPedido: true, notas: [] } } });
  await esperar();
  assert.ok(!chamadas.some(c => /documentos/.test(c)), JSON.stringify(chamadas));
  assert.equal(get('documentos').hidden, true);
  assert.equal(get('lista-documentos').children.length, 0);
});

test('pedido.js (vm): com documentos.ver mostra "PDF do pedido" e um botão por nota com href exato', async () => {
  const { get, chamadas } = rodar({ busca: '?numero=12', detalhe: detalheOk, eu: euCom(['pedidos.ver', 'documentos.ver']),
    documentos: { status: 200, dados: { pdfPedido: true, notas: [
      { chave: CHAVE, numeroNf: '555', serie: '1' },
      { chave: 'abc', numeroNf: '9', serie: '1' },
      { chave: CHAVE + '0', numeroNf: '8', serie: '1' },
      { chave: CHAVE2, numeroNf: null, serie: null }] } } });
  await esperar();
  assert.ok(chamadas.includes('/portal/api/pedidos/12/documentos'));
  assert.equal(get('documentos').hidden, false);
  const botoes = get('lista-documentos').children;
  assert.equal(botoes.length, 3, 'PDF + 2 notas válidas (chaves que não casam são ignoradas)');
  assert.equal(botoes[0].textContent, 'PDF do pedido');
  assert.equal(botoes[0].href, '/portal/api/pedidos/12/pdf');
  assert.equal(botoes[1].href, '/portal/api/pedidos/12/danfe/' + CHAVE);
  assert.equal(botoes[2].href, '/portal/api/pedidos/12/danfe/' + CHAVE2);
  assert.match(botoes[1].textContent, /555/);
  for (const b of botoes) {
    assert.equal(b.tag, 'a');
    assert.equal(b.target, '_blank');
    assert.equal(b.rel, 'noopener');
  }
});

test('pedido.js (vm): notas vazias mostram só o PDF do pedido', async () => {
  const { get } = rodar({ busca: '?numero=12', detalhe: detalheOk, eu: euCom(['documentos.ver']),
    documentos: { status: 200, dados: { pdfPedido: true, notas: [] } } });
  await esperar();
  const botoes = get('lista-documentos').children;
  assert.equal(botoes.length, 1);
  assert.equal(botoes[0].textContent, 'PDF do pedido');
});

test('pedido.js (vm): 401 vai ao login, 404 mostra "Pedido não encontrado.", falha de rede mostra erro', async () => {
  let r = rodar({ busca: '?numero=12', detalhe: { status: 401, dados: { error: 'x' } }, eu: euCom([]), documentos: {} });
  await esperar();
  assert.deepEqual(r.chamadas, ['/portal/api/pedidos/12', 'replace:/portal/login.html']);
  r = rodar({ busca: '?numero=12', detalhe: { status: 404, dados: { error: 'Pedido não encontrado.' } }, eu: euCom(['documentos.ver']), documentos: {} });
  await esperar();
  assert.equal(r.get('erro').textContent, 'Pedido não encontrado.');
  assert.ok(!r.chamadas.some(c => /documentos/.test(c)));
  r = rodar({ busca: '?numero=12', detalhe: { status: 0, dados: { error: 'Não foi possível conectar. Verifique a internet e tente de novo.' } }, eu: euCom([]), documentos: {} });
  await esperar();
  assert.match(r.get('erro').textContent, /conectar/);
});

test('pedido.js (vm): falha em /documentos mostra erro e mantém os dados do pedido', async () => {
  const { get } = rodar({ busca: '?numero=12', detalhe: detalheOk, eu: euCom(['documentos.ver']),
    documentos: { status: 404, dados: { error: 'Documento não encontrado.' } } });
  await esperar();
  assert.equal(get('situacao').textContent, 'Em produção');
  assert.equal(get('documentos').hidden, true);
  assert.equal(get('erro').textContent, 'Documento não encontrado.');
});
