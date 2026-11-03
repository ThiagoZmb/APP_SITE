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
