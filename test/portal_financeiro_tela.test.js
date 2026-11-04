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

test('financeiro.html e financeiro.js existem', () => {
  assert.ok(existe('financeiro.html'), 'falta financeiro.html');
  assert.ok(existe('financeiro.js'), 'falta financeiro.js');
});

test('financeiro.html: sem script inline, style= nem on*=; tem resumo, abas, tabela, paginação e erro', () => {
  const h = ler('financeiro.html');
  for (const m of h.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\bsrc="[^"]+"/);
  assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(h), 'script com conteúdo');
  assert.ok(!/\sstyle\s*=/i.test(h), 'style=');
  assert.ok(!/\son[a-z]+\s*=/i.test(h), 'on*=');
  assert.match(h, /<script src="financeiro\.js">/);
  assert.match(h, /<p id="erro" class="erro" role="alert"/);
  for (const t of ['A receber', 'Em atraso', 'Em aberto', 'Pagos', 'Vencimento', 'Pedido', 'Nota fiscal', 'Valor', 'Situação']) assert.ok(h.includes(t), 'texto ' + t);
  for (const id of ['aba-abertos', 'aba-pagos', 'resumo-receber', 'resumo-atraso', 'anterior', 'proxima', 'corpo']) assert.ok(h.includes(`id="${id}"`), 'falta #' + id);
  assert.match(h, /href="inicio\.html"/);
});

test('financeiro.js: APIs proibidas, textContent, rota, visao/pagina e 401', () => {
  const j = ler('financeiro.js');
  assert.doesNotThrow(() => new vm.Script(j));
  for (const p of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'document.write', 'new Date', 'Intl', 'toLocale']) assert.ok(!j.includes(p), p);
  assert.ok(j.includes('textContent'));
  assert.ok(j.includes('/portal/api/financeiro'));
  assert.ok(j.includes('visao=') && j.includes('pagina='));
  assert.ok(j.includes('/portal/login.html'));
});

test('inicio.html tem o link Financeiro oculto por padrão', () => {
  const h = ler('inicio.html');
  assert.match(h, /<a href="financeiro\.html" id="link-financeiro" hidden>Financeiro<\/a>/);
  assert.match(h, /<a href="pedidos\.html">Meus pedidos<\/a>/);
});

function rodarInicio(permissoes) {
  const el = {};
  const novo = () => ({ textContent: '', hidden: undefined, addEventListener() {} });
  const get = id => (el[id] = el[id] || novo());
  get('link-financeiro').hidden = true;
  const usuario = { email: 'a@b.c', empresa: { razaoSocial: 'X' } };
  if (permissoes !== undefined) usuario.permissoes = permissoes;
  const janela = { location: {}, PortalApi: { chamar: async () => ({ status: 200, dados: { usuario } }) } };
  vm.runInNewContext(ler('inicio.js'), { window: janela, document: { getElementById: get } });
  return get;
}

test('inicio.js: mostra o link Financeiro só com financeiro.ver', async () => {
  let get = rodarInicio(['pedidos.ver', 'financeiro.ver']);
  await esperar();
  assert.equal(get('link-financeiro').hidden, false);
  get = rodarInicio(['pedidos.ver']);
  await esperar();
  assert.equal(get('link-financeiro').hidden, true);
  get = rodarInicio(undefined);
  await esperar();
  assert.equal(get('link-financeiro').hidden, true);
});

function rodar(resposta) {
  const el = {};
  // como no DOM real, atribuir textContent apaga os filhos
  const novo = () => ({ _t: '', get textContent() { return this._t; }, set textContent(v) { this._t = v; this.children = []; },
    disabled: false, children: [], ouvintes: {}, atributos: {},
    appendChild(f) { this.children.push(f); }, addEventListener(t, f) { this.ouvintes[t] = f; },
    setAttribute(k, v) { this.atributos[k] = String(v); } });
  const get = id => (el[id] = el[id] || novo());
  const chamadas = [];
  const janela = { location: { replace: u => chamadas.push('replace:' + u) },
    PortalApi: { chamar: async c => { chamadas.push(c); return typeof resposta === 'function' ? resposta(c) : resposta; } } };
  const documento = { getElementById: get, createElement: tag => ({ tag, textContent: '', children: [], appendChild(f) { this.children.push(f); } }) };
  vm.runInNewContext(ler('financeiro.js'), { window: janela, document: documento });
  return { get, chamadas };
}
const esperar = () => new Promise(r => setImmediate(r));
const celulas = tr => tr.children.map(c => c.textContent);
const resumo = { aReceber: 1000.5, emAtraso: 20 };
const titulo = (o = {}) => ({ vencimento: '2026-03-09', pedido: 12, notaFiscal: '555', valor: 1000.5, situacao: 'A receber', ...o });

test('financeiro.js (vm): resumo em reais, linhas com DD/MM/AAAA e "—" para nulos, Anterior desabilitado', async () => {
  const { get, chamadas } = rodar({ status: 200, dados: { resumo, visao: 'abertos', pagina: 1, temMais: true, titulos: [
    titulo(),
    titulo({ vencimento: '2026-01-02', pedido: null, notaFiscal: null, valor: 5, situacao: 'Em atraso' }),
    titulo({ valor: 1234567.891, situacao: 'Protestado' })] } });
  await esperar();
  assert.equal(chamadas[0], '/portal/api/financeiro?visao=abertos&pagina=1');
  assert.equal(get('resumo-receber').textContent, 'R$ 1.000,50');
  assert.equal(get('resumo-atraso').textContent, 'R$ 20,00');
  const linhas = get('corpo').children;
  assert.equal(linhas.length, 3);
  assert.deepEqual(celulas(linhas[0]), ['09/03/2026', '12', '555', 'R$ 1.000,50', 'A receber']);
  assert.deepEqual(celulas(linhas[1]), ['02/01/2026', '—', '—', 'R$ 5,00', 'Em atraso']);
  assert.equal(celulas(linhas[2])[3], 'R$ 1.234.567,89');
  assert.equal(get('anterior').disabled, true);
  assert.equal(get('proxima').disabled, false);
});

test('financeiro.js (vm): aba Pagos troca a visão e volta à página 1; Próxima sem temMais fica desabilitada', async () => {
  const { get, chamadas } = rodar(c => ({ status: 200, dados: { resumo, visao: 'x', pagina: 1, temMais: c.includes('pagina=1') && c.includes('abertos'), titulos: [
    titulo({ situacao: c.includes('pagos') ? 'Pago' : 'A receber' })] } }));
  await esperar();
  await get('proxima').ouvintes.click();
  assert.equal(chamadas[1], '/portal/api/financeiro?visao=abertos&pagina=2');
  assert.equal(get('proxima').disabled, true);
  assert.equal(get('anterior').disabled, false);
  await get('aba-pagos').ouvintes.click();
  assert.equal(chamadas[2], '/portal/api/financeiro?visao=pagos&pagina=1');
  assert.equal(celulas(get('corpo').children[0])[4], 'Pago');
  assert.equal(get('anterior').disabled, true);
  assert.equal(get('aba-pagos').atributos['aria-pressed'], 'true');
  assert.equal(get('aba-abertos').atributos['aria-pressed'], 'false');
  await get('aba-abertos').ouvintes.click();
  assert.equal(chamadas[3], '/portal/api/financeiro?visao=abertos&pagina=1');
  assert.equal(get('aba-abertos').atributos['aria-pressed'], 'true');
});

test('financeiro.js (vm): falha ao trocar de aba ou de página mantém tabela, aba e página anteriores', async () => {
  let falhar = true;
  const { get, chamadas } = rodar(c => {
    if (falhar && (c.includes('visao=pagos') || c.endsWith('pagina=2'))) return { status: 500, dados: { error: 'Erro de servidor' } };
    if (falhar === 0) return { status: 0, dados: null };
    return { status: 200, dados: { resumo, visao: 'abertos', pagina: 1, temMais: c.endsWith('pagina=1'), titulos: [titulo({ pedido: c.includes('pagos') ? 99 : c.endsWith('pagina=2') ? 2 : 1 })] } };
  });
  await esperar();
  // falha ao trocar de aba
  await get('aba-pagos').ouvintes.click();
  assert.equal(get('erro').textContent, 'Erro de servidor');
  assert.equal(celulas(get('corpo').children[0])[1], '1', 'tabela antiga mantida');
  assert.equal(get('aba-abertos').atributos['aria-pressed'], 'true', 'aba antiga mantida');
  assert.equal(get('aba-pagos').atributos['aria-pressed'], 'false');
  assert.equal(get('proxima').disabled, false);
  assert.equal(get('anterior').disabled, true);
  // falha ao avançar (status 0 = sem rede)
  falhar = 0;
  await get('proxima').ouvintes.click();
  assert.ok(get('erro').textContent.length > 0);
  assert.equal(celulas(get('corpo').children[0])[1], '1');
  assert.equal(get('anterior').disabled, true, 'continua na página 1');
  assert.equal(get('proxima').disabled, false);
  // a nova tentativa funciona e a página 2 é pedida (não a 3)
  falhar = false;
  await get('proxima').ouvintes.click();
  assert.equal(chamadas[chamadas.length - 1], '/portal/api/financeiro?visao=abertos&pagina=2');
  assert.equal(celulas(get('corpo').children[0])[1], '2');
  assert.equal(get('erro').textContent, '');
  // depois de avançar, falha na troca de aba mantém a página 2
  falhar = true;
  await get('aba-pagos').ouvintes.click();
  await get('anterior').ouvintes.click();
  assert.equal(chamadas[chamadas.length - 1], '/portal/api/financeiro?visao=abertos&pagina=1');
});

test('financeiro.js (vm): lista vazia, 401 e erro na primeira carga', async () => {
  let r = rodar({ status: 200, dados: { resumo, visao: 'abertos', pagina: 1, temMais: false, titulos: [] } });
  await esperar();
  assert.equal(r.get('erro').textContent, 'Nenhum título encontrado.');
  r = rodar({ status: 401, dados: { error: 'x' } });
  await esperar();
  assert.deepEqual(r.chamadas, ['/portal/api/financeiro?visao=abertos&pagina=1', 'replace:/portal/login.html']);
  r = rodar({ status: 500, dados: { error: 'Erro de servidor' } });
  await esperar();
  assert.equal(r.get('erro').textContent, 'Erro de servidor');
});
