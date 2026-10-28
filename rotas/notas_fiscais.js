// Notas fiscais de entrada (fornecedor) e de saída (cliente) só de cabeçalho, sem itens (tabela da web `web_notas_fiscais`).
// Não mexe em estoque, em fluxo_de_caixa nem em nenhuma tabela do VB.
// Depois de criada só mudam data, valor e observação; o resto se corrige cancelando e lançando de novo.
// O número de uma nota cancelada continua ocupado (número fiscal não se reaproveita), mas a chave é liberada
// (vai para chave_original) para que "cancelar e lançar de novo" funcione também para nota com chave.
// valorTotal é dinheiro: sem `valores.ver` não sai, não se lança nota e, ao editar, o valor gravado é mantido.
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');
const { validarNota, validarCancelamento, TIPOS_NOTA } = require('../calculo/notas_fiscais');
const { semValores, podeVerValores, preservarValores } = require('../seguranca/valores');
const { filtroEstados } = require('../seguranca/acesso');

const VER = ['notas.ver'];
const EDITAR = ['notas.editar'];
const LIMITE_LISTA = 200;
const DINHEIRO = ['valorTotal'];
const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';
const data = v => String(v ?? '').slice(0, 10);

const nota = r => ({ id: Number(r.id), tipo: r.tipo, numero: r.numero, serie: r.serie, chave: r.chave || r.chave_original || '', dataEmissao: data(r.data_emissao),
  contraparteCodigo: Number(r.contraparte_codigo), contraparteNome: r.contraparte_nome || '', valorTotal: Number(r.valor_total) || 0,
  observacao: r.observacao || '', situacao: r.situacao, motivoCancelamento: r.motivo_cancelamento || '', criadoPor: r.criado_por || '', criadoEm: r.criado_em || '' });

function registrarNotas({ rota, pool, foraDosEstados }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, alvo, JSON.stringify(detalhe)]);
  const idDe = req => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };
  const alvoDe = n => `${n.tipo === 'saida' ? 'Saída' : 'Entrada'} ${n.numero}/${n.serie}`;
  // nota de saída de cliente fora dos estados do usuário: responde 403 (true = bloqueado e resposta já enviada)
  async function bloqueadaPorEstado(db, req, res, n) {
    if (n.tipo !== 'saida' || !(req.acesso?.estados || []).length) return false;
    const [[c]] = await db.execute('SELECT CODIGO, RAZAO_SOCIAL, ESTADO FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [n.contraparte_codigo]);
    return foraDosEstados(req, res, c?.ESTADO);
  }

  rota('get', '/notas_fiscais', VER, async (req, res) => {
    try {
      const q = req.query;
      const where = [], params = [];
      if (TIPOS_NOTA.includes(String(q.tipo))) { where.push('tipo = ?'); params.push(String(q.tipo)); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.de))) { where.push('data_emissao >= ?'); params.push(String(q.de)); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.ate))) { where.push('data_emissao <= ?'); params.push(String(q.ate)); }
      if (q.situacao === 'ativa' || q.situacao === 'cancelada') { where.push('situacao = ?'); params.push(q.situacao); }
      const busca = String(q.q ?? '').trim().slice(0, 100);
      if (busca) { where.push('(numero LIKE ? OR contraparte_nome LIKE ?)'); params.push(like(busca), like(busca)); }
      const est = filtroEstados(req, 'CODIGO');
      if (est.sql) {
        where.push(`(tipo = 'entrada' OR contraparte_codigo IN (SELECT CODIGO FROM cadastro_clientes WHERE ${est.sql.replace('CODIGO', 'ESTADO')}))`);
        params.push(...est.params);
      }
      const [linhas] = await pool.execute(
        `SELECT * FROM web_notas_fiscais ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY data_emissao DESC, id DESC LIMIT ${LIMITE_LISTA + 1}`, params);
      const notas = linhas.slice(0, LIMITE_LISTA).map(l => semValores(req, nota(l), DINHEIRO));
      res.json({ notas, qtdNotas: notas.length, limitada: linhas.length > LIMITE_LISTA });
    } catch (err) { erro500(res, 'GET /notas_fiscais', err); }
  });

  // opções do formulário (fornecedores ou clientes dos estados do usuário); fica antes de /:id e não exige clientes.ver
  rota('get', '/notas_fiscais/contrapartes', VER, async (req, res) => {
    const tipo = String(req.query.tipo ?? '');
    if (!TIPOS_NOTA.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
    try {
      if (tipo === 'entrada') {
        const [f] = await pool.execute("SELECT COD, RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE <> '.' ORDER BY RAZAO_FABRICANTE");
        return res.json({ contrapartes: f.map(x => ({ codigo: Number(x.COD), nome: x.RAZAO_FABRICANTE })) });
      }
      const est = filtroEstados(req, 'ESTADO');
      const [c] = await pool.execute(`SELECT CODIGO, RAZAO_SOCIAL FROM cadastro_clientes ${est.sql ? 'WHERE ' + est.sql : ''} ORDER BY RAZAO_SOCIAL`, est.params);
      res.json({ contrapartes: c.map(x => ({ codigo: Number(x.CODIGO), nome: x.RAZAO_SOCIAL })) });
    } catch (err) { erro500(res, 'GET /notas_fiscais/contrapartes', err); }
  });

  rota('get', '/notas_fiscais/:id', VER, async (req, res) => {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Nota não encontrada.' });
    try {
      const [[r]] = await pool.execute('SELECT * FROM web_notas_fiscais WHERE id = ? LIMIT 1', [id]);
      if (!r) return res.status(404).json({ error: 'Nota não encontrada.' });
      if (await bloqueadaPorEstado(pool, req, res, r)) return;
      res.json({ nota: semValores(req, nota(r), DINHEIRO) });
    } catch (err) { erro500(res, 'GET /notas_fiscais/:id', err); }
  });

  rota('post', '/notas_fiscais', EDITAR, async (req, res) => {
    if (!podeVerValores(req)) return res.status(403).json({ error: 'Lançar nota exige a permissão de valores financeiros.' });
    const { erros, dados } = validarNota(req.body || {}, { podeValores: true, criando: true });
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const r = await emTransacao(pool, res, 'POST /notas_fiscais', async conn => {
      let nome;
      if (dados.tipo === 'entrada') {
        const [[f]] = await conn.execute("SELECT COD, RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE COD = ? AND RAZAO_FABRICANTE <> '.' LIMIT 1", [dados.contraparteCodigo]);
        if (!f) throw new ErroUsuario(400, 'Fornecedor não encontrado.');
        nome = f.RAZAO_FABRICANTE;
      } else {
        const [[c]] = await conn.execute('SELECT CODIGO, RAZAO_SOCIAL, ESTADO FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [dados.contraparteCodigo]);
        if (!c) throw new ErroUsuario(400, 'Cliente não encontrado.');
        if (foraDosEstados(req, res, c.ESTADO)) return null;
        nome = c.RAZAO_SOCIAL;
      }
      const [iguais] = await conn.execute(
        'SELECT id FROM web_notas_fiscais WHERE tipo = ? AND serie = ? AND numero = ? AND contraparte_codigo = ? FOR UPDATE',
        [dados.tipo, dados.serie, dados.numero, dados.contraparteCodigo]);
      if (iguais.length) throw new ErroUsuario(409, `Já existe a nota ${dados.numero}/${dados.serie} para este ${dados.tipo === 'saida' ? 'cliente' : 'fornecedor'} (nota ${iguais[0].id}).`);
      if (dados.chave) {
        const [mesma] = await conn.execute('SELECT id FROM web_notas_fiscais WHERE chave = ? FOR UPDATE', [dados.chave]);
        if (mesma.length) throw new ErroUsuario(409, `Já existe uma nota com esta chave de acesso (nota ${mesma[0].id}).`);
      }
      try {
        const [ins] = await conn.execute(
          'INSERT INTO web_notas_fiscais (tipo, numero, serie, chave, data_emissao, contraparte_codigo, contraparte_nome, valor_total, observacao, situacao, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'ativa\', ?, ?)',
          [dados.tipo, dados.numero, dados.serie, dados.chave, dados.dataEmissao, dados.contraparteCodigo, nome, dados.valorTotal, dados.observacao, req.acesso?.nome || '', agoraLocal()]);
        await auditar(conn, req, 'nota_fiscal_criada', alvoDe(dados), { id: ins.insertId, tipo: dados.tipo });
        return { id: ins.insertId };
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') throw new ErroUsuario(409, 'Esta nota já foi lançada.');
        throw err;
      }
    });
    if (r) res.json({ ok: true, ...r });
  });

  rota('put', '/notas_fiscais/:id', EDITAR, async (req, res) => {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Nota não encontrada.' });
    const { erros, dados } = validarNota(req.body || {}, { podeValores: podeVerValores(req), criando: false });
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const r = await emTransacao(pool, res, 'PUT /notas_fiscais/:id', async conn => {
      const [[atual]] = await conn.execute('SELECT * FROM web_notas_fiscais WHERE id = ? FOR UPDATE', [id]);
      if (!atual) throw new ErroUsuario(404, 'Nota não encontrada.');
      if (await bloqueadaPorEstado(conn, req, res, atual)) return null;
      if (atual.situacao === 'cancelada') throw new ErroUsuario(409, 'Nota cancelada não pode ser editada.');
      const antes = nota(atual);
      const d = preservarValores(req, dados, antes, DINHEIRO);
      await conn.execute('UPDATE web_notas_fiscais SET data_emissao = ?, valor_total = ?, observacao = ?, alterado_por = ?, alterado_em = ? WHERE id = ?',
        [d.dataEmissao, d.valorTotal, d.observacao, req.acesso?.nome || '', agoraLocal(), id]);
      const mudou = ['dataEmissao', 'valorTotal', 'observacao'].filter(k => String(d[k] ?? '') !== String(antes[k] ?? ''));
      await auditar(conn, req, 'nota_fiscal_alterada', alvoDe(atual), { id, campos: mudou });
      return { id };
    });
    if (r) res.json({ ok: true, ...r });
  });

  rota('post', '/notas_fiscais/:id/cancelar', EDITAR, async (req, res) => {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Nota não encontrada.' });
    const { erros, motivo } = validarCancelamento(req.body || {});
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const r = await emTransacao(pool, res, 'POST /notas_fiscais/:id/cancelar', async conn => {
      const [[atual]] = await conn.execute('SELECT * FROM web_notas_fiscais WHERE id = ? FOR UPDATE', [id]);
      if (!atual) throw new ErroUsuario(404, 'Nota não encontrada.');
      if (await bloqueadaPorEstado(conn, req, res, atual)) return null;
      if (atual.situacao === 'cancelada') throw new ErroUsuario(409, 'Esta nota já está cancelada.');
      await conn.execute("UPDATE web_notas_fiscais SET situacao = 'cancelada', chave_original = chave, chave = NULL, motivo_cancelamento = ?, alterado_por = ?, alterado_em = ? WHERE id = ?",
        [motivo, req.acesso?.nome || '', agoraLocal(), id]);
      await auditar(conn, req, 'nota_fiscal_cancelada', alvoDe(atual), { id });
      return { id };
    });
    if (r) res.json({ ok: true, ...r });
  });
}

module.exports = { registrarNotas };
