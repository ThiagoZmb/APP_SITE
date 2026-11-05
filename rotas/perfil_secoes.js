// Biblioteca de seções de perfis para o 3D do orçamento (tabela da web `web_perfil_secoes`; nenhuma tabela do VB é alterada).
// GET /perfil_secoes e /perfil_secoes/:codigo: quem monta orçamento ou vê produtos (o 3D precisa); PUT e DELETE: `perfis.desenho`.
// Validação toda em calculo/perfil_secoes.js (esquema versão 2). Não há dinheiro aqui. Auditoria guarda só código e versão.
// O corpo do PUT passa pelo express.json global (limite 100 kb, de sobra: ~200 pontos x 30 polígonos cabem em ~100 kb).
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');
const PerfilSecoes = require('../calculo/perfil_secoes');

const VER = [{ algum: ['produtos.ver', 'orcamentos.criar'] }];
const EDITAR = ['perfis.desenho'];

function registrarPerfilSecoes({ rota, pool }) {
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };
  const codigoDe = req => { const t = String(req.params.codigo); return /^\d{1,9}$/.test(t) && Number(t) > 0 ? Number(t) : null; };
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, String(alvo), JSON.stringify(detalhe)]);

  // linha do banco -> seção (código e modelo vêm das colunas; JSON ilegível vira null e a linha é pulada)
  function dessecao(l) {
    try {
      const s = typeof l.secao === 'string' ? JSON.parse(l.secao) : l.secao;
      if (!s || typeof s !== 'object') return null;
      return { ...s, codigo: Number(l.codigo), modelo: l.modelo };
    } catch (_) { return null; }
  }

  rota('get', '/perfil_secoes', VER, async (req, res) => {
    try {
      const [linhas] = await pool.execute('SELECT codigo, modelo, secao FROM web_perfil_secoes ORDER BY codigo');
      res.json({ versaoEsquema: PerfilSecoes.VERSAO, secoes: linhas.map(dessecao).filter(Boolean) });
    } catch (err) { erro500(res, 'GET /perfil_secoes', err); }
  });

  rota('get', '/perfil_secoes/:codigo', VER, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    try {
      const [[l]] = await pool.execute('SELECT codigo, modelo, secao, atualizado_em, atualizado_por FROM web_perfil_secoes WHERE codigo = ?', [codigo]);
      const secao = l && dessecao(l);
      if (!secao) return res.status(404).json({ error: 'Este perfil ainda não tem desenho cadastrado.' });
      res.json({ secao, atualizadoEm: l.atualizado_em ? String(l.atualizado_em).replace('T', ' ').slice(0, 19) : '', atualizadoPor: l.atualizado_por || '' });
    } catch (err) { erro500(res, 'GET /perfil_secoes/:codigo', err); }
  });

  // grava (cria ou substitui) a seção do perfil. Corpo = a seção (esquema versão 2). O código vem da URL e o modelo do cadastro do produto.
  rota('put', '/perfil_secoes/:codigo', EDITAR, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return res.status(400).json({ error: 'Envie a seção do perfil em JSON.' });
    if (corpo.codigo !== undefined && Number(corpo.codigo) !== codigo) return res.status(400).json({ error: 'O código da seção não confere com o da URL.' });
    const quem = req.acesso?.nome || '';
    const r = await emTransacao(pool, res, 'PUT /perfil_secoes/:codigo', async conn => {
      const [[prod]] = await conn.execute('SELECT CODIGO, MODELO, CLASSE FROM cadastro_de_produtos WHERE CODIGO = ?', [codigo]);
      if (!prod) throw new ErroUsuario(404, 'Produto não encontrado.');
      if (String(prod.CLASSE || '').trim().toLowerCase() !== 'perfil') throw new ErroUsuario(422, 'Só produtos da classe Perfil têm desenho de seção.');
      const modelo = String(prod.MODELO || '').trim();
      if (!modelo) throw new ErroUsuario(422, 'O perfil não tem modelo cadastrado.');
      const secao = PerfilSecoes.normalizar({ ...corpo, codigo, modelo });
      const erros = PerfilSecoes.validar(secao);
      if (erros.length) throw new ErroUsuario(400, 'Desenho inválido: ' + erros.slice(0, 5).join('; '), { erros });
      const agora = agoraLocal();
      await conn.execute(
        'INSERT INTO web_perfil_secoes (codigo, modelo, secao, versao_esquema, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE modelo = VALUES(modelo), secao = VALUES(secao), versao_esquema = VALUES(versao_esquema), atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)',
        [codigo, modelo, JSON.stringify(secao), secao.versao, agora, quem]);
      await auditar(conn, req, 'perfil_secao_gravada', codigo, { codigo, versao: secao.versao });
      return { ok: true, secao, atualizadoEm: agora, atualizadoPor: quem };
    });
    if (r) res.json(r);
  });

  rota('delete', '/perfil_secoes/:codigo', EDITAR, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    const r = await emTransacao(pool, res, 'DELETE /perfil_secoes/:codigo', async conn => {
      const [[atual]] = await conn.execute('SELECT codigo, versao_esquema FROM web_perfil_secoes WHERE codigo = ? FOR UPDATE', [codigo]);
      if (!atual) throw new ErroUsuario(404, 'Este perfil não tem desenho cadastrado.');
      await conn.execute('DELETE FROM web_perfil_secoes WHERE codigo = ?', [codigo]);
      await auditar(conn, req, 'perfil_secao_removida', codigo, { codigo, versao: Number(atual.versao_esquema) });
      // marca que o dono apagou de propósito: a semeadura da biblioteca (semearPerfilSecoes) não traz de volta este código
      await auditar(conn, req, 'semente_perfil_secoes_removida', codigo, { codigo });
      return { ok: true };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarPerfilSecoes };
