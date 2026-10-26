// ==========================================================================
// Módulo Entregas: fila "A programar" (varredura dos pedidos Pronto) e listagem.
// Só da web: tudo fica em web_entregas / web_entrega_eventos / web_entrega_anexos;
// ped_orc e cadastro_clientes são apenas lidos.
// ==========================================================================
const { filtroEstados } = require('../seguranca/acesso');
const { STATUS, TIPOS, proximo } = require('../calculo/entregas');
const { ErroUsuario, emTransacao, agoraLocal } = require('./transacao');
const { validarData, txt } = require('./estoque_movimentos');

const VER = ['entregas.ver'];
const PROGRAMAR = ['entregas.programar'];
const ROTULO_STATUS = { a_programar: 'A programar', agendada: 'Agendada', em_rota: 'Em rota', ocorrencia: 'Ocorrência', entregue: 'Entregue',
  retirado: 'Retirado', enviada: 'Enviada', cancelada: 'Cancelada' };
const PARTICIPIO = { agendar: 'agendada', reagendar: 'reagendada', cancelar: 'cancelada' };
const FINAIS = ['entregue', 'retirado', 'cancelada']; // endereço não muda mais
// campo do corpo -> coluna e tamanho máximo (endereço de entrega)
const CAMPOS_ENDERECO = [['rua', 'endereco_rua', 190], ['numero', 'endereco_numero', 30], ['bairro', 'endereco_bairro', 120],
  ['cidade', 'endereco_cidade', 120], ['uf', 'endereco_uf', 2], ['cep', 'endereco_cep', 12], ['ref', 'endereco_ref', 190]];
const CAMPOS_TEXTO = [['contatoLocal', 'contato_local', 190], ['observacao', 'observacao', 500], ['transportadora', 'transportadora', 190],
  ['rastreio', 'rastreio', 120]];
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

// itens do pedido para exibir na entrega (e na baixa): só descrição e quantidade, nunca preços
async function itensDoPedido(conn, numero) {
  const [linhas] = await conn.execute(
    "SELECT DESCRICAO, QTD FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO = ? ORDER BY ITEM", [numero]);
  return linhas.map(l => ({ descricao: l.DESCRICAO || '', qtd: Number(l.QTD) || 0 }));
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
        `SELECT e.*, p.RAZAO_SOCIAL AS cliente, p.DATA_ENTREGA AS prometida,
                c.ENDERECO AS cli_endereco, c.NUMERO AS cli_numero, c.BAIRRO AS cli_bairro, c.CIDADE AS cli_cidade,
                c.ESTADO AS cli_estado, c.CEP AS cli_cep, c.TELEFONE AS cli_telefone
         FROM web_entregas e
         LEFT JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
         LEFT JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
         WHERE e.id = ?${est.sql ? ` AND ${est.sql}` : ''}`, [id, ...(est.sql ? est.params : [])]);
      if (!r) return nao_encontrada(res);
      const [eventos] = await pool.execute(
        'SELECT id, quando, usuario, tipo, motivo, entregue_a, detalhe FROM web_entrega_eventos WHERE entrega_id = ? ORDER BY id', [id]);
      const itens = await itensDoPedido(pool, r.numero);
      res.json({
        entrega: { ...paraEntrega(r), cliente: r.cliente || '', dataPrometida: dia(r.prometida) },
        eventos: eventos.map(v => ({ id: v.id, quando: v.quando, usuario: v.usuario, tipo: v.tipo, motivo: v.motivo ?? null, entregueA: v.entregue_a ?? null,
          detalhe: typeof v.detalhe === 'string' ? (() => { try { return JSON.parse(v.detalhe); } catch { return null; } })() : (v.detalhe ?? null) })),
        itens,
        clienteEndereco: { rua: r.cli_endereco || '', numero: r.cli_numero || '', bairro: r.cli_bairro || '', cidade: r.cli_cidade || '',
          uf: r.cli_estado || '', cep: r.cli_cep || '', telefone: r.cli_telefone || '' }
      });
    } catch (err) { falha(res, 'GET /entregas/:id', err); }
  });

  // Grava uma mudança na entrega: trava a linha, confere visibilidade (estados) e status, atualiza, e registra
  // evento no histórico + auditoria, tudo na mesma transação. `acao` = nome em proximo(); null = sem mudar o status.
  // `montar(conn, atual)` devolve { cols, motivo?, detalhe? } (ou lança ErroUsuario).
  async function gravar(req, res, nomeRota, acao, evento, montar) {
    const id = idDe(req);
    if (id === null) return nao_encontrada(res);
    const est = filtroEstados(req, 'c.ESTADO');
    const entrega = await emTransacao(pool, res, nomeRota, async conn => {
      const [[atual]] = await conn.execute('SELECT * FROM web_entregas WHERE id = ? FOR UPDATE', [id]);
      if (!atual) throw new ErroUsuario(404, 'Entrega não encontrada.');
      if (est.sql) { // a trava fica só na linha da web; a conferência de estado é leitura comum
        const [ok] = await conn.execute(
          `SELECT 1 AS ok FROM web_entregas e JOIN ped_orc p ON p.NUMERO = e.numero AND p.TIPO = 'Pedido'
           JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL WHERE e.id = ? AND ${est.sql}`, [id, ...est.params]);
        if (!ok.length) throw new ErroUsuario(404, 'Entrega não encontrada.');
      }
      let status = atual.status, tipoEvento = evento;
      if (acao) {
        const p = proximo(atual, acao);
        if (!p) throw new ErroUsuario(409, `Esta entrega está em '${ROTULO_STATUS[atual.status] || atual.status}' e não pode ser ${PARTICIPIO[acao]}.`);
        status = p.status; tipoEvento = p.evento;
      } else if (FINAIS.includes(atual.status)) {
        throw new ErroUsuario(409, `Esta entrega está em '${ROTULO_STATUS[atual.status] || atual.status}' e o endereço não pode mais ser alterado.`);
      }
      const { cols, motivo = null, detalhe = null } = await montar(conn, atual);
      const agora = agoraLocal();
      const novo = { ...cols, status, atualizado_em: agora };
      const chaves = Object.keys(novo);
      await conn.execute(`UPDATE web_entregas SET ${chaves.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...chaves.map(k => novo[k]), id]);
      const json = detalhe ? JSON.stringify(detalhe) : null;
      await conn.execute('INSERT INTO web_entrega_eventos (entrega_id, quando, usuario, tipo, motivo, detalhe) VALUES (?, ?, ?, ?, ?, ?)',
        [id, agora, req.acesso.nome, tipoEvento, motivo, json]);
      await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
        [agora, req.acesso.nome, `entrega_${tipoEvento}`, String(atual.numero), JSON.stringify({ entregaId: id, ...(motivo ? { motivo } : {}), ...(detalhe || {}) })]);
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
}

module.exports = { registrarEntregas, sincronizarFila, itensDoPedido, motoristasValidos };
