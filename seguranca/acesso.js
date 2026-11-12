// ==========================================================================
// Acesso do usuário: perfil + exceções + estados + ativo, lido do banco
// a cada requisição com cache curto (limpo na hora pela administração).
// ==========================================================================
const { permissoesFinais } = require('./permissoes');
const { lerHorario, bloqueioAgora } = require('../calculo/horario_acesso');

function parseEstados(texto) {
  if (!texto) return [];
  return [...new Set(String(texto).split(/[\s,;]+/).map(e => e.trim().toUpperCase()).filter(Boolean))];
}

function criarAcesso({ pool, ttlMs = 60000, agora = () => Date.now() }) {
  const cache = new Map();

  async function buscar(codigo) {
    // Cada ida ao banco custa ~190 ms (Render -> HostGator): as 3 leituras que só dependem do código saem JUNTAS (eram 4 em série).
    // Só as permissões do perfil dependem do resultado (perfil_id): uma segunda ida, não três. Os SQLs são os mesmos de sempre.
    const [[usuarios], [webs], [ex]] = await Promise.all([
      pool.execute('SELECT CODIGO, NOME, CARGO, RAZAO_SOCIAL, SITUACAO FROM cliente_usuarios WHERE CODIGO = ? LIMIT 1', [codigo]),
      pool.execute(
        `SELECT a.perfil_id, a.estados, a.ativo, p.nome AS perfil_nome, p.ativo AS perfil_ativo, h.bloqueio_manual, h.horario, h.inatividade_min
         FROM web_usuario_acesso a LEFT JOIN web_perfis p ON p.id = a.perfil_id
         LEFT JOIN web_perfil_horario h ON h.perfil_id = a.perfil_id
         WHERE a.usuario_codigo = ? LIMIT 1`, [codigo]),
      pool.execute('SELECT permissao, tipo FROM web_usuario_excecoes WHERE usuario_codigo = ?', [codigo])
    ]);
    if (!usuarios.length) return null;
    const u = usuarios[0];
    const web = webs[0] || null;
    const ativo = !!web && Number(web.ativo) === 1 && String(u.SITUACAO || '').toUpperCase() !== 'INATIVO';
    let permissoesPerfil = [];
    let excecoes = [];
    if (web) {
      if (web.perfil_id != null && Number(web.perfil_ativo) === 1) {
        const [pp] = await pool.execute('SELECT permissao FROM web_perfil_permissoes WHERE perfil_id = ?', [web.perfil_id]);
        permissoesPerfil = pp.map(r => r.permissao);
      }
      excecoes = ex;
    }
    const permissoes = permissoesFinais({ permissoesPerfil, excecoes, ativo });
    return {
      codigo: u.CODIGO, nome: u.NOME, cargo: u.CARGO || '', empresa: u.RAZAO_SOCIAL || '',
      perfil: web && web.perfil_id != null ? { id: web.perfil_id, nome: web.perfil_nome || '' } : null,
      estados: web ? parseEstados(web.estados) : [],
      ativo,
      permissoes,
      // horário de acesso do PERFIL (calculo/horario_acesso.js); quem administra usuários nunca é barrado (evita trancar todo mundo para fora)
      // minutos sem usar a tela até voltar ao login (aplicado pela tela; null = sem limite); administradores ficam de fora
      inatividadeMin: web && !permissoes.has('admin.usuarios') && Number(web.inatividade_min) > 0 ? Number(web.inatividade_min) : null,
      restricao: web && !permissoes.has('admin.usuarios')
        ? { bloqueioManual: Number(web.bloqueio_manual) === 1, horario: lerHorario(web.horario) } : null
    };
  }

  // O bloqueio por hora é conferido A CADA chamada (o cache guarda só o cadastro): na virada do horário, a próxima ação já é recusada.
  function aplicarBloqueio(acesso) {
    if (!acesso || !acesso.ativo || !acesso.restricao) return acesso;
    const b = bloqueioAgora(acesso.restricao, new Date(agora()));
    return b ? { ...acesso, ativo: false, permissoes: new Set(), bloqueio: b } : acesso;
  }

  async function carregar(codigo) {
    const chave = String(codigo);
    const guardado = cache.get(chave);
    if (guardado && agora() - guardado.em < ttlMs) return aplicarBloqueio(guardado.acesso);
    const acesso = await buscar(codigo);
    cache.set(chave, { acesso, em: agora() });
    return aplicarBloqueio(acesso);
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
