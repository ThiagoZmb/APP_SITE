// Cadastro de peso por produto (tabela da web `web_pesos`; o banco do VB não tem peso). Etapa 1 do peso das portas.
// Peso NÃO é dinheiro: as rotas não exigem `valores.ver` e nenhum nome de campo pode casar com REGEX_VALOR (use kgPorUnidade, unidadePeso...).
// Auditoria guarda só nomes de campos, nunca o peso.
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');
const { TIPOS_PESO, UNIDADES_PESO, UNIDADES_POR_TIPO, ORIGENS_PESO, validarPeso } = require('../calculo/peso');

const VER = ['pesos.ver'];
const EDITAR = ['pesos.editar'];
const LIMITE_LISTA = 2000;
const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';
// de onde vêm os nomes disponíveis para cadastrar (CLASSE de cadastro_de_produtos; mesmas classes dos catálogos do orçamento)
const CLASSES_POR_TIPO = {
  perfil: ['Perfil', 'Divisor'],
  puxador: ['Puxador'],
  vidro: ['Revestimento'],
  acessorio: ['Acessórios', 'Acessório']
};

const linha = r => ({ id: Number(r.id), tipo: r.tipo, produto: r.produto, unidadePeso: r.unidade_peso, kgPorUnidade: Number(r.valor) || 0,
  origem: r.origem || 'manual', confianca: r.confianca || '',
  atualizadoPor: r.atualizado_por || '', atualizadoEm: r.atualizado_em ? String(r.atualizado_em) : '' });

function registrarPesos({ rota, pool }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, alvo, JSON.stringify(detalhe)]);
  const idDe = req => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };

  rota('get', '/pesos', VER, async (req, res) => {
    try {
      const tipo = String(req.query.tipo ?? ''), q = String(req.query.q ?? '').trim().slice(0, 100);
      const where = [], params = [];
      if (TIPOS_PESO.includes(tipo)) { where.push('tipo = ?'); params.push(tipo); }
      if (q) { where.push('produto LIKE ?'); params.push(like(q)); }
      const [linhas] = await pool.execute(
        `SELECT id, tipo, produto, unidade_peso, valor, origem, confianca, atualizado_por, atualizado_em FROM web_pesos
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY tipo, produto LIMIT ${LIMITE_LISTA}`, params);
      res.json({ pesos: linhas.map(linha), tipos: TIPOS_PESO, unidades: UNIDADES_PESO, unidadesPorTipo: UNIDADES_POR_TIPO, origens: ORIGENS_PESO, limitada: linhas.length >= LIMITE_LISTA });
    } catch (err) { erro500(res, 'GET /pesos', err); }
  });

  // nomes do VB ainda disponíveis para cadastrar (cadastrado = já tem peso)
  rota('get', '/pesos/produtos', VER, async (req, res) => {
    const tipo = String(req.query.tipo ?? '');
    if (!TIPOS_PESO.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
    try {
      const classes = CLASSES_POR_TIPO[tipo];
      const [nomes] = await pool.execute(
        `SELECT DISTINCT MODELO AS nome FROM cadastro_de_produtos WHERE SITUACAO = 'Ativo' AND CLASSE IN (${classes.map(() => '?').join(',')}) ORDER BY MODELO`, classes);
      const [feitos] = await pool.execute('SELECT produto FROM web_pesos WHERE tipo = ?', [tipo]);
      const chave = s => String(s ?? '').trim().toLowerCase();
      const ja = new Set(feitos.map(f => chave(f.produto)));
      res.json({ tipo, produtos: nomes.map(n => n.nome).filter(n => n).map(nome => ({ nome, cadastrado: ja.has(chave(nome)) })) });
    } catch (err) { erro500(res, 'GET /pesos/produtos', err); }
  });

  // cria ou atualiza o peso de (tipo, produto)
  rota('put', '/pesos', EDITAR, async (req, res) => {
    const { erros, dados } = validarPeso(req.body || {});
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const r = await emTransacao(pool, res, 'PUT /pesos', async conn => {
      const [[atual]] = await conn.execute('SELECT id, unidade_peso, valor, origem, confianca FROM web_pesos WHERE tipo = ? AND produto = ? FOR UPDATE', [dados.tipo, dados.produto]);
      const quando = agoraLocal(), quem = req.acesso?.nome || '';
      if (!atual) {
        const [ins] = await conn.execute(
          'INSERT INTO web_pesos (tipo, produto, unidade_peso, valor, origem, confianca, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [dados.tipo, dados.produto, dados.unidadePeso, dados.kgPorUnidade, dados.origem, dados.confianca, quem, quando]);
        const id = Number(ins.insertId);
        await auditar(conn, req, 'peso_criado', dados.produto, { id, tipo: dados.tipo });
        return { id, criado: true };
      }
      await conn.execute('UPDATE web_pesos SET unidade_peso = ?, valor = ?, origem = ?, confianca = ?, atualizado_por = ?, atualizado_em = ? WHERE id = ?',
        [dados.unidadePeso, dados.kgPorUnidade, dados.origem, dados.confianca, quem, quando, atual.id]);
      const campos = [];
      if (atual.unidade_peso !== dados.unidadePeso) campos.push('unidadePeso');
      if (Number(atual.valor) !== dados.kgPorUnidade) campos.push('kgPorUnidade');
      if ((atual.origem || 'manual') !== dados.origem) campos.push('origem');
      if ((atual.confianca || null) !== dados.confianca) campos.push('confianca');
      await auditar(conn, req, 'peso_alterado', dados.produto, { id: Number(atual.id), tipo: dados.tipo, campos });
      return { id: Number(atual.id), criado: false };
    });
    if (r) res.json({ ok: true, ...r });
  });

  rota('delete', '/pesos/:id', EDITAR, async (req, res) => {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Peso não encontrado.' });
    const r = await emTransacao(pool, res, 'DELETE /pesos/:id', async conn => {
      const [[atual]] = await conn.execute('SELECT id, tipo, produto FROM web_pesos WHERE id = ? FOR UPDATE', [id]);
      if (!atual) throw new ErroUsuario(404, 'Peso não encontrado.');
      await conn.execute('DELETE FROM web_pesos WHERE id = ?', [id]);
      await auditar(conn, req, 'peso_excluido', atual.produto, { id, tipo: atual.tipo });
      return { ok: true };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarPesos };
