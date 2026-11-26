// Agendas: LISTA ÚNICA de categorias (web_tarefas_admin_categorias), a mesma na Minha semana e na Semana compartilhada:
// mesmo nome = mesma cor em todo lugar. Nenhuma tabela do VB é lida ou alterada.
// Ler: quem pode abrir a agenda (`ler`). Criar, renomear, trocar a cor e excluir: só `tarefas_admin.usar` (`gerir`); sem ela o
// registro responde 403 antes de tocar no banco. As rotas existem nas duas bases (/minha_semana/categorias e /semana_admin/categorias).
// Excluir tira a categoria dos itens das DUAS agendas (de todas as pessoas), sem apagar item e sem mudar a versão dos compartilhados.
// O nome da categoria nunca vai para a auditoria nem para o log (só o rótulo da rota e o err.code).
const { agoraLocal } = require('./transacao');
const { validarCategoria, chaveNome, MAX_CATEGORIAS } = require('../calculo/minha_semana');

const LISTAR = 'SELECT id, nome, cor FROM web_tarefas_admin_categorias ORDER BY nome, id';
const CAT_NAO_ACHOU = 'Categoria não encontrada.';
const CAT_REPETIDA = 'Já existe uma categoria com este nome.';
const GERIR = ['tarefas_admin.usar'];

const categoria = c => ({ id: Number(c.id), nome: c.nome, cor: c.cor });
const idValido = s => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);
const duplicado = err => err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;

// a categoria existe na lista única? (null/undefined = sem categoria, sempre vale). `exec` = pool.execute ou conn.execute
async function categoriaExiste(exec, id) {
  if (id === null || id === undefined) return true;
  const [[c]] = await exec('SELECT id FROM web_tarefas_admin_categorias WHERE id = ?', [id]);
  return !!c;
}
const listarCategorias = pool => pool.execute(LISTAR);

function registrarCategoriasAgenda({ rota, pool, base, ler }) {
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err?.code || 'sem código'); res.status(500).json({ error: 'Erro de servidor' }); };

  rota('get', base, ler, async (req, res) => {
    try {
      const [cats] = await listarCategorias(pool);
      res.json({ categorias: cats.map(categoria) });
    } catch (err) { erro500(res, `GET ${base}`, err); }
  });

  rota('post', base, GERIR, async (req, res) => {
    const v = validarCategoria(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { nome, cor } = v.valor;
    try {
      const [cats] = await listarCategorias(pool);
      if (cats.some(c => chaveNome(c.nome) === chaveNome(nome))) return res.status(409).json({ error: CAT_REPETIDA });
      if (cats.length >= MAX_CATEGORIAS) return res.status(400).json({ error: `Limite de ${MAX_CATEGORIAS} categorias.` });
      const quando = agoraLocal();
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas_admin_categorias (nome, cor, criado_por_codigo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
        [nome, cor, req.user.id, quando, quando]);
      res.status(201).json({ id: r.insertId, nome, cor });
    } catch (err) {
      if (duplicado(err)) return res.status(409).json({ error: CAT_REPETIDA });
      erro500(res, `POST ${base}`, err);
    }
  });

  rota('put', base + '/:id', GERIR, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: CAT_NAO_ACHOU });
    const v = validarCategoria(req.body, { parcial: true });
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    try {
      const [cats] = await listarCategorias(pool);
      const atual = cats.find(c => Number(c.id) === id);
      if (!atual) return res.status(404).json({ error: CAT_NAO_ACHOU });
      if (v.valor.nome !== undefined && cats.some(c => Number(c.id) !== id && chaveNome(c.nome) === chaveNome(v.valor.nome))) return res.status(409).json({ error: CAT_REPETIDA });
      const campos = [], valores = [];
      if (v.valor.nome !== undefined) { campos.push('nome = ?'); valores.push(v.valor.nome); }
      if (v.valor.cor !== undefined) { campos.push('cor = ?'); valores.push(v.valor.cor); }
      campos.push('atualizado_em = ?'); valores.push(agoraLocal());
      const [r] = await pool.execute(`UPDATE web_tarefas_admin_categorias SET ${campos.join(', ')} WHERE id = ?`, [...valores, id]);
      if (!r.affectedRows) return res.status(404).json({ error: CAT_NAO_ACHOU });
      res.json(categoria({ ...atual, ...v.valor }));
    } catch (err) {
      if (duplicado(err)) return res.status(409).json({ error: CAT_REPETIDA });
      erro500(res, `PUT ${base}`, err);
    }
  });

  // os itens das duas agendas ficam "Sem categoria" (a versão dos compartilhados não muda); nunca são apagados
  rota('delete', base + '/:id', GERIR, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: CAT_NAO_ACHOU });
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [r] = await conn.execute('DELETE FROM web_tarefas_admin_categorias WHERE id = ?', [id]);
      if (!r.affectedRows) { await conn.rollback(); return res.status(404).json({ error: CAT_NAO_ACHOU }); }
      await conn.execute('UPDATE web_tarefas_admin SET categoria_id = ? WHERE categoria_id = ?', [null, id]);
      await conn.execute('UPDATE web_tarefas SET categoria_unica_id = ? WHERE categoria_unica_id = ?', [null, id]);
      await conn.commit();
      res.json({ ok: true });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      erro500(res, `DELETE ${base}`, err);
    } finally {
      if (conn) conn.release();
    }
  });
}

module.exports = { registrarCategoriasAgenda, categoriaExiste, listarCategorias, categoria, LISTAR };
