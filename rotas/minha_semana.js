// Minha semana: caderno de tarefas pessoal (tabela web_tarefas, uma linha por tarefa). Nenhuma tabela do VB é lida ou alterada.
// Só exige login (sem permissão). O dono da linha é SEMPRE req.user.id: nada vindo da requisição escolhe o usuário, linha de
// outra pessoa responde 404 e nem o administrador vê a lista alheia. O texto nunca vai para a auditoria nem para o log.
// Categorias (web_tarefas_categorias): as de cada pessoa, com a mesma regra de dono; nome também fora do log e da auditoria.
const { agoraLocal } = require('./transacao');
const { validarData, diasDaSemana, validarNova, validarMudanca, validarCategoria, chaveNome, MAX_CATEGORIAS } = require('../calculo/minha_semana');
const { alarmeDoBanco } = require('../calculo/alarmes');

const SO_LOGIN = [];
const COLUNAS = 'id, quadro, data, texto, feita, alarme, categoria_id';
const NAO_ACHOU = { error: 'Tarefa não encontrada.' };
const CAT_NAO_ACHOU = { error: 'Categoria não encontrada.' };
const CAT_INVALIDA = { error: 'Esta categoria não existe na sua lista. Recarregue a página.' };
const CAT_REPETIDA = { error: 'Já existe uma categoria com este nome.' };

const linha = l => ({ id: Number(l.id), quadro: l.quadro, data: l.data ? String(l.data).slice(0, 10) : null, texto: l.texto, feita: !!Number(l.feita),
  alarme: alarmeDoBanco(l.alarme), categoriaId: l.categoria_id == null ? null : Number(l.categoria_id) });
const categoria = c => ({ id: Number(c.id), nome: c.nome, cor: c.cor });
const idValido = s => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);
const duplicado = err => err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;

function registrarMinhaSemana({ rota, pool }) {
  // só o código do erro no log: a mensagem do banco pode repetir o texto da tarefa ou o nome da categoria
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err?.code || 'sem código'); res.status(500).json({ error: 'Erro de servidor' }); };
  const listarCategorias = usuario => pool.execute('SELECT id, nome, cor FROM web_tarefas_categorias WHERE usuario_codigo = ? ORDER BY nome, id', [usuario]);
  // a categoria é desta pessoa? (null = sem categoria, sempre vale)
  const categoriaDoDono = async (id, usuario) => {
    if (id === null || id === undefined) return true;
    const [[c]] = await pool.execute('SELECT id FROM web_tarefas_categorias WHERE id = ? AND usuario_codigo = ?', [id, usuario]);
    return !!c;
  };

  rota('get', '/minha_semana', SO_LOGIN, async (req, res) => {
    const { inicio } = req.query;
    if (!validarData(inicio)) return res.status(400).json({ error: 'Data inválida.' });
    try {
      const dias = diasDaSemana(inicio);
      const [[linhas], [categorias]] = await Promise.all([
        pool.execute(
          `SELECT ${COLUNAS} FROM web_tarefas WHERE usuario_codigo = ? AND (quadro IN ('tarefas', 'notas') OR (quadro = 'dia' AND data BETWEEN ? AND ?)) ORDER BY id`,
          [req.user.id, dias[0], dias[6]]),
        listarCategorias(req.user.id)
      ]);
      // categoria apagada no meio do caminho (corrida com a exclusão): a linha aparece sem categoria
      const ids = new Set(categorias.map(c => Number(c.id)));
      res.json({ linhas: linhas.map(linha).map(l => (l.categoriaId && !ids.has(l.categoriaId) ? { ...l, categoriaId: null } : l)), categorias: categorias.map(categoria) });
    } catch (err) { erro500(res, 'GET /minha_semana', err); }
  });

  rota('post', '/minha_semana', SO_LOGIN, async (req, res) => {
    const v = validarNova(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { quadro, data, texto, categoriaId } = v.valor;
    try {
      if (!(await categoriaDoDono(categoriaId, req.user.id))) return res.status(400).json(CAT_INVALIDA);
      const quando = agoraLocal();
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas (usuario_codigo, quadro, data, texto, feita, criado_em, atualizado_em, categoria_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
        [req.user.id, quadro, data, texto, quando, quando, categoriaId]);
      res.status(201).json({ id: r.insertId, quadro, data, texto, feita: false, alarme: null, categoriaId });
    } catch (err) { erro500(res, 'POST /minha_semana', err); }
  });

  rota('put', '/minha_semana/:id', SO_LOGIN, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json(NAO_ACHOU);
    const v = validarMudanca(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { texto, feita, alarme, quadro, data, categoriaId } = v.valor;
    try {
      const campos = [], valores = [];
      const precisaAntes = alarme !== undefined || quadro !== undefined;
      const [antes, catOk] = await Promise.all([
        precisaAntes ? pool.execute(`SELECT ${COLUNAS} FROM web_tarefas WHERE id = ? AND usuario_codigo = ?`, [id, req.user.id]).then(([[l]]) => l || null) : undefined,
        categoriaDoDono(categoriaId, req.user.id)
      ]);
      if (precisaAntes && !antes) return res.status(404).json(NAO_ACHOU);
      if (!catOk) return res.status(400).json(CAT_INVALIDA);
      const destino = quadro ?? antes?.quadro;
      if (alarme && destino === 'notas') return res.status(400).json({ error: 'Notas não têm alarme.' });
      if (quadro !== undefined) { campos.push('quadro = ?', 'data = ?'); valores.push(quadro, data); }
      if (quadro === 'notas' && antes.quadro !== 'notas') {
        // nota não tem caixinha nem alarme: ao ir para Notas os dois saem (a tela pergunta antes se havia alarme)
        campos.push('feita = ?', 'alarme = ?', 'alarme_visto = ?', 'alarme_adiado = ?');
        valores.push(0, null, null, null);
      } else {
        // horário novo volta a tocar: o "já vi" e o adiamento eram do horário antigo
        if (alarme !== undefined && alarme !== alarmeDoBanco(antes.alarme)) {
          campos.push('alarme = ?', 'alarme_visto = ?', 'alarme_adiado = ?');
          valores.push(alarme, null, null);
        }
        if (feita !== undefined) { campos.push('feita = ?'); valores.push(feita ? 1 : 0); }
      }
      if (texto !== undefined) { campos.push('texto = ?'); valores.push(texto); }
      if (categoriaId !== undefined) { campos.push('categoria_id = ?'); valores.push(categoriaId); }
      campos.push('atualizado_em = ?'); valores.push(agoraLocal());
      await pool.execute(`UPDATE web_tarefas SET ${campos.join(', ')} WHERE id = ? AND usuario_codigo = ?`, [...valores, id, req.user.id]);
      const [[l]] = await pool.execute(`SELECT ${COLUNAS} FROM web_tarefas WHERE id = ? AND usuario_codigo = ?`, [id, req.user.id]);
      if (!l) return res.status(404).json(NAO_ACHOU);
      res.json(linha(l));
    } catch (err) { erro500(res, 'PUT /minha_semana', err); }
  });

  rota('delete', '/minha_semana/:id', SO_LOGIN, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json(NAO_ACHOU);
    try {
      const [r] = await pool.execute('DELETE FROM web_tarefas WHERE id = ? AND usuario_codigo = ?', [id, req.user.id]);
      if (!r.affectedRows) return res.status(404).json(NAO_ACHOU);
      res.json({ ok: true });
    } catch (err) { erro500(res, 'DELETE /minha_semana', err); }
  });

  // ---------- categorias (só as do dono; alheia = 404) ----------
  rota('get', '/minha_semana/categorias', SO_LOGIN, async (req, res) => {
    try {
      const [cats] = await listarCategorias(req.user.id);
      res.json({ categorias: cats.map(categoria) });
    } catch (err) { erro500(res, 'GET /minha_semana/categorias', err); }
  });

  rota('post', '/minha_semana/categorias', SO_LOGIN, async (req, res) => {
    const v = validarCategoria(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { nome, cor } = v.valor;
    try {
      const [cats] = await listarCategorias(req.user.id);
      if (cats.some(c => chaveNome(c.nome) === chaveNome(nome))) return res.status(409).json(CAT_REPETIDA);
      if (cats.length >= MAX_CATEGORIAS) return res.status(400).json({ error: `Limite de ${MAX_CATEGORIAS} categorias.` });
      const quando = agoraLocal();
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas_categorias (usuario_codigo, nome, cor, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, nome, cor, quando, quando]);
      res.status(201).json({ id: r.insertId, nome, cor });
    } catch (err) {
      if (duplicado(err)) return res.status(409).json(CAT_REPETIDA);
      erro500(res, 'POST /minha_semana/categorias', err);
    }
  });

  rota('put', '/minha_semana/categorias/:id', SO_LOGIN, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json(CAT_NAO_ACHOU);
    const v = validarCategoria(req.body, { parcial: true });
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    try {
      const [cats] = await listarCategorias(req.user.id);
      const atual = cats.find(c => Number(c.id) === id);
      if (!atual) return res.status(404).json(CAT_NAO_ACHOU);
      if (v.valor.nome !== undefined && cats.some(c => Number(c.id) !== id && chaveNome(c.nome) === chaveNome(v.valor.nome))) return res.status(409).json(CAT_REPETIDA);
      const campos = [], valores = [];
      if (v.valor.nome !== undefined) { campos.push('nome = ?'); valores.push(v.valor.nome); }
      if (v.valor.cor !== undefined) { campos.push('cor = ?'); valores.push(v.valor.cor); }
      campos.push('atualizado_em = ?'); valores.push(agoraLocal());
      const [r] = await pool.execute(`UPDATE web_tarefas_categorias SET ${campos.join(', ')} WHERE id = ? AND usuario_codigo = ?`, [...valores, id, req.user.id]);
      if (!r.affectedRows) return res.status(404).json(CAT_NAO_ACHOU);
      res.json(categoria({ ...atual, ...v.valor }));
    } catch (err) {
      if (duplicado(err)) return res.status(409).json(CAT_REPETIDA);
      erro500(res, 'PUT /minha_semana/categorias', err);
    }
  });

  // os itens ficam "Sem categoria"; nunca são apagados
  rota('delete', '/minha_semana/categorias/:id', SO_LOGIN, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json(CAT_NAO_ACHOU);
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [r] = await conn.execute('DELETE FROM web_tarefas_categorias WHERE id = ? AND usuario_codigo = ?', [id, req.user.id]);
      if (!r.affectedRows) { await conn.rollback(); return res.status(404).json(CAT_NAO_ACHOU); }
      await conn.execute('UPDATE web_tarefas SET categoria_id = ? WHERE usuario_codigo = ? AND categoria_id = ?', [null, req.user.id, id]);
      await conn.commit();
      res.json({ ok: true });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      erro500(res, 'DELETE /minha_semana/categorias', err);
    } finally {
      if (conn) conn.release();
    }
  });
}

module.exports = { registrarMinhaSemana };
