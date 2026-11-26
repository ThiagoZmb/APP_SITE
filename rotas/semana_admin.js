// Semana compartilhada: caderno de tarefas compartilhado (tabela web_tarefas_admin). Nenhuma tabela do VB é lida ou alterada.
// Todas as rotas exigem tarefas_admin.usar. Quem tem vê e mexe nas mesmas linhas; a autoria vem SEMPRE do login (nunca do corpo).
// `versao` protege contra sobrescrita: quem envia uma versão antiga recebe 409 com a linha atual e nada é gravado (vale também
// para mover e trocar a categoria). Categorias (web_tarefas_admin_categorias): uma lista única, a mesma para todos.
// O texto da tarefa e o nome da categoria nunca vão para a auditoria nem para o log.
const { agoraLocal, ErroUsuario } = require('./transacao');
const { validarData, diasDaSemana, validarNova, validarMudanca, validarCategoria, chaveNome, MAX_CATEGORIAS } = require('../calculo/minha_semana');
const { alarmeDoBanco } = require('../calculo/alarmes');

const EXIGE = ['tarefas_admin.usar'];
const COLUNAS = 'id, quadro, data, texto, feita, alarme, versao, criada_por, feita_por, categoria_id';
const NAO_ACHOU = 'Tarefa não encontrada.';
const CONFLITO = 'Esta linha foi alterada por outra pessoa.';
const SEM_VERSAO = 'Recarregue a página e tente de novo.';
const CAT_NAO_ACHOU = 'Categoria não encontrada.';
const CAT_INVALIDA = 'Esta categoria não existe mais. Recarregue a página.';
const CAT_REPETIDA = 'Já existe uma categoria com este nome.';

const linha = l => ({
  id: Number(l.id), quadro: l.quadro, data: l.data ? String(l.data).slice(0, 10) : null, texto: l.texto, feita: !!Number(l.feita),
  alarme: alarmeDoBanco(l.alarme), versao: Number(l.versao), criadaPor: l.criada_por || '', feitaPor: l.feita_por || null,
  categoriaId: l.categoria_id == null ? null : Number(l.categoria_id)
});
const categoria = c => ({ id: Number(c.id), nome: c.nome, cor: c.cor });
const idValido = s => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);
const versaoValida = v => Number.isInteger(v) && v > 0;
const duplicado = err => err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
const LISTAR_CATEGORIAS = 'SELECT id, nome, cor FROM web_tarefas_admin_categorias ORDER BY nome, id';

function registrarSemanaAdmin({ rota, pool }) {
  // só o código do erro no log: a mensagem do banco pode repetir o texto da tarefa ou o nome da categoria
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err?.code || 'sem código'); res.status(500).json({ error: 'Erro de servidor' }); };

  // transação própria (a de transacao.js registra a mensagem do erro, que poderia conter o texto)
  async function travada(res, rotulo, trabalho) {
    for (let tentativa = 1; ; tentativa++) {
      let conn;
      try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const r = await trabalho(conn);
        await conn.commit();
        return res.json(r);
      } catch (err) {
        if (conn) await conn.rollback().catch(() => {});
        if ((err?.errno === 1213 || err?.errno === 1205) && tentativa < 3) continue;
        if (err instanceof ErroUsuario) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
        if (duplicado(err)) return res.status(409).json({ error: CAT_REPETIDA });
        return erro500(res, rotulo, err);
      } finally {
        if (conn) conn.release();
      }
    }
  }
  // a linha travada para esta transação, conferindo a versão que a pessoa estava vendo
  async function travar(conn, id, versao) {
    const [[l]] = await conn.execute(`SELECT ${COLUNAS} FROM web_tarefas_admin WHERE id = ? FOR UPDATE`, [id]);
    if (!l) throw new ErroUsuario(404, NAO_ACHOU);
    if (Number(l.versao) !== versao) throw new ErroUsuario(409, CONFLITO, { atual: linha(l) });
    return l;
  }
  // a categoria existe na lista compartilhada? (null = sem categoria, sempre vale)
  async function categoriaExiste(exec, id) {
    if (id === null || id === undefined) return true;
    const [[c]] = await exec('SELECT id FROM web_tarefas_admin_categorias WHERE id = ?', [id]);
    return !!c;
  }

  rota('get', '/semana_admin', EXIGE, async (req, res) => {
    const { inicio } = req.query;
    if (!validarData(inicio)) return res.status(400).json({ error: 'Data inválida.' });
    try {
      const dias = diasDaSemana(inicio);
      const [[linhas], [categorias]] = await Promise.all([
        pool.execute(
          `SELECT ${COLUNAS} FROM web_tarefas_admin WHERE quadro IN ('tarefas', 'notas') OR (quadro = 'dia' AND data BETWEEN ? AND ?) ORDER BY id`,
          [dias[0], dias[6]]),
        pool.execute(LISTAR_CATEGORIAS)
      ]);
      const ids = new Set(categorias.map(c => Number(c.id)));
      res.json({ linhas: linhas.map(linha).map(l => (l.categoriaId && !ids.has(l.categoriaId) ? { ...l, categoriaId: null } : l)), categorias: categorias.map(categoria) });
    } catch (err) { erro500(res, 'GET /semana_admin', err); }
  });

  rota('post', '/semana_admin', EXIGE, async (req, res) => {
    const v = validarNova(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { quadro, data, texto, categoriaId } = v.valor;
    try {
      if (!(await categoriaExiste((sql, p) => pool.execute(sql, p), categoriaId))) return res.status(400).json({ error: CAT_INVALIDA });
      const quando = agoraLocal();
      const nome = String(req.acesso.nome || '').slice(0, 100);
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas_admin (quadro, data, texto, criada_por_codigo, criada_por, feita, versao, criado_em, atualizado_em, categoria_id) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)',
        [quadro, data, texto, req.user.id, nome, quando, quando, categoriaId]);
      res.status(201).json({ id: r.insertId, quadro, data, texto, feita: false, alarme: null, versao: 1, criadaPor: nome, feitaPor: null, categoriaId });
    } catch (err) { erro500(res, 'POST /semana_admin', err); }
  });

  rota('put', '/semana_admin/:id', EXIGE, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: NAO_ACHOU });
    const v = validarMudanca(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const versao = req.body.versao;
    if (!versaoValida(versao)) return res.status(400).json({ error: SEM_VERSAO });
    const { texto, feita, alarme, quadro, data, categoriaId } = v.valor;
    await travada(res, 'PUT /semana_admin', async conn => {
      const antes = await travar(conn, id, versao);
      const destino = quadro ?? antes.quadro;
      if (alarme && destino === 'notas') throw new ErroUsuario(400, 'Notas não têm alarme.');
      if (!(await categoriaExiste((sql, p) => conn.execute(sql, p), categoriaId))) throw new ErroUsuario(400, CAT_INVALIDA);
      const campos = [], valores = [];
      let trocouAlarme = false;
      if (texto !== undefined) { campos.push('texto = ?'); valores.push(texto); }
      if (quadro !== undefined) { campos.push('quadro = ?', 'data = ?'); valores.push(quadro, data); }
      if (quadro === 'notas' && antes.quadro !== 'notas') {
        // nota não tem caixinha nem alarme: ao ir para Notas os dois saem (a tela pergunta antes se havia alarme)
        campos.push('feita = ?', 'feita_por = ?', 'alarme = ?');
        valores.push(0, null, null);
        trocouAlarme = antes.alarme != null;
      } else {
        if (feita !== undefined) {
          campos.push('feita = ?', 'feita_por = ?');
          valores.push(feita ? 1 : 0, feita ? String(req.acesso.nome || '').slice(0, 100) : null);
        }
        trocouAlarme = alarme !== undefined && alarme !== alarmeDoBanco(antes.alarme);
        if (trocouAlarme) { campos.push('alarme = ?'); valores.push(alarme); }
      }
      if (categoriaId !== undefined) { campos.push('categoria_id = ?'); valores.push(categoriaId); }
      campos.push('atualizado_em = ?'); valores.push(agoraLocal());
      campos.push('versao = versao + 1');
      await conn.execute(`UPDATE web_tarefas_admin SET ${campos.join(', ')} WHERE id = ? AND versao = ?`, [...valores, id, versao]);
      // alarme trocado (ou tirado) volta a tocar para todos: os "já avisei" e os adiamentos eram do horário antigo
      if (trocouAlarme) await conn.execute('DELETE FROM web_tarefas_admin_avisos WHERE tarefa_id = ?', [id]);
      const [[l]] = await conn.execute(`SELECT ${COLUNAS} FROM web_tarefas_admin WHERE id = ?`, [id]);
      return linha(l);
    });
  });

  rota('delete', '/semana_admin/:id', EXIGE, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: NAO_ACHOU });
    const versao = req.body?.versao ?? Number(req.query.versao);
    if (!versaoValida(versao)) return res.status(400).json({ error: SEM_VERSAO });
    await travada(res, 'DELETE /semana_admin', async conn => {
      await travar(conn, id, versao);
      await conn.execute('DELETE FROM web_tarefas_admin WHERE id = ? AND versao = ?', [id, versao]);
      await conn.execute('DELETE FROM web_tarefas_admin_avisos WHERE tarefa_id = ?', [id]);
      return { ok: true };
    });
  });

  // ---------- categorias: lista única; quem tem a permissão cria, renomeia, troca a cor e exclui ----------
  rota('get', '/semana_admin/categorias', EXIGE, async (req, res) => {
    try {
      const [cats] = await pool.execute(LISTAR_CATEGORIAS);
      res.json({ categorias: cats.map(categoria) });
    } catch (err) { erro500(res, 'GET /semana_admin/categorias', err); }
  });

  rota('post', '/semana_admin/categorias', EXIGE, async (req, res) => {
    const v = validarCategoria(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { nome, cor } = v.valor;
    try {
      const [cats] = await pool.execute(LISTAR_CATEGORIAS);
      if (cats.some(c => chaveNome(c.nome) === chaveNome(nome))) return res.status(409).json({ error: CAT_REPETIDA });
      if (cats.length >= MAX_CATEGORIAS) return res.status(400).json({ error: `Limite de ${MAX_CATEGORIAS} categorias.` });
      const quando = agoraLocal();
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas_admin_categorias (nome, cor, criado_por_codigo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
        [nome, cor, req.user.id, quando, quando]);
      res.status(201).json({ id: r.insertId, nome, cor });
    } catch (err) {
      if (duplicado(err)) return res.status(409).json({ error: CAT_REPETIDA });
      erro500(res, 'POST /semana_admin/categorias', err);
    }
  });

  rota('put', '/semana_admin/categorias/:id', EXIGE, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: CAT_NAO_ACHOU });
    const v = validarCategoria(req.body, { parcial: true });
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    try {
      const [cats] = await pool.execute(LISTAR_CATEGORIAS);
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
      erro500(res, 'PUT /semana_admin/categorias', err);
    }
  });

  // os itens ficam "Sem categoria" (a versão deles não muda: texto, concluído e alarme continuam os mesmos); nunca são apagados
  rota('delete', '/semana_admin/categorias/:id', EXIGE, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: CAT_NAO_ACHOU });
    await travada(res, 'DELETE /semana_admin/categorias', async conn => {
      const [r] = await conn.execute('DELETE FROM web_tarefas_admin_categorias WHERE id = ?', [id]);
      if (!r.affectedRows) throw new ErroUsuario(404, CAT_NAO_ACHOU);
      await conn.execute('UPDATE web_tarefas_admin SET categoria_id = ? WHERE categoria_id = ?', [null, id]);
      return { ok: true };
    });
  });
}

module.exports = { registrarSemanaAdmin };
