// ==========================================================================
// Módulo Entregas: fila "A programar" (varredura dos pedidos Pronto) e listagem.
// Só da web: tudo fica em web_entregas / web_entrega_eventos / web_entrega_anexos;
// ped_orc e cadastro_clientes são apenas lidos.
// ==========================================================================
const { filtroEstados } = require('../seguranca/acesso');
const { STATUS } = require('../calculo/entregas');
const { emTransacao, agoraLocal } = require('./transacao');

const VER = ['entregas.ver'];
const OCORRENCIAS = ['ausente', 'endereco_errado', 'recusa', 'parcial']; // tipos de evento que contam como ocorrência
const MOTIVO_SAIU_DE_PRONTO = 'Pedido saiu de Pronto';

// Mantém a fila A programar em dia com os pedidos do VB, de forma idempotente:
//  - todo pedido Pronto sem registro ganha um (UNIQUE(numero) + INSERT IGNORE: duas varreduras simultâneas não duplicam);
//  - registro A programar cujo pedido deixou de estar Pronto vira cancelado.
// Registro em qualquer outro status nunca é alterado aqui. Devolve `null` se `res` já recebeu o erro.
async function sincronizarFila(pool, res) {
  const executar = async conn => {
    const agora = agoraLocal();
    let criadas = 0, canceladas = 0;
    const [novos] = await conn.execute(
      `SELECT p.NUMERO FROM ped_orc p WHERE p.TIPO = 'Pedido' AND p.SITUACAO = 'Pronto'
         AND NOT EXISTS (SELECT 1 FROM web_entregas e WHERE e.numero = p.NUMERO) ORDER BY p.NUMERO`);
    for (const { NUMERO } of novos) {
      const [ins] = await conn.execute(
        "INSERT IGNORE INTO web_entregas (numero, status, criado_em, atualizado_em) VALUES (?, 'a_programar', ?, ?)", [NUMERO, agora, agora]);
      if (ins.affectedRows !== 1) continue; // outra varredura chegou primeiro
      await conn.execute('INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo) VALUES (?, ?, ?, ?, ?)',
        [ins.insertId, agora, 'sistema', 'criada', null]);
      criadas++;
    }
    const [fora] = await conn.execute(
      `SELECT e.id FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
       WHERE e.status = 'a_programar' AND p.SITUACAO <> 'Pronto' ORDER BY e.id`);
    for (const { id } of fora) {
      const [up] = await conn.execute(
        "UPDATE web_entregas SET status = 'cancelada', atualizado_em = ? WHERE id = ? AND status = 'a_programar'", [agora, id]);
      if (up.affectedRows !== 1) continue;
      await conn.execute('INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo) VALUES (?, ?, ?, ?, ?)',
        [id, agora, 'sistema', 'cancelada', MOTIVO_SAIU_DE_PRONTO]);
      canceladas++;
    }
    return { criadas, canceladas };
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

function registrarEntregas({ rota, pool }) {
  rota('get', '/entregas', VER, async (req, res) => {
    const status = String(req.query.status || '').trim();
    if (status && !Object.values(STATUS).includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    const busca = String(req.query.busca || '').trim().slice(0, 100);

    if (!(await sincronizarFila(pool, res))) return;
    try {
      const where = ["p.TIPO = 'Pedido'"], params = [];
      if (status) { where.push('e.status = ?'); params.push(status); }
      if (busca) { where.push('(CAST(e.numero AS CHAR) LIKE ? OR p.RAZAO_SOCIAL LIKE ?)'); params.push(`%${busca}%`, `%${busca}%`); }
      const est = filtroEstados(req, 'c.ESTADO');
      if (est.sql) { where.push(est.sql); params.push(...est.params); }
      const [linhas] = await pool.execute(
        `SELECT e.id, e.numero, e.status, e.tipo, CAST(e.data_agendada AS CHAR) AS data_agendada, CAST(p.DATA_ENTREGA AS CHAR) AS data_prometida,
                p.RAZAO_SOCIAL AS cliente, COALESCE(e.endereco_cidade, c.CIDADE) AS cidade, COALESCE(e.endereco_uf, c.ESTADO) AS uf,
                u.NOME AS motorista,
                (SELECT COUNT(*) FROM web_entrega_eventos v WHERE v.entrega_id = e.id
                   AND v.tipo IN (${OCORRENCIAS.map(o => `'${o}'`).join(', ')})) AS qtd_ocorrencias
         FROM web_entregas e
         JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
         LEFT JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
         LEFT JOIN cliente_usuarios u ON u.CODIGO = e.motorista_codigo
         WHERE ${where.join(' AND ')}
         ORDER BY e.data_agendada IS NULL, e.data_agendada, e.numero`, params);
      res.json({ entregas: linhas.map(l => ({
        id: l.id, numero: l.numero, status: l.status, tipo: l.tipo || null, cliente: l.cliente || '', cidade: l.cidade || '', uf: l.uf || '',
        dataPrometida: l.data_prometida ? String(l.data_prometida).slice(0, 10) : null,
        dataAgendada: l.data_agendada ? String(l.data_agendada).slice(0, 10) : null,
        motorista: l.motorista || null, qtdOcorrencias: Number(l.qtd_ocorrencias) || 0
      })) });
    } catch (err) {
      console.error('Erro GET /entregas:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarEntregas, sincronizarFila };
