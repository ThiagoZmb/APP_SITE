// ==========================================================================
// "CHECKLIST EXTERNO – ENTREGAS": a folha que o motorista leva para conferência e assinatura do cliente, gerada por entrega.
// Só da web: a edição da equipe fica em web_entrega_checklist (uma linha por entrega, JSON dos campos, quem/quando);
// ped_orc, cadastro_clientes e cliente_usuarios são apenas lidos. Nenhum dinheiro (só texto da entrega, itens e quantidades).
//  GET    /entregas/checklist/branco.pdf      folha em branco (entregas.ver + entregas.checklist)
//  GET    /entregas/:id/checklist             campos automáticos + o que foi salvo (para a janela "Checklist da entrega")
//  GET    /entregas/:id/checklist.pdf         PDF: o salvo, se existir; senão o automático (sem endereço da entrega = 422, nada é gerado)
//  PUT    /entregas/:id/checklist             salva a edição (entregas.checklist + entregas.programar)
//  DELETE /entregas/:id/checklist             "Voltar ao automático" (apaga a edição)
//  GET    /minhas_entregas/:id/checklist.pdf  o motorista abre a folha da PRÓPRIA entrega (somente leitura; 404 uniforme)
// O filtro de estados do usuário vale como nas outras rotas da equipe (entrega fora da região = 404).
// ==========================================================================
const { filtroEstados } = require('../seguranca/acesso');
const { ordemNoPedido } = require('../calculo/entregas');
const { montarAutomatico, folhaEmBranco, validarEdicao, lerSalvo, mesclar, podeGerar, MSG_SEM_ENDERECO } = require('../calculo/entrega_checklist');
const { desenharChecklistEntrega, novoDocumento } = require('../pdf/entrega_checklist');
const { lerDivisoes } = require('./entregas');
const { emTransacao, agoraLocal } = require('./transacao');

const VER = ['entregas.ver', 'entregas.checklist'];
const EDITAR = ['entregas.checklist', 'entregas.programar'];
const MOTORISTA = ['entregas.baixar'];

const idDe = req => (/^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : null);
const dataHora = v => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '';
};

function registrarEntregaChecklist({ rota, pool }) {
  const falha = (res, nome, err) => { console.error(`Erro ${nome}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };
  const nao_encontrada = res => res.status(404).json({ error: 'Entrega não encontrada.' });

  // Lê tudo o que a folha precisa de UMA entrega. `motorista` (código) = só a entrega dele, do tipo motorista; senão vale o
  // filtro de estados da equipe. A entrega e a edição salva saem juntas; depois a divisão (itens desta entrega e "n de N").
  // Devolve null se não existe / não é visível.
  async function lerFolha(req, id, { motorista = null } = {}) {
    const est = motorista === null ? filtroEstados(req, 'c.ESTADO') : { sql: '', params: [] };
    const filtros = [];
    const params = [id];
    if (motorista !== null) { filtros.push("e.motorista_codigo = ? AND e.tipo = 'motorista'"); params.push(Number(motorista)); }
    if (est.sql) { filtros.push(est.sql); params.push(...est.params); }
    const [[[r]], [[salvo]]] = await Promise.all([
      pool.execute(
        `SELECT e.*, p.RAZAO_SOCIAL AS ck_cliente, p.CLIENTE_FINAL AS ck_cliente_final,
                mu.NOME AS ck_motorista
         FROM web_entregas e
         LEFT JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
         LEFT JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
         LEFT JOIN cliente_usuarios mu ON mu.CODIGO = e.motorista_codigo
         WHERE e.id = ?${filtros.length ? ' AND ' + filtros.join(' AND ') : ''}`, params),
      pool.execute('SELECT dados, atualizado_por, CAST(atualizado_em AS CHAR) AS atualizado_em FROM web_entrega_checklist WHERE entrega_id = ?', [id])
    ]);
    if (!r) return null;
    const d = (await lerDivisoes(pool, [r.numero])).get(Number(r.numero));
    const itens = (d?.porEntrega.get(Number(id)) || []).map(i => ({ item: i.item, descricao: i.descricao, qtd: i.qtd }));
    const automatico = montarAutomatico({
      entrega: r, cliente: r.ck_cliente, clienteFinal: r.ck_cliente_final, motoristaNome: r.motorista_codigo ? r.ck_motorista : '',
      itens, ordem: ordemNoPedido(d?.entregas || [], id)
    });
    const editado = salvo ? lerSalvo(salvo.dados) : null;
    return { entrega: r, automatico, salvo: editado, salvoPor: editado ? salvo.atualizado_por || '' : '', salvoEm: editado ? dataHora(salvo.atualizado_em) : '' };
  }

  // gera o PDF de uma página e envia; o nome do arquivo leva o número do pedido (só dígitos)
  function enviarPdf(res, dados, nomeArquivo) {
    res.set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `inline; filename="${nomeArquivo}"`)
      .set('Cache-Control', 'private, no-store');
    const doc = novoDocumento();
    doc.pipe(res);
    desenharChecklistEntrega(doc, dados, { geradoEm: dataHora(agoraLocal()) });
    doc.end();
  }
  const nomePdf = f => `checklist_entrega_${String(f.automatico.pedido).replace(/\D/g, '') || 'pedido'}${f.automatico.entregaRotulo ? '_' + (f.automatico.entregaRotulo.match(/\d+/) || [''])[0] : ''}.pdf`;

  // ATENÇÃO: antes de qualquer /entregas/:id/... é indiferente (segmentos diferentes), mas fica no topo por clareza
  rota('get', '/entregas/checklist/branco.pdf', VER, (req, res) => {
    try { enviarPdf(res, folhaEmBranco(), 'checklist_entrega_em_branco.pdf'); } catch (err) { falha(res, 'GET /entregas/checklist/branco.pdf', err); }
  });

  rota('get', '/entregas/:id/checklist', VER, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    try {
      const f = await lerFolha(req, id);
      if (!f) return nao_encontrada(res);
      const { itens, qtdItensEsperada, entregaRotulo, enderecoOrigem, ...campos } = f.automatico;
      res.json({ entregaId: id, automatico: campos, salvo: f.salvo, salvoPor: f.salvoPor, salvoEm: f.salvoEm,
        itens, qtdItensEsperada, entregaRotulo, enderecoOrigem, podeGerar: podeGerar(mesclar(f.automatico, f.salvo)) });
    } catch (err) { falha(res, 'GET /entregas/:id/checklist', err); }
  });

  rota('get', '/entregas/:id/checklist.pdf', VER, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    try {
      const f = await lerFolha(req, id);
      if (!f) return nao_encontrada(res);
      const dados = mesclar(f.automatico, f.salvo);
      if (!podeGerar(dados)) return res.status(422).json({ error: MSG_SEM_ENDERECO, motivo: 'sem_endereco' });
      enviarPdf(res, dados, nomePdf(f));
    } catch (err) { falha(res, 'GET /entregas/:id/checklist.pdf', err); }
  });

  // salva a edição da equipe (substitui a anterior inteira). A entrega precisa existir e estar na região do usuário.
  rota('put', '/entregas/:id/checklist', EDITAR, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    const v = validarEdicao(req.body);
    if (!v.ok) return res.status(400).json({ error: v.erro });
    let f;
    try { f = await lerFolha(req, id); } catch (err) { return falha(res, 'PUT /entregas/:id/checklist', err); }
    if (!f) return nao_encontrada(res);
    const quem = req.acesso?.nome || '', quando = agoraLocal();
    const r = await emTransacao(pool, res, 'PUT /entregas/:id/checklist', async conn => {
      await conn.execute(
        'INSERT INTO web_entrega_checklist (entrega_id, dados, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE dados = VALUES(dados), atualizado_por = VALUES(atualizado_por), atualizado_em = VALUES(atualizado_em)',
        [id, JSON.stringify(v.dados), quem, quando]);
      await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
        [quando, quem, 'entrega_checklist_editado', String(f.entrega.numero), JSON.stringify({ entregaId: id })]);
      return { ok: true, salvo: v.dados, salvoPor: quem, salvoEm: dataHora(quando) };
    });
    if (r) res.json(r);
  });

  rota('delete', '/entregas/:id/checklist', EDITAR, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    let f;
    try { f = await lerFolha(req, id); } catch (err) { return falha(res, 'DELETE /entregas/:id/checklist', err); }
    if (!f) return nao_encontrada(res);
    const quem = req.acesso?.nome || '', quando = agoraLocal();
    const r = await emTransacao(pool, res, 'DELETE /entregas/:id/checklist', async conn => {
      const [del] = await conn.execute('DELETE FROM web_entrega_checklist WHERE entrega_id = ?', [id]);
      if (del.affectedRows) {
        await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
          [quando, quem, 'entrega_checklist_automatico', String(f.entrega.numero), JSON.stringify({ entregaId: id })]);
      }
      return { ok: true, removido: !!del.affectedRows };
    });
    if (r) res.json(r);
  });

  // motorista: só a própria entrega (motorista_codigo = ele, tipo motorista), em qualquer status; o resto = 404 uniforme.
  // Mesma folha da equipe (o salvo, se existir); ele não edita nada.
  rota('get', '/minhas_entregas/:id/checklist.pdf', MOTORISTA, async (req, res) => {
    const id = idDe(req);
    if (id === null || !Number.isInteger(Number(req.user?.id))) return nao_encontrada(res);
    try {
      const f = await lerFolha(req, id, { motorista: Number(req.user.id) });
      if (!f) return nao_encontrada(res);
      const dados = mesclar(f.automatico, f.salvo);
      if (!podeGerar(dados)) return res.status(422).json({ error: MSG_SEM_ENDERECO + ' Fale com a equipe.', motivo: 'sem_endereco' });
      enviarPdf(res, dados, nomePdf(f));
    } catch (err) { falha(res, 'GET /minhas_entregas/:id/checklist.pdf', err); }
  });
}

module.exports = { registrarEntregaChecklist };
