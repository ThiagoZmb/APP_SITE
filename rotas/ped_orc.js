// ==========================================================================
// Orçamentos e pedidos — gravação igual ao VB (ModPedOrc.Gravar_Pedido_Com_DNA_Transacional)
// e listas de apoio da tela (acessórios permitidos, itens do sistema de correr).
// ==========================================================================
const { semValores } = require('../seguranca/valores');
const { criarLeitor, lerCliente, precoAcessorio, precoComAcessorios, fatorHistorico, ErroPreco } = require('../calculo/precos');
const { acessoriosDoSistema, folhasDoItem, agruparFolhas, medidasVidro, medidasPerfil, exigePerfil, temSistemaCorrer, ErroEngenharia } = require('../calculo/engenharia');
const { linhaComercial } = require('../calculo/linhas_vb');
const { emTransacao, ErroUsuario, ehDuplicado, agoraLocal, hojeLocal, validarData } = require('./estoque_movimentos');

const TIPOS = ['Orçamento', 'Pedido'];
const SITUACOES_PEDIDO = ['Em Produção', 'Entregue', 'Cancelado', 'Retirado'];
const FINANCEIROS = ['Recebido', 'A Receber', 'Atrasado', 'Sem custo'];
const FRENTES_PORTA = ['Porta de giro', 'Porta basculante', 'Frente de gaveta', 'Porta de Correr'];
const MAX_ITENS = 200;
const MAX_QTD_ITEM = 500; // folhas/peças por item (cada folha vira um objeto na engenharia)
const corta = (v, n) => String(v ?? '').trim().slice(0, n);
const nulo = v => (String(v ?? '').trim() === '' ? null : v);
// tabelas apagadas por NUMERO + TIPO antes de regravar (Gravar_Pedido_Com_DNA_Transacional, passo 2)
const TABELAS_ITENS = ['ped_orc_lista_itens', 'ped_orc_itens_v4', 'ped_orc_complementos', 'furacao_pedidos_orcamentos', 'ped_orc_serralheria', 'ped_orc_serralheria_complementos'];

const SEM_CLIENTE = { isFixo: false, desconto: 0 };
const arred2 = v => Math.round(v * 100) / 100;

class ErroItem extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; }
}

// Validação do corpo, na ordem e com as mensagens do VB (SalvarPedidoOrçamentoToolStripMenuItem_Click)
function validar(b) {
  if (!Array.isArray(b.itens) || b.itens.length === 0) return 'Favor inserir pelomenos 1 item no pedido!';
  if (b.itens.length > MAX_ITENS) return `No máximo ${MAX_ITENS} itens por documento.`;
  if (!String(b.clienteCodigo ?? '').trim()) return 'Favor selecionar um cliente!';
  if (!TIPOS.includes(b.tipo)) return "Favor escolher entre 'Pedido' ou 'Orçamento' !";
  if (b.tipo === 'Pedido') {
    if (!validarData(b.dataEntrega)) return 'Favor inserir a data de entrega!';
    if (!SITUACOES_PEDIDO.includes(b.situacao)) return 'Favor escolher uma situação do pedido!';
    if (!FINANCEIROS.includes(b.financeiro)) return 'Favor escolher a situação financeira do pedido!';
  }
  if (b.modo !== 'novo' && b.modo !== 'atualizar') return 'Modo de gravação inválido.';
  if (b.modo === 'atualizar' && !(Number.isInteger(b.numero) && b.numero > 0)) return 'Número inválido para atualizar.';
  for (const [i, it] of b.itens.entries()) {
    if (!it || typeof it !== 'object' || typeof it.detalhes !== 'object') return 'Item inválido.';
    const q = Number(it.qtd);
    if (!(Number.isInteger(q) && q >= 1 && q <= MAX_QTD_ITEM)) return `Item ${i + 1}: quantidade inválida (1 a ${MAX_QTD_ITEM}).`;
  }
  return null;
}

// Item da tela → entrada do motor de preço (mesmos campos que a tela manda ao /calcular_preco)
function entradaPreco(item, folhas) {
  const d = item.detalhes || {};
  if (item.frente === 'Serralheria') return { frente: 'Serralheria', produto: d.produto, material: d.material, acabamento: d.acabSerr,
    altura: item.altura, largura: item.largura, profundidade: item.profundidade, soldas: item.soldas, qtd: item.qtd };
  if (item.frente === 'Avulso') return { frente: 'Avulso', categoria: d.categoria, produto: d.avProduto,
    acabamento: ['Perfil', 'Trilhos', 'Puxador'].includes(d.categoria) ? d.avAcab : '', altura: item.altura, largura: item.largura, qtd: item.qtd };
  const f = folhas[0] || {};
  return { frente: item.frente, altura: f.altura, largura: f.largura, qtd: folhas.length,
    perfil: d.perfil, acabPerfil: d.acabamento, puxador: d.puxador, acabPuxador: d.acabPux, tipoPuxador: d.tipoPuxador,
    posicaoPuxador: (d.posicoesFolhas || [])[0] || '', tamanhoPuxador: d.tamanhoPux, revestimento: d.revestimento,
    divisor: d.divisor, qtdDivH: parseInt(d.divH) || 0, qtdDivV: parseInt(d.divV) || 0 };
}

// Preço + engenharia de um item, sem gravar nada. Erros viram ErroItem com o nº do item.
async function prepararItem(db, leitor, cliente, item, n) {
  const d = item.detalhes || {};
  const ehPorta = FRENTES_PORTA.includes(item.frente);
  if (!ehPorta && item.frente !== 'Serralheria' && item.frente !== 'Avulso') throw new ErroItem(400, `Item ${n}: tipo de produto inválido.`);
  let folhas = [], acessorios = [];
  if (ehPorta) {
    const manuais = (Array.isArray(item.acessorios) ? item.acessorios : []).filter(a => a && a.origem !== 'SISTEMA DE CORRER');
    if (manuais.length) {
      const [perm] = await db.execute('SELECT MODELO FROM acessorios_permitidos WHERE TIPO_PRODUTO = ? ORDER BY MODELO ASC', [item.frente]);
      const permitidos = new Set(perm.map(p => p.MODELO));
      for (const a of manuais) {
        const qtd = parseInt(a.qtd);
        if (!permitidos.has(a.nome)) throw new ErroItem(422, `Item ${n}: o acessório '${a.nome}' não é permitido para ${item.frente}.`, { item: n });
        if (!(qtd >= 1 && qtd <= 9999)) throw new ErroItem(400, `Item ${n}: quantidade inválida do acessório '${a.nome}'.`);
        acessorios.push({ nome: a.nome, qtd, tamanho: parseInt(a.tamanho) || 0, origem: 'MANUAL' });
      }
    }
    let descontoAlturaSistema = 0;
    if (item.frente === 'Porta de Correr' && temSistemaCorrer(d.sistema)) {
      const n0 = Math.max(1, parseInt(item.qtd) || 1);
      const sis = await lerSistemaCorrer(db, String(d.sistema), n0);
      if (!sis) throw new ErroItem(422, `Item ${n}: sistema de correr '${d.sistema}' não encontrado.`, { item: n });
      descontoAlturaSistema = sis.descontoAltura;
      const doSistema = acessoriosDoSistema(sis.itens, sis.config, { larguraVao: parseFloat(item.largura) || 0, folhas: n0, incluirDesempenador: !!d.desempenador });
      acessorios = [...doSistema.map(a => ({ nome: a.nome, qtd: a.qtd, tamanho: a.tamanho, origem: 'SISTEMA DE CORRER' })), ...acessorios];
    }
    folhas = folhasDoItem(item, { descontoAlturaSistema });
  }
  let preco;
  try { preco = await precoComAcessorios(entradaPreco(item, folhas), cliente, leitor, acessorios); }
  catch (err) { if (err instanceof ErroPreco) throw new ErroItem(422, `Item ${n}: ${err.message}`, { item: n }); throw err; }
  const historico = corta(item.historico, 500);
  const valor = arred2(preco.unitario * fatorHistorico(historico));
  const qtdTela = Math.max(1, parseInt(item.qtd) || 1);
  const r = { item, n, historico, valor, totalItem: arred2(valor * qtdTela), acessorios: preco.acessorios, folhas, grupos: [] };

  if (ehPorta) {
    for (const f of folhas) f.valorUnitario = valor;
    for (const g of agruparFolhas(folhas)) {
      const f = g.folha;
      if (exigePerfil(item.frente) && !f.perfil) throw new ErroItem(422, `Item ${n}: Perfil não informado.`, { item: n });
      const perfil = f.perfil ? await leitor.produto(f.perfil) : null;
      if (f.perfil && !perfil && exigePerfil(item.frente)) throw new ErroItem(422, `Item ${n}: Dados do perfil não encontrados.`, { item: n });
      const puxador = f.puxador ? await leitor.produto(f.puxador) : null;
      if (f.puxador && !puxador) throw new ErroItem(422, `Item ${n}: Dados do puxador não encontrados.`, { item: n });
      try { r.grupos.push({ folha: f, qtd: g.qtd, vidro: medidasVidro(f, perfil, puxador), perfil: f.perfil ? medidasPerfil(f, puxador) : null }); }
      catch (err) { if (err instanceof ErroEngenharia) throw new ErroItem(422, `Item ${n}: ${err.message}`, { item: n }); throw err; }
    }
  }
  r.linha = linhaComercial(item, { folhas, acessorios: preco.acessorios });
  return r;
}

const inserir = (conn, tabela, linha) => conn.execute(
  `INSERT INTO ${tabela} (${Object.keys(linha).join(', ')}) VALUES (${Object.keys(linha).map(() => '?').join(', ')})`, Object.values(linha));

// Gravação de um item (ModPedOrc: lista comercial + ProcessarPortas/Serralheria/ItemAvulsa)
async function gravarItem(conn, { tipo, numero, medicao }, p) {
  const { item, n, linha, valor, totalItem } = p;
  const d = item.detalhes || {};
  const ehCorrer = item.frente === 'Porta de Correr';
  // correr: 1 conjunto (QTD 1, unitário = total); demais: QTD da tela
  const unitLinha = ehCorrer ? totalItem : valor;
  await inserir(conn, 'ped_orc_lista_itens', { TIPO: tipo, NUMERO: numero, ITEM: n, TIPO_PRODUTO: linha.tipoProduto, PRODUTO: linha.produto,
    QTD: linha.qtd, DESCRICAO: linha.descricao, UNITARIO: unitLinha, TOTAL: totalItem, OBSERVACAO: nulo(corta(item.obs, 2000)), PORCENTAGEM: p.historico });

  if (item.frente === 'Serralheria') {
    await inserir(conn, 'ped_orc_serralheria', { TIPO: tipo, NUMERO: numero, ITEM_PEDIDO: n, ITEM: 1, QTD_ITENS: linha.qtd,
      PRODUTO: corta(d.produto, 190), MATERIAL: corta(d.material, 190), ACABAMENTO: corta(d.acabSerr, 190), COR: corta(d.corSerr, 190),
      QTD_ALTURA: 1, ALTURA: Math.round(parseFloat(item.altura) || 0), QTD_LARGURA: 1, LARGURA: Math.round(parseFloat(item.largura) || 0),
      QTD_PROFUNDIDADE: 1, PROFUNDIDADE: Math.round(parseFloat(item.profundidade) || 0), QTD_SOLDAS: parseInt(item.soldas) || 0,
      UNITARIO: valor, TOTAL: totalItem, OBS: corta(item.obs, 2000) });
    return;
  }
  if (item.frente === 'Avulso') {
    const ehRev = d.categoria === 'Revestimento';
    await inserir(conn, 'ped_orc_itens_v4', { TIPO: tipo, NUMERO: numero, TIPO_PRODUTO: corta(d.categoria, 190), ITEM_PEDIDO: n, ITEM: 1, PORTA: 1,
      QTD: linha.qtd, ALTURA: Math.round(parseFloat(item.altura) || 0), LARGURA: Math.round(parseFloat(item.largura) || 0),
      PERFIL: nulo(corta(d.avProduto, 190)), ACABAMENTO_PERFIL: nulo(corta(d.avAcab, 190)), COR_PERFIL: nulo(corta(d.avCor, 190)), USINAGEM_PERFIL: null,
      REVESTIMENTO: ehRev ? nulo(corta(d.avProduto, 190)) : null, COR_REVESTIMENTO: ehRev ? nulo(corta(d.avCor, 190)) : null,
      PUXADOR: null, ACABAMENTO_PUXADOR: null, COR_PUXADOR: null, TAM_PUXADOR: 0, USINAGEM_PUXADOR: null, TIPO_PUXADOR: null, QTD_PUXADOR: 0, POSICAO_PUXADOR: null,
      DIVISOR: null, ACABAMENTO_DIVISOR: null, COR_DIVISOR: null, QTD_HORIZONTAL: 0, QTD_VERTICAL: 0, TAM_DIV_HORIZONTAL: 0, TAM_DIV_VERTICAL: 0,
      OBS: nulo(corta(item.obs, 2000)), UNITARIO: valor, TOTAL: totalItem });
    return;
  }
  let numFolha = 1;
  for (const g of p.grupos) {
    const f = g.folha;
    if (g.vidro && tipo === 'Pedido') {
      await inserir(conn, 'vidros', { id: null, MEDICAO: medicao, ITEM: n, NUMERO: numero, QTD: g.qtd, MODELO: f.revestimento, COR_REVESTIMENTO: f.corRevestimento,
        TAMANHO: `${g.vidro.altura}x${g.vidro.largura}`, M2: arred2(g.vidro.altura * g.vidro.largura / 1000000) });
    }
    await inserir(conn, 'ped_orc_itens_v4', { TIPO: tipo, NUMERO: numero, TIPO_PRODUTO: linha.tipoProduto, ITEM_PEDIDO: n, ITEM: numFolha, PORTA: `Folha ${numFolha}`,
      QTD: g.qtd, ALTURA: f.altura, LARGURA: f.largura, ALTURA_VAO: ehCorrer ? f.alturaVao : 0, LARGURA_VAO: ehCorrer ? f.larguraVao : 0,
      PERFIL: nulo(f.perfil), ACABAMENTO_PERFIL: nulo(f.acabPerfil), COR_PERFIL: nulo(f.corPerfil), USINAGEM_PERFIL: nulo(f.usinagemPerfil),
      REVESTIMENTO: nulo(f.revestimento), COR_REVESTIMENTO: nulo(f.corRevestimento), PUXADOR: nulo(f.puxador), ACABAMENTO_PUXADOR: nulo(f.acabPuxador),
      COR_PUXADOR: nulo(f.corPuxador), TAM_PUXADOR: Math.round(f.tamanhoPuxador), USINAGEM_PUXADOR: nulo(f.usinagemPuxador), TIPO_PUXADOR: nulo(f.tipoPuxador),
      QTD_PUXADOR: f.qtdPuxador, POSICAO_PUXADOR: nulo(f.posicaoPuxador), DIVISOR: nulo(f.divisor), ACABAMENTO_DIVISOR: nulo(f.acabDivisor), COR_DIVISOR: nulo(f.corDivisor),
      QTD_HORIZONTAL: f.qtdDivH, QTD_VERTICAL: f.qtdDivV, TAM_DIV_HORIZONTAL: f.tamDivH, TAM_DIV_VERTICAL: f.tamDivV,
      OBS: nulo(corta(f.obs, 2000)), UNITARIO: valor, TOTAL: arred2(valor * g.qtd) });
    if (g.perfil && tipo === 'Pedido') {
      await inserir(conn, 'perfis', { ITEM: n, DATA: hojeLocal(), NUMERO: numero, QTD_PORTAS: g.qtd, PERFIL: f.perfil,
        QTD_ALTURA: g.perfil.qtdAltura, TAM_ALTURA: g.perfil.tamAltura, QTD_LARGURA: g.perfil.qtdLargura, TAM_LARGURA: g.perfil.tamLargura,
        PUXADOR: nulo(f.puxador), QTD_PUXADOR: f.qtdPuxador, TAM_PUXADOR: f.tamanhoPuxador });
    }
    let furo = 1;
    for (const tam of f.furos) {
      await inserir(conn, 'furacao_pedidos_orcamentos', { NUMERO: numero, TIPO: tipo, ITEM: n, FURO: furo++, LADO: f.posicaoFuros || 'Esquerdo', TAMANHO: Math.round(tam) });
    }
    numFolha++;
  }
  let k = 1;
  for (const a of p.acessorios) {
    await inserir(conn, 'ped_orc_complementos', { TIPO: tipo, NUMERO: numero, ITEM_PEDIDO: n, ITEM: k++, QTD: a.qtd, COMPLEMENTO: a.nome,
      TAMANHO: Math.round(a.tamanho || 0), UNITARIO: a.valorUnitario });
  }
}

// sistema_correr + itens + config para o nº de folhas (CarregarDadosProdutos.BuscarItensSistemaCorrer / BuscarConfigSistemaCorrer)
async function lerSistemaCorrer(db, nome, folhas) {
  const [sis] = await db.execute('SELECT NOME, DESCONTO_ALTURA FROM sistema_correr WHERE NOME = ? LIMIT 1', [nome]);
  if (!sis.length) return null;
  const [itens] = await db.execute('SELECT MODELO, QTD, MULTIPLICADOR, CLASSE FROM itens_sistema_correr WHERE NOME = ? ORDER BY ID', [nome]);
  const [cfg] = await db.execute('SELECT QTD_TRILHO_SUP, QTD_TRILHO_INF FROM config_sistema_correr WHERE NOME = ? AND QTD_PORTAS = ? LIMIT 1', [nome, folhas]);
  return {
    descontoAltura: parseFloat(sis[0].DESCONTO_ALTURA) || 0,
    itens: itens.map(i => ({ modelo: i.MODELO, qtd: i.QTD, multiplicador: i.MULTIPLICADOR, classe: i.CLASSE })),
    config: cfg.length ? { qtdTrilhoSup: cfg[0].QTD_TRILHO_SUP ?? 1, qtdTrilhoInf: cfg[0].QTD_TRILHO_INF ?? 1 } : null
  };
}

function registrarPedOrc({ rota, pool }) {
  const leitor = criarLeitor(pool);

  rota('get', '/ped_orc/acessorios_permitidos', ['orcamentos.criar'], async (req, res) => {
    try {
      const cliente = (await lerCliente(pool, { clienteCodigo: req.query.clienteCodigo })) || SEM_CLIENTE;
      const [rows] = await pool.execute('SELECT MODELO FROM acessorios_permitidos WHERE TIPO_PRODUTO = ? ORDER BY MODELO ASC', [String(req.query.tipo || '')]);
      const lista = [];
      for (const r of rows) lista.push({ nome: r.MODELO, valorUnitario: arred2(precoAcessorio(await leitor.produto(r.MODELO), cliente, 'MANUAL')) });
      res.json(semValores(req, lista, ['valorUnitario']));
    } catch (err) {
      console.error('Erro GET /ped_orc/acessorios_permitidos:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('get', '/ped_orc/sistema_correr', ['orcamentos.criar'], async (req, res) => {
    try {
      const folhas = Math.max(1, parseInt(req.query.folhas) || 2);
      const sis = await lerSistemaCorrer(pool, String(req.query.nome || ''), folhas);
      if (!sis) return res.status(404).json({ error: 'Sistema de correr não encontrado.' });
      const cliente = (await lerCliente(pool, { clienteCodigo: req.query.clienteCodigo })) || SEM_CLIENTE;
      const lista = acessoriosDoSistema(sis.itens, sis.config, {
        larguraVao: parseFloat(req.query.larguraVao) || 0, folhas, incluirDesempenador: req.query.desempenador === '1' });
      const acessorios = [];
      for (const a of lista) acessorios.push({ ...a, valorUnitario: arred2(precoAcessorio(await leitor.produto(a.nome), cliente, 'SISTEMA DE CORRER')) });
      res.json(semValores(req, {
        descontoAltura: sis.descontoAltura,
        temDesempenador: sis.itens.some(i => i.classe === 'Desempenador'),
        acessorios
      }, ['valorUnitario']));
    } catch (err) {
      console.error('Erro GET /ped_orc/sistema_correr:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  // Salvar_Ped_Orc_Blindado: novo número ou atualizar, tudo numa transação
  rota('post', '/ped_orc/salvar', ['orcamentos.criar', 'orcamentos.salvar', 'valores.ver'], async (req, res) => {
    const b = req.body || {};
    if (b.tipo === 'Pedido' && !req.acesso.permissoes.has('pedidos.criar'))
      return res.status(403).json({ error: 'Sem permissão para salvar como pedido.', faltando: ['pedidos.criar'] });
    const erro = validar(b);
    if (erro) return res.status(400).json({ error: erro });

    let cliente, preparados = [];
    try {
      cliente = await lerCliente(pool, { clienteCodigo: b.clienteCodigo });
      if (!cliente) return res.status(400).json({ error: 'Favor selecionar um cliente!' });
      for (let i = 0; i < b.itens.length; i++) preparados.push(await prepararItem(pool, leitor, cliente, b.itens[i], i + 1));
    } catch (err) {
      if (err instanceof ErroItem) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      console.error('Erro POST /ped_orc/salvar (preparo):', err.message);
      return res.status(500).json({ error: 'Erro de servidor' });
    }
    // o preço que a tela mostrou precisa ser o mesmo que o servidor calcula agora
    const mudaram = preparados.filter(p => Math.abs(p.valor - (parseFloat(p.item.valorTela) || 0)) > 0.01).map(p => p.n - 1);
    if (mudaram.length) return res.status(409).json({ erro: 'preco_mudou', itens: mudaram,
      error: 'O preço de um ou mais itens mudou desde o cálculo. Confira e recalcule.' });

    const subTotal = arred2(preparados.reduce((s, p) => s + p.totalItem, 0));
    // cliente com desconto fixo já tem o desconto no preço (a tela trava o desconto geral)
    const descontoPct = cliente.isFixo && cliente.desconto > 0 ? 0 : Math.min(100, Math.max(0, parseFloat(b.descontoPct) || 0));
    const total = arred2(subTotal * (100 - descontoPct) / 100);
    const tipo = b.tipo;
    const cab = {
      RAZAO_SOCIAL: cliente.razaoSocial, CLIENTE_FINAL: corta(b.clienteFinal, 190), DATA: agoraLocal(),
      DATA_PRONTO: tipo === 'Pedido' ? b.dataEntrega : hojeLocal(), SUB_TOTAL: subTotal, DESCONTO: descontoPct, TOTAL: total,
      OBS_GERAL: corta(b.obsGeral, 5000), SITUACAO: tipo === 'Pedido' ? b.situacao : 'Aguardando resposta',
      FINANCEIRO: tipo === 'Pedido' ? b.financeiro : '', REPRESENTANTE: cliente.representante, DATA_ENTREGA: null
    };

    const resultado = await emTransacao(pool, res, 'POST /ped_orc/salvar', async conn => {
      let numero;
      if (b.modo === 'atualizar') {
        numero = b.numero;
        const [existe] = await conn.execute('SELECT id FROM ped_orc WHERE NUMERO = ? AND TIPO = ? FOR UPDATE', [numero, tipo]);
        if (!existe.length) throw new ErroUsuario(404, `${tipo} nº ${numero} não encontrado. Salve com novo número.`);
        const cols = Object.keys(cab);
        await conn.execute(`UPDATE ped_orc SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE NUMERO = ? AND TIPO = ?`, [...cols.map(c => cab[c]), numero, tipo]);
        for (const tabela of TABELAS_ITENS) await conn.execute(`DELETE FROM ${tabela} WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
        // vidros/perfis não têm TIPO: só o pedido mexe neles (spec §5.5)
        if (tipo === 'Pedido') for (const tabela of ['vidros', 'perfis']) await conn.execute(`DELETE FROM ${tabela} WHERE NUMERO = ?`, [numero]);
      } else {
        // Contar_Ped_Orc: maior número do tipo + 1; se o VB pegar o mesmo número no mesmo instante, tenta o seguinte
        for (let tentativa = 1; ; tentativa++) {
          // FOR UPDATE: leitura com trava enxerga o que já foi gravado (a leitura comum do InnoDB repetiria a foto do início)
          const [[m]] = await conn.execute('SELECT MAX(NUMERO) AS m FROM ped_orc WHERE TIPO = ? FOR UPDATE', [tipo]);
          numero = (parseInt(m?.m) || 0) + 1;
          try { await inserir(conn, 'ped_orc', { TIPO: tipo, NUMERO: numero, ...cab }); break; }
          catch (err) {
            if (!ehDuplicado(err)) throw err;
            if (tentativa >= 3) throw new ErroUsuario(409, 'Não foi possível reservar um número. Tente de novo.');
          }
        }
      }
      for (const p of preparados) await gravarItem(conn, { tipo, numero, medicao: cliente.medicao }, p);
      return { numero };
    });
    if (resultado) res.json({ ok: true, tipo, numero: resultado.numero });
  });
}

module.exports = { registrarPedOrc, lerSistemaCorrer };
