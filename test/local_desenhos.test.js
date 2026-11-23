// "Ver desenho": local/desenhos.js (lista e entrega os PDFs da pasta de rede) e o serviço local (rotas /desenhos*).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { criarDesenhos, doPedido, numeroValido } = require('../local/desenhos');

function pastaComArquivos(nomes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desenhos-'));
  nomes.forEach((n, i) => { const p = path.join(dir, n); fs.writeFileSync(p, '%PDF-1.4 ' + n); fs.utimesSync(p, new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i)); });
  return dir;
}

test('doPedido: o número abre o nome e não pode ser prefixo de outro número', () => {
  for (const n of ['22125.pdf', '22125(1).pdf', '22125_Cliente X.PDF', '22125 RM.pdf']) assert.ok(doPedido(n, '22125'), n);
  for (const n of ['221250.pdf', '2212.pdf', 'x22125.pdf', '22125.txt', '22125']) assert.ok(!doPedido(n, '22125'), n);
  assert.ok(numeroValido('1') && numeroValido('123456789'));
  for (const v of ['', 'a', '12a', '1234567890', '../1', ' 1', null, undefined, 5]) assert.ok(!numeroValido(v), String(v));
});

test('listar: só os PDFs do pedido, o mais recente primeiro; outro número e outra extensão ficam de fora', async () => {
  const dir = pastaComArquivos(['22125(1).pdf', '22125(2).pdf', '22125(3).pdf', '221250.pdf', '22126.pdf', '22125.txt']);
  const d = criarDesenhos({ pasta: dir });
  assert.deepEqual((await d.listar('22125')).map(a => a.nome), ['22125(3).pdf', '22125(2).pdf', '22125(1).pdf']);
  assert.deepEqual(await d.listar('99999'), []);
  await assert.rejects(() => d.listar('../x'), e => e.status === 400);
});

test('listar: pasta inacessível = 503 com mensagem clara (sem derrubar o serviço)', async () => {
  const d = criarDesenhos({ pasta: path.join(os.tmpdir(), 'nao-existe-' + Date.now()) });
  await assert.rejects(() => d.listar('1'), e => e.status === 503 && /pasta dos desenhos/.test(e.message));
});

test('resolver: só nome que está na pasta; barras, "..", unidade e extensão errada nunca viram caminho', async () => {
  const dir = pastaComArquivos(['100.pdf']);
  fs.writeFileSync(path.join(path.dirname(dir), 'fora.pdf'), '%PDF-');
  const d = criarDesenhos({ pasta: dir });
  assert.equal(await d.resolver('100.pdf'), path.join(dir, '100.pdf'));
  for (const n of ['../fora.pdf', '..\\fora.pdf', 'C:\\x.pdf', '/etc/x.pdf', '100.txt', '101.pdf', '', null, undefined, 'a'.repeat(300) + '.pdf']) assert.equal(await d.resolver(n), null, String(n));
  fs.rmSync(path.join(path.dirname(dir), 'fora.pdf'));
});

test('serviço local: GET /desenhos lista, GET /desenhos/arquivo entrega o PDF e recusa o que não está na pasta', async t => {
  const dir = pastaComArquivos(['500.pdf', '500(1).pdf']);
  process.env.ELEGANCE_DESENHOS = dir;
  delete require.cache[require.resolve('../local/desenhos')];
  delete require.cache[require.resolve('../local/salvador_pdf')];
  const { servidor } = require('../local/salvador_pdf');
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  t.after(() => { servidor.close(); delete process.env.ELEGANCE_DESENHOS; });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const get = u => fetch(base + u, { headers: { Origin: 'https://thiagozmb.github.io' } });
  const lista = await (await get('/desenhos?numero=500')).json();
  assert.deepEqual(lista.arquivos.map(a => a.nome), ['500(1).pdf', '500.pdf']);
  const pdf = await get('/desenhos/arquivo?nome=' + encodeURIComponent('500.pdf'));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(await pdf.text(), /^%PDF-/);
  assert.equal((await get('/desenhos/arquivo?nome=' + encodeURIComponent('../x.pdf'))).status, 404);
  assert.equal((await get('/desenhos?numero=abc')).status, 400);
  assert.equal((await fetch(base + '/desenhos?numero=500', { headers: { Origin: 'https://site-malicioso.example' } })).status, 403);
  assert.equal((await fetch(base + '/desenhos?numero=500', { method: 'POST', headers: { Origin: 'https://thiagozmb.github.io' } })).status, 405);
});

test('telas: Ver desenho está no menu do Pedido (lista, Início e calendários) e a página carrega desenho_pedido.js', () => {
  const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(ler('painel_inicial.html'), /'Ver desenho', \(\) => window\.DesenhoPedido\.ver\(numero\)/);
  assert.match(ler('inicio_menu.js'), /'Ver desenho', \(\) => window\.DesenhoPedido\.ver\(n\)/);
  for (const f of ['painel_inicial.html', 'inicio.html', 'calendario.html', 'calendario_dia.html']) assert.match(ler(f), /<script src="desenho_pedido\.js\?v=\d+" defer>/, f);
  assert.match(ler('local/instalar_salvador_pdf.ps1'), /'desenhos\.js'/);
});
