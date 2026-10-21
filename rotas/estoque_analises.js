// ==========================================================================
// Análises do estoque: previsão de falta, tendências, sazonalidade, curva ABC
// e itens parados. calcularAnalises é pura (testada sem banco); a rota só faz
// consultas agregadas e entrega os totais para ela. Medida = quantidade;
// valores só para quem tem valores.ver.
// ==========================================================================
const JANELAS = [60, 90, 180];
const PRAZO_PADRAO = 15;
const DIAS_PARADO = 90;
const MIN_DIAS_DADOS = 30;
const ORDEM_ALERTA = ['falta', 'comprar', 'atencao', 'poucos_dados', 'ok', 'sem_consumo'];

const quatro = n => Math.round(n * 10000) / 10000;
const dia = t => String(t || '').slice(0, 10);
const paraUTC = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const diasEntre = (a, b) => Math.round((paraUTC(b) - paraUTC(a)) / 864e5); // b − a, em dias
const somarDias = (d, n) => new Date(paraUTC(d) + n * 864e5).toISOString().slice(0, 10);
const mesesAte = (hoje, quantos) => {
  const out = [];
  for (let i = quantos - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
};

// ABC: ordem decrescente de consumo (empate pelo código); a classe vem do acumulado ANTES do item:
// abaixo de 80% → A, abaixo de 95% → B, resto (e sem consumo) → C. Assim o maior item é sempre A.
function curvaABC(lista, medida) {
  const total = lista.reduce((s, x) => s + medida(x), 0);
  const classe = new Map();
  let antes = 0;
  for (const x of [...lista].sort((a, b) => medida(b) - medida(a) || a.codigo - b.codigo)) {
    const v = medida(x);
    if (!total || v <= 0) { classe.set(x, 'C'); continue; }
    const p = antes / total;
    classe.set(x, p < 0.8 - 1e-9 ? 'A' : p < 0.95 - 1e-9 ? 'B' : 'C');
    antes += v;
  }
  return classe;
}

function calcularAnalises({ hoje, janela, verValores, itens, saidasPorProduto, saidasPorMes, entradasPorMes, primeiraSaida, prazos, classe = '' }) {
  const diasDados = primeiraSaida ? Math.max(0, Math.min(janela, diasEntre(dia(primeiraSaida), hoje) + 1)) : 0;
  const saidas = new Map(saidasPorProduto.map(s => [Number(s.CODIGO), s])); // o banco já ligou saída → produto
  const prazoDe = new Map(prazos.map(p => [Number(p.produto_codigo), Number(p.prazo_dias)]));

  const lista = itens.map(it => {
    const s = saidas.get(Number(it.CODIGO)) || { janela: 0, anterior: 0, ano: 0, ultima: null };
    const qtd = Number(it.QTD_ESTOQUE) || 0;
    const naJanela = Number(s.janela) || 0, anterior = Number(s.anterior) || 0;
    const consumoDia = diasDados ? quatro(naJanela / diasDados) : 0;
    const diasCobertura = qtd > 0 && consumoDia > 0 ? Math.floor(qtd / consumoDia) : null;
    const prazoDias = prazoDe.get(Number(it.CODIGO)) || PRAZO_PADRAO;
    const ultimaSaida = s.ultima ? dia(s.ultima) : null;
    const alerta = qtd <= 0 ? 'falta' : diasDados < MIN_DIAS_DADOS ? 'poucos_dados' : !consumoDia ? 'sem_consumo'
      : diasCobertura <= prazoDias ? 'comprar' : diasCobertura <= 2 * prazoDias ? 'atencao' : 'ok';
    const parado = /^ativo$/i.test(it.SITUACAO || '') && qtd > 0 && (!ultimaSaida || diasEntre(ultimaSaida, hoje) >= DIAS_PARADO);
    return {
      codigo: Number(it.CODIGO), produto: it.NOME_PRODUTO, classe: it.CLASSE || '', unidade: it.UNIDADE || '',
      qtd, minimo: Number(it.MIN_ESTOQUE) || 0, consumoDia, diasCobertura,
      dataFalta: diasCobertura === null ? null : somarDias(hoje, diasCobertura),
      prazoDias, alerta, tendencia: anterior > 0 ? quatro((naJanela - anterior) / anterior) : null,
      ultimaSaida, parado, _ano: Number(s.ano) || 0, _valor: Number(it.VALOR) || 0
    };
  });

  const abc = curvaABC(lista, x => x._ano);
  const abcValor = verValores ? curvaABC(lista, x => x._ano * x._valor) : null;
  lista.sort((a, b) => ORDEM_ALERTA.indexOf(a.alerta) - ORDEM_ALERTA.indexOf(b.alerta)
    || (a.diasCobertura ?? Infinity) - (b.diasCobertura ?? Infinity)
    || String(a.produto).localeCompare(String(b.produto), 'pt-BR'));
  // o filtro de classe vale para a lista e os cartões; a curva ABC acima é sempre do estoque inteiro
  const visiveis = classe ? lista.filter(x => x.classe === classe) : lista;
  const saida = visiveis.map(x => {
    const { _ano, _valor, ...resto } = x;
    return { ...resto, consumoAno: _ano, abc: abc.get(x), ...(verValores ? { abcValor: abcValor.get(x), valor: _valor } : {}) };
  });

  const resumo = {
    falta: visiveis.filter(x => x.alerta === 'falta').length,
    comprar: visiveis.filter(x => x.alerta === 'comprar').length,
    atencao: visiveis.filter(x => x.alerta === 'atencao').length,
    parados: visiveis.filter(x => x.parado).length,
    ...(verValores ? { valorParado: Math.round(visiveis.filter(x => x.parado).reduce((s, x) => s + x.qtd * x._valor, 0) * 100) / 100 } : {})
  };

  const porMes = (lista2) => new Map(lista2.map(m => [m.mes, Number(m.qtd) || 0]));
  const sMes = porMes(saidasPorMes), eMes = porMes(entradasPorMes);
  const mensal = mesesAte(hoje, 12).map(mes => ({ mes, qtdEntradas: eMes.get(mes) || 0, qtdSaidas: sMes.get(mes) || 0 }));

  // sazonalidade: do mês da primeira saída ao atual (meses sem saída contam 0); exige 12 meses
  let sazonalidade = null;
  if (primeiraSaida) {
    const ini = dia(primeiraSaida).slice(0, 7);
    const quantos = (+hoje.slice(0, 4) - +ini.slice(0, 4)) * 12 + (+hoje.slice(5, 7) - +ini.slice(5, 7)) + 1;
    if (quantos >= 12) {
      const meses = mesesAte(hoje, quantos);
      const geral = meses.reduce((s, m) => s + (sMes.get(m) || 0), 0) / meses.length;
      sazonalidade = Array.from({ length: 12 }, (_, k) => {
        const doMes = meses.filter(m => +m.slice(5, 7) === k + 1).map(m => sMes.get(m) || 0);
        const media = doMes.length ? doMes.reduce((s, v) => s + v, 0) / doMes.length : 0;
        return { mes: k + 1, media: quatro(media), indice: geral ? quatro(media / geral) : null };
      });
    }
  }

  return { hoje, janela, diasDados, resumo, mensal, sazonalidade, itens: saida };
}

const { hojeLocal, agoraLocal } = require('./estoque_movimentos');
const VER = 'estoque.ver';

function registrarEstoqueAnalises({ rota, pool }) {
  const falha = (res, rotaNome, err) => {
    console.error(`Erro ${rotaNome}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  // tudo somado no banco: nenhuma consulta devolve linha por linha de movimento
  rota('get', '/estoque/analises', [VER, { algum: ['estoque.movimentar', 'estoque.desfazer', 'estoque.ajustar'] }], async (req, res) => {
    const janela = JANELAS.includes(Number(req.query.janela)) ? Number(req.query.janela) : 90;
    const classe = String(req.query.classe || '').trim().slice(0, 45);
    const hoje = hojeLocal();
    const ini = somarDias(hoje, -(janela - 1)), iniAnt = somarDias(ini, -janela), ini12 = somarDias(hoje, -364);
    const mes12 = mesesAte(hoje, 12)[0] + '-01';
    // o VB pode ter datas zeradas (0000-00-00) ou digitadas errado: só conta de 2000 até hoje
    const DESDE = '2000-01-01 00:00:00', ATE = `${somarDias(hoje, 1)} 00:00:00`;
    try {
      const [itens] = await pool.execute(
        `SELECT CODIGO, NOME_PRODUTO, CLASSE, UNIDADE, QTD_ESTOQUE, MIN_ESTOQUE, SITUACAO, VALOR FROM estoque
         WHERE (SITUACAO = 'Ativo' OR (SITUACAO = 'Inativo' AND QTD_ESTOQUE <> 0))`);
      // saída → produto ligada no banco: a comparação do MySQL ignora maiúsculas, acentos e espaço no fim,
      // como o VB espera (saida_estoque não tem chave estrangeira para o estoque)
      const [saidasPorProduto] = await pool.execute(
        `SELECT e.CODIGO, SUM(CASE WHEN s.DATA >= ? THEN s.QTD ELSE 0 END) AS janela,
           SUM(CASE WHEN s.DATA >= ? AND s.DATA < ? THEN s.QTD ELSE 0 END) AS anterior,
           SUM(CASE WHEN s.DATA >= ? THEN s.QTD ELSE 0 END) AS ano, MAX(s.DATA) AS ultima
         FROM saida_estoque s JOIN estoque e ON e.NOME_PRODUTO = s.NOME_PRODUTO
         WHERE s.DATA >= ? AND s.DATA < ? GROUP BY e.CODIGO`,
        [`${ini} 00:00:00`, `${iniAnt} 00:00:00`, `${ini} 00:00:00`, `${ini12} 00:00:00`, DESDE, ATE]);
      const [saidasPorMes] = await pool.execute(
        "SELECT DATE_FORMAT(DATA, '%Y-%m') AS mes, SUM(QTD) AS qtd FROM saida_estoque WHERE DATA >= ? AND DATA < ? GROUP BY mes", [DESDE, ATE]);
      const [entradasPorMes] = await pool.execute(
        "SELECT DATE_FORMAT(DATA, '%Y-%m') AS mes, SUM(QTD) AS qtd FROM entrada_estoque WHERE DATA >= ? AND DATA < ? GROUP BY mes", [mes12, ATE]);
      const [[{ primeira }]] = await pool.execute('SELECT MIN(DATA) AS primeira FROM saida_estoque WHERE DATA >= ? AND DATA < ?', [DESDE, ATE]);
      const [prazos] = await pool.execute('SELECT produto_codigo, prazo_dias FROM web_estoque_reposicao');
      res.json(calcularAnalises({ hoje, janela, verValores: req.acesso.permissoes.has('valores.ver'),
        itens, saidasPorProduto, saidasPorMes, entradasPorMes, primeiraSaida: primeira || null, prazos, classe }));
    } catch (err) { falha(res, 'GET /estoque/analises', err); }
  });

  // prazo de reposição do item (tabela só da web; sem linha = 15 dias)
  rota('put', '/estoque/analises/prazo/:codigo', [VER, 'estoque.editar'], async (req, res) => {
    const prazo = req.body?.prazoDias;
    if (!Number.isInteger(prazo) || prazo < 1 || prazo > 365) return res.status(400).json({ error: 'Prazo de reposição: número inteiro de 1 a 365 dias.' });
    const codigo = parseInt(req.params.codigo, 10) || 0;
    try {
      const [achado] = await pool.execute('SELECT CODIGO FROM estoque WHERE CODIGO = ? LIMIT 1', [codigo]);
      if (!achado.length) return res.status(404).json({ error: 'Produto não encontrado.' });
      await pool.execute(
        `INSERT INTO web_estoque_reposicao (produto_codigo, prazo_dias, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE prazo_dias = VALUES(prazo_dias), atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)`,
        [codigo, prazo, agoraLocal(), req.user.nome]);
      res.json({ codigo, prazoDias: prazo });
    } catch (err) { falha(res, 'PUT /estoque/analises/prazo', err); }
  });
}

module.exports = { calcularAnalises, registrarEstoqueAnalises, JANELAS, PRAZO_PADRAO };
