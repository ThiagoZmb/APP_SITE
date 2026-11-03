process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
// portal ligado só para este arquivo: /portal/api/eu precisa chegar à rota (401), não ao 503 de "não configurado"
process.env.PORTAL_URL_BASE = 'https://portal.exemplo.com.br';
process.env.PORTAL_CHAVE_CRIPTO = Buffer.alloc(32, 7).toString('base64');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const { subir } = require('./apoio/servidor');
const { app, registro } = require('../index.js');
const { CSP_PORTAL } = require('../portal/cabecalhos');

const PASTA = path.join(__dirname, '..', 'portal', 'public');
const arquivos = () => (fs.existsSync(PASTA) ? fs.readdirSync(PASTA) : []);
const ler = nome => fs.readFileSync(path.join(PASTA, nome), 'utf8');
const HTMLS = ['login.html', 'convite.html', 'inicio.html', 'termo.html'];
const JSS = ['portal.js', 'login.js', 'convite.js', 'inicio.js'];

test('os arquivos das páginas existem', () => {
  for (const f of [...HTMLS, ...JSS, 'portal.css']) assert.ok(arquivos().includes(f), `falta ${f}`);
});

for (const nome of HTMLS) {
  test(`${nome}: sem script inline, on*=, style=, javascript: nem URL absoluta`, () => {
    const h = ler(nome);
    assert.match(h, /<!doctype html>/i);
    assert.match(h, /<html lang="pt-BR">/);
    assert.match(h, /name="viewport"/);
    const titulo = /<title>([^<]+)<\/title>/.exec(h);
    assert.ok(titulo, 'sem title');
    const palavras = titulo[1].trim().split(/\s+/).length;
    assert.ok(palavras >= 2 && palavras <= 4, `title com ${palavras} palavras`);
    for (const m of h.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\bsrc="[^"]+"/, 'script sem src');
    assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(h), 'script com conteúdo');
    assert.ok(!/\son[a-z]+\s*=/i.test(h), 'atributo on*=');
    assert.ok(!/\sstyle\s*=/i.test(h), 'atributo style=');
    assert.ok(!/<style\b/i.test(h), 'bloco style');
    assert.ok(!/javascript:/i.test(h), 'javascript:');
    assert.ok(!/(https?:)?\/\/[a-z0-9]/i.test(h.replace(/<!--[\s\S]*?-->/g, '')), 'URL absoluta');
    // só scripts e estilos do próprio diretório do portal (src relativo, sem barra nem ..)
    for (const m of h.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) assert.match(m[1], /^[a-z_]+\.js$/);
    for (const m of h.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)) assert.match(m[1], /^[a-z_]+\.css$/);
  });
}

for (const nome of JSS) {
  test(`${nome}: compila e não usa APIs proibidas`, () => {
    const j = ler(nome);
    assert.doesNotThrow(() => new vm.Script(j, { filename: nome }));
    for (const proibido of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'document.write', 'localStorage', 'sessionStorage']) {
      assert.ok(!j.includes(proibido), `${nome} usa ${proibido}`);
    }
    assert.ok(!/console\.\w+\s*\(/.test(j), 'console no código das páginas');
    assert.ok(!/https?:\/\//i.test(j), 'URL absoluta');
  });
}

test('portal.css sem URL externa nem @import', () => {
  const c = ler('portal.css');
  assert.ok(!/https?:\/\//i.test(c));
  assert.ok(!/@import/i.test(c));
  assert.ok(!/url\(/i.test(c));
});

test('portal.js: helper chamar com credentials e os dois cabeçalhos', () => {
  const j = ler('portal.js');
  assert.match(j, /credentials:\s*'same-origin'/);
  assert.match(j, /'Content-Type':\s*'application\/json'/);
  assert.match(j, /'X-Portal':\s*'1'/);
});

test('convite.js apaga o fragmento antes da primeira chamada', () => {
  const j = ler('convite.js');
  const iSub = j.indexOf('history.replaceState');
  const iChamar = j.indexOf('chamar(');
  assert.ok(iSub > 0, 'sem replaceState');
  assert.ok(iChamar > 0, 'sem chamar');
  assert.ok(iSub < iChamar, 'replaceState depois da primeira chamada');
  assert.match(j, /location\.hash/);
  assert.match(ler('convite.html'), /src="portal\.js"/);
});

test('termo.html traz o aviso RASCUNHO visível', () => {
  assert.match(ler('termo.html'), /RASCUNHO — substituir pelo texto jurídico antes do primeiro cliente/);
});

test('convite.html: link do termo seguro', () => {
  const h = ler('convite.html');
  const a = /<a [^>]*href="\/portal\/termo\.html"[^>]*>/.exec(h);
  assert.ok(a, 'sem link do termo');
  assert.match(a[0], /target="_blank"/);
  assert.match(a[0], /rel="noopener noreferrer"/);
});

test('HTTP: páginas, cabeçalhos, tipos e caminhos proibidos', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  const r = await fetch(s.url + '/portal/login.html');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-security-policy'), CSP_PORTAL);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-type'), /^text\/html/);
  for (const [p, tipo] of [['/portal/login.js', /javascript/], ['/portal/portal.css', /^text\/css/]]) {
    const x = await fetch(s.url + p);
    assert.equal(x.status, 200, p);
    assert.match(x.headers.get('content-type'), tipo);
    assert.equal(x.headers.get('cache-control'), 'no-store');
  }
  for (const p of ['/portal/', '/portal']) {
    const x = await fetch(s.url + p, { redirect: 'manual' });
    assert.equal(x.status, 404, `${p} -> ${x.status}`);
  }
  // caminhos que tentam sair da pasta: o fetch normaliza "..", então vai por socket cru
  const cru = caminho => new Promise(ok => {
    const c = net.connect(Number(new URL(s.url).port), '127.0.0.1', () => c.write(`GET ${caminho} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let d = '';
    c.on('data', b => { d += b; });
    c.on('close', () => ok(d));
  });
  for (const p of ['/portal/../index.js', '/portal/%2e%2e/index.js', '/portal/.env', '/portal/portal.js/../../package.json', '/portal/%2e%2e%2fpackage.json', '/portal/..%5cindex.js']) {
    const resp = await cru(p);
    const corpo = resp.split('\r\n\r\n').slice(1).join('');
    assert.ok(!/require\(|"dependencies"|JWT_SECRET/.test(corpo), `${p} devolveu arquivo`);
    assert.ok(!/^HTTP\/1\.1 200/.test(resp), `${p} respondeu 200`);
  }
  const inexistente = await fetch(s.url + '/portal/nao_existe.html');
  assert.equal(inexistente.status, 404);
});

test('HTTP: /portal/api/eu continua chegando à rota (401 sem cookie)', async t => {
  const s = await subir(app);
  t.after(s.fechar);
  const r = await fetch(s.url + '/portal/api/eu');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('content-type'), /json/);
});

test('registro.verificar() passa com o static montado', () => {
  assert.doesNotThrow(() => registro.verificar());
});
