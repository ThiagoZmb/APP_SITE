// Minha semana: caderno de tarefas pessoal (tabela web_tarefas, uma linha por tarefa). Nenhuma tabela do VB é lida ou alterada.
// Só exige login (sem permissão). O dono da linha é SEMPRE req.user.id: nada vindo da requisição escolhe o usuário, linha de
// outra pessoa responde 404 e nem o administrador vê a lista alheia. O texto nunca vai para a auditoria nem para o log.
// Categorias: a LISTA ÚNICA das duas agendas (rotas/agenda_categorias.js): todo logado lê; só tarefas_admin.usar cria, muda e exclui.
// O item guarda o id da lista única em categoria_unica_id (a coluna antiga categoria_id, com ids pessoais, não é mais usada).
// Horário (opcional, só nos itens dos dias): hora_inicio/hora_fim em minutos; na API { inicio, fim } 'HH:MM' ou null (dia todo).
// Repetição (série): o item vira a 1ª ocorrência e as cópias são linhas próprias com o mesmo serie_id (e o mesmo horário); mudar
// texto/categoria ou apagar pode valer para "este", "este e os próximos" ou "todos" (só itens desta pessoa, nunca os concluídos
// na exclusão em série). O horário muda só no item mexido.
const crypto = require('node:crypto');
const { agoraLocal, hojeLocal, ErroUsuario } = require('./transacao');
const { validarData, diasDaSemana, validarNova, validarMudanca, SO_DIA_TEM_HORARIO } = require('../calculo/minha_semana');
const { validarRegra, datasDaRegra, escopoValido, noEscopo } = require('../calculo/agenda_repeticao');
const { alarmeDoBanco } = require('../calculo/alarmes');
const { doBanco: horarioDoBanco, paraBanco: horarioParaBanco } = require('../calculo/agenda_horario');
const { registrarCategoriasAgenda, categoriaExiste, listarCategorias, categoria } = require('./agenda_categorias');

const SO_LOGIN = [];
// categoria_unica_id = id na lista única (web_tarefas_admin_categorias)
const COLUNAS = 'id, quadro, data, texto, feita, alarme, categoria_unica_id, serie_id, serie_pos, hora_inicio, hora_fim';
const NAO_ACHOU = { error: 'Tarefa não encontrada.' };
const CAT_INVALIDA = { error: 'Esta categoria não existe mais. Recarregue a página.' };
const ESCOPO_INVALIDO = { error: 'Escolha se vale só para este item, para os próximos ou para todos.' };
const SO_TEXTO_CATEGORIA = { error: 'Na série só o texto e a categoria mudam juntos.' };

const linha = l => ({ id: Number(l.id), quadro: l.quadro, data: l.data ? String(l.data).slice(0, 10) : null, texto: l.texto, feita: !!Number(l.feita),
  alarme: alarmeDoBanco(l.alarme), categoriaId: l.categoria_unica_id == null ? null : Number(l.categoria_unica_id),
  serieId: l.serie_id || null, seriePos: l.serie_pos == null ? null : Number(l.serie_pos), horario: horarioDoBanco(l.hora_inicio, l.hora_fim) });
const idValido = s => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);
const marcas = n => Array.from({ length: n }, () => '?').join(', ');

function registrarMinhaSemana({ rota, pool }) {
  // só o código do erro no log: a mensagem do banco pode repetir o texto da tarefa ou o nome da categoria
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err?.code || 'sem código'); res.status(500).json({ error: 'Erro de servidor' }); };
  // transação própria (a de transacao.js registra a mensagem do erro, que poderia conter o texto); deadlock = refaz, até 3 vezes
  async function emTransacao(res, rotulo, trabalho, status = 200) {
    for (let tentativa = 1; ; tentativa++) {
      let conn;
      try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const r = await trabalho(conn);
        await conn.commit();
        return res.status(status).json(r);
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
  // o item (travado) e, se ele está numa série, todos os itens dela, SEMPRE desta pessoa
  async function itemESerie(conn, id, usuario) {
    const [[l]] = await conn.execute(`SELECT ${COLUNAS} FROM web_tarefas WHERE id = ? AND usuario_codigo = ? FOR UPDATE`, [id, usuario]);
    if (!l) throw new ErroUsuario(404, NAO_ACHOU.error);
    if (!l.serie_id) return { l, membros: [l] };
    const [membros] = await conn.execute(`SELECT ${COLUNAS} FROM web_tarefas WHERE usuario_codigo = ? AND serie_id = ? ORDER BY serie_pos, id FOR UPDATE`, [usuario, l.serie_id]);
    return { l, membros };
  }
  // a categoria existe na lista única? (null = sem categoria, sempre vale)
  const categoriaValida = id => categoriaExiste((sql, p) => pool.execute(sql, p), id);

  rota('get', '/minha_semana', SO_LOGIN, async (req, res) => {
    const { inicio } = req.query;
    if (!validarData(inicio)) return res.status(400).json({ error: 'Data inválida.' });
    try {
      const dias = diasDaSemana(inicio);
      const [[linhas], [categorias]] = await Promise.all([
        pool.execute(
          `SELECT ${COLUNAS} FROM web_tarefas WHERE usuario_codigo = ? AND (quadro IN ('tarefas', 'notas') OR (quadro = 'dia' AND data BETWEEN ? AND ?)) ORDER BY id`,
          [req.user.id, dias[0], dias[6]]),
        listarCategorias(pool)
      ]);
      // categoria apagada no meio do caminho (corrida com a exclusão): a linha aparece sem categoria
      const ids = new Set(categorias.map(c => Number(c.id)));
      res.json({ linhas: linhas.map(linha).map(l => (l.categoriaId && !ids.has(l.categoriaId) ? { ...l, categoriaId: null } : l)), categorias: categorias.map(categoria) });
    } catch (err) { erro500(res, 'GET /minha_semana', err); }
  });

  rota('post', '/minha_semana', SO_LOGIN, async (req, res) => {
    const v = validarNova(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const { quadro, data, texto, categoriaId, horario } = v.valor;
    try {
      if (!(await categoriaValida(categoriaId))) return res.status(400).json(CAT_INVALIDA);
      const quando = agoraLocal();
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas (usuario_codigo, quadro, data, texto, feita, criado_em, atualizado_em, categoria_unica_id, hora_inicio, hora_fim) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
        [req.user.id, quadro, data, texto, quando, quando, categoriaId, ...horarioParaBanco(horario)]);
      res.status(201).json({ id: r.insertId, quadro, data, texto, feita: false, alarme: null, categoriaId, serieId: null, seriePos: null, horario });
    } catch (err) { erro500(res, 'POST /minha_semana', err); }
  });

  rota('put', '/minha_semana/:id', SO_LOGIN, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json(NAO_ACHOU);
    const v = validarMudanca(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const escopo = req.body.escopo;
    if (!escopoValido(escopo)) return res.status(400).json(ESCOPO_INVALIDO);
    if (escopo === 'proximos' || escopo === 'todos') return mudarSerie(req, res, id, v.valor, escopo);
    const { texto, feita, alarme, quadro, data, categoriaId, horario } = v.valor;
    try {
      const campos = [], valores = [];
      const precisaAntes = alarme !== undefined || quadro !== undefined || horario !== undefined;
      const [antes, catOk] = await Promise.all([
        precisaAntes ? pool.execute(`SELECT ${COLUNAS} FROM web_tarefas WHERE id = ? AND usuario_codigo = ?`, [id, req.user.id]).then(([[l]]) => l || null) : undefined,
        categoriaValida(categoriaId)
      ]);
      if (precisaAntes && !antes) return res.status(404).json(NAO_ACHOU);
      if (!catOk) return res.status(400).json(CAT_INVALIDA);
      const destino = quadro ?? antes?.quadro;
      if (alarme && destino === 'notas') return res.status(400).json({ error: 'Notas não têm alarme.' });
      if (horario && destino !== 'dia') return res.status(400).json({ error: SO_DIA_TEM_HORARIO });
      if (quadro !== undefined) { campos.push('quadro = ?', 'data = ?'); valores.push(quadro, data); }
      // horário só existe nos dias: ir para Tarefas ou Notas tira; entre dias fica (a menos que venha um novo)
      if (horario !== undefined || (quadro !== undefined && quadro !== 'dia')) {
        campos.push('hora_inicio = ?', 'hora_fim = ?');
        valores.push(...horarioParaBanco(quadro !== undefined && quadro !== 'dia' ? null : horario));
      }
      if (quadro === 'notas' && antes.quadro !== 'notas') {
        // nota não tem caixinha nem alarme: ao ir para Notas os dois saem (a tela pergunta antes se havia alarme); nota não se repete: sai da série
        campos.push('feita = ?', 'alarme = ?', 'alarme_visto = ?', 'alarme_adiado = ?', 'serie_id = ?', 'serie_pos = ?');
        valores.push(0, null, null, null, null, null);
      } else {
        // horário novo volta a tocar: o "já vi" e o adiamento eram do horário antigo
        if (alarme !== undefined && alarme !== alarmeDoBanco(antes.alarme)) {
          campos.push('alarme = ?', 'alarme_visto = ?', 'alarme_adiado = ?');
          valores.push(alarme, null, null);
        }
        if (feita !== undefined) { campos.push('feita = ?'); valores.push(feita ? 1 : 0); }
      }
      if (texto !== undefined) { campos.push('texto = ?'); valores.push(texto); }
      if (categoriaId !== undefined) { campos.push('categoria_unica_id = ?'); valores.push(categoriaId); }
      campos.push('atualizado_em = ?'); valores.push(agoraLocal());
      await pool.execute(`UPDATE web_tarefas SET ${campos.join(', ')} WHERE id = ? AND usuario_codigo = ?`, [...valores, id, req.user.id]);
      const [[l]] = await pool.execute(`SELECT ${COLUNAS} FROM web_tarefas WHERE id = ? AND usuario_codigo = ?`, [id, req.user.id]);
      if (!l) return res.status(404).json(NAO_ACHOU);
      res.json(linha(l));
    } catch (err) { erro500(res, 'PUT /minha_semana', err); }
  });

  // mudar texto e/ou categoria de "este e os próximos" ou "todos" da série (numa transação; a pessoal muda todos do escopo)
  async function mudarSerie(req, res, id, valor, escopo) {
    if (Object.keys(valor).some(k => k !== 'texto' && k !== 'categoriaId')) return res.status(400).json(SO_TEXTO_CATEGORIA);
    const usuario = req.user.id;
    try {
      if (!(await categoriaValida(valor.categoriaId))) return res.status(400).json(CAT_INVALIDA);
    } catch (err) { return erro500(res, 'PUT /minha_semana', err); }
    await emTransacao(res, 'PUT /minha_semana', async conn => {
      const { l, membros } = await itemESerie(conn, id, usuario);
      const alvo = noEscopo(membros, l, escopo);
      const campos = [], valores = [];
      if (valor.texto !== undefined) { campos.push('texto = ?'); valores.push(valor.texto); }
      if (valor.categoriaId !== undefined) { campos.push('categoria_unica_id = ?'); valores.push(valor.categoriaId); }
      campos.push('atualizado_em = ?'); valores.push(agoraLocal());
      await conn.execute(`UPDATE web_tarefas SET ${campos.join(', ')} WHERE usuario_codigo = ? AND id IN (${marcas(alvo.length)})`, [...valores, usuario, ...alvo.map(m => Number(m.id))]);
      const depois = alvo.map(m => linha({ ...m, ...(valor.texto !== undefined ? { texto: valor.texto } : {}), ...(valor.categoriaId !== undefined ? { categoria_unica_id: valor.categoriaId } : {}) }));
      return { ...depois.find(x => x.id === id), serie: { escopo, alteradas: depois, diferentes: 0 } };
    });
  }

  rota('delete', '/minha_semana/:id', SO_LOGIN, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json(NAO_ACHOU);
    const escopo = req.query.escopo ?? req.body?.escopo;
    if (!escopoValido(escopo)) return res.status(400).json(ESCOPO_INVALIDO);
    // em série: o próprio item sai sempre; dos outros do escopo, os concluídos ficam
    if (escopo === 'proximos' || escopo === 'todos') {
      return emTransacao(res, 'DELETE /minha_semana', async conn => {
        const { l, membros } = await itemESerie(conn, id, req.user.id);
        const alvo = noEscopo(membros, l, escopo);
        const apagar = alvo.filter(m => Number(m.id) === id || !Number(m.feita)).map(m => Number(m.id));
        await conn.execute(`DELETE FROM web_tarefas WHERE usuario_codigo = ? AND id IN (${marcas(apagar.length)})`, [req.user.id, ...apagar]);
        return { ok: true, serie: { escopo, apagadas: apagar, concluidas: alvo.length - apagar.length, diferentes: 0 } };
      });
    }
    try {
      const [r] = await pool.execute('DELETE FROM web_tarefas WHERE id = ? AND usuario_codigo = ?', [id, req.user.id]);
      if (!r.affectedRows) return res.status(404).json(NAO_ACHOU);
      res.json({ ok: true });
    } catch (err) { erro500(res, 'DELETE /minha_semana', err); }
  });

  // ---------- repetir: o item vira a 1ª ocorrência (vai para a 1ª data) e cada outra data ganha uma linha própria ----------
  // Tudo numa transação, com o item travado: o segundo clique (ou a nova tentativa sem resposta) encontra o item já em série = 409.
  rota('post', '/minha_semana/:id/repetir', SO_LOGIN, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json(NAO_ACHOU);
    const v = validarRegra(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const usuario = req.user.id;
    await emTransacao(res, 'POST /minha_semana/repetir', async conn => {
      const [[l]] = await conn.execute(`SELECT ${COLUNAS} FROM web_tarefas WHERE id = ? AND usuario_codigo = ? FOR UPDATE`, [id, usuario]);
      if (!l) throw new ErroUsuario(404, NAO_ACHOU.error);
      if (l.serie_id) throw new ErroUsuario(409, 'Este item já se repete.', { jaEmSerie: true });
      if (l.quadro === 'notas') throw new ErroUsuario(400, 'Notas não se repetem.');
      const d = datasDaRegra(v.regra, l.quadro === 'dia' ? String(l.data).slice(0, 10) : hojeLocal());
      if (!d.ok) throw new ErroUsuario(400, d.motivo);
      const serie = crypto.randomBytes(16).toString('hex');
      const quando = agoraLocal();
      await conn.execute('UPDATE web_tarefas SET quadro = ?, data = ?, serie_id = ?, serie_pos = ?, atualizado_em = ? WHERE id = ? AND usuario_codigo = ?',
        ['dia', d.datas[0], serie, 1, quando, id, usuario]);
      // as cópias: mesmo texto, categoria e horário, sem alarme e não concluídas (uma ida ao banco para todas)
      const copias = d.datas.slice(1);
      await conn.execute(
        `INSERT INTO web_tarefas (usuario_codigo, quadro, data, texto, feita, criado_em, atualizado_em, categoria_unica_id, serie_id, serie_pos, hora_inicio, hora_fim) VALUES ${copias.map(() => "(?, 'dia', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)").join(', ')}`,
        copias.flatMap((data, i) => [usuario, data, l.texto, quando, quando, l.categoria_unica_id ?? null, serie, i + 2, l.hora_inicio ?? null, l.hora_fim ?? null]));
      const [linhas] = await conn.execute(`SELECT ${COLUNAS} FROM web_tarefas WHERE usuario_codigo = ? AND serie_id = ? ORDER BY serie_pos, id`, [usuario, serie]);
      const todas = linhas.map(linha);
      return { linha: todas[0], linhas: todas, qtd: todas.length };
    }, 201);
  });

  // ---------- categorias: a lista única (ler = qualquer logado; criar, mudar e excluir = tarefas_admin.usar) ----------
  registrarCategoriasAgenda({ rota, pool, base: '/minha_semana/categorias', ler: SO_LOGIN });
}

module.exports = { registrarMinhaSemana };
