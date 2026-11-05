// ==========================================================================
// Etapas de produção por pedido ("sub-situação"): fila, mudança de etapa e histórico.
//   GET /etapas/fila?situacao=producao|abertos&versao=X   pedidos com as 6 etapas (uma consulta por tabela, sem N+1; versao igual = { inalterado })
//   PUT /etapas/pedido/:numero/:etapa                       { estado: ok|pendente|na, forcar?, observacao?, dataPronto?: manter|hoje, voltarParaProducao? }
//   GET /etapas/pedido/:numero/historico?etapa=codigo       eventos (mais novo primeiro)
// Grava só em web_producao_etapas(_eventos), EXCETO a etapa "Pedido finalizado": OK grava ped_orc.SITUACAO = 'Pronto' (e, se o usuário
// escolher, DATA_PRONTO = hoje) pelas MESMAS funções do menu de situação (rotas/ped_orc.js: aplicarSituacaoPedido / aplicarDataPronto).
// Nada aqui é dinheiro: as rotas não exigem valores.ver e nenhum nome de campo casa com REGEX_VALOR. Regras: docs/regras/etapas-producao.md
// ==========================================================================
const crypto = require('crypto');
const { emTransacao, ErroUsuario, hojeLocal } = require('./transacao');
const { filtroEstados } = require('../seguranca/acesso');
const E = require('../calculo/etapas_producao');
const { classificarSituacao, atrasado, dataISO } = require('../calculo/calendario');
const { montarPecas } = require('../calculo/corte_pecas');
const { montarPecasVidro } = require('../calculo/vidro_pecas');
const banco = require('./etapas_banco');
const { aplicarSituacaoPedido, aplicarDataPronto, conferirEstadosDoCliente } = require('./ped_orc');
const { sincronizarFila } = require('./entregas');

const VER = ['etapas.ver'];
const LIMITE_CONSULTA = 3000;   // linhas lidas de ped_orc antes do filtro de situação (feito em JS, por causa de acentos/variações)
const LIMITE_FILA = 400;        // pedidos devolvidos na fila
const LIMITE_HISTORICO = 200;
const FORA_DA_FABRICA = ['cancelado', 'entregue', 'retirado'];
const txt = v => String(v ?? '').trim();
const inteiroPositivo = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const lista = numeros => numeros.map(() => '?').join(',');

// Aplicabilidade dos grupos (perfil/vidro) de vários pedidos com 3 consultas no total (mesmas regras de peça/pendência do plano de corte).
// Map numero -> { perfil: bool, vidro: bool }
async function aplicabilidadeDos(db, numeros) {
  const mapa = new Map();
  if (!numeros.length) return mapa;
  const [perfis] = await db.execute(`SELECT NUMERO, id, ITEM, QTD_PORTAS, PERFIL, QTD_ALTURA, TAM_ALTURA, QTD_LARGURA, TAM_LARGURA, PUXADOR, QTD_PUXADOR, TAM_PUXADOR FROM perfis WHERE NUMERO IN (${lista(numeros)})`, numeros);
  const [itens] = await db.execute(`SELECT NUMERO, ITEM_PEDIDO, ITEM, QTD, PERFIL, ACABAMENTO_PERFIL, COR_PERFIL, PUXADOR, ACABAMENTO_PUXADOR, COR_PUXADOR, DIVISOR, ACABAMENTO_DIVISOR, COR_DIVISOR,
    QTD_HORIZONTAL, QTD_VERTICAL, TAM_DIV_HORIZONTAL, TAM_DIV_VERTICAL, ALTURA, LARGURA, REVESTIMENTO, COR_REVESTIMENTO FROM ped_orc_itens_v4 WHERE TIPO = 'Pedido' AND NUMERO IN (${lista(numeros)})`, numeros);
  const [vidros] = await db.execute(`SELECT NUMERO, id, MEDICAO, ITEM, QTD, MODELO, COR_REVESTIMENTO, TAMANHO FROM vidros WHERE NUMERO IN (${lista(numeros)})`, numeros);
  const de = (linhas, n) => (linhas || []).filter(l => Number(l.NUMERO) === n);
  for (const n of numeros) {
    const itensDoPedido = de(itens, n);
    const p = montarPecas({ perfis: de(perfis, n), itens: itensDoPedido });
    const v = montarPecasVidro({ vidros: de(vidros, n), itens: itensDoPedido });
    mapa.set(n, E.aplicabilidade({ perfil: { qtdPecas: p.pecas.length, qtdPendencias: p.pendencias.length }, vidro: { qtdPecas: v.pecas.length, qtdPendencias: v.pendencias.length } }));
  }
  return mapa;
}

const resumoEtapas = () => E.ETAPAS.map(e => ({ codigo: e.codigo, nome: e.nome, curto: e.curto, permissao: e.permissao }));

function registrarEtapasProducao({ rota, pool }) {
  // ---------- fila ----------
  rota('get', '/etapas/fila', VER, async (req, res) => {
    const filtro = E.validarFiltro(req.query.situacao);
    if (!filtro) return res.status(400).json({ error: 'Filtro inválido. Use producao ou abertos.' });
    try {
      const hoje = hojeLocal();
      const est = filtroEstados(req, 'c.ESTADO');
      const [linhas] = await pool.execute(
        `SELECT p.NUMERO AS numero, p.RAZAO_SOCIAL AS cliente, p.CLIENTE_FINAL AS cliente_final, p.SITUACAO AS situacao, CAST(p.DATA_PRONTO AS CHAR) AS pronto_em
         FROM ped_orc p
         ${est.sql ? 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL' : ''}
         WHERE p.TIPO = 'Pedido' AND (p.SITUACAO IS NULL OR p.SITUACAO NOT IN ('Cancelado', 'Entregue', 'Retirado')) ${est.sql ? 'AND ' + est.sql : ''}
         ORDER BY p.DATA_PRONTO, p.NUMERO LIMIT ${LIMITE_CONSULTA}`, est.params);
      const vistos = new Set();
      const base = [];
      for (const r of linhas || []) {
        const numero = Number(r.numero);
        if (vistos.has(numero)) continue;   // cliente com razão social repetida no cadastro duplicaria a linha no JOIN
        vistos.add(numero);
        base.push({ numero, cliente: txt(r.cliente), clienteFinal: txt(r.cliente_final), situacao: txt(r.situacao), prontoEm: dataISO(r.pronto_em) });
      }
      const filtrados = E.ordenarFila(E.filtrarFila(base, filtro));
      const pedidos = filtrados.slice(0, LIMITE_FILA);
      const numeros = pedidos.map(p => p.numero);
      const linhasPor = await banco.lerLinhasDe(pool, numeros);
      const aplic = await aplicabilidadeDos(pool, numeros);
      const saida = pedidos.map(p => {
        const etapas = E.montarEtapas(linhasPor.get(p.numero) || [], aplic.get(p.numero) || { perfil: true, vidro: true });
        return { ...p, classe: classificarSituacao(p.situacao), atrasado: atrasado(p.situacao, p.prontoEm, hoje), ...E.progresso(etapas), etapas };
      });
      const corpo = { filtro, hoje, limitado: filtrados.length > LIMITE_FILA, qtdPedidos: saida.length, etapas: resumoEtapas(),
        podeMarcar: E.etapasQuePode(req.acesso.permissoes), pedidos: saida };
      const versao = crypto.createHash('sha1').update(JSON.stringify(corpo)).digest('hex').slice(0, 20);
      if (req.query.versao && req.query.versao === versao) return res.json({ inalterado: true, versao });
      res.json({ ...corpo, versao });
    } catch (err) {
      console.error('Erro GET /etapas/fila:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  // ---------- marcar / desmarcar / N/A ----------
  rota('put', '/etapas/pedido/:numero/:etapa', VER, async (req, res) => {
    const numero = inteiroPositivo(req.params.numero);
    if (!numero) return res.status(400).json({ error: 'Pedido inválido.' });
    const etapa = String(req.params.etapa || '');
    const def = E.etapaPorCodigo(etapa);
    if (!def) return res.status(400).json({ error: 'Etapa inválida.' });
    const v = E.validarCorpo(req.body);
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    if (!E.ESTADOS.includes(d.estado)) return res.status(400).json({ error: 'Estado inválido. Use ok, pendente ou na.' });
    const permissoes = req.acesso.permissoes;
    if (!E.podeAlterar(permissoes, etapa)) return res.status(403).json({ error: `Sem permissão para a etapa "${def.nome}".` });
    const quem = req.acesso?.nome || req.usuario?.nome || '';
    const alvo = { tipo: 'Pedido', numero };
    const r = await emTransacao(pool, res, 'PUT /etapas/pedido', async conn => {
      // 1) trava o pedido (mesma ordem de trava do corte e do cancelar: ped_orc antes de web_producao_etapas)
      const [[cab] = []] = await conn.execute('SELECT * FROM ped_orc WHERE NUMERO = ? AND TIPO = ? FOR UPDATE', [numero, 'Pedido']);
      if (!cab) throw new ErroUsuario(404, `Pedido nº ${numero} não encontrado.`);
      await conferirEstadosDoCliente(conn, req, cab.RAZAO_SOCIAL);
      const classe = classificarSituacao(cab.SITUACAO);
      if (classe === 'cancelado') throw new ErroUsuario(409, `O pedido nº ${numero} está cancelado: as etapas não mudam.`);
      if (classe === 'entregue' || classe === 'retirado') throw new ErroUsuario(409, `O pedido nº ${numero} já saiu da fábrica (${txt(cab.SITUACAO)}): as etapas não mudam.`);
      // 2) etapas atuais (travadas) e aplicabilidade de agora
      const linhas = await banco.lerLinhas(conn, numero, true);
      const aplic = (await aplicabilidadeDos(conn, [numero])).get(numero);
      const etapas = E.montarEtapas(linhas, aplic);
      const val = E.validarMudanca({ etapas, etapa, estado: d.estado, permissoes, forcar: d.forcar });
      if (!val.ok) throw new ErroUsuario(val.status, val.erro, val.pendentes ? { pendentes: val.pendentes } : undefined);
      const atual = etapas.find(e => e.codigo === etapa);
      const linha = linhas.find(l => l.etapa === etapa) || null;
      // 3) "Pedido finalizado": OK marca o pedido como Pronto pela regra do menu de situação; desfazer só volta a situação se o usuário pedir
      let situacaoMudou = false;
      if (etapa === E.FINAL && d.estado === 'ok' && classe !== 'pronto') {
        if (d.dataPronto === 'hoje') {
          const hoje = hojeLocal();
          if (String(cab.DATA_PRONTO ?? '').slice(0, 10) !== hoje) await aplicarDataPronto(conn, req, alvo, cab, hoje, { origem: 'etapas_producao' });
        }
        await aplicarSituacaoPedido(conn, req, alvo, cab, { nova: 'Pronto', origem: 'etapas_producao' });
        situacaoMudou = true;
      }
      if (etapa === E.FINAL && d.estado === 'pendente' && d.voltarParaProducao) {
        if (!permissoes.has('pedidos.situacao')) throw new ErroUsuario(403, 'Voltar o pedido para Em Produção exige a permissão de mudar a situação do pedido.');
        if (classe !== 'pronto') throw new ErroUsuario(409, `O pedido nº ${numero} não está Pronto: a situação não muda.`);
        const [ativas] = await conn.execute("SELECT id, status FROM web_entregas WHERE numero = ? AND status IN ('agendada', 'em_rota', 'ocorrencia') FOR UPDATE", [numero]);
        if ((ativas || []).length) throw new ErroUsuario(409, 'O pedido tem entrega agendada, em rota ou com ocorrência. Resolva a entrega antes de voltar o pedido para Em Produção.');
        await aplicarSituacaoPedido(conn, req, alvo, cab, { nova: 'Em Produção', origem: 'etapas_producao' });
        situacaoMudou = true;
      }
      // 4) grava a etapa e o histórico
      let nova = linha;
      if (val.mudou) {
        const detalhe = { ...(val.forcado ? { forcado: true, pendentes: E.pendentesAntesDeFinalizar(etapas) } : {}), ...(situacaoMudou ? { situacao: cab.SITUACAO } : {}),
          ...(situacaoMudou && d.dataPronto === 'hoje' && d.estado === 'ok' ? { dataPronto: 'hoje' } : {}) };
        nova = await banco.gravarEtapa(conn, { numero, etapa, estado: d.estado, origem: 'manual', usuario: quem, observacao: d.observacao, linha, antes: atual.estado,
          detalhe: Object.keys(detalhe).length ? detalhe : null });
      }
      const depois = E.montarEtapas([...linhas.filter(l => l.etapa !== etapa), ...(nova ? [nova] : [])], aplic);
      return { ok: true, mudou: val.mudou || situacaoMudou, ...(val.forcado ? { forcado: true } : {}), numero, etapa, situacao: txt(cab.SITUACAO), situacaoMudou,
        dataPronto: dataISO(cab.DATA_PRONTO), etapas: depois, ...E.progresso(depois) };
    });
    // a fila de Entregas acompanha a situação (Pronto entra; saiu de Pronto antes de agendar sai). Depois do commit; falha não desfaz a etapa.
    if (r && r.situacaoMudou) {
      try { await sincronizarFila(pool); } catch (err) { console.error('Erro sincronizarFila depois da etapa finalizado (a fila acerta na próxima varredura):', err.message); }
    }
    if (r) res.json(r);
  });

  // ---------- histórico ----------
  rota('get', '/etapas/pedido/:numero/historico', VER, async (req, res) => {
    const numero = inteiroPositivo(req.params.numero);
    if (!numero) return res.status(400).json({ error: 'Pedido inválido.' });
    const etapa = req.query.etapa === undefined || req.query.etapa === '' ? null : String(req.query.etapa);
    if (etapa && !E.etapaPorCodigo(etapa)) return res.status(400).json({ error: 'Etapa inválida.' });
    try {
      const [[cab] = []] = await pool.execute("SELECT NUMERO, RAZAO_SOCIAL, SITUACAO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido'", [numero]);
      if (!cab) return res.status(404).json({ error: `Pedido nº ${numero} não encontrado.` });
      try { await conferirEstadosDoCliente(pool, req, cab.RAZAO_SOCIAL); } catch (err) { if (err instanceof ErroUsuario) return res.status(err.status).json({ error: err.message }); throw err; }
      const [eventos] = await pool.execute(
        `SELECT id, etapa, estado_antes, estado_depois, origem, usuario, quando, observacao, detalhe FROM web_producao_etapas_eventos WHERE numero = ?${etapa ? ' AND etapa = ?' : ''} ORDER BY id DESC LIMIT ${LIMITE_HISTORICO}`,
        etapa ? [numero, etapa] : [numero]);
      const lerDetalhe = t => { if (!t) return null; try { return JSON.parse(t); } catch { return null; } };
      res.json({ numero, etapa, eventos: (eventos || []).map(e => ({ id: Number(e.id), etapa: e.etapa, nome: E.nomeDa(e.etapa), estadoAntes: e.estado_antes || null, estadoDepois: e.estado_depois,
        origem: e.origem, usuario: e.usuario || '', quando: e.quando ? String(e.quando).slice(0, 19) : null, observacao: e.observacao ?? null, detalhe: lerDetalhe(e.detalhe) })) });
    } catch (err) {
      console.error('Erro GET /etapas/pedido/historico:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarEtapasProducao, aplicabilidadeDos };
