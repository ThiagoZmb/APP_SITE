// Tela das etiquetas Zebra: conferência estática dos menus + comportamento real de etiqueta_zebra.js (fetch/alert falsos).
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

function carregar(respostas) {
  const chamadas = [], avisos = [], loc = {}, removidos = [];
  const fetchFalso = async (url, opcoes = {}) => {
    chamadas.push({ url, metodo: opcoes.method || 'GET', corpo: opcoes.body, auth: opcoes.headers?.Authorization });
    const r = respostas(url, opcoes);
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => r.corpo ?? {} };
  };
  const janela = {};
  vm.runInNewContext(modulo, { window: janela, fetch: fetchFalso, alert: m => avisos.push(m), location: loc,
    localStorage: { removeItem: k => removidos.push(k) }, AbortController, setTimeout, clearTimeout });
  const imprimir = () => janela.EtiquetaZebra.imprimir('23425', { apiBase: 'https://api', loginUrl: 'login.html', token: () => 'tk' });
  return { chamadas, avisos, loc, removidos, imprimir };
}
const PING = u => u.endsWith('/ping');

test('serviço local sem resposta: avisa e não chama a API', async () => {
  const t = carregar(u => (PING(u) ? new Error('recusado') : { status: 200, corpo: {} }));
  await t.imprimir();
  assert.match(t.avisos[0], /Serviço local não encontrado neste PC/);
  assert.ok(!t.chamadas.some(c => c.url.startsWith('https://api')));
});

test('401 da API limpa a sessão e vai para o login', async () => {
  const t = carregar(u => (PING(u) ? { status: 200 } : { status: 401 }));
  await t.imprimir();
  assert.deepEqual(t.removidos, ['auth']);
  assert.equal(t.loc.href, 'login.html');
});

test('404 da API mostra a mensagem do servidor', async () => {
  const t = carregar(u => (PING(u) ? { status: 200 } : { status: 404, corpo: { error: 'Este pedido não tem itens para etiquetar.' } }));
  await t.imprimir();
  assert.match(t.avisos[0], /não tem itens/);
});

test('sucesso: busca o ZPL com o token, envia ao serviço local e confirma a quantidade', async () => {
  const t = carregar(u => (PING(u) ? { status: 200 }
    : u.startsWith('https://api') ? { status: 200, corpo: { zpl: '^XA^XZ', quantidade: 2 } }
      : { status: 200, corpo: { ok: true, impressora: 'ZDesigner ZD220' } }));
  await t.imprimir();
  const api = t.chamadas.find(c => c.url === 'https://api/etiquetas/pedido/23425');
  assert.equal(api.auth, 'Bearer tk');
  const envio = t.chamadas.find(c => c.url === 'http://127.0.0.1:3917/etiqueta');
  assert.equal(envio.metodo, 'POST');
  assert.deepEqual(JSON.parse(envio.corpo), { zpl: '^XA^XZ' });
  assert.match(t.avisos[0], /2 etiqueta\(s\).*ZDesigner ZD220/);
});

test('erro do serviço local na impressão é mostrado', async () => {
  const t = carregar(u => (PING(u) ? { status: 200 }
    : u.startsWith('https://api') ? { status: 200, corpo: { zpl: '^XA^XZ', quantidade: 1 } }
      : { status: 500, corpo: { error: 'Nenhuma impressora Zebra encontrada.' } }));
  await t.imprimir();
  assert.match(t.avisos[0], /Nenhuma impressora Zebra encontrada/);
});
