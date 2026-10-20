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
  function rota(metodo, caminho, exige, ...handlers) {
    app[metodo](caminho, ...autenticado, exigir(exige), ...handlers);
  }

  function publica(metodo, caminho, ...handlers) {
    const marca = (req, res, next) => next();
    marca[MARCA] = true;
    app[metodo](caminho, marca, ...handlers);
  }

  function verificar() {
    const soltas = [];
    for (const layer of app._router?.stack || []) {
      if (!layer.route) continue;
      const marcada = layer.route.stack.some(l => l.handle && l.handle[MARCA]);
      if (marcada) continue;
      for (const m of Object.keys(layer.route.methods)) soltas.push(`${m.toUpperCase()} ${layer.route.path}`);
    }
    if (soltas.length) throw new Error('Rotas sem permissão declarada: ' + soltas.join(', '));
  }

  return { rota, publica, verificar };
}

module.exports = { criarRegistro, exigir };
