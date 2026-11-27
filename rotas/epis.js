// EPIs: catálogo, entradas, entregas (funcionário + data + vários EPIs), fotos da ficha assinada e resumo.
// Só da web (web_epi*); o cadastro de funcionários (tabela do VB) é SOMENTE lido. Spec: docs/superpowers/specs/2026-11-27-epis-design.md.
// Saldo = entradas − itens de entregas não canceladas. Nada é apagado: entrega é cancelada, EPI é desativado e foto é ocultada.
// Os nomes dos campos devolvidos evitam "saldo/total/valor" (a redeDeValores apagaria de quem não tem valores.ver).
const express = require('express');
const { emTransacao, ErroUsuario, agoraLocal, hojeLocal } = require('./transacao');
const { validarAnexo } = require('../calculo/entregas');
const C = require('../calculo/epis');

const VER = ['epi.ver'];
const REGISTRAR = ['epi.ver', 'epi.registrar'];
const GERIR = ['epi.ver', 'epi.gerir'];
const RESUMO = ['epi.ver', 'administrativo.ver'];
const MAX_FOTOS = 6;

const SQL_EPIS = 'SELECT id, nome, ca, minimo, ativo FROM web_epis ORDER BY nome';
const SQL_ENTRADAS = 'SELECT epi_id, SUM(quantidade) AS qtd FROM web_epi_entradas GROUP BY epi_id';
const SQL_SAIDAS = `SELECT i.epi_id, SUM(i.quantidade) AS qtd, SUM(CASE WHEN e.data_entrega >= ? THEN i.quantidade ELSE 0 END) AS qtd_30
  FROM web_epi_entrega_itens i JOIN web_epi_entregas e ON e.id = i.entrega_id WHERE e.cancelada_em IS NULL GROUP BY i.epi_id`;
const SQL_EPI_TRAVADO = 'SELECT id, nome, ca, minimo, ativo FROM web_epis WHERE id = ? FOR UPDATE';
const SQL_ENTREGA_TRAVADA = 'SELECT id, funcionario_nome, cancelada_em FROM web_epi_entregas WHERE id = ? FOR UPDATE';
// o mesmo critério de "Ativos" da tela de Funcionários
const SQL_ATIVOS = "SELECT CODIGO, NOME FROM funcionarios WHERE SITUACAO = 'Ativo' ORDER BY NOME LIMIT 2000";

const rawImagem = express.raw({ type: ['image/jpeg', 'image/png'], limit: '1mb' });
const lerImagem = (req, res, next) => rawImagem(req, res, err => {
  if (!err) return next();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo muito grande (máximo 1 MB).' });
  if (err.status && err.status < 500) return res.status(400).json({ error: 'Arquivo inválido.' });
  next(err);
});

const idDe = v => (/^\d{1,9}$/.test(String(v)) && Number(v) > 0 ? Number(v) : null);
const marcas = lista => lista.map(() => '?').join(', ');

function registrarEpis({ rota, pool }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, String(alvo).slice(0, 100), JSON.stringify(detalhe)]);
  const falha = (res, nome, err) => {
    console.error(`Erro ${nome}:`, err.code || err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };
  const naoAchou = (res, msg) => res.status(404).json({ error: msg });

  async function lerEstoque() {
    const [[epis], [entradas], [saidas]] = await Promise.all([
      pool.execute(SQL_EPIS), pool.execute(SQL_ENTRADAS), pool.execute(SQL_SAIDAS, [C.diasAtras(hojeLocal(), 30)])]);
    return C.montarEstoque(epis, entradas, saidas);
  }

  rota('get', '/epis', VER, async (req, res) => {
    try { res.json({ epis: await lerEstoque() }); } catch (err) { falha(res, 'GET /epis', err); }
  });

  // quem registra escolhe o funcionário sem ter funcionarios.ver: só código e nome dos ativos
  rota('get', '/epis/funcionarios', REGISTRAR, async (req, res) => {
    try {
      const [linhas] = await pool.execute(SQL_ATIVOS);
      res.json({ funcionarios: linhas.map(l => ({ codigo: Number(l.CODIGO), nome: l.NOME || '' })) });
    } catch (err) { falha(res, 'GET /epis/funcionarios', err); }
  });

  rota('get', '/epis/resumo', RESUMO, async (req, res) => {
    try {
      const [estoque, [itens], [[func]]] = await Promise.all([
        lerEstoque(),
        pool.execute(`SELECT e.data_entrega, e.funcionario_codigo, e.funcionario_nome, i.epi_id, i.nome, i.quantidade
          FROM web_epi_entrega_itens i JOIN web_epi_entregas e ON e.id = i.entrega_id WHERE e.cancelada_em IS NULL ORDER BY e.data_entrega, i.id`),
        pool.execute("SELECT COUNT(*) AS qtd FROM funcionarios WHERE SITUACAO = 'Ativo'")]);
      res.json(C.montarResumo({ itens, estoque, qtdFuncionarios: Number(func?.qtd) || 0, hoje: hojeLocal() }));
    } catch (err) { falha(res, 'GET /epis/resumo', err); }
  });

  // histórico inteiro (sem corte: nenhuma entrega some da tela); as fotos vão só como ids
  rota('get', '/epis/entregas', VER, async (req, res) => {
    try {
      const [[entregas], [itens], [fotos]] = await Promise.all([
        pool.execute(`SELECT id, funcionario_codigo, funcionario_nome, data_entrega, observacao, criado_em, criado_por, cancelada_em, cancelada_por, motivo_cancelamento
          FROM web_epi_entregas ORDER BY data_entrega DESC, id DESC`),
        pool.execute('SELECT entrega_id, epi_id, nome, ca, quantidade FROM web_epi_entrega_itens ORDER BY id'),
        pool.execute('SELECT id, entrega_id FROM web_epi_fotos WHERE removida_em IS NULL ORDER BY id')]);
      const porEntrega = new Map(entregas.map(e => [Number(e.id), {
        id: Number(e.id), funcionarioCodigo: Number(e.funcionario_codigo), funcionarioNome: e.funcionario_nome,
        data: String(e.data_entrega).slice(0, 10), observacao: e.observacao || '', criadoEm: e.criado_em, criadoPor: e.criado_por,
        cancelada: e.cancelada_em ? { em: e.cancelada_em, por: e.cancelada_por, motivo: e.motivo_cancelamento } : null, itens: [], fotos: []
      }]));
      for (const i of itens) porEntrega.get(Number(i.entrega_id))?.itens.push({ epiId: Number(i.epi_id), nome: i.nome, ca: i.ca, quantidade: Number(i.quantidade) });
      for (const f of fotos) porEntrega.get(Number(f.entrega_id))?.fotos.push({ id: Number(f.id) });
      res.json({ entregas: [...porEntrega.values()] });
    } catch (err) { falha(res, 'GET /epis/entregas', err); }
  });

  // ---------- catálogo e estoque ----------
  async function nomeLivre(conn, nome, id) {
    const [ja] = await conn.execute('SELECT id FROM web_epis WHERE nome = ? AND id <> ? LIMIT 1', [nome, id]);
    if (ja.length) throw new ErroUsuario(409, 'Esse EPI já existe (se estiver desativado, reative-o no Estoque).');
  }

  rota('post', '/epis', GERIR, async (req, res) => {
    const { erro, dados } = C.validarEpi(req.body);
    if (erro) return res.status(400).json({ error: erro });
    const bruto = req.body.estoqueInicial;
    const inicial = bruto === undefined || bruto === null || bruto === '' ? 0 : C.inteiro(bruto);
    if (inicial === null) return res.status(400).json({ error: 'O estoque inicial precisa ser um número inteiro.' });
    const r = await emTransacao(pool, res, 'POST /epis', async conn => {
      await nomeLivre(conn, dados.nome, 0);
      const agora = agoraLocal(), quem = req.acesso.nome;
      const [ins] = await conn.execute('INSERT INTO web_epis (nome, ca, minimo, ativo, criado_em, criado_por) VALUES (?, ?, ?, 1, ?, ?)',
        [dados.nome, dados.ca, dados.minimo, agora, quem]);
      if (inicial) await conn.execute('INSERT INTO web_epi_entradas (epi_id, quantidade, chave, quando, quem) VALUES (?, ?, ?, ?, ?)',
        [ins.insertId, inicial, null, agora, quem]);
      await auditar(conn, req, 'epi_criado', dados.nome, { epiId: ins.insertId, ...dados, estoqueInicial: inicial });
      return { epiId: ins.insertId };
    });
    if (r) res.status(201).json(r);
  });

  // nome, C.A., mínimo e ativo/inativo (não há exclusão; o histórico guarda a cópia do nome e do C.A.)
  rota('put', '/epis/:id', GERIR, async (req, res) => {
    const id = idDe(req.params.id);
    if (id === null) return naoAchou(res, 'EPI não encontrado.');
    const { erro, dados } = C.validarEpi(req.body);
    if (erro) return res.status(400).json({ error: erro });
    const ativo = req.body.ativo;
    if (ativo !== undefined && typeof ativo !== 'boolean') return res.status(400).json({ error: 'Situação inválida.' });
    const r = await emTransacao(pool, res, 'PUT /epis/:id', async conn => {
      const [[atual]] = await conn.execute(SQL_EPI_TRAVADO, [id]);
      if (!atual) throw new ErroUsuario(404, 'EPI não encontrado.');
      await nomeLivre(conn, dados.nome, id);
      const novoAtivo = ativo === undefined ? Number(atual.ativo) : ativo ? 1 : 0;
      await conn.execute('UPDATE web_epis SET nome = ?, ca = ?, minimo = ?, ativo = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?',
        [dados.nome, dados.ca, dados.minimo, novoAtivo, agoraLocal(), req.acesso.nome, id]);
      await auditar(conn, req, 'epi_alterado', dados.nome, {
        epiId: id, antes: { nome: atual.nome, ca: atual.ca, minimo: Number(atual.minimo), ativo: Number(atual.ativo) }, depois: { ...dados, ativo: novoAtivo } });
      return { ok: true };
    });
    if (r) res.json(r);
  });

  rota('post', '/epis/:id/entrada', GERIR, async (req, res) => {
    const id = idDe(req.params.id);
    if (id === null) return naoAchou(res, 'EPI não encontrado.');
    const qtd = C.quantidade(req.body?.quantidade), chave = req.body?.chave;
    if (qtd === null) return res.status(400).json({ error: 'Quantidade inválida: use um número inteiro de 1 em diante.' });
    if (!C.chaveValida(chave)) return res.status(400).json({ error: 'Chave do envio inválida. Recarregue a página.' });
    const r = await emTransacao(pool, res, 'POST /epis/:id/entrada', async conn => {
      const [[epi]] = await conn.execute(SQL_EPI_TRAVADO, [id]); // primeira leitura: a trava
      if (!epi) throw new ErroUsuario(404, 'EPI não encontrado.');
      const [[ja]] = await conn.execute('SELECT id, epi_id FROM web_epi_entradas WHERE chave = ? LIMIT 1', [chave]);
      if (ja) {
        if (Number(ja.epi_id) !== id) throw new ErroUsuario(409, 'Este envio já foi usado em outro EPI. Recarregue a página.');
        return { repetido: true };
      }
      if (Number(epi.ativo) !== 1) throw new ErroUsuario(409, 'EPI desativado: reative-o antes de dar entrada.');
      await conn.execute('INSERT INTO web_epi_entradas (epi_id, quantidade, chave, quando, quem) VALUES (?, ?, ?, ?, ?)', [id, qtd, chave, agoraLocal(), req.acesso.nome]);
      await auditar(conn, req, 'epi_entrada', epi.nome, { epiId: id, quantidade: qtd });
      return { ok: true };
    });
    if (r) res.status(r.repetido ? 200 : 201).json(r);
  });

  // ---------- entregas ----------
  rota('post', '/epis/entregas', REGISTRAR, async (req, res) => {
    const { erro, dados } = C.validarEntrega(req.body, hojeLocal());
    if (erro) return res.status(400).json({ error: erro });
    const ids = dados.itens.map(i => i.epiId).sort((a, b) => a - b);
    const r = await emTransacao(pool, res, 'POST /epis/entregas', async conn => {
      // A trava dos EPIs (em ordem de id) é a PRIMEIRA leitura: assim as leituras seguintes já enxergam o que a transação que
      // segurava a trava gravou (REPEATABLE READ) e duas entregas ao mesmo tempo não deixam o estoque negativo.
      const [epis] = await conn.execute(`SELECT id, nome, ca, ativo FROM web_epis WHERE id IN (${marcas(ids)}) ORDER BY id FOR UPDATE`, ids);
      const [[ja]] = await conn.execute('SELECT id FROM web_epi_entregas WHERE chave = ? LIMIT 1', [dados.chave]);
      if (ja) return { entregaId: Number(ja.id), repetido: true };
      const porId = new Map(epis.map(e => [Number(e.id), e]));
      for (const i of dados.itens) {
        const e = porId.get(i.epiId);
        if (!e) throw new ErroUsuario(400, 'EPI não encontrado. Recarregue a página.');
        if (Number(e.ativo) !== 1) throw new ErroUsuario(409, `O EPI "${e.nome}" está desativado.`);
      }
      const [[func]] = await conn.execute("SELECT CODIGO, NOME FROM funcionarios WHERE CODIGO = ? AND SITUACAO = 'Ativo' LIMIT 1", [dados.funcionarioCodigo]);
      if (!func) throw new ErroUsuario(400, 'Funcionário não encontrado entre os ativos.');
      const [entradas] = await conn.execute(`SELECT epi_id, SUM(quantidade) AS qtd FROM web_epi_entradas WHERE epi_id IN (${marcas(ids)}) GROUP BY epi_id`, ids);
      const [saidas] = await conn.execute(`SELECT i.epi_id, SUM(i.quantidade) AS qtd FROM web_epi_entrega_itens i JOIN web_epi_entregas e ON e.id = i.entrega_id
        WHERE e.cancelada_em IS NULL AND i.epi_id IN (${marcas(ids)}) GROUP BY i.epi_id`, ids);
      const soma = (linhas, id) => Number(linhas.find(l => Number(l.epi_id) === id)?.qtd) || 0;
      for (const i of dados.itens) {
        const tem = soma(entradas, i.epiId) - soma(saidas, i.epiId);
        if (i.quantidade > tem) throw new ErroUsuario(409, `Estoque insuficiente de "${porId.get(i.epiId).nome}": há ${tem}.`);
      }
      const nome = String(func.NOME || '').slice(0, 190);
      const [ins] = await conn.execute(`INSERT INTO web_epi_entregas (funcionario_codigo, funcionario_nome, data_entrega, observacao, chave, criado_em, criado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [dados.funcionarioCodigo, nome, dados.data, dados.observacao, dados.chave, agoraLocal(), req.acesso.nome]);
      const itens = dados.itens.map(i => ({ epiId: i.epiId, nome: porId.get(i.epiId).nome, ca: porId.get(i.epiId).ca, quantidade: i.quantidade }));
      await conn.execute(`INSERT INTO web_epi_entrega_itens (entrega_id, epi_id, nome, ca, quantidade) VALUES ${itens.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
        itens.flatMap(i => [ins.insertId, i.epiId, i.nome, i.ca, i.quantidade]));
      await auditar(conn, req, 'epi_entrega', nome, { entregaId: ins.insertId, funcionarioCodigo: dados.funcionarioCodigo, data: dados.data, itens });
      return { entregaId: ins.insertId };
    });
    if (r) res.status(r.repetido ? 200 : 201).json(r);
  });

  rota('post', '/epis/entregas/:id/cancelar', GERIR, async (req, res) => {
    const id = idDe(req.params.id);
    if (id === null) return naoAchou(res, 'Entrega não encontrada.');
    const { erro, motivo } = C.validarMotivo(req.body?.motivo);
    if (erro) return res.status(400).json({ error: erro });
    const r = await emTransacao(pool, res, 'POST /epis/entregas/:id/cancelar', async conn => {
      const [[e]] = await conn.execute(SQL_ENTREGA_TRAVADA, [id]);
      if (!e) throw new ErroUsuario(404, 'Entrega não encontrada.');
      if (e.cancelada_em) throw new ErroUsuario(409, 'Esta entrega já está cancelada.');
      await conn.execute('UPDATE web_epi_entregas SET cancelada_em = ?, cancelada_por = ?, motivo_cancelamento = ? WHERE id = ?',
        [agoraLocal(), req.acesso.nome, motivo, id]);
      await auditar(conn, req, 'epi_entrega_cancelada', e.funcionario_nome, { entregaId: id, motivo });
      return { ok: true };
    });
    if (r) res.json(r);
  });

  // ---------- fotos da ficha assinada ----------
  rota('put', '/epis/entregas/:id/foto', REGISTRAR, lerImagem, async (req, res) => {
    const id = idDe(req.params.id);
    if (id === null) return naoAchou(res, 'Entrega não encontrada.');
    const chave = req.query.chave;
    if (!C.chaveValida(chave)) return res.status(400).json({ error: 'Chave da foto inválida.' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const v = validarAnexo(req.body, mime); // mesma regra das entregas: JPEG/PNG conferido pelos bytes, até 1 MB
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const r = await emTransacao(pool, res, 'PUT /epis/entregas/:id/foto', async conn => {
      const [[e]] = await conn.execute(SQL_ENTREGA_TRAVADA, [id]); // trava a entrega: o limite não fura com dois envios juntos
      if (!e) throw new ErroUsuario(404, 'Entrega não encontrada.');
      if (e.cancelada_em) throw new ErroUsuario(409, 'Esta entrega está cancelada e não aceita foto.');
      const [[ja]] = await conn.execute('SELECT id FROM web_epi_fotos WHERE entrega_id = ? AND chave = ? LIMIT 1', [id, chave]);
      if (ja) return { fotoId: Number(ja.id), repetido: true };
      const [[c]] = await conn.execute('SELECT COUNT(*) AS qtd FROM web_epi_fotos WHERE entrega_id = ? AND removida_em IS NULL', [id]);
      if (Number(c?.qtd) >= MAX_FOTOS) throw new ErroUsuario(409, `Esta entrega já tem ${MAX_FOTOS} fotos.`);
      const [ins] = await conn.execute('INSERT INTO web_epi_fotos (entrega_id, mime, dados, chave, criado_em, criado_por) VALUES (?, ?, ?, ?, ?, ?)',
        [id, mime, req.body, chave, agoraLocal(), req.acesso.nome]);
      await auditar(conn, req, 'epi_foto', e.funcionario_nome, { entregaId: id, fotoId: ins.insertId });
      return { fotoId: ins.insertId };
    });
    if (r) res.status(r.repetido ? 200 : 201).json(r);
  });

  rota('get', '/epis/entregas/:id/foto/:fotoId', VER, async (req, res) => {
    const id = idDe(req.params.id), fotoId = idDe(req.params.fotoId);
    if (id === null || fotoId === null) return naoAchou(res, 'Foto não encontrada.');
    try {
      const [[f]] = await pool.execute('SELECT mime, dados FROM web_epi_fotos WHERE id = ? AND entrega_id = ? AND removida_em IS NULL', [fotoId, id]);
      if (!f) return naoAchou(res, 'Foto não encontrada.');
      res.set('Content-Type', f.mime).set('Content-Disposition', 'inline').set('Cache-Control', 'no-store').send(f.dados);
    } catch (err) { falha(res, 'GET /epis/entregas/:id/foto/:fotoId', err); }
  });

  // remover só OCULTA: o arquivo fica no banco e a ação vai para a auditoria
  rota('delete', '/epis/entregas/:id/foto/:fotoId', GERIR, async (req, res) => {
    const id = idDe(req.params.id), fotoId = idDe(req.params.fotoId);
    if (id === null || fotoId === null) return naoAchou(res, 'Foto não encontrada.');
    const r = await emTransacao(pool, res, 'DELETE /epis/entregas/:id/foto/:fotoId', async conn => {
      const [[e]] = await conn.execute(SQL_ENTREGA_TRAVADA, [id]);
      if (!e) throw new ErroUsuario(404, 'Foto não encontrada.');
      const [u] = await conn.execute('UPDATE web_epi_fotos SET removida_em = ?, removida_por = ? WHERE id = ? AND entrega_id = ? AND removida_em IS NULL',
        [agoraLocal(), req.acesso.nome, fotoId, id]);
      if (!u.affectedRows) throw new ErroUsuario(404, 'Foto não encontrada.');
      await auditar(conn, req, 'epi_foto_removida', e.funcionario_nome, { entregaId: id, fotoId });
      return { ok: true };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarEpis };
