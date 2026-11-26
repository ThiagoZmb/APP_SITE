// ==========================================================================
// SQL dos pedidos a fornecedor usado pelas rotas próprias e pela entrada de
// estoque. Recebe `db` (pool ou conexão da transação) e não depende de rotas.
// ==========================================================================
const { distribuirBaixa, situacaoPelaChegada } = require('../calculo/pedidos_compra');

const marcas = lista => lista.map(() => '?').join(', ');

// As leituras que decidem gravação usam FOR UPDATE (leitura atual): na transação de quem desfaz uma entrada
// a fotografia do banco é anterior às travas, e uma leitura comum não veria o que outro acabou de gravar.

// uma linha por item do pedido e por baixa → [{ itemId, numero, codigo, qtd, chegou }] por item, na ordem recebida
function somarBaixas(linhas) {
  const itens = new Map();
  for (const l of linhas) {
    const id = Number(l.item_id);
    if (!itens.has(id)) itens.set(id, { itemId: id, numero: Number(l.numero), codigo: Number(l.codigo), qtd: Number(l.qtd) || 0, chegou: 0 });
    itens.get(id).chegou += Number(l.chegou) || 0;
  }
  return [...itens.values()];
}
const SQL_ITENS = `SELECT i.id AS item_id, i.pedido_numero AS numero, i.produto_codigo AS codigo, i.qtd, b.qtd AS chegou FROM web_pedidos_compra_itens i
  JOIN web_pedidos_compra p ON p.numero = i.pedido_numero LEFT JOIN web_pedidos_compra_baixas b ON b.item_id = i.id`;

// Map código → { falta, pedidos }: o que ainda falta chegar (pedidos enviados ou que chegaram em parte) e em quais pedidos
async function abertosPorProduto(db, codigos, { travar = false } = {}) {
  if (codigos && !codigos.length) return new Map();
  const [linhas] = await db.execute(
    `${SQL_ITENS} WHERE p.situacao IN ('enviado', 'parcial')${codigos ? ` AND i.produto_codigo IN (${marcas(codigos)})` : ''}${travar ? ' FOR UPDATE' : ''}`, codigos || []);
  const mapa = new Map();
  for (const i of somarBaixas(linhas)) {
    if (i.qtd <= i.chegou) continue;
    const a = mapa.get(i.codigo) || { falta: 0, pedidos: [] };
    a.falta += i.qtd - i.chegou;
    if (!a.pedidos.includes(i.numero)) a.pedidos.push(i.numero);
    mapa.set(i.codigo, a);
  }
  for (const a of mapa.values()) a.pedidos.sort((x, y) => x - y);
  return mapa;
}
// Map código → unidades que ainda faltam chegar
const aCaminhoPorProduto = async (db, codigos, opcoes) => new Map([...await abertosPorProduto(db, codigos, opcoes)].map(([codigo, a]) => [codigo, a.falta]));

// única escrita em tabela antiga deste módulo: 'Aguardando' enquanto há material a caminho (varchar(10) no banco)
async function marcarAguardando(conn, codigos) {
  const unicos = [...new Set(codigos.map(Number))];
  const caminho = await aCaminhoPorProduto(conn, unicos, { travar: true });
  for (const codigo of unicos) await conn.execute('UPDATE estoque SET AGUARDANDO = ? WHERE CODIGO = ?', [caminho.has(codigo) ? 'Aguardando' : '', codigo]);
}

// situação do pedido conforme o que já chegou; devolve a situação que ficou (ou null se o pedido não existe)
async function recalcularSituacao(conn, numero) {
  const [[p]] = await conn.execute('SELECT numero, situacao FROM web_pedidos_compra WHERE numero = ? FOR UPDATE', [numero]);
  if (!p) return null;
  const [linhas] = await conn.execute(`${SQL_ITENS} WHERE i.pedido_numero = ? FOR UPDATE`, [numero]);
  const nova = situacaoPelaChegada(p.situacao, somarBaixas(linhas));
  if (nova !== p.situacao) await conn.execute('UPDATE web_pedidos_compra SET situacao = ? WHERE numero = ?', [nova, numero]);
  return nova;
}

// Entrada de nota (na transação dela, com o estoque já travado): abate dos pedidos do fornecedor, do mais antigo ao mais novo,
// criados até a data da nota. chegada = Map código → quantidade. Devolve [{ numero, situacao }] dos pedidos tocados.
async function baixarPorEntrada(conn, { nota, fornecedor, data, chegada, quando }) {
  const codigos = [...chegada.keys()].map(Number);
  const [linhas] = await conn.execute(
    `${SQL_ITENS} WHERE p.fornecedor = ? AND p.situacao IN ('enviado', 'parcial') AND p.criado_em <= ? ORDER BY i.pedido_numero, i.id FOR UPDATE`,
    [fornecedor, `${data} 23:59:59`]);
  const abertos = somarBaixas(linhas).map(i => ({ itemId: i.itemId, pedidoId: i.numero, produtoCodigo: i.codigo, falta: i.qtd - i.chegou }));
  const baixas = distribuirBaixa(abertos, chegada);
  for (const x of baixas) {
    await conn.execute('INSERT INTO web_pedidos_compra_baixas (item_id, nota, fornecedor, qtd, quando) VALUES (?, ?, ?, ?, ?)', [x.itemId, nota, fornecedor, x.qtd, quando]);
  }
  const pedidos = [];
  for (const numero of [...new Set(baixas.map(x => x.pedidoId))].sort((a, b) => a - b)) pedidos.push({ numero, situacao: await recalcularSituacao(conn, numero) });
  // a entrada limpa a marca de todo produto da nota: volta onde ainda há material a caminho
  const caminho = await aCaminhoPorProduto(conn, codigos, { travar: true });
  for (const codigo of caminho.keys()) await conn.execute('UPDATE estoque SET AGUARDANDO = ? WHERE CODIGO = ?', ['Aguardando', codigo]);
  return pedidos;
}

// Entrada desfeita: apaga o que aquela nota abateu, recalcula os pedidos tocados e a marca dos produtos
async function desfazerBaixas(conn, { nota, fornecedor }) {
  const [tocados] = await conn.execute(
    `SELECT i.pedido_numero AS numero, i.produto_codigo AS codigo FROM web_pedidos_compra_baixas b JOIN web_pedidos_compra_itens i ON i.id = b.item_id
     WHERE b.nota = ? AND b.fornecedor = ? FOR UPDATE`, [nota, fornecedor]);
  if (!tocados.length) return;
  await conn.execute('DELETE FROM web_pedidos_compra_baixas WHERE nota = ? AND fornecedor = ?', [nota, fornecedor]);
  for (const numero of [...new Set(tocados.map(t => Number(t.numero)))].sort((a, b) => a - b)) await recalcularSituacao(conn, numero);
  await marcarAguardando(conn, tocados.map(t => t.codigo));
}

// unidades por caixa por produto: o último pedido do fornecedor; senão o fator inteiro (> 1) que a entrada por XML aprendeu
async function porCaixaDoFornecedor(db, fornecedor) {
  if (!fornecedor) return new Map();
  const [[usados], [ligacoes]] = await Promise.all([
    db.execute(`SELECT i.produto_codigo AS codigo, i.por_caixa FROM web_pedidos_compra_itens i JOIN web_pedidos_compra p ON p.numero = i.pedido_numero
                WHERE p.fornecedor = ? AND p.situacao <> 'cancelado' ORDER BY i.id DESC`, [fornecedor]),
    db.execute('SELECT produto_codigo AS codigo, fator FROM web_estoque_ligacoes WHERE fornecedor = ? ORDER BY atualizado_em DESC', [fornecedor])
  ]);
  const mapa = new Map();
  for (const l of usados) if (!mapa.has(Number(l.codigo))) mapa.set(Number(l.codigo), Number(l.por_caixa) || 1);
  for (const l of ligacoes) {
    const f = Number(l.fator);
    if (Number.isInteger(f) && f > 1 && !mapa.has(Number(l.codigo))) mapa.set(Number(l.codigo), f);
  }
  return mapa;
}

// Map código → número do rascunho mais recente em que o produto está
async function rascunhosPorProduto(db) {
  const [linhas] = await db.execute(
    `SELECT i.produto_codigo AS codigo, p.numero FROM web_pedidos_compra_itens i JOIN web_pedidos_compra p ON p.numero = i.pedido_numero
     WHERE p.situacao = 'rascunho' ORDER BY p.numero`);
  return new Map(linhas.map(l => [Number(l.codigo), Number(l.numero)]));
}

// pedido com os itens e o que já chegou, ou null
async function carregarPedido(db, numero) {
  const [[[p]], [itens]] = await Promise.all([
    db.execute('SELECT numero, fornecedor, situacao, observacao, criado_em, criado_por, enviado_em, fechado_em FROM web_pedidos_compra WHERE numero = ?', [numero]),
    db.execute(`SELECT i.id, i.produto_codigo, i.nome_produto, i.cod_fornecedor, i.nome_fornecedor, i.unidade, i.qtd, i.por_caixa,
                COALESCE((SELECT SUM(b.qtd) FROM web_pedidos_compra_baixas b WHERE b.item_id = i.id), 0) AS chegou FROM web_pedidos_compra_itens i WHERE i.pedido_numero = ? ORDER BY i.id`, [numero])
  ]);
  if (!p) return null;
  return {
    numero: Number(p.numero), fornecedor: p.fornecedor, situacao: p.situacao, observacao: p.observacao || '',
    criadoEm: p.criado_em, criadoPor: p.criado_por || '', enviadoEm: p.enviado_em || null, fechadoEm: p.fechado_em || null,
    itens: itens.map(i => {
      const qtd = Number(i.qtd), chegou = Number(i.chegou) || 0;
      return { codigo: Number(i.produto_codigo), produto: i.nome_produto, codFornecedor: i.cod_fornecedor || '', nomeFornecedor: i.nome_fornecedor || '',
        unidade: i.unidade || '', qtd, porCaixa: Number(i.por_caixa) || 1, chegou, falta: Math.max(0, qtd - chegou) };
    })
  };
}

module.exports = { marcas, abertosPorProduto, aCaminhoPorProduto, marcarAguardando, baixarPorEntrada, desfazerBaixas, porCaixaDoFornecedor, rascunhosPorProduto, carregarPedido };
