// ==========================================================================
// SQL dos pedidos a fornecedor usado pelas rotas próprias e pela entrada de
// estoque. Recebe `db` (pool ou conexão da transação) e não depende de rotas.
// ==========================================================================
const marcas = lista => lista.map(() => '?').join(', ');

// Map código → unidades que ainda faltam chegar (pedidos enviados ou que chegaram em parte)
async function aCaminhoPorProduto(db, codigos) {
  if (codigos && !codigos.length) return new Map();
  const [linhas] = await db.execute(
    `SELECT i.produto_codigo AS codigo, i.qtd - COALESCE(b.chegou, 0) AS falta FROM web_pedidos_compra_itens i JOIN web_pedidos_compra p ON p.numero = i.pedido_numero
     LEFT JOIN (SELECT item_id, SUM(qtd) AS chegou FROM web_pedidos_compra_baixas GROUP BY item_id) b ON b.item_id = i.id
     WHERE p.situacao IN ('enviado', 'parcial')${codigos ? ` AND i.produto_codigo IN (${marcas(codigos)})` : ''}`, codigos || []);
  const mapa = new Map();
  for (const l of linhas) {
    const falta = Number(l.falta) || 0;
    if (falta > 0) mapa.set(Number(l.codigo), (mapa.get(Number(l.codigo)) || 0) + falta);
  }
  return mapa;
}

// única escrita em tabela antiga deste módulo: 'Aguardando' enquanto há material a caminho (varchar(10) no banco)
async function marcarAguardando(conn, codigos) {
  const unicos = [...new Set(codigos.map(Number))];
  const caminho = await aCaminhoPorProduto(conn, unicos);
  for (const codigo of unicos) await conn.execute('UPDATE estoque SET AGUARDANDO = ? WHERE CODIGO = ?', [caminho.has(codigo) ? 'Aguardando' : '', codigo]);
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

module.exports = { marcas, aCaminhoPorProduto, marcarAguardando, porCaixaDoFornecedor, rascunhosPorProduto, carregarPedido };
