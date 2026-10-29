const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-pdf-'));
process.env.ELEGANCE_RAIZ = path.join(raiz, 'Programa Elegance'); // ainda não existe: o serviço deve criá-la
const { servidor, nomeValido } = require('../local/salvador_pdf');

const PDF = Buffer.from('%PDF-1.4\nconteudo');
let base;
test.before(async () => { await new Promise(ok => servidor.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${servidor.address().port}`; });
test.after(() => { servidor.close(); fs.rmSync(raiz, { recursive: true, force: true }); });

const put = (pasta, nome, corpo = PDF, headers = {}) =>
  fetch(`${base}/pdf?pasta=${encodeURIComponent(pasta)}&nome=${encodeURIComponent(nome)}`, { method: 'PUT', body: corpo, headers });

test('grava o PDF criando a pasta que não existia', async () => {
  const r = await put('Produção', '7_Ação & Cia_P.PDF');
  assert.equal(r.status, 200);
  const arq = path.join(process.env.ELEGANCE_RAIZ, 'Produção', '7_Ação & Cia_P.PDF');
  assert.deepEqual(fs.readFileSync(arq), PDF);
  assert.equal((await put('Vidros_Produção', '7_X_V.PDF')).status, 200);
  assert.equal((await put('Pedidos(PDF)', '1_A.PDF')).status, 200);
  assert.equal((await put('Orçamentos(PDF)', '2_B.PDF')).status, 200);
});

test('recusa pasta fora da lista, nome com caminho e arquivo que não é PDF', async () => {
  assert.equal((await put('Windows', 'a.PDF')).status, 400);
  assert.equal((await put('..', 'a.PDF')).status, 400);
  assert.equal((await put('Produção', '../fora.PDF')).status, 400);
  assert.equal((await put('Produção', 'a.exe')).status, 400);
  assert.equal((await put('Produção', 'a.PDF', Buffer.from('MZ....'))).status, 400);
  assert.equal(nomeValido('1_Fulano.PDF'), true);
});

test('só aceita origem do site do sistema; ping responde', async () => {
  assert.equal((await put('Produção', 'b.PDF', PDF, { Origin: 'https://site-estranho.com' })).status, 403);
  const r = await fetch(base + '/ping', { headers: { Origin: 'https://thiagozmb.github.io' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://thiagozmb.github.io');
  assert.equal(r.headers.get('access-control-allow-private-network'), 'true');
});
