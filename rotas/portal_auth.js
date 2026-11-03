// ==========================================================================
// Portal do cliente, autenticação: convite (iniciar/concluir), login com 2º fator, logout e /eu.
// Regras que não podem se perder:
//  - Rotas públicas só aceitam POST JSON com X-Portal: 1 (um formulário de outro site não envia esse cabeçalho),
//    com limite por IP (falhas) e por conta (criarLimiteLogin; 429 igual para conta real e inexistente).
//  - Login faz o MESMO trabalho em todos os caminhos (1 bcrypt, 1 verificação TOTP, contra hash/segredo falsos
//    quando a conta não existe) e toda falha dá a mesma 401: nada revela se a conta existe, está inativa ou qual item errou.
//  - Anti-replay do TOTP e uso do código de recuperação são UPDATEs atômicos (affectedRows 1): vale um só.
//  - Nada de senha, token, segredo TOTP, código ou e-mail de conta inexistente em resposta, log ou auditoria
//    (e-mail inexistente na auditoria = HMAC curto com subchave da chave do servidor; erro de banco = só err.code).
// ==========================================================================
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const totp = require('../portal/totp');
const { validarSenha } = require('../portal/senha');
const { hashToken, gerarCodigosRecuperacao, hashCodigoRecuperacao } = require('../portal/tokens');
const { cookieSessao, cookieLimpar, lerCookie, NOME_COOKIE } = require('../portal/cookie');
const { empresaLiberavel, carregarPermissoesPortal } = require('../portal/acesso');
const { auditarPortal } = require('../portal/auditoria');
const { emTransacaoPortal } = require('../portal/transacao');
const { criarLimiteLogin, HASH_FALSO, CUSTO_BCRYPT } = require('../seguranca/login_limite');
const { ErroUsuario } = require('./transacao');
const { normalizarEmail } = require('./portal_admin');

const MSG_INATIVO = 'Portal não configurado.';
const MSG_CONVITE = 'Convite inválido ou expirado.';
const MSG_LOGIN = 'E-mail, senha ou código inválidos.';
const MSG_LIMITE = 'Muitas tentativas. Aguarde alguns minutos.';
const MSG_RECUSADA = 'Requisição recusada.';

// token de convite = 32 bytes em base64url (43 caracteres); outro formato nem chega ao banco
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
// segredo TOTP fictício (fixo no processo): conta inexistente também faz a verificação, no mesmo tempo
const SEGREDO_FICTICIO = totp.gerarSegredo();
const QTD_CODIGOS_RECUPERACAO = 10;
const LIMITE_IP = { janelaMs: 15 * 60 * 1000, falhas: 10 };

// Consulta única que SEMPRE devolve 1 linha e roda o MESMO plano com ou sem conta: o derivado k fixa a linha, os LEFT JOINs
// ficam nulos sem conta e a contagem do nome roda contra um valor sempre presente (COALESCE). Sem isso a conta real custaria
// uma varredura em cadastro_clientes (tabela do VB, sem índice no nome) e a inexistente não: oráculo de existência por tempo.
// u.id nulo = sem conta. Nome único: mesma comparação coluna-contra-coluna de empresaLiberavel (portal/acesso.js).
const NOME_SEM_CONTA = '-sem-conta-';
const SQL_LOGIN =
  `SELECT u.id, u.email, u.cliente_codigo, u.papel, u.situacao, u.senha_hash, u.totp_segredo_cifrado, u.totp_ativo,
          u.totp_ultimo_passo, e.situacao AS empresa_situacao, c.RAZAO_SOCIAL AS razao_social,
          (SELECT COUNT(*) FROM cadastro_clientes d WHERE d.RAZAO_SOCIAL = COALESCE(c.RAZAO_SOCIAL, '${NOME_SEM_CONTA}')) AS qtd_nome
     FROM (SELECT ? AS em) k
     LEFT JOIN web_portal_usuarios u ON u.email = k.em
     LEFT JOIN web_portal_empresas e ON e.cliente_codigo = u.cliente_codigo
     LEFT JOIN cadastro_clientes c ON c.CODIGO = u.cliente_codigo
    LIMIT 1`;

// o mesmo objeto no login e no /eu (permissões em ordem fixa)
const usuarioDe = ({ email, papel, empresaCodigo, razaoSocial, permissoes }) => ({
  email, papel, empresa: { codigo: empresaCodigo, razaoSocial }, permissoes: [...permissoes].sort()
});

function registrarPortalAuth({ portal, portalPublica, pool, sessoes, cripto, config, limite = criarLimiteLogin(), agora = Date.now, falhasPorIp = LIMITE_IP.falhas }) {
  const hora = () => new Date(agora());
  const falhaInterna = (res, nome, err) => {
    console.error(`Erro ${nome}:`, (err && err.code) || 'sem código');
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  // HMAC curto do e-mail: permite à equipe notar tentativas repetidas sem guardar o e-mail de quem não é cliente
  let subchaveEmail = null;
  const hmacEmail = valor => {
    if (!subchaveEmail) subchaveEmail = crypto.createHmac('sha256', Buffer.from(config.chaveCripto, 'base64')).update('portal-login-email-v1').digest();
    return crypto.createHmac('sha256', subchaveEmail).update(String(valor)).digest('hex').slice(0, 12);
  };

  // defesa em profundidade: sem o cifrador (portal inativo que foi ligado em tempo de execução) nada roda
  const pronto = (req, res, next) => (cripto ? next() : res.status(503).json({ error: MSG_INATIVO }));

  // limite por IP: só respostas de erro contam (skipSuccessfulRequests); um limitador para as 3 rotas públicas
  const limiteIp = rateLimit({
    windowMs: LIMITE_IP.janelaMs, limit: falhasPorIp, skipSuccessfulRequests: true,
    standardHeaders: true, legacyHeaders: false, message: { error: MSG_LIMITE }
  });

  // POST público: X-Portal: 1 + JSON objeto (mais restrito que o guarda de sessão, que também aceita Origin igual ao portal)
  function exigirJson(req, res, next) {
    if (req.headers['x-portal'] !== '1') return res.status(403).json({ error: MSG_RECUSADA });
    const corpo = req.body;
    if (!req.is('application/json') || corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return res.status(400).json({ error: 'Requisição inválida.' });
    }
    next();
  }

  const conviteInvalido = res => res.status(400).json({ error: MSG_CONVITE });
  const tokenDe = corpo => (typeof corpo.token === 'string' && FORMATO_TOKEN.test(corpo.token) ? corpo.token : null);

  // ------------------------------------------------------------------ convite
  portalPublica('post', '/portal/api/convite/iniciar', pronto, limiteIp, exigirJson, async (req, res) => {
    try {
      const token = tokenDe(req.body);
      if (!token) return conviteInvalido(res);
      const [cs] = await pool.execute(
        `SELECT c.id, c.usuario_id, u.email, u.cliente_codigo FROM web_portal_convites c
           INNER JOIN web_portal_usuarios u ON u.id = c.usuario_id
           INNER JOIN web_portal_empresas e ON e.cliente_codigo = u.cliente_codigo
          WHERE c.token_hash = ? AND c.usado_em IS NULL AND c.expira_em > ?
            AND u.situacao = 'convidado' AND e.situacao = 'ativa' LIMIT 1`,
        [hashToken(token), hora()]);
      if (!cs.length) return conviteInvalido(res);
      const c = cs[0];
      if (!(await empresaLiberavel(pool, c.cliente_codigo)).ok) return conviteInvalido(res);

      // segredo novo a cada chamada, gravado cifrado; o 2º fator só vale depois do `concluir` (totp_ativo = 0)
      const segredo = totp.gerarSegredo();
      const [r] = await pool.execute(
        "UPDATE web_portal_usuarios SET totp_segredo_cifrado = ?, totp_ativo = 0 WHERE id = ? AND situacao = 'convidado'",
        [cripto.cifrar(segredo), c.usuario_id]);
      if (r.affectedRows !== 1) return conviteInvalido(res);
      res.json({ email: c.email, segredo, uri: totp.uriOtpauth({ segredo, email: c.email }), termoVersao: config.termoVersao });
    } catch (err) { falhaInterna(res, 'POST /portal/api/convite/iniciar', err); }
  });

  portalPublica('post', '/portal/api/convite/concluir', pronto, limiteIp, exigirJson, async (req, res) => {
    const b = req.body;
    const token = tokenDe(b);
    if (!token) return conviteInvalido(res);
    const feito = await emTransacaoPortal(pool, res, 'POST /portal/api/convite/concluir', async conn => {
      const quando = hora();
      const [cs] = await conn.execute(
        'SELECT id, usuario_id FROM web_portal_convites WHERE token_hash = ? AND usado_em IS NULL AND expira_em > ? LIMIT 1 FOR UPDATE',
        [hashToken(token), quando]);
      if (!cs.length) throw new ErroUsuario(400, MSG_CONVITE);
      const [us] = await conn.execute(
        'SELECT id, email, cliente_codigo, situacao, totp_segredo_cifrado, totp_ultimo_passo FROM web_portal_usuarios WHERE id = ? LIMIT 1 FOR UPDATE',
        [cs[0].usuario_id]);
      const u = us[0];
      if (!u || u.situacao !== 'convidado') throw new ErroUsuario(400, MSG_CONVITE);
      const [es] = await conn.execute('SELECT situacao FROM web_portal_empresas WHERE cliente_codigo = ? LIMIT 1', [u.cliente_codigo]);
      if (!es.length || es[0].situacao !== 'ativa' || !(await empresaLiberavel(conn, u.cliente_codigo)).ok) throw new ErroUsuario(400, MSG_CONVITE);

      // a partir daqui o convite é válido: erro de termo, senha ou código só avisa, sem gravar nada e sem consumir o convite
      if (b.aceitoTermo !== true) throw new ErroUsuario(400, 'É preciso aceitar os termos de uso.');
      if (b.termoVersao !== config.termoVersao) throw new ErroUsuario(400, 'Os termos de uso foram atualizados. Recarregue a página e leia a nova versão.');
      const regra = validarSenha(b.senha, { email: u.email });
      if (!regra.ok) throw new ErroUsuario(400, regra.motivo);
      if (!u.totp_segredo_cifrado) throw new ErroUsuario(400, 'Configure o aplicativo autenticador e informe o código.');
      let segredo;
      try { segredo = cripto.decifrar(u.totp_segredo_cifrado); } catch { throw new ErroUsuario(400, 'Configure o aplicativo autenticador e informe o código.'); }
      const v = totp.verificar(segredo, typeof b.codigo === 'string' ? b.codigo : '', { agora: agora(), ultimoPasso: Number(u.totp_ultimo_passo) || 0 });
      if (!v.ok) throw new ErroUsuario(400, 'Código do autenticador inválido. Confira o aplicativo e tente de novo.');

      const senhaHash = await bcrypt.hash(b.senha, CUSTO_BCRYPT);
      const recuperacao = gerarCodigosRecuperacao(QTD_CODIGOS_RECUPERACAO, config.chaveCripto);

      // reivindica o convite ANTES de gravar a conta: duas conclusões simultâneas, só uma passa
      const [uso] = await conn.execute('UPDATE web_portal_convites SET usado_em = ? WHERE id = ? AND usado_em IS NULL', [quando, cs[0].id]);
      if (uso.affectedRows !== 1) throw new ErroUsuario(400, MSG_CONVITE);
      const [ativ] = await conn.execute(
        `UPDATE web_portal_usuarios SET senha_hash = ?, totp_ativo = 1, totp_ultimo_passo = ?, situacao = 'ativo',
                termo_versao = ?, termo_aceito_em = ?, senha_alterada_em = ? WHERE id = ? AND situacao = 'convidado'`,
        [senhaHash, v.passo, config.termoVersao, quando, quando, u.id]);
      if (ativ.affectedRows !== 1) throw new ErroUsuario(400, MSG_CONVITE);

      // só os HASHES dos códigos vão ao banco; os códigos em claro voltam ao usuário uma única vez
      await conn.execute('DELETE FROM web_portal_recuperacao WHERE usuario_id = ?', [u.id]);
      await conn.execute(
        `INSERT INTO web_portal_recuperacao (usuario_id, codigo_hash) VALUES ${recuperacao.hashes.map(() => '(?, ?)').join(', ')}`,
        recuperacao.hashes.flatMap(h => [u.id, h]));
      return { usuarioId: u.id, clienteCodigo: u.cliente_codigo, codigos: recuperacao.codigos };
    });
    if (!feito) return; // a resposta de erro já foi enviada
    await auditarPortal(pool, { evento: 'convite_aceito', usuarioId: feito.usuarioId, clienteCodigo: feito.clienteCodigo, ip: req.ip });
    res.json({ ok: true, codigosRecuperacao: feito.codigos });
  });

  // ------------------------------------------------------------------ login
  portalPublica('post', '/portal/api/login', pronto, limiteIp, exigirJson, async (req, res) => {
    try {
      const b = req.body;
      const ip = req.ip;
      const bruto = typeof b.email === 'string' ? b.email : '';
      const email = normalizarEmail(bruto); // inválido NUNCA vira 400: segue o mesmo caminho e termina na mesma 401
      // SEMPRE 1 consulta (e-mail inválido busca '', que nunca casa): empresa e unicidade do nome vêm no mesmo SELECT,
      // para o número de idas ao banco (e o tempo) não revelar se a conta existe
      const [rows] = await pool.execute(SQL_LOGIN, [email || '']);
      const u = rows[0] && rows[0].id != null ? rows[0] : null;
      // conta real: pelo id; inexistente (ou e-mail inválido): pelo nome informado (com teto no limitador)
      const chave = u ? `c:${u.id}` : `n:${(email || bruto.trim().toLowerCase()).slice(0, 190)}`;
      const dadosAuditoria = u
        ? { usuarioId: u.id, clienteCodigo: u.cliente_codigo, detalhe: null }
        : { usuarioId: null, clienteCodigo: null, detalhe: { email_hmac: hmacEmail(email || bruto.trim().toLowerCase().slice(0, 190)) } };

      // bloqueio por conta ANTES de qualquer trabalho caro (bcrypt, TOTP); mesma resposta para conta real e inexistente
      const bloqueio = limite.bloqueado(chave);
      if (bloqueio.bloqueado) {
        await auditarPortal(pool, { evento: 'login_bloqueado', ip, ...dadosAuditoria });
        res.set('Retry-After', String(bloqueio.segundos));
        return res.status(429).json({ error: MSG_LIMITE });
      }

      // ---- o mesmo trabalho em todos os caminhos ----
      const senha = typeof b.senha === 'string' ? b.senha.slice(0, 1024) : '';
      let senhaOk = false;
      try { senhaOk = await bcrypt.compare(senha, (u && u.senha_hash) || HASH_FALSO); } catch { senhaOk = false; }

      let segredo = SEGREDO_FICTICIO;
      let segredoReal = false;
      if (u && Number(u.totp_ativo) === 1 && u.totp_segredo_cifrado) {
        try { segredo = cripto.decifrar(u.totp_segredo_cifrado); segredoReal = true; } catch { segredo = SEGREDO_FICTICIO; }
      }
      const codigoTxt = typeof b.codigo === 'string' ? b.codigo : '';
      const formatoOk = /^\d{6}$/.test(codigoTxt.replace(/\s+/g, ''));
      const v = totp.verificar(segredo, formatoOk ? codigoTxt : '000000', { agora: agora(), ultimoPasso: segredoReal ? Number(u.totp_ultimo_passo) || 0 : 0 });
      const totpOk = formatoOk && segredoReal && v.ok === true;

      const recuperacaoTxt = typeof b.codigoRecuperacao === 'string' ? b.codigoRecuperacao.trim().slice(0, 64) : '';
      const hashRecuperacao = hashCodigoRecuperacao(recuperacaoTxt || 'sem-codigo', config.chaveCripto);

      // ---- decisão ----
      // Os UPDATEs de consumo rodam SEMPRE que o corpo traz o campo (a forma do corpo é a mesma para conta real e
      // inexistente), com alvo id 0 quando não há direito (AUTO_INCREMENT começa em 1): o número de consultas
      // nunca revela senha certa nem conta ativa. Só se age sobre o affectedRows quando há direito.
      const contaAtiva = !!u && u.situacao === 'ativo' && u.empresa_situacao === 'ativa' && Number(u.qtd_nome) === 1 && !!u.razao_social;
      const elegivel = senhaOk && contaAtiva && Number(u.totp_ativo) === 1;
      let ok = false;
      let totpGravado = false;
      if (formatoOk) {
        const dono = elegivel && totpOk;
        const passo = dono ? v.passo : 0;
        const [r] = await pool.execute(
          'UPDATE web_portal_usuarios SET totp_ultimo_passo = ? WHERE id = ? AND totp_ultimo_passo < ?', [passo, dono ? u.id : 0, passo]);
        totpGravado = dono && r.affectedRows === 1;
      }
      let recuperacaoGasta = false;
      if (recuperacaoTxt) {
        const dono = elegivel && !totpOk;
        const [r] = await pool.execute(
          'UPDATE web_portal_recuperacao SET usado_em = ? WHERE usuario_id = ? AND codigo_hash = ? AND usado_em IS NULL',
          [hora(), dono ? u.id : 0, hashRecuperacao]);
        recuperacaoGasta = dono && r.affectedRows === 1;
      }
      ok = elegivel && (totpOk ? totpGravado : recuperacaoGasta);

      if (!ok) {
        limite.falhou(chave);
        // conta/empresa inativa fica só na auditoria; ao cliente a resposta é a mesma de qualquer falha
        await auditarPortal(pool, { evento: u && !contaAtiva ? 'login_negado' : 'login_falha', ip, ...dadosAuditoria });
        return res.status(401).json({ error: MSG_LOGIN });
      }

      limite.limpar(chave);
      const token = await sessoes.criar(u.id, ip);
      const permissoes = await carregarPermissoesPortal(pool, u.id, u.papel);
      await auditarPortal(pool, { evento: 'login_ok', ip, ...dadosAuditoria });
      res.setHeader('Set-Cookie', cookieSessao(token));
      res.json({ ok: true, usuario: usuarioDe({ email: u.email, papel: u.papel, empresaCodigo: u.cliente_codigo, razaoSocial: u.razao_social, permissoes }) });
    } catch (err) { falhaInterna(res, 'POST /portal/api/login', err); }
  });

  // ------------------------------------------------------------------ logout e /eu
  // Logout só precisa de sessão + CSRF (X-Portal e Origin do portal): não exige usuário/empresa ativos, senão quem teve a
  // empresa suspensa não conseguiria encerrar a própria sessão. Idempotente: sem sessão (ou expirada) também responde 200
  // e limpa o cookie. Por isso nasce por portalPublica (o guarda de sessão completo recusaria essas contas).
  function exigirCsrf(req, res, next) {
    const origem = req.headers.origin;
    if (req.headers['x-portal'] !== '1' || (origem !== undefined && origem !== config.baseUrl)) {
      return res.status(403).json({ error: MSG_RECUSADA });
    }
    next();
  }
  portalPublica('post', '/portal/api/logout', exigirCsrf, async (req, res) => {
    try {
      const token = lerCookie(req, NOME_COOKIE);
      const sessao = await sessoes.valida(token);
      await sessoes.revogar(token);
      if (sessao) {
        const [us] = await pool.execute('SELECT id, email, cliente_codigo, situacao FROM web_portal_usuarios WHERE id = ? LIMIT 1', [sessao.usuarioId]);
        await auditarPortal(pool, { evento: 'logout', usuarioId: sessao.usuarioId, clienteCodigo: us[0] ? us[0].cliente_codigo : null, ip: req.ip });
      }
      res.setHeader('Set-Cookie', cookieLimpar());
      res.json({ ok: true });
    } catch (err) { falhaInterna(res, 'POST /portal/api/logout', err); }
  });

  portal('get', '/portal/api/eu', [], (req, res) => {
    res.json({ usuario: usuarioDe(req.portal) });
  });
}

module.exports = { registrarPortalAuth };
