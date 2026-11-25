// Alarmes das duas semanas (pessoal e dos administradores): o que ainda não foi visto por quem está logado, OK e Adiar.
// O servidor NÃO compara horários: devolve o que há e a tela decide, pelo relógio do aparelho, o que já venceu.
// `alarme` acompanha OK/Adiar: se o horário mudou desde que a janela apareceu, responde 409 e nada é gravado.
// Pessoal: o "já vi" fica na própria linha. Compartilhado: um registro por pessoa (web_tarefas_admin_avisos).
// O texto da tarefa nunca vai para o log nem para a auditoria.
const { validarAlarme, alarmeDoBanco } = require('../calculo/alarmes');

const SO_LOGIN = [];
const NAO_ACHOU = { error: 'Tarefa não encontrada.' };
const MUDOU = { error: 'O alarme desta tarefa mudou.' };

const idValido = s => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);
const veCompartilhada = req => !!req.acesso?.permissoes?.has('tarefas_admin.usar');

function registrarAlarmes({ rota, pool }) {
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err?.code || 'sem código'); res.status(500).json({ error: 'Erro de servidor' }); };

  rota('get', '/alarmes', SO_LOGIN, async (req, res) => {
    try {
      const [[pessoais], [compartilhados]] = await Promise.all([
        pool.execute(
          `SELECT id, texto, alarme, alarme_adiado AS adiado FROM web_tarefas WHERE usuario_codigo = ? AND feita = 0 AND alarme IS NOT NULL
             AND (alarme_visto IS NULL OR alarme_visto <> alarme)`, [req.user.id]),
        veCompartilhada(req)
          ? pool.execute(
            `SELECT t.id, t.texto, t.alarme, v.adiado FROM web_tarefas_admin t LEFT JOIN web_tarefas_admin_avisos v
               ON v.tarefa_id = t.id AND v.usuario_codigo = ? AND v.alarme = t.alarme
             WHERE t.feita = 0 AND t.alarme IS NOT NULL AND (v.visto IS NULL OR v.visto = 0)`, [req.user.id])
          : [[]]
      ]);
      const formatar = origem => l => {
        const alarme = alarmeDoBanco(l.alarme);
        return { origem, id: Number(l.id), texto: l.texto, alarme, quando: alarmeDoBanco(l.adiado) || alarme };
      };
      res.json({ alarmes: [...pessoais.map(formatar('pessoal')), ...compartilhados.map(formatar('admin'))] });
    } catch (err) { erro500(res, 'GET /alarmes', err); }
  });

  // confere origem, permissão, dono e se o alarme ainda é o da janela; devolve o id, ou null com a resposta já enviada
  async function conferir(req, res) {
    const { origem } = req.params;
    const id = idValido(req.params.id);
    const negar = (status, corpo) => { res.status(status).json(corpo); return null; };
    if ((origem !== 'pessoal' && origem !== 'admin') || !id) return negar(404, NAO_ACHOU);
    if (origem === 'admin' && !veCompartilhada(req)) return negar(403, { error: 'Sem permissão para esta ação.' });
    const alarme = req.body?.alarme;
    if (!validarAlarme(alarme)) return negar(400, { error: 'Alarme inválido.' });
    const [[l]] = origem === 'pessoal'
      ? await pool.execute('SELECT alarme FROM web_tarefas WHERE id = ? AND usuario_codigo = ?', [id, req.user.id])
      : await pool.execute('SELECT alarme FROM web_tarefas_admin WHERE id = ?', [id]);
    if (!l) return negar(404, NAO_ACHOU);
    if (alarmeDoBanco(l.alarme) !== alarme) return negar(409, MUDOU);
    return { origem, id, alarme };
  }

  rota('post', '/alarmes/:origem/:id/ok', SO_LOGIN, async (req, res) => {
    try {
      const a = await conferir(req, res);
      if (!a) return;
      if (a.origem === 'pessoal') {
        await pool.execute('UPDATE web_tarefas SET alarme_visto = ?, alarme_adiado = ? WHERE id = ? AND usuario_codigo = ? AND alarme = ?',
          [a.alarme, null, a.id, req.user.id, a.alarme]);
      } else {
        await pool.execute(
          `INSERT INTO web_tarefas_admin_avisos (tarefa_id, usuario_codigo, alarme, visto, adiado) VALUES (?, ?, ?, 1, NULL)
           ON DUPLICATE KEY UPDATE alarme = VALUES(alarme), visto = 1, adiado = NULL`, [a.id, req.user.id, a.alarme]);
      }
      res.json({ ok: true });
    } catch (err) { erro500(res, 'POST /alarmes/ok', err); }
  });

  rota('post', '/alarmes/:origem/:id/adiar', SO_LOGIN, async (req, res) => {
    const ate = req.body?.ate;
    try {
      const a = await conferir(req, res);
      if (!a) return;
      if (!validarAlarme(ate)) return res.status(400).json({ error: 'Horário inválido.' });
      // adiar NÃO desfaz um OK já dado para o mesmo horário (janela esquecida em outra aba)
      if (a.origem === 'pessoal') {
        await pool.execute('UPDATE web_tarefas SET alarme_adiado = ? WHERE id = ? AND usuario_codigo = ? AND alarme = ?',
          [ate, a.id, req.user.id, a.alarme]);
      } else {
        // a ordem importa: o MySQL avalia da esquerda para a direita, e `visto` precisa olhar o alarme antigo
        await pool.execute(
          `INSERT INTO web_tarefas_admin_avisos (tarefa_id, usuario_codigo, alarme, visto, adiado) VALUES (?, ?, ?, 0, ?)
           ON DUPLICATE KEY UPDATE visto = IF(alarme = VALUES(alarme), visto, 0), adiado = VALUES(adiado), alarme = VALUES(alarme)`,
          [a.id, req.user.id, a.alarme, ate]);
      }
      res.json({ ok: true });
    } catch (err) { erro500(res, 'POST /alarmes/adiar', err); }
  });
}

module.exports = { registrarAlarmes };
