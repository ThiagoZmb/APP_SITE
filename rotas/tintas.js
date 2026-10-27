// Cadastro de tintas (tabela do VB `tintas`, lida e gravada como o frm_Cadastro_Tintas).
// A referência do fabricante (REF_FABRICANTE) não repete: outras telas do VB acham a tinta por ela.
// VALOR é dinheiro: sem `valores.ver` não sai e, ao salvar, o que já está gravado é mantido.
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');
const { validarTinta, CLASSES_TINTA, TIPOS_TINTA, CONJUNTOS_TINTA } = require('../calculo/tintas');
const { semValores, podeVerValores, preservarValores } = require('../seguranca/valores');

const VER = ['tintas.ver'];
const EDITAR = ['tintas.editar'];
const LIMITE_LISTA = 2000;
const DINHEIRO = ['valor'];
const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';

const resumo = r => ({ codigo: Number(r.COD), fabricante: r.RAZAO_FABRICANTE || '', classe: r.CLASSE || '', tipo: r.TIPO || '', conjunto: r.CONJUNTO || '',
  refFabricante: r.REF_FABRICANTE || '', corElegance: r.COR_ELEGANCE || '', cor: r.COR || '', valor: Number(r.VALOR) || 0 });
const completo = r => ({ ...resumo(r), porcentagem: Number(r.PORCENTAGEM) || 0, rendimento: Number(r.RENDIMENTO) || 0 });

function registrarTintas({ rota, pool }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, alvo, JSON.stringify(detalhe)]);
  const codigoDe = req => { const n = Number(req.params.codigo); return Number.isInteger(n) && n > 0 ? n : null; };
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };

  rota('get', '/tintas', VER, async (req, res) => {
    try {
      const busca = String(req.query.busca ?? '').trim().slice(0, 100);
      const classe = String(req.query.classe ?? '');
      const where = [], params = [];
      if (CLASSES_TINTA.includes(classe)) { where.push('CLASSE = ?'); params.push(classe); }
      if (busca) { where.push('(REF_FABRICANTE LIKE ? OR COR_ELEGANCE LIKE ?)'); params.push(like(busca), like(busca)); }
      const [linhas] = await pool.execute(
        `SELECT COD, RAZAO_FABRICANTE, CLASSE, VALOR, TIPO, CONJUNTO, REF_FABRICANTE, COR_ELEGANCE, COR FROM tintas
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY REF_FABRICANTE LIMIT ${LIMITE_LISTA}`, params);
      const [forn] = await pool.execute("SELECT RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE <> '.' ORDER BY RAZAO_FABRICANTE");
      res.json({ tintas: linhas.map(l => semValores(req, resumo(l), DINHEIRO)), classes: CLASSES_TINTA, tipos: TIPOS_TINTA, conjuntos: CONJUNTOS_TINTA,
        fabricantes: forn.map(f => f.RAZAO_FABRICANTE) });
    } catch (err) { erro500(res, 'GET /tintas', err); }
  });

  rota('get', '/tintas/:codigo', VER, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(404).json({ error: 'Tinta não encontrada.' });
    try {
      const [[r]] = await pool.execute('SELECT * FROM tintas WHERE COD = ? LIMIT 1', [codigo]);
      if (!r) return res.status(404).json({ error: 'Tinta não encontrada.' });
      res.json({ tinta: semValores(req, completo(r), DINHEIRO) });
    } catch (err) { erro500(res, 'GET /tintas/:codigo', err); }
  });

  // sem `codigo` no corpo cria; com `codigo` atualiza
  rota('post', '/tintas/salvar', EDITAR, async (req, res) => {
    const b = req.body || {};
    const { erros, dados } = validarTinta(b, { podeValores: podeVerValores(req) });
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const criando = b.codigo === undefined || b.codigo === null || b.codigo === '';
    const codigoAtual = criando ? null : Number(b.codigo);
    if (!criando && !(Number.isInteger(codigoAtual) && codigoAtual > 0)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await emTransacao(pool, res, 'POST /tintas/salvar', async conn => {
      let atual = null;
      if (!criando) {
        [[atual]] = await conn.execute('SELECT * FROM tintas WHERE COD = ? FOR UPDATE', [codigoAtual]);
        if (!atual) throw new ErroUsuario(404, 'Tinta não encontrada.');
      }
      const [fab] = await conn.execute("SELECT COD FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE = ? AND RAZAO_FABRICANTE <> '.' LIMIT 1", [dados.fabricante]);
      if (!fab.length) throw new ErroUsuario(400, `Fabricante "${dados.fabricante}" não está cadastrado em Fornecedores.`);
      if (dados.refFabricante) {
        const [iguais] = await conn.execute('SELECT COD FROM tintas WHERE REF_FABRICANTE = ? FOR UPDATE', [dados.refFabricante]);
        const outra = iguais.find(x => Number(x.COD) !== codigoAtual);
        if (outra) throw new ErroUsuario(409, `Já existe uma tinta com a referência "${dados.refFabricante}" (código ${outra.COD}).`);
      }
      // sem valores.ver: mantém o valor já gravado (ou 0 em cadastro novo)
      const d = preservarValores(req, dados, atual ? completo(atual) : { valor: 0 }, DINHEIRO);
      const colunas = [d.fabricante, d.classe, d.valor, d.porcentagem, d.refFabricante, d.corElegance, d.tipo, d.conjunto, d.cor, d.rendimento];
      if (criando) {
        const [[{ proximo }]] = await conn.execute('SELECT COALESCE(MAX(COD), 0) + 1 AS proximo FROM tintas FOR UPDATE');
        const codigo = Number(proximo);
        await conn.execute(
          'INSERT INTO tintas (COD, RAZAO_FABRICANTE, CLASSE, VALOR, PORCENTAGEM, REF_FABRICANTE, COR_ELEGANCE, TIPO, CONJUNTO, COR, RENDIMENTO) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [codigo, ...colunas]);
        await auditar(conn, req, 'tinta_criada', d.refFabricante, { codigo, classe: d.classe });
        return { codigo, criado: true };
      }
      await conn.execute(
        `UPDATE tintas SET RAZAO_FABRICANTE = ?, CLASSE = ?, VALOR = ?, PORCENTAGEM = ?, REF_FABRICANTE = ?, COR_ELEGANCE = ?, TIPO = ?, CONJUNTO = ?, COR = ?, RENDIMENTO = ?
         WHERE COD = ?`, [...colunas, codigoAtual]);
      const antes = completo(atual);
      const mudou = Object.keys(d).filter(k => String(d[k] ?? '') !== String(antes[k] ?? ''));
      await auditar(conn, req, 'tinta_alterada', d.refFabricante, { codigo: codigoAtual, campos: mudou });
      return { codigo: codigoAtual, criado: false };
    });
    if (r) res.json({ ok: true, ...r });
  });

  rota('delete', '/tintas/:codigo', EDITAR, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(404).json({ error: 'Tinta não encontrada.' });
    const r = await emTransacao(pool, res, 'DELETE /tintas/:codigo', async conn => {
      const [[atual]] = await conn.execute('SELECT * FROM tintas WHERE COD = ? FOR UPDATE', [codigo]);
      if (!atual) throw new ErroUsuario(404, 'Tinta não encontrada.');
      await conn.execute('DELETE FROM tintas WHERE COD = ?', [codigo]);
      await auditar(conn, req, 'tinta_excluida', atual.REF_FABRICANTE || '', { codigo, classe: atual.CLASSE || '' });
      return { ok: true };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarTintas };
