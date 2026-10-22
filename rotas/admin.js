// ==========================================================================
// Administração de usuários, perfis e permissões (exige admin.usuarios).
// Tabelas do VB: só grava em cliente_usuarios (NOME, SENHA, CARGO ao editar,
// e a linha nova ao criar). Todo o resto vive nas tabelas web_*.
// ==========================================================================
const { CATALOGO, CODIGOS, permissoesFinais } = require('../seguranca/permissoes');
const { parseEstados } = require('../seguranca/acesso');

const ADMIN = ['admin.usuarios'];
const MSG_PROPRIO = 'Você não pode remover o seu próprio acesso de administrador.';
const MSG_ULTIMO = 'Não é possível deixar o sistema sem nenhum administrador ativo.';
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const excecoesValidas = lista => (Array.isArray(lista) ? lista : [])
  .filter(e => e && CODIGOS.has(e.permissao) && (e.tipo === 'liberar' || e.tipo === 'bloquear'));

async function auditar(executor, { quem, acao, alvo, detalhe }) {
  await executor.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
    [quem, acao, alvo || '', typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe ?? null)]);
}

// Códigos dos usuários que seriam administradores ativos após uma mudança simulada.
// sobrescrever = { usuarios: { codigo: { perfil_id?, ativo?, excecoes? } }, perfis: { id: { ativo?, permissoes? } } }
async function adminsAtivos(executor, sobrescrever = {}) {
  const [acessos] = await executor.execute(
    `SELECT a.usuario_codigo, a.perfil_id, a.ativo, p.ativo AS perfil_ativo, u.SITUACAO
     FROM web_usuario_acesso a JOIN cliente_usuarios u ON u.CODIGO = a.usuario_codigo
     LEFT JOIN web_perfis p ON p.id = a.perfil_id`);
  const [pp] = await executor.execute('SELECT perfil_id, permissao FROM web_perfil_permissoes');
  const [ex] = await executor.execute('SELECT usuario_codigo, permissao, tipo FROM web_usuario_excecoes');
  const [pf] = await executor.execute('SELECT id, ativo FROM web_perfis');
  const perfilAtivoNoBanco = Object.fromEntries(pf.map(p => [p.id, Number(p.ativo) === 1]));
  const permsPerfil = {};
  for (const r of pp) (permsPerfil[r.perfil_id] = permsPerfil[r.perfil_id] || []).push(r.permissao);
  const perfisMod = sobrescrever.perfis || {};
  const usuariosMod = sobrescrever.usuarios || {};
  const admins = new Set();
  for (const a of acessos) {
    const mod = usuariosMod[a.usuario_codigo] || {};
    if (mod.excluir) continue;
    const perfilId = mod.perfil_id !== undefined ? mod.perfil_id : a.perfil_id;
    const ativoWeb = mod.ativo !== undefined ? mod.ativo : Number(a.ativo) === 1;
    const pm = perfisMod[perfilId] || {};
    // perfil de destino desativado não conta, mesmo que tenha admin.usuarios (acesso.carregar o ignora)
    const perfilAtivo = pm.ativo !== undefined ? pm.ativo : !!perfilAtivoNoBanco[perfilId];
    const ativo = ativoWeb && String(a.SITUACAO || '').toUpperCase() !== 'INATIVO';
    const final = permissoesFinais({
      permissoesPerfil: perfilAtivo ? (pm.permissoes || permsPerfil[perfilId] || []) : [],
      excecoes: mod.excecoes || ex.filter(e => e.usuario_codigo === a.usuario_codigo),
      ativo
    });
    if (final.has('admin.usuarios')) admins.add(Number(a.usuario_codigo));
  }
  return admins;
}

// 409 quando a mudança deixaria o sistema sem admin ou tiraria o admin do próprio editor
function travaAdmin(res, admins, editor, eraAdmin) {
  if (admins.size === 0) { res.status(409).json({ error: MSG_ULTIMO }); return true; }
  if (eraAdmin && !admins.has(Number(editor))) { res.status(409).json({ error: MSG_PROPRIO }); return true; }
  return false;
}

function registrarAdmin({ rota, pool, acesso, bcrypt }) {
  const erro = (res, status, msg) => res.status(status).json({ error: msg });
  const falha = (res, rotaNome, err) => {
    console.error(`Erro ${rotaNome}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  rota('get', '/admin/permissoes', ADMIN, (req, res) => res.json(CATALOGO));

  rota('get', '/admin/opcoes', ADMIN, async (req, res) => {
    try {
      const [cargos] = await pool.execute('SELECT CARGO FROM cargos ORDER BY CARGO');
      const [empresas] = await pool.execute('SELECT RAZAO_SOCIAL FROM cadastro_clientes ORDER BY RAZAO_SOCIAL');
      const [perfis] = await pool.execute('SELECT id, nome, ativo FROM web_perfis ORDER BY nome');
      res.json({ cargos: cargos.map(c => c.CARGO), empresas: empresas.map(e => e.RAZAO_SOCIAL),
        perfis: perfis.map(p => ({ id: p.id, nome: p.nome, ativo: Number(p.ativo) === 1 })) });
    } catch (err) { falha(res, '/admin/opcoes', err); }
  });

  rota('get', '/admin/usuarios', ADMIN, async (req, res) => {
    try {
      const [rows] = await pool.execute(
        `SELECT u.CODIGO, u.NOME, u.CARGO, u.RAZAO_SOCIAL, u.SITUACAO, a.perfil_id, p.nome AS perfil_nome, a.estados, a.ativo,
                (SELECT COUNT(*) FROM web_usuario_excecoes e WHERE e.usuario_codigo = u.CODIGO) AS qtd_excecoes
         FROM cliente_usuarios u
         LEFT JOIN web_usuario_acesso a ON a.usuario_codigo = u.CODIGO
         LEFT JOIN web_perfis p ON p.id = a.perfil_id
         ORDER BY u.NOME`);
      res.json(rows.map(r => ({
        codigo: r.CODIGO, nome: r.NOME, cargo: r.CARGO || '', empresa: r.RAZAO_SOCIAL || '',
        situacaoVB: r.SITUACAO || '', perfil: r.perfil_id != null ? { id: r.perfil_id, nome: r.perfil_nome || '' } : null,
        estados: parseEstados(r.estados), ativoWeb: Number(r.ativo) === 1, qtdExcecoes: Number(r.qtd_excecoes) || 0
      })));
    } catch (err) { falha(res, '/admin/usuarios', err); }
  });

  rota('get', '/admin/usuarios/:codigo', ADMIN, async (req, res) => {
    try {
      const codigo = parseInt(req.params.codigo, 10) || 0;
      acesso.limpar(codigo);
      const a = await acesso.carregar(codigo);
      if (!a) return erro(res, 404, 'Usuário não encontrado.');
      const [web] = await pool.execute('SELECT perfil_id, estados, ativo FROM web_usuario_acesso WHERE usuario_codigo = ? LIMIT 1', [codigo]);
      const [ex] = await pool.execute('SELECT permissao, tipo FROM web_usuario_excecoes WHERE usuario_codigo = ?', [codigo]);
      res.json({
        codigo: a.codigo, nome: a.nome, cargo: a.cargo, empresa: a.empresa, perfil: a.perfil, estados: a.estados,
        ativoWeb: !!web.length && Number(web[0].ativo) === 1, excecoes: ex.map(e => ({ permissao: e.permissao, tipo: e.tipo })),
        permissoesFinais: [...a.permissoes]
      });
    } catch (err) { falha(res, '/admin/usuarios/:codigo', err); }
  });

  rota('post', '/admin/usuarios', ADMIN, async (req, res) => {
    const b = req.body || {};
    const nome = txt(b.nome, 190);
    const senha = String(b.senha ?? '');
    const cargo = txt(b.cargo, 190);
    const empresa = txt(b.empresa, 190) || req.acesso.empresa;
    const perfilId = parseInt(b.perfilId, 10) || 0;
    if (!nome) return erro(res, 400, 'Informe o nome de login (até 190 caracteres).');
    if (senha.length < 8) return erro(res, 400, 'A senha precisa ter pelo menos 8 caracteres.');
    let conn;
    try {
      if (!(await pool.execute('SELECT CARGO FROM cargos WHERE CARGO = ? LIMIT 1', [cargo]))[0].length) return erro(res, 400, 'Cargo inexistente.');
      if (!(await pool.execute('SELECT RAZAO_SOCIAL FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [empresa]))[0].length) return erro(res, 400, 'Empresa inexistente.');
      if (!(await pool.execute('SELECT id FROM web_perfis WHERE id = ? LIMIT 1', [perfilId]))[0].length) return erro(res, 400, 'Perfil inexistente.');
      if ((await pool.execute('SELECT CODIGO FROM cliente_usuarios WHERE NOME = ? LIMIT 1', [nome]))[0].length) return erro(res, 409, 'Já existe um usuário com este nome.');
      const hash = await bcrypt.hash(senha, 12);
      conn = await pool.getConnection();
      await conn.beginTransaction();
      // CODIGO não é auto-incremento: reserva o próximo com trava, para não colidir com o VB
      const [[mx]] = await conn.execute('SELECT MAX(CODIGO) AS m FROM cliente_usuarios FOR UPDATE');
      const codigo = (parseInt(mx.m, 10) || 0) + 1;
      await conn.execute(
        `INSERT INTO cliente_usuarios (CODIGO, NOME, CARGO, SENHA, SITUACAO, RAZAO_SOCIAL, DATA_CADASTRO)
         VALUES (?, ?, ?, ?, 'ATIVO', ?, CURDATE())`, [codigo, nome, cargo, hash, empresa]);
      await conn.execute(
        `INSERT INTO web_usuario_acesso (usuario_codigo, perfil_id, estados, ativo, atualizado_em, atualizado_por)
         VALUES (?, ?, ?, 1, NOW(), ?)`, [codigo, perfilId, parseEstados(b.estados).join(',') || null, req.user.nome]);
      await auditar(conn, { quem: req.user.nome, acao: 'usuario_criado', alvo: nome, detalhe: { codigo, cargo, perfilId, estados: b.estados || '' } });
      await conn.commit();
      res.status(201).json({ codigo });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      falha(res, 'POST /admin/usuarios', err);
    } finally {
      if (conn) conn.release();
    }
  });

  rota('put', '/admin/usuarios/:codigo', ADMIN, async (req, res) => {
    const codigo = parseInt(req.params.codigo, 10) || 0;
    const b = req.body || {};
    let conn;
    try {
      const [[usuario]] = await pool.execute('SELECT CODIGO, NOME FROM cliente_usuarios WHERE CODIGO = ? LIMIT 1', [codigo]);
      if (!usuario) return erro(res, 404, 'Usuário não encontrado.');
      const [[atual]] = await pool.execute('SELECT perfil_id, estados, ativo FROM web_usuario_acesso WHERE usuario_codigo = ? LIMIT 1', [codigo]);
      const novo = {
        perfil_id: b.perfilId !== undefined ? (parseInt(b.perfilId, 10) || null) : (atual?.perfil_id ?? null),
        estados: b.estados !== undefined ? (parseEstados(b.estados).join(',') || null) : (atual?.estados ?? null),
        ativo: b.ativo !== undefined ? (b.ativo ? 1 : 0) : (atual ? Number(atual.ativo) : 1)
      };
      if (b.perfilId !== undefined && novo.perfil_id != null
        && !(await pool.execute('SELECT id FROM web_perfis WHERE id = ? LIMIT 1', [novo.perfil_id]))[0].length) return erro(res, 400, 'Perfil inexistente.');
      const cargo = b.cargo !== undefined ? txt(b.cargo, 190) : null;
      if (cargo !== null && !(await pool.execute('SELECT CARGO FROM cargos WHERE CARGO = ? LIMIT 1', [cargo]))[0].length) return erro(res, 400, 'Cargo inexistente.');
      const excecoes = b.excecoes !== undefined ? excecoesValidas(b.excecoes) : null;

      const antes = await adminsAtivos(pool);
      const depois = await adminsAtivos(pool, { usuarios: { [codigo]: {
        perfil_id: novo.perfil_id, ativo: novo.ativo === 1,
        ...(excecoes ? { excecoes: excecoes.map(e => ({ ...e, usuario_codigo: codigo })) } : {}) } } });
      if (travaAdmin(res, depois, req.user.id, antes.has(Number(req.user.id)))) return;

      conn = await pool.getConnection();
      await conn.beginTransaction();
      await conn.execute(
        `INSERT INTO web_usuario_acesso (usuario_codigo, perfil_id, estados, ativo, atualizado_em, atualizado_por)
         VALUES (?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE perfil_id = VALUES(perfil_id), estados = VALUES(estados), ativo = VALUES(ativo),
           atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)`,
        [codigo, novo.perfil_id, novo.estados, novo.ativo, req.user.nome]);
      if (excecoes) {
        await conn.execute('DELETE FROM web_usuario_excecoes WHERE usuario_codigo = ?', [codigo]);
        for (const e of excecoes) {
          await conn.execute('INSERT INTO web_usuario_excecoes (usuario_codigo, permissao, tipo) VALUES (?, ?, ?)', [codigo, e.permissao, e.tipo]);
        }
      }
      if (cargo !== null) await conn.execute('UPDATE cliente_usuarios SET CARGO = ? WHERE CODIGO = ?', [cargo, codigo]);
      await auditar(conn, { quem: req.user.nome, acao: 'usuario_alterado', alvo: usuario.NOME, detalhe: { ...novo, cargo, excecoes } });
      await conn.commit();
      acesso.limpar(codigo);
      res.json({ ok: true });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      falha(res, 'PUT /admin/usuarios', err);
    } finally {
      if (conn) conn.release();
    }
  });

  rota('delete', '/admin/usuarios/:codigo', ADMIN, async (req, res) => {
    const codigo = parseInt(req.params.codigo, 10) || 0;
    if (codigo <= 0) return erro(res, 404, 'Usuário não encontrado.');
    if (codigo === Number(req.user.id)) return erro(res, 409, 'Você não pode excluir sua própria conta.');
    let conn;
    try {
      const [[usuario]] = await pool.execute('SELECT CODIGO, NOME FROM cliente_usuarios WHERE CODIGO = ? LIMIT 1', [codigo]);
      if (!usuario) return erro(res, 404, 'Usuário não encontrado.');

      const antes = await adminsAtivos(pool);
      const depois = await adminsAtivos(pool, { usuarios: { [codigo]: { excluir: true } } });
      if (travaAdmin(res, depois, req.user.id, antes.has(Number(req.user.id)))) return;

      conn = await pool.getConnection();
      await conn.beginTransaction();
      await conn.execute('DELETE FROM web_usuario_excecoes WHERE usuario_codigo = ?', [codigo]);
      await conn.execute('DELETE FROM web_usuario_acesso WHERE usuario_codigo = ?', [codigo]);
      const [removido] = await conn.execute('DELETE FROM cliente_usuarios WHERE CODIGO = ?', [codigo]);
      if (!removido.affectedRows) {
        await conn.rollback();
        return erro(res, 404, 'Usuário não encontrado.');
      }
      await auditar(conn, { quem: req.user.nome, acao: 'usuario_excluido', alvo: usuario.NOME, detalhe: { codigo } });
      await conn.commit();
      acesso.limpar(codigo);
      res.json({ ok: true });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      falha(res, 'DELETE /admin/usuarios/:codigo', err);
    } finally {
      if (conn) conn.release();
    }
  });

  rota('post', '/admin/usuarios/:codigo/senha', ADMIN, async (req, res) => {
    const codigo = parseInt(req.params.codigo, 10) || 0;
    const senha = String(req.body?.senha ?? '');
    if (senha.length < 8) return erro(res, 400, 'A senha precisa ter pelo menos 8 caracteres.');
    try {
      const [[usuario]] = await pool.execute('SELECT CODIGO, NOME FROM cliente_usuarios WHERE CODIGO = ? LIMIT 1', [codigo]);
      if (!usuario) return erro(res, 404, 'Usuário não encontrado.');
      await pool.execute('UPDATE cliente_usuarios SET SENHA = ? WHERE CODIGO = ?', [await bcrypt.hash(senha, 12), codigo]);
      await auditar(pool, { quem: req.user.nome, acao: 'senha_redefinida', alvo: usuario.NOME, detalhe: null });
      res.json({ ok: true });
    } catch (err) { falha(res, 'POST /admin/usuarios/:codigo/senha', err); }
  });

  rota('get', '/admin/perfis', ADMIN, async (req, res) => {
    try {
      const [perfis] = await pool.execute(
        `SELECT p.id, p.nome, p.descricao, p.ativo,
                (SELECT COUNT(*) FROM web_usuario_acesso a WHERE a.perfil_id = p.id) AS qtd_usuarios
         FROM web_perfis p ORDER BY p.nome`);
      const [pp] = await pool.execute('SELECT perfil_id, permissao FROM web_perfil_permissoes');
      res.json(perfis.map(p => ({
        id: p.id, nome: p.nome, descricao: p.descricao || '', ativo: Number(p.ativo) === 1, qtdUsuarios: Number(p.qtd_usuarios) || 0,
        permissoes: pp.filter(x => x.perfil_id === p.id).map(x => x.permissao)
      })));
    } catch (err) { falha(res, '/admin/perfis', err); }
  });

  rota('post', '/admin/perfis', ADMIN, async (req, res) => {
    const b = req.body || {};
    const nome = txt(b.nome, 60);
    if (!nome) return erro(res, 400, 'Informe o nome do perfil (até 60 caracteres).');
    const permissoes = [...new Set((Array.isArray(b.permissoes) ? b.permissoes : []).filter(c => CODIGOS.has(c)))];
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [r] = await conn.execute('INSERT INTO web_perfis (nome, descricao, ativo, criado_em) VALUES (?, ?, 1, NOW())', [nome, txt(b.descricao, 255) || null]);
      for (const c of permissoes) await conn.execute('INSERT INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [r.insertId, c]);
      await auditar(conn, { quem: req.user.nome, acao: 'perfil_criado', alvo: 'perfil:' + nome, detalhe: { permissoes } });
      await conn.commit();
      res.status(201).json({ id: r.insertId });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      if (err.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Já existe um perfil com este nome.');
      falha(res, 'POST /admin/perfis', err);
    } finally {
      if (conn) conn.release();
    }
  });

  // não existe exclusão de perfil: perfis só são desativados
  rota('put', '/admin/perfis/:id', ADMIN, async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const b = req.body || {};
    const permissoes = b.permissoes !== undefined
      ? [...new Set((Array.isArray(b.permissoes) ? b.permissoes : []).filter(c => CODIGOS.has(c)))] : null;
    let conn;
    try {
      const [[perfil]] = await pool.execute('SELECT id, nome, descricao, ativo FROM web_perfis WHERE id = ? LIMIT 1', [id]);
      if (!perfil) return erro(res, 404, 'Perfil não encontrado.');
      const ativo = b.ativo !== undefined ? !!b.ativo : Number(perfil.ativo) === 1;
      const antes = await adminsAtivos(pool);
      const depois = await adminsAtivos(pool, { perfis: { [id]: { ativo, ...(permissoes ? { permissoes } : {}) } } });
      if (travaAdmin(res, depois, req.user.id, antes.has(Number(req.user.id)))) return;

      conn = await pool.getConnection();
      await conn.beginTransaction();
      await conn.execute('UPDATE web_perfis SET nome = ?, descricao = ?, ativo = ? WHERE id = ?',
        [b.nome !== undefined ? (txt(b.nome, 60) || perfil.nome) : perfil.nome,
         b.descricao !== undefined ? (txt(b.descricao, 255) || null) : perfil.descricao, ativo ? 1 : 0, id]);
      if (permissoes) {
        await conn.execute('DELETE FROM web_perfil_permissoes WHERE perfil_id = ?', [id]);
        for (const c of permissoes) await conn.execute('INSERT INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [id, c]);
      }
      await auditar(conn, { quem: req.user.nome, acao: 'perfil_alterado', alvo: 'perfil:' + perfil.nome, detalhe: { ativo, permissoes } });
      await conn.commit();
      acesso.limpar();
      res.json({ ok: true });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      if (err.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Já existe um perfil com este nome.');
      falha(res, 'PUT /admin/perfis', err);
    } finally {
      if (conn) conn.release();
    }
  });

  rota('get', '/admin/auditoria', ADMIN, async (req, res) => {
    try {
      const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 200, 1), 1000);
      const usuario = txt(req.query.usuario, 190);
      const [rows] = await pool.execute(
        `SELECT id, DATE_FORMAT(quando, '%Y-%m-%d %H:%i:%s') AS quando, quem, acao, alvo, detalhe FROM web_auditoria
         ${usuario ? 'WHERE quem = ? OR alvo = ?' : ''} ORDER BY id DESC LIMIT ${limite}`, usuario ? [usuario, usuario] : []);
      res.json(rows);
    } catch (err) { falha(res, '/admin/auditoria', err); }
  });
}

module.exports = { registrarAdmin, auditar, adminsAtivos };
