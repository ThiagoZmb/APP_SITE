process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { subir } = require('./apoio/servidor');
const { tratadorDeErros } = require('../seguranca/erros');

const raiz = path.join(__dirname, '..');
function arquivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivosJs(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

test('nenhuma resposta devolve detalhe de erro', () => {
  const arquivos = [path.join(raiz, 'index.js'), ...arquivosJs(path.join(raiz, 'rotas')), ...arquivosJs(path.join(raiz, 'leitura'))];
  const achados = [];
  for (const f of arquivos) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/detalhe:\s*err/.test(l)) achados.push(`${path.relative(raiz, f)}:${i + 1}`); });
  }
  assert.deepEqual(achados, []);
});

async function servidorCom(t, rota) {
  const app = express();
  app.use(express.json());
  app.get('/boom', rota);
  app.post('/json', (req, res) => res.json({ ok: true }));
  app.use(tratadorDeErros);
  const s = await subir(app); t.after(s.fechar); return s;
}

test('tratador global responde 500 sem stack nem mensagem', async t => {
  const silencio = t.mock.method(console, 'error', () => {});
  const s = await servidorCom(t, () => { throw new Error('SELECT secreto'); });
  const r = await fetch(s.url + '/boom');
  const texto = await r.text();
  assert.equal(r.status, 500);
  assert.deepEqual(JSON.parse(texto), { error: 'Erro de servidor' });
  assert.ok(!texto.includes('secreto') && !texto.includes('at '));
  assert.ok(silencio.mock.calls.length >= 1); // a mensagem fica só no log do servidor
});

test('JSON malformado responde 400 {error:\'Requisição inválida.\'}', async t => {
  const s = await servidorCom(t, (req, res) => res.json({}));
  const r = await fetch(s.url + '/json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ruim' });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Requisição inválida.' });
});

test('o log leva só o código do erro, nunca o texto (que pode trazer valor do banco)', async t => {
  const silencio = t.mock.method(console, 'error', () => {});
  const s = await servidorCom(t, () => { throw Object.assign(new Error("SELECT secreto 'valor gravado'"), { code: 'ER_X' }); });
  await fetch(s.url + '/boom');
  const sem = await servidorCom(t, () => { throw new Error('texto interno'); });
  await fetch(sem.url + '/boom');
  const log = silencio.mock.calls.map(c => c.arguments.join(' ')).join('\n');
  assert.match(log, /ER_X/);
  assert.match(log, /sem código/);
  assert.ok(!log.includes('secreto') && !log.includes('valor gravado') && !log.includes('texto interno'));
});
