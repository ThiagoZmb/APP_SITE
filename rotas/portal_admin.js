// ==========================================================================
// Portal do cliente, lado da equipe: liberar empresas, suspender/reativar, convidar o
// administrador geral, reenviar convite e reiniciar o 2º fator (exige portal.gerir).
// Só grava em tabelas web_portal_* (e web_auditoria); cadastro_clientes é apenas lido.
// O token do convite existe só em memória: o banco recebe o hash e o link (com o token no
// fragmento) só é devolvido à equipe quando o e-mail NÃO foi enviado. Auditoria só com ids.
// ==========================================================================
const { novoTokenOpaco } = require('../portal/tokens');
const { empresaLiberavel } = require('../portal/acesso');
const { ErroUsuario } = require('./transacao');

const GERIR = ['portal.gerir'];
const VALIDADE_CONVITE_MS = 48 * 60 * 60 * 1000;
const LIMITE_EMAIL = 190;
const LIMITE_LISTA = 50;
const REGEX_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const MSG_INATIVO = 'Portal não configurado.';
const MSG_NOME_DUPLICADO = 'Há mais de um cadastro com esta razão social; corrija o cadastro antes de liberar o portal.';
const MOTIVOS_LIBERAR = {
  nome_duplicado: MSG_NOME_DUPLICADO,
  ja_liberada: 'Esta empresa já foi liberada para o portal.'
};

// inteiro positivo estrito: '12abc', '1.5', '-3' e '' viram null
const inteiro = v => (/^\d{1,9}$/.test(String(v ?? '')) && Number(v) > 0 ? Number(v) : null);

// e-mail só ASCII (sem espaço nem acento), minúsculo; devolve null se inválido
function normalizarEmail(valor) {
  const bruto = String(valor ?? '').trim();
  if (!bruto || bruto.length > LIMITE_EMAIL || !/^[\x21-\x7e]+$/.test(bruto)) return null;
  const email = bruto.toLowerCase();
  return REGEX_EMAIL.test(email) ? email : null;
}

async function auditar(executor, { quem, acao, alvo, detalhe }) {
  await executor.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
    [quem, acao, alvo || '', JSON.stringify(detalhe ?? null)]);
}

function registrarPortalAdmin({ rota, pool, sessoes, email, config }) {
  // transação simples; ErroUsuario vira a resposta, o resto vira 500 genérico (log só com o código do erro)
  async function emTransacao(res, nome, trabalho) {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const resultado = await trabalho(conn);
      await conn.commit();
      return resultado;
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      if (err instanceof ErroUsuario) res.status(err.status).json({ error: err.message });
      else if (err && err.code === 'ER_DUP_ENTRY') res.status(409).json({ error: 'Já existe um registro igual.' });
      else {
        console.error(`Erro ${nome}:`, (err && err.code) || 'sem código');
        if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
      }
      return undefined;
    } finally {
      if (conn) conn.release();
    }
  }

  const falha = (res, nome, err) => {
    console.error(`Erro ${nome}:`, (err && err.code) || 'sem código');
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  // convite novo de 48 h; o hash vai ao banco e o token em claro volta só para montar o link
  async function criarConvite(conn, usuarioId, quem) {
    const { token, hash } = novoTokenOpaco();
    const agora = new Date();
    await conn.execute(
      'INSERT INTO web_portal_convites (token_hash, usuario_id, expira_em, criado_por, criado_em) VALUES (?, ?, ?, ?, ?)',
      [hash, usuarioId, new Date(agora.getTime() + VALIDADE_CONVITE_MS), quem, agora]);
    return token;
  }

  // depois do commit: tenta o e-mail; sem envio devolve o link para a equipe repassar à mão
  async function responderConvite(res, { token, para, razaoSocial }) {
    const link = `${config.baseUrl}/portal/convite.html#${token}`;
    let enviado = false;
    try { enviado = !!(await email.enviarConvite({ para, link, razaoSocial })).enviado; } catch { enviado = false; }
    res.json(enviado ? { emailEnviado: true } : { emailEnviado: false, link });
  }

  const portalInativo = (req, res) => {
    if (config.ativo) return false;
    res.status(503).json({ error: MSG_INATIVO });
    return true;
  };

  rota('get', '/admin/portal/clientes', GERIR, async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim().slice(0, 100);
      const filtro = q ? `WHERE c.RAZAO_SOCIAL LIKE ? ESCAPE '\\\\' OR c.CODIGO = ?` : '';
      const params = q ? [`%${q.replace(/[\\%_]/g, '\\$&')}%`, inteiro(q) ?? 0] : [];
      const [rows] = await pool.execute(
        `SELECT c.CODIGO, c.RAZAO_SOCIAL, c.CNPJ_CPF, e.situacao AS situacao_portal,
                (SELECT COUNT(*) FROM cadastro_clientes d WHERE d.RAZAO_SOCIAL = c.RAZAO_SOCIAL) AS qtd_nome
         FROM cadastro_clientes c LEFT JOIN web_portal_empresas e ON e.cliente_codigo = c.CODIGO
         ${filtro} ORDER BY c.RAZAO_SOCIAL LIMIT ${LIMITE_LISTA}`, params);
      res.json({
        clientes: rows.map(r => {
          const situacaoPortal = r.situacao_portal || 'nao_liberada';
          const item = {
            codigo: r.CODIGO, razaoSocial: r.RAZAO_SOCIAL || '', cnpjCpf: r.CNPJ_CPF || '', situacaoPortal,
            liberavel: !r.situacao_portal && Number(r.qtd_nome) === 1
          };
          if (r.situacao_portal) item.motivo = MOTIVOS_LIBERAR.ja_liberada;
          else if (Number(r.qtd_nome) !== 1) item.motivo = MSG_NOME_DUPLICADO;
          return item;
        })
      });
    } catch (err) { falha(res, 'GET /admin/portal/clientes', err); }
  });

  rota('get', '/admin/portal/empresas', GERIR, async (req, res) => {
    try {
      const [rows] = await pool.execute(
        `SELECT e.cliente_codigo, c.RAZAO_SOCIAL, e.situacao,
                (SELECT COUNT(*) FROM web_portal_usuarios u WHERE u.cliente_codigo = e.cliente_codigo) AS qtd_usuarios
         FROM web_portal_empresas e LEFT JOIN cadastro_clientes c ON c.CODIGO = e.cliente_codigo
         ORDER BY c.RAZAO_SOCIAL`);
      res.json({
        empresas: rows.map(r => ({
          clienteCodigo: r.cliente_codigo, razaoSocial: r.RAZAO_SOCIAL || '', situacao: r.situacao, qtdUsuarios: Number(r.qtd_usuarios) || 0
        }))
      });
    } catch (err) { falha(res, 'GET /admin/portal/empresas', err); }
  });

  rota('get', '/admin/portal/empresas/:codigo/usuarios', GERIR, async (req, res) => {
    try {
      const codigo = inteiro(req.params.codigo);
      if (!codigo) return res.status(400).json({ error: 'Código da empresa inválido.' });
      const [emp] = await pool.execute('SELECT situacao FROM web_portal_empresas WHERE cliente_codigo = ? LIMIT 1', [codigo]);
      if (!emp.length) return res.status(404).json({ error: 'Empresa não liberada para o portal.' });
      const [rows] = await pool.execute(
        'SELECT id, email, papel, situacao FROM web_portal_usuarios WHERE cliente_codigo = ? ORDER BY id', [codigo]);
      res.json({ usuarios: rows.map(u => ({ id: u.id, email: u.email, papel: u.papel, situacao: u.situacao })) });
    } catch (err) { falha(res, 'GET /admin/portal/empresas/:codigo/usuarios', err); }
  });

  rota('post', '/admin/portal/empresas', GERIR, async (req, res) => {
    const codigo = inteiro((req.body || {}).clienteCodigo);
    if (!codigo) return res.status(400).json({ error: 'Informe o código do cliente.' });
    const ok = await emTransacao(res, 'POST /admin/portal/empresas', async conn => {
      const lib = await empresaLiberavel(conn, codigo, { aoLiberar: true });
      if (!lib.ok) {
        if (lib.motivo === 'inexistente') throw new ErroUsuario(404, 'Cliente não encontrado.');
        throw new ErroUsuario(409, MOTIVOS_LIBERAR[lib.motivo] || 'Não é possível liberar esta empresa.');
      }
      await conn.execute(
        "INSERT INTO web_portal_empresas (cliente_codigo, situacao, liberado_por, liberado_em) VALUES (?, 'ativa', ?, ?)",
        [codigo, req.user.nome, new Date()]);
      await auditar(conn, { quem: req.user.nome, acao: 'portal_empresa_liberada', alvo: String(codigo), detalhe: { clienteCodigo: codigo } });
      return true;
    });
    if (ok) res.status(201).json({ ok: true, clienteCodigo: codigo });
  });

  rota('post', '/admin/portal/empresas/:codigo/suspender', GERIR, async (req, res) => {
    const codigo = inteiro(req.params.codigo);
    if (!codigo) return res.status(400).json({ error: 'Código da empresa inválido.' });
    const ok = await emTransacao(res, 'POST /admin/portal/empresas/:codigo/suspender', async conn => {
      const [emp] = await conn.execute('SELECT situacao FROM web_portal_empresas WHERE cliente_codigo = ? LIMIT 1 FOR UPDATE', [codigo]);
      if (!emp.length) throw new ErroUsuario(404, 'Empresa não liberada para o portal.');
      if (emp[0].situacao === 'suspensa') throw new ErroUsuario(409, 'A empresa já está suspensa.');
      await conn.execute("UPDATE web_portal_empresas SET situacao = 'suspensa', suspenso_em = ? WHERE cliente_codigo = ?", [new Date(), codigo]);
      await sessoes.revogarEmpresa(codigo); // derruba quem já está logado, na hora
      await auditar(conn, { quem: req.user.nome, acao: 'portal_empresa_suspensa', alvo: String(codigo), detalhe: { clienteCodigo: codigo } });
      return true;
    });
    if (ok) res.json({ ok: true });
  });

  rota('post', '/admin/portal/empresas/:codigo/reativar', GERIR, async (req, res) => {
    const codigo = inteiro(req.params.codigo);
    if (!codigo) return res.status(400).json({ error: 'Código da empresa inválido.' });
    const ok = await emTransacao(res, 'POST /admin/portal/empresas/:codigo/reativar', async conn => {
      const [emp] = await conn.execute('SELECT situacao FROM web_portal_empresas WHERE cliente_codigo = ? LIMIT 1 FOR UPDATE', [codigo]);
      if (!emp.length) throw new ErroUsuario(404, 'Empresa não liberada para o portal.');
      if (emp[0].situacao !== 'suspensa') throw new ErroUsuario(409, 'A empresa não está suspensa.');
      await conn.execute("UPDATE web_portal_empresas SET situacao = 'ativa', suspenso_em = NULL WHERE cliente_codigo = ?", [codigo]);
      await auditar(conn, { quem: req.user.nome, acao: 'portal_empresa_reativada', alvo: String(codigo), detalhe: { clienteCodigo: codigo } });
      return true;
    });
    if (ok) res.json({ ok: true });
  });

  rota('post', '/admin/portal/convites', GERIR, async (req, res) => {
    if (portalInativo(req, res)) return;
    const b = req.body || {};
    const codigo = inteiro(b.clienteCodigo);
    if (!codigo) return res.status(400).json({ error: 'Informe o código do cliente.' });
    const para = normalizarEmail(b.email);
    if (!para) return res.status(400).json({ error: 'E-mail inválido. Use só letras sem acento, números e os símbolos . _ % + -' });
    let razaoSocial = '';
    const token = await emTransacao(res, 'POST /admin/portal/convites', async conn => {
      const [emp] = await conn.execute('SELECT situacao FROM web_portal_empresas WHERE cliente_codigo = ? LIMIT 1 FOR UPDATE', [codigo]);
      if (!emp.length) throw new ErroUsuario(400, 'Libere a empresa para o portal antes de convidar.');
      if (emp[0].situacao !== 'ativa') throw new ErroUsuario(400, 'A empresa está suspensa. Reative-a antes de convidar.');
      const [dup] = await conn.execute('SELECT id FROM web_portal_usuarios WHERE email = ? LIMIT 1', [para]);
      if (dup.length) throw new ErroUsuario(409, 'Já existe um usuário do portal com este e-mail.');
      const [cad] = await conn.execute('SELECT RAZAO_SOCIAL FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [codigo]);
      razaoSocial = cad.length ? cad[0].RAZAO_SOCIAL : '';
      const [ins] = await conn.execute(
        "INSERT INTO web_portal_usuarios (email, cliente_codigo, papel, situacao, criado_em, criado_por) VALUES (?, ?, 'admin_geral', 'convidado', ?, ?)",
        [para, codigo, new Date(), req.user.nome]);
      const usuarioId = ins.insertId;
      const novo = await criarConvite(conn, usuarioId, req.user.nome);
      await auditar(conn, { quem: req.user.nome, acao: 'portal_convite_criado', alvo: String(usuarioId), detalhe: { usuarioId, clienteCodigo: codigo } });
      return novo;
    });
    if (token === undefined) return;
    await responderConvite(res, { token, para, razaoSocial });
  });

  // lê o usuário travado; devolve também a razão social para o texto do e-mail
  async function usuarioParaConvite(conn, id) {
    const [us] = await conn.execute('SELECT id, email, cliente_codigo, situacao FROM web_portal_usuarios WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!us.length) throw new ErroUsuario(404, 'Usuário não encontrado.');
    const [emp] = await conn.execute('SELECT situacao FROM web_portal_empresas WHERE cliente_codigo = ? LIMIT 1', [us[0].cliente_codigo]);
    if (!emp.length || emp[0].situacao !== 'ativa') throw new ErroUsuario(409, 'A empresa não está ativa no portal.');
    const [cad] = await conn.execute('SELECT RAZAO_SOCIAL FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [us[0].cliente_codigo]);
    return { usuario: us[0], razaoSocial: cad.length ? cad[0].RAZAO_SOCIAL : '' };
  }

  // convites antigos do usuário deixam de valer
  const invalidarConvites = (conn, usuarioId) =>
    conn.execute('UPDATE web_portal_convites SET usado_em = ? WHERE usuario_id = ? AND usado_em IS NULL', [new Date(), usuarioId]);

  rota('post', '/admin/portal/usuarios/:id/reenviar_convite', GERIR, async (req, res) => {
    if (portalInativo(req, res)) return;
    const id = inteiro(req.params.id);
    if (!id) return res.status(400).json({ error: 'Usuário inválido.' });
    let alvo;
    const token = await emTransacao(res, 'POST /admin/portal/usuarios/:id/reenviar_convite', async conn => {
      alvo = await usuarioParaConvite(conn, id);
      if (alvo.usuario.situacao !== 'convidado') throw new ErroUsuario(409, 'Só é possível reenviar o convite de quem ainda não criou o acesso.');
      await invalidarConvites(conn, id);
      const novo = await criarConvite(conn, id, req.user.nome);
      await auditar(conn, { quem: req.user.nome, acao: 'portal_convite_criado', alvo: String(id),
        detalhe: { usuarioId: id, clienteCodigo: alvo.usuario.cliente_codigo, reenvio: true } });
      return novo;
    });
    if (token === undefined) return;
    await responderConvite(res, { token, para: alvo.usuario.email, razaoSocial: alvo.razaoSocial });
  });

  rota('post', '/admin/portal/usuarios/:id/reiniciar_2fa', GERIR, async (req, res) => {
    if (portalInativo(req, res)) return;
    const id = inteiro(req.params.id);
    if (!id) return res.status(400).json({ error: 'Usuário inválido.' });
    let alvo;
    const token = await emTransacao(res, 'POST /admin/portal/usuarios/:id/reiniciar_2fa', async conn => {
      alvo = await usuarioParaConvite(conn, id);
      if (alvo.usuario.situacao !== 'ativo') throw new ErroUsuario(409, 'Só é possível reiniciar o 2º fator de um usuário ativo.');
      await conn.execute(
        "UPDATE web_portal_usuarios SET totp_segredo_cifrado = NULL, totp_ativo = 0, totp_ultimo_passo = 0, senha_hash = NULL, situacao = 'convidado' WHERE id = ?", [id]);
      await conn.execute('DELETE FROM web_portal_recuperacao WHERE usuario_id = ?', [id]);
      await invalidarConvites(conn, id);
      const novo = await criarConvite(conn, id, req.user.nome);
      await sessoes.revogarUsuario(id); // falha aqui desfaz tudo; a conta já não autentica por estar 'convidado'
      await auditar(conn, { quem: req.user.nome, acao: 'portal_2fa_reiniciado', alvo: String(id),
        detalhe: { usuarioId: id, clienteCodigo: alvo.usuario.cliente_codigo } });
      return novo;
    });
    if (token === undefined) return;
    await responderConvite(res, { token, para: alvo.usuario.email, razaoSocial: alvo.razaoSocial });
  });
}

module.exports = { registrarPortalAdmin, normalizarEmail };
