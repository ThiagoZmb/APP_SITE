// Banco simulado com estado para as rotas de tintas (rotas/tintas.js).
// Cada regra imita um SQL da rota; as listas em memória são o "banco".
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');

const PERFIS = {
  'Tintas': ['tintas.ver', 'tintas.editar'],
  'Tintas com valores': ['tintas.ver', 'tintas.editar', 'valores.ver'],
  'Somente ver tintas': ['tintas.ver'],
  'Sem acesso': ['pedidos.ver']
};
// ordem dos parâmetros do UPDATE (e do INSERT depois do COD) na rota
const COLUNAS = ['RAZAO_FABRICANTE', 'CLASSE', 'VALOR', 'PORCENTAGEM', 'REF_FABRICANTE', 'COR_ELEGANCE', 'TIPO', 'CONJUNTO', 'COR', 'RENDIMENTO'];

function bancoTintas() {
  const estado = { tintas: [], fornecedores: [], auditoria: [] };
  const { tintas, fornecedores, auditoria } = estado;
  const sqlLike = (v, ...campos) => { const t = String(v).replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase(); return campos.some(c => String(c ?? '').toLowerCase().includes(t)); };
  const chave = s => String(s ?? '').trim().toLowerCase();

  const regras = [
    [/INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    [/^SELECT RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE <> '\.' ORDER BY/, () =>
      fornecedores.filter(f => f.RAZAO_FABRICANTE !== '.').map(f => ({ RAZAO_FABRICANTE: f.RAZAO_FABRICANTE })).sort((a, b) => a.RAZAO_FABRICANTE.localeCompare(b.RAZAO_FABRICANTE, 'pt-BR'))],
    [/^SELECT COD FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE = \?/, (sql, [razao]) =>
      fornecedores.filter(f => f.RAZAO_FABRICANTE !== '.' && f.RAZAO_FABRICANTE === razao).map(f => ({ COD: f.COD }))],
    [/^SELECT COD, RAZAO_FABRICANTE, CLASSE[\s\S]*FROM tintas/, (sql, params) => {
      const p = [...params];
      const classe = sql.includes('CLASSE = ?') ? p.shift() : null;
      const busca = sql.includes('LIKE') ? p.shift() : null;
      return tintas.filter(x => (classe === null || x.CLASSE === classe) && (busca === null || sqlLike(busca, x.REF_FABRICANTE, x.COR_ELEGANCE)))
        .sort((a, b) => String(a.REF_FABRICANTE).localeCompare(b.REF_FABRICANTE, 'pt-BR'));
    }],
    [/^SELECT \* FROM tintas WHERE COD = \?/, (sql, [cod]) => tintas.filter(x => x.COD === Number(cod)).map(x => ({ ...x }))],
    [/^SELECT COD FROM tintas WHERE REF_FABRICANTE = \?/, (sql, [ref]) => tintas.filter(x => chave(x.REF_FABRICANTE) === chave(ref)).map(x => ({ COD: x.COD }))],
    [/^SELECT COALESCE\(MAX\(COD\), 0\) \+ 1 AS proximo FROM tintas/, () => [{ proximo: tintas.reduce((m, x) => Math.max(m, x.COD), 0) + 1 }]],
    [/^INSERT INTO tintas/, (sql, [cod, ...resto]) => {
      const x = { COD: cod };
      COLUNAS.forEach((c, i) => { x[c] = resto[i]; });
      tintas.push(x); return { affectedRows: 1 };
    }],
    [/^UPDATE tintas SET/, (sql, params) => {
      const x = tintas.find(y => y.COD === params[COLUNAS.length]);
      COLUNAS.forEach((c, i) => { x[c] = params[i]; });
      return { affectedRows: 1 };
    }],
    [/^DELETE FROM tintas WHERE COD = \?/, (sql, [cod]) => {
      const i = tintas.findIndex(x => x.COD === Number(cod));
      if (i >= 0) tintas.splice(i, 1);
      return { affectedRows: i >= 0 ? 1 : 0 };
    }]
  ];
  const f = criarPoolFalso(regras);
  let proximoForn = 1;
  const semear = {
    tinta: (x = {}) => {
      const r = { COD: tintas.reduce((m, y) => Math.max(m, y.COD), 0) + 1, RAZAO_FABRICANTE: 'Sayerlack', CLASSE: 'Verniz', VALOR: 40, PORCENTAGEM: 50, REF_FABRICANTE: 'TX-10',
        COR_ELEGANCE: 'Branco Gelo', TIPO: 'Verniz Fosco', CONJUNTO: 'Conjunto Vidro', COR: 'FFFFFFFF', RENDIMENTO: 8, ...x };
      tintas.push(r); return r;
    },
    fornecedor: (razao = 'Sayerlack') => { const r = { COD: proximoForn++, RAZAO_FABRICANTE: razao }; fornecedores.push(r); return r; }
  };
  semear.fornecedor('Sayerlack');
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararTintas(t, { perfil = 'Tintas com valores', usuario = { codigo: 7, nome: 'Caio' }, banco = bancoTintas() } = {}) {
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

module.exports = { bancoTintas, prepararTintas, PERFIS };
