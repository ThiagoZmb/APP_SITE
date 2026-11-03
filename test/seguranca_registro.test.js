process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rotasMod = require('../seguranca/rotas');
const { criarRegistro } = rotasMod;
const { registro } = require('../index.js');

const autenticadoFalso = [(req, res, next) => next()];

test('lista FIXA das rotas públicas: uma nova pública precisa de decisão consciente (atualize esta lista)', () => {
  const esperado = [
    'POST /login',
    'POST /admin/definir_senha',
    'POST /migrar_senhas',
    'POST /admin/importar_notas',
    'POST /admin/importar_pesos'
  ];
  const atual = registro.rotasPublicas().map(r => `${r.metodo.toUpperCase()} ${r.caminho}`);
  assert.deepEqual([...atual].sort(), [...esperado].sort());
});

test('rotasPublicas devolve cópia', () => {
  const a = registro.rotasPublicas();
  a.length = 0;
  assert.equal(registro.rotasPublicas().length, 5);
});

test('verificar() recusa um express.Router montado com app.use', () => {
  const app = express();
  const reg = criarRegistro(app, { autenticado: autenticadoFalso });
  reg.rota('get', '/ok', [], (req, res) => res.json({}));
  const router = express.Router();
  router.get('/aberta', (req, res) => res.json({}));
  app.use('/portal', router);
  assert.throws(() => reg.verificar(), /Router/);
});

test('verificar() aceita middlewares comuns (json, cors-like, tratador de erros)', () => {
  const app = express();
  const reg = criarRegistro(app, { autenticado: autenticadoFalso });
  app.use((req, res, next) => next());
  app.use(express.json());
  reg.rota('get', '/ok', [], (req, res) => res.json({}));
  reg.publica('post', '/login', (req, res) => res.json({}));
  app.use((err, req, res, next) => next(err));
  assert.doesNotThrow(() => reg.verificar());
});

test('verificar() recusa rota criada direto no app, mesmo com um middleware qualquer', () => {
  const app = express();
  const reg = criarRegistro(app, { autenticado: autenticadoFalso });
  app.get('/solta', (req, res, next) => next(), (req, res) => res.json({}));
  assert.throws(() => reg.verificar(), /GET \/solta/);
});

test('exigir não é exportado: não dá para marcar uma rota fora do registro', () => {
  assert.equal(rotasMod.exigir, undefined);
});

// ---- Categorias do portal do cliente (listas separadas das rotas de funcionário) ----
const http = require('node:http');

// Guardas falsos: portalAutenticado nega sem req.portal (401); portalPublico só deixa passar.
const portalAutenticadoFalso = [(req, res, next) => {
  const sessao = req.headers['x-portal'];
  if (!sessao) return res.status(401).json({ error: 'Sessão do portal inválida.' });
  req.portal = { permissoes: new Set(sessao.split(',').filter(Boolean)) };
  next();
}];
const portalPublicoFalso = [(req, res, next) => { req.passouPublico = true; next(); }];

function montarPortal() {
  const app = express();
  const reg = criarRegistro(app, { autenticado: autenticadoFalso, portalPublico: portalPublicoFalso, portalAutenticado: portalAutenticadoFalso });
  return { app, reg };
}

async function subirApp(app) {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, fechar: () => new Promise(r => server.close(r)) };
}

test('rotasPortal e rotasPortalPublicas começam vazias e devolvem cópia', () => {
  const { reg } = montarPortal();
  assert.deepEqual(reg.rotasPortal(), []);
  assert.deepEqual(reg.rotasPortalPublicas(), []);
  reg.portal('get', '/portal/x', [], (req, res) => res.json({}));
  reg.rotasPortal().length = 0;
  assert.equal(reg.rotasPortal().length, 1);
  reg.portalPublica('post', '/portal/login', (req, res) => res.json({}));
  reg.rotasPortalPublicas().length = 0;
  assert.equal(reg.rotasPortalPublicas().length, 1);
});

test('portal(...) aparece só em rotasPortal; portalPublica(...) só em rotasPortalPublicas', () => {
  const { reg } = montarPortal();
  reg.portal('get', '/portal/pedidos', ['pedidos.ver'], (req, res) => res.json({}));
  reg.portalPublica('post', '/portal/login', (req, res) => res.json({}));
  assert.deepEqual(reg.rotasPortal(), [{ metodo: 'get', caminho: '/portal/pedidos' }]);
  assert.deepEqual(reg.rotasPortalPublicas(), [{ metodo: 'post', caminho: '/portal/login' }]);
  assert.deepEqual(reg.rotasAutenticadas(), []);
  assert.deepEqual(reg.rotasPublicas(), []);
});

test('rota portal: sem sessão 401, permissão faltando 403, com permissão 200; lista vazia = qualquer usuário do portal', async t => {
  const { app, reg } = montarPortal();
  reg.portal('get', '/portal/pedidos', ['pedidos.ver'], (req, res) => res.json({ ok: true }));
  reg.portal('get', '/portal/eu', [], (req, res) => res.json({ ok: true }));
  reg.portalPublica('get', '/portal/aberta', (req, res) => res.json({ passou: req.passouPublico === true }));
  reg.verificar();
  const s = await subirApp(app);
  t.after(s.fechar);
  assert.equal((await fetch(s.url + '/portal/pedidos')).status, 401);
  const r403 = await fetch(s.url + '/portal/pedidos', { headers: { 'x-portal': 'documentos.ver' } });
  assert.equal(r403.status, 403);
  assert.equal((await r403.json()).error, 'Sem permissão para esta ação.');
  assert.equal((await fetch(s.url + '/portal/pedidos', { headers: { 'x-portal': 'pedidos.ver' } })).status, 200);
  assert.equal((await fetch(s.url + '/portal/eu', { headers: { 'x-portal': 'financeiro.ver' } })).status, 200);
  assert.equal((await fetch(s.url + '/portal/eu')).status, 401);
  assert.deepEqual(await (await fetch(s.url + '/portal/aberta')).json(), { passou: true });
});

test('verificar() aceita as quatro categorias e continua recusando rota solta e Router', () => {
  const { app, reg } = montarPortal();
  reg.rota('get', '/ok', [], (req, res) => res.json({}));
  reg.publica('post', '/login', (req, res) => res.json({}));
  reg.portal('get', '/portal/a', [], (req, res) => res.json({}));
  reg.portalPublica('post', '/portal/b', (req, res) => res.json({}));
  assert.doesNotThrow(() => reg.verificar());
  app.get('/solta', (req, res) => res.json({}));
  assert.throws(() => reg.verificar(), /GET \/solta/);

  const app2 = express();
  const reg2 = criarRegistro(app2, { autenticado: autenticadoFalso });
  reg2.portal('get', '/portal/a', [], (req, res) => res.json({}));
  const router = express.Router();
  router.get('/aberta', (req, res) => res.json({}));
  app2.use('/portal', router);
  assert.throws(() => reg2.verificar(), /Router/);
});

test('sem portalPublico/portalAutenticado informados, criarRegistro continua funcionando', () => {
  const app = express();
  const reg = criarRegistro(app, { autenticado: autenticadoFalso });
  assert.deepEqual(reg.rotasPortal(), []);
  assert.deepEqual(reg.rotasPortalPublicas(), []);
});

test('portal(...) sem guarda de sessão e sem req.portal responde 401 e não chama o handler', async t => {
  const app = express();
  const reg = criarRegistro(app, { autenticado: autenticadoFalso });
  let chamadas = 0;
  const h = (req, res) => { chamadas++; res.json({ ok: true }); };
  reg.portal('get', '/portal/x', [], h);
  reg.portal('get', '/portal/y', ['pedidos.ver'], h);
  const s = await subirApp(app);
  t.after(s.fechar);
  for (const caminho of ['/portal/x', '/portal/y']) {
    const r = await fetch(s.url + caminho);
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'Sessão expirada. Entre novamente.');
  }
  assert.equal(chamadas, 0);
});

test('permissão de FUNCIONÁRIO (req.acesso) não vale no portal: sem req.portal responde 401', async t => {
  const app = express();
  app.use((req, res, next) => { req.acesso = { permissoes: new Set(['pedidos.ver']) }; next(); });
  const reg = criarRegistro(app, { autenticado: autenticadoFalso });
  let chamadas = 0;
  reg.portal('get', '/portal/y', ['pedidos.ver'], (req, res) => { chamadas++; res.json({}); });
  const s = await subirApp(app);
  t.after(s.fechar);
  assert.equal((await fetch(s.url + '/portal/y')).status, 401);
  assert.equal(chamadas, 0);
});
