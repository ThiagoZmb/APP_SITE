// Central de Gestão, entrega 1 (só leitura das tabelas do VB; grava apenas em web_gestao_metas e web_gestao_orcamento).
// Fontes: ped_orc (faturamento), fluxo_de_caixa + fluxo_de_caixa_classificacao (caixa e categorias), previsao_financeiro (metas do VB, sugestão).
// Regras e fórmulas: calculo/gestao_caixa.js. Todas as rotas exigem valores.ver (tudo aqui é dinheiro).
const transacao = require('./transacao');
const { emTransacao, ErroUsuario, agoraLocal } = transacao;
const G = require('../calculo/gestao_caixa');
const { validarMeta, validarOrcamento, lerMes, MSG_MES } = require('../calculo/gestao_validacao');

const VER = ['gestao.ver', 'valores.ver'];
const EDITAR = ['gestao.ver', 'gestao.editar', 'valores.ver'];

// 1 se a linha é entrada (tem cliente e não tem fornecedor), como /fluxo/resumo
const SQL_ENTRADA = "(COALESCE(RAZAO_SOCIAL, '') <> '' AND COALESCE(RAZAO_FABRICANTE, '') = '')";

// lê um número do VB que pode vir como número ou texto ("1.500,00", "R$ 2000", "1500.5"); ambíguo/ilegível/zero = null
function lerNumeroVB(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? G.arred2(v) : null;
  const s = String(v).replace(/^R\$\s*/i, '').trim();
  let n;
  if (/^\d+$/.test(s)) n = s;
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) n = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(s)) n = s.replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(s)) n = s;
  else return null; // "1.500" e afins: não adivinhamos
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? G.arred2(x) : null;
}

// `hoje` é lido a cada requisição (data de Brasília, AAAA-MM-DD); os testes trocam transacao.hojeLocal
function registrarGestao({ rota, pool, hoje = () => transacao.hojeLocal() }) {
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, alvo, JSON.stringify(detalhe)]);
  const mesDaRequisicao = req => (req.query.mes === undefined || req.query.mes === '') ? G.mesDeData(hoje()) : lerMes(req.query.mes);
  const num = v => G.numeroOuNull(v) ?? 0;

  const lerClassificacoes = async db => {
    const [rows] = await db.execute('SELECT id, TIPO, CLASSE1, CLASSE2, CLASSE3 FROM fluxo_de_caixa_classificacao ORDER BY id');
    return rows.map(r => ({ id: Number(r.id), tipo: r.TIPO || '', classe1: r.CLASSE1 || '', classe2: r.CLASSE2 || '', classe3: r.CLASSE3 || '' }));
  };

  async function lerMetas(mes) {
    const [rows] = await pool.execute('SELECT periodo, tipo, valor, origem FROM web_gestao_metas WHERE periodo = ?', [mes]);
    const m = { faturamento: null, despesa: null };
    for (const r of rows) if (r.tipo in m) m[r.tipo] = { valor: num(r.valor), origem: r.origem || 'web' };
    return m;
  }

  // orçamento por categoria do mês: classificações + pagos/a pagar do mês + orçamentos gravados
  async function calcularOrcamento(mes, periodo) {
    const classificacoes = await lerClassificacoes(pool);
    const [grupos] = await pool.execute(
      `SELECT COD_CLASSIFICACAO AS classificacaoId, SITUACAO AS situacao, COUNT(*) AS qtd, SUM(VALOR) AS soma FROM fluxo_de_caixa
       WHERE DATA BETWEEN ? AND ? AND SITUACAO IN ('Pago', 'A pagar') GROUP BY COD_CLASSIFICACAO, SITUACAO`, [periodo.inicio, periodo.fim]);
    const [orc] = await pool.execute(
      'SELECT id, classificacao_id, nivel, valor, limiar_atencao, limiar_alerta FROM web_gestao_orcamento WHERE periodo = ? ORDER BY id', [mes]);
    const orcamentos = orc.map(o => ({ id: Number(o.id), classificacaoId: Number(o.classificacao_id), nivel: Number(o.nivel), valor: num(o.valor),
      limiarAtencao: G.numeroOuNull(o.limiar_atencao), limiarAlerta: G.numeroOuNull(o.limiar_alerta) }));
    const r = G.orcamentoPorCategoria({ classificacoes, grupos, orcamentos, periodo });
    return { ...r, classificacoes };
  }

  // ---------- painel ----------
  rota('get', '/gestao/painel', VER, async (req, res) => {
    const mes = mesDaRequisicao(req);
    if (!mes) return res.status(400).json({ error: MSG_MES });
    try {
      const hojeStr = hoje();
      const periodo = G.periodoDoMes(mes, hojeStr);
      const mesAnt = G.mesAnterior(mes), anoAnt = G.mesmoMesAnoAnterior(mes);
      const inicioBusca = `${anoAnt}-01`, fimBusca = periodo.fim;

      const [fat] = await pool.execute(
        `SELECT DATE_FORMAT(DATA, '%Y-%m') AS mes, SUM(TOTAL) AS soma, COUNT(*) AS qtd FROM ped_orc
         WHERE TIPO = 'Pedido' AND COALESCE(SITUACAO, '') <> 'Cancelado' AND COALESCE(FINANCEIRO, '') <> 'Sem custo' AND DATA BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(DATA, '%Y-%m')`, [inicioBusca, fimBusca]);
      const faturamentoPorMes = Object.fromEntries(fat.map(r => [r.mes, { soma: G.arred2(num(r.soma)), qtd: Number(r.qtd) || 0 }]));

      const [grupos] = await pool.execute(
        `SELECT DATE_FORMAT(DATA, '%Y-%m') AS mes, SITUACAO AS situacao, ${SQL_ENTRADA} AS entrada, COUNT(*) AS qtd, SUM(VALOR) AS soma
         FROM fluxo_de_caixa WHERE DATA BETWEEN ? AND ? GROUP BY DATE_FORMAT(DATA, '%Y-%m'), SITUACAO, entrada`, [inicioBusca, fimBusca]);
      const caixaPorMes = G.agregarCaixaPorMes(grupos.map(g => ({ ...g, entrada: !!Number(g.entrada) })));

      // recebíveis vencidos HOJE (independe do mês escolhido): A Receber com data < hoje + Atrasado/Protestado de clientes
      const [venc] = await pool.execute(
        `SELECT SITUACAO AS situacao, ${SQL_ENTRADA} AS entrada, COUNT(*) AS qtd, SUM(VALOR) AS soma, DATE_FORMAT(MIN(DATA), '%Y-%m-%d') AS maisAntigo
         FROM fluxo_de_caixa WHERE DATA < ? OR SITUACAO IN ('Atrasado', 'Protestado') GROUP BY SITUACAO, entrada`, [hojeStr]);
      const vencidos = { aReceberVencido: 0, marcadosAtrasado: 0, qtdAReceberVencido: 0, qtdMarcadosAtrasado: 0, maisAntigo: null };
      let cVencido = 0, cMarcado = 0;
      for (const v of venc) {
        const sit = G.classificarSituacao(v.situacao);
        const soma = G.centavos(v.soma), qtd = Number(v.qtd) || 0;
        const ant = v.maisAntigo || null;
        if (sit === 'a_receber') { // o WHERE já garante DATA < hoje para A Receber
          cVencido += soma; vencidos.qtdAReceberVencido += qtd;
          if (ant && (!vencidos.maisAntigo || ant < vencidos.maisAntigo)) vencidos.maisAntigo = ant;
        } else if ((sit === 'atrasado' || sit === 'protestado') && !!Number(v.entrada)) {
          cMarcado += soma; vencidos.qtdMarcadosAtrasado += qtd;
        }
      }
      vencidos.aReceberVencido = G.reais(cVencido); vencidos.marcadosAtrasado = G.reais(cMarcado);

      const metas = await lerMetas(mes);
      const orc = await calcularOrcamento(mes, periodo);

      // faturamento x meta, com mês anterior e mesmo mês do ano anterior (só quando há pedidos naquele mês)
      const fatMes = faturamentoPorMes[mes];
      const fatAtual = fatMes ? fatMes.soma : 0;
      const comparar = (m) => ({ mes: m, disponivel: !!faturamentoPorMes[m], valor: faturamentoPorMes[m]?.soma ?? null, variacao: G.variacao(fatAtual, faturamentoPorMes[m]?.soma ?? null) });
      const faturamento = {
        mes, realizado: fatAtual, qtdPedidos: fatMes?.qtd || 0, semPedidos: !fatMes,
        meta: metas.faturamento?.valor ?? null, origemMeta: metas.faturamento?.origem ?? null,
        comparacao: G.compararMeta({ realizado: fatAtual, meta: metas.faturamento?.valor ?? null }),
        mesAnterior: comparar(mesAnt), anoAnterior: comparar(anoAnt),
        fonte: `${G.FONTES.pedidos}: pedidos (TIPO Pedido), sem Cancelado e sem financeiro "Sem custo", pela data do pedido`
      };

      // despesa (caixa pago) x meta de despesa
      const caixa = G.caixaDoMes(caixaPorMes, mes);
      const despesaProgresso = G.progressoOrcamento({ orcado: metas.despesa?.valor ?? null, consumido: caixa.realizado.saidas, periodo });
      const despesa = {
        mes, realizado: caixa.realizado.saidas, meta: metas.despesa?.valor ?? null, origemMeta: metas.despesa?.origem ?? null,
        comparacao: G.compararMeta({ realizado: caixa.realizado.saidas, meta: metas.despesa?.valor ?? null }),
        progresso: despesaProgresso,
        fonte: `${G.FONTES.fluxo}: saídas com situação Pago, pela data do lançamento`
      };

      const compCaixa = m => {
        const c = G.caixaDoMes(caixaPorMes, m);
        return {
          mes: m, disponivel: !c.semLancamentos,
          entradas: c.semLancamentos ? null : c.realizado.entradas, saidas: c.semLancamentos ? null : c.realizado.saidas,
          variacaoEntradas: G.variacao(caixa.realizado.entradas, c.semLancamentos ? null : c.realizado.entradas),
          variacaoSaidas: G.variacao(caixa.realizado.saidas, c.semLancamentos ? null : c.realizado.saidas)
        };
      };

      const alertas = G.gerarAlertas({ periodo, faturamento, despesa, orcamento: orc, vencidos, qtdSemCategoria: orc.semCategoria.qtdLancamentos });

      res.json({
        mes, periodo, hoje: hojeStr,
        parcial: periodo.emAndamento,
        avisoPeriodo: periodo.emAndamento ? `Mês em andamento (dia ${periodo.dia} de ${periodo.diasNoMes}): os números são parciais e as comparações com meses fechados não são equivalentes.`
          : (periodo.futuro ? 'Mês futuro: só há previsões, nada realizado.' : null),
        faturamento, despesa,
        caixa: {
          realizado: { rotulo: 'Realizado (caixa): Recebido e Pago', ...caixa.realizado },
          previsto: { rotulo: 'Previsto: A Receber e A Pagar. Previsão não é caixa e não entra no realizado.', ...caixa.previsto },
          marcadosAtrasado: caixa.marcadosAtrasado, semLancamentos: caixa.semLancamentos, qtdLancamentos: caixa.qtdLancamentos,
          mesAnterior: compCaixa(mesAnt), anoAnterior: compCaixa(anoAnt),
          fonte: G.FONTES.fluxo
        },
        recebiveisVencidos: vencidos,
        orcamento: { totais: orc.totais, qtdSemOrcamento: orc.qtdSemOrcamento, qtdCategorias: orc.itens.length, semCategoria: orc.semCategoria },
        alertas,
        limitacoes: G.LIMITACOES
      });
    } catch (err) { erro500(res, 'GET /gestao/painel', err); }
  });

  // ---------- orçamento por categoria ----------
  rota('get', '/gestao/orcamento', VER, async (req, res) => {
    const mes = mesDaRequisicao(req);
    if (!mes) return res.status(400).json({ error: MSG_MES });
    try {
      const periodo = G.periodoDoMes(mes, hoje());
      const orc = await calcularOrcamento(mes, periodo);
      res.json({
        mes, periodo, parcial: periodo.emAndamento, limiaresPadrao: G.LIMIARES_PADRAO, minDiasProjecao: G.MIN_DIAS_PROJECAO,
        itens: orc.itens, semCategoria: orc.semCategoria, totais: orc.totais, qtdSemOrcamento: orc.qtdSemOrcamento,
        categorias: orc.classificacoes.filter(c => G.ehSaida(c)).map(c => ({ id: c.id, classe1: c.classe1, classe2: c.classe2, classe3: c.classe3 })),
        fonte: `${G.FONTES.fluxo} + ${G.FONTES.orcamento}`
      });
    } catch (err) { erro500(res, 'GET /gestao/orcamento', err); }
  });

  // ---------- metas do VB (sugestão, somente leitura) ----------
  rota('get', '/gestao/metas_vb', VER, async (req, res) => {
    const mes = mesDaRequisicao(req);
    if (!mes) return res.status(400).json({ error: MSG_MES });
    const [aaaa, mm] = mes.split('-');
    const resposta = { mes, origem: 'vb', disponivel: false, motivo: null, sugestao: { faturamento: null, despesa: null }, naWeb: { faturamento: null, despesa: null } };
    try {
      const webMetas = await lerMetas(mes);
      resposta.naWeb = { faturamento: webMetas.faturamento?.valor ?? null, despesa: webMetas.despesa?.valor ?? null };
    } catch (err) { console.error('Erro GET /gestao/metas_vb (web):', err.message); }
    try {
      // o VB grava MES como 'mm/aaaa'; a conversão do mês no VB não é uniforme, então aceita também 'm/aaaa'
      const chaves = [...new Set([`${mm}/${aaaa}`, `${Number(mm)}/${aaaa}`])];
      const [rows] = await pool.execute(
        `SELECT META_FATURAMENTO, META_DESPESA FROM previsao_financeiro WHERE MES IN (${chaves.map(() => '?').join(',')})`, chaves);
      resposta.disponivel = true;
      const ultima = rows[rows.length - 1]; // como o VB: a última linha lida vale
      if (!ultima) resposta.motivo = 'O VB não tem previsão cadastrada para este mês.';
      else {
        resposta.sugestao = { faturamento: lerNumeroVB(ultima.META_FATURAMENTO), despesa: lerNumeroVB(ultima.META_DESPESA) };
        if (resposta.sugestao.faturamento === null && resposta.sugestao.despesa === null) resposta.motivo = 'O VB tem a linha do mês, mas sem metas legíveis (vazias, zero ou em formato ambíguo).';
      }
    } catch (err) {
      console.error('Aviso GET /gestao/metas_vb: previsao_financeiro indisponível:', err.message);
      resposta.motivo = 'A tabela de previsões do VB (previsao_financeiro) não está disponível ou não pôde ser lida.';
    }
    res.json(resposta);
  });

  // ---------- gravar meta ----------
  rota('put', '/gestao/meta', EDITAR, async (req, res) => {
    const { erros, dados } = validarMeta(req.body || {});
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const r = await emTransacao(pool, res, 'PUT /gestao/meta', async conn => {
      const [[atual]] = await conn.execute('SELECT id, valor, origem FROM web_gestao_metas WHERE periodo = ? AND tipo = ? FOR UPDATE', [dados.mes, dados.tipo]);
      const agora = agoraLocal();
      const quem = req.acesso?.nome || '';
      if (atual) {
        await conn.execute('UPDATE web_gestao_metas SET valor = ?, origem = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?', [dados.valor, dados.origem, agora, quem, atual.id]);
      } else {
        await conn.execute('INSERT INTO web_gestao_metas (periodo, tipo, valor, origem, criado_por, criado_em, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [dados.mes, dados.tipo, dados.valor, dados.origem, quem, agora, agora, quem]);
      }
      await auditar(conn, req, atual ? 'gestao_meta_alterada' : 'gestao_meta_definida', `${dados.mes}|${dados.tipo}`,
        { campos: ['valor', 'origem'], anterior: atual ? num(atual.valor) : null, novo: dados.valor, origem: dados.origem });
      return { ok: true, mes: dados.mes, tipo: dados.tipo, valor: dados.valor, origem: dados.origem, criado: !atual };
    });
    if (r) res.json(r);
  });

  // ---------- gravar orçamento por categoria ----------
  rota('put', '/gestao/orcamento', EDITAR, async (req, res) => {
    const r = await emTransacao(pool, res, 'PUT /gestao/orcamento', async conn => {
      const classificacoes = await lerClassificacoes(conn);
      const { erros, dados } = validarOrcamento(req.body || {}, classificacoes);
      if (erros.length) throw new ErroUsuario(400, erros.join(' '));
      const [[atual]] = await conn.execute('SELECT id, nivel, valor, limiar_atencao, limiar_alerta FROM web_gestao_orcamento WHERE periodo = ? AND classificacao_id = ? FOR UPDATE',
        [dados.mes, dados.classificacaoId]);
      const agora = agoraLocal();
      const quem = req.acesso?.nome || '';
      if (atual) {
        await conn.execute('UPDATE web_gestao_orcamento SET nivel = ?, valor = ?, limiar_atencao = ?, limiar_alerta = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?',
          [dados.nivel, dados.valor, dados.limiarAtencao, dados.limiarAlerta, agora, quem, atual.id]);
      } else {
        await conn.execute('INSERT INTO web_gestao_orcamento (periodo, classificacao_id, nivel, valor, limiar_atencao, limiar_alerta, criado_por, criado_em, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [dados.mes, dados.classificacaoId, dados.nivel, dados.valor, dados.limiarAtencao, dados.limiarAlerta, quem, agora, agora, quem]);
      }
      await auditar(conn, req, atual ? 'gestao_orcamento_alterado' : 'gestao_orcamento_definido', `${dados.mes}|${dados.classificacaoId}`,
        { campos: ['valor', 'nivel', 'limiarAtencao', 'limiarAlerta'], categoria: dados.rotulo, nivel: dados.nivel, anterior: atual ? num(atual.valor) : null, novo: dados.valor,
          limiarAtencao: dados.limiarAtencao, limiarAlerta: dados.limiarAlerta });
      return { ok: true, mes: dados.mes, classificacaoId: dados.classificacaoId, nivel: dados.nivel, valor: dados.valor, categoria: dados.rotulo, criado: !atual };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarGestao, lerNumeroVB };
