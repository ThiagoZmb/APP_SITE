// ==========================================================================
// Acesso do usuário: perfil + exceções + estados + ativo, lido do banco
// a cada requisição com cache curto (limpo na hora pela administração).
// ==========================================================================
const { permissoesFinais } = require('./permissoes');

function parseEstados(texto) {
  if (!texto) return [];
  return [...new Set(String(texto).split(/[\s,;]+/).map(e => e.trim().toUpperCase()).filter(Boolean))];
}

function criarAcesso({ pool, ttlMs = 60000, agora = () => Date.now() }) {
  const cache = new Map();

  async function buscar(codigo) {
    const [usuarios] = await pool.execute(
      'SELECT CODIGO, NOME, CARGO, RAZAO_SOCIAL, SITUACAO FROM cliente_usuarios WHERE CODIGO = ? LIMIT 1', [codigo]);
    if (!usuarios.length) return null;
    const u = usuarios[0];
    const [webs] = await pool.execute(
      `SELECT a.perfil_id, a.estados, a.ativo, p.nome AS perfil_nome, p.ativo AS perfil_ativo
       FROM web_usuario_acesso a LEFT JOIN web_perfis p ON p.id = a.perfil_id
       WHERE a.usuario_codigo = ? LIMIT 1`, [codigo]);
    const web = webs[0] || null;
    const ativo = !!web && Number(web.ativo) === 1 && String(u.SITUACAO || '').toUpperCase() !== 'INATIVO';
    let permissoesPerfil = [];
    let excecoes = [];
    if (web) {
      if (web.perfil_id != null && Number(web.perfil_ativo) === 1) {
        const [pp] = await pool.execute('SELECT permissao FROM web_perfil_permissoes WHERE perfil_id = ?', [web.perfil_id]);
        permissoesPerfil = pp.map(r => r.permissao);
      }
      const [ex] = await pool.execute('SELECT permissao, tipo FROM web_usuario_excecoes WHERE usuario_codigo = ?', [codigo]);
      excecoes = ex;
    }
    return {
      codigo: u.CODIGO, nome: u.NOME, cargo: u.CARGO || '', empresa: u.RAZAO_SOCIAL || '',
      perfil: web && web.perfil_id != null ? { id: web.perfil_id, nome: web.perfil_nome || '' } : null,
      estados: web ? parseEstados(web.estados) : [],
      ativo,
      permissoes: permissoesFinais({ permissoesPerfil, excecoes, ativo })
    };
  }

  async function carregar(codigo) {
    const chave = String(codigo);
    const guardado = cache.get(chave);
    if (guardado && agora() - guardado.em < ttlMs) return guardado.acesso;
    const acesso = await buscar(codigo);
    cache.set(chave, { acesso, em: agora() });
    return acesso;
  }

  function limpar(codigo) {
    if (codigo === undefined) cache.clear();
    else cache.delete(String(codigo));
  }

  return { carregar, limpar };
}

// "c.ESTADO IN (?,?)" quando o usuário tem estados restritos; vazio = todos
function filtroEstados(req, coluna) {
  const estados = req?.acesso?.estados || [];
  if (!estados.length) return { sql: '', params: [] };
  return { sql: `${coluna} IN (${estados.map(() => '?').join(',')})`, params: [...estados] };
}

module.exports = { parseEstados, criarAcesso, filtroEstados };
