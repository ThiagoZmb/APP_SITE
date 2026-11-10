// Nota fiscal em PDF (DANFE) pelo pedido. Os PDFs são ENVIADOS pela tela "Enviar arquivos" para a tabela da web `web_danfe`
// (assim abrem de fora da empresa); nenhuma tabela do VB é alterada.
// Ligação pedido -> nota: (1) vínculo manual (web_danfe_vinculos), que vem primeiro; (2) automática pelo financeiro:
// fluxo_de_caixa.PEDIDO = nº do pedido e fluxo_de_caixa.NOTA_FISCAL (pode vir "8862/8887") = numero_nf do DANFE, só nota modelo 55 emitida
// pelo CNPJ da empresa. Só vale ped_orc.TIPO = 'Pedido' (o NUMERO se repete entre Pedido e Orçamento). Não existe ligação por nome + valor.
// Nada aqui é dinheiro: nenhum nome de campo pode casar com REGEX_VALOR (use numeroNf, qtd*).
// Auditoria guarda só chave e tamanho, nunca o conteúdo do PDF.
const crypto = require('node:crypto');
const express = require('express');
const { filtroEstados } = require('../seguranca/acesso');
const { ErroUsuario, emTransacao, agoraLocal } = require('./transacao');
const { MAX_PDF, lerChave, validarPdf } = require('../calculo/danfe');
const { criarLigacaoDanfe, MODELO_NFE } = require('./danfe_ligacao');

const VER = ['danfe.ver'];
const ENVIAR = ['danfe.enviar'];
const VINCULAR = ['danfe.vincular'];
const MAX_EXISTENTES = 500;
const LIMITE_LISTA = 200;

// body-parser dentro da rota: estouro de tamanho vira 413 em português (e não a página de erro padrão)
const rawPdf = express.raw({ type: 'application/pdf', limit: '2mb' });
const lerPdf = (req, res, next) => rawPdf(req, res, err => {
  if (!err) return next();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'PDF muito grande (máximo 2 MB).' });
  if (err.status && err.status < 500) return res.status(400).json({ error: 'Arquivo inválido.' });
  next(err);
});

const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';
const marcas = n => Array(n).fill('?').join(', ');
const dataHora = v => (v ? String(v).replace('T', ' ').slice(0, 19) : '');

function registrarDanfe({ rota, pool, foraDosEstados }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, alvo, JSON.stringify(detalhe)]);
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };
  const restrito = req => (req.acesso?.estados || []).length > 0;
  const pedidoDe = v => { const s = String(v ?? '').trim(); const n = /^\d{1,9}$/.test(s) ? Number(s) : 0; return n > 0 ? n : 0; };

  const { cnpjEmpresa, pedidosDaNota, notasDoPedido } = criarLigacaoDanfe({ pool });

  // quais das chaves já estão no banco (a tela envia só as novas)
  rota('post', '/danfe/existentes', ENVIAR, async (req, res) => {
    const chaves = req.body?.chaves;
    if (!Array.isArray(chaves) || chaves.length > MAX_EXISTENTES) return res.status(400).json({ error: `Envie uma lista de até ${MAX_EXISTENTES} chaves.` });
    const validas = [...new Set(chaves.filter(c => typeof c === 'string' && lerChave(c).valida))];
    if (!validas.length) return res.json({ existentes: [] });
    try {
      const [linhas] = await pool.execute(`SELECT chave FROM web_danfe WHERE chave IN (${marcas(validas.length)})`, validas);
      res.json({ existentes: linhas.map(l => l.chave) });
    } catch (err) { erro500(res, 'POST /danfe/existentes', err); }
  });

  // grava um DANFE (idempotente: mesmo PDF = 200 ja_existia; PDF diferente na mesma chave = substitui e audita)
  rota('put', '/danfe/:chave', ENVIAR, lerPdf, async (req, res) => {
    const c = lerChave(req.params.chave);
    if (!c.valida) return res.status(400).json({ error: 'Chave de acesso inválida (44 dígitos com o dígito verificador certo).' });
    if (c.modelo !== MODELO_NFE) return res.status(400).json({ error: 'Só vale nota modelo 55 (NF-e).' });
    const v = validarPdf(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const pdf = req.body;
    const sha = crypto.createHash('sha256').update(pdf).digest('hex');
    const r = await emTransacao(pool, res, 'PUT /danfe/:chave', async conn => {
      const [[atual]] = await conn.execute('SELECT id, sha256 FROM web_danfe WHERE chave = ? FOR UPDATE', [c.chave]);
      const quem = req.acesso?.nome || '', quando = agoraLocal();
      let resultado;
      if (!atual) {
        try {
          await conn.execute(
            'INSERT INTO web_danfe (chave, numero_nf, serie, modelo, cnpj_emitente, data_emissao_aamm, pdf, tamanho, sha256, enviado_por, enviado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [c.chave, c.numeroNf, c.serie, c.modelo, c.cnpj, c.aamm, pdf, pdf.length, sha, quem, quando]);
        } catch (err) {
          if (err?.code === 'ER_DUP_ENTRY') throw new ErroUsuario(409, 'Esta nota foi enviada ao mesmo tempo por outra pessoa. Tente de novo.');
          throw err;
        }
        await auditar(conn, req, 'danfe_enviado', c.chave, { chave: c.chave, tamanho: pdf.length });
        resultado = { ja_existia: false, substituida: false };
      } else if (atual.sha256 === sha) {
        resultado = { ja_existia: true, substituida: false };
      } else {
        await conn.execute('UPDATE web_danfe SET pdf = ?, tamanho = ?, sha256 = ?, enviado_por = ?, enviado_em = ? WHERE id = ?', [pdf, pdf.length, sha, quem, quando, atual.id]);
        await auditar(conn, req, 'danfe_substituido', c.chave, { chave: c.chave, tamanho: pdf.length });
        resultado = { ja_existia: true, substituida: true };
      }
      // aviso (não recusa): CNPJ do emitente diferente do mais comum entre os já enviados
      const empresa = await cnpjEmpresa(conn);
      return { ok: true, chave: c.chave, ...resultado, cnpjDiferente: !!empresa && empresa !== c.cnpj, cnpjEmitente: c.cnpj };
    });
    if (r) res.json(r);
  });

  // notas do pedido: vínculo manual primeiro, depois as do financeiro (sem repetir a chave)
  rota('get', '/danfe/pedido/:numero', VER, async (req, res) => {
    const numero = pedidoDe(req.params.numero);
    if (!numero) return res.status(404).json({ error: 'Pedido não encontrado.' });
    try {
      const [[ped]] = await pool.execute("SELECT NUMERO, RAZAO_SOCIAL FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido' LIMIT 1", [numero]);
      if (!ped) return res.status(404).json({ error: 'Pedido não encontrado.' });
      // só abre nota de cliente dentro dos estados do usuário (mesma regra do PDF do pedido)
      if (restrito(req)) {
        const [[cli]] = await pool.execute('SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [ped.RAZAO_SOCIAL]);
        if (foraDosEstados(req, res, cli?.ESTADO)) return;
      }
      res.json(await notasDoPedido(numero));
    } catch (err) { erro500(res, 'GET /danfe/pedido/:numero', err); }
  });

  // notas enviadas, para a aba "Vincular" (busca por número da NF ou pela chave)
  rota('get', '/danfe/lista', VINCULAR, async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim().slice(0, 60);
      const limite = Math.min(LIMITE_LISTA, Math.max(1, parseInt(req.query.limite, 10) || LIMITE_LISTA));
      const where = [], params = [];
      if (q) {
        if (!/^\d+$/.test(q)) return res.json({ notas: [], limitada: false });
        where.push('(numero_nf = ? OR chave LIKE ?)');
        params.push(q.length <= 9 ? Number(q) : 0, like(q));
      }
      const [linhas] = await pool.execute(
        `SELECT chave, numero_nf, serie, enviado_em FROM web_danfe ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY enviado_em DESC, id DESC LIMIT ${limite + 1}`, params);
      const lista = linhas.slice(0, limite);
      let vinculos = [];
      if (lista.length) [vinculos] = await pool.execute(`SELECT chave, pedido_numero FROM web_danfe_vinculos WHERE chave IN (${marcas(lista.length)}) ORDER BY id`, lista.map(l => l.chave));
      const notas = lista.map(l => ({ chave: l.chave, numeroNf: Number(l.numero_nf), serie: Number(l.serie), enviadoEm: dataHora(l.enviado_em),
        pedidos: vinculos.filter(v => v.chave === l.chave).map(v => Number(v.pedido_numero)) }));
      res.json({ notas, limitada: linhas.length > limite });
    } catch (err) { erro500(res, 'GET /danfe/lista', err); }
  });

  rota('post', '/danfe/vinculo', VINCULAR, async (req, res) => {
    const c = lerChave(req.body?.chave);
    const pedido = pedidoDe(req.body?.pedido);
    if (!c.valida || !pedido) return res.status(400).json({ error: 'Informe a chave da nota e o número do pedido.' });
    const r = await emTransacao(pool, res, 'POST /danfe/vinculo', async conn => {
      const [[nota]] = await conn.execute('SELECT id FROM web_danfe WHERE chave = ?', [c.chave]);
      if (!nota) throw new ErroUsuario(404, 'Nota não encontrada: envie o PDF dela primeiro.');
      const [[ped]] = await conn.execute("SELECT NUMERO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido' LIMIT 1", [pedido]);
      if (!ped) throw new ErroUsuario(404, 'Pedido não encontrado.');
      const [ins] = await conn.execute('INSERT IGNORE INTO web_danfe_vinculos (chave, pedido_numero, criado_por, criado_em) VALUES (?, ?, ?, ?)',
        [c.chave, pedido, req.acesso?.nome || '', agoraLocal()]);
      if (ins.affectedRows) await auditar(conn, req, 'danfe_vinculado', c.chave, { chave: c.chave, pedido });
      return { ok: true, ja_existia: !ins.affectedRows };
    });
    if (r) res.json(r);
  });

  // remove só a linha manual (a ligação automática pelo financeiro, se houver, continua)
  rota('delete', '/danfe/vinculo', VINCULAR, async (req, res) => {
    const c = lerChave(req.body?.chave);
    const pedido = pedidoDe(req.body?.pedido);
    if (!c.valida || !pedido) return res.status(400).json({ error: 'Informe a chave da nota e o número do pedido.' });
    const r = await emTransacao(pool, res, 'DELETE /danfe/vinculo', async conn => {
      const [del] = await conn.execute('DELETE FROM web_danfe_vinculos WHERE chave = ? AND pedido_numero = ?', [c.chave, pedido]);
      if (!del.affectedRows) throw new ErroUsuario(404, 'Vínculo não encontrado.');
      await auditar(conn, req, 'danfe_desvinculado', c.chave, { chave: c.chave, pedido });
      return { ok: true };
    });
    if (r) res.json(r);
  });

  // abre o PDF. Quem não administra (danfe.enviar) só abre nota ligada a pedido que enxerga (estados do usuário).
  rota('get', '/danfe/:chave/pdf', VER, async (req, res) => {
    const c = lerChave(req.params.chave);
    if (!c.valida) return res.status(404).json({ error: 'Nota não encontrada.' });
    try {
      const [[d]] = await pool.execute('SELECT chave, numero_nf, modelo, cnpj_emitente, pdf FROM web_danfe WHERE chave = ?', [c.chave]);
      if (!d) return res.status(404).json({ error: 'Nota não encontrada.' });
      if (restrito(req) && !req.acesso.permissoes.has('danfe.enviar')) {
        const pedidos = await pedidosDaNota(d, await cnpjEmpresa(pool));
        let visivel = false;
        if (pedidos.length) {
          const est = filtroEstados(req, 'c.ESTADO');
          const [ok] = await pool.execute(
            `SELECT p.NUMERO FROM ped_orc p JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL
             WHERE p.TIPO = 'Pedido' AND p.NUMERO IN (${marcas(pedidos.length)}) AND ${est.sql} LIMIT 1`, [...pedidos, ...est.params]);
          visivel = ok.length > 0;
        }
        if (!visivel) return res.status(403).json({ error: 'Acesso restrito' });
      }
      res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="NF-${Number(d.numero_nf)}.pdf"`)
        .set('Cache-Control', 'private, no-store').send(d.pdf);
    } catch (err) { erro500(res, 'GET /danfe/:chave/pdf', err); }
  });
}

module.exports = { registrarDanfe, MAX_PDF };
