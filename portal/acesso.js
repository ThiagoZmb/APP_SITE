// ==========================================================================
// Guardas das rotas do portal do cliente (usadas por criarRegistro):
//   portalAtivo      503 se o portal não está configurado
//   portalAutenticar sessão do cookie + usuário ativo + empresa liberada, TUDO conferido a cada requisição
// Qualquer falha de autenticação devolve a MESMA resposta 401 (nada revela o motivo).
// ==========================================================================
const { NOME_COOKIE, lerCookie } = require('./cookie');

// As permissões do portal (a permissão de funcionário nunca vale aqui)
const PERMISSOES_PORTAL = ['pedidos.ver', 'documentos.ver', 'financeiro.ver'];

const NAO_AUTENTICADO = { error: 'Sessão expirada. Entre novamente.' };
const METODOS_SEGUROS = new Set(['GET', 'HEAD']);

// Empresa pode ter acesso ao portal? O cadastro existe e a Razão Social é única em cadastro_clientes
// (pedidos e financeiro se ligam ao cliente por esse nome, como no JOIN_CLIENTE do index.js).
// `ja_liberada` só é conferido ao liberar. Em caso de ok devolve também a razaoSocial.
async function empresaLiberavel(pool, clienteCodigo, { aoLiberar = false } = {}) {
  const [cad] = await pool.execute('SELECT RAZAO_SOCIAL FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [clienteCodigo]);
  if (!cad.length) return { ok: false, motivo: 'inexistente' };
  const razaoSocial = cad[0].RAZAO_SOCIAL;
  const [cont] = await pool.execute('SELECT COUNT(*) AS n FROM cadastro_clientes WHERE RAZAO_SOCIAL = ?', [razaoSocial]);
  if (Number(cont[0].n) !== 1) return { ok: false, motivo: 'nome_duplicado' };
  if (aoLiberar) {
    const [lib] = await pool.execute('SELECT cliente_codigo FROM web_portal_empresas WHERE cliente_codigo = ? LIMIT 1', [clienteCodigo]);
    if (lib.length) return { ok: false, motivo: 'ja_liberada' };
  }
  return { ok: true, razaoSocial };
}

// Permissões do usuário do portal: o administrador geral tem as três; os demais, as gravadas (só as conhecidas).
async function carregarPermissoesPortal(pool, usuarioId, papel) {
  if (papel === 'admin_geral') return new Set(PERMISSOES_PORTAL);
  const [ps] = await pool.execute('SELECT permissao FROM web_portal_permissoes WHERE usuario_id = ?', [usuarioId]);
  return new Set(ps.map(p => p.permissao).filter(p => PERMISSOES_PORTAL.includes(p)));
}

function criarAcessoPortal({ pool, sessoes, config }) {
  function portalAtivo(req, res, next) {
    if (!config.ativo) return res.status(503).json({ error: 'Portal não configurado.' });
    next();
  }

  async function portalAutenticar(req, res, next) {
    try {
      const sessao = await sessoes.valida(lerCookie(req, NOME_COOKIE));
      if (!sessao) return res.status(401).json(NAO_AUTENTICADO);

      const [us] = await pool.execute(
        `SELECT u.id, u.email, u.cliente_codigo, u.papel, u.situacao, e.situacao AS empresa_situacao
           FROM web_portal_usuarios u LEFT JOIN web_portal_empresas e ON e.cliente_codigo = u.cliente_codigo
          WHERE u.id = ? LIMIT 1`, [sessao.usuarioId]);
      const u = us[0];
      if (!u || u.situacao !== 'ativo' || u.empresa_situacao !== 'ativa') return res.status(401).json(NAO_AUTENTICADO);

      const emp = await empresaLiberavel(pool, u.cliente_codigo);
      if (!emp.ok) return res.status(401).json(NAO_AUTENTICADO);

      const permissoes = await carregarPermissoesPortal(pool, u.id, u.papel);

      // CSRF (depois da sessão, para quem não tem sessão ver sempre o mesmo 401): em método que altera
      // dados exige X-Portal: 1 e, se o navegador mandou Origin, tem de ser o do próprio portal.
      if (!METODOS_SEGUROS.has(req.method)) {
        const origem = req.headers.origin;
        if (req.headers['x-portal'] !== '1' || (origem !== undefined && origem !== config.baseUrl)) {
          return res.status(403).json({ error: 'Requisição recusada.' });
        }
      }

      req.portal = {
        usuarioId: u.id,
        empresaCodigo: u.cliente_codigo,
        papel: u.papel,
        email: u.email,
        razaoSocial: emp.razaoSocial,
        permissoes
      };
      next();
    } catch (err) {
      console.error('Erro ao autenticar no portal:', (err && err.code) || 'sem código');
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  return { portalAtivo, portalAutenticar };
}

module.exports = { criarAcessoPortal, empresaLiberavel, carregarPermissoesPortal, PERMISSOES_PORTAL };
