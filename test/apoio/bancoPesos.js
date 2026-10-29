// Banco simulado com estado para as rotas de peso (rotas/pesos.js).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');

const PERFIS = {
  'Pesos': ['pesos.ver', 'pesos.editar'],
  'Somente ver pesos': ['pesos.ver'],
  'Sem acesso': ['pedidos.ver']
};

function bancoPesos() {
  const estado = { pesos: [], produtos: [], auditoria: [] };
  const { pesos, produtos, auditoria } = estado;
  let proximoId = 1;
  const chave = s => String(s ?? '').trim().toLowerCase();
  const sqlLike = (v, c) => String(c ?? '').toLowerCase().includes(String(v).replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase());
  const linhaDe = x => ({ ...x });

  const regras = [
    [/INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    [/^SELECT DISTINCT MODELO AS nome FROM cadastro_de_produtos/, (sql, classes) =>
      [...new Set(produtos.filter(p => p.SITUACAO === 'Ativo' && classes.includes(p.CLASSE)).map(p => p.MODELO))].sort().map(nome => ({ nome }))],
    [/^SELECT produto FROM web_pesos WHERE tipo = \?/, (sql, [tipo]) => pesos.filter(x => x.tipo === tipo).map(x => ({ produto: x.produto }))],
    [/^SELECT id, tipo, produto, unidade_peso[\s\S]*FROM web_pesos/, (sql, params) => {
      const p = [...params];
      const tipo = sql.includes('tipo = ?') ? p.shift() : null;
      const q = sql.includes('LIKE') ? p.shift() : null;
      return pesos.filter(x => (tipo === null || x.tipo === tipo) && (q === null || sqlLike(q, x.produto)))
        .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.produto.localeCompare(b.produto, 'pt-BR')).map(linhaDe);
    }],
    [/^SELECT id, unidade_peso, valor FROM web_pesos WHERE tipo = \? AND produto = \?/, (sql, [tipo, produto]) =>
      pesos.filter(x => x.tipo === tipo && chave(x.produto) === chave(produto)).map(linhaDe)],
    [/^SELECT id, tipo, produto FROM web_pesos WHERE id = \?/, (sql, [id]) => pesos.filter(x => x.id === Number(id)).map(linhaDe)],
    [/^INSERT INTO web_pesos/, (sql, [tipo, produto, unidade_peso, valor, atualizado_por, atualizado_em]) => {
      const id = proximoId++;
      pesos.push({ id, tipo, produto, unidade_peso, valor, atualizado_por, atualizado_em });
      return { affectedRows: 1, insertId: id };
    }],
    [/^UPDATE web_pesos SET/, (sql, [unidade_peso, valor, atualizado_por, atualizado_em, id]) => {
      Object.assign(pesos.find(x => x.id === id), { unidade_peso, valor, atualizado_por, atualizado_em });
      return { affectedRows: 1 };
    }],
    [/^DELETE FROM web_pesos WHERE id = \?/, (sql, [id]) => {
      const i = pesos.findIndex(x => x.id === Number(id));
      if (i >= 0) pesos.splice(i, 1);
      return { affectedRows: i >= 0 ? 1 : 0 };
    }]
  ];
  const f = criarPoolFalso(regras);
  const semear = {
    produto: (MODELO, CLASSE, SITUACAO = 'Ativo') => { const r = { MODELO, CLASSE, SITUACAO }; produtos.push(r); return r; },
    peso: (x = {}) => { const r = { id: proximoId++, tipo: 'perfil', produto: 'Perfil 30', unidade_peso: 'kg_m', valor: 1.2, atualizado_por: 'x', atualizado_em: '2026-10-01 10:00:00', ...x }; pesos.push(r); return r; }
  };
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararPesos(t, { perfil = 'Pesos', usuario = { codigo: 7, nome: 'Caio' }, banco = bancoPesos() } = {}) {
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

module.exports = { bancoPesos, prepararPesos, PERFIS };
