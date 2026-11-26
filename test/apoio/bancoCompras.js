// Banco simulado dos pedidos a fornecedor, em cima do banco de estoque (mesmas listas em memória e mesmo ROLLBACK).
// Cada regra imita um SQL de rotas/pedidos_compra.js e rotas/pedidos_compra_banco.js.
const jwt = require('jsonwebtoken');
const { bancoEstoque, FORN } = require('./bancoEstoque');
const { subir } = require('./servidor');
const { SID_TESTE } = require('./sessaoFalsa');
const { app, pool, acesso } = require('../../index.js');

const TODAS = ['estoque.ver', 'estoque.movimentar', 'estoque.desfazer', 'compras.ver', 'compras.criar'];

function regrasCompras(estado) {
  const { estoque, pedidosCompra, comprasItens, comprasBaixas } = estado;
  const chegou = id => comprasBaixas.filter(b => b.item_id === id).reduce((s, b) => s + b.qtd, 0);
  const pedido = n => pedidosCompra.find(p => p.numero === Number(n));
  const norm = t => String(t ?? '').trimEnd().toLowerCase();
  const proximo = (lista, campo) => lista.reduce((m, x) => Math.max(m, x[campo]), 0) + 1;
  const remover = (lista, apagar) => { const fica = lista.filter(x => !apagar(x)); const n = lista.length - fica.length; lista.splice(0, lista.length, ...fica); return { affectedRows: n }; };
  return [
    // saldo a caminho
    [/AS falta FROM web_pedidos_compra_itens i JOIN web_pedidos_compra p/, (sql, codigos) => comprasItens
      .filter(i => ['enviado', 'parcial'].includes(pedido(i.pedido_numero)?.situacao) && (!codigos.length || codigos.map(Number).includes(i.produto_codigo)))
      .map(i => ({ codigo: i.produto_codigo, falta: String(i.qtd - chegou(i.id)) }))],
    [/UPDATE estoque SET AGUARDANDO = \? WHERE CODIGO = \?/, (sql, [v, c]) => { const e = estoque.find(x => x.CODIGO === Number(c)); if (e) e.AGUARDANDO = v; return { affectedRows: e ? 1 : 0 }; }],
    // sugestão
    [/SELECT CODIGO, FORNECEDOR, SITUACAO, AGUARDANDO FROM estoque/, () => estoque.map(e => ({ ...e }))],
    [/WHERE p\.situacao = 'rascunho'/, () => comprasItens.filter(i => pedido(i.pedido_numero)?.situacao === 'rascunho').map(i => ({ codigo: i.produto_codigo, numero: i.pedido_numero }))],
    [/SELECT i\.produto_codigo AS codigo, i\.por_caixa FROM web_pedidos_compra_itens i/, (sql, [forn]) => comprasItens
      .filter(i => { const p = pedido(i.pedido_numero); return p && norm(p.fornecedor) === norm(forn) && p.situacao !== 'cancelado'; })
      .sort((a, b) => b.id - a.id).map(i => ({ codigo: i.produto_codigo, por_caixa: i.por_caixa }))],
    [/SELECT produto_codigo AS codigo, fator FROM web_estoque_ligacoes/, (sql, [forn]) => estado.ligacoes.filter(l => norm(l.fornecedor) === norm(forn))
      .sort((a, b) => String(b.atualizado_em || '').localeCompare(String(a.atualizado_em || ''))).map(l => ({ codigo: l.produto_codigo, fator: String(l.fator) }))],
    // produtos e fornecedores
    [/FROM estoque WHERE SITUACAO = 'Ativo' AND \(NOME_PRODUTO LIKE \? OR CODIGO = \?\)/, (sql, [like, cod]) => {
      const termo = String(like).replace(/%/g, '').toLowerCase();
      return estoque.filter(e => e.SITUACAO === 'Ativo' && (e.NOME_PRODUTO.toLowerCase().includes(termo) || e.CODIGO === Number(cod))); }],
    [/SELECT RAZAO_FABRICANTE FROM cadastro_fornecedores ORDER BY/, () => estado.fornecedores],
    [/SELECT CODIGO, NOME_PRODUTO, UNIDADE, COD_FORNECEDOR, NOME_PRODUTO_FORNECEDOR FROM estoque WHERE CODIGO IN/, (sql, cods) => estoque.filter(e => cods.map(Number).includes(e.CODIGO))],
    // pedidos
    [/COUNT\(i\.id\) AS qtd_itens/, () => [...pedidosCompra].sort((a, b) => b.numero - a.numero).map(p => ({ ...p, qtd_itens: comprasItens.filter(i => i.pedido_numero === p.numero).length }))],
    [/^SELECT [^]*? FROM web_pedidos_compra WHERE numero = \?/, (sql, [n]) => pedidosCompra.filter(p => p.numero === Number(n)).map(p => ({ ...p }))],
    [/AS chegou FROM web_pedidos_compra_itens i WHERE i\.pedido_numero = \?/, (sql, [n]) => comprasItens.filter(i => i.pedido_numero === Number(n)).map(i => ({ ...i, chegou: String(chegou(i.id)) }))],
    [/SELECT DISTINCT produto_codigo FROM web_pedidos_compra_itens WHERE pedido_numero = \?/, (sql, [n]) =>
      [...new Set(comprasItens.filter(i => i.pedido_numero === Number(n)).map(i => i.produto_codigo))].map(produto_codigo => ({ produto_codigo }))],
    [/SELECT COUNT\(\*\) AS n FROM web_pedidos_compra_baixas b JOIN/, (sql, [n]) => [{ n: comprasBaixas.filter(b => comprasItens.some(i => i.id === b.item_id && i.pedido_numero === Number(n))).length }]],
    [/INSERT INTO web_pedidos_compra \(chave/, (sql, [chave, fornecedor, observacao, criado_em, criado_por]) => {
      if (pedidosCompra.some(p => p.chave === chave)) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      const numero = proximo(pedidosCompra, 'numero');
      pedidosCompra.push({ numero, chave, fornecedor, situacao: 'rascunho', observacao, criado_em, criado_por, enviado_em: null, fechado_em: null });
      return { insertId: numero }; }],
    [/INSERT INTO web_pedidos_compra_itens/, (sql, [pedido_numero, produto_codigo, nome_produto, cod_fornecedor, nome_fornecedor, unidade, qtd, por_caixa]) => {
      comprasItens.push({ id: proximo(comprasItens, 'id'), pedido_numero: Number(pedido_numero), produto_codigo, nome_produto, cod_fornecedor, nome_fornecedor, unidade, qtd, por_caixa });
      return { affectedRows: 1 }; }],
    [/UPDATE web_pedidos_compra SET fornecedor = \?, observacao = \? WHERE numero = \?/, (sql, [f, o, n]) => { Object.assign(pedido(n), { fornecedor: f, observacao: o }); return { affectedRows: 1 }; }],
    [/UPDATE web_pedidos_compra SET situacao = \?, enviado_em = \?, enviado_por = \? WHERE numero = \?/, (sql, [s, em, por, n]) => { Object.assign(pedido(n), { situacao: s, enviado_em: em, enviado_por: por }); return { affectedRows: 1 }; }],
    [/UPDATE web_pedidos_compra SET situacao = \?, fechado_em = \?, fechado_por = \? WHERE numero = \?/, (sql, [s, em, por, n]) => { Object.assign(pedido(n), { situacao: s, fechado_em: em, fechado_por: por }); return { affectedRows: 1 }; }],
    [/DELETE FROM web_pedidos_compra_itens WHERE pedido_numero = \?/, (sql, [n]) => remover(comprasItens, i => i.pedido_numero === Number(n))],
    [/DELETE FROM web_pedidos_compra WHERE numero = \?/, (sql, [n]) => remover(pedidosCompra, p => p.numero === Number(n))]
  ];
}

function bancoCompras() {
  const banco = bancoEstoque();
  Object.assign(banco.estado, { pedidosCompra: [], comprasItens: [], comprasBaixas: [] });
  Object.assign(banco, { pedidosCompra: banco.estado.pedidosCompra, comprasItens: banco.estado.comprasItens, comprasBaixas: banco.estado.comprasBaixas });
  banco.regras.unshift(...regrasCompras(banco.estado));
  return banco;
}

// sobe o app com o banco simulado; o usuário logado (Caio) tem exatamente as permissões pedidas
async function prepararCompras(t, { permissoes = TODAS, banco = bancoCompras() } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Caio', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: 'Teste' },
    estados: [], ativo: true, permissoes: new Set(permissoes) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const token = jwt.sign({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { banco, chamar };
}

module.exports = { bancoCompras, prepararCompras, TODAS, FORN };
