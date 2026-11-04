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

test('pedidos.html e pedidos.js existem', () => {
  assert.ok(existe('pedidos.html'), 'falta pedidos.html');
  assert.ok(existe('pedidos.js'), 'falta pedidos.js');
});

test('pedidos.html: sem script inline, style= nem on*=; tem tabela, paginação e erro', () => {
  const h = ler('pedidos.html');
  for (const m of h.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\bsrc="[^"]+"/);
  assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(h), 'script com conteúdo');
  assert.ok(!/\sstyle\s*=/i.test(h), 'style=');
  assert.ok(!/\son[a-z]+\s*=/i.test(h), 'on*=');
  assert.match(h, /<script src="pedidos\.js">/);
  assert.match(h, /<p id="erro" class="erro" role="alert"/);
  for (const t of ['Número', 'Data', 'Situação', 'Entrega', 'Previsão/Data']) assert.ok(h.includes(t), 'cabeçalho ' + t);
  for (const id of ['anterior', 'proxima', 'corpo']) assert.ok(h.includes(`id="${id}"`), 'falta #' + id);
  assert.match(h, /href="inicio\.html"/);
});

test('pedidos.js: APIs proibidas, textContent, rota e 401', () => {
  const j = ler('pedidos.js');
  assert.doesNotThrow(() => new vm.Script(j));
  for (const p of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'document.write', 'new Date']) assert.ok(!j.includes(p), p);
  assert.ok(j.includes('textContent'));
  assert.ok(j.includes('/portal/api/pedidos'));
  assert.ok(j.includes('/portal/login.html'));
});

test('inicio.html leva a pedidos.html e já não promete a próxima etapa', () => {
  const h = ler('inicio.html');
  assert.match(h, /<a href="pedidos\.html">Meus pedidos<\/a>/);
  assert.ok(!/próxima etapa/i.test(h));
});

function rodar(resposta) {
  const el = {};
  // como no DOM real, atribuir textContent apaga os filhos
  const novo = () => ({ _t: '', get textContent() { return this._t; }, set textContent(v) { this._t = v; this.children = []; },
    disabled: false, children: [], ouvintes: {},
    appendChild(f) { this.children.push(f); }, addEventListener(t, f) { this.ouvintes[t] = f; } });
  const get = id => (el[id] = el[id] || novo());
  const chamadas = [];
  const janela = { location: { replace: u => chamadas.push('replace:' + u) },
    PortalApi: { chamar: async c => { chamadas.push(c); return typeof resposta === 'function' ? resposta(c) : resposta; } } };
  const documento = { getElementById: get, createElement: tag => ({ tag, textContent: '', children: [], appendChild(f) { this.children.push(f); } }) };
  vm.runInNewContext(ler('pedidos.js'), { window: janela, document: documento });
  return { get, chamadas };
}
const esperar = () => new Promise(r => setImmediate(r));
const celulas = tr => tr.children.map(c => c.textContent);

test('pedidos.js (vm): monta linhas com datas DD/MM/AAAA e "—" para nulos; Anterior desabilitado na página 1', async () => {
  const { get, chamadas } = rodar({ status: 200, dados: { pagina: 1, temMais: true, pedidos: [
    { numero: 12, data: '2026-03-09', situacao: 'Entregue', dataEntrega: '2026-03-20', entrega: 'Entregue', dataAgendada: null },
    { numero: 11, data: '2026-03-01', situacao: 'Em produção', dataEntrega: null, entrega: null, dataAgendada: null }] } });
  await esperar();
  assert.equal(chamadas[0], '/portal/api/pedidos?pagina=1');
  const linhas = get('corpo').children;
  assert.equal(linhas.length, 2);
  assert.deepEqual(celulas(linhas[0]), ['12', '09/03/2026', 'Entregue', 'Entregue', '20/03/2026']);
  assert.deepEqual(celulas(linhas[1]), ['11', '01/03/2026', 'Em produção', '—', '—']);
  assert.equal(get('anterior').disabled, true);
  assert.equal(get('proxima').disabled, false);
});

test('pedidos.js (vm): Próxima carrega a página 2 e a última desabilita Próxima', async () => {
  const { get, chamadas } = rodar(c => ({ status: 200, dados: { pagina: Number(c.split('=')[1]), temMais: false, pedidos: [
    { numero: 1, data: '2026-01-02', situacao: 'Pronto', dataEntrega: null, entrega: 'Entrega agendada', dataAgendada: '2026-01-10' }] } }));
  await esperar();
  await get('proxima').ouvintes.click();
  assert.equal(chamadas[1], '/portal/api/pedidos?pagina=2');
  assert.equal(get('proxima').disabled, true);
  assert.equal(get('anterior').disabled, false);
  assert.equal(get('corpo').children.length, 1);
  assert.deepEqual(celulas(get('corpo').children[0]), ['1', '02/01/2026', 'Pronto', 'Entrega agendada', '10/01/2026']);
});

test('pedidos.js (vm): falha ao avançar mantém a tabela antiga, a página atual e Próxima habilitada para tentar de novo', async () => {
  let falhar = true;
  const { get, chamadas } = rodar(c => {
    if (c.endsWith('pagina=2') && falhar) return { status: 500, dados: { error: 'Erro de servidor' } };
    return { status: 200, dados: { pagina: Number(c.split('=')[1]), temMais: c.endsWith('pagina=1'), pedidos: [
      { numero: Number(c.split('=')[1]), data: '2026-01-02', situacao: 'Pronto', dataEntrega: null, entrega: null, dataAgendada: null }] } };
  });
  await esperar();
  await get('proxima').ouvintes.click();
  assert.equal(get('erro').textContent, 'Erro de servidor');
  assert.equal(get('proxima').disabled, false, 'Próxima continua habilitada');
  assert.equal(get('anterior').disabled, true, 'continua na página 1');
  assert.equal(get('corpo').children.length, 1);
  assert.equal(celulas(get('corpo').children[0])[0], '1', 'tabela antiga mantida');
  falhar = false;
  await get('proxima').ouvintes.click();
  assert.equal(chamadas[chamadas.length - 1], '/portal/api/pedidos?pagina=2');
  assert.equal(celulas(get('corpo').children[0])[0], '2');
  assert.equal(get('anterior').disabled, false);
  assert.equal(get('proxima').disabled, true);
});

test('pedidos.js (vm): lista vazia, 401 e erro', async () => {
  let r = rodar({ status: 200, dados: { pagina: 1, temMais: false, pedidos: [] } });
  await esperar();
  assert.equal(r.get('erro').textContent, 'Nenhum pedido encontrado.');
  r = rodar({ status: 401, dados: { error: 'x' } });
  await esperar();
  assert.deepEqual(r.chamadas, ['/portal/api/pedidos?pagina=1', 'replace:/portal/login.html']);
  r = rodar({ status: 500, dados: { error: 'Erro de servidor' } });
  await esperar();
  assert.equal(r.get('erro').textContent, 'Erro de servidor');
});
