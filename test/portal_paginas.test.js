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
const HTMLS = ['login.html', 'convite.html', 'inicio.html', 'termo.html', 'pedidos.html', 'financeiro.html'];
const JSS = ['portal.js', 'login.js', 'convite.js', 'inicio.js', 'pedidos.js', 'financeiro.js'];

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

// roda convite.js num vm com window/document falsos e registra a ordem das chamadas
function rodarConvite({ hash, respostas = [] }) {
  const eventos = [];
  const elementos = {};
  const el = id => (elementos[id] = elementos[id] || {
    id, textContent: '', value: '', checked: false, disabled: id === 'concluir', children: [], ouvintes: {},
    classList: { add() {}, remove() {} },
    addEventListener(tipo, f) { this.ouvintes[tipo] = f; },
    appendChild(f) { this.children.push(f); },
    focus() { eventos.push('foco:' + id); }
  });
  const janela = {
    location: { hash, pathname: '/portal/convite.html', search: '', assign: u => eventos.push('assign:' + u), replace: u => eventos.push('replace:' + u) },
    history: { replaceState: () => eventos.push('replaceState') },
    PortalApi: { chamar: async (caminho, corpo) => { eventos.push('chamar:' + caminho); return respostas.shift() || { status: 400, dados: {} }; } },
    addEventListener(tipo, f) { janela['ev_' + tipo] = f; }
  };
  const documento = { getElementById: el, createElement: () => ({ textContent: '' }) };
  vm.runInNewContext(ler('convite.js'), { window: janela, document: documento });
  return { eventos, el, janela };
}
const TOKEN = 'A'.repeat(43);
const esperar = () => new Promise(r => setImmediate(r));

test('convite.js (vm): replaceState antes da primeira chamada, com o X-Portal vindo do helper', async () => {
  const { eventos } = rodarConvite({ hash: '#' + TOKEN, respostas: [{ status: 400, dados: { error: 'Convite inválido ou expirado.' } }] });
  await esperar();
  assert.deepEqual(eventos.slice(0, 2), ['replaceState', 'chamar:/portal/api/convite/iniciar']);
});

test('convite.js (vm): fragmento malformado (URIError) é apagado e mostra convite inválido sem chamar a API', async () => {
  const { eventos, el } = rodarConvite({ hash: '#%E0%A4%A' });
  await esperar();
  assert.deepEqual(eventos, ['replaceState']);
  assert.equal(el('erro').textContent, 'Convite inválido ou expirado.');
});

test('convite.js (vm): sem token pede para abrir o link de novo', async () => {
  const { eventos, el } = rodarConvite({ hash: '' });
  await esperar();
  assert.deepEqual(eventos, ['replaceState']);
  assert.match(el('erro').textContent, /Abra de novo o link do convite/);
});

test('convite.js (vm): códigos aparecem uma vez, recebem foco, e Já guardei / pageshow os limpam', async () => {
  const ini = { status: 200, dados: { email: 'a@b.c', segredo: 'ABCDEFGH', uri: 'otpauth://x', termoVersao: 'v1' } };
  const fim = { status: 200, dados: { ok: true, codigosRecuperacao: ['c1', 'c2'] } };
  const { eventos, el, janela } = rodarConvite({ hash: '#' + TOKEN, respostas: [ini, fim] });
  await esperar();
  assert.equal(el('concluir').disabled, false);
  el('senha').value = 'uma senha bem longa'; el('confirmacao').value = 'uma senha bem longa'; el('aceite').checked = true; el('codigo').value = '123456';
  await el('form-convite').ouvintes.submit({ preventDefault() {} });
  assert.equal(el('lista-codigos').children.length, 2);
  assert.ok(eventos.includes('foco:titulo-codigos'));
  el('guardei').ouvintes.click();
  assert.equal(el('lista-codigos').textContent, '');
  assert.ok(eventos.includes('assign:/portal/login.html'));
  el('lista-codigos').textContent = 'x';
  janela.ev_pageshow({ persisted: true });
  assert.equal(el('lista-codigos').textContent, '');
  assert.ok(eventos.includes('replace:/portal/login.html'));
});

test('HTML do portal: formulários só por POST, sem input com name e botão de envio nasce desabilitado', () => {
  const visto = { forms: 0, inputs: 0, envios: 0 };
  for (const nome of HTMLS) {
    const h = ler(nome);
    const forms = [...h.matchAll(/<form\b([^>]*)>/gi)];
    if (nome === 'login.html' || nome === 'convite.html') assert.ok(forms.length >= 1, nome + ': nenhum <form> encontrado (teste vazio)');
    for (const m of forms) {
      visto.forms++;
      assert.match(m[1], /\smethod="post"/, nome + ': form sem method=post');
      assert.ok(!/\saction\s*=/i.test(m[1]), nome + ': form com action');
    }
    for (const m of h.matchAll(/<input\b([^>]*)>/gi)) {
      visto.inputs++;
      assert.ok(!/\sname\s*=/i.test(m[1]), nome + ': input com name');
    }
    for (const m of h.matchAll(/<button\b([^>]*)>/gi)) {
      if (/type="submit"/.test(m[1])) {
        visto.envios++;
        assert.match(m[1], /\sdisabled\b/, nome + ': botão de envio habilitado');
      }
    }
  }
  assert.ok(visto.forms >= 2 && visto.inputs > 0 && visto.envios >= 2, 'cobertura vazia: ' + JSON.stringify(visto));
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
  for (const pagina of ['/portal/login.html', '/portal/pedidos.html', '/portal/financeiro.html']) {
    const r = await fetch(s.url + pagina);
    assert.equal(r.status, 200, pagina);
    assert.equal(r.headers.get('content-security-policy'), CSP_PORTAL, pagina);
    assert.equal(r.headers.get('cache-control'), 'no-store', pagina);
    assert.match(r.headers.get('content-type'), /^text\/html/, pagina);
  }
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
