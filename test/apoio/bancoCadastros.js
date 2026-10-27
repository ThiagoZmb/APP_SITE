// Banco simulado com estado para as rotas de fornecedores e funcionários (rotas/fornecedores.js e rotas/funcionarios.js).
// Cada regra imita um SQL da rota; as listas em memória são o "banco".
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');
const { DINHEIRO_FUNCIONARIO } = require('../../calculo/cadastros');

const PERFIS = {
  'Compras': ['fornecedores.ver', 'fornecedores.editar'],
  'Somente ver fornecedores': ['fornecedores.ver'],
  'RH': ['funcionarios.ver', 'funcionarios.editar'],
  'RH com valores': ['funcionarios.ver', 'funcionarios.editar', 'valores.ver'],
  'Somente ver funcionários': ['funcionarios.ver'],
  'Sem acesso': ['pedidos.ver']
};
const COLUNAS_FORNECEDOR = ['RAZAO_FABRICANTE', 'FANTASIA', 'ENDERECO', 'NUMERO', 'BAIRRO', 'CIDADE', 'ESTADO', 'STATUS', 'CEP', 'EMAIL', 'TELEFONE', 'CNPJ', 'INSCRICAO_ESTADUAL', 'CLASSE'];
const COLUNAS_TEXTO_FUNC = ['SITUACAO', 'NOME', 'ENDERECO', 'BAIRRO', 'CIDADE', 'ESTADO', 'CEP', 'TELEFONE', 'IDENTIDADE', 'CPF', 'CARGO'];
const COLUNAS_DINHEIRO = DINHEIRO_FUNCIONARIO.map(([, c]) => c);

function bancoCadastros() {
  const estado = {
    fornecedores: [],  // cadastro_fornecedores
    funcionarios: [],  // funcionarios
    cargos: [{ CARGO: 'Auxiliar' }, { CARGO: 'Serralheiro' }],
    auditoria: []
  };
  const { fornecedores, funcionarios, auditoria } = estado;
  let proximoCod = 1, proximoFunc = 1;
  const sqlLike = (v, ...campos) => { const t = String(v).replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase(); return campos.some(c => String(c ?? '').toLowerCase().includes(t)); };

  const regras = [
    [/INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],

    // ---- fornecedores ----
    [/^SELECT COD, RAZAO_FABRICANTE, FANTASIA[\s\S]*FROM cadastro_fornecedores/, (sql, params) => {
      const p = [...params];
      const status = sql.includes('STATUS = ?') ? p.shift() : null;
      const busca = sql.includes('LIKE') ? p.shift() : null;
      return fornecedores.filter(f => f.RAZAO_FABRICANTE !== '.' && (status === null || f.STATUS === status)
        && (busca === null || sqlLike(busca, f.RAZAO_FABRICANTE, f.FANTASIA, f.CNPJ, f.CIDADE)))
        .sort((a, b) => String(a.RAZAO_FABRICANTE).localeCompare(b.RAZAO_FABRICANTE, 'pt-BR'));
    }],
    [/^SELECT \* FROM cadastro_fornecedores WHERE COD = \?/, (sql, [cod]) => fornecedores.filter(f => f.COD === Number(cod)).map(f => ({ ...f }))],
    [/^SELECT COD FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE = \?/, (sql, [razao]) =>
      fornecedores.filter(f => String(f.RAZAO_FABRICANTE).trim().toLowerCase() === String(razao).toLowerCase()).map(f => ({ COD: f.COD }))],
    [/^INSERT INTO cadastro_fornecedores/, (sql, params) => {
      const f = { COD: proximoCod++, CF_CV: '' };
      COLUNAS_FORNECEDOR.forEach((c, i) => { f[c] = params[i]; });
      fornecedores.push(f); return { insertId: f.COD, affectedRows: 1 };
    }],
    [/^UPDATE cadastro_fornecedores SET/, (sql, params) => {
      const f = fornecedores.find(x => x.COD === params[COLUNAS_FORNECEDOR.length]);
      COLUNAS_FORNECEDOR.forEach((c, i) => { f[c] = params[i]; });
      return { affectedRows: 1 };
    }],

    // ---- funcionários ----
    [/^SELECT CODIGO, NOME, CARGO, SITUACAO[\s\S]*FROM funcionarios/, (sql, params) => {
      const p = [...params];
      const situacao = sql.includes('SITUACAO = ?') ? p.shift() : null;
      const busca = sql.includes('LIKE') ? p.shift() : null;
      return funcionarios.filter(f => (situacao === null || f.SITUACAO === situacao) && (busca === null || sqlLike(busca, f.NOME, f.CARGO, f.CIDADE)))
        .sort((a, b) => String(a.NOME).localeCompare(b.NOME, 'pt-BR'));
    }],
    [/^SELECT CARGO FROM cargos/, () => estado.cargos],
    [/^SELECT \* FROM funcionarios WHERE CODIGO = \?/, (sql, [cod]) => funcionarios.filter(f => f.CODIGO === Number(cod)).map(f => ({ ...f }))],
    [/^INSERT INTO funcionarios/, (sql, params) => {
      const f = { CODIGO: proximoFunc++, DARF: 0, SENHA: '' };
      const todas = [...COLUNAS_TEXTO_FUNC, 'INSALUBRIDADE', ...COLUNAS_DINHEIRO, 'NIVEL', 'ADMISSAO', 'DEMISSAO'];
      todas.forEach((c, i) => { f[c] = params[i]; });
      funcionarios.push(f); return { insertId: f.CODIGO, affectedRows: 1 };
    }],
    [/^UPDATE funcionarios SET/, (sql, params) => {
      const todas = [...COLUNAS_TEXTO_FUNC, 'INSALUBRIDADE', ...COLUNAS_DINHEIRO, 'NIVEL', 'ADMISSAO', 'DEMISSAO'];
      const f = funcionarios.find(x => x.CODIGO === params[todas.length]);
      todas.forEach((c, i) => { f[c] = params[i]; });
      return { affectedRows: 1 };
    }]
  ];
  const f = criarPoolFalso(regras);
  const semear = {
    fornecedor: (x = {}) => { const r = { COD: proximoCod++, RAZAO_FABRICANTE: 'ALUMINIO SUL LTDA', FANTASIA: '', ENDERECO: '', NUMERO: '', BAIRRO: '', CIDADE: 'Niterói', ESTADO: 'RJ',
      STATUS: 'Ativo', CEP: '', EMAIL: '', TELEFONE: '', CNPJ: '', INSCRICAO_ESTADUAL: '', CLASSE: 'Matéria prima', CF_CV: '', ...x }; fornecedores.push(r); return r; },
    funcionario: (x = {}) => { const r = { CODIGO: proximoFunc++, SITUACAO: 'Ativo', NOME: 'João da Silva', ENDERECO: '', BAIRRO: '', CIDADE: 'Niterói', ESTADO: 'RJ', CEP: '', TELEFONE: '',
      IDENTIDADE: '', CPF: '', CARGO: 'Serralheiro', INSALUBRIDADE: 0, SALARIO_BASE: 2500, FGTS: 200, FERIAS_1_12: 208.33, FERIAS_FGTS_1_12: 16.67, DECIMO_1_12: 208.33,
      DECIMO_1_12_FGTS: 16.67, ALMOCO: 400, TRANSPORTE: 150, PLANO_SAUDE: 0, SEG_VIDA: 10, OCIOSIDADE: 0, DARF: 0, SENHA: 'segredo-do-vb', NIVEL: 'Serralheiro',
      ADMISSAO: '2024-03-01', DEMISSAO: '2026-10-27', ...x }; funcionarios.push(r); return r; }
  };
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararCadastros(t, { perfil = 'Compras', usuario = { codigo: 7, nome: 'Caio' }, banco = bancoCadastros() } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: usuario.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados: [], ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(usuario.codigo, usuario.nome), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { banco, chamar };
}

module.exports = { bancoCadastros, prepararCadastros, PERFIS };
