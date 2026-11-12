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
const { validarZpl, escolherImpressora, executar } = require('../local/zebra');

const ZPL = '^XA^FDteste^FS^XZ';
let base;
test.before(async () => { await new Promise(ok => servidor.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${servidor.address().port}`; });
test.after(() => { servidor.close(); fs.rmSync(raiz, { recursive: true, force: true }); });

const post = (corpo, headers = {}) => fetch(base + '/etiqueta', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(corpo) });
const imp = (nome, porta, extra = {}) => ({ nome, porta, driver: extra.driver || nome, status: 'Normal', offline: false, ...extra });
const USB = imp('ZDesigner ZD220', 'USB001');
const ARQUIVO = imp('ZDesigner for Developers - Generic Printer 600dpi', 'FILE:');
function falsos({ nomes = [imp('HP LaserJet', 'IP_10.0.0.5'), USB], config = {}, falha } = {}) {
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

test('escolherImpressora: config manda; sem config acha Zebra/ZDesigner (nomes puros ainda valem); sem nada é erro', () => {
  assert.equal(escolherImpressora(['HP LaserJet', 'ZDesigner ZD220'], {}).impressora.nome, 'ZDesigner ZD220');
  assert.equal(escolherImpressora(['HP LaserJet', 'Zebra ZD421'], {}).impressora.nome, 'Zebra ZD421');
  assert.equal(escolherImpressora(['HP LaserJet', 'ZDesigner ZD220'], { impressora: 'hp laserjet' }).impressora.nome, 'HP LaserJet');
  assert.match(escolherImpressora(['HP LaserJet'], {}).erro, /Nenhuma impressora Zebra USB encontrada; instaladas: "HP LaserJet"/);
  assert.match(escolherImpressora(['HP LaserJet'], { impressora: 'Outra' }).erro, /não está instalada/);
});

test('ignora impressora de arquivo (FILE:) e virtual, mesmo com nome Zebra/ZDesigner', () => {
  const r = escolherImpressora([ARQUIVO, imp('Zebra Virtual', 'PORTPROMPT:'), imp('ZDesigner X', 'C:\\x\\saida.prn'), USB], {});
  assert.equal(r.impressora.nome, 'ZDesigner ZD220');
  assert.equal(r.impressora.porta, 'USB001');
  const so = escolherImpressora([ARQUIVO, imp('Microsoft Print to PDF', 'PORTPROMPT:')], {});
  assert.match(so.erro, /Nenhuma impressora Zebra USB encontrada/);
  assert.match(so.erro, /FILE:/);
});

test('prefere a Zebra em USB pronta; USB offline não é escolhida', () => {
  const rede = imp('Zebra ZT230', 'IP_10.0.0.9');
  assert.equal(escolherImpressora([rede, USB], {}).impressora.nome, 'ZDesigner ZD220');
  const off = imp('ZDesigner ZD220', 'USB001', { offline: true });
  assert.equal(escolherImpressora([off, rede], {}).impressora.nome, 'Zebra ZT230');
  assert.match(escolherImpressora([off], {}).erro, /Nenhuma impressora Zebra USB/);
});

test('várias candidatas: não adivinha, lista nomes e portas e manda fixar em zebra.config.json', () => {
  const r = escolherImpressora([USB, imp('Zebra ZD421', 'USB002')], {});
  assert.equal(r.impressora, undefined);
  assert.match(r.erro, /ZDesigner ZD220.*USB001.*Zebra ZD421.*USB002.*zebra\.config\.json/);
});

test('nome fixado em porta FILE: ou virtual é recusado; fixado em Zebra real vale', () => {
  assert.match(escolherImpressora([ARQUIVO, USB], { impressora: ARQUIVO.nome }).erro, /imprime em arquivo/);
  assert.match(escolherImpressora([imp('Microsoft Print to PDF', 'PORTPROMPT:')], { impressora: 'Microsoft Print to PDF' }).erro, /virtual/);
  assert.equal(escolherImpressora([ARQUIVO, USB], { impressora: 'ZDesigner ZD220' }).impressora.porta, 'USB001');
});

test('POST /etiqueta: com o driver de arquivo instalado não imprime nele; resposta traz nome e porta', async () => {
  let envios = falsos({ nomes: [ARQUIVO, USB] });
  let r = await post({ zpl: ZPL });
  assert.deepEqual(await r.json(), { ok: true, impressora: 'ZDesigner ZD220', porta: 'USB001' });
  assert.equal(envios[0].impressora, 'ZDesigner ZD220');
  envios = falsos({ nomes: [ARQUIVO] });
  r = await post({ zpl: ZPL });
  assert.equal(r.status, 500);
  assert.equal(envios.length, 0);
  envios = falsos({ nomes: [ARQUIVO, USB], config: { impressora: ARQUIVO.nome } });
  r = await post({ zpl: ZPL });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /arquivo/);
  assert.equal(envios.length, 0);
});

test('GET /impressoras lista nome, porta, driver e candidatas; some só leitura e respeita a origem', async () => {
  falsos({ nomes: [ARQUIVO, USB, imp('HP LaserJet', 'IP_1')] });
  const d = await (await fetch(base + '/impressoras')).json();
  assert.equal(d.impressoras.length, 3);
  assert.equal(d.impressoras[0].virtual, true);
  assert.equal(d.impressoras[0].candidata, false);
  assert.equal(d.impressoras[1].candidata, true);
  assert.equal(d.impressoras[1].usb, true);
  assert.deepEqual(d.escolhida, { nome: 'ZDesigner ZD220', porta: 'USB001' });
  assert.equal((await fetch(base + '/impressoras', { headers: { Origin: 'https://site-estranho.com' } })).status, 403);
  assert.equal((await fetch(base + '/impressoras', { method: 'POST' })).status, 404);
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
  falsos({ nomes: [imp('HP LaserJet', 'IP_1')] });
  let r = await post({ zpl: ZPL });
  assert.equal(r.status, 500);
  assert.deepEqual((await r.json()).impressoras, [{ nome: 'HP LaserJet', porta: 'IP_1' }]);
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

test('filho que sai sem ler a entrada não derruba o processo (EPIPE/EOF no stdin)', async () => {
  assert.equal(typeof executar, 'function');
  const grande = 'x'.repeat(5 * 1024 * 1024);
  // o erro do filho (saída 1) é esperado e chega pela promessa; o que não pode acontecer é um 'error' sem tratador no stdin
  await assert.rejects(executar(process.execPath, ['-e', 'process.exit(1)'], { entrada: grande }));
});
