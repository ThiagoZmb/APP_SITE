// "Ver desenho": local/desenhos.js (procura e entrega os PDFs da pasta de rede) e o serviço local (rotas /desenhos*).
// Estrutura simulada, igual à da empresa: raiz/{Para conferir PDF (+PARTICULARES), Prontos/{Com nº de Pedido, Sem nº de Pedido}, Outros}
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarDesenhos, doPedido, numeroValido, paginaTodos } = require('../local/desenhos');

const PRINC = 'Para conferir PDF';
// arquivos = ['Para conferir PDF/22125(1).pdf', 'Prontos/Com nº de Pedido/100 1.pdf', ...]; o mtime cresce na ordem da lista
function raizCom(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desenhos-'));
  fs.mkdirSync(path.join(dir, PRINC), { recursive: true });
  arquivos.forEach((rel, i) => {
    const p = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '%PDF-1.4 ' + rel);
    fs.utimesSync(p, new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i));
  });
  return dir;
}

test('doPedido: o número abre o nome e não pode ser prefixo de outro número', () => {
  for (const n of ['22125.pdf', '22125(1).pdf', '22125_Cliente X.PDF', '22125 RM.pdf', '22125 1.pdf']) assert.ok(doPedido(n, '22125'), n);
  for (const n of ['221250.pdf', '2212.pdf', 'x22125.pdf', '22125.txt', '22125']) assert.ok(!doPedido(n, '22125'), n);
  assert.ok(numeroValido('1') && numeroValido('123456789'));
  for (const v of ['', 'a', '12a', '1234567890', '../1', ' 1', null, undefined, 5]) assert.ok(!numeroValido(v), String(v));
});

test('listar: acha em "Para conferir PDF", o mais recente primeiro; outro número e outra extensão ficam de fora', async () => {
  const raiz = raizCom([`${PRINC}/22125(1).pdf`, `${PRINC}/22125(2).pdf`, `${PRINC}/22125(3).pdf`, `${PRINC}/221250.pdf`, `${PRINC}/22126.pdf`, `${PRINC}/22125.txt`]);
  const d = criarDesenhos({ pasta: raiz });
  const r = await d.listarTudo('22125');
  assert.equal(r.origem, 'conferir');
  assert.deepEqual(r.arquivos.map(a => a.nome), ['22125(3).pdf', '22125(2).pdf', '22125(1).pdf']);
  assert.deepEqual(r.arquivos.map(a => a.caminho), r.arquivos.map(a => `${PRINC}/${a.nome}`));
  assert.deepEqual((await d.listarTudo('99999')), { arquivos: [], origem: 'nenhuma' });
  await assert.rejects(() => d.listar('../x'), e => e.status === 400);
});

test('listar: sem nada em "Para conferir PDF", procura nas outras pastas e subpastas (Prontos, Outros)', async () => {
  const raiz = raizCom([
    'Prontos/Com nº de Pedido/17896 1.pdf', 'Prontos/Com nº de Pedido/17896 2.pdf', 'Prontos/Sem nº de Pedido/Adega 17896.pdf',
    'Outros/17896 antigo.pdf', 'Outros/178960.pdf', `${PRINC}/PARTICULARES/Fruteira.pdf`]);
  const d = criarDesenhos({ pasta: raiz });
  const r = await d.listarTudo('17896');
  assert.equal(r.origem, 'outras');
  assert.deepEqual(r.arquivos.map(a => a.caminho).sort(), ['Outros/17896 antigo.pdf', 'Prontos/Com nº de Pedido/17896 1.pdf', 'Prontos/Com nº de Pedido/17896 2.pdf']);
  assert.deepEqual(r.arquivos.find(a => a.nome === '17896 1.pdf').pasta, 'Prontos/Com nº de Pedido');
});

test('listar: achou em "Para conferir PDF" (inclusive em PARTICULARES) NÃO mistura com o que está nas outras pastas', async () => {
  const raiz = raizCom(['Prontos/Com nº de Pedido/300 1.pdf', `${PRINC}/PARTICULARES/300 particular.pdf`, `${PRINC}/300.pdf`]);
  const r = await criarDesenhos({ pasta: raiz }).listarTudo('300');
  assert.equal(r.origem, 'conferir');
  assert.deepEqual(r.arquivos.map(a => a.caminho).sort(), [`${PRINC}/300.pdf`, `${PRINC}/PARTICULARES/300 particular.pdf`]);
});

test('listar: raiz inacessível = 503 com mensagem clara (sem derrubar o serviço)', async () => {
  const d = criarDesenhos({ pasta: path.join(os.tmpdir(), 'nao-existe-' + Date.now()) });
  await assert.rejects(() => d.listar('1'), e => e.status === 503 && /pasta dos desenhos/.test(e.message));
});

test('resolver: só caminho que existe na pasta; "..", barras, unidade, pasta no lugar de arquivo e extensão errada nunca passam', async () => {
  const raiz = raizCom(['Prontos/Com nº de Pedido/100 1.pdf', `${PRINC}/200.pdf`]);
  fs.writeFileSync(path.join(path.dirname(raiz), 'fora.pdf'), '%PDF-');
  const d = criarDesenhos({ pasta: raiz });
  assert.equal(await d.resolver('Prontos/Com nº de Pedido/100 1.pdf'), path.join(raiz, 'Prontos', 'Com nº de Pedido', '100 1.pdf'));
  assert.equal(await d.resolver(`${PRINC}/200.pdf`), path.join(raiz, PRINC, '200.pdf'));
  for (const n of ['../fora.pdf', '..\\fora.pdf', `${PRINC}/../../fora.pdf`, 'C:\\x.pdf', '/etc/x.pdf', '/Prontos/Com nº de Pedido/100 1.pdf', 'Prontos//100 1.pdf', 'Prontos/Com nº de Pedido',
    'Prontos/Com nº de Pedido/100 1.txt', 'Prontos/101.pdf', '', null, undefined, 'a'.repeat(700), 'a/b/c/d/e/f.pdf']) assert.equal(await d.resolver(n), null, String(n));
  fs.rmSync(path.join(path.dirname(raiz), 'fora.pdf'));
});

test('paginaTodos: nome e pasta escapados (nunca viram HTML), sem script, caminho codificado', () => {
  const h = paginaTodos('1', [{ nome: '1"><img src=x onerror=alert(1)>.pdf', pasta: 'Prontos/<b>x</b>', caminho: 'Prontos/a b/1.pdf' }]);
  assert.doesNotMatch(h, /<img|<script|<b>|onerror=alert\(1\)>/);
  assert.match(h, /&lt;img/);
  assert.match(h, /src="\/desenhos\/arquivo\?caminho=Prontos%2Fa%20b%2F1\.pdf"/);
});

test('serviço local: /desenhos lista (com origem), /desenhos/ver junta tudo numa página, /desenhos/arquivo entrega o PDF e recusa o que não está na pasta', async t => {
  const raiz = raizCom([`${PRINC}/500.pdf`, `${PRINC}/500(1).pdf`, 'Prontos/Com nº de Pedido/600 1.pdf', 'Prontos/Com nº de Pedido/600 2.pdf']);
  process.env.ELEGANCE_DESENHOS = raiz;
  delete require.cache[require.resolve('../local/desenhos')];
  delete require.cache[require.resolve('../local/salvador_pdf')];
  const { servidor } = require('../local/salvador_pdf');
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  t.after(() => { servidor.close(); delete process.env.ELEGANCE_DESENHOS; });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const get = u => fetch(base + u, { headers: { Origin: 'https://thiagozmb.github.io' } });
  const lista = await (await get('/desenhos?numero=500')).json();
  assert.equal(lista.origem, 'conferir');
  assert.deepEqual(lista.arquivos.map(a => a.nome), ['500(1).pdf', '500.pdf']);
  const entregue = await (await get('/desenhos?numero=600')).json();
  assert.equal(entregue.origem, 'outras');
  assert.deepEqual(entregue.arquivos.map(a => a.caminho).sort(), ['Prontos/Com nº de Pedido/600 1.pdf', 'Prontos/Com nº de Pedido/600 2.pdf']);
  const pdf = await get('/desenhos/arquivo?caminho=' + encodeURIComponent('Prontos/Com nº de Pedido/600 1.pdf'));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(await pdf.text(), /^%PDF-/);
  assert.equal((await get('/desenhos/arquivo?caminho=' + encodeURIComponent('../x.pdf'))).status, 404);
  const todos = await get('/desenhos/ver?numero=600');
  assert.equal(todos.status, 200);
  assert.match(todos.headers.get('content-type'), /text\/html/);
  const pagina = await todos.text();
  assert.equal((pagina.match(/<iframe/g) || []).length, 2, 'um quadro por desenho, tudo numa aba só');
  assert.match(pagina, /pasta: Prontos\/Com nº de Pedido/);
  assert.equal((await get('/desenhos/ver?numero=abc')).status, 400);
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
  assert.match(ler('desenho_pedido.js'), /arquivos\[0\]\.caminho/);
});
