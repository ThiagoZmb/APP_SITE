// Semana dos administradores: caderno de tarefas compartilhado (tabela web_tarefas_admin). Nenhuma tabela do VB é lida ou alterada.
// Todas as rotas exigem tarefas_admin.usar. Quem tem vê e mexe nas mesmas linhas; a autoria vem SEMPRE do login (nunca do corpo).
// `versao` protege contra sobrescrita: quem envia uma versão antiga recebe 409 com a linha atual e nada é gravado.
// O texto nunca vai para a auditoria nem para o log.
const { agoraLocal, ErroUsuario } = require('./transacao');
const { validarData, diasDaSemana, validarNova, validarMudanca } = require('../calculo/minha_semana');
const { alarmeDoBanco } = require('../calculo/alarmes');

const EXIGE = ['tarefas_admin.usar'];
const COLUNAS = 'id, quadro, data, texto, feita, alarme, versao, criada_por, feita_por';
const NAO_ACHOU = 'Tarefa não encontrada.';
const CONFLITO = 'Esta linha foi alterada por outra pessoa.';
const SEM_VERSAO = 'Recarregue a página e tente de novo.';

const linha = l => ({
  id: Number(l.id), quadro: l.quadro, data: l.data ? String(l.data).slice(0, 10) : null, texto: l.texto, feita: !!Number(l.feita),
  alarme: alarmeDoBanco(l.alarme), versao: Number(l.versao), criadaPor: l.criada_por || '', feitaPor: l.feita_por || null
});
const idValido = s => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);
const versaoValida = v => Number.isInteger(v) && v > 0;

function registrarSemanaAdmin({ rota, pool }) {
  // só o código do erro no log: a mensagem do banco pode repetir o texto da tarefa
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

  rota('get', '/semana_admin', EXIGE, async (req, res) => {
    const { inicio } = req.query;
    if (!validarData(inicio)) return res.status(400).json({ error: 'Data inválida.' });
    try {
      const dias = diasDaSemana(inicio);
      const [linhas] = await pool.execute(
        `SELECT ${COLUNAS} FROM web_tarefas_admin WHERE quadro IN ('tarefas', 'notas') OR (quadro = 'dia' AND data BETWEEN ? AND ?) ORDER BY id`,
        [dias[0], dias[6]]);
      res.json({ linhas: linhas.map(linha) });
    } catch (err) { erro500(res, 'GET /semana_admin', err); }
  });

  rota('post', '/semana_admin', EXIGE, async (req, res) => {
    const v = validarNova(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { quadro, data, texto } = v.valor;
    try {
      const quando = agoraLocal();
      const nome = String(req.acesso.nome || '').slice(0, 100);
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas_admin (quadro, data, texto, criada_por_codigo, criada_por, feita, versao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)',
        [quadro, data, texto, req.user.id, nome, quando, quando]);
      res.status(201).json({ id: r.insertId, quadro, data, texto, feita: false, alarme: null, versao: 1, criadaPor: nome, feitaPor: null });
    } catch (err) { erro500(res, 'POST /semana_admin', err); }
  });

  rota('put', '/semana_admin/:id', EXIGE, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: NAO_ACHOU });
    const v = validarMudanca(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const versao = req.body.versao;
    if (!versaoValida(versao)) return res.status(400).json({ error: SEM_VERSAO });
    const { texto, feita, alarme } = v.valor;
    await travada(res, 'PUT /semana_admin', async conn => {
      const antes = await travar(conn, id, versao);
      if (alarme && antes.quadro === 'notas') throw new ErroUsuario(400, 'Notas não têm alarme.');
      const campos = [], valores = [];
      if (texto !== undefined) { campos.push('texto = ?'); valores.push(texto); }
      if (feita !== undefined) {
        campos.push('feita = ?', 'feita_por = ?');
        valores.push(feita ? 1 : 0, feita ? String(req.acesso.nome || '').slice(0, 100) : null);
      }
      const trocouAlarme = alarme !== undefined && alarme !== alarmeDoBanco(antes.alarme);
      if (trocouAlarme) { campos.push('alarme = ?'); valores.push(alarme); }
      campos.push('atualizado_em = ?'); valores.push(agoraLocal());
      campos.push('versao = versao + 1');
      await conn.execute(`UPDATE web_tarefas_admin SET ${campos.join(', ')} WHERE id = ? AND versao = ?`, [...valores, id, versao]);
      // alarme trocado volta a tocar para todos: os "já avisei" e os adiamentos eram do horário antigo
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
}

module.exports = { registrarSemanaAdmin };
