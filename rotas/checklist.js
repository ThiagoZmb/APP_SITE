// Checklist de produção em PDF, guardado no banco da web (tabela `web_checklist`, uma única linha vigente, id = 1), para abrir de
// qualquer lugar, inclusive do celular, sem o serviço local. Nenhuma tabela do VB é alterada.
// GET /checklist/pdf (pedidos.checklist) abre; GET /checklist/info e PUT /checklist (checklist.enviar) mostram e substituem.
// Auditoria guarda só nome e tamanho, nunca o conteúdo.
const express = require('express');
const { emTransacao, agoraLocal } = require('./transacao');
const { MAX_PDF, validarPdf, nomeDoArquivo } = require('../calculo/checklist');

const VER = ['pedidos.checklist'];
const ENVIAR = ['checklist.enviar'];
const ID_UNICO = 1;

// body-parser dentro da rota: estouro de tamanho vira 413 em português
const rawPdf = express.raw({ type: 'application/pdf', limit: '5mb' });
const lerPdf = (req, res, next) => rawPdf(req, res, err => {
  if (!err) return next();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'PDF muito grande (máximo 5 MB).' });
  if (err.status && err.status < 500) return res.status(400).json({ error: 'Arquivo inválido.' });
  next(err);
});

function registrarChecklist({ rota, pool }) {
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };

  rota('get', '/checklist/pdf', VER, async (req, res) => {
    try {
      const [[d]] = await pool.execute('SELECT nome_arquivo, conteudo FROM web_checklist WHERE id = ?', [ID_UNICO]);
      if (!d) return res.status(404).json({ error: 'O checklist ainda não foi enviado. Peça a quem tem permissão para enviá-lo.' });
      res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'inline; filename="checklist.pdf"')
        .set('Cache-Control', 'private, no-store').send(d.conteudo);
    } catch (err) { erro500(res, 'GET /checklist/pdf', err); }
  });

  // dados do arquivo vigente (sem o conteúdo), para a tela de envio
  rota('get', '/checklist/info', ENVIAR, async (req, res) => {
    try {
      const [[d]] = await pool.execute('SELECT nome_arquivo, tamanho, enviado_por, enviado_em FROM web_checklist WHERE id = ?', [ID_UNICO]);
      if (!d) return res.json({ existe: false });
      res.json({ existe: true, nome: d.nome_arquivo, tamanho: Number(d.tamanho), enviadoPor: d.enviado_por || '', enviadoEm: d.enviado_em ? String(d.enviado_em).replace('T', ' ').slice(0, 19) : '' });
    } catch (err) { erro500(res, 'GET /checklist/info', err); }
  });

  // envia (ou substitui) o checklist vigente: corpo = PDF cru; o nome do arquivo vem em ?nome=
  rota('put', '/checklist', ENVIAR, lerPdf, async (req, res) => {
    const v = validarPdf(req.body);
    if (!v.ok) return res.status(400).json({ error: v.motivo });
    const pdf = req.body;
    const nome = nomeDoArquivo(req.query.nome);
    const quem = req.acesso?.nome || '', quando = agoraLocal();
    const r = await emTransacao(pool, res, 'PUT /checklist', async conn => {
      const [[atual]] = await conn.execute('SELECT id FROM web_checklist WHERE id = ? FOR UPDATE', [ID_UNICO]);
      await conn.execute(
        'INSERT INTO web_checklist (id, nome_arquivo, conteudo, tamanho, enviado_por, enviado_em) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE nome_arquivo = VALUES(nome_arquivo), conteudo = VALUES(conteudo), tamanho = VALUES(tamanho), enviado_por = VALUES(enviado_por), enviado_em = VALUES(enviado_em)',
        [ID_UNICO, nome, pdf, pdf.length, quem, quando]);
      await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
        [quando, quem, atual ? 'checklist_substituido' : 'checklist_enviado', nome, JSON.stringify({ nome, tamanho: pdf.length })]);
      return { ok: true, substituido: !!atual, nome, tamanho: pdf.length, enviadoPor: quem, enviadoEm: quando };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarChecklist, MAX_PDF };
