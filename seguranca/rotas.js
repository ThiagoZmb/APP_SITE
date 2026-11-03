// ==========================================================================
// Registro obrigatório de rotas. Toda rota nasce com a permissão que exige:
//   rota('get', '/estoque', ['estoque.ver'], handler)
//   rota('get', '/painel', [{ algum: ['paineis.ver', 'pedidos.ver'] }, 'valores.ver'], handler)
//   publica('post', '/login', handler)   // só login e manutenção com chave
// Na subida, verificar() recusa o servidor se alguma rota foi criada fora daqui.
// ==========================================================================
const { atende } = require('./permissoes');

const MARCA = Symbol('rota-registrada');

function exigir(exige) {
  const mw = (req, res, next) => {
    const r = atende(req.acesso?.permissoes || new Set(), exige);
    if (!r.ok) return res.status(403).json({ error: 'Sem permissão para esta ação.', faltando: r.faltando });
    next();
  };
  mw[MARCA] = true;
  return mw;
}

function criarRegistro(app, { autenticado }) {
  // Rotas que passam por `autenticado` (não inclui as públicas); o teste da barreira as percorre.
  const autenticadas = [];
  // Rotas públicas (sem JWT): lista fixa conferida em teste; uma nova precisa de decisão consciente.
  const publicas = [];

  function rota(metodo, caminho, exige, ...handlers) {
    autenticadas.push({ metodo, caminho });
    app[metodo](caminho, ...autenticado, exigir(exige), ...handlers);
  }

  function publica(metodo, caminho, ...handlers) {
    publicas.push({ metodo, caminho });
    const marca = (req, res, next) => next();
    marca[MARCA] = true;
    app[metodo](caminho, marca, ...handlers);
  }

  function verificar() {
    const soltas = [];
    let routerMontado = false;
    for (const layer of app._router?.stack || []) {
      // Router montado com app.use esconderia rotas desta verificação: não é permitido.
      if (!layer.route && layer.handle && Array.isArray(layer.handle.stack)) { routerMontado = true; continue; }
      if (!layer.route) continue;
      const marcada = layer.route.stack.some(l => l.handle && l.handle[MARCA]);
      if (marcada) continue;
      for (const m of Object.keys(layer.route.methods)) soltas.push(`${m.toUpperCase()} ${layer.route.path}`);
    }
    if (routerMontado) throw new Error('Router montado com app.use não é permitido (as rotas escapam do registro): use registro.rota/registro.publica.');
    if (soltas.length) throw new Error('Rotas sem permissão declarada: ' + soltas.join(', '));
  }

  const rotasAutenticadas = () => autenticadas.map(r => ({ ...r }));
  const rotasPublicas = () => publicas.map(r => ({ ...r }));

  return { rota, publica, verificar, rotasAutenticadas, rotasPublicas };
}

module.exports = { criarRegistro };
