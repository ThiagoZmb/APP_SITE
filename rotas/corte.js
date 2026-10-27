// Plano de corte de perfis (grava só em web_corte_config, web_retalhos e web_corte_planos; lê perfis e ped_orc_itens_v4 do pedido).
// Regras: calculo/corte_pecas.js (peças), calculo/corte_otimizacao.js (varas e retalhos), calculo/corte_validacao.js (entradas).
// Nada aqui é dinheiro: as rotas não exigem valores.ver, então nenhum nome de campo pode casar com REGEX_VALOR (seguranca/valores.js).
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');
const { PADRAO, resolverParametros } = require('../calculo/corte_otimizacao');
const { validarConfig, validarRetalho } = require('../calculo/corte_validacao');

const VER = ['corte.ver'];
const PARAMETROS = ['corte.ver', 'corte.parametros'];
const SITUACOES_RETALHO = ['disponivel', 'reservado', 'usado', 'descartado'];

const paraNumeroOuNull = v => (v === null || v === undefined ? null : Number(v));

function registrarCorte({ rota, pool }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, String(alvo), JSON.stringify(detalhe)]);
  const idDaRota = req => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const retalhoParaJson = r => ({ id: Number(r.id), perfil: r.perfil, acabamento: r.acabamento, cor: r.cor, comprimento: Number(r.comprimento),
    situacao: r.situacao, planoOrigem: paraNumeroOuNull(r.plano_origem), planoReserva: paraNumeroOuNull(r.plano_reserva), criadoEm: r.criado_em || null });

  // ---------- parâmetros: vara, serra e sobra mínima ----------
  rota('get', '/corte/config', VER, async (req, res) => {
    try {
      const [linhas] = await pool.execute('SELECT perfil, comprimento_vara, serra, sobra_minima FROM web_corte_config ORDER BY perfil');
      res.json({
        padraoDeFabrica: PADRAO,
        padrao: resolverParametros(linhas, ''),
        excecoes: linhas.filter(l => l.perfil).map(l => ({ perfil: l.perfil, comprimentoVara: paraNumeroOuNull(l.comprimento_vara),
          serra: paraNumeroOuNull(l.serra), sobraMinima: paraNumeroOuNull(l.sobra_minima) }))
      });
    } catch (err) { console.error('Erro GET /corte/config:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  rota('put', '/corte/config', PARAMETROS, async (req, res) => {
    const v = validarConfig(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'PUT /corte/config', async conn => {
      const [[atual]] = await conn.execute('SELECT id FROM web_corte_config WHERE perfil = ? FOR UPDATE', [d.perfil]);
      const agora = agoraLocal(), quem = req.acesso?.nome || '';
      if (atual) {
        await conn.execute('UPDATE web_corte_config SET comprimento_vara = ?, serra = ?, sobra_minima = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?',
          [d.comprimentoVara, d.serra, d.sobraMinima, agora, quem, atual.id]);
      } else {
        await conn.execute('INSERT INTO web_corte_config (perfil, comprimento_vara, serra, sobra_minima, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?, ?)',
          [d.perfil, d.comprimentoVara, d.serra, d.sobraMinima, agora, quem]);
      }
      await auditar(conn, req, 'corte_config_alterada', d.perfil || '(padrão)',
        { campos: ['comprimentoVara', 'serra', 'sobraMinima'], comprimentoVara: d.comprimentoVara, serra: d.serra, sobraMinima: d.sobraMinima });
      return { ok: true, perfil: d.perfil, comprimentoVara: d.comprimentoVara, serra: d.serra, sobraMinima: d.sobraMinima, criado: !atual };
    });
    if (r) res.json(r);
  });

  // ---------- retalhos ----------
  rota('get', '/corte/retalhos', VER, async (req, res) => {
    const situacao = req.query.situacao;
    if (situacao !== undefined && situacao !== '' && !SITUACOES_RETALHO.includes(situacao)) return res.status(400).json({ error: 'Situação de retalho inválida.' });
    try {
      const colunas = 'SELECT id, perfil, acabamento, cor, comprimento, situacao, plano_origem, plano_reserva, criado_em FROM web_retalhos';
      const ordem = ' ORDER BY perfil, acabamento, cor, comprimento, id';
      const [linhas] = situacao ? await pool.execute(`${colunas} WHERE situacao = ?${ordem}`, [situacao]) : await pool.execute(colunas + ordem);
      res.json({ retalhos: linhas.map(retalhoParaJson) });
    } catch (err) { console.error('Erro GET /corte/retalhos:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  rota('post', '/corte/retalhos', PARAMETROS, async (req, res) => {
    const v = validarRetalho(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'POST /corte/retalhos', async conn => {
      const agora = agoraLocal();
      const [ins] = await conn.execute(
        "INSERT INTO web_retalhos (perfil, acabamento, cor, comprimento, situacao, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 'disponivel', ?, ?, ?)",
        [d.perfil, d.acabamento, d.cor, d.comprimento, req.acesso?.nome || '', agora, agora]);
      await auditar(conn, req, 'corte_retalho_criado', ins.insertId, { campos: ['perfil', 'acabamento', 'cor', 'comprimento'], comprimento: d.comprimento, origem: 'manual' });
      return { ok: true, id: Number(ins.insertId), ...d, situacao: 'disponivel' };
    });
    if (r) res.json(r);
  });

  // retalho só muda à mão enquanto está disponível (reservado/usado/descartado pertencem a um plano ou ao histórico)
  async function travarDisponivel(conn, id) {
    const [[atual]] = await conn.execute('SELECT id, situacao FROM web_retalhos WHERE id = ? FOR UPDATE', [id]);
    if (!atual) throw new ErroUsuario(404, 'Retalho não encontrado.');
    if (atual.situacao !== 'disponivel') throw new ErroUsuario(409, `Retalho ${atual.situacao}: só retalho disponível pode ser alterado.`);
  }

  rota('put', '/corte/retalhos/:id', PARAMETROS, async (req, res) => {
    const id = idDaRota(req);
    if (!id) return res.status(404).json({ error: 'Retalho não encontrado.' });
    const v = validarRetalho(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'PUT /corte/retalhos/:id', async conn => {
      await travarDisponivel(conn, id);
      await conn.execute('UPDATE web_retalhos SET perfil = ?, acabamento = ?, cor = ?, comprimento = ?, atualizado_em = ? WHERE id = ?',
        [d.perfil, d.acabamento, d.cor, d.comprimento, agoraLocal(), id]);
      await auditar(conn, req, 'corte_retalho_alterado', id, { campos: ['perfil', 'acabamento', 'cor', 'comprimento'], comprimento: d.comprimento });
      return { ok: true, id, ...d, situacao: 'disponivel' };
    });
    if (r) res.json(r);
  });

  rota('post', '/corte/retalhos/:id/descartar', PARAMETROS, async (req, res) => {
    const id = idDaRota(req);
    if (!id) return res.status(404).json({ error: 'Retalho não encontrado.' });
    const r = await emTransacao(pool, res, 'POST /corte/retalhos/:id/descartar', async conn => {
      await travarDisponivel(conn, id);
      await conn.execute("UPDATE web_retalhos SET situacao = 'descartado', atualizado_em = ? WHERE id = ?", [agoraLocal(), id]);
      await auditar(conn, req, 'corte_retalho_descartado', id, { campos: ['situacao'] });
      return { ok: true, id, situacao: 'descartado' };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarCorte };
