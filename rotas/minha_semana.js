// Minha semana: caderno de tarefas pessoal (tabela web_tarefas, uma linha por tarefa). Nenhuma tabela do VB é lida ou alterada.
// Só exige login (sem permissão). O dono da linha é SEMPRE req.user.id: nada vindo da requisição escolhe o usuário, linha de
// outra pessoa responde 404 e nem o administrador vê a lista alheia. O texto nunca vai para a auditoria nem para o log.
const { agoraLocal } = require('./transacao');
const { validarData, diasDaSemana, validarNova, validarMudanca } = require('../calculo/minha_semana');

const SO_LOGIN = [];
const COLUNAS = 'id, quadro, data, texto, feita';
const NAO_ACHOU = { error: 'Tarefa não encontrada.' };

const linha = l => ({ id: Number(l.id), quadro: l.quadro, data: l.data ? String(l.data).slice(0, 10) : null, texto: l.texto, feita: !!Number(l.feita) });
const idValido = s => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);

function registrarMinhaSemana({ rota, pool }) {
  // só o código do erro no log: a mensagem do banco pode repetir o texto da tarefa
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err?.code || 'sem código'); res.status(500).json({ error: 'Erro de servidor' }); };

  rota('get', '/minha_semana', SO_LOGIN, async (req, res) => {
    const { inicio } = req.query;
    if (!validarData(inicio)) return res.status(400).json({ error: 'Data inválida.' });
    try {
      const dias = diasDaSemana(inicio);
      const [linhas] = await pool.execute(
        `SELECT ${COLUNAS} FROM web_tarefas WHERE usuario_codigo = ? AND (quadro IN ('tarefas', 'notas') OR (quadro = 'dia' AND data BETWEEN ? AND ?)) ORDER BY id`,
        [req.user.id, dias[0], dias[6]]);
      res.json({ linhas: linhas.map(linha) });
    } catch (err) { erro500(res, 'GET /minha_semana', err); }
  });

  rota('post', '/minha_semana', SO_LOGIN, async (req, res) => {
    const v = validarNova(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { quadro, data, texto } = v.valor;
    try {
      const quando = agoraLocal();
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas (usuario_codigo, quadro, data, texto, feita, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 0, ?, ?)',
        [req.user.id, quadro, data, texto, quando, quando]);
      res.status(201).json({ id: r.insertId, quadro, data, texto, feita: false });
    } catch (err) { erro500(res, 'POST /minha_semana', err); }
  });

  rota('put', '/minha_semana/:id', SO_LOGIN, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json(NAO_ACHOU);
    const v = validarMudanca(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    try {
      const campos = [], valores = [];
      if (v.valor.texto !== undefined) { campos.push('texto = ?'); valores.push(v.valor.texto); }
      if (v.valor.feita !== undefined) { campos.push('feita = ?'); valores.push(v.valor.feita ? 1 : 0); }
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
}

module.exports = { registrarMinhaSemana };
