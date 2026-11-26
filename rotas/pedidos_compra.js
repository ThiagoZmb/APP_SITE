// ==========================================================================
// Pedidos a fornecedor: sugestão do que comprar, rascunho, envio, encerramento
// e cancelamento. Tabelas web_pedidos_compra*; a chegada é reconhecida pela
// entrada de estoque. Sem preços. Regras: docs/regras/pedidos-compra.md
// ==========================================================================
const { ErroUsuario, emTransacao, agoraLocal, hojeLocal } = require('./transacao');
const { travarProdutos } = require('./estoque_saida');
const { carregarAnalises } = require('./estoque_analises');
const { montarSugestao, acaoPermitida, validarPedido } = require('../calculo/pedidos_compra');
const { marcas, aCaminhoPorProduto, marcarAguardando, porCaixaDoFornecedor, rascunhosPorProduto, carregarPedido } = require('./pedidos_compra_banco');

const { desenharPedidoCompra, novoDocumento } = require('../pdf/pedido_compra');

const VER = ['estoque.ver', 'compras.ver'];
const CRIAR = [...VER, 'compras.criar'];
const NAO_ENCONTRADO = 'Pedido não encontrado.';
const MUDOU = 'O pedido mudou de situação. Atualize a página.';
const JANELA = 90;
const norm = t => String(t ?? '').trimEnd().toLowerCase();   // como o MySQL compara o nome do fornecedor
const numeroDe = req => (/^\d{1,9}$/.test(req.params.numero) ? Number(req.params.numero) : 0);

function registrarPedidosCompra({ rota, pool }) {
  const falha = (res, rotaNome, err) => {
    console.error(`Erro ${rotaNome}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  // o que é preciso para sugerir, para qualquer fornecedor
  async function dadosSugestao() {
    const [analise, [estoque], aCaminho, rascunhos] = await Promise.all([
      carregarAnalises(pool, { hoje: hojeLocal(), janela: JANELA, verValores: false, classe: '' }),
      pool.execute('SELECT CODIGO, FORNECEDOR, SITUACAO, AGUARDANDO FROM estoque'),
      aCaminhoPorProduto(pool),
      rascunhosPorProduto(pool)
    ]);
    const porFornecedor = new Map();
    for (const e of estoque) {
      const k = norm(e.FORNECEDOR);
      if (!porFornecedor.has(k)) porFornecedor.set(k, new Map());
      porFornecedor.get(k).set(Number(e.CODIGO), { situacao: e.SITUACAO, aguardando: e.AGUARDANDO || '' });
    }
    return { sugerir: (fornecedor, porCaixa) => montarSugestao({ analise: analise.itens, diasDados: analise.diasDados,
      produtos: porFornecedor.get(norm(fornecedor)) || new Map(), aCaminho, rascunhos, porCaixa }) };
  }

  rota('get', '/pedidos_compra', VER, async (req, res) => {
    try {
      const [linhas] = await pool.execute(
        `SELECT p.numero, p.fornecedor, p.situacao, p.criado_em, p.enviado_em, COUNT(i.id) AS qtd_itens FROM web_pedidos_compra p
         LEFT JOIN web_pedidos_compra_itens i ON i.pedido_numero = p.numero GROUP BY p.numero ORDER BY p.numero DESC LIMIT 300`);
      res.json(linhas.map(l => ({ numero: Number(l.numero), fornecedor: l.fornecedor, situacao: l.situacao, criadoEm: l.criado_em,
        enviadoEm: l.enviado_em || null, qtdItens: Number(l.qtd_itens) || 0 })));
    } catch (err) { falha(res, 'GET /pedidos_compra', err); }
  });

  rota('get', '/pedidos_compra/fornecedores', VER, async (req, res) => {
    try {
      const [[forns], dados] = await Promise.all([pool.execute('SELECT RAZAO_FABRICANTE FROM cadastro_fornecedores ORDER BY RAZAO_FABRICANTE'), dadosSugestao()]);
      res.json(forns.map(f => ({ fornecedor: f.RAZAO_FABRICANTE, qtdSugeridos: dados.sugerir(f.RAZAO_FABRICANTE, new Map()).filter(i => i.marcado).length }))
        .sort((a, b) => b.qtdSugeridos - a.qtdSugeridos || String(a.fornecedor).localeCompare(String(b.fornecedor), 'pt-BR')));
    } catch (err) { falha(res, 'GET /pedidos_compra/fornecedores', err); }
  });

  rota('get', '/pedidos_compra/sugestao', VER, async (req, res) => {
    const fornecedor = String(req.query.fornecedor || '').trim().slice(0, 190);
    if (!fornecedor) return res.status(400).json({ error: 'Escolha um fornecedor.' });
    try {
      const [dados, porCaixa] = await Promise.all([dadosSugestao(), porCaixaDoFornecedor(pool, fornecedor)]);
      res.json({ itens: dados.sugerir(fornecedor, porCaixa) });
    } catch (err) { falha(res, 'GET /pedidos_compra/sugestao', err); }
  });

  rota('get', '/pedidos_compra/produtos', VER, async (req, res) => {
    const busca = String(req.query.busca || '').trim().slice(0, 100);
    const fornecedor = String(req.query.fornecedor || '').trim().slice(0, 190);
    try {
      const [[linhas], porCaixa] = await Promise.all([
        pool.execute(`SELECT CODIGO, NOME_PRODUTO, UNIDADE, QTD_ESTOQUE FROM estoque WHERE SITUACAO = 'Ativo' AND (NOME_PRODUTO LIKE ? OR CODIGO = ?)
                      ORDER BY NOME_PRODUTO LIMIT 50`, [`%${busca}%`, parseInt(busca, 10) || 0]),
        porCaixaDoFornecedor(pool, fornecedor)
      ]);
      res.json(linhas.map(l => ({ codigo: Number(l.CODIGO), produto: l.NOME_PRODUTO, unidade: l.UNIDADE || '', qtd: Number(l.QTD_ESTOQUE) || 0,
        porCaixa: porCaixa.get(Number(l.CODIGO)) || 1 })));
    } catch (err) { falha(res, 'GET /pedidos_compra/produtos', err); }
  });

  rota('get', '/pedidos_compra/:numero', VER, async (req, res) => {
    try {
      const pedido = await carregarPedido(pool, numeroDe(req));
      if (!pedido) return res.status(404).json({ error: NAO_ENCONTRADO });
      res.json(pedido);
    } catch (err) { falha(res, 'GET /pedidos_compra/:numero', err); }
  });

  rota('get', '/pedidos_compra/:numero/pdf', VER, async (req, res) => {
    try {
      const pedido = await carregarPedido(pool, numeroDe(req));
      if (!pedido) return res.status(404).json({ error: NAO_ENCONTRADO });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Pedido_compra_${pedido.numero}.pdf"`);
      const doc = novoDocumento();
      doc.pipe(res);
      desenharPedidoCompra(doc, pedido);
      doc.end();
    } catch (err) { falha(res, 'GET /pedidos_compra/:numero/pdf', err); }
  });

  // valida o corpo e confere o fornecedor no cadastro (fora da transação); responde o erro e devolve null
  async function conferirCorpo(req, res, rotaNome) {
    const v = validarPedido(req.body);
    if (v.erro) { res.status(400).json({ error: v.erro }); return null; }
    try {
      const [[f]] = await pool.execute('SELECT RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE = ? LIMIT 1', [v.fornecedor]);
      if (!f) { res.status(400).json({ error: 'Fornecedor não encontrado no cadastro.' }); return null; }
      return { ...v, fornecedor: f.RAZAO_FABRICANTE };
    } catch (err) { falha(res, rotaNome, err); return null; }
  }

  // os nomes, o código e a unidade vêm do cadastro do estoque, nunca da tela
  async function gravarItens(conn, numero, itens) {
    const codigos = itens.map(i => i.produtoCodigo);
    const [linhas] = await conn.execute(
      `SELECT CODIGO, NOME_PRODUTO, UNIDADE, COD_FORNECEDOR, NOME_PRODUTO_FORNECEDOR FROM estoque WHERE CODIGO IN (${marcas(codigos)})`, codigos);
    const produtos = new Map(linhas.map(l => [Number(l.CODIGO), l]));
    for (const [i, it] of itens.entries()) {
      const p = produtos.get(it.produtoCodigo);
      if (!p) throw new ErroUsuario(400, `Item ${i + 1}: produto não encontrado no estoque.`);
      await conn.execute(
        `INSERT INTO web_pedidos_compra_itens (pedido_numero, produto_codigo, nome_produto, cod_fornecedor, nome_fornecedor, unidade, qtd, por_caixa)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [numero, it.produtoCodigo, p.NOME_PRODUTO || '', p.COD_FORNECEDOR || '', p.NOME_PRODUTO_FORNECEDOR || '', p.UNIDADE || '', it.qtd, it.porCaixa]);
    }
  }

  async function travarPedido(conn, numero) {
    const [[p]] = await conn.execute('SELECT numero, situacao FROM web_pedidos_compra WHERE numero = ? FOR UPDATE', [numero]);
    if (!p) throw new ErroUsuario(404, NAO_ENCONTRADO);
    return p;
  }
  async function travarRascunho(conn, numero) {
    if ((await travarPedido(conn, numero)).situacao !== 'rascunho') throw new ErroUsuario(409, MUDOU);
  }

  rota('post', '/pedidos_compra', CRIAR, async (req, res) => {
    const chave = String(req.body?.chave ?? '').trim();
    if (!chave || chave.length > 64) return res.status(400).json({ error: 'Pedido sem identificação. Atualize a página e tente de novo.' });
    const v = await conferirCorpo(req, res, 'POST /pedidos_compra');
    if (!v) return;
    const numero = await emTransacao(pool, res, 'POST /pedidos_compra', async conn => {
      let r;
      try {
        [r] = await conn.execute("INSERT INTO web_pedidos_compra (chave, fornecedor, situacao, observacao, criado_em, criado_por) VALUES (?, ?, 'rascunho', ?, ?, ?)",
          [chave, v.fornecedor, v.observacao, agoraLocal(), req.user.nome]);
      } catch (err) {
        if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) throw new ErroUsuario(409, 'Este pedido já foi gravado. Atualize a lista.');
        throw err;
      }
      await gravarItens(conn, r.insertId, v.itens);
      return r.insertId;
    });
    if (numero) res.status(201).json({ numero });
  });

  rota('put', '/pedidos_compra/:numero', CRIAR, async (req, res) => {
    const numero = numeroDe(req);
    const v = await conferirCorpo(req, res, 'PUT /pedidos_compra');
    if (!v) return;
    const ok = await emTransacao(pool, res, 'PUT /pedidos_compra', async conn => {
      await travarRascunho(conn, numero);
      await conn.execute('UPDATE web_pedidos_compra SET fornecedor = ?, observacao = ? WHERE numero = ?', [v.fornecedor, v.observacao, numero]);
      await conn.execute('DELETE FROM web_pedidos_compra_itens WHERE pedido_numero = ?', [numero]);
      await gravarItens(conn, numero, v.itens);
      return true;
    });
    if (ok) res.json({ numero });
  });

  rota('delete', '/pedidos_compra/:numero', CRIAR, async (req, res) => {
    const numero = numeroDe(req);
    const ok = await emTransacao(pool, res, 'DELETE /pedidos_compra', async conn => {
      await travarRascunho(conn, numero);
      await conn.execute('DELETE FROM web_pedidos_compra_itens WHERE pedido_numero = ?', [numero]);
      await conn.execute('DELETE FROM web_pedidos_compra WHERE numero = ?', [numero]);
      return true;
    });
    if (ok) res.json({ numero });
  });

  rota('post', '/pedidos_compra/:numero/situacao', CRIAR, async (req, res) => {
    const numero = numeroDe(req);
    const acao = String(req.body?.acao ?? '');
    const sqlCodigos = 'SELECT DISTINCT produto_codigo FROM web_pedidos_compra_itens WHERE pedido_numero = ?';
    let antes;
    // lido fora da transação para travar o estoque ANTES do pedido (mesma ordem da entrada de nota)
    try { [antes] = await pool.execute(sqlCodigos, [numero]); } catch (err) { return falha(res, 'POST /pedidos_compra/situacao', err); }
    const nova = await emTransacao(pool, res, 'POST /pedidos_compra/situacao', async conn => {
      if (antes.length) await travarProdutos(conn, antes.map(l => l.produto_codigo));
      const p = await travarPedido(conn, numero);
      const [[{ n }]] = await conn.execute(
        'SELECT COUNT(*) AS n FROM web_pedidos_compra_baixas b JOIN web_pedidos_compra_itens i ON i.id = b.item_id WHERE i.pedido_numero = ?', [numero]);
      const destino = acaoPermitida(acao, p.situacao, Number(n) > 0);
      if (!destino) throw new ErroUsuario(409, MUDOU);
      const [quando, quem] = destino === 'enviado' ? ['enviado_em', 'enviado_por'] : ['fechado_em', 'fechado_por'];
      await conn.execute(`UPDATE web_pedidos_compra SET situacao = ?, ${quando} = ?, ${quem} = ? WHERE numero = ?`, [destino, agoraLocal(), req.user.nome, numero]);
      const [codigos] = await conn.execute(sqlCodigos, [numero]);
      await marcarAguardando(conn, codigos.map(c => c.produto_codigo));
      return destino;
    });
    if (nova) res.json({ situacao: nova });
  });
}

module.exports = { registrarPedidosCompra };
