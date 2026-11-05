// ==========================================================================
// Etapas de produção: leitura e gravação em web_producao_etapas / web_producao_etapas_eventos (só tabelas da web).
// Compartilhado pelas rotas das etapas (rotas/etapas_producao.js), pelo corte de perfis e de vidros (marcação automática)
// e por rotas/ped_orc.js (cancelar e excluir pedido). Não depende de nenhuma rota, para não criar ciclo de require.
// Regras: docs/regras/etapas-producao.md
// ==========================================================================
const { agoraLocal } = require('./transacao');
const E = require('../calculo/etapas_producao');
const { classificarSituacao } = require('../calculo/calendario');

const COLUNAS = 'id, numero, etapa, estado, origem, usuario, quando, observacao';

async function lerLinhas(db, numero, travar = false) {
  const [linhas] = await db.execute(`SELECT ${COLUNAS} FROM web_producao_etapas WHERE numero = ? ORDER BY id${travar ? ' FOR UPDATE' : ''}`, [numero]);
  return linhas || [];
}
// várias de uma vez (fila), sem N+1: Map numero -> linhas
async function lerLinhasDe(db, numeros) {
  const mapa = new Map();
  if (!numeros.length) return mapa;
  const [linhas] = await db.execute(`SELECT ${COLUNAS} FROM web_producao_etapas WHERE numero IN (${numeros.map(() => '?').join(',')}) ORDER BY id`, numeros);
  for (const l of linhas || []) {
    const n = Number(l.numero);
    if (!mapa.has(n)) mapa.set(n, []);
    mapa.get(n).push(l);
  }
  return mapa;
}

// Grava a etapa (atualiza a linha existente ou insere) e o evento do histórico, na conexão (transação) de quem chama.
// origemEvento: 'manual' | 'corte' | 'sistema' (padrão = origem). Devolve a linha nova (como viria do banco).
async function gravarEtapa(conn, { numero, etapa, estado, origem, usuario = '', observacao = null, linha = null, antes = null, origemEvento = null, detalhe = null }) {
  const agora = agoraLocal();
  if (linha && linha.id) {
    await conn.execute('UPDATE web_producao_etapas SET estado = ?, origem = ?, usuario = ?, quando = ?, observacao = ? WHERE id = ?', [estado, origem, usuario, agora, observacao, linha.id]);
  } else {
    await conn.execute('INSERT INTO web_producao_etapas (numero, etapa, estado, origem, usuario, quando, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)', [numero, etapa, estado, origem, usuario, agora, observacao]);
  }
  await conn.execute('INSERT INTO web_producao_etapas_eventos (numero, etapa, estado_antes, estado_depois, origem, usuario, quando, observacao, detalhe) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [numero, etapa, antes, estado, origemEvento || origem, usuario, agora, observacao, detalhe ? JSON.stringify(detalhe) : null]);
  return { id: linha ? linha.id : null, numero, etapa, estado, origem, usuario, quando: agora, observacao };
}

// Pedido cancelado (rotas/ped_orc.js, mesma transação): as etapas marcadas pelo corte voltam a pendente; OK manual e N/A ficam.
async function desmarcarEtapasDoCorte(conn, numero, quem = '', motivo = '') {
  const [linhas] = await conn.execute(`SELECT ${COLUNAS} FROM web_producao_etapas WHERE numero = ? AND origem = 'corte' AND estado = 'ok' FOR UPDATE`, [numero]);
  for (const l of linhas || []) {
    await gravarEtapa(conn, { numero, etapa: l.etapa, estado: 'pendente', origem: 'corte', usuario: quem, linha: l, antes: 'ok', origemEvento: 'sistema', detalhe: { motivo } });
  }
  return (linhas || []).length;
}

// Pedido excluído (rotas/ped_orc.js, mesma transação): o NUMERO é reaproveitado (MAX+1), então as etapas e o histórico saem juntos.
async function apagarEtapasDoPedido(conn, numero, quem = '') {
  const [[c] = []] = await conn.execute('SELECT COUNT(*) AS qtd FROM web_producao_etapas WHERE numero = ?', [numero]);
  await conn.execute('DELETE FROM web_producao_etapas_eventos WHERE numero = ?', [numero]);
  await conn.execute('DELETE FROM web_producao_etapas WHERE numero = ?', [numero]);
  const qtd = Number(c && c.qtd) || 0;
  if (qtd) {
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
      [agoraLocal(), quem, 'etapas_removidas_com_pedido', String(numero), JSON.stringify({ qtdEtapas: qtd })]);
  }
  return qtd;
}

// Reavalia a etapa de corte (perfil_cortado | vidro_cortado) pelo estado do corte do pedido, numa transação PRÓPRIA.
// Chamada DEPOIS do commit da rota do corte (confirmar, cancelar plano, excluir dados): uma falha aqui nunca desfaz o corte,
// e um corte que falhou nunca chega aqui. Nunca lança: erro vai para o log e a etapa fica como estava (o usuário marca à mão).
// estadoCorte(conn, numero) -> { qtdPecas, qtdPendencias, plano: { id, situacao, impressaoConfere, qtdPecasPlano, qtdCortadas } | null }
// Trava ped_orc antes de web_producao_etapas (mesma ordem das rotas das etapas).
async function reavaliarEtapaCorte(pool, { numero, grupo, quem = '', estadoCorte, motivo = '' }) {
  const etapa = E.ETAPA_DO_CORTE[grupo];
  if (!etapa || !numero) return { mudou: false };
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[ped] = []] = await conn.execute("SELECT NUMERO, RAZAO_SOCIAL, SITUACAO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido' FOR UPDATE", [numero]);
    let resultado = { mudou: false };
    if (ped && !['cancelado', 'entregue', 'retirado'].includes(classificarSituacao(ped.SITUACAO))) {
      const [linhas] = await conn.execute(`SELECT ${COLUNAS} FROM web_producao_etapas WHERE numero = ? AND etapa = ? FOR UPDATE`, [numero, etapa]);
      const linha = (linhas || [])[0];
      const est = await estadoCorte(conn, numero);
      const completo = E.corteCompleto(est);
      const novo = E.decidirAutomatico(linha, completo);
      if (novo) {
        await gravarEtapa(conn, { numero, etapa, estado: novo, origem: 'corte', usuario: quem, linha, antes: linha ? linha.estado : null,
          detalhe: { motivo, planoId: est.plano ? est.plano.id : null } });
        resultado = { mudou: true, estado: novo };
      } else resultado = { mudou: false, completo };
    }
    await conn.commit();
    return resultado;
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error(`Erro etapas de produção (reavaliar ${etapa} do pedido ${numero}):`, err.message);
    return { mudou: false, erro: true };
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { lerLinhas, lerLinhasDe, gravarEtapa, desmarcarEtapasDoCorte, apagarEtapasDoPedido, reavaliarEtapaCorte };
