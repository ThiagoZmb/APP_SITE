'use strict';
// Portal do cliente, etapa 4: o administrador geral da empresa gerencia os usuários DA PRÓPRIA empresa.
// A empresa vem SEMPRE da sessão (req.portal.empresaCodigo); nenhum parâmetro, cabeçalho ou corpo a escolhe.
// Todo acesso a um usuário por id filtra por `cliente_codigo` no próprio SQL; usuário de outra empresa, inexistente ou id
// inválido responde o MESMO 404 (mesmo status, corpo e cabeçalhos) e nunca é auditado.
// Quem muda papel, situação ou remove trava PRIMEIRO todas as linhas de usuário da empresa (sempre na mesma ordem, por id) e só
// então relê o alvo e as contagens: a trava do último administrador vale sob concorrência. Auditoria só com ids, depois do commit.
// O link do convite só volta ao chamador quando o e-mail não foi enviado; nunca vai a log nem a auditoria.
const rateLimit = require('express-rate-limit');
const { PERMISSOES_CONCEDIVEIS } = require('../portal/acesso');
const { criarConvite, invalidarConvites, responderConviteJson } = require('../portal/convites');
const { emTransacaoPortal } = require('../portal/transacao');
const { auditarPortal } = require('../portal/auditoria');
const { ErroUsuario } = require('./transacao');
const { normalizarEmail } = require('./portal_admin');

const GERIR = ['usuarios.gerir'];
const NAO_ENCONTRADO = { error: 'Usuário não encontrado.' };
const MSG_ULTIMO = 'A empresa precisa de ao menos um administrador ativo.';
const MSG_DUPLICADO = 'Já existe um usuário do portal com este e-mail.';
const MSG_EMAIL = 'E-mail inválido. Use só letras sem acento, números e os símbolos . _ % + -';
const MSG_DOCUMENTOS = 'Para ver documentos, conceda também a visão de pedidos.';
const MSG_LIMITE = { error: 'Muitos convites enviados. Aguarde um pouco.' };
const LIMITE_PADRAO = { janelaMs: 60 * 60 * 1000, max: 20 };

// inteiro positivo estrito: '12abc', '1.5', '-3' e '' viram null
const inteiro = v => (/^\d{1,9}$/.test(String(v ?? '')) && Number(v) > 0 ? Number(v) : null);
const objeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Lista de permissões concedíveis: array de textos únicos, só os códigos de PERMISSOES_CONCEDIVEIS; documentos exige pedidos.
// Devolve { lista } ou { erro } (mensagem para o 400).
function validarPermissoes(lista) {
  if (!Array.isArray(lista)) return { erro: 'Informe a lista de permissões.' };
  if (lista.some(p => typeof p !== 'string' || !PERMISSOES_CONCEDIVEIS.includes(p))) return { erro: 'Permissão inválida.' };
  if (new Set(lista).size !== lista.length) return { erro: 'Permissão repetida.' };
  if (lista.includes('documentos.ver') && !lista.includes('pedidos.ver')) return { erro: MSG_DOCUMENTOS };
  return { lista: [...lista] };
}

// Trava, em ordem fixa, todas as linhas de usuário da empresa. Sempre a PRIMEIRA consulta de quem muda papel, situação ou remove.
async function travarAdministradores(conn, empresa) {
  await conn.execute('SELECT id FROM web_portal_usuarios WHERE cliente_codigo = ? ORDER BY id FOR UPDATE', [empresa]);
}

// O usuário DA EMPRESA (a condição de empresa está no SQL); 404 uniforme se não existe ou é de outra.
async function usuarioDaEmpresa(conn, empresa, id, { travar = false } = {}) {
  const [linhas] = await conn.execute(
    `SELECT id, email, papel, situacao, termo_aceito_em FROM web_portal_usuarios WHERE id = ? AND cliente_codigo = ? LIMIT 1${travar ? ' FOR UPDATE' : ''}`,
    [id, empresa]);
  if (!linhas.length) throw new ErroUsuario(404, NAO_ENCONTRADO.error);
  return linhas[0];
}

// outros administradores ATIVOS da empresa (o alvo fica de fora)
async function outrosAdministradores(conn, empresa, alvoId) {
  const [r] = await conn.execute(
    "SELECT COUNT(*) AS n FROM web_portal_usuarios WHERE cliente_codigo = ? AND papel = 'admin_geral' AND situacao = 'ativo' AND id <> ?",
    [empresa, alvoId]);
  return Number(r[0].n);
}

// apaga as linhas antigas e grava só as novas
async function gravarPermissoes(conn, usuarioId, lista) {
  await conn.execute('DELETE FROM web_portal_permissoes WHERE usuario_id = ?', [usuarioId]);
  for (const permissao of lista) await conn.execute('INSERT INTO web_portal_permissoes (usuario_id, permissao) VALUES (?, ?)', [usuarioId, permissao]);
}

function registrarPortalUsuarios({ portal, pool, sessoes, email, config, limite = LIMITE_PADRAO }) {
  const emTransacao = (res, nome, trabalho) => emTransacaoPortal(pool, res, nome, trabalho);
  const naoEncontrado = res => res.status(404).json(NAO_ENCONTRADO);
  const falha = (res, nome, err) => {
    console.error(`Erro ${nome}:`, (err && err.code) || 'sem código');
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };
  // a auditoria não lança; vai DEPOIS do commit e só com ids
  const auditar = (req, evento, detalhe) => auditarPortal(pool, {
    evento, usuarioId: req.portal.usuarioId, clienteCodigo: req.portal.empresaCodigo, ip: req.ip, detalhe
  });

  // limite de convites por administrador (só em memória), DEPOIS da autenticação; criar e reenviar compartilham a contagem
  const limitar = rateLimit({
    windowMs: limite.janelaMs, limit: limite.max,
    keyGenerator: req => `u${req.portal.usuarioId}`,
    standardHeaders: false, legacyHeaders: false,
    handler: (req, res) => res.status(429).set('Retry-After', String(Math.ceil(limite.janelaMs / 1000))).json(MSG_LIMITE)
  });

  portal('get', '/portal/api/usuarios', GERIR, async (req, res) => {
    try {
      const empresa = req.portal.empresaCodigo;
      const [us] = await pool.execute('SELECT id, email, papel, situacao FROM web_portal_usuarios WHERE cliente_codigo = ? ORDER BY id', [empresa]);
      const [ps] = await pool.execute(
        'SELECT p.usuario_id, p.permissao FROM web_portal_permissoes p INNER JOIN web_portal_usuarios u ON u.id = p.usuario_id WHERE u.cliente_codigo = ? ORDER BY p.usuario_id, p.permissao',
        [empresa]);
      res.json({
        usuarios: us.map(u => ({
          id: u.id, email: u.email, papel: u.papel, situacao: u.situacao,
          // o administrador tem as três por papel; o comum, só as gravadas (e só as concedíveis)
          permissoes: u.papel === 'admin_geral' ? [...PERMISSOES_CONCEDIVEIS].sort()
            : ps.filter(p => p.usuario_id === u.id && PERMISSOES_CONCEDIVEIS.includes(p.permissao)).map(p => p.permissao).sort()
        }))
      });
    } catch (err) { falha(res, 'GET /portal/api/usuarios', err); }
  });

  portal('post', '/portal/api/usuarios', GERIR, limitar, async (req, res) => {
    const b = req.body;
    if (!objeto(b)) return res.status(400).json({ error: 'Requisição inválida.' });
    const para = normalizarEmail(b.email);
    if (!para) return res.status(400).json({ error: MSG_EMAIL });
    const v = validarPermissoes(b.permissoes);
    if (v.erro) return res.status(400).json({ error: v.erro });
    const empresa = req.portal.empresaCodigo;
    const novo = await emTransacao(res, 'POST /portal/api/usuarios', async conn => {
      const [dup] = await conn.execute('SELECT id FROM web_portal_usuarios WHERE email = ? LIMIT 1', [para]); // o e-mail é único em TODAS as empresas
      if (dup.length) throw new ErroUsuario(409, MSG_DUPLICADO);
      const [ins] = await conn.execute(
        "INSERT INTO web_portal_usuarios (email, cliente_codigo, papel, situacao, criado_em, criado_por) VALUES (?, ?, 'usuario', 'convidado', ?, ?)",
        [para, empresa, new Date(), req.portal.email]);
      const usuarioId = ins.insertId;
      for (const permissao of v.lista) await conn.execute('INSERT INTO web_portal_permissoes (usuario_id, permissao) VALUES (?, ?)', [usuarioId, permissao]);
      const token = await criarConvite(conn, usuarioId, req.portal.email);
      return { usuarioId, token };
    });
    if (novo === undefined) return;
    await auditar(req, 'usuario_convidado', `usuario=${novo.usuarioId}`);
    const r = await responderConviteJson({ config, email }, { token: novo.token, para, razaoSocial: req.portal.razaoSocial });
    res.json({ ok: true, ...r });
  });

  portal('put', '/portal/api/usuarios/:id/permissoes', GERIR, async (req, res) => {
    const b = req.body;
    if (!objeto(b)) return res.status(400).json({ error: 'Requisição inválida.' });
    const v = validarPermissoes(b.permissoes);
    if (v.erro) return res.status(400).json({ error: v.erro });
    const id = inteiro(req.params.id);
    if (!id) return naoEncontrado(res);
    const empresa = req.portal.empresaCodigo;
    const ok = await emTransacao(res, 'PUT /portal/api/usuarios/:id/permissoes', async conn => {
      await travarAdministradores(conn, empresa);
      const alvo = await usuarioDaEmpresa(conn, empresa, id, { travar: true });
      if (alvo.papel === 'admin_geral') throw new ErroUsuario(409, 'O administrador tem todas as permissões; rebaixe-o antes de escolher.');
      if (alvo.situacao !== 'ativo' && alvo.situacao !== 'convidado') throw new ErroUsuario(409, 'Não é possível alterar as permissões de um usuário desativado.');
      await gravarPermissoes(conn, id, v.lista);
      return true;
    });
    if (!ok) return;
    await auditar(req, 'usuario_permissoes', `usuario=${id}`);
    res.json({ ok: true });
  });

  portal('post', '/portal/api/usuarios/:id/papel', GERIR, async (req, res) => {
    const b = req.body;
    if (!objeto(b)) return res.status(400).json({ error: 'Requisição inválida.' });
    if (b.papel !== 'admin_geral' && b.papel !== 'usuario') return res.status(400).json({ error: 'Papel inválido.' });
    let lista = [];
    if (b.papel === 'usuario') {
      const v = validarPermissoes(b.permissoes);
      if (v.erro) return res.status(400).json({ error: v.erro });
      lista = v.lista;
    }
    const id = inteiro(req.params.id);
    if (!id) return naoEncontrado(res);
    const empresa = req.portal.empresaCodigo;
    const ok = await emTransacao(res, 'POST /portal/api/usuarios/:id/papel', async conn => {
      await travarAdministradores(conn, empresa);
      const alvo = await usuarioDaEmpresa(conn, empresa, id, { travar: true });
      if (alvo.papel === b.papel) throw new ErroUsuario(409, 'O usuário já tem este papel.');
      if (b.papel === 'admin_geral') {
        if (alvo.situacao !== 'ativo') throw new ErroUsuario(409, 'Só é possível promover quem já ativou o acesso.');
        await conn.execute('DELETE FROM web_portal_permissoes WHERE usuario_id = ?', [id]); // o papel dá tudo
      } else {
        if (alvo.situacao === 'inativo') throw new ErroUsuario(409, 'Não é possível alterar um usuário desativado.');
        if (await outrosAdministradores(conn, empresa, id) === 0) throw new ErroUsuario(409, MSG_ULTIMO);
        await gravarPermissoes(conn, id, lista);
      }
      const [up] = await conn.execute('UPDATE web_portal_usuarios SET papel = ? WHERE id = ? AND cliente_codigo = ?', [b.papel, id, empresa]);
      if (up.affectedRows !== 1) throw new ErroUsuario(404, NAO_ENCONTRADO.error);
      return true;
    });
    if (!ok) return;
    await auditar(req, 'usuario_papel', `usuario=${id};papel=${b.papel}`);
    res.json({ ok: true });
  });

  portal('post', '/portal/api/usuarios/:id/desativar', GERIR, async (req, res) => {
    const id = inteiro(req.params.id);
    if (!id) return naoEncontrado(res);
    const empresa = req.portal.empresaCodigo;
    const ok = await emTransacao(res, 'POST /portal/api/usuarios/:id/desativar', async conn => {
      await travarAdministradores(conn, empresa);
      const alvo = await usuarioDaEmpresa(conn, empresa, id, { travar: true });
      if (alvo.situacao === 'inativo') throw new ErroUsuario(409, 'O usuário já está desativado.');
      if (alvo.papel === 'admin_geral' && alvo.situacao === 'ativo' && await outrosAdministradores(conn, empresa, id) === 0) throw new ErroUsuario(409, MSG_ULTIMO);
      await conn.execute("UPDATE web_portal_usuarios SET situacao = 'inativo' WHERE id = ? AND cliente_codigo = ?", [id, empresa]);
      await invalidarConvites(conn, id);
      await sessoes.revogarUsuario(id); // falha aqui desfaz tudo; o usuário inativo já não autentica de qualquer forma
      return true;
    });
    if (!ok) return;
    await auditar(req, 'usuario_desativado', `usuario=${id}`);
    res.json({ ok: true });
  });

  portal('post', '/portal/api/usuarios/:id/reenviar_convite', GERIR, limitar, async (req, res) => {
    const id = inteiro(req.params.id);
    if (!id) return naoEncontrado(res);
    const empresa = req.portal.empresaCodigo;
    let alvo;
    const token = await emTransacao(res, 'POST /portal/api/usuarios/:id/reenviar_convite', async conn => {
      alvo = await usuarioDaEmpresa(conn, empresa, id, { travar: true });
      if (alvo.situacao !== 'convidado') throw new ErroUsuario(409, 'Só é possível reenviar o convite de quem ainda não criou o acesso.');
      await invalidarConvites(conn, id);
      return criarConvite(conn, id, req.portal.email);
    });
    if (token === undefined) return;
    await auditar(req, 'convite_reenviado', `usuario=${id}`);
    const r = await responderConviteJson({ config, email }, { token, para: alvo.email, razaoSocial: req.portal.razaoSocial });
    res.json({ ok: true, ...r });
  });

  // Remover: só convidado que NUNCA aceitou o convite (e-mail digitado errado); quem já aceitou algum dia só se desativa.
  portal('post', '/portal/api/usuarios/:id/remover', GERIR, async (req, res) => {
    const id = inteiro(req.params.id);
    if (!id) return naoEncontrado(res);
    const empresa = req.portal.empresaCodigo;
    const MSG_SO_CONVIDADO = 'Só dá para remover quem ainda não aceitou o convite; use Desativar.';
    const ok = await emTransacao(res, 'POST /portal/api/usuarios/:id/remover', async conn => {
      await travarAdministradores(conn, empresa);
      const alvo = await usuarioDaEmpresa(conn, empresa, id, { travar: true });
      if (alvo.situacao !== 'convidado' || alvo.termo_aceito_em) throw new ErroUsuario(409, MSG_SO_CONVIDADO);
      await conn.execute('DELETE FROM web_portal_sessoes WHERE usuario_id = ?', [id]);
      await conn.execute('DELETE FROM web_portal_recuperacao WHERE usuario_id = ?', [id]);
      await conn.execute('DELETE FROM web_portal_permissoes WHERE usuario_id = ?', [id]);
      await conn.execute('DELETE FROM web_portal_convites WHERE usuario_id = ?', [id]);
      const [del] = await conn.execute("DELETE FROM web_portal_usuarios WHERE id = ? AND situacao = 'convidado' AND cliente_codigo = ?", [id, empresa]);
      if (del.affectedRows !== 1) throw new ErroUsuario(409, MSG_SO_CONVIDADO);
      return true;
    });
    if (!ok) return;
    await auditar(req, 'usuario_removido', `usuario=${id}`);
    res.json({ ok: true });
  });
}

module.exports = { registrarPortalUsuarios, validarPermissoes };
