// ==========================================================================
// Orçamentos e pedidos — gravação igual ao VB (ModPedOrc.Gravar_Pedido_Com_DNA_Transacional)
// e listas de apoio da tela (acessórios permitidos, itens do sistema de correr).
// ==========================================================================
const { semValores } = require('../seguranca/valores');
const { criarLeitor, lerCliente, precoAcessorio, valoresAcessorio, precoComAcessorios, precoSerralheria, fatorHistorico, ErroPreco } = require('../calculo/precos');
const { larguraRealDoVao, acessoriosDoSistema, folhasDoItem, agruparFolhas, medidasVidro, medidasPerfil, exigePerfil, temSistemaCorrer, ErroEngenharia } = require('../calculo/engenharia');
const { linhaComercial } = require('../calculo/linhas_vb');
const express = require('express');
const { validarPng } = require('../calculo/png');
const { traduzirDocumento, impressaoDigital, carimboItens } = require('../calculo/leitura_vb');
const { emTransacao, ErroUsuario, ehDuplicado, agoraLocal, hojeLocal, validarData } = require('./estoque_movimentos');
const { liberarPlanosDoPedido } = require('./corte');
const { liberarPlanosVidroDoPedido } = require('./corte_vidros');

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

// tabelas do documento: nome no banco → chave em Linhas (calculo/leitura_vb.js)
const TABELAS_DOC = { ped_orc_lista_itens: 'lista', ped_orc_itens_v4: 'itensV4', ped_orc_complementos: 'complementos', furacao_pedidos_orcamentos: 'furacao',
  ped_orc_serralheria: 'serralheria', ped_orc_serralheria_complementos: 'serralheriaComp' };
const MSG_SEM_ACESSO = 'Sem acesso a este documento.';
const MSG_ALTERADO = 'Este documento foi alterado por outra pessoa desde que você abriu. Recarregue para ver a versão atual.';
// itens abertos que o servidor copia do banco (a tela só diz qual item e o estado)
const ESTADOS_COPIA = ['intacto', 'so_pct', 'travado'];
const ehCopia = it => !!it && !!it.origem && ESTADOS_COPIA.includes(it.origem.estado);
// coluna que guarda o nº do item em cada tabela (Linhas → tabela no banco)
const COPIA_TABELAS = [['lista', 'ped_orc_lista_itens', 'ITEM'], ['itensV4', 'ped_orc_itens_v4', 'ITEM_PEDIDO'], ['complementos', 'ped_orc_complementos', 'ITEM_PEDIDO'],
  ['furacao', 'furacao_pedidos_orcamentos', 'ITEM'], ['serralheria', 'ped_orc_serralheria', 'ITEM_PEDIDO'],
  ['serralheriaComp', 'ped_orc_serralheria_complementos', 'ITEM_PEDIDO'], ['vidros', 'vidros', 'ITEM'], ['perfis', 'perfis', 'ITEM']];
// usuário com estados (representante) só mexe em clientes desses estados
const foraDosEstados = (req, estado) => {
  const estados = req.acesso?.estados || [];
  return estados.length > 0 && !estados.includes(String(estado || '').trim().toUpperCase());
};

// Todas as linhas de um documento (Carregar_Pedido_Com_DNA). travar: FOR UPDATE no cabeçalho (dentro de transação).
async function lerDocumento(db, tipo, numero, { travar = false } = {}) {
  const [cab] = await db.execute(`SELECT * FROM ped_orc WHERE NUMERO = ? AND TIPO = ?${travar ? ' FOR UPDATE' : ''}`, [numero, tipo]);
  if (!cab.length) return null;
  const linhas = { cab: cab[0], vidros: [], perfis: [] };
  for (const [tabela, chave] of Object.entries(TABELAS_DOC)) [linhas[chave]] = await db.execute(`SELECT * FROM ${tabela} WHERE NUMERO = ? AND TIPO = ? ORDER BY id`, [numero, tipo]);
  // vidros/perfis não têm TIPO: só pertencem ao pedido (spec da parte 1, §5.5)
  if (tipo === 'Pedido') for (const t of ['vidros', 'perfis']) [linhas[t]] = await db.execute(`SELECT * FROM ${t} WHERE NUMERO = ? ORDER BY id`, [numero]);
  return linhas;
}

// sistemas de correr citados nas descrições ("Sist: X") — a tradução precisa do desconto e dos itens de cada um
async function sistemasDoDocumento(db, linhas) {
  const sistemas = {};
  for (const l of linhas.lista) {
    const m = /Sist:\s*([^|]*?)\s*(\||$)/.exec(String(l.DESCRICAO || ''));
    if (!m || !m[1] || m[1] === 'Sem sistema' || sistemas[m[1]]) continue;
    const s = await lerSistemaCorrer(db, m[1], 2);
    if (s) sistemas[m[1]] = { descontoAltura: s.descontoAltura, itens: s.itens };
  }
  return sistemas;
}

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
  const copias = b.itens.filter(ehCopia);
  if (copias.length) {
    const od = b.origemDocumento;
    if (b.modo === 'novo' && !(od && od.tipo === b.tipo && Number.isInteger(od.numero) && od.numero > 0)) return 'Documento de origem não informado.';
    if (typeof b.impressao !== 'string' || !b.impressao) return 'Documento de origem não informado.';
  }
  for (const [i, it] of b.itens.entries()) {
    if (ehCopia(it)) {
      if (!(Number.isInteger(it.origem.item) && it.origem.item > 0)) return `Item ${i + 1}: origem inválida.`;
      continue;
    }
    if (!it || typeof it !== 'object' || typeof it.detalhes !== 'object') return 'Item inválido.';
    const q = Number(it.qtd);
    if (!(Number.isInteger(q) && q >= 1 && q <= MAX_QTD_ITEM)) return `Item ${i + 1}: quantidade inválida (1 a ${MAX_QTD_ITEM}).`;
  }
  return null;
}

// Peças do conjunto de serralheria (frmSerralheria.listaItens); sem `pecas`, o próprio item é a única peça (forma antiga)
const MAX_PECAS_SERR = 50;
function pecasDoItem(item) {
  const d = item.detalhes || {};
  const lista = Array.isArray(item.pecas) && item.pecas.length ? item.pecas.slice(0, MAX_PECAS_SERR)
    : [{ produto: d.produto, material: d.material, acabSerr: d.acabSerr, corSerr: d.corSerr, altura: item.altura, largura: item.largura,
      profundidade: item.profundidade, soldas: item.soldas, qtdAltura: item.qtdAltura, qtdLargura: item.qtdLargura, qtdProfundidade: item.qtdProfundidade }];
  return lista.map(p => ({ produto: corta(p && p.produto, 190), material: corta(p && p.material, 190), acabSerr: corta(p && p.acabSerr, 190), corSerr: corta(p && p.corSerr, 190),
    altura: parseFloat(p && p.altura) || 0, largura: parseFloat(p && p.largura) || 0, profundidade: parseFloat(p && p.profundidade) || 0,
    soldas: Math.max(0, parseInt(p && p.soldas) || 0), qtdAltura: p && p.qtdAltura, qtdLargura: p && p.qtdLargura, qtdProfundidade: p && p.qtdProfundidade }));
}

// Item da tela → entrada do motor de preço (mesmos campos que a tela manda ao /calcular_preco)
function entradaPreco(item, folhas) {
  const d = item.detalhes || {};
  if (item.frente === 'Serralheria') return { frente: 'Serralheria', produto: d.produto, qtd: item.qtd,
    pecas: pecasDoItem(item).map(p => ({ ...p, acabamento: p.acabSerr })) };
  if (item.frente === 'Avulso') return { frente: 'Avulso', categoria: d.categoria, produto: d.avProduto,
    acabamento: ['Perfil', 'Trilhos', 'Puxador'].includes(d.categoria) ? d.avAcab : '', altura: item.altura, largura: item.largura, qtd: item.qtd };
  // cada folha com a sua largura e a sua posição do puxador (as mesmas que a gravação escreve por linha de itens_v4);
  // folhas que dão a mesma conta seguem o preço de uma porta × qtd (calculo/precos.js)
  const f = folhas[0] || {};
  return { frente: item.frente, altura: f.altura, largura: f.largura, qtd: folhas.length,
    largurasFolhas: folhas.map(x => x.largura), posicoesFolhas: folhas.map(x => x.posicaoPuxador || ''),
    perfil: d.perfil, acabPerfil: d.acabamento, puxador: d.puxador, acabPuxador: d.acabPux, tipoPuxador: d.tipoPuxador,
    posicaoPuxador: f.posicaoPuxador || '', tamanhoPuxador: d.tamanhoPux, revestimento: d.revestimento,
    divisor: d.divisor, qtdDivH: parseInt(d.divH) || 0, qtdDivV: parseInt(d.divV) || 0 };
}

// Folhas iguais agrupadas, com as medidas do vidro e do perfil já descontadas (as mesmas que o pedido grava em `vidros` e `perfis`).
// Usada pela gravação (prepararItem) e pela consulta de peso (rotas/peso_itens.js): uma só montagem.
async function gruposDoItem(leitor, item, folhas, n) {
  const grupos = [];
  for (const g of agruparFolhas(folhas)) {
    const f = g.folha;
    if (exigePerfil(item.frente) && !f.perfil) throw new ErroItem(422, `Item ${n}: Perfil não informado.`, { item: n });
    const perfil = f.perfil ? await leitor.produto(f.perfil) : null;
    if (f.perfil && !perfil && exigePerfil(item.frente)) throw new ErroItem(422, `Item ${n}: Dados do perfil não encontrados.`, { item: n });
    const puxador = f.puxador ? await leitor.produto(f.puxador) : null;
    if (f.puxador && !puxador) throw new ErroItem(422, `Item ${n}: Dados do puxador não encontrados.`, { item: n });
    try { grupos.push({ folha: f, qtd: g.qtd, vidro: medidasVidro(f, perfil, puxador), perfil: f.perfil ? medidasPerfil(f, puxador) : null }); }
    catch (err) { if (err instanceof ErroEngenharia) throw new ErroItem(422, `Item ${n}: ${err.message}`, { item: n }); throw err; }
  }
  return grupos;
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
      const larguraVao = larguraRealDoVao(item, folhasDoItem(item, { descontoAlturaSistema: sis.descontoAltura }));
      const doSistema = acessoriosDoSistema(sis.itens, sis.config, { larguraVao, folhas: n0, incluirDesempenador: !!d.desempenador });
      // trilhos: o usuário pode reduzir a quantidade (1 até o que a tabela do sistema dá para este nº de portas), nunca aumentar
      const reduzidos = new Map();
      for (const a of Array.isArray(item.acessorios) ? item.acessorios : []) {
        if (a && a.origem === 'SISTEMA DE CORRER' && !reduzidos.has(a.nome)) reduzidos.set(a.nome, parseInt(a.qtd));
      }
      acessorios = [...doSistema.map(a => {
        const pedida = reduzidos.get(a.nome);
        const ehTrilho = /TRILHO/i.test(`${a.classe || ''} ${a.nome}`);
        const qtd = ehTrilho && pedida >= 1 ? Math.min(a.qtd, pedida) : a.qtd;
        return { nome: a.nome, qtd, tamanho: a.tamanho, origem: 'SISTEMA DE CORRER' };
      }), ...acessorios];
    }
    folhas = folhasDoItem(item, { descontoAlturaSistema });
  }
  let preco;
  const complementosSerr = item.frente === 'Serralheria' ? (Array.isArray(item.complementos) ? item.complementos : []).slice(0, 100)
    .map(c => ({ id: Number(c && c.id), qtd: Math.min(99999, Math.max(0, parseFloat(c && c.qtd) || 0)) })) : [];
  try {
    preco = item.frente === 'Serralheria'
      ? await precoSerralheria(entradaPreco(item, folhas), cliente, leitor, complementosSerr)
      : await precoComAcessorios(entradaPreco(item, folhas), cliente, leitor, acessorios);
  }
  catch (err) { if (err instanceof ErroPreco) throw new ErroItem(422, `Item ${n}: ${err.message}`, { item: n }); throw err; }
  const historico = corta(item.historico, 500);
  const valor = arred2(preco.unitario * fatorHistorico(historico));
  const qtdTela = Math.max(1, parseInt(item.qtd) || 1);
  const r = { item, n, historico, valor, totalItem: arred2(valor * qtdTela), acessorios: preco.acessorios || [], folhas, grupos: [],
    fator: fatorHistorico(historico), pecasSerr: preco.pecas, pecasDetalhe: preco.pecasDetalhe || [], complementosSerr: preco.complementos || [] };

  if (ehPorta) {
    for (const f of folhas) f.valorUnitario = valor;
    r.grupos = await gruposDoItem(leitor, item, folhas, n);
  }
  r.linha = linhaComercial(item, { folhas, acessorios: preco.acessorios });
  return r;
}

// Linhas de um item do documento de origem, como estão no banco
function linhasDoItem(src, origemItem) {
  const r = {};
  for (const [chave, , coluna] of COPIA_TABELAS) r[chave] = (src[chave] || []).filter(l => Number(l[coluna]) === origemItem);
  return r;
}

// "só %": nova porcentagem sobre o valor original salvo (UNITARIO ÷ fator da % antiga), como o MotorPercentual do VB
function aplicarSoPct(linhas, historico) {
  const l0 = linhas.lista[0];
  const fator = fatorHistorico(historico) / (fatorHistorico(l0.PORCENTAGEM) || 1);
  const novo = v => arred2((parseFloat(v) || 0) * fator);
  linhas.lista = linhas.lista.map(l => { const u = novo(l.UNITARIO); return { ...l, PORCENTAGEM: historico, UNITARIO: u, TOTAL: arred2(u * (parseFloat(l.QTD) || 0)) }; });
  linhas.itensV4 = linhas.itensV4.map(l => { const u = novo(l.UNITARIO); return { ...l, UNITARIO: u, TOTAL: arred2(u * (parseFloat(l.QTD) || 0)) }; });
  return linhas;
}

// Copia as linhas de um item para o documento/nº de item de destino (id novo; vidros/perfis só em pedido)
async function gravarCopia(conn, linhas, { tipo, numero, n, origemItem }) {
  for (const [chave, tabela, coluna] of COPIA_TABELAS) {
    if ((chave === 'vidros' || chave === 'perfis') && tipo !== 'Pedido') continue;
    for (const l of linhas[chave]) {
      const nova = Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'id' && k !== 'ID'));
      nova.NUMERO = numero;
      if ('TIPO' in nova) nova.TIPO = tipo;
      nova[coluna] = n;
      if (chave === 'serralheriaComp' && Number(nova.ITEM_SERRALHERIA) === origemItem) nova.ITEM_SERRALHERIA = n;
      await inserir(conn, tabela, nova);
    }
  }
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
    // ProcessarSerralheriaNoBanco: uma linha por peça (ITEM 1..n), com o valor da própria peça;
    // com complementos (ou várias peças), a linha da peça leva só o valor dela (os complementos vão para a tabela deles)
    const comps = p.complementosSerr;
    const qtdEixo = v => Math.max(1, parseInt(v) || 1);
    const pecas = pecasDoItem(item);
    const valorProprio = !comps.length && pecas.length === 1;
    for (const [i, pc] of pecas.entries()) {
      const totalPeca = (p.pecasDetalhe[i] || {}).total || 0;
      await inserir(conn, 'ped_orc_serralheria', { TIPO: tipo, NUMERO: numero, ITEM_PEDIDO: n, ITEM: i + 1, QTD_ITENS: linha.qtd,
        PRODUTO: corta(pc.produto, 190), MATERIAL: corta(pc.material, 190), ACABAMENTO: corta(pc.acabSerr, 190), COR: corta(pc.corSerr, 190),
        QTD_ALTURA: qtdEixo(pc.qtdAltura), ALTURA: Math.round(pc.altura), QTD_LARGURA: qtdEixo(pc.qtdLargura), LARGURA: Math.round(pc.largura),
        QTD_PROFUNDIDADE: qtdEixo(pc.qtdProfundidade), PROFUNDIDADE: Math.round(pc.profundidade), QTD_SOLDAS: pc.soldas,
        UNITARIO: valorProprio ? valor : arred2(totalPeca / linha.qtd * p.fator), TOTAL: valorProprio ? totalItem : arred2(totalPeca * p.fator), OBS: corta(item.obs, 2000) });
    }
    // frmSerralheria.EnviarParaPedido: complementos com a % do item aplicada no valor unitário
    let sub = 1;
    for (const c of comps) {
      const vu = arred2(c.valorUnitario * p.fator);
      await inserir(conn, 'ped_orc_serralheria_complementos', { TIPO: tipo, NUMERO: numero, ITEM_PEDIDO: n, ITEM_SERRALHERIA: n, SUB_ITEM: sub++,
        TIPO_COMPONENTE: corta(c.tipo, 190), DESCRICAO: corta(c.descricao, 190), UNIDADE: corta(c.unidade, 10), QUANTIDADE: c.qtd, VALOR_UNITARIO: vu, VALOR_TOTAL: arred2(vu * c.qtd) });
    }
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
      TAMANHO: Math.round(a.tamanho || 0), UNITARIO: a.valorTabela });
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
      for (const a of lista) acessorios.push({ ...a, ...valoresAcessorio(await leitor.produto(a.nome), cliente, a) });
      res.json(semValores(req, {
        descontoAltura: sis.descontoAltura,
        temDesempenador: sis.itens.some(i => i.classe === 'Desempenador'),
        acessorios
      }, ['valorTabela', 'valorUnitario', 'valorTotal']));
    } catch (err) {
      console.error('Erro GET /ped_orc/sistema_correr:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('get', '/ped_orc/serralheria_componentes', ['orcamentos.criar'], async (req, res) => {
    try {
      res.json(semValores(req, await leitor.componentesSerralheria(String(req.query.produto || '')), ['valorUnitario']));
    } catch (err) {
      console.error('Erro GET /ped_orc/serralheria_componentes:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('get', '/ped_orc/buscar', ['pedidos.ver', 'orcamentos.criar'], async (req, res) => {
    try {
      const tipo = req.query.tipo === 'Pedido' ? 'Pedido' : 'Orçamento';
      const q = String(req.query.q || '').trim().slice(0, 100);
      const estados = req.acesso?.estados || [];
      const params = [tipo];
      let filtro = '';
      if (/^\d+$/.test(q)) { filtro += ' AND p.NUMERO = ?'; params.push(Number(q)); }
      else if (q) { filtro += ' AND (p.RAZAO_SOCIAL LIKE ? OR p.CLIENTE_FINAL LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      if (estados.length) { filtro += ` AND c.ESTADO IN (${estados.map(() => '?').join(',')})`; params.push(...estados); }
      const [rows] = await pool.execute(
        `SELECT p.TIPO AS tipo, p.NUMERO AS numero, p.RAZAO_SOCIAL AS cliente, DATE_FORMAT(p.DATA, '%d/%m/%Y') AS data, p.CLIENTE_FINAL AS clienteFinal
         FROM ped_orc p ${estados.length ? 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL' : ''}
         WHERE p.TIPO = ?${filtro} ORDER BY p.NUMERO DESC LIMIT 20`, params);
      res.json(rows);
    } catch (err) {
      console.error('Erro GET /ped_orc/buscar:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('get', '/ped_orc/:tipo/:numero', ['pedidos.ver', 'orcamentos.criar', 'valores.ver'], async (req, res) => {
    const tipo = req.params.tipo, numero = Number(req.params.numero);
    if (!TIPOS.includes(tipo) || !(Number.isInteger(numero) && numero > 0)) return res.status(400).json({ error: 'Documento inválido.' });
    try {
      const linhas = await lerDocumento(pool, tipo, numero);
      if (!linhas) return res.status(404).json({ error: `${tipo} nº ${numero} não encontrado.` });
      const [cli] = await pool.execute('SELECT CODIGO, ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [linhas.cab.RAZAO_SOCIAL]);
      if (foraDosEstados(req, cli[0]?.ESTADO)) return res.status(403).json({ error: MSG_SEM_ACESSO });
      const componentesSerr = {};
      for (const s of linhas.serralheria) if (!componentesSerr[s.PRODUTO]) componentesSerr[s.PRODUTO] = await leitor.componentesSerralheria(s.PRODUTO);
      const { cabecalho, itens } = traduzirDocumento(linhas, { sistemas: await sistemasDoDocumento(pool, linhas), componentesSerr });
      const p = req.acesso.permissoes;
      res.json({ cabecalho: { ...cabecalho, clienteCodigo: cli[0]?.CODIGO ?? null }, itens, impressao: impressaoDigital(linhas, tipo),
        podeEditar: p.has('orcamentos.salvar') && (tipo === 'Orçamento' || p.has('pedidos.criar')) });
    } catch (err) {
      console.error('Erro GET /ped_orc/:tipo/:numero:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  // Desenho da porta (PNG capturado na tela ao configurar o item) para a coluna Imagem do PDF. Sobe depois do salvar, separado do JSON
  // (o corpo do salvar é limitado a 100 kb). Guarda o carimbo do documento: se o VB mudar os itens depois, o PDF deixa de usar a imagem.
  const LIMITE_DESENHO = 150 * 1024;
  // erro do leitor de corpo (grande demais, etc.) vira JSON, não a página HTML padrão do Express
  const lerPng = (req, res, next) => express.raw({ type: 'image/png', limit: LIMITE_DESENHO })(req, res, err => {
    if (err) return res.status(err.status === 413 ? 413 : 400).json({ error: 'Desenho inválido ou maior que 150 kb.' });
    next();
  });
  rota('put', '/ped_orc/:tipo/:numero/desenho/:item', ['orcamentos.criar', 'orcamentos.salvar'], lerPng, async (req, res) => {
      const tipo = req.params.tipo, numero = Number(req.params.numero), item = Number(req.params.item);
      if (!TIPOS.includes(tipo) || !(Number.isInteger(numero) && numero > 0) || !(Number.isInteger(item) && item > 0)) return res.status(400).json({ error: 'Documento ou item inválido.' });
      const png = req.body;
      // não basta a assinatura: o pdfkit decodifica o PNG de forma assíncrona e uma exceção ali derruba o servidor (ver calculo/png.js)
      const v = validarPng(png);
      if (!v.ok) return res.status(400).json({ error: 'Envie o desenho como imagem PNG válida.' });
      try {
        const linhas = await lerDocumento(pool, tipo, numero);
        const naoAchou = () => res.status(404).json({ error: 'Item não encontrado.' });
        if (!linhas || !linhas.lista.some(l => Number(l.ITEM) === item)) return naoAchou();
        if ((req.acesso?.estados || []).length) {
          const [cli] = await pool.execute('SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [linhas.cab.RAZAO_SOCIAL]);
          if (foraDosEstados(req, cli[0]?.ESTADO)) return res.status(403).json({ error: MSG_SEM_ACESSO });
        }
        await pool.execute(
          `INSERT INTO web_item_desenhos (tipo, numero, item, png, carimbo, criado_em) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE png = VALUES(png), carimbo = VALUES(carimbo), criado_em = VALUES(criado_em)`,
          [tipo, numero, item, png, carimboItens(linhas), agoraLocal()]);
        res.json({ ok: true });
      } catch (err) {
        console.error('Erro PUT /ped_orc/desenho:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
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
      if (foraDosEstados(req, cliente.estado)) return res.status(403).json({ error: MSG_SEM_ACESSO });
      for (let i = 0; i < b.itens.length; i++) {
        const it = b.itens[i];
        preparados.push(ehCopia(it)
          ? { copia: true, item: it, n: i + 1, estado: it.origem.estado, origemItem: it.origem.item, historico: corta(it.historico, 500) }
          : await prepararItem(pool, leitor, cliente, it, i + 1));
      }
    } catch (err) {
      if (err instanceof ErroItem) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      console.error('Erro POST /ped_orc/salvar (preparo):', err.message);
      return res.status(500).json({ error: 'Erro de servidor' });
    }
    // preço da tela diferente do que o servidor calcula agora: NÃO impede o salvamento (grava o do servidor) e volta só como aviso
    const mudaram = preparados.filter(p => !p.copia && Math.abs(p.valor - (parseFloat(p.item.valorTela) || 0)) > 0.01).map(p => p.n);

    // cliente com desconto fixo já tem o desconto no preço (a tela trava o desconto geral)
    // desconto adicional (txt_Desconto_Adicional do VB): sempre editável, por cima do desconto do cliente que já está nos itens
    const descontoPct = Math.min(100, Math.max(0, parseFloat(b.descontoPct) || 0));
    const tipo = b.tipo;

    const resultado = await emTransacao(pool, res, 'POST /ped_orc/salvar', async conn => {
      // documento de origem (atualizar, ou cópia a partir de um aberto): travado, conferido pela impressão digital
      const src = b.modo === 'atualizar' ? { tipo, numero: b.numero } : b.origemDocumento;
      let linhasSrc = null;
      if (src) {
        linhasSrc = await lerDocumento(conn, src.tipo, src.numero, { travar: true });
        if (!linhasSrc && b.modo === 'atualizar') throw new ErroUsuario(404, `${tipo} nº ${b.numero} não encontrado. Salve com novo número.`);
        if (!linhasSrc || (b.impressao && impressaoDigital(linhasSrc, src.tipo) !== b.impressao)) throw new ErroUsuario(409, MSG_ALTERADO, { erro: 'alterado' });
        // o documento de origem também precisa ser de um cliente dos estados do usuário (cópia ou atualização forjada)
        if ((req.acesso?.estados || []).length) {
          const [cli] = await conn.execute('SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [linhasSrc.cab.RAZAO_SOCIAL]);
          if (foraDosEstados(req, cli[0]?.ESTADO)) throw new ErroUsuario(403, MSG_SEM_ACESSO);
        }
      }
      // desenhos guardados do documento de origem, lidos ANTES de apagar; só valem se o carimbo ainda bate com os itens de origem
      let desenhosSrc = [];
      if (linhasSrc) {
        const carimboSrc = carimboItens(linhasSrc);
        [desenhosSrc] = await conn.execute('SELECT item, png, carimbo FROM web_item_desenhos WHERE tipo = ? AND numero = ?', [src.tipo, src.numero]);
        desenhosSrc = desenhosSrc.filter(d => d.carimbo === carimboSrc);
      }
      // itens copiados: linhas lidas ANTES de apagar
      for (const p of preparados.filter(x => x.copia)) {
        if (!linhasSrc.lista.some(l => Number(l.ITEM) === p.origemItem)) throw new ErroUsuario(400, `Item ${p.n}: não pertence a este documento.`);
        p.linhas = linhasDoItem(linhasSrc, p.origemItem);
        if (p.estado === 'so_pct') aplicarSoPct(p.linhas, p.historico);
        p.totalItem = arred2(p.linhas.lista.reduce((s, l) => s + (parseFloat(l.TOTAL) || 0), 0));
      }
      const subTotal = arred2(preparados.reduce((s, p) => s + p.totalItem, 0));
      const cab = {
        RAZAO_SOCIAL: cliente.razaoSocial, CLIENTE_FINAL: corta(b.clienteFinal, 190),
        DATA: b.modo === 'atualizar' && b.manterData && linhasSrc.cab.DATA ? linhasSrc.cab.DATA : agoraLocal(),
        DATA_PRONTO: tipo === 'Pedido' || validarData(b.dataEntrega) ? b.dataEntrega : hojeLocal(), SUB_TOTAL: subTotal, DESCONTO: descontoPct, TOTAL: arred2(subTotal * (100 - descontoPct) / 100),
        OBS_GERAL: corta(b.obsGeral, 5000), SITUACAO: tipo === 'Pedido' ? b.situacao : 'Aguardando resposta',
        FINANCEIRO: tipo === 'Pedido' ? b.financeiro : '', REPRESENTANTE: cliente.representante, DATA_ENTREGA: null
      };
      let numero;
      if (b.modo === 'atualizar') {
        numero = b.numero;
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
      // desenhos: o número é regravado por inteiro (apaga também sobras de um número reaproveitado)
      await conn.execute('DELETE FROM web_item_desenhos WHERE tipo = ? AND numero = ?', [tipo, numero]);
      for (const p of preparados) {
        if (p.copia) await gravarCopia(conn, p.linhas, { tipo, numero, n: p.n, origemItem: p.origemItem });
        else await gravarItem(conn, { tipo, numero, medicao: cliente.medicao }, p);
      }
      // item sem alteração leva o desenho do item de origem para a posição nova, com o carimbo do documento recém-gravado
      const comDesenho = preparados.filter(x => x.copia && desenhosSrc.some(d => Number(d.item) === x.origemItem));
      if (comDesenho.length) {
        const carimbo = carimboItens(await lerDocumento(conn, tipo, numero));
        for (const p of comDesenho) {
          const d = desenhosSrc.find(x => Number(x.item) === p.origemItem);
          await conn.execute('INSERT INTO web_item_desenhos (tipo, numero, item, png, carimbo, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
            [tipo, numero, p.n, d.png, carimbo, agoraLocal()]);
        }
      }
      return { numero };
    });
    if (resultado) res.json({ ok: true, tipo, numero: resultado.numero, ...(mudaram.length ? { avisos: { precoMudou: mudaram } } : {}) });
  });

  // ---- cancelar / excluir (a tela sempre pergunta antes; aqui só o servidor decide e registra) ----
  const auditarDoc = (conn, req, acao, tipo, numero, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || req.usuario?.nome || '', acao, `${tipo} ${numero}`, JSON.stringify(detalhe)]);
  // documento travado + conferência de estado do cliente; devolve as linhas ou lança ErroUsuario
  async function docParaAcao(conn, req, tipo, numero) {
    const linhas = await lerDocumento(conn, tipo, numero, { travar: true });
    if (!linhas) throw new ErroUsuario(404, `${tipo} nº ${numero} não encontrado.`);
    if ((req.acesso?.estados || []).length) {
      const [cli] = await conn.execute('SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [linhas.cab.RAZAO_SOCIAL]);
      if (foraDosEstados(req, cli[0]?.ESTADO)) throw new ErroUsuario(403, MSG_SEM_ACESSO);
    }
    return linhas;
  }
  const validarAlvo = (req, res) => {
    const tipo = req.params.tipo, numero = Number(req.params.numero);
    if (!TIPOS.includes(tipo) || !(Number.isInteger(numero) && numero > 0)) { res.status(400).json({ error: 'Documento inválido.' }); return null; }
    return { tipo, numero };
  };

  // cancelar: só pedido; a situação vira "Cancelado" (o documento e os itens continuam, como o VB)
  rota('post', '/ped_orc/:tipo/:numero/cancelar', ['pedidos.cancelar'], async (req, res) => {
    const alvo = validarAlvo(req, res); if (!alvo) return;
    if (alvo.tipo !== 'Pedido') return res.status(400).json({ error: 'Só pedidos podem ser cancelados. Orçamento: use Excluir.' });
    const r = await emTransacao(pool, res, 'POST /ped_orc/cancelar', async conn => {
      const linhas = await docParaAcao(conn, req, alvo.tipo, alvo.numero);
      const antes = String(linhas.cab.SITUACAO || '');
      if (antes === 'Cancelado') throw new ErroUsuario(409, `O pedido nº ${alvo.numero} já está cancelado.`);
      await conn.execute('UPDATE ped_orc SET SITUACAO = ? WHERE NUMERO = ? AND TIPO = ?', ['Cancelado', alvo.numero, alvo.tipo]);
      await liberarPlanosDoPedido(conn, alvo.numero, req.acesso?.nome || '');   // plano de corte: cancela o plano gerado e solta os retalhos reservados
      await liberarPlanosVidroDoPedido(conn, alvo.numero, req.acesso?.nome || '');   // plano de corte de vidros: idem
      await auditarDoc(conn, req, 'pedido_cancelado', alvo.tipo, alvo.numero, { cliente: linhas.cab.RAZAO_SOCIAL, situacaoAnterior: antes });
      return { ok: true };
    });
    if (r) res.json({ ok: true, tipo: alvo.tipo, numero: alvo.numero, situacao: 'Cancelado' });
  });

  // situação do ORÇAMENTO (menu do botão direito da lista): Fechado / Aguardando resposta, como "Alterar situação para..." do VB
  // (frm_Controle_de_Orçamentos). Registrada ANTES da rota genérica /ped_orc/:tipo/:numero/situacao, que é só de pedido.
  const SITUACOES_ORCAMENTO = ['Fechado', 'Aguardando resposta'];
  rota('post', '/ped_orc/orcamentos/:numero/situacao', ['orcamentos.salvar'], async (req, res) => {
    const numero = Number(req.params.numero);
    if (!(Number.isInteger(numero) && numero > 0)) return res.status(400).json({ error: 'Documento inválido.' });
    const nova = String((req.body || {}).situacao ?? '');
    if (!SITUACOES_ORCAMENTO.includes(nova)) return res.status(400).json({ error: `Situação inválida. Use: ${SITUACOES_ORCAMENTO.join(', ')}.` });
    const r = await emTransacao(pool, res, 'POST /ped_orc/orcamentos/situacao', async conn => {
      const linhas = await docParaAcao(conn, req, 'Orçamento', numero);
      const antes = String(linhas.cab.SITUACAO || '');
      if (antes === nova) throw new ErroUsuario(409, `O orçamento nº ${numero} já está "${nova}".`);
      await conn.execute('UPDATE ped_orc SET SITUACAO = ? WHERE NUMERO = ? AND TIPO = ?', [nova, numero, 'Orçamento']);
      await auditarDoc(conn, req, 'orcamento_situacao', 'Orçamento', numero, { cliente: linhas.cab.RAZAO_SOCIAL, de: antes, para: nova });
      return { ok: true };
    });
    if (r) res.json({ ok: true, tipo: 'Orçamento', numero, situacao: nova });
  });

  // mudar a situação do pedido (menu do botão direito da lista). Entregue/Retirado gravam DATA_ENTREGA = hoje, como Pedido_Entregue/Pedido_Retirado do VB;
  // sair de Entregue/Retirado limpa a data. Com `manterData: true` a DATA_ENTREGA que já está gravada NÃO é tocada (o usuário escolhe na tela).
  // Pedido Cancelado não muda por aqui. A fila de Entregas acompanha pela varredura (Pronto entra; sair de Pronto antes de agendar cancela).
  const SITUACOES_MUDAR = ['Em Produção', 'Pronto', 'Entregue', 'Retirado'];
  rota('post', '/ped_orc/:tipo/:numero/situacao', ['pedidos.situacao'], async (req, res) => {
    const alvo = validarAlvo(req, res); if (!alvo) return;
    if (alvo.tipo !== 'Pedido') return res.status(400).json({ error: 'Só pedidos têm situação (Em Produção, Pronto, Entregue, Retirado).' });
    const nova = String((req.body || {}).situacao ?? '');
    if (!SITUACOES_MUDAR.includes(nova)) return res.status(400).json({ error: `Situação inválida. Use: ${SITUACOES_MUDAR.join(', ')}.` });
    const manterData = (req.body || {}).manterData === true;
    // `usarDataPronto: true` (só Entregue/Retirado): a data de entrega passa a ser a data de pronto do pedido (DATA_PRONTO), não a de hoje
    const usarDataPronto = (req.body || {}).usarDataPronto === true && (nova === 'Entregue' || nova === 'Retirado');
    let dataEntrega = nova === 'Entregue' || nova === 'Retirado' ? hojeLocal() : null;
    const r = await emTransacao(pool, res, 'POST /ped_orc/situacao', async conn => {
      const linhas = await docParaAcao(conn, req, alvo.tipo, alvo.numero);
      const antes = String(linhas.cab.SITUACAO || '');
      if (antes === 'Cancelado') throw new ErroUsuario(409, `O pedido nº ${alvo.numero} está cancelado e não muda de situação.`);
      if (antes === nova) throw new ErroUsuario(409, `O pedido nº ${alvo.numero} já está "${nova}".`);
      if (usarDataPronto) {
        const pronto = String(linhas.cab.DATA_PRONTO ?? '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pronto)) throw new ErroUsuario(400, `O pedido nº ${alvo.numero} não tem data de pronto.`);
        dataEntrega = pronto;
        await conn.execute('UPDATE ped_orc SET SITUACAO = ?, DATA_ENTREGA = ? WHERE NUMERO = ? AND TIPO = ?', [nova, dataEntrega, alvo.numero, alvo.tipo]);
      } else if (manterData) {
        await conn.execute('UPDATE ped_orc SET SITUACAO = ? WHERE NUMERO = ? AND TIPO = ?', [nova, alvo.numero, alvo.tipo]);
        dataEntrega = linhas.cab.DATA_ENTREGA ?? null;
      } else {
        await conn.execute('UPDATE ped_orc SET SITUACAO = ?, DATA_ENTREGA = ? WHERE NUMERO = ? AND TIPO = ?', [nova, dataEntrega, alvo.numero, alvo.tipo]);
      }
      await auditarDoc(conn, req, 'pedido_situacao', alvo.tipo, alvo.numero, { cliente: linhas.cab.RAZAO_SOCIAL, de: antes, para: nova, ...(usarDataPronto ? { usarDataPronto: true } : manterData ? { manterData: true } : {}) });
      return { ok: true };
    });
    if (r) res.json({ ok: true, tipo: alvo.tipo, numero: alvo.numero, situacao: nova, dataEntrega });
  });

  // excluir: apaga o cabeçalho e todas as linhas do documento (mesmas tabelas que o salvar regrava); sem desfazer
  rota('delete', '/ped_orc/:tipo/:numero', ['pedidos.excluir'], async (req, res) => {
    const alvo = validarAlvo(req, res); if (!alvo) return;
    const r = await emTransacao(pool, res, 'DELETE /ped_orc', async conn => {
      const linhas = await docParaAcao(conn, req, alvo.tipo, alvo.numero);
      const resumo = { cliente: linhas.cab.RAZAO_SOCIAL, data: String(linhas.cab.DATA || '').slice(0, 10), total: linhas.cab.TOTAL, situacao: linhas.cab.SITUACAO, financeiro: linhas.cab.FINANCEIRO,
        itens: linhas.lista.length };
      for (const tabela of TABELAS_ITENS) await conn.execute(`DELETE FROM ${tabela} WHERE NUMERO = ? AND TIPO = ?`, [alvo.numero, alvo.tipo]);
      await conn.execute('DELETE FROM web_item_desenhos WHERE tipo = ? AND numero = ?', [alvo.tipo, alvo.numero]);
      if (alvo.tipo === 'Pedido') for (const tabela of ['vidros', 'perfis']) await conn.execute(`DELETE FROM ${tabela} WHERE NUMERO = ?`, [alvo.numero]);
      // Entregas: o NUMERO é reaproveitado (MAX+1), então a entrega do pedido excluído sai junto, na mesma transação
      // (só exclusão feita pela web passa por aqui; exclusão feita direto no VB não limpa web_entregas).
      if (alvo.tipo === 'Pedido') {
        await liberarPlanosDoPedido(conn, alvo.numero, req.acesso?.nome || '', { excluindo: true });   // plano de corte: idem; o conferido fica de histórico, mas solto do número (reaproveitado)
        await liberarPlanosVidroDoPedido(conn, alvo.numero, req.acesso?.nome || '', { excluindo: true });   // plano de corte de vidros: idem
        const [entregas] = await conn.execute('SELECT id FROM web_entregas WHERE numero = ? FOR UPDATE', [alvo.numero]);
        for (const { id } of entregas) {
          await conn.execute('DELETE FROM web_entrega_anexos WHERE entrega_id = ?', [id]);
          await conn.execute('DELETE FROM web_entrega_eventos WHERE entrega_id = ?', [id]);
          await conn.execute('DELETE FROM web_entregas WHERE id = ?', [id]);
        }
        if (entregas.length) {
          await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
            [agoraLocal(), req.acesso?.nome || req.usuario?.nome || '', 'entrega_removida_com_pedido', String(alvo.numero), JSON.stringify({ entregaIds: entregas.map(e => e.id) })]);
        }
      }
      await conn.execute('DELETE FROM ped_orc WHERE NUMERO = ? AND TIPO = ?', [alvo.numero, alvo.tipo]);
      await auditarDoc(conn, req, 'documento_excluido', alvo.tipo, alvo.numero, resumo);
      return { ok: true };
    });
    if (r) res.json({ ok: true, tipo: alvo.tipo, numero: alvo.numero });
  });
}

module.exports = { registrarPedOrc, lerSistemaCorrer, lerDocumento, gruposDoItem, ErroItem, FRENTES_PORTA, MAX_QTD_ITEM };
