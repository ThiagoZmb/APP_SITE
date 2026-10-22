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
  'Sem valores': ['precos.ver']
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
    auditoria: []
  };
  let proxId = 100;
  const regras = [
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
    [/INSERT INTO web_custo_ligacoes/, (sql, [material_codigo, estoque_codigo, fator, confirmado_em, confirmado_por]) => {
      if (estado.ligacoes.some(l => l.material_codigo === material_codigo && l.estoque_codigo === estoque_codigo))
        throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      const id = ++proxId; estado.ligacoes.push({ id, material_codigo, estoque_codigo, fator: String(fator), confirmado_em, confirmado_por }); return { insertId: id, affectedRows: 1 }; }],
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
