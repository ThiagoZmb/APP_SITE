// Banco simulado para as rotas de custos (rotas/custos.js): cadastro de venda, estoque, compras e as tabelas web_custo_*.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');
const { PERFIS_INICIAIS } = require('../../seguranca/permissoes');
const { hojeLocal } = require('../../rotas/estoque_movimentos');

const PERFIS = {
  'Administrador': PERFIS_INICIAIS.find(p => p.nome === 'Administrador').permissoes,
  'Só ver custos': ['precos.ver', 'valores.ver'],
  'Sem valores': ['precos.ver'],
  'Editar preços': ['precos.ver', 'precos.editar', 'valores.ver'],
  'Gravar preços': ['precos.ver', 'precos.gravar', 'valores.ver']
};
// data AAAA-MM-DD de n meses atrás (a partir de hoje em Brasília)
function mesesAtras(n) {
  const [a, m, d] = hojeLocal().split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1 - n, Math.min(d, 28)));
  return dt.toISOString().slice(0, 10);
}
// collation do MySQL: sem diferença de maiúsculas e de espaço no fim
const igualMySQL = (a, b) => String(a ?? '').trimEnd().toLowerCase() === String(b ?? '').trimEnd().toLowerCase(); // pontuação conta

function bancoCustos() {
  const estado = {
    materiais: [
      { CODIGO: 100, MODELO: 'Perfil 1036', CLASSE: 'Perfis', VALOR_FIXO: 30, SITUACAO: 'Ativo' },
      { CODIGO: 101, MODELO: 'Vidro 4mm', CLASSE: 'Vidros', VALOR_FIXO: 120, SITUACAO: 'Ativo' },
      { CODIGO: 102, MODELO: 'Fechadura tetra', CLASSE: 'Acessórios', VALOR_FIXO: 45, SITUACAO: 'Ativo' },
      { CODIGO: 103, MODELO: 'Serviço corte', CLASSE: 'Serviço', VALOR_FIXO: 20, SITUACAO: 'Ativo' },
      { CODIGO: 104, MODELO: 'Perfil antigo', CLASSE: 'Perfis', VALOR_FIXO: 10, SITUACAO: 'Inativo' }
    ],
    itens: [
      { CODIGO: 1, NOME_PRODUTO: 'PERFIL 1036 BARRA', FORNECEDOR: 'FORN A', UNIDADE: 'Barra', VALOR: 60, IPI: 5, FRETE: 3, PERDA: '8', TAMANHO: 6000, ALTURA: 0, LARGURA: 0, SITUACAO: 'Ativo' },
      { CODIGO: 2, NOME_PRODUTO: 'CHAPA VIDRO 4MM', FORNECEDOR: 'FORN B', UNIDADE: 'Chapa', VALOR: 300, IPI: 0, FRETE: 0, PERDA: '10', TAMANHO: 0, ALTURA: 2200, LARGURA: 3210, SITUACAO: 'Ativo' },
      { CODIGO: 3, NOME_PRODUTO: 'FECHADURA TETRA', FORNECEDOR: 'FORN C', UNIDADE: 'Peça', VALOR: 20, IPI: 0, FRETE: 0, PERDA: '', TAMANHO: 0, ALTURA: 0, LARGURA: 0, SITUACAO: 'Ativo' },
      { CODIGO: 4, NOME_PRODUTO: 'PUXADOR CONCHA', FORNECEDOR: 'FORN C', UNIDADE: 'Peça', VALOR: 15, IPI: 0, FRETE: 0, PERDA: '', TAMANHO: 0, ALTURA: 0, LARGURA: 0, SITUACAO: 'Ativo' }
    ],
    compras: [
      { id: 1, NOTA_FISCAL: '500', DATA: mesesAtras(2), FABRICANTE: 'FORN A', NOME_PRODUTO: 'PERFIL 1036 BARRA', QTD: 10, VALOR_UNITARIO: 60 },
      { id: 2, NOTA_FISCAL: '510', DATA: mesesAtras(1), FABRICANTE: 'FORN A', NOME_PRODUTO: 'perfil 1036 barra ', QTD: 20, VALOR_UNITARIO: 66 },
      { id: 3, NOTA_FISCAL: '480', DATA: mesesAtras(8), FABRICANTE: 'FORN B', NOME_PRODUTO: 'CHAPA VIDRO 4MM', QTD: 4, VALOR_UNITARIO: 300 },
      { id: 4, NOTA_FISCAL: '520', DATA: mesesAtras(1), FABRICANTE: 'FORN A', NOME_PRODUTO: 'PERFIL 1036 BARRA', QTD: 0, VALOR_UNITARIO: 60 }
    ],
    ligacoes: [
      { id: 1, material_codigo: 100, estoque_codigo: 1, fator: '6.000000', confirmado_em: '2026-10-01 10:00:00', confirmado_por: 'Thiago' },
      { id: 2, material_codigo: 101, estoque_codigo: 2, fator: '7.062000', confirmado_em: '2026-10-01 10:00:00', confirmado_por: 'Thiago' }
    ],
    configs: [{ material_codigo: 103, unidade_venda: null, sem_compra: 1 }],
    parametros: [],
    auditoria: [],
    // formação do VALOR_FIXO
    clientes: [
      { COMISSAO: '5', DESCONTO: 28, TIPO_DESCONTO: 'Desconto fixo' }, { COMISSAO: '5%', DESCONTO: 28, TIPO_DESCONTO: 'Desconto fixo' },
      { COMISSAO: '3', DESCONTO: 40, TIPO_DESCONTO: 'Desconto fixo' }, { COMISSAO: 'abc', DESCONTO: 50, TIPO_DESCONTO: 'Desconto progressivo' },
      { COMISSAO: null, DESCONTO: 0, TIPO_DESCONTO: '' }
    ],
    fluxoGrupos: [
      { classificacaoId: 1, nome: 'Despesas › Aluguel', COMPORTAMENTO: 'Fixo', ENTRA_DRE: 1, SITUACAO: 'Pago', total: 120000 },
      { classificacaoId: 2, nome: 'Despesas › Fornecedores', COMPORTAMENTO: 'Variável', ENTRA_DRE: 1, SITUACAO: 'Pago', total: 500000 },
      { classificacaoId: 3, nome: 'Receitas › Vendas', COMPORTAMENTO: null, ENTRA_DRE: 1, SITUACAO: 'Recebido', total: 1000000 },
      { classificacaoId: 4, nome: 'Receitas › Empréstimo', COMPORTAMENTO: null, ENTRA_DRE: 0, SITUACAO: 'Recebido', total: 200000 },
      { classificacaoId: null, nome: null, COMPORTAMENTO: null, ENTRA_DRE: null, SITUACAO: 'Recebido', total: 200000 }
    ],
    encargos: [],
    componentes: [],
    margens: [],
    historico: []
  };
  // premissas da conversa: imposto 8,5 · comissão 5 · custo fixo 20 · desconto 28 · margem 15
  estado.parametros.push(...[['imposto_pct', '8.5'], ['comissao_pct', '5'], ['custo_fixo_pct', '20'], ['desconto_pct', '28'], ['margem_pct', '15']]
    .map(([chave, valor]) => ({ chave, valor })));
  let proxId = 100;
  const regras = [
    // formação do VALOR_FIXO (antes das regras genéricas de cadastro_de_produtos)
    [/FROM cadastro_clientes/, () => estado.clientes.map(c => ({ ...c }))],
    [/FROM fluxo_de_caixa f/, () => estado.fluxoGrupos.map(g => ({ ...g }))],
    [/^SELECT .*FROM web_preco_encargos WHERE id = \?/, (sql, [id]) => estado.encargos.filter(e => e.id === Number(id)).map(e => ({ ...e }))],
    [/^SELECT .*FROM web_preco_encargos/, () => estado.encargos.map(e => ({ ...e }))],
    [/INSERT INTO web_preco_encargos/, (sql, [nome, pct, atualizado_em, atualizado_por]) => {
      const id = ++proxId; estado.encargos.push({ id, nome, pct: String(pct), ativo: 1, atualizado_em, atualizado_por }); return { insertId: id, affectedRows: 1 }; }],
    [/UPDATE web_preco_encargos SET/, (sql, [nome, pct, ativo, atualizado_em, atualizado_por, id]) => {
      const e = estado.encargos.find(x => x.id === Number(id)); if (e) Object.assign(e, { nome, pct: String(pct), ativo, atualizado_em, atualizado_por });
      return { affectedRows: e ? 1 : 0 }; }],
    [/DELETE FROM web_preco_encargos WHERE id = \?/, (sql, [id]) => {
      const i = estado.encargos.findIndex(e => e.id === Number(id)); if (i >= 0) estado.encargos.splice(i, 1); return { affectedRows: i >= 0 ? 1 : 0 }; }],
    [/^SELECT .*FROM web_preco_margens/, () => estado.margens.map(m => ({ ...m }))],
    [/INSERT INTO web_preco_margens/, (sql, [escopo, chave, margem_pct, atualizado_em, atualizado_por]) => {
      const m = estado.margens.find(x => x.escopo === escopo && x.chave === chave);
      if (m) Object.assign(m, { margem_pct: String(margem_pct), atualizado_em, atualizado_por });
      else estado.margens.push({ id: ++proxId, escopo, chave, margem_pct: String(margem_pct), atualizado_em, atualizado_por });
      return { affectedRows: 1 }; }],
    [/DELETE FROM web_preco_margens WHERE escopo = \? AND chave = \?/, (sql, [escopo, chave]) => {
      const i = estado.margens.findIndex(m => m.escopo === escopo && m.chave === chave); if (i >= 0) estado.margens.splice(i, 1); return { affectedRows: i >= 0 ? 1 : 0 }; }],
    [/^SELECT .*FROM web_preco_historico WHERE id = \?/, (sql, [id]) => estado.historico.filter(h => h.id === Number(id)).map(h => ({ ...h }))],
    [/^SELECT MAX\(id\) AS ultimo FROM web_preco_historico WHERE material_codigo = \? AND desfeito_em IS NULL/, (sql, [c]) => {
      const ids = estado.historico.filter(h => h.material_codigo === Number(c) && !h.desfeito_em).map(h => h.id);
      return [{ ultimo: ids.length ? Math.max(...ids) : null }]; }],
    [/^SELECT .*FROM web_preco_historico WHERE material_codigo = \?/, (sql, [c]) => estado.historico.filter(h => h.material_codigo === Number(c))
      .sort((a, b) => b.id - a.id).slice(0, 20).map(h => ({ ...h }))],
    [/INSERT INTO web_preco_historico/, (sql, [lote, material_codigo, valor_anterior, valor_novo, custo, memoria, gravado_em, gravado_por]) => {
      const id = ++proxId; estado.historico.push({ id, lote, material_codigo, valor_anterior, valor_novo, custo, memoria, gravado_em, gravado_por, desfeito_em: null, desfeito_por: null });
      return { insertId: id, affectedRows: 1 }; }],
    [/UPDATE web_preco_historico SET desfeito_em/, (sql, [desfeito_em, desfeito_por, id]) => {
      const h = estado.historico.find(x => x.id === Number(id)); if (h) Object.assign(h, { desfeito_em, desfeito_por }); return { affectedRows: h ? 1 : 0 }; }],
    [/FROM cadastro_de_produtos WHERE CODIGO IN \(.*FOR UPDATE/, (sql, cods) => estado.materiais.filter(m => cods.map(Number).includes(m.CODIGO))
      .map(m => ({ CODIGO: m.CODIGO, VALOR_FIXO: m.VALOR_FIXO }))],
    [/UPDATE cadastro_de_produtos SET VALOR_FIXO = \? WHERE CODIGO = \?/, (sql, [v, c]) => {
      const m = estado.materiais.find(x => x.CODIGO === Number(c)); if (m) m.VALOR_FIXO = v; return { affectedRows: m ? 1 : 0 }; }],
    [/DELETE FROM web_custo_parametros WHERE chave = \?/, (sql, [chave]) => {
      const i = estado.parametros.findIndex(p => p.chave === chave); if (i >= 0) estado.parametros.splice(i, 1); return { affectedRows: i >= 0 ? 1 : 0 }; }],
    // composição
    [/^SELECT .*FROM web_custo_componentes WHERE id = \?/, (sql, [id]) => estado.componentes.filter(c => c.id === Number(id)).map(c => ({ ...c }))],
    [/^SELECT .*FROM web_custo_componentes/, () => estado.componentes.map(c => ({ ...c }))],
    [/INSERT INTO web_custo_componentes/, (sql, [material_codigo, nome, quantidade, custo_informado, informado_em, informado_por, ordem, atualizado_em, atualizado_por]) => {
      const id = ++proxId; estado.componentes.push({ id, material_codigo, nome, participacao_pct: '100.000', quantidade: String(quantidade),
        custo_informado: custo_informado === null ? null : String(custo_informado), informado_em, informado_por, ordem, atualizado_em, atualizado_por });
      return { insertId: id, affectedRows: 1 }; }],
    [/UPDATE web_custo_componentes SET nome = \?, quantidade = \?/, (sql, [nome, quantidade, custo_informado, informado_em, informado_por, atualizado_em, atualizado_por, id]) => {
      const c = estado.componentes.find(x => x.id === Number(id)); if (c) Object.assign(c, { nome, quantidade: String(quantidade),
        custo_informado: custo_informado === null ? null : String(custo_informado), informado_em, informado_por, atualizado_em, atualizado_por });
      return { affectedRows: c ? 1 : 0 }; }],
    [/DELETE FROM web_custo_componentes WHERE id = \?/, (sql, [id]) => {
      const i = estado.componentes.findIndex(c => c.id === Number(id)); if (i >= 0) estado.componentes.splice(i, 1); return { affectedRows: i >= 0 ? 1 : 0 }; }],
    [/UPDATE web_custo_ligacoes SET componente_id = \? WHERE material_codigo = \? AND componente_id IS NULL/, (sql, [cid, mat]) => {
      const ls = estado.ligacoes.filter(l => l.material_codigo === Number(mat) && (l.componente_id ?? null) === null); ls.forEach(l => { l.componente_id = cid; });
      return { affectedRows: ls.length }; }],
    [/DELETE FROM web_custo_ligacoes WHERE componente_id = \?/, (sql, [cid]) => {
      const antes = estado.ligacoes.length; estado.ligacoes = estado.ligacoes.filter(l => l.componente_id !== Number(cid)); return { affectedRows: antes - estado.ligacoes.length }; }],
    [/SELECT COUNT\(\*\) AS n FROM web_custo_ligacoes WHERE componente_id = \?/, (sql, [cid]) => [{ n: estado.ligacoes.filter(l => l.componente_id === Number(cid)).length }]],
    [/FROM web_custo_parametros/, () => estado.parametros.map(p => ({ ...p }))],
    [/FROM cadastro_de_produtos WHERE CODIGO = \?/, (sql, [c]) => estado.materiais.filter(m => m.CODIGO === Number(c)).map(m => ({ CODIGO: m.CODIGO }))],
    [/FROM cadastro_de_produtos/, () => estado.materiais.map(m => ({ ...m }))],
    [/FROM estoque WHERE CODIGO = \?/, (sql, [c]) => estado.itens.filter(i => i.CODIGO === Number(c)).map(i => ({ CODIGO: i.CODIGO }))],
    [/^SELECT id FROM web_custo_ligacoes WHERE material_codigo = \?/, (sql, [c]) => estado.ligacoes.filter(l => l.material_codigo === Number(c)).map(l => ({ id: l.id }))],
    [/^SELECT .*FROM web_custo_ligacoes WHERE id = \?/, (sql, [id]) => estado.ligacoes.filter(l => l.id === Number(id)).map(l => ({ ...l }))],
    [/FROM web_custo_material WHERE material_codigo = \?/, (sql, [c]) => estado.configs.filter(x => x.material_codigo === Number(c)).map(x => ({ ...x }))],
    [/FROM estoque WHERE NOME_PRODUTO LIKE/, (sql, [like]) => {
      const q = String(like).replace(/%/g, '').toLowerCase();
      return estado.itens.filter(i => i.NOME_PRODUTO.toLowerCase().includes(q)).slice(0, 30).map(i => ({ ...i })); }],
    [/FROM estoque/, () => estado.itens.map(i => ({ ...i }))],
    [/^SELECT .*FROM web_custo_ligacoes/, () => estado.ligacoes.map(l => ({ ...l }))],
    [/FROM web_custo_material/, () => estado.configs.map(c => ({ ...c }))],
    [/FROM entrada_estoque WHERE NOME_PRODUTO IN/, (sql, nomes) => estado.compras.filter(c => nomes.some(n => igualMySQL(n, c.NOME_PRODUTO)))
      .sort((a, b) => (a.DATA < b.DATA ? -1 : a.DATA > b.DATA ? 1 : a.id - b.id)).map(c => ({ ...c }))],
    // escrita (Task 5)
    [/INSERT INTO web_custo_ligacoes/, (sql, [material_codigo, estoque_codigo, fator, confirmado_em, confirmado_por, componente_id = null]) => {
      if (estado.ligacoes.some(l => l.material_codigo === material_codigo && l.estoque_codigo === estoque_codigo))
        throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      const id = ++proxId; estado.ligacoes.push({ id, material_codigo, estoque_codigo, fator: String(fator), confirmado_em, confirmado_por, componente_id }); return { insertId: id, affectedRows: 1 }; }],
    [/DELETE FROM web_custo_ligacoes WHERE id = \?/, (sql, [id]) => {
      const i = estado.ligacoes.findIndex(l => l.id === Number(id)); if (i >= 0) estado.ligacoes.splice(i, 1); return { affectedRows: i >= 0 ? 1 : 0 }; }],
    [/INSERT INTO web_custo_material/, (sql, [material_codigo, unidade_venda, sem_compra, atualizado_em, atualizado_por]) => {
      const c = estado.configs.find(x => x.material_codigo === material_codigo);
      if (c) Object.assign(c, { unidade_venda, sem_compra, atualizado_em, atualizado_por });
      else estado.configs.push({ material_codigo, unidade_venda, sem_compra, atualizado_em, atualizado_por });
      return { affectedRows: 1 }; }],
    [/INSERT INTO web_custo_parametros/, (sql, [chave, valor]) => {
      const p = estado.parametros.find(x => x.chave === chave); if (p) p.valor = valor; else estado.parametros.push({ chave, valor }); return { affectedRows: 1 }; }],
    [/INSERT INTO web_auditoria/, (sql, params) => { estado.auditoria.push(params); return { insertId: estado.auditoria.length }; }]
  ];
  const f = criarPoolFalso(regras);
  return { f, estado, ...estado };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararCustos(t, { perfil = 'Administrador', banco = bancoCustos() } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Thiago', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados: [], ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(7, 'Thiago'), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { banco, chamar };
}

module.exports = { bancoCustos, prepararCustos, mesesAtras };
