// ==========================================================================
// Sessões de funcionário (revogáveis): o JWT leva o `sid` e cada requisição
// confere no banco, por chave primária e sem cache, se a sessão ainda vale.
// ==========================================================================
const crypto = require('crypto');

const VALIDADE_MS = 8 * 60 * 60 * 1000; // igual à validade do JWT (8 h)

// Cache curto só das validações que deram CERTO (sid -> { usuario, ate }). Cada ida ao banco custa ~190 ms (Render -> HostGator, medido em
// 2026-11-09) e a validação rodava em TODA requisição. Logout e troca de senha continuam valendo NA HORA: revogar/revogarTodas limpam o
// cache no mesmo processo (o Render roda uma instância só). O que o cache adia (até `cacheMs`) é só uma revogação feita por fora deste
// processo (direto no banco). O JWT leva a mesma validade de 8 h, então a sessão nunca passa do vencimento por causa do cache.
const CACHE_MS_PADRAO = 30 * 1000;
const CACHE_MAX = 2000;

function criarSessoes({ pool, agora = () => new Date(), cacheMs = CACHE_MS_PADRAO }) {
  const cache = new Map();
  let geracao = 0; // sobe a cada revogação: uma validação que começou ANTES de uma revogação nunca entra no cache

  function podarCache(t) {
    if (cache.size < CACHE_MAX) return;
    for (const [sid, c] of cache) if (t >= c.ate) cache.delete(sid);
    if (cache.size >= CACHE_MAX) cache.clear();
  }

  async function criar(usuarioCodigo, ip) {
    const id = crypto.randomBytes(16).toString('hex');
    const criadoEm = agora();
    await pool.execute(
      'INSERT INTO web_sessoes (id, usuario_codigo, criado_em, expira_em, ip, revogada) VALUES (?, ?, ?, ?, ?, 0)',
      [id, usuarioCodigo, criadoEm, new Date(criadoEm.getTime() + VALIDADE_MS), ip ? String(ip).slice(0, 45) : null]);
    return id;
  }

  // false para sid ausente/mal formado, inexistente, de outro usuário, revogado ou expirado
  async function valida(sid, usuarioCodigo) {
    if (typeof sid !== 'string' || !/^[0-9a-f]{32}$/.test(sid)) return false;
    const t = agora().getTime();
    const guardado = cache.get(sid);
    if (guardado && guardado.usuario === usuarioCodigo && t < guardado.ate) return true;
    const geracaoAntes = geracao;
    const [linhas] = await pool.execute(
      'SELECT id FROM web_sessoes WHERE id = ? AND usuario_codigo = ? AND revogada = 0 AND expira_em > ? LIMIT 1',
      [sid, usuarioCodigo, agora()]);
    const ok = linhas.length > 0;
    if (ok && cacheMs > 0 && geracao === geracaoAntes) { podarCache(t); cache.set(sid, { usuario: usuarioCodigo, ate: t + cacheMs }); }
    return ok;
  }

  async function revogar(sid) {
    geracao += 1; cache.delete(sid);            // antes do UPDATE: a revogação já vale para quem chegar durante a gravação
    await pool.execute('UPDATE web_sessoes SET revogada = 1 WHERE id = ?', [sid]);
    geracao += 1; cache.delete(sid);            // depois: uma validação que estava no ar não guarda o resultado antigo
  }

  // todas as sessões do usuário; `exceto` = sid que continua valendo (ex.: a de quem trocou a senha)
  async function revogarTodas(usuarioCodigo, { exceto } = {}) {
    const limpar = () => {
      geracao += 1;
      for (const [sid, c] of cache) if (c.usuario === usuarioCodigo && sid !== exceto) cache.delete(sid);
    };
    limpar();                                    // antes do UPDATE (vale já) e depois (descarta validação que estava no ar)
    if (exceto) {
      await pool.execute('UPDATE web_sessoes SET revogada = 1 WHERE usuario_codigo = ? AND revogada = 0 AND id <> ?', [usuarioCodigo, exceto]);
    } else {
      await pool.execute('UPDATE web_sessoes SET revogada = 1 WHERE usuario_codigo = ? AND revogada = 0', [usuarioCodigo]);
    }
    limpar();
  }

  return { criar, valida, revogar, revogarTodas };
}

module.exports = { criarSessoes, VALIDADE_MS };
