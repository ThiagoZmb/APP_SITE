// ==========================================================================
// Calendário de previsão de finalização dos pedidos (somente leitura).
//   GET /calendario/pedidos?mes=AAAA-MM&situacao=abertos|todos   pedidos do mês agrupados por dia
//   GET /calendario/dia?data=AAAA-MM-DD&situacao=abertos|todos   pedidos de um dia
// A data é ped_orc.DATA_PRONTO (tipo Pedido). Pedidos em 1 consulta + itens/cores (ped_orc_lista_itens, ped_orc_itens_v4, ped_orc_serralheria) e entregas (web_entregas, só com entregas.ver), todas com IN e em paralelo: sem N+1; "em aberto" e "atrasado" saem de calculo/calendario.js.
// Permissão pedidos.ver (a mesma de /dados_lista); estados restritos do usuário filtram pelo cliente; valor só com valores.ver.
// Regras: docs/regras/calendario-pedidos.md
// ==========================================================================
const { filtroEstados } = require('../seguranca/acesso');
const { semValores } = require('../seguranca/valores');
const { hojeLocal } = require('./transacao');
const { validarData, validarMes, validarSituacao, somarDias, montarPedido, agruparPorDia } = require('../calculo/calendario');
const { carregarItensPedidos } = require('./pedido_itens');

const VER = ['pedidos.ver'];

function registrarCalendario({ rota, pool }) {
  const carregarItens = numeros => carregarItensPedidos(pool, numeros, { cores: true }); // itens (e cores) dos pedidos do período, uma consulta IN por tabela; só texto, nunca UNITARIO/TOTAL
  // pedidos com DATA_PRONTO em [de, ate) ; a ordem final é a do agrupamento
  async function buscar(req, de, ate) {
    const est = filtroEstados(req, 'c.ESTADO');
    const [linhas] = await pool.execute(
      `SELECT p.NUMERO AS numero, p.RAZAO_SOCIAL AS cliente, p.CLIENTE_FINAL AS cliente_final, p.SITUACAO AS situacao, p.TOTAL AS valor,
              CAST(p.DATA_PRONTO AS CHAR) AS pronto_em, CAST(p.DATA_ENTREGA AS CHAR) AS data_entrega
       FROM ped_orc p
       ${est.sql ? 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL' : ''}
       WHERE p.TIPO = 'Pedido' AND p.DATA_PRONTO >= ? AND p.DATA_PRONTO < ? ${est.sql ? 'AND ' + est.sql : ''}
       ORDER BY p.DATA_PRONTO, p.NUMERO`, [de, ate, ...est.params]);
    return linhas;
  }
  // entregas dos pedidos do período em UMA consulta (IN), só para quem tem entregas.ver; falha só tira o selo de entrega
  async function carregarEntregas(numeros) {
    const [linhas] = await pool.execute(
      `SELECT id, numero, status, tipo, CAST(data_agendada AS CHAR) AS data_agendada FROM web_entregas WHERE numero IN (${numeros.map(() => '?').join(',')}) ORDER BY numero, id`, numeros);
    const mapa = new Map();
    for (const e of linhas) { const n = Number(e.numero); if (!mapa.has(n)) mapa.set(n, []); mapa.get(n).push(e); }
    return mapa;
  }
  const podeVerEntregas = req => !!(req.acesso && req.acesso.permissoes && req.acesso.permissoes.has('entregas.ver'));
  // itens do balão (com cores) e entregas saem JUNTOS (ida e volta ao banco ~190 ms); falha em qualquer um só tira aquele enfeite, nunca a lista
  async function enriquecer(req, linhas) {
    if (!linhas.length) return [];
    const numeros = linhas.map(r => r.numero);
    const comEntregas = podeVerEntregas(req);
    const [itens, entregas] = await Promise.all([
      carregarItens(numeros).catch(err => { console.error('Erro itens do calendário:', err.message); return new Map(); }),
      comEntregas ? carregarEntregas(numeros.map(Number)).catch(err => { console.error('Erro entregas do calendário:', err.message); return null; }) : null
    ]);
    return linhas.map(r => ({ ...r, ...(itens.get(Number(r.numero)) || {}), ...(entregas ? { entregas: entregas.get(Number(r.numero)) || [] } : {}) }));
  }
  const resumo = dias => ({ qtdPedidos: dias.reduce((n, d) => n + d.qtdPedidos, 0), qtdAtrasados: dias.reduce((n, d) => n + d.qtdAtrasados, 0) });

  rota('get', '/calendario/pedidos', VER, async (req, res) => {
    const mes = validarMes(req.query.mes);
    if (!mes) return res.status(400).json({ error: 'Mês inválido. Use o formato AAAA-MM.' });
    const situacao = validarSituacao(req.query.situacao);
    if (!situacao) return res.status(400).json({ error: 'Situação inválida. Use abertos ou todos.' });
    try {
      const hoje = hojeLocal();
      const linhas = await buscar(req, mes.inicio, mes.fim);
      const dias = agruparPorDia((await enriquecer(req, linhas)).map(r => montarPedido(r, hoje)), situacao);
      res.json(semValores(req, { mes: mes.chave, situacao, hoje, ...resumo(dias), dias }, ['valor']));
    } catch (err) {
      console.error('Erro GET /calendario/pedidos:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('get', '/calendario/dia', VER, async (req, res) => {
    const data = validarData(req.query.data);
    if (!data) return res.status(400).json({ error: 'Data inválida. Use o formato AAAA-MM-DD.' });
    const situacao = validarSituacao(req.query.situacao);
    if (!situacao) return res.status(400).json({ error: 'Situação inválida. Use abertos ou todos.' });
    try {
      const hoje = hojeLocal();
      const linhas = await buscar(req, data, somarDias(data, 1));
      const dias = agruparPorDia((await enriquecer(req, linhas)).map(r => montarPedido(r, hoje)), situacao);
      const pedidos = dias.length ? dias[0].pedidos : [];
      res.json(semValores(req, { data, situacao, hoje, ...resumo(dias), pedidos }, ['valor']));
    } catch (err) {
      console.error('Erro GET /calendario/dia:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarCalendario };
