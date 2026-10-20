const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { subir } = require('./apoio/servidor');
const { criarRegistro } = require('../seguranca/rotas');

// autenticado falso: as permissões vêm do cabeçalho x-perms
const autenticadoFalso = [(req, res, next) => {
  req.acesso = { permissoes: new Set(String(req.headers['x-perms'] || '').split(',').filter(Boolean)) };
  next();
}];

function montar() {
  const app = express();
  const registro = criarRegistro(app, { autenticado: autenticadoFalso });
  registro.rota('get', '/estoque', ['estoque.ver'], (req, res) => res.json({ ok: true }));
  registro.rota('get', '/painel', [{ algum: ['paineis.ver', 'pedidos.ver'] }, 'valores.ver'], (req, res) => res.json({ ok: true }));
  registro.publica('post', '/login', (req, res) => res.json({ publico: true }));
  return { app, registro };
}

test('rota com permissão atendida responde 200; sem ela, 403 com faltando', async t => {
  const { app } = montar();
  const s = await subir(app);
  t.after(s.fechar);
  const ok = await fetch(s.url + '/estoque', { headers: { 'x-perms': 'estoque.ver' } });
  assert.equal(ok.status, 200);
  const nao = await fetch(s.url + '/painel', { headers: { 'x-perms': 'pedidos.ver' } });
  assert.equal(nao.status, 403);
  assert.deepEqual(await nao.json(), { error: 'Sem permissão para esta ação.', faltando: ['valores.ver'] });
});

test('rota pública não passa pela autenticação', async t => {
  const { app } = montar();
  const s = await subir(app);
  t.after(s.fechar);
  const r = await fetch(s.url + '/login', { method: 'POST' });
  assert.deepEqual(await r.json(), { publico: true });
});

test('verificar passa só com rota/publica', () => {
  assert.doesNotThrow(() => montar().registro.verificar());
});

test('verificar lança se houver app.get direto', () => {
  const { app, registro } = montar();
  app.get('/solta', (req, res) => res.end());
  app.delete('/outra/:id', (req, res) => res.end());
  assert.throws(() => registro.verificar(), /Rotas sem permissão declarada: GET \/solta, DELETE \/outra\/:id/);
});
