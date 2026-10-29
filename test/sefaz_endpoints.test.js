// Rotas /sefaz/* do serviço local (porta 3917): origem e Host conferidos, config ausente = 503 explicado (nunca 500),
// chave inválida, JSON obrigatório, limites; e o salvador de PDF continua igual.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-sefaz-rotas-'));
process.env.ELEGANCE_RAIZ = path.join(raiz, 'Programa Elegance');
delete process.env.ELEGANCE_SEFAZ_CONFIG;
const { servidor, sefaz } = require('../local/salvador_pdf');
const S = require('../local/sefaz');
const A = require('./apoio/sefazFalsa');

const SITE = 'https://thiagozmb.github.io';
const CNPJ = '33000167000101';
let base;
test.before(async () => { await new Promise(ok => servidor.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${servidor.address().port}`; });
test.after(() => { servidor.close(); fs.rmSync(raiz, { recursive: true, force: true }); });

const pedir = (caminho, { metodo = 'GET', origem = SITE, corpo, tipo = 'application/json' } = {}) => fetch(base + caminho, {
  method: metodo, headers: { ...(origem ? { Origin: origem } : {}), ...(corpo !== undefined ? { 'Content-Type': tipo } : {}) },
  body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo))
});

test('o módulo da SEFAZ é carregado pelo salvador e o /ping avisa', async () => {
  assert.ok(sefaz, 'sefaz carregado');
  const r = await pedir('/ping');
  assert.equal((await r.json()).sefaz, true);
});

test('sem sefaz.config.json: status diz "SEFAZ não configurada"; as operações respondem 503 com a mesma explicação', async () => {
  const r = await pedir('/sefaz/status');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.configurada, false);
  assert.match(d.motivo, /SEFAZ não configurada/);
  assert.ok(d.motivo.includes(path.join('Servico', 'sefaz.config.json')));
  for (const [c, m, corpo] of [['/sefaz/notas', 'GET'], ['/sefaz/sincronizar', 'POST', {}], ['/sefaz/xml/' + A.gerarChave(), 'GET'], ['/sefaz/importada', 'POST', { chave: A.gerarChave() }]]) {
    const x = await pedir(c, { metodo: m, corpo });
    assert.equal(x.status, 503, c);
    assert.match((await x.json()).error, /SEFAZ não configurada/, c);
  }
});

test('origem: sem Origin ou de outro site = 403; preflight libera POST só para o site', async () => {
  assert.equal((await pedir('/sefaz/status', { origem: null })).status, 403);
  assert.equal((await pedir('/sefaz/status', { origem: 'https://site-estranho.com' })).status, 403);
  assert.equal((await pedir('/sefaz/sincronizar', { metodo: 'POST', origem: 'https://site-estranho.com', corpo: {} })).status, 403);
  const pre = await fetch(base + '/sefaz/sincronizar', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
});

test('Host diferente de 127.0.0.1/localhost é recusado (proteção contra DNS rebinding)', async () => {
  const status = await new Promise((ok, falha) => {
    const req = http.request(base + '/sefaz/status', { headers: { Host: 'site-estranho.com:3917', Origin: SITE } }, res => { res.resume(); ok(res.statusCode); });
    req.on('error', falha); req.end();
  });
  assert.equal(status, 403);
});

test('chave inválida = 400 antes de qualquer outra coisa; corpo precisa ser JSON pequeno', async () => {
  assert.equal((await pedir('/sefaz/baixar', { metodo: 'POST', corpo: { chave: '../../Windows' } })).status, 400);
  assert.equal((await pedir('/sefaz/ciencia', { metodo: 'POST', corpo: { chave: '1234' } })).status, 400);
  assert.equal((await pedir('/sefaz/baixar', { metodo: 'POST', corpo: 'chave=1', tipo: 'text/plain' })).status, 415);
  assert.equal((await pedir('/sefaz/baixar', { metodo: 'POST', corpo: { chave: 'x'.repeat(5000) } })).status, 413);
  assert.equal((await pedir('/sefaz/nada')).status, 404);
});

test('o salvador de PDF continua gravando (a extensão não mudou a rota /pdf)', async () => {
  const r = await fetch(`${base}/pdf?pasta=Produção&nome=1_X_P.PDF`, { method: 'PUT', body: Buffer.from('%PDF-1.4 x'), headers: { Origin: SITE } });
  assert.equal(r.status, 200);
});

// rotas com a SEFAZ configurada (servidor falso): a mesma função tratar() do salvador, num servidor de teste
test('com configuração: notas, XML completo (application/xml), importada e nada de senha nas respostas', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-sefaz-cfg-'));
  const pfx = A.gerarPfx({ cnpj: CNPJ });
  const falsa = await A.criarSefazFalsa({ caCliente: pfx.certPem });
  fs.writeFileSync(path.join(dir, 'e.pfx'), pfx.pfx);
  fs.writeFileSync(path.join(dir, 'cadeia.pem'), falsa.certServidorPem);
  const config = path.join(dir, 'sefaz.config.json');
  fs.writeFileSync(config, JSON.stringify({ cnpj: CNPJ, uf: 'SP', ambiente: 'homologacao', certificado: path.join(dir, 'e.pfx'), senha: pfx.senha, cadeiaSefaz: path.join(dir, 'cadeia.pem') }));
  const s = S.criarSefaz({ raiz: dir, arquivoConfig: config, env: {}, urls: { homologacao: falsa.urls } });
  const srv = http.createServer((req, res) => s.tratar(req, res, new URL(req.url, 'http://127.0.0.1'), { origemPermitida: req.headers.origin === SITE }));
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  t.after(async () => { srv.close(); await falsa.fechar(); fs.rmSync(dir, { recursive: true, force: true }); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  const ir = (c, m = 'GET', corpo) => fetch(b + c, { method: m, headers: { Origin: SITE, ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });

  const chave = A.gerarChave({ numero: 77 });
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', docs: [{ nsu: '000000000000000', schema: 'procNFe_v4.00.xsd', xml: A.procNFe({ chave, dest: CNPJ, numero: '77' }) }] }) });
  const baixou = await ir('/sefaz/baixar', 'POST', { chave });
  assert.equal(baixou.status, 200);
  assert.equal((await baixou.json()).completa, true);
  const lista = await (await ir('/sefaz/notas')).json();
  assert.equal(lista.notas.length, 1); assert.equal(lista.notas[0].numero, '77');
  const x = await ir('/sefaz/xml/' + chave);
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type'), /application\/xml/);
  assert.match(await x.text(), /<nfeProc/);
  assert.equal((await ir('/sefaz/xml/' + A.gerarChave({ numero: 78 }))).status, 404);
  assert.equal((await ir('/sefaz/xml/..%2F..%2Fsefaz.config.json')).status, 400);
  assert.equal((await (await ir('/sefaz/importada', 'POST', { chave })).json()).nota.situacao, 'importada');
  const st = await (await ir('/sefaz/status')).text();
  assert.ok(!st.includes(pfx.senha) && !st.includes('e.pfx') && !st.includes('BEGIN'), 'status sem senha, caminho do .pfx nem chave');
  // 429 com o horário de liberação para a tela
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) });
  assert.equal((await ir('/sefaz/sincronizar', 'POST', {})).status, 200);
  const bloqueado = await ir('/sefaz/sincronizar', 'POST', {});
  assert.equal(bloqueado.status, 429);
  const d = await bloqueado.json();
  assert.match(d.error, /Próxima consulta liberada às \d{2}:\d{2}/);
  assert.ok(Number.isFinite(d.liberadaEm));
});
