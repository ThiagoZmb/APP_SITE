// Serviço local da Zebra (local/zebra.js, rota POST /etiqueta do salvador de PDF). Sem impressora e sem PowerShell:
// o envio e a listagem de impressoras são trocados por falsos na instância.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-zebra-'));
process.env.ELEGANCE_RAIZ = path.join(raiz, 'Programa Elegance');
const { servidor, zebra } = require('../local/salvador_pdf');
const { validarZpl, escolherImpressora } = require('../local/zebra');

const ZPL = '^XA^FDteste^FS^XZ';
let base;
test.before(async () => { await new Promise(ok => servidor.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${servidor.address().port}`; });
test.after(() => { servidor.close(); fs.rmSync(raiz, { recursive: true, force: true }); });

const post = (corpo, headers = {}) => fetch(base + '/etiqueta', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(corpo) });
function falsos({ nomes = ['HP LaserJet', 'ZDesigner ZD220'], config = {}, falha } = {}) {
  const envios = [];
  zebra.listar = async () => nomes;
  zebra.config = config;
  zebra.enviar = async (impressora, zpl) => { if (falha) throw new Error(falha); envios.push({ impressora, zpl }); };
  return envios;
}

test('validarZpl aceita ^XA…^XZ e recusa o resto', () => {
  assert.equal(validarZpl(ZPL).ok, true);
  for (const ruim of ['texto', '^XAsem fim', 'sem inicio^XZ', 42, null, '^XA' + 'x'.repeat(1024 * 1024) + '^XZ']) assert.equal(validarZpl(ruim).ok, false);
});

test('escolherImpressora: config manda; sem config acha Zebra/ZDesigner; sem nada é null', () => {
  assert.equal(escolherImpressora(['HP LaserJet', 'ZDesigner ZD220'], {}), 'ZDesigner ZD220');
  assert.equal(escolherImpressora(['HP LaserJet', 'Zebra ZD421'], {}), 'Zebra ZD421');
  assert.equal(escolherImpressora(['HP LaserJet', 'ZDesigner ZD220'], { impressora: 'HP LaserJet' }), 'HP LaserJet');
  assert.equal(escolherImpressora(['HP LaserJet'], {}), null);
});

test('POST /etiqueta envia uma vez à impressora escolhida', async () => {
  const envios = falsos();
  const r = await post({ zpl: ZPL });
  assert.equal(r.status, 200);
  assert.deepEqual(envios, [{ impressora: 'ZDesigner ZD220', zpl: ZPL }]);
  assert.equal((await r.json()).impressora, 'ZDesigner ZD220');
});

test('a impressora do corpo da requisição é ignorada', async () => {
  const envios = falsos();
  await post({ zpl: ZPL, impressora: 'HP LaserJet' });
  assert.equal(envios[0].impressora, 'ZDesigner ZD220');
});

test('ZPL inválido é 400 e não envia', async () => {
  const envios = falsos();
  assert.equal((await post({ zpl: 'qualquer coisa' })).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal(envios.length, 0);
});

test('sem impressora é 500 com a lista; falha no envio é 500 e o serviço segue vivo', async () => {
  falsos({ nomes: ['HP LaserJet'] });
  let r = await post({ zpl: ZPL });
  assert.equal(r.status, 500);
  assert.deepEqual((await r.json()).impressoras, ['HP LaserJet']);
  falsos({ falha: 'spooler parado' });
  r = await post({ zpl: ZPL });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /spooler parado/);
  assert.equal((await fetch(base + '/ping')).status, 200);
});

test('origem estranha é 403 e o ping informa zebra', async () => {
  const envios = falsos();
  assert.equal((await post({ zpl: ZPL }, { Origin: 'https://site-estranho.com' })).status, 403);
  assert.equal(envios.length, 0);
  const ping = await (await fetch(base + '/ping', { headers: { Origin: 'https://thiagozmb.github.io' } })).json();
  assert.equal(ping.zebra, true);
  const r = await fetch(base + '/etiqueta', { method: 'OPTIONS', headers: { Origin: 'https://thiagozmb.github.io' } });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-headers'), /Content-Type/);
});
