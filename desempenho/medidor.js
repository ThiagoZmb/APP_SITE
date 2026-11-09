// ==========================================================================
// Medidor de desempenho: descobre onde o tempo vai (rede até o banco x consultas x código), sem mudar nenhuma rota.
//  - instrumentarPool(pool): conta as consultas e o tempo gasto no banco DENTRO de cada requisição (AsyncLocalStorage).
//  - middleware: ao terminar a resposta, registra uma linha só se foi lenta ou fez muitas consultas, e soma no resumo.
//  - medirIdaEVolta(pool): mediana de alguns "SELECT 1" = o custo de cada consulta só pela rede (Render -> HostGator).
//  - iniciarRelatorio(pool): a cada hora, escreve no log o resumo das rotas e a ida e volta ao banco (nunca nos testes).
// O log leva só o PADRÃO da rota ("/clientes/:razao"), método, status, tempo e contagens: nunca o SQL, os parâmetros, o
// endereço com valores, o usuário nem qualquer dado do banco.
// ==========================================================================
const { AsyncLocalStorage } = require('node:async_hooks');

const MARCA = Symbol('medidor-desempenho');
const arred = n => Math.round(n);
const arred1 = n => Math.round(n * 10) / 10;

function criarMedidor({ agora = () => performance.now(), log = console.log, limiteLentoMs = 400, limiteConsultas = 10 } = {}) {
  const als = new AsyncLocalStorage();
  const por = new Map(); // "GET /rota" -> { n, totalMs, maxMs, totalDbMs, totalQ }

  // envolve um método de consulta: soma 1 consulta e o tempo dela na requisição em andamento (se houver); devolve/propaga igual
  function envolver(alvo, nome) {
    const original = alvo[nome];
    if (typeof original !== 'function') return;
    alvo[nome] = async function (...args) {
      const st = als.getStore();
      if (!st) return original.apply(this, args);
      const t0 = agora();
      try { return await original.apply(this, args); } finally { st.q += 1; st.dbMs += agora() - t0; }
    };
  }
  function instrumentarConexao(conn) {
    if (!conn || conn[MARCA]) return conn;
    Object.defineProperty(conn, MARCA, { value: true });
    envolver(conn, 'execute'); envolver(conn, 'query');
    return conn;
  }
  function instrumentarPool(pool) {
    if (pool[MARCA]) return pool;
    Object.defineProperty(pool, MARCA, { value: true });
    envolver(pool, 'execute'); envolver(pool, 'query');
    const original = pool.getConnection;
    if (typeof original === 'function') pool.getConnection = async function (...args) { return instrumentarConexao(await original.apply(this, args)); };
    return pool;
  }

  function registrar(chave, ms, st) {
    const r = por.get(chave) || { n: 0, totalMs: 0, maxMs: 0, totalDbMs: 0, totalQ: 0 };
    r.n += 1; r.totalMs += ms; r.maxMs = Math.max(r.maxMs, ms); r.totalDbMs += st.dbMs; r.totalQ += st.q;
    por.set(chave, r);
  }

  // Precisa vir DEPOIS de express.json(): o corpo da requisição é lido por eventos do socket, que perdem o contexto.
  function middleware(req, res, next) {
    const st = { q: 0, dbMs: 0 }, t0 = agora();
    res.on('finish', () => {
      const ms = agora() - t0;
      // padrão da rota (nunca o caminho real, que pode ter nomes, números e tokens); sem rota = 404 ou arquivo estático
      const chave = `${req.method} ${req.route ? (req.baseUrl || '') + req.route.path : '(sem rota)'}`;
      registrar(chave, ms, st);
      if (ms >= limiteLentoMs || st.q >= limiteConsultas) log(`[perf] ${chave} ${res.statusCode} ${arred(ms)}ms q=${st.q} db=${arred(st.dbMs)}ms`);
    });
    als.run(st, () => next());
  }

  function resumo() {
    return [...por].map(([rota, r]) => ({
      rota, n: r.n, mediaMs: arred(r.totalMs / r.n), maxMs: arred(r.maxMs), mediaConsultas: arred1(r.totalQ / r.n), mediaDbMs: arred(r.totalDbMs / r.n), totalMs: arred(r.totalMs)
    })).sort((a, b) => b.totalMs - a.totalMs);
  }
  const linhasDoResumo = (top = 8) => resumo().slice(0, top).map(r =>
    `${r.rota} — ${r.n} req · média ${r.mediaMs}ms · máx ${r.maxMs}ms · ${r.mediaConsultas.toFixed(1)} consultas · ${r.mediaDbMs}ms no banco`);
  const limparResumo = () => por.clear();

  // custo de UMA consulta mínima: é o piso de cada ida ao banco (rede + autenticação); amostras em série
  async function medirIdaEVolta(pool, amostras = 5) {
    const t = [];
    for (let i = 0; i < amostras; i++) { const t0 = agora(); await pool.query('SELECT 1'); t.push(agora() - t0); }
    t.sort((a, b) => a - b);
    return { medianaMs: arred(t[Math.floor(t.length / 2)]), minMs: arred(t[0]), maxMs: arred(t[t.length - 1]), amostras: t.length };
  }

  async function relatorio(pool) {
    try {
      const r = await medirIdaEVolta(pool);
      log(`[perf] ida e volta ao banco: mediana ${r.medianaMs}ms (de ${r.minMs} a ${r.maxMs}ms, ${r.amostras} amostras)`);
    } catch (err) { log(`[perf] não foi possível medir a ida e volta ao banco: ${err.code || 'sem código'}`); }
    const linhas = linhasDoResumo();
    if (linhas.length) log(`[perf] resumo da última hora (rotas com mais tempo total):\n  ${linhas.join('\n  ')}`);
    limparResumo();
  }
  // medição na subida (pelo log do Render dá para ver já no primeiro minuto) e a cada `intervaloMs`; o timer não segura o processo
  function iniciarRelatorio(pool, { intervaloMs = 60 * 60 * 1000 } = {}) {
    relatorio(pool);
    return setInterval(() => relatorio(pool), intervaloMs).unref();
  }

  return { instrumentarPool, middleware, resumo, linhasDoResumo, limparResumo, medirIdaEVolta, iniciarRelatorio };
}

module.exports = { criarMedidor };
