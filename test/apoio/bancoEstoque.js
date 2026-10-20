// Banco simulado com estado para as rotas de movimentação de estoque.
// Cada regra imita um SQL de rotas/estoque_movimentos.js; as listas em memória são o "banco".
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');
const { PERFIS_INICIAIS } = require('../../seguranca/permissoes');

const FORN = 'FORNECEDOR TESTE LTDA';
// erro que o MySQL dá ao repetir chave primária/única
const duplicado = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
const PERFIS = {
  'Estoquista': PERFIS_INICIAIS.find(p => p.nome === 'Estoquista').permissoes,
  'Interno completo': PERFIS_INICIAIS.find(p => p.nome === 'Interno completo').permissoes,
  'Somente ver': ['estoque.ver']
};

function bancoEstoque() {
  const estoque = [
    { CODIGO: 1, NOME_PRODUTO: 'Perfil Slim', UNIDADE: 'Barra', QTD_ESTOQUE: 10, SITUACAO: 'Ativo', FORNECEDOR: FORN, COD_FORNECEDOR: 'PS-01',
      CODIGO_BARRA: '7890000000011', NOME_PRODUTO_FORNECEDOR: 'PERFIL SLIM 6M', VALOR: 12.5, AGUARDANDO: 'Sim' },
    { CODIGO: 2, NOME_PRODUTO: 'Puxador Total', UNIDADE: 'Peça', QTD_ESTOQUE: 0, SITUACAO: 'Inativo', FORNECEDOR: FORN, COD_FORNECEDOR: 'PT-02',
      CODIGO_BARRA: '7890000000028', NOME_PRODUTO_FORNECEDOR: 'PUXADOR TOTAL', VALOR: 30, AGUARDANDO: '' },
    { CODIGO: 3, NOME_PRODUTO: 'Parafuso', UNIDADE: 'Un', QTD_ESTOQUE: 500, SITUACAO: 'Ativo', FORNECEDOR: FORN, COD_FORNECEDOR: 'PAR-100',
      CODIGO_BARRA: '7890000000035', NOME_PRODUTO_FORNECEDOR: 'PARAFUSO', VALOR: 0.1, AGUARDANDO: '' }
  ];
  const fornecedores = [{ RAZAO_FABRICANTE: FORN, CNPJ: '12.345.678/0001-90' }, { RAZAO_FABRICANTE: 'OUTRO FORNECEDOR SA', CNPJ: '98.765.432/0001-10' }];
  const estado = { estoque, fornecedores, nfs: [], entradas: [], saidas: [], ligacoes: [], lancamentos: [], estornos: [], ajustes: [], auditoria: [] };
  const sitOk = e => /^ativo$/i.test(e.SITUACAO) || (/^inativo$/i.test(e.SITUACAO) && Number(e.QTD_ESTOQUE) !== 0);
  const regras = [
    // listas
    [/FROM estoque WHERE \(SITUACAO = 'Ativo' OR/, (sql, [like, cod]) => {
      const termo = String(like || '%%').replace(/%/g, '').toLowerCase();
      return estoque.filter(e => sitOk(e) && (!termo || e.NOME_PRODUTO.toLowerCase().includes(termo) || String(e.CODIGO) === String(cod)))
        .sort((a, b) => a.NOME_PRODUTO.localeCompare(b.NOME_PRODUTO));
    }],
    [/SELECT RAZAO_FABRICANTE, CNPJ FROM cadastro_fornecedores ORDER BY/, () => fornecedores],
    // entrada
    [/SELECT RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE = \?/, (sql, [r]) => fornecedores.filter(x => x.RAZAO_FABRICANTE === r)],
    [/FROM estoque WHERE CODIGO IN \(.*\) FOR UPDATE/, (sql, cods) => estoque.filter(e => cods.map(Number).includes(e.CODIGO)).map(e => ({ ...e }))],
    [/FROM nf_entrada WHERE NUMERO = \? FOR UPDATE/, (sql, [n]) => estado.nfs.filter(x => x.NUMERO === n)],
    [/INSERT INTO nf_entrada \(NUMERO, RAZAO_FABRICANTE, DATA, VALOR_TOTAL\)/, (sql, [NUMERO, RAZAO_FABRICANTE, DATA, VALOR_TOTAL]) => {
      if (estado.nfs.some(x => x.NUMERO === NUMERO)) throw duplicado(); // PK da nf_entrada é só NUMERO
      estado.nfs.push({ NUMERO, RAZAO_FABRICANTE, DATA, VALOR_TOTAL }); return { affectedRows: 1 }; }],
    [/INSERT INTO entrada_estoque \(NOTA_FISCAL, DATA, FABRICANTE, ITEM, NOME_PRODUTO, NOME_PRODUTO_FABRICANTE, QTD, VALOR_UNITARIO, VALOR_TOTAL, OBSERVACAO\)/,
      (sql, p) => { const [NOTA_FISCAL, DATA, FABRICANTE, ITEM, NOME_PRODUTO, NOME_PRODUTO_FABRICANTE, QTD, VALOR_UNITARIO, VALOR_TOTAL, OBSERVACAO] = p;
        estado.entradas.push({ id: estado.entradas.length + 1, NOTA_FISCAL, DATA, FABRICANTE, ITEM, NOME_PRODUTO, NOME_PRODUTO_FABRICANTE, QTD, VALOR_UNITARIO, VALOR_TOTAL, OBSERVACAO });
        return { affectedRows: 1 }; }],
    [/UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE \+ \?, AGUARDANDO = '' WHERE CODIGO = \?/, (sql, [q, c]) => {
      const e = estoque.find(x => x.CODIGO === Number(c)); e.QTD_ESTOQUE += Number(q); e.AGUARDANDO = ''; return { affectedRows: 1 }; }],
    // saída e lançamentos (chave contra reenvio)
    [/INSERT INTO web_estoque_lancamentos \(chave, tipo, quando, quem, referencia\)/, (sql, [chave, quando, quem, referencia]) => {
      const tipo = (sql.match(/VALUES \(\?, '(\w+)'/) || [])[1]; // o tipo vai literal no SQL
      if (estado.lancamentos.some(l => l.chave === chave)) throw duplicado();
      estado.lancamentos.push({ chave, tipo, quando, quem, referencia }); return { affectedRows: 1 }; }],
    [/INSERT INTO saida_estoque \(CODIGO_BARRA, FORNECEDOR, NOME_PRODUTO_FORNECEDOR, NOME_PRODUTO, DATA, QTD, USUARIO, STATUS\)/, (sql, p) => {
      const [CODIGO_BARRA, FORNECEDOR, NOME_PRODUTO_FORNECEDOR, NOME_PRODUTO, DATA, QTD, USUARIO] = p;
      estado.saidas.push({ ID: estado.saidas.length + 1, CODIGO_BARRA, FORNECEDOR, NOME_PRODUTO_FORNECEDOR, NOME_PRODUTO, DATA, QTD, USUARIO, STATUS: null });
      return { affectedRows: 1 }; }],
    [/UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE - \? WHERE CODIGO = \?/, (sql, [q, c]) => {
      estoque.find(x => x.CODIGO === Number(c)).QTD_ESTOQUE -= Number(q); return { affectedRows: 1 }; }],
    // ajuste
    [/UPDATE estoque SET QTD_ESTOQUE = \? WHERE CODIGO = \?/, (sql, [q, c]) => { estoque.find(x => x.CODIGO === Number(c)).QTD_ESTOQUE = Number(q); return { affectedRows: 1 }; }],
    [/INSERT INTO web_estoque_ajustes \(quando, quem, produto_codigo, nome_produto, qtd_antes, qtd_depois, motivo\)/, (sql, [quando, quem, produto_codigo, nome_produto, qtd_antes, qtd_depois, motivo]) => {
      estado.ajustes.push({ id: estado.ajustes.length + 1, quando, quem, produto_codigo, nome_produto, qtd_antes, qtd_depois, motivo }); return { insertId: estado.ajustes.length }; }],
    // histórico (o período vai no SQL; os demais filtros a rota aplica)
    [/FROM entrada_estoque WHERE DATA BETWEEN \? AND \?/, (sql, [a, z]) => estado.entradas.filter(e => e.DATA >= a.slice(0, 10) && e.DATA <= z.slice(0, 10))],
    [/FROM saida_estoque WHERE DATA BETWEEN \? AND \?/, (sql, [a, z]) => estado.saidas.filter(e => e.DATA >= a && e.DATA <= z)],
    [/FROM web_estoque_ajustes WHERE quando BETWEEN \? AND \?/, (sql, [a, z]) => estado.ajustes.filter(e => e.quando >= a && e.quando <= z)],
    [/FROM web_estoque_estornos WHERE quando BETWEEN \? AND \?/, (sql, [a, z]) => estado.estornos.filter(e => e.quando >= a && e.quando <= z)],
    // desfazer (primeiro os nomes sem trava, para travar o estoque antes das linhas do movimento)
    [/SELECT DISTINCT NOME_PRODUTO FROM entrada_estoque WHERE NOTA_FISCAL = \? AND FABRICANTE = \?$/, (sql, [n, f]) =>
      [...new Set(estado.entradas.filter(e => e.NOTA_FISCAL === n && e.FABRICANTE === f).map(e => e.NOME_PRODUTO))].map(NOME_PRODUTO => ({ NOME_PRODUTO }))],
    [/SELECT DISTINCT NOME_PRODUTO FROM saida_estoque WHERE DATA = \? AND/, (sql, [d, u]) =>
      [...new Set(estado.saidas.filter(x => x.DATA === d && (x.USUARIO === u || (u === '' && x.USUARIO == null))).map(x => x.NOME_PRODUTO))].map(NOME_PRODUTO => ({ NOME_PRODUTO }))],
    [/FROM entrada_estoque WHERE NOTA_FISCAL = \? AND FABRICANTE = \? FOR UPDATE/, (sql, [n, f]) => estado.entradas.filter(e => e.NOTA_FISCAL === n && e.FABRICANTE === f).map(e => ({ ...e }))],
    [/FROM nf_entrada WHERE NUMERO = \? AND RAZAO_FABRICANTE = \? FOR UPDATE/, (sql, [n, f]) => estado.nfs.filter(x => x.NUMERO === n && x.RAZAO_FABRICANTE === f)],
    [/FROM estoque WHERE NOME_PRODUTO IN \(.*\) FOR UPDATE/, (sql, nomes) => estoque.filter(e => nomes.includes(e.NOME_PRODUTO)).map(e => ({ ...e }))],
    [/DELETE FROM entrada_estoque WHERE NOTA_FISCAL = \? AND FABRICANTE = \?/, (sql, [n, f]) => {
      estado.entradas.splice(0, estado.entradas.length, ...estado.entradas.filter(e => !(e.NOTA_FISCAL === n && e.FABRICANTE === f))); return { affectedRows: 1 }; }],
    [/DELETE FROM nf_entrada WHERE NUMERO = \? AND RAZAO_FABRICANTE = \?/, (sql, [n, f]) => {
      estado.nfs.splice(0, estado.nfs.length, ...estado.nfs.filter(x => !(x.NUMERO === n && x.RAZAO_FABRICANTE === f))); return { affectedRows: 1 }; }],
    [/FROM saida_estoque WHERE DATA = \? AND \(USUARIO = \? OR \(\? = '' AND USUARIO IS NULL\)\) FOR UPDATE/, (sql, [d, u]) =>
      estado.saidas.filter(x => x.DATA === d && (x.USUARIO === u || (u === '' && x.USUARIO == null))).map(x => ({ ...x }))],
    [/DELETE FROM saida_estoque WHERE ID IN/, (sql, ids) => {
      estado.saidas.splice(0, estado.saidas.length, ...estado.saidas.filter(x => !ids.includes(x.ID))); return { affectedRows: ids.length }; }],
    [/UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE \+ \? WHERE CODIGO = \?/, (sql, [q, c]) => { estoque.find(x => x.CODIGO === Number(c)).QTD_ESTOQUE += Number(q); return { affectedRows: 1 }; }],
    [/INSERT INTO web_estoque_estornos \(quando, quem, tipo, referencia, motivo, dados\)/, (sql, [quando, quem, referencia, motivo, dados]) => {
      const tipo = (sql.match(/VALUES \(\?, \?, '(\w+)'/) || [])[1];
      estado.estornos.push({ id: estado.estornos.length + 1, quando, quem, tipo, referencia, motivo, dados }); return { insertId: estado.estornos.length }; }],
    // importação do XML
    [/SELECT NUMERO FROM nf_entrada WHERE NUMERO = \? LIMIT 1/, (sql, [n]) => estado.nfs.filter(x => x.NUMERO === n)],
    [/FROM web_estoque_ligacoes l JOIN estoque e/, (sql, [forn]) => estado.ligacoes.filter(l => l.fornecedor === forn).map(l => {
      const e = estoque.find(x => x.CODIGO === Number(l.produto_codigo));
      return e && { cod_fabricante: l.cod_fabricante, fator: l.fator, CODIGO: e.CODIGO, NOME_PRODUTO: e.NOME_PRODUTO, UNIDADE: e.UNIDADE };
    }).filter(Boolean)],
    [/FROM estoque WHERE FORNECEDOR = \? AND COD_FORNECEDOR <> ''/, (sql, [forn]) => estoque.filter(e => e.FORNECEDOR === forn && e.COD_FORNECEDOR)],
    [/SELECT RAZAO_FABRICANTE FROM nf_entrada WHERE NUMERO = \? LIMIT 1/, (sql, [n]) => estado.nfs.filter(x => x.NUMERO === n)],
    [/INSERT INTO web_estoque_ligacoes/, (sql, [fornecedor, cod_fabricante, nome_fabricante, produto_codigo, fator, atualizado_em, atualizado_por]) => {
      const l = estado.ligacoes.find(x => x.fornecedor === fornecedor && x.cod_fabricante === cod_fabricante);
      if (l) Object.assign(l, { nome_fabricante, produto_codigo, fator, atualizado_por }); else estado.ligacoes.push({ fornecedor, cod_fabricante, nome_fabricante, produto_codigo, fator, atualizado_por });
      return { affectedRows: 1 }; }]
  ];
  const f = criarPoolFalso(regras);
  // como no MySQL: ROLLBACK desfaz o que a transação mudou (BEGIN tira uma foto do estado; ROLLBACK volta a ela)
  const conectar = f.getConnection;
  f.getConnection = async () => {
    const c = await conectar();
    let foto = null;
    return { ...c,
      beginTransaction: async () => { foto = JSON.parse(JSON.stringify(estado)); await c.beginTransaction(); },
      rollback: async () => {
        if (foto) for (const k of Object.keys(estado)) {
          const atual = estado[k];
          // mesmos objetos/arrays (os testes guardam referências): só o conteúdo volta
          foto[k].forEach((o, i) => { if (atual[i] && typeof o === 'object') { for (const ch of Object.keys(atual[i])) delete atual[i][ch]; Object.assign(atual[i], o); } });
          atual.splice(foto[k].length, atual.length - foto[k].length);
          for (let i = atual.length; i < foto[k].length; i++) atual.push(foto[k][i]);
        }
        await c.rollback();
      } };
  };
  return { f, regras, estado, ...estado, FORN };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

// Sobe o app com o banco simulado; o usuário logado (Caio) tem o perfil pedido.
async function prepararEstoque(t, { perfil = 'Interno completo', banco = bancoEstoque() } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Caio', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados: [], ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (caminho, metodo = 'GET', corpo, cabecalhos = {}) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(7, 'Caio'), 'Content-Type': 'application/json', ...cabecalhos },
    body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
  return { banco, chamar };
}

module.exports = { bancoEstoque, prepararEstoque, FORN };
