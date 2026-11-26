// Semana compartilhada: caderno de tarefas compartilhado (tabela web_tarefas_admin). Nenhuma tabela do VB é lida ou alterada.
// Todas as rotas exigem tarefas_admin.usar. Quem tem vê e mexe nas mesmas linhas; a autoria vem SEMPRE do login (nunca do corpo).
// `versao` protege contra sobrescrita: quem envia uma versão antiga recebe 409 com a linha atual e nada é gravado (vale também
// para mover e trocar a categoria). Categorias (web_tarefas_admin_categorias): uma lista única, a mesma para todos.
// O texto da tarefa e o nome da categoria nunca vão para a auditoria nem para o log.
// Repetição (série): como na pessoal, mas a operação em série NÃO grava por cima do que outra pessoa mudou: o item clicado leva
// a versão (409 se mudou); dos outros itens do escopo só mudam (ou são apagados) os que ainda estavam iguais a este no que vai
// mudar; os diferentes ficam como estão e a resposta diz quantos ("diferentes"). Concluídos nunca são apagados em série.
const crypto = require('node:crypto');
const { agoraLocal, hojeLocal, ErroUsuario } = require('./transacao');
const { validarData, diasDaSemana, validarNova, validarMudanca, SO_DIA_TEM_HORARIO } = require('../calculo/minha_semana');
const { validarRegra, datasDaRegra, escopoValido, noEscopo } = require('../calculo/agenda_repeticao');
const { alarmeDoBanco } = require('../calculo/alarmes');
const { doBanco: horarioDoBanco, paraBanco: horarioParaBanco } = require('../calculo/agenda_horario');
const { registrarCategoriasAgenda, categoriaExiste, LISTAR: LISTAR_CATEGORIAS, categoria } = require('./agenda_categorias');

const EXIGE = ['tarefas_admin.usar'];
const COLUNAS = 'id, quadro, data, texto, feita, alarme, versao, criada_por, feita_por, categoria_id, serie_id, serie_pos, hora_inicio, hora_fim';
const ESCOPO_INVALIDO = 'Escolha se vale só para este item, para os próximos ou para todos.';
const marcas = n => Array.from({ length: n }, () => '?').join(', ');
const numOuNulo = v => (v == null ? null : Number(v));
const NAO_ACHOU = 'Tarefa não encontrada.';
const CONFLITO = 'Esta linha foi alterada por outra pessoa.';
const SEM_VERSAO = 'Recarregue a página e tente de novo.';
const CAT_INVALIDA = 'Esta categoria não existe mais. Recarregue a página.';
const CAT_REPETIDA = 'Já existe uma categoria com este nome.';

const linha = l => ({
  id: Number(l.id), quadro: l.quadro, data: l.data ? String(l.data).slice(0, 10) : null, texto: l.texto, feita: !!Number(l.feita),
  alarme: alarmeDoBanco(l.alarme), versao: Number(l.versao), criadaPor: l.criada_por || '', feitaPor: l.feita_por || null,
  categoriaId: l.categoria_id == null ? null : Number(l.categoria_id), serieId: l.serie_id || null, seriePos: l.serie_pos == null ? null : Number(l.serie_pos),
  horario: horarioDoBanco(l.hora_inicio, l.hora_fim)
});
const idValido = s => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);
const versaoValida = v => Number.isInteger(v) && v > 0;
const duplicado = err => err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;

function registrarSemanaAdmin({ rota, pool }) {
  // só o código do erro no log: a mensagem do banco pode repetir o texto da tarefa ou o nome da categoria
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err?.code || 'sem código'); res.status(500).json({ error: 'Erro de servidor' }); };

  // transação própria (a de transacao.js registra a mensagem do erro, que poderia conter o texto)
  async function travada(res, rotulo, trabalho, status = 200) {
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
  // os itens da série do item já travado (todos travados também); fora de série, só ele
  async function daSerie(conn, antes) {
    if (!antes.serie_id) return [antes];
    const [membros] = await conn.execute(`SELECT ${COLUNAS} FROM web_tarefas_admin WHERE serie_id = ? ORDER BY serie_pos, id FOR UPDATE`, [antes.serie_id]);
    return membros;
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
    const { quadro, data, texto, categoriaId, horario } = v.valor;
    try {
      if (!(await categoriaExiste((sql, p) => pool.execute(sql, p), categoriaId))) return res.status(400).json({ error: CAT_INVALIDA });
      const quando = agoraLocal();
      const nome = String(req.acesso.nome || '').slice(0, 100);
      const [r] = await pool.execute(
        'INSERT INTO web_tarefas_admin (quadro, data, texto, criada_por_codigo, criada_por, feita, versao, criado_em, atualizado_em, categoria_id, hora_inicio, hora_fim) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)',
        [quadro, data, texto, req.user.id, nome, quando, quando, categoriaId, ...horarioParaBanco(horario)]);
      res.status(201).json({ id: r.insertId, quadro, data, texto, feita: false, alarme: null, versao: 1, criadaPor: nome, feitaPor: null, categoriaId, serieId: null, seriePos: null, horario });
    } catch (err) { erro500(res, 'POST /semana_admin', err); }
  });

  rota('put', '/semana_admin/:id', EXIGE, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: NAO_ACHOU });
    const v = validarMudanca(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const versao = req.body.versao;
    if (!versaoValida(versao)) return res.status(400).json({ error: SEM_VERSAO });
    const escopo = req.body.escopo;
    if (!escopoValido(escopo)) return res.status(400).json({ error: ESCOPO_INVALIDO });
    const { texto, feita, alarme, quadro, data, categoriaId, horario } = v.valor;
    if (escopo === 'proximos' || escopo === 'todos') {
      if (Object.keys(v.valor).some(k => k !== 'texto' && k !== 'categoriaId')) return res.status(400).json({ error: 'Na série só o texto e a categoria mudam juntos.' });
      return travada(res, 'PUT /semana_admin', async conn => {
        const antes = await travar(conn, id, versao);
        if (!(await categoriaExiste((sql, p) => conn.execute(sql, p), categoriaId))) throw new ErroUsuario(400, CAT_INVALIDA);
        const alvo = noEscopo(await daSerie(conn, antes), antes, escopo);
        // o que a pessoa via neste item é o que ela quer trocar: nos outros só troca onde ainda está igual
        const igual = m => (texto === undefined || m.texto === antes.texto) && (categoriaId === undefined || numOuNulo(m.categoria_id) === numOuNulo(antes.categoria_id));
        const jaEsta = m => (texto === undefined || m.texto === texto) && (categoriaId === undefined || numOuNulo(m.categoria_id) === categoriaId);
        const outros = alvo.filter(m => Number(m.id) !== id && !jaEsta(m));
        const mudar = [antes, ...outros.filter(igual)];
        const campos = [], valores = [];
        if (texto !== undefined) { campos.push('texto = ?'); valores.push(texto); }
        if (categoriaId !== undefined) { campos.push('categoria_id = ?'); valores.push(categoriaId); }
        campos.push('atualizado_em = ?', 'versao = versao + 1'); valores.push(agoraLocal());
        await conn.execute(`UPDATE web_tarefas_admin SET ${campos.join(', ')} WHERE id IN (${marcas(mudar.length)})`, [...valores, ...mudar.map(m => Number(m.id))]);
        const depois = mudar.map(m => linha({ ...m, versao: Number(m.versao) + 1, ...(texto !== undefined ? { texto } : {}), ...(categoriaId !== undefined ? { categoria_id: categoriaId } : {}) }))
          .sort((a, b) => (a.seriePos ?? 0) - (b.seriePos ?? 0) || a.id - b.id);
        return { ...depois.find(x => x.id === id), serie: { escopo, alteradas: depois, diferentes: outros.length - (mudar.length - 1) } };
      });
    }
    await travada(res, 'PUT /semana_admin', async conn => {
      const antes = await travar(conn, id, versao);
      const destino = quadro ?? antes.quadro;
      if (alarme && destino === 'notas') throw new ErroUsuario(400, 'Notas não têm alarme.');
      if (horario && destino !== 'dia') throw new ErroUsuario(400, SO_DIA_TEM_HORARIO);
      if (!(await categoriaExiste((sql, p) => conn.execute(sql, p), categoriaId))) throw new ErroUsuario(400, CAT_INVALIDA);
      const campos = [], valores = [];
      let trocouAlarme = false;
      if (texto !== undefined) { campos.push('texto = ?'); valores.push(texto); }
      if (quadro !== undefined) { campos.push('quadro = ?', 'data = ?'); valores.push(quadro, data); }
      // horário só existe nos dias: ir para Tarefas ou Notas tira; entre dias fica (a menos que venha um novo). Leva a versão como o resto.
      if (horario !== undefined || (quadro !== undefined && quadro !== 'dia')) {
        campos.push('hora_inicio = ?', 'hora_fim = ?');
        valores.push(...horarioParaBanco(quadro !== undefined && quadro !== 'dia' ? null : horario));
      }
      if (quadro === 'notas' && antes.quadro !== 'notas') {
        // nota não tem caixinha nem alarme: ao ir para Notas os dois saem (a tela pergunta antes se havia alarme); nota não se repete: sai da série
        campos.push('feita = ?', 'feita_por = ?', 'alarme = ?', 'serie_id = ?', 'serie_pos = ?');
        valores.push(0, null, null, null, null);
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
    const escopo = req.body?.escopo ?? req.query.escopo;
    if (!escopoValido(escopo)) return res.status(400).json({ error: ESCOPO_INVALIDO });
    await travada(res, 'DELETE /semana_admin', async conn => {
      const antes = await travar(conn, id, versao);
      if (escopo !== 'proximos' && escopo !== 'todos') {
        await conn.execute('DELETE FROM web_tarefas_admin WHERE id = ? AND versao = ?', [id, versao]);
        await conn.execute('DELETE FROM web_tarefas_admin_avisos WHERE tarefa_id = ?', [id]);
        return { ok: true };
      }
      // em série: o próprio item sai sempre; dos outros, ficam os concluídos e os que alguém deixou com outro texto
      const outros = noEscopo(await daSerie(conn, antes), antes, escopo).filter(m => Number(m.id) !== id);
      const concluidas = outros.filter(m => Number(m.feita)).length;
      const apagar = [id, ...outros.filter(m => !Number(m.feita) && m.texto === antes.texto).map(m => Number(m.id))];
      await conn.execute(`DELETE FROM web_tarefas_admin WHERE id IN (${marcas(apagar.length)})`, apagar);
      await conn.execute(`DELETE FROM web_tarefas_admin_avisos WHERE tarefa_id IN (${marcas(apagar.length)})`, apagar);
      return { ok: true, serie: { escopo, apagadas: apagar, concluidas, diferentes: outros.length - concluidas - (apagar.length - 1) } };
    });
  });

  // ---------- repetir: o item (na versão que a pessoa via) vira a 1ª ocorrência; cada outra data ganha uma linha própria ----------
  // As cópias são de quem repetiu (autoria do login). Item já em série = 409 (o segundo clique não duplica).
  rota('post', '/semana_admin/:id/repetir', EXIGE, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ error: NAO_ACHOU });
    const v = validarRegra(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const versao = req.body.versao;
    if (!versaoValida(versao)) return res.status(400).json({ error: SEM_VERSAO });
    await travada(res, 'POST /semana_admin/repetir', async conn => {
      const antes = await travar(conn, id, versao);
      if (antes.serie_id) throw new ErroUsuario(409, 'Este item já se repete.', { jaEmSerie: true, atual: linha(antes) });
      if (antes.quadro === 'notas') throw new ErroUsuario(400, 'Notas não se repetem.');
      const d = datasDaRegra(v.regra, antes.quadro === 'dia' ? String(antes.data).slice(0, 10) : hojeLocal());
      if (!d.ok) throw new ErroUsuario(400, d.motivo);
      const serie = crypto.randomBytes(16).toString('hex');
      const quando = agoraLocal();
      const nome = String(req.acesso.nome || '').slice(0, 100);
      await conn.execute('UPDATE web_tarefas_admin SET quadro = ?, data = ?, serie_id = ?, serie_pos = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ? AND versao = ?',
        ['dia', d.datas[0], serie, 1, quando, id, versao]);
      const copias = d.datas.slice(1);
      await conn.execute(
        `INSERT INTO web_tarefas_admin (quadro, data, texto, criada_por_codigo, criada_por, feita, versao, criado_em, atualizado_em, categoria_id, serie_id, serie_pos, hora_inicio, hora_fim) VALUES ${copias.map(() => "('dia', ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?)").join(', ')}`,
        copias.flatMap((data, i) => [data, antes.texto, req.user.id, nome, quando, quando, antes.categoria_id ?? null, serie, i + 2, antes.hora_inicio ?? null, antes.hora_fim ?? null]));
      const [linhas] = await conn.execute(`SELECT ${COLUNAS} FROM web_tarefas_admin WHERE serie_id = ? ORDER BY serie_pos, id`, [serie]);
      const todas = linhas.map(linha);
      return { linha: todas[0], linhas: todas, qtd: todas.length };
    }, 201);
  });

  // ---------- categorias: a lista única das duas agendas (rotas/agenda_categorias.js); quem tem a permissão cria, renomeia, troca a cor e exclui ----------
  registrarCategoriasAgenda({ rota, pool, base: '/semana_admin/categorias', ler: EXIGE });
}

module.exports = { registrarSemanaAdmin };
