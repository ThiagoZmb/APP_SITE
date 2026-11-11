// ==========================================================================
// Módulo Entregas: fila "A programar" (varredura dos pedidos Pronto) e listagem.
// Só da web: tudo fica em web_entregas / web_entrega_eventos / web_entrega_anexos;
// ped_orc e cadastro_clientes são apenas lidos.
// ==========================================================================
const express = require('express');
const { filtroEstados } = require('../seguranca/acesso');
const { STATUS, TIPOS, proximo, pedidoPara, statusExibicao, validarAnexo, fechamentoDoPedido,
  STATUS_DIVISIVEIS, hashItensPedido, situacaoDivisao, ordemNoPedido, lerSeparacao, separarItens,
  STATUS_ENCERRAVEIS, EVENTO_ENCERRADA, EVENTO_REABERTA, statusConcluidoPara, statusDeReabertura, motivoEncerrada } = require('../calculo/entregas');
const { ErroUsuario, emTransacao, agoraLocal, hojeLocal } = require('./transacao');
const { validarData, txt } = require('./estoque_movimentos');

const VER = ['entregas.ver'];
const PROGRAMAR = ['entregas.programar'];
const ROTULO_STATUS = { a_programar: 'A programar', agendada: 'Agendada', em_rota: 'Em rota', ocorrencia: 'Ocorrência', entregue: 'Entregue',
  retirado: 'Retirado', enviada: 'Enviada', cancelada: 'Cancelada' };
const PARTICIPIO = { agendar: 'agendada', reagendar: 'reagendada', cancelar: 'cancelada', retirada: 'registrada como retirada', enviada: 'marcada como enviada',
  comprovante: 'confirmada', saiu: 'iniciada', entregue: 'baixada' };
const participio = acao => (String(acao).startsWith('ocorrencia:') ? 'registrada como ocorrência' : PARTICIPIO[acao] || 'alterada');
const FINAIS = ['entregue', 'retirado', 'cancelada']; // endereço não muda mais
// campo do corpo -> coluna e tamanho máximo (endereço de entrega)
const CAMPOS_ENDERECO = [['rua', 'endereco_rua', 190], ['numero', 'endereco_numero', 30], ['bairro', 'endereco_bairro', 120],
  ['cidade', 'endereco_cidade', 120], ['uf', 'endereco_uf', 2], ['cep', 'endereco_cep', 12], ['ref', 'endereco_ref', 190]];
const CAMPOS_TEXTO = [['contatoLocal', 'contato_local', 190], ['observacao', 'observacao', 500], ['transportadora', 'transportadora', 190],
  ['rastreio', 'rastreio', 120]];
const OCORRENCIAS = ['ausente', 'endereco_errado', 'recusa', 'parcial']; // tipos de evento que contam como ocorrência
const MOTIVO_SAIU_DE_PRONTO = 'Pedido saiu de Pronto';
const MOTIVO_VOLTOU_A_PRONTO = 'Pedido voltou a Pronto';
const MOTIVO_PEDIDO_CANCELADO = 'Pedido cancelado';
const MOTIVO_SAIU_DE_CONCLUIDO = 'Pedido deixou de estar Entregue/Retirado';
const TIPOS_ANEXO = ['foto', 'assinatura'];
const MAX_ANEXOS_PENDENTES = 10; // por entrega e por usuário (anexos enviados e ainda não vinculados a uma baixa)
const MAX_ANEXOS_POR_BAIXA = 3;
const ANEXO_INVALIDO = 'Anexo inválido.';

// Guarda uma foto/assinatura solta (evento_id NULL) da entrega `entrega` (id); a baixa a vincula depois (vincularAnexos).
// `usuario` = código numérico de quem enviou (req.user.id): vira `criado_por` e é conferido na baixa.
// `conferir(linhaTravada)` (opcional) roda depois da trava e antes do COUNT/INSERT. Lança ErroUsuario (400/404/409). Reutilizada pelas rotas da equipe e do motorista.
async function guardarAnexo(pool, entrega, tipo, corpo, mime, usuario, conferir) {
  if (!TIPOS_ANEXO.includes(tipo)) throw new ErroUsuario(400, 'Tipo de anexo inválido: use foto ou assinatura.');
  const v = validarAnexo(corpo, mime);
  if (!v.ok) throw new ErroUsuario(400, v.motivo);
  const criadoPor = String(usuario);
  // contagem + INSERT atômicos: a linha da entrega fica travada, então dois envios simultâneos não passam do limite
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[e]] = await conn.execute('SELECT * FROM web_entregas WHERE id = ? FOR UPDATE', [entrega]);
    if (!e) throw new ErroUsuario(404, 'Entrega não encontrada.');
    if (conferir) conferir(e); // decisão final, com a linha travada: lança ErroUsuario para recusar
    const [[c]] = await conn.execute(
      'SELECT COUNT(*) AS n FROM web_entrega_anexos WHERE entrega_id = ? AND criado_por = ? AND evento_id IS NULL', [entrega, criadoPor]);
    if (Number(c?.n) >= MAX_ANEXOS_PENDENTES) throw new ErroUsuario(409, `Já há ${MAX_ANEXOS_PENDENTES} anexos aguardando baixa nesta entrega. Conclua a baixa antes de enviar mais.`);
    const [ins] = await conn.execute(
      'INSERT INTO web_entrega_anexos (entrega_id, tipo, mime, dados, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      [entrega, tipo, mime, corpo, criadoPor, agoraLocal()]);
    await conn.commit();
    return { anexoId: ins.insertId };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// Lista de ids do corpo: inteiros positivos, sem repetição, no máximo 3. Lança ErroUsuario 400 (mensagem genérica).
function lerAnexoIds(v, { minimo = 0 } = {}) {
  const ids = v === undefined || v === null ? [] : v;
  if (!Array.isArray(ids) || ids.length > MAX_ANEXOS_POR_BAIXA || ids.some(i => !Number.isInteger(i) || i <= 0) || new Set(ids).size !== ids.length) {
    throw new ErroUsuario(400, ANEXO_INVALIDO);
  }
  if (ids.length < minimo) throw new ErroUsuario(400, 'Anexe ao menos uma foto ou assinatura do comprovante.');
  return ids;
}

// Vincula os anexos ao evento, dentro da transação da baixa. Só vale anexo da mesma entrega, enviado por quem dá a baixa
// e ainda solto; qualquer violação lança 400 genérico (sem dizer qual) e a transação inteira é desfeita.
async function vincularAnexos(conn, entregaId, eventoId, ids, usuario) {
  if (!ids.length) return;
  const marcas = ids.map(() => '?').join(', ');
  const [ok] = await conn.execute(
    `SELECT id FROM web_entrega_anexos WHERE entrega_id = ? AND criado_por = ? AND evento_id IS NULL AND id IN (${marcas})`,
    [entregaId, String(usuario), ...ids]);
  if (ok.length !== ids.length) throw new ErroUsuario(400, ANEXO_INVALIDO);
  await conn.execute(`UPDATE web_entrega_anexos SET evento_id = ? WHERE id IN (${marcas})`, [eventoId, ...ids]);
}

// body-parser dentro da rota: estouro de tamanho vira 413 em português (e não a página de erro padrão)
const rawImagem = express.raw({ type: ['image/jpeg', 'image/png'], limit: '1mb' });
const lerImagem = (req, res, next) => rawImagem(req, res, err => {
  if (!err) return next();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo muito grande (máximo 1 MB).' });
  if (err.status && err.status < 500) return res.status(400).json({ error: 'Arquivo inválido.' });
  next(err);
});

// Mantém a fila A programar em dia com os pedidos do VB, de forma idempotente e em lote (poucas idas ao banco remoto):
//  - todo pedido Pronto sem registro ganha um, com sequencia 1 (UNIQUE(numero, sequencia) + INSERT IGNORE ... SELECT: duas varreduras
//    simultâneas não duplicam; pedido que já tem qualquer entrega, inclusive dividida, não ganha outra)
//    e toda entrega sem nenhum evento ganha o evento 'criada';
//  - registro A programar/Agendada/Ocorrência cujo pedido foi Cancelado vira cancelado ('Pedido cancelado'); Em rota nunca é cancelado aqui;
//  - registro A programar cujo pedido deixou de estar Pronto vira cancelado ('Pedido saiu de Pronto');
//  - cancelada pela varredura por ter saído de Pronto, cujo pedido voltou a Pronto, reabre como A programar;
//  - (2026-11-11) pedido Entregue/Retirado fora das Entregas (VB ou menu): A programar/Agendada/Ocorrência são ENCERRADAS como
//    concluídas do mesmo tipo do pedido (evento 'encerrada', status anterior no detalhe); a cancelada pela própria varredura por
//    "saiu de Pronto" (último evento) também, pois era o mesmo caso. Em rota/Enviada não são mexidas;
//  - (2026-11-11) entrega encerrada com o pedido cujo pedido deixou de estar Entregue/Retirado volta ao status que tinha
//    (evento 'reaberta'); as regras seguintes da mesma varredura valem para ela (ex.: pedido Em Produção cancela A programar).
// Qualquer outro registro nunca é alterado aqui. Devolve `null` se `res` já recebeu o erro.
async function sincronizarFila(pool, res) {
  const executar = async conn => {
    const agora = agoraLocal();
    let reabertas = 0, canceladas = 0, encerradas = 0;
    const [criadas] = await conn.execute(
      `INSERT IGNORE INTO web_entregas (numero, sequencia, status, criado_em, atualizado_em)
       SELECT p.NUMERO, 1, 'a_programar', ?, ? FROM ped_orc p WHERE p.TIPO = 'Pedido' AND p.SITUACAO = 'Pronto'
         AND NOT EXISTS (SELECT 1 FROM web_entregas e WHERE e.numero = p.NUMERO)`, [agora, agora]);
    await conn.execute(
      `INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo)
       SELECT e.id, ?, 'sistema', 'criada', NULL FROM web_entregas e
       WHERE NOT EXISTS (SELECT 1 FROM web_entrega_eventos v WHERE v.entrega_id = e.id)`, [agora]);
    // encerrada com o pedido, mas o pedido não está mais Entregue/Retirado: volta ao status de antes (antes das regras de cancelamento)
    const [desfazer] = await conn.execute(
      `SELECT e.id, e.status, v.detalhe FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
       JOIN web_entrega_eventos v ON v.entrega_id = e.id AND v.id = (SELECT MAX(v2.id) FROM web_entrega_eventos v2 WHERE v2.entrega_id = e.id)
       WHERE e.status IN ('entregue', 'retirado') AND v.tipo = '${EVENTO_ENCERRADA}' AND COALESCE(p.SITUACAO, '') NOT IN ('Entregue', 'Retirado')
       ORDER BY e.id`);
    for (const { id, status, detalhe } of desfazer) {
      const volta = statusDeReabertura(detalhe);
      const [up] = await conn.execute('UPDATE web_entregas SET status = ?, atualizado_em = ? WHERE id = ? AND status = ?', [volta, agora, id, status]);
      if (up.affectedRows !== 1) continue;
      await evento(conn, id, agora, 'sistema', EVENTO_REABERTA, MOTIVO_SAIU_DE_CONCLUIDO, null);
      reabertas++;
    }
    // pedido concluído fora das Entregas: as que esperavam viram concluídas do tipo do pedido (antes da regra "saiu de Pronto")
    const [concluidos] = await conn.execute(
      `SELECT e.id, e.status, p.SITUACAO AS situacao FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
       WHERE p.SITUACAO IN ('Entregue', 'Retirado')
         AND (e.status IN (${STATUS_ENCERRAVEIS.map(s => `'${s}'`).join(', ')})
           OR (e.status = 'cancelada' AND EXISTS (SELECT 1 FROM web_entrega_eventos v WHERE v.entrega_id = e.id AND v.usuario = 'sistema'
                 AND v.tipo = 'cancelada' AND v.motivo = ? AND v.id = (SELECT MAX(v2.id) FROM web_entrega_eventos v2 WHERE v2.entrega_id = e.id))))
       ORDER BY e.id`, [MOTIVO_SAIU_DE_PRONTO]);
    for (const { id, status, situacao } of concluidos) {
      const para = statusConcluidoPara(situacao);
      if (!para) continue;
      const [up] = await conn.execute('UPDATE web_entregas SET status = ?, atualizado_em = ? WHERE id = ? AND status = ?', [para, agora, id, status]);
      if (up.affectedRows !== 1) continue;
      await evento(conn, id, agora, 'sistema', EVENTO_ENCERRADA, motivoEncerrada(situacao), { statusAnterior: status });
      encerradas++;
    }
    const cancelar = async (ids, motivo, de) => {
      for (const { id } of ids) {
        const [up] = await conn.execute(
          `UPDATE web_entregas SET status = 'cancelada', atualizado_em = ? WHERE id = ? AND status IN (${de.map(d => `'${d}'`).join(', ')})`, [agora, id]);
        if (up.affectedRows !== 1) continue;
        await conn.execute('INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo) VALUES (?, ?, ?, ?, ?)',
          [id, agora, 'sistema', 'cancelada', motivo]);
        canceladas++;
      }
    };
    const [pedidoCancelado] = await conn.execute(
      `SELECT e.id FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
       WHERE e.status IN ('a_programar', 'agendada', 'ocorrencia') AND p.SITUACAO = 'Cancelado' ORDER BY e.id`);
    await cancelar(pedidoCancelado, MOTIVO_PEDIDO_CANCELADO, ['a_programar', 'agendada', 'ocorrencia']);
    const [fora] = await conn.execute(
      `SELECT e.id FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
       WHERE e.status = 'a_programar' AND p.SITUACAO <> 'Pronto' ORDER BY e.id`);
    await cancelar(fora, MOTIVO_SAIU_DE_PRONTO, ['a_programar']);
    // reabre só o que a própria varredura cancelou por "saiu de Pronto" (último evento); cancelamento da equipe ou do pedido fica
    const [voltaram] = await conn.execute(
      `SELECT e.id FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
       WHERE e.status = 'cancelada' AND p.SITUACAO = 'Pronto'
         AND EXISTS (SELECT 1 FROM web_entrega_eventos v WHERE v.entrega_id = e.id AND v.usuario = 'sistema' AND v.tipo = 'cancelada' AND v.motivo = ?
                       AND v.id = (SELECT MAX(v2.id) FROM web_entrega_eventos v2 WHERE v2.entrega_id = e.id))
       ORDER BY e.id`, [MOTIVO_SAIU_DE_PRONTO]);
    for (const { id } of voltaram) {
      const [up] = await conn.execute(
        "UPDATE web_entregas SET status = 'a_programar', atualizado_em = ? WHERE id = ? AND status = 'cancelada'", [agora, id]);
      if (up.affectedRows !== 1) continue;
      await conn.execute('INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo) VALUES (?, ?, ?, ?, ?)',
        [id, agora, 'sistema', 'criada', MOTIVO_VOLTOU_A_PRONTO]);
      reabertas++;
    }
    return { criadas: criadas.affectedRows || 0, canceladas, reabertas, encerradas };
  };
  if (res) return emTransacao(pool, res, 'sincronizarFila', executar);
  const conn = await pool.getConnection(); // chamada sem rota (por exemplo, de outros módulos): o erro sobe
  try {
    await conn.beginTransaction();
    const r = await executar(conn);
    await conn.commit();
    return r;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// Menu "Mudar situação" (rotas/ped_orc.js) marcando Entregue/Retirado, DENTRO da transação dele e depois de travar ped_orc
// (ordem ped_orc -> web_entregas, a mesma da baixa, das etapas e do excluir). `entregas` = [{ id, status }] do número já lidas
// com FOR UPDATE. Encerra as A programar/Agendada/Ocorrência como concluídas do tipo do pedido (um UPDATE e um INSERT de
// eventos, poucas idas ao banco); Em rota/Enviada ficam. Devolve quantas encerrou.
async function encerrarEntregasDoPedido(conn, { situacao, quem, entregas }) {
  const para = statusConcluidoPara(situacao);
  const alvo = (entregas || []).filter(e => STATUS_ENCERRAVEIS.includes(e.status));
  if (!para || !alvo.length) return 0;
  const agora = agoraLocal();
  const ids = alvo.map(e => Number(e.id));
  await conn.execute(`UPDATE web_entregas SET status = ?, atualizado_em = ? WHERE id IN (${marcas(ids)}) AND status IN (${marcas(STATUS_ENCERRAVEIS)})`,
    [para, agora, ...ids, ...STATUS_ENCERRAVEIS]);
  const motivo = motivoEncerrada(situacao, 'pelo menu de situação');
  await conn.execute(`INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo, detalhe, entregue_a) VALUES ${alvo.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    alvo.flatMap(e => [Number(e.id), agora, quem, EVENTO_ENCERRADA, motivo, JSON.stringify({ statusAnterior: e.status }), null]));
  return alvo.length;
}

// itens do pedido para exibir na entrega (e na baixa): só descrição e quantidade, nunca preços
async function itensDoPedido(conn, numero) {
  const [linhas] = await conn.execute(
    "SELECT DESCRICAO, QTD FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO = ? ORDER BY ITEM", [numero]);
  return linhas.map(l => ({ descricao: l.DESCRICAO || '', qtd: Number(l.QTD) || 0 }));
}

// ---- Divisão da entrega (várias entregas por pedido, etapas 4 a 6) ----
const marcas = arr => arr.map(() => '?').join(', ');
const MSG_ALTERADO = 'O pedido foi alterado depois da divisão: confira os itens. Nada foi dividido nem gerado.';
const MSG_NAO_PRONTO = s => `Só pedido Pronto tem a entrega dividida (situação atual: ${s || '—'}).`;

// Lê tudo o que a divisão precisa de um ou mais pedidos (as leituras independentes saem juntas): entregas, listas de itens,
// sobras encerradas e itens do pedido (ped_orc_lista_itens). `entregasLidas` (opcional) = linhas de web_entregas já lidas
// com trava (dentro da transação): não são relidas. Devolve Map(numero -> { entregas, itensPorEntrega, itensPedido, encerradas,
// ...situacaoDivisao }). Só lê descrição e quantidade dos itens (nunca preço).
async function lerDivisoes(db, numeros, entregasLidas = null) {
  const nums = [...new Set((numeros || []).map(Number))];
  const r = new Map();
  if (!nums.length) return r;
  const m = marcas(nums);
  const [entregas, itens, encerradas, itensPed] = await Promise.all([
    entregasLidas ? entregasLidas : db.execute(`SELECT * FROM web_entregas WHERE numero IN (${m}) ORDER BY numero, sequencia, id`, nums).then(x => x[0]),
    db.execute(`SELECT i.entrega_id, i.numero_item, i.descricao, i.quantidade, i.unidade, i.observacao FROM web_entrega_itens i
                JOIN web_entregas e ON e.id = i.entrega_id WHERE e.numero IN (${m}) ORDER BY i.entrega_id, i.numero_item, i.id`, nums).then(x => x[0]),
    db.execute(`SELECT numero, numero_item, descricao, quantidade, hash_itens FROM web_entrega_sobras_encerradas WHERE numero IN (${m}) ORDER BY id`, nums).then(x => x[0]),
    db.execute(`SELECT NUMERO, ITEM, DESCRICAO, QTD, PRODUTO, OBSERVACAO FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN (${m}) ORDER BY NUMERO, ITEM`, nums).then(x => x[0])
  ]);
  for (const n of nums) {
    const ents = entregas.filter(e => Number(e.numero) === n).map(e => ({ ...e, id: Number(e.id) }));
    const ids = new Set(ents.map(e => e.id));
    const itensPorEntrega = new Map();
    for (const i of itens) {
      const k = Number(i.entrega_id);
      if (!ids.has(k)) continue;
      if (!itensPorEntrega.has(k)) itensPorEntrega.set(k, []);
      itensPorEntrega.get(k).push(i);
    }
    // PRODUTO e OBSERVACAO (do orçamento) só informam a tela; não entram no hash nem em nenhuma conta
    const itensPedido = itensPed.filter(i => Number(i.NUMERO) === n).map(i => ({ item: Number(i.ITEM), descricao: i.DESCRICAO || '', qtd: Number(i.QTD) || 0,
      produto: String(i.PRODUTO ?? '').trim() || null, obsPedido: String(i.OBSERVACAO ?? '').trim() || null }));
    const enc = encerradas.filter(x => Number(x.numero) === n);
    r.set(n, { entregas: ents, itensPorEntrega, itensPedido, encerradas: enc, ...situacaoDivisao({ entregas: ents, itensPorEntrega, itensPedido, encerradas: enc }) });
  }
  return r;
}

// Trava, NESTA ORDEM, o pedido (ped_orc FOR UPDATE) e todas as entregas do número (web_entregas FOR UPDATE): a mesma ordem
// da baixa, das etapas e do excluir pedido (ped_orc -> web_entregas), então duas divisões do mesmo pedido ficam em fila e a
// segunda relê o que a primeira gravou. Confere o filtro de estados do usuário. Depois lê listas, sobras e itens do pedido.
async function travarPedidoDividido(conn, req, numero, msg404 = 'Pedido não encontrado.') {
  const [ped] = await conn.execute("SELECT SITUACAO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido' FOR UPDATE", [numero]);
  if (!ped[0]) throw new ErroUsuario(404, msg404);
  const est = filtroEstados(req, 'c.ESTADO');
  if (est.sql) {
    const [ok] = await conn.execute(
      `SELECT 1 AS ok FROM ped_orc p JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL WHERE p.NUMERO = ? AND p.TIPO = 'Pedido' AND ${est.sql}`,
      [numero, ...est.params]);
    if (!ok.length) throw new ErroUsuario(404, msg404);
  }
  const [entregas] = await conn.execute('SELECT * FROM web_entregas WHERE numero = ? ORDER BY sequencia, id FOR UPDATE', [numero]);
  const d = (await lerDivisoes(conn, [numero], entregas)).get(Number(numero));
  return { situacao: ped[0].SITUACAO, ...d };
}

// grava a lista de itens de uma entrega num INSERT só (cópia: número do ITEM, descrição e quantidade no momento da divisão)
async function inserirItens(conn, entregaId, itens, agora) {
  if (!itens.length) return;
  const params = itens.flatMap(i => [entregaId, i.item, String(i.descricao ?? '').slice(0, 300), i.qtd, i.unidade ?? null, i.observacao ? String(i.observacao).slice(0, 255) : null, agora]);
  await conn.execute(`INSERT INTO web_entrega_itens (entrega_id, numero_item, descricao, quantidade, unidade, observacao, criado_em) VALUES ${itens.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`, params);
}

const evento = (conn, id, agora, usuario, tipo, motivo, detalhe) => conn.execute(
  'INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo, detalhe, entregue_a) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [id, agora, usuario, tipo, motivo, detalhe ? JSON.stringify(detalhe) : null, null]);
const auditar = (conn, agora, quem, acao, numero, detalhe) => conn.execute(
  'INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)', [agora, quem, acao, String(numero), JSON.stringify(detalhe)]);
const itensResumo = itens => itens.map(i => ({ item: i.item, descricao: i.descricao, qtd: i.qtd }));

// Cria uma entrega nova do pedido dividido: sequencia = MAX + 1 (as entregas do número já estão travadas), "A programar",
// SEM data, SEM motorista e SEM tipo (quem agenda escolhe; nada herda status, tipo nem motorista da origem). O endereço de
// entrega e o contato no local vêm de `endereco` (cópia da origem na separação; vazio no saldo). Grava os itens e o evento 'criada'.
// "Entrega n de N" nas listas (mesma regra de ordemNoPedido): N = não canceladas do pedido; n = posição por sequência, depois id
const SQL_ORDEM = `(SELECT COUNT(*) FROM web_entregas x WHERE x.numero = e.numero AND x.status <> 'cancelada') AS qtd_entregas_pedido,
                (SELECT COUNT(*) FROM web_entregas x WHERE x.numero = e.numero AND x.status <> 'cancelada'
                   AND (x.sequencia < e.sequencia OR (x.sequencia = e.sequencia AND x.id <= e.id))) AS ordem_entrega`;
// só entram na resposta quando o pedido tem MAIS de uma entrega não cancelada e esta não é cancelada (pedido de uma entrega: igual a antes)
function camposOrdem(l) {
  const n = Number(l.qtd_entregas_pedido) || 0;
  return n > 1 && l.status !== 'cancelada' ? { ordemEntrega: Number(l.ordem_entrega) || 0, qtdEntregasPedido: n } : {};
}

const COLUNAS_ENDERECO_COPIA = ['endereco_rua', 'endereco_numero', 'endereco_bairro', 'endereco_cidade', 'endereco_uf', 'endereco_cep', 'endereco_ref', 'contato_local'];
async function criarEntregaDividida(conn, req, { numero, entregas, itens, hash, observacao = null, endereco = {}, motivo, detalhe }) {
  const agora = agoraLocal();
  const sequencia = Math.max(0, ...entregas.map(e => Number(e.sequencia) || 0)) + 1;
  const cols = { numero: Number(numero), sequencia, status: STATUS.A_PROGRAMAR, observacao, hash_itens: hash, criado_em: agora, atualizado_em: agora, ...endereco };
  const ks = Object.keys(cols);
  const [ins] = await conn.execute(`INSERT INTO web_entregas (${ks.join(', ')}) VALUES (${marcas(ks)})`, ks.map(k => cols[k]));
  const id = ins.insertId;
  await inserirItens(conn, id, itens, agora);
  await evento(conn, id, agora, req.acesso.nome, 'criada', motivo, detalhe);
  return { id, sequencia, linha: { id, ...cols } };
}

// motoristas = usuários ativos com entregas.baixar pelo perfil ou liberado por exceção, menos os bloqueados
async function motoristasValidos(conn) {
  const [linhas] = await conn.execute(
    `SELECT u.CODIGO, u.NOME FROM cliente_usuarios u JOIN web_usuario_acesso a ON a.usuario_codigo = u.CODIGO AND a.ativo = 1
     WHERE (EXISTS (SELECT 1 FROM web_perfil_permissoes pp WHERE pp.perfil_id = a.perfil_id AND pp.permissao = 'entregas.baixar')
         OR EXISTS (SELECT 1 FROM web_usuario_excecoes x WHERE x.usuario_codigo = u.CODIGO AND x.permissao = 'entregas.baixar' AND x.tipo = 'liberar'))
       AND NOT EXISTS (SELECT 1 FROM web_usuario_excecoes b WHERE b.usuario_codigo = u.CODIGO AND b.permissao = 'entregas.baixar' AND b.tipo = 'bloquear')
     ORDER BY u.NOME`);
  return linhas.map(l => ({ codigo: Number(l.CODIGO), nome: l.NOME }));
}

const dia = v => (v ? String(v).slice(0, 10) : null);
const paraEntrega = r => ({
  id: r.id, numero: r.numero, status: r.status, tipo: r.tipo || null, dataAgendada: dia(r.data_agendada), motoristaCodigo: r.motorista_codigo ?? null,
  endereco: { rua: r.endereco_rua ?? null, numero: r.endereco_numero ?? null, bairro: r.endereco_bairro ?? null, cidade: r.endereco_cidade ?? null,
    uf: r.endereco_uf ?? null, cep: r.endereco_cep ?? null, ref: r.endereco_ref ?? null },
  contatoLocal: r.contato_local ?? null, transportadora: r.transportadora ?? null, rastreio: r.rastreio ?? null,
  previsao: dia(r.previsao), observacao: r.observacao ?? null, criadoEm: r.criado_em ?? null, atualizadoEm: r.atualizado_em ?? null
});

// Entrega do motorista `usuarioId` (tipo motorista). De outro motorista, sem motorista, de outro tipo ou inexistente: undefined
// (todos viram o mesmo 404). Única porta de entrada das rotas /minhas_entregas.
async function buscarDoMotorista(conn, id, usuarioId, { travar = false } = {}) {
  const uid = Number(usuarioId);
  if (!Number.isInteger(id) || !Number.isInteger(uid)) return undefined;
  const [[e]] = await conn.execute(
    `SELECT * FROM web_entregas WHERE id = ? AND motorista_codigo = ? AND tipo = 'motorista'${travar ? ' FOR UPDATE' : ''}`, [id, uid]);
  return e;
}

const idDe = req => (/^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : null);
const bad = msg => new ErroUsuario(400, msg);

// colunas do endereço de entrega a partir do corpo (campos ausentes ficam nulos); UF só com 2 letras
function colunasEndereco(src) {
  const s = src && typeof src === 'object' ? src : {};
  const cols = {};
  for (const [campo, coluna, max] of CAMPOS_ENDERECO) {
    let v = campo === 'uf' ? String(s.uf ?? '').trim() : txt(s[campo], max); // UF não é cortada: "RJX" é erro, não "RJ"
    if (campo === 'uf') {
      v = v.toUpperCase();
      if (v && !/^[A-Z]{2}$/.test(v)) throw bad('UF inválida: use 2 letras.');
    }
    cols[coluna] = v || null;
  }
  return cols;
}

// textos (e a previsão) só entram quando a chave veio no corpo
function colunasTexto(b) {
  const cols = {};
  for (const [campo, coluna, max] of CAMPOS_TEXTO) if (Object.hasOwn(b, campo)) cols[coluna] = txt(b[campo], max) || null;
  if (Object.hasOwn(b, 'previsao')) {
    const t = txt(b.previsao, 10);
    if (t && !validarData(t)) throw bad('Previsão inválida: use AAAA-MM-DD.');
    cols.previsao = t || null;
  }
  return cols;
}

// agendar e reagendar: data obrigatória, tipo e motorista conforme o tipo
function lerAgenda(b, { exigirTipo }) {
  const data = validarData(b.dataAgendada);
  if (!data) throw bad('Data inválida: use AAAA-MM-DD.');
  if ((exigirTipo || b.tipo !== undefined) && !Object.values(TIPOS).includes(b.tipo)) throw bad('Tipo de entrega inválido.');
  const cols = { data_agendada: data, ...colunasTexto(b) };
  if (b.endereco !== undefined) Object.assign(cols, colunasEndereco(b.endereco));
  return { cols, tipo: b.tipo, motoristaCodigo: b.motoristaCodigo };
}

function registrarEntregas({ rota, pool }) {
  // "Saldo a entregar": pedidos Pronto já divididos (alguma entrega com lista de itens ou hash) em que sobra item sem entrega
  // (ex.: uma entrega parcial foi cancelada) ou cujos itens mudaram depois da divisão. Uma consulta acha os candidatos; só
  // havendo algum, as leituras da divisão saem juntas para todos de uma vez. Respeita o filtro de estados. Nenhum dinheiro:
  // os nomes evitam "saldo" (REGEX_VALOR) e as contagens usam qtd*.
  async function sobrasDosPedidos(req) {
    const est = filtroEstados(req, 'c.ESTADO');
    const [cand] = await pool.execute(
      `SELECT DISTINCT p.NUMERO AS numero, p.RAZAO_SOCIAL AS cliente, p.CLIENTE_FINAL AS cliente_final, CAST(p.DATA_PRONTO AS CHAR) AS pronto_em,
              c.CIDADE AS cidade, c.ESTADO AS uf
       FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
       LEFT JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
       WHERE p.SITUACAO = 'Pronto' AND (e.hash_itens IS NOT NULL OR EXISTS (SELECT 1 FROM web_entrega_itens i WHERE i.entrega_id = e.id))${est.sql ? ` AND ${est.sql}` : ''}
       ORDER BY p.NUMERO`, est.sql ? est.params : []);
    if (!cand.length) return [];
    const div = await lerDivisoes(pool, cand.map(c => c.numero));
    const vistos = new Set();
    return cand.filter(c => !vistos.has(Number(c.numero)) && vistos.add(Number(c.numero))).map(c => {
      const d = div.get(Number(c.numero));
      return { numero: Number(c.numero), cliente: c.cliente || '', clienteFinal: c.cliente_final || '', cidade: c.cidade || '', uf: c.uf || '',
        dataPrometida: c.pronto_em ? String(c.pronto_em).slice(0, 10) : null, alterado: !!d?.alterado,
        itensSemEntrega: d ? itensResumo(d.sobra) : [], qtdItensSemEntrega: d ? d.sobra.length : 0 };
    }).filter(s => s.qtdItensSemEntrega > 0 || s.alterado);
  }

  rota('get', '/entregas', VER, async (req, res) => {
    const status = String(req.query.status || '').trim();
    if (status && !Object.values(STATUS).includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    const busca = String(req.query.busca || '').trim().slice(0, 100);

    try { await sincronizarFila(pool); } catch (err) { console.error('Erro sincronizarFila (a lista segue sem a varredura):', err.message); }
    try {
      const where = ["p.TIPO = 'Pedido'"], params = [];
      if (status) { where.push('e.status = ?'); params.push(status); }
      if (busca) { where.push('(CAST(e.numero AS CHAR) LIKE ? OR p.RAZAO_SOCIAL LIKE ? OR p.CLIENTE_FINAL LIKE ?)'); params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); }
      const est = filtroEstados(req, 'c.ESTADO');
      if (est.sql) { where.push(est.sql); params.push(...est.params); }
      // a lista e as sobras dos pedidos divididos são independentes: saem juntas (uma ida ao banco a menos de espera)
      const [[linhas], sobras] = await Promise.all([pool.execute(
        `SELECT e.id, e.numero, e.status, e.tipo, CAST(e.data_agendada AS CHAR) AS data_agendada, CAST(p.DATA_PRONTO AS CHAR) AS data_prometida, CAST(p.DATA AS CHAR) AS data_pedido,
                p.RAZAO_SOCIAL AS cliente, p.CLIENTE_FINAL AS cliente_final, COALESCE(e.endereco_cidade, c.CIDADE) AS cidade, COALESCE(e.endereco_uf, c.ESTADO) AS uf,
                u.NOME AS motorista, p.SITUACAO AS situacao_pedido,
                (SELECT v.usuario FROM web_entrega_eventos v WHERE v.entrega_id = e.id AND v.tipo = 'cancelada' ORDER BY v.id DESC LIMIT 1) AS cancelada_por,
                (SELECT COUNT(*) FROM web_entrega_eventos v WHERE v.entrega_id = e.id
                   AND v.tipo IN (${OCORRENCIAS.map(o => `'${o}'`).join(', ')})) AS qtd_ocorrencias,
                ${SQL_ORDEM}
         FROM web_entregas e
         JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
         LEFT JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
         LEFT JOIN cliente_usuarios u ON u.CODIGO = e.motorista_codigo
         WHERE ${where.join(' AND ')}
         ORDER BY e.data_agendada IS NULL, e.data_agendada, e.numero, e.sequencia`, params),
      sobrasDosPedidos(req).catch(err => { console.error('Erro GET /entregas (sobras):', err.message); return []; })]);
      res.json({ entregas: linhas.map(l => ({
        id: l.id, numero: l.numero, status: l.status, tipo: l.tipo || null,
        statusExibicao: statusExibicao({ status: l.status, situacaoPedido: l.situacao_pedido, canceladaPor: l.cancelada_por }), cliente: l.cliente || '', clienteFinal: l.cliente_final || '', cidade: l.cidade || '', uf: l.uf || '',
        dataPrometida: l.data_prometida ? String(l.data_prometida).slice(0, 10) : null, // previsão de ficar pronto (ped_orc.DATA_PRONTO)
        dataPedido: l.data_pedido ? String(l.data_pedido).slice(0, 10) : null,
        dataAgendada: l.data_agendada ? String(l.data_agendada).slice(0, 10) : null,
        motorista: l.motorista || null, qtdOcorrencias: Number(l.qtd_ocorrencias) || 0,
        ...camposOrdem(l)
      })), sobras });
    } catch (err) {
      console.error('Erro GET /entregas:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  const falha = (res, nome, err) => { console.error(`Erro ${nome}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };
  const nao_encontrada = res => res.status(404).json({ error: 'Entrega não encontrada.' });
  const lerOu400 = (res, ler) => {
    try { return ler(); } catch (err) {
      if (!(err instanceof ErroUsuario)) throw err;
      res.status(err.status).json({ error: err.message }); return null;
    }
  };

  // ATENÇÃO: /entregas/motoristas precisa vir ANTES de /entregas/:id
  rota('get', '/entregas/motoristas', VER, async (req, res) => {
    try { res.json({ motoristas: await motoristasValidos(pool) }); } catch (err) { falha(res, 'GET /entregas/motoristas', err); }
  });

  rota('get', '/entregas/:id', VER, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    try {
      const est = filtroEstados(req, 'c.ESTADO');
      const [[r]] = await pool.execute(
        `SELECT e.*, p.SITUACAO AS situacao_pedido, p.RAZAO_SOCIAL AS cliente, p.DATA_PRONTO AS prometida, p.DATA AS data_pedido,
                c.ENDERECO AS cli_endereco, c.NUMERO AS cli_numero, c.BAIRRO AS cli_bairro, c.CIDADE AS cli_cidade,
                c.ESTADO AS cli_estado, c.CEP AS cli_cep, c.TELEFONE AS cli_telefone
         FROM web_entregas e
         LEFT JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
         LEFT JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
         WHERE e.id = ?${est.sql ? ` AND ${est.sql}` : ''}`, [id, ...(est.sql ? est.params : [])]);
      if (!r) return nao_encontrada(res);
      // histórico, comprovantes e divisão do pedido são independentes: saem juntos
      const [[eventos], [anexos], divisoes] = await Promise.all([
        pool.execute('SELECT id, quando, usuario, tipo, motivo, entregue_a, detalhe FROM web_entrega_eventos WHERE entrega_id = ? ORDER BY id', [id]),
        pool.execute('SELECT id, tipo, mime, criado_em FROM web_entrega_anexos WHERE entrega_id = ? AND evento_id IS NOT NULL ORDER BY id', [id]),
        lerDivisoes(pool, [r.numero])]);
      const d = divisoes.get(Number(r.numero));
      // itens DESTA entrega: a lista dela; sem lista = o pedido inteiro (menos o que outras entregas do pedido levam)
      const itensEntrega = d?.porEntrega.get(Number(id)) || [];
      const itens = itensEntrega.map(i => ({ descricao: i.descricao, qtd: i.qtd, ...(i.observacao ? { observacao: i.observacao } : {}) }));
      const ordem = ordemNoPedido(d?.entregas || [], id);
      // produto e observação do orçamento (só leitura, só para a equipe): ligados pelo número do ITEM; com o pedido alterado
      // depois da divisão os números podem ter mudado, então nada é ligado
      const doPedido = new Map(d && !d.alterado ? d.itensPedido.map(p => [p.item, p]) : []);
      res.json({
        // campos novos só aparecem quando existem (o formato antigo { item, descricao, qtd } não muda)
        itensDetalhe: itensEntrega.map(i => ({ item: i.item, descricao: i.descricao, qtd: i.qtd, ...(i.observacao ? { observacao: i.observacao } : {}),
          ...(doPedido.get(i.item)?.produto ? { produto: doPedido.get(i.item).produto } : {}),
          ...(doPedido.get(i.item)?.obsPedido ? { obsPedido: doPedido.get(i.item).obsPedido } : {}) })),
        divisao: { ...ordem, dividido: !!d?.dividido, alterado: !!d?.alterado, situacaoPedido: r.situacao_pedido ?? null,
          podeSeparar: STATUS_DIVISIVEIS.includes(r.status) && r.situacao_pedido === 'Pronto' && !d?.alterado && itensEntrega.length > 0,
          itensSemEntrega: d ? itensResumo(d.sobra) : [] },
        entrega: { ...paraEntrega(r), statusExibicao: statusExibicao({ status: r.status, situacaoPedido: r.situacao_pedido,
          canceladaPor: [...eventos].reverse().find(v => v.tipo === 'cancelada')?.usuario }), cliente: r.cliente || '', dataPrometida: dia(r.prometida), dataPedido: dia(r.data_pedido) },
        eventos: eventos.map(v => ({ id: v.id, quando: v.quando, usuario: v.usuario, tipo: v.tipo, motivo: v.motivo ?? null, entregueA: v.entregue_a ?? null,
          detalhe: typeof v.detalhe === 'string' ? (() => { try { return JSON.parse(v.detalhe); } catch { return null; } })() : (v.detalhe ?? null) })),
        itens,
        anexos: anexos.map(a => ({ id: a.id, tipo: a.tipo, mime: a.mime, criadoEm: a.criado_em })), // só metadados; o binário vem de /anexo/:anexoId
        clienteEndereco: { rua: r.cli_endereco || '', numero: r.cli_numero || '', bairro: r.cli_bairro || '', cidade: r.cli_cidade || '',
          uf: r.cli_estado || '', cep: r.cli_cep || '', telefone: r.cli_telefone || '' }
      });
    } catch (err) { falha(res, 'GET /entregas/:id', err); }
  });

  // Grava uma mudança na entrega: trava a linha, confere visibilidade (estados) e status, atualiza, e registra
  // evento no histórico + auditoria, tudo na mesma transação. `acao` = nome em proximo(); null = sem mudar o status.
  // `montar(conn, atual)` devolve { cols, motivo?, detalhe?, entregueA?, depois? } (ou lança ErroUsuario);
  // `depois(conn, { eventoId, status, pedido })` roda na mesma transação, logo após o evento (vínculo de anexos, baixa no pedido);
  // o que ele devolver (objeto) entra no detalhe da auditoria.
  // `travarPedido` (baixas): trava o pedido ANTES da entrega (ordem de trava ped_orc -> web_entregas, a mesma das etapas e do
  // excluir pedido). O número vem de uma leitura comum FORA da transação: assim as primeiras leituras da transação são as travas
  // e as leituras comuns seguintes já enxergam tudo o que foi gravado antes de o pedido ser travado (duas baixas do mesmo pedido
  // ficam em fila no pedido e a segunda vê a primeira concluída).
  async function gravar(req, res, nomeRota, acao, evento, montar, { motorista = false, travarPedido = false } = {}) {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    const est = filtroEstados(req, 'c.ESTADO');
    let numeroPrevio = null;
    if (travarPedido) {
      try {
        const [[r]] = await pool.execute('SELECT numero FROM web_entregas WHERE id = ?', [id]);
        numeroPrevio = r ? r.numero : null;
      } catch (err) { return falha(res, nomeRota, err); }
    }
    const entrega = await emTransacao(pool, res, nomeRota, async conn => {
      let pedido = null;
      if (numeroPrevio !== null) {
        const [ped] = await conn.execute("SELECT SITUACAO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido' FOR UPDATE", [numeroPrevio]);
        pedido = ped[0] || null;
      }
      // motorista: só a própria entrega (buscarDoMotorista); equipe: qualquer uma, respeitando o filtro de estados
      const atual = motorista ? await buscarDoMotorista(conn, id, req.user.id, { travar: true })
        : (await conn.execute('SELECT * FROM web_entregas WHERE id = ? FOR UPDATE', [id]))[0][0];
      if (!atual) throw new ErroUsuario(404, 'Entrega não encontrada.');
      // o número de uma entrega nunca muda; se não bate, o pedido travado não é o dela: refaz do zero
      if (travarPedido && Number(atual.numero) !== Number(numeroPrevio)) throw new ErroUsuario(409, 'A entrega mudou enquanto era gravada; tente de novo.');
      if (!motorista && est.sql) { // a trava fica só na linha da web; a conferência de estado é leitura comum
        const [ok] = await conn.execute(
          `SELECT 1 AS ok FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
           JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL WHERE e.id = ? AND ${est.sql}`, [id, ...est.params]);
        if (!ok.length) throw new ErroUsuario(404, 'Entrega não encontrada.');
      }
      let status = atual.status, tipoEvento = evento;
      if (acao) {
        const p = proximo(atual, acao);
        if (!p) throw new ErroUsuario(409, `Esta entrega está em '${ROTULO_STATUS[atual.status] || atual.status}' e não pode ser ${participio(acao)}.`);
        status = p.status; tipoEvento = p.evento;
      } else if (FINAIS.includes(atual.status)) {
        throw new ErroUsuario(409, `Esta entrega está em '${ROTULO_STATUS[atual.status] || atual.status}' e o endereço não pode mais ser alterado.`);
      }
      const { cols, motivo = null, detalhe = null, entregueA = null, depois = null } = await montar(conn, atual);
      const agora = agoraLocal();
      const novo = { ...cols, status, atualizado_em: agora };
      const chaves = Object.keys(novo);
      await conn.execute(`UPDATE web_entregas SET ${chaves.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...chaves.map(k => novo[k]), id]);
      const json = detalhe ? JSON.stringify(detalhe) : null;
      const [ev] = await conn.execute('INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo, detalhe, entregue_a) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, agora, req.acesso.nome, tipoEvento, motivo, json, entregueA]);
      const extra = depois ? await depois(conn, { eventoId: ev.insertId, status, pedido }) : null;
      await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
        [agora, req.acesso.nome, `entrega_${tipoEvento}`, String(atual.numero), JSON.stringify({ entregaId: id, ...(motivo ? { motivo } : {}), ...(detalhe || {}), ...(extra || {}) })]);
      return paraEntrega({ ...atual, ...novo });
    });
    if (entrega) res.json({ entrega });
  }

  // define tipo e motorista: motorista só quando o tipo é "motorista" e só entre os motoristas válidos
  async function agendamento(conn, atual, lido) {
    const tipo = lido.tipo ?? atual.tipo;
    if (!Object.values(TIPOS).includes(tipo)) throw bad('Tipo de entrega inválido.');
    const cols = { ...lido.cols, tipo, motorista_codigo: null };
    if (tipo === TIPOS.MOTORISTA) {
      const codigo = Number(lido.motoristaCodigo ?? atual.motorista_codigo);
      if (!(await motoristasValidos(conn)).some(m => m.codigo === codigo)) throw bad('Escolha um motorista válido.');
      cols.motorista_codigo = codigo;
    }
    return { cols, detalhe: { tipo, dataAgendada: cols.data_agendada, motoristaCodigo: cols.motorista_codigo } };
  }

  rota('post', '/entregas/:id/agendar', PROGRAMAR, async (req, res) => {
    const lido = lerOu400(res, () => lerAgenda(req.body || {}, { exigirTipo: true }));
    if (lido) await gravar(req, res, 'POST /entregas/:id/agendar', 'agendar', null, (conn, atual) => agendamento(conn, atual, lido));
  });

  rota('post', '/entregas/:id/reagendar', PROGRAMAR, async (req, res) => {
    const lido = lerOu400(res, () => lerAgenda(req.body || {}, { exigirTipo: false }));
    if (lido) await gravar(req, res, 'POST /entregas/:id/reagendar', 'reagendar', null, (conn, atual) => agendamento(conn, atual, lido));
  });

  rota('post', '/entregas/:id/cancelar', PROGRAMAR, async (req, res) => {
    const motivo = String(req.body?.motivo ?? '').trim();
    if (motivo.length < 3 || motivo.length > 500) return res.status(400).json({ error: 'Informe o motivo (3 a 500 caracteres).' });
    await gravar(req, res, 'POST /entregas/:id/cancelar', 'cancelar', null, async () => ({ cols: {}, motivo }));
  });

  rota('put', '/entregas/:id/endereco', PROGRAMAR, async (req, res) => {
    const b = req.body || {};
    const cols = lerOu400(res, () => ({ ...colunasEndereco(b), ...(Object.hasOwn(b, 'contatoLocal') ? { contato_local: txt(b.contatoLocal, 190) || null } : {}) }));
    if (cols) await gravar(req, res, 'PUT /entregas/:id/endereco', null, 'endereco', async () => ({ cols, detalhe: { endereco: cols } }));
  });

  // ---- anexos (foto/assinatura) ----
  // linha mínima da entrega se o usuário pode vê-la (filtro de estados), senão null
  async function entregaVisivel(req, id) {
    const [[e]] = await pool.execute('SELECT id, status FROM web_entregas WHERE id = ?', [id]);
    if (!e) return null;
    const est = filtroEstados(req, 'c.ESTADO');
    if (est.sql) {
      const [ok] = await pool.execute(
        `SELECT 1 AS ok FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
         JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL WHERE e.id = ? AND ${est.sql}`, [id, ...est.params]);
      if (!ok.length) return null;
    }
    return e;
  }

  rota('put', '/entregas/:id/anexo', PROGRAMAR, lerImagem, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    const tipo = String(req.query.tipo || '');
    if (!TIPOS_ANEXO.includes(tipo)) return res.status(400).json({ error: 'Tipo de anexo inválido: use foto ou assinatura.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Envie uma imagem JPEG ou PNG.' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    try {
      const e = await entregaVisivel(req, id);
      if (!e) return nao_encontrada(res);
      res.status(201).json(await guardarAnexo(pool, id, tipo, req.body, mime, req.user.id, linha => {
        if (FINAIS.includes(linha.status)) throw new ErroUsuario(409, `Esta entrega está em '${ROTULO_STATUS[linha.status]}' e não aceita mais anexos.`);
      }));
    } catch (err) {
      if (err instanceof ErroUsuario) return res.status(err.status).json({ error: err.message });
      falha(res, 'PUT /entregas/:id/anexo', err);
    }
  });

  rota('get', '/entregas/:id/anexo/:anexoId', VER, async (req, res) => {
    const id = idDe(req);
    if (id === null || !/^\d+$/.test(String(req.params.anexoId))) return nao_encontrada(res);
    try {
      if (!(await entregaVisivel(req, id))) return nao_encontrada(res);
      const [[a]] = await pool.execute('SELECT mime, dados FROM web_entrega_anexos WHERE id = ? AND entrega_id = ?', [Number(req.params.anexoId), id]);
      if (!a) return res.status(404).json({ error: 'Anexo não encontrado.' });
      res.set('Content-Type', a.mime).set('Content-Disposition', 'inline').set('Cache-Control', 'no-store').send(a.dados);
    } catch (err) { falha(res, 'GET /entregas/:id/anexo/:anexoId', err); }
  });

  // ---- baixa pela equipe ----
  const lerEntregueA = (v, { obrigatorio }) => {
    const t = String(v ?? '').trim();
    if (obrigatorio && !t) throw bad('Informe quem recebeu.');
    if (t.length > 190) throw bad('Nome de quem recebeu muito longo (máximo 190 caracteres).');
    return t || null;
  };

  // Como o VB (Pedido_Entregue/Pedido_Retirado): grava SITUACAO e DATA_ENTREGA (data da entrega). Nunca sobrescreve pedido Cancelado.
  // Se o UPDATE não atingir linha, o SELECT distingue "já está no destino" (sucesso, p.ex. o VB já marcou) de cancelado/excluído (409 e rollback).
  const PEDIDO_CANCELADO = 'O pedido foi cancelado ou excluído no sistema; fale com a equipe.';
  async function baixarPedido(c, numero, situacao) {
    const [up] = await c.execute(
      "UPDATE ped_orc SET SITUACAO = ?, DATA_ENTREGA = ? WHERE NUMERO = ? AND TIPO = 'Pedido' AND SITUACAO <> 'Cancelado'", [situacao, hojeLocal(), numero]);
    if (up.affectedRows === 1) return;
    const [[p]] = await c.execute("SELECT SITUACAO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido'", [numero]);
    if (p && p.SITUACAO === situacao) return;
    throw new ErroUsuario(409, PEDIDO_CANCELADO);
  }

  // Várias entregas por pedido: relê, com trava e DEPOIS do UPDATE desta entrega, todas as entregas do pedido e decide se esta
  // baixa é a última (calculo/entregas.js, fechamentoDoPedido). Uma ida ao banco no caso comum (entregas sem lista de itens);
  // as listas de itens e os itens do pedido só são lidos quando todas as entregas válidas têm lista.
  async function fechamento(c, atual, status) {
    const [linhas] = await c.execute(
      `SELECT e.id, e.status, e.hash_itens, (SELECT COUNT(*) FROM web_entrega_itens i WHERE i.entrega_id = e.id) AS qtd_linhas_itens
       FROM web_entregas e WHERE e.numero = ? FOR UPDATE`, [atual.numero]);
    const outras = linhas.filter(e => Number(e.id) !== Number(atual.id));
    const daAtual = linhas.find(e => Number(e.id) === Number(atual.id));
    const entregas = [...outras.map(e => ({ id: Number(e.id), status: e.status, comLista: Number(e.qtd_linhas_itens) > 0, hash: e.hash_itens || null })),
      { id: Number(atual.id), status, comLista: Number(daAtual?.qtd_linhas_itens) > 0, hash: daAtual?.hash_itens || null }];
    const validas = entregas.filter(e => e.status !== 'cancelada');
    const itensPorEntrega = new Map();
    let itensPedido = [], itensEncerrados = [], alterado = false;
    // só vale ler listas, sobras encerradas e itens do pedido se todas as válidas estão concluídas e o pedido foi dividido
    // (todas com lista, ou alguma com hash da divisão); senão a decisão já está tomada. Pedido de uma entrega: nenhuma leitura a mais.
    const dividido = validas.length && (validas.every(e => e.comLista) || validas.some(e => e.hash));
    if (dividido && validas.every(e => pedidoPara(e.status))) {
      const ids = validas.map(e => e.id);
      const [itens] = await c.execute(
        `SELECT entrega_id, numero_item, quantidade FROM web_entrega_itens WHERE entrega_id IN (${ids.map(() => '?').join(', ')})`, ids);
      for (const i of itens) {
        const k = Number(i.entrega_id);
        if (!itensPorEntrega.has(k)) itensPorEntrega.set(k, []);
        itensPorEntrega.get(k).push(i);
      }
      const [ped] = await c.execute("SELECT ITEM, DESCRICAO, QTD FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO = ? ORDER BY ITEM", [atual.numero]);
      itensPedido = ped.map(x => ({ item: Number(x.ITEM), descricao: x.DESCRICAO || '', qtd: Number(x.QTD) || 0 }));
      const [enc] = await c.execute('SELECT numero_item, quantidade, hash_itens FROM web_entrega_sobras_encerradas WHERE numero = ?', [atual.numero]);
      itensEncerrados = enc;
      // pedido editado depois da divisão: os números de ITEM das listas podem não bater mais; nunca fecha sozinho
      const hashAtual = hashItensPedido(itensPedido);
      alterado = [...validas.map(e => e.hash), ...enc.map(x => x.hash_itens)].some(h => h && h !== hashAtual);
    }
    return fechamentoDoPedido({ entregas, itensPorEntrega, itensPedido, itensEncerrados, alterado });
  }

  // evento + vínculo dos anexos + SITUACAO do pedido, tudo dentro da transação de gravar()
  // Regra da última baixa: o pedido só vira Entregue/Retirado (com DATA_ENTREGA) quando esta baixa conclui a última entrega
  // não cancelada e não sobra item sem entrega; senão continua como está (Pronto) e a baixa fica só na entrega (evento + auditoria).
  // Com UMA entrega por pedido (todas as anteriores à divisão) é exatamente o comportamento de antes.
  const baixa = ({ cols = {}, entregueA = null, anexoIds = [], detalhe = null, usuario }) => async (conn, atual) => ({
    cols, entregueA, detalhe: { ...(detalhe || {}), ...(anexoIds.length ? { anexoIds } : {}) },
    depois: async (c, { eventoId, status, pedido }) => {
      await vincularAnexos(c, atual.id, eventoId, anexoIds, usuario);
      if (!pedidoPara(status)) return null;
      const fim = await fechamento(c, atual, status);
      if (fim.fechar) { await baixarPedido(c, atual.numero, fim.situacao); return null; }
      // baixa que não é a última: o pedido não muda, mas pedido Cancelado ou excluído continua recusando a baixa
      if (!pedido || pedido.SITUACAO === 'Cancelado') throw new ErroUsuario(409, PEDIDO_CANCELADO);
      return { pedidoFechado: false, motivoPedidoAberto: fim.motivo };
    }
  });
  const BAIXA = { travarPedido: true };

  rota('post', '/entregas/:id/retirada', PROGRAMAR, async (req, res) => {
    const b = req.body || {};
    const lido = lerOu400(res, () => ({ entregueA: lerEntregueA(b.entregueA, { obrigatorio: true }), anexoIds: lerAnexoIds(b.anexoIds) }));
    if (lido) await gravar(req, res, 'POST /entregas/:id/retirada', 'retirada', null, baixa({ ...lido, usuario: req.user.id }), BAIXA);
  });

  rota('post', '/entregas/:id/enviada', PROGRAMAR, async (req, res) => {
    const b = req.body || {};
    const cols = lerOu400(res, () => {
      const transportadora = String(b.transportadora ?? '').trim();
      if (!transportadora || transportadora.length > 190) throw bad('Informe a transportadora (até 190 caracteres).');
      return { transportadora, ...colunasTexto({ rastreio: b.rastreio ?? '', previsao: b.previsao ?? '' }) };
    });
    if (cols) await gravar(req, res, 'POST /entregas/:id/enviada', 'enviada', null,
      baixa({ cols, detalhe: { transportadora: cols.transportadora, rastreio: cols.rastreio, previsao: cols.previsao ?? null }, usuario: req.user.id }));
  });

  rota('post', '/entregas/:id/comprovante', PROGRAMAR, async (req, res) => {
    const b = req.body || {};
    const lido = lerOu400(res, () => ({ entregueA: lerEntregueA(b.entregueA, { obrigatorio: false }), anexoIds: lerAnexoIds(b.anexoIds, { minimo: 1 }) }));
    if (lido) await gravar(req, res, 'POST /entregas/:id/comprovante', 'comprovante', null, baixa({ ...lido, usuario: req.user.id }), BAIXA);
  });

  // ==== Divisão da entrega (etapas 4 e 5): só a equipe (entregas.programar); o motorista nunca divide ====
  // Tudo numa transação: trava o pedido e DEPOIS as entregas do número (travarPedidoDividido), relê listas e itens já
  // protegidos, valida e grava. O número vem de uma leitura comum FORA da transação (como nas baixas).
  const numeroDaEntrega = async id => { const [[r]] = await pool.execute('SELECT numero FROM web_entregas WHERE id = ?', [id]); return r ? Number(r.numero) : null; };
  const numeroDe = req => (/^\d+$/.test(String(req.params.numero)) ? Number(req.params.numero) : null);

  // "Separar em outra entrega" (e "Gerar entrega do restante" da ocorrência parcial, que usa esta mesma rota com a lista
  // pré-preenchida na tela). Corpo: { itens: [{ numeroItem, quantidade }], observacao? }.
  // A origem (A programar, Agendada ou Ocorrência) fica com o resto; a nova nasce A programar, sem data/motorista/tipo,
  // com o endereço de entrega e o contato copiados da origem. Se a origem não tinha lista ("pedido inteiro"), a lista dela
  // é gerada agora a partir dos itens do pedido. As duas guardam o hash_itens dos itens do pedido de agora.
  rota('post', '/entregas/:id/separar', PROGRAMAR, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    let pedidoSep;
    try { pedidoSep = lerSeparacao(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
    let numero;
    try { numero = await numeroDaEntrega(id); } catch (err) { return falha(res, 'POST /entregas/:id/separar', err); }
    if (numero === null) return nao_encontrada(res);
    const r = await emTransacao(pool, res, 'POST /entregas/:id/separar', async conn => {
      const d = await travarPedidoDividido(conn, req, numero, 'Entrega não encontrada.');
      const origem = d.entregas.find(e => e.id === id);
      if (!origem) throw new ErroUsuario(409, 'A entrega mudou enquanto era gravada; tente de novo.');
      if (!STATUS_DIVISIVEIS.includes(origem.status)) {
        throw new ErroUsuario(409, `Esta entrega está em '${ROTULO_STATUS[origem.status] || origem.status}' e não pode ser dividida: só A programar, Agendada ou Ocorrência.`);
      }
      if (d.situacao !== 'Pronto') throw new ErroUsuario(409, MSG_NAO_PRONTO(d.situacao));
      if (d.alterado) throw new ErroUsuario(409, MSG_ALTERADO);
      const s = separarItens(d.porEntrega.get(id) || [], pedidoSep.itens);
      if (s.erro) throw new ErroUsuario(s.erro.status, s.erro.msg);
      const agora = agoraLocal();
      await conn.execute('DELETE FROM web_entrega_itens WHERE entrega_id = ?', [id]);
      await inserirItens(conn, id, s.resto, agora);
      await conn.execute('UPDATE web_entregas SET hash_itens = ?, atualizado_em = ? WHERE id = ?', [d.hashAtual, agora, id]);
      const endereco = Object.fromEntries(COLUNAS_ENDERECO_COPIA.map(k => [k, origem[k] ?? null]));
      const nova = await criarEntregaDividida(conn, req, { numero, entregas: d.entregas, itens: s.nova, hash: d.hashAtual, observacao: pedidoSep.observacao,
        endereco, motivo: `Separada da entrega ${origem.sequencia}`, detalhe: { origemId: id, itens: itensResumo(s.nova) } });
      await evento(conn, id, agora, req.acesso.nome, 'dividida', `Itens separados para a entrega ${nova.sequencia}`,
        { novaEntregaId: nova.id, itens: itensResumo(s.nova), ficaram: itensResumo(s.resto) });
      await auditar(conn, agora, req.acesso.nome, 'entrega_dividida', numero, { origemId: id, novaId: nova.id, sequencia: nova.sequencia,
        itens: itensResumo(s.nova), ficaram: itensResumo(s.resto), ...(pedidoSep.observacao ? { observacao: pedidoSep.observacao } : {}) });
      return { entrega: paraEntrega(nova.linha), origemId: id };
    });
    if (r) res.status(201).json(r);
  });

  // "Gerar entrega do saldo": cria uma entrega A programar com os itens do pedido dividido que estão sem entrega.
  rota('post', '/entregas/pedido/:numero/saldo', PROGRAMAR, async (req, res) => {
    const numero = numeroDe(req);
    if (numero === null) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const b = req.body || {};
    const observacao = String(b.observacao ?? '').trim();
    if (observacao.length > 500) return res.status(400).json({ error: 'Observação muito longa (máximo 500 caracteres).' });
    const r = await emTransacao(pool, res, 'POST /entregas/pedido/:numero/saldo', async conn => {
      const d = await travarPedidoDividido(conn, req, numero);
      if (d.situacao !== 'Pronto') throw new ErroUsuario(409, MSG_NAO_PRONTO(d.situacao));
      if (d.alterado) throw new ErroUsuario(409, MSG_ALTERADO);
      if (!d.sobra.length) throw new ErroUsuario(409, 'Este pedido não tem itens sem entrega.');
      const nova = await criarEntregaDividida(conn, req, { numero, entregas: d.entregas, itens: d.sobra, hash: d.hashAtual, observacao: observacao || null,
        motivo: 'Entrega do saldo (itens que estavam sem entrega)', detalhe: { itens: itensResumo(d.sobra) } });
      await auditar(conn, agoraLocal(), req.acesso.nome, 'entrega_saldo_gerada', numero, { novaId: nova.id, sequencia: nova.sequencia, itens: itensResumo(d.sobra) });
      return { entrega: paraEntrega(nova.linha) };
    });
    if (r) res.status(201).json(r);
  });

  // "Encerrar saldo" (motivo obrigatório): a sobra passa a contar como coberta (web_entrega_sobras_encerradas, com o hash de agora).
  // Se com isso todas as entregas não canceladas já estão concluídas e nada mais sobra, o pedido fecha aqui (Entregue/Retirado
  // com DATA_ENTREGA de hoje), pela mesma regra da última baixa; senão fecha na última baixa que faltar.
  rota('post', '/entregas/pedido/:numero/saldo/encerrar', PROGRAMAR, async (req, res) => {
    const numero = numeroDe(req);
    if (numero === null) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const motivo = String(req.body?.motivo ?? '').trim();
    if (motivo.length < 3 || motivo.length > 500) return res.status(400).json({ error: 'Informe o motivo (3 a 500 caracteres).' });
    const r = await emTransacao(pool, res, 'POST /entregas/pedido/:numero/saldo/encerrar', async conn => {
      const d = await travarPedidoDividido(conn, req, numero);
      if (d.situacao !== 'Pronto') throw new ErroUsuario(409, MSG_NAO_PRONTO(d.situacao));
      if (d.alterado) throw new ErroUsuario(409, MSG_ALTERADO);
      if (!d.sobra.length) throw new ErroUsuario(409, 'Este pedido não tem itens sem entrega.');
      const agora = agoraLocal();
      const params = d.sobra.flatMap(i => [numero, i.item, String(i.descricao).slice(0, 300), i.qtd, d.hashAtual, motivo, req.acesso.nome, agora]);
      await conn.execute(`INSERT INTO web_entrega_sobras_encerradas (numero, numero_item, descricao, quantidade, hash_itens, motivo, usuario, criado_em)
        VALUES ${d.sobra.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`, params);
      // o histórico fica na entrega mais recente do pedido (a de maior sequência)
      const ultima = [...d.entregas].sort((a, b) => (Number(b.sequencia) || 0) - (Number(a.sequencia) || 0) || b.id - a.id)[0];
      if (ultima) await evento(conn, ultima.id, agora, req.acesso.nome, 'sobra_encerrada', motivo, { itens: itensResumo(d.sobra) });
      const encerrados = [...d.encerradas, ...d.sobra.map(i => ({ numero_item: i.item, quantidade: i.qtd }))];
      const fim = fechamentoDoPedido({ entregas: d.entregas, itensPorEntrega: d.itensPorEntrega, itensPedido: d.itensPedido, itensEncerrados: encerrados });
      if (fim.fechar) await baixarPedido(conn, numero, fim.situacao);
      await auditar(conn, agora, req.acesso.nome, 'entrega_saldo_encerrado', numero, { motivo, itens: itensResumo(d.sobra), pedidoFechado: !!fim.fechar,
        ...(fim.fechar ? { situacao: fim.situacao } : { motivoPedidoAberto: fim.motivo }) });
      return { ok: true, pedidoFechado: !!fim.fechar, situacao: fim.fechar ? fim.situacao : null };
    });
    if (r) res.json(r);
  });

  // ==== Rotas do motorista (/minhas_entregas) ====
  // Isolamento: toda rota passa por buscarDoMotorista (motorista_codigo = req.user.id). Nada daqui devolve dinheiro,
  // nem para quem tem valores.ver: só se leem colunas de endereço, contato, itens (descrição/quantidade) e histórico.
  const BAIXAR = ['entregas.baixar'];
  const FICHA_SQL = `p.RAZAO_SOCIAL AS cliente, c.TELEFONE AS cli_telefone, c.ENDERECO AS cli_rua, c.NUMERO AS cli_numero,
    c.BAIRRO AS cli_bairro, c.CIDADE AS cli_cidade, c.ESTADO AS cli_uf, c.CEP AS cli_cep`;
  const DONO = req => Number(req.user.id);

  // endereço da entrega; todo vazio -> null + `enderecoCliente` (cadastro do cliente, só como sugestão de leitura)
  function itemMotorista(r, qtdItens) {
    const end = { rua: r.endereco_rua ?? null, numero: r.endereco_numero ?? null, bairro: r.endereco_bairro ?? null, cidade: r.endereco_cidade ?? null,
      uf: r.endereco_uf ?? null, cep: r.endereco_cep ?? null, ref: r.endereco_ref ?? null };
    const vazio = Object.values(end).every(v => !v);
    const item = { id: r.id, numero: r.numero, status: r.status, dataAgendada: dia(r.data_agendada), cliente: r.cliente || '', telefone: r.cli_telefone || '',
      endereco: vazio ? null : end, contatoLocal: r.contato_local ?? null, qtdItens: Number(qtdItens) || 0, ...camposOrdem(r) };
    if (vazio) item.enderecoCliente = { rua: r.cli_rua || '', numero: r.cli_numero || '', bairro: r.cli_bairro || '', cidade: r.cli_cidade || '', uf: r.cli_uf || '', cep: r.cli_cep || '' };
    return item;
  }

  rota('get', '/minhas_entregas', BAIXAR, async (req, res) => {
    const diaPedido = req.query.dia === undefined ? null : String(req.query.dia);
    if (diaPedido !== null && !validarData(diaPedido)) return res.status(400).json({ error: 'Data inválida: use AAAA-MM-DD.' });
    try {
      const [linhas] = await pool.execute(
        // qtd_itens = itens DESTA entrega (a lista dela); sem lista = os itens do pedido inteiro (como antes da divisão)
        `SELECT e.*, ${FICHA_SQL},
                COALESCE(NULLIF((SELECT COUNT(*) FROM web_entrega_itens ei WHERE ei.entrega_id = e.id), 0),
                         (SELECT COUNT(*) FROM ped_orc_lista_itens i WHERE i.TIPO = 'Pedido' AND i.NUMERO = e.numero)) AS qtd_itens,
                ${SQL_ORDEM}
         FROM web_entregas e
         LEFT JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
         LEFT JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
         WHERE e.motorista_codigo = ? AND e.tipo = 'motorista' AND e.status IN ('agendada', 'em_rota', 'ocorrencia')
           AND e.data_agendada ${diaPedido ? '=' : '<='} ?
         ORDER BY e.data_agendada, e.numero`, [DONO(req), diaPedido || hojeLocal()]);
      res.json({ entregas: linhas.map(l => itemMotorista(l, l.qtd_itens)) });
    } catch (err) { falha(res, 'GET /minhas_entregas', err); }
  });

  rota('get', '/minhas_entregas/:id', BAIXAR, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    try {
      const e = await buscarDoMotorista(pool, id, DONO(req));
      if (!e) return nao_encontrada(res);
      // ficha, divisão (itens só DESTA entrega), histórico e anexos são independentes: saem juntos
      const [[[ficha]], divisoes, [eventos], [anexos]] = await Promise.all([
        pool.execute(`SELECT ${FICHA_SQL} FROM ped_orc p LEFT JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL WHERE p.NUMERO = ? AND p.TIPO = 'Pedido'`, [e.numero]),
        lerDivisoes(pool, [e.numero]),
        pool.execute('SELECT quando, tipo, motivo, entregue_a FROM web_entrega_eventos WHERE entrega_id = ? ORDER BY id', [id]),
        pool.execute('SELECT id, tipo, mime, criado_em FROM web_entrega_anexos WHERE entrega_id = ? AND (evento_id IS NOT NULL OR criado_por = ?) ORDER BY id', [id, String(DONO(req))])]);
      const d = divisoes.get(Number(e.numero));
      const itens = (d?.porEntrega.get(Number(id)) || []).map(i => ({ descricao: i.descricao, qtd: i.qtd, ...(i.observacao ? { observacao: i.observacao } : {}) }));
      const ordem = ordemNoPedido(d?.entregas || [], id);
      res.json({
        ...itemMotorista({ ...e, ...(ficha || {}), qtd_entregas_pedido: ordem.qtdEntregasPedido, ordem_entrega: ordem.ordemEntrega }, itens.length), itens, observacao: e.observacao ?? null,
        eventos: eventos.map(v => ({ quando: v.quando, tipo: v.tipo, motivo: v.motivo ?? null, entregueA: v.entregue_a ?? null })),
        anexos: anexos.map(a => ({ id: a.id, tipo: a.tipo, mime: a.mime, criadoEm: a.criado_em }))
      });
    } catch (err) { falha(res, 'GET /minhas_entregas/:id', err); }
  });

  rota('put', '/minhas_entregas/:id/anexo', BAIXAR, lerImagem, async (req, res) => {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    const tipo = String(req.query.tipo || '');
    if (!TIPOS_ANEXO.includes(tipo)) return res.status(400).json({ error: 'Tipo de anexo inválido: use foto ou assinatura.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Envie uma imagem JPEG ou PNG.' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    try {
      // dono, tipo e status são decididos dentro da trava de guardarAnexo (sem janela de corrida)
      res.status(201).json(await guardarAnexo(pool, id, tipo, req.body, mime, DONO(req), linha => {
        if (Number(linha.motorista_codigo) !== DONO(req) || linha.tipo !== TIPOS.MOTORISTA) throw new ErroUsuario(404, 'Entrega não encontrada.');
        if (linha.status !== STATUS.EM_ROTA) throw new ErroUsuario(409, 'Só é possível anexar depois de sair para a entrega.');
      }));
    } catch (err) {
      if (err instanceof ErroUsuario) return res.status(err.status).json({ error: err.message });
      falha(res, 'PUT /minhas_entregas/:id/anexo', err);
    }
  });

  rota('get', '/minhas_entregas/:id/anexo/:anexoId', BAIXAR, async (req, res) => {
    const id = idDe(req);
    if (id === null || !/^\d+$/.test(String(req.params.anexoId))) return nao_encontrada(res);
    try {
      if (!(await buscarDoMotorista(pool, id, DONO(req)))) return nao_encontrada(res);
      const [[a]] = await pool.execute(
        'SELECT mime, dados FROM web_entrega_anexos WHERE id = ? AND entrega_id = ? AND (evento_id IS NOT NULL OR criado_por = ?)',
        [Number(req.params.anexoId), id, String(DONO(req))]);
      if (!a) return res.status(404).json({ error: 'Anexo não encontrado.' });
      res.set('Content-Type', a.mime).set('Content-Disposition', 'inline').set('Cache-Control', 'no-store').send(a.dados);
    } catch (err) { falha(res, 'GET /minhas_entregas/:id/anexo/:anexoId', err); }
  });

  const MOTORISTA = { motorista: true };

  rota('post', '/minhas_entregas/:id/saiu', BAIXAR, async (req, res) => {
    await gravar(req, res, 'POST /minhas_entregas/:id/saiu', 'saiu', null, async () => ({ cols: {} }), MOTORISTA);
  });

  rota('post', '/minhas_entregas/:id/baixa', BAIXAR, async (req, res) => {
    const b = req.body || {};
    const lido = lerOu400(res, () => {
      const entregueA = lerEntregueA(b.entregueA, { obrigatorio: true });
      const anexoIds = lerAnexoIds(b.anexoIds); // foto e assinatura são opcionais; os que vierem são conferidos em vincularAnexos (dono, entrega, soltos)
      return { entregueA, anexoIds };
    });
    if (!lido) return;
    const usuario = DONO(req);
    const montarBaixa = baixa({ ...lido, usuario });
    await gravar(req, res, 'POST /minhas_entregas/:id/baixa', 'entregue', null, async (conn, atual) => montarBaixa(conn, atual), { ...MOTORISTA, ...BAIXA });
  });

  // ocorrência: tipo, motivo (3-500) e, no parcial, o que foi entregue
  function lerOcorrencia(b) {
    if (!OCORRENCIAS.includes(b.tipo)) throw bad('Tipo de ocorrência inválido.');
    const motivo = String(b.motivo ?? '').trim();
    if (motivo.length < 3 || motivo.length > 500) throw bad('Informe o motivo (3 a 500 caracteres).');
    let detalhe = null;
    if (b.tipo === 'parcial') {
      const lista = b.itensEntregues;
      if (!Array.isArray(lista) || !lista.length || lista.length > 50) throw bad('Informe os itens entregues (de 1 a 50).');
      detalhe = { itensEntregues: lista.map(i => {
        const descricao = String(i?.descricao ?? '').trim();
        if (!descricao || descricao.length > 300 || !Number.isInteger(i?.qtd) || i.qtd < 1) throw bad('Item entregue inválido: descrição (até 300) e quantidade inteira maior que zero.');
        return { descricao, qtd: i.qtd };
      }) };
    }
    return { tipo: b.tipo, motivo, detalhe };
  }

  rota('post', '/minhas_entregas/:id/ocorrencia', BAIXAR, async (req, res) => {
    const lido = lerOu400(res, () => lerOcorrencia(req.body || {}));
    if (lido) await gravar(req, res, 'POST /minhas_entregas/:id/ocorrencia', `ocorrencia:${lido.tipo}`, null,
      async () => ({ cols: {}, motivo: lido.motivo, detalhe: lido.detalhe }), MOTORISTA);
  });
}

module.exports = { registrarEntregas, sincronizarFila, encerrarEntregasDoPedido, itensDoPedido, motoristasValidos, guardarAnexo, lerAnexoIds, vincularAnexos };
