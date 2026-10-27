// Banco simulado com estado para as rotas do plano de corte (rotas/corte.js).
// Cada regra imita um SQL da rota; as listas em memória são o "banco". O rollback do pool falso não desfaz estas listas:
// os testes de atomicidade conferem que a rota valida ANTES de gravar.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const transacao = require('../../rotas/transacao');
const { app, pool, acesso } = require('../../index.js');

const PERFIS = {
  'Corte': ['corte.ver', 'corte.planejar', 'corte.parametros'],
  'Só ver corte': ['corte.ver'],
  'Planeja': ['corte.ver', 'corte.planejar'],
  'Só planejar': ['corte.planejar'],
  'Só parâmetros': ['corte.parametros'],
  'Sem acesso': ['pedidos.ver']
};

function bancoCorte() {
  const estado = { config: [], retalhos: [], auditoria: [] };
  const { config, retalhos, auditoria } = estado;
  let proxConfig = 1, proxRetalho = 1;
  const formatarRetalho = r => ({ id: r.id, perfil: r.perfil, acabamento: r.acabamento, cor: r.cor, comprimento: r.comprimento, situacao: r.situacao,
    plano_origem: r.plano_origem ?? null, plano_reserva: r.plano_reserva ?? null, criado_em: r.criado_em ?? null });

  const regras = [
    [/^INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    // parâmetros
    [/^SELECT perfil, comprimento_vara, serra, sobra_minima FROM web_corte_config/, () => config.map(c => ({ ...c })).sort((a, b) => a.perfil.localeCompare(b.perfil))],
    [/^SELECT id FROM web_corte_config WHERE perfil = \?/, (sql, [perfil]) => config.filter(c => c.perfil === perfil).map(c => ({ id: c.id }))],
    [/^UPDATE web_corte_config SET/, (sql, [comprimento_vara, serra, sobra_minima, , , id]) => { Object.assign(config.find(c => c.id === id), { comprimento_vara, serra, sobra_minima }); return { affectedRows: 1 }; }],
    [/^INSERT INTO web_corte_config/, (sql, [perfil, comprimento_vara, serra, sobra_minima]) => { config.push({ id: proxConfig++, perfil, comprimento_vara, serra, sobra_minima }); return { affectedRows: 1 }; }],
    // retalhos
    [/^SELECT id, perfil, acabamento, cor, comprimento, situacao, plano_origem, plano_reserva, criado_em FROM web_retalhos/, (sql, params) => {
      const filtro = /WHERE situacao = \?/.test(sql) ? params[0] : null;
      return retalhos.filter(r => !filtro || r.situacao === filtro).map(formatarRetalho)
        .sort((a, b) => a.perfil.localeCompare(b.perfil) || a.comprimento - b.comprimento || a.id - b.id);
    }],
    [/^INSERT INTO web_retalhos/, (sql, [perfil, acabamento, cor, comprimento, criado_por, criado_em]) => {
      const r = { id: proxRetalho++, perfil, acabamento, cor, comprimento, situacao: 'disponivel', criado_por, criado_em };
      retalhos.push(r); return { insertId: r.id, affectedRows: 1 };
    }],
    [/^SELECT id, situacao FROM web_retalhos WHERE id = \?/, (sql, [id]) => retalhos.filter(r => r.id === Number(id)).map(r => ({ id: r.id, situacao: r.situacao }))],
    [/^UPDATE web_retalhos SET perfil = \?/, (sql, [perfil, acabamento, cor, comprimento, , id]) => { Object.assign(retalhos.find(r => r.id === id), { perfil, acabamento, cor, comprimento }); return { affectedRows: 1 }; }],
    [/^UPDATE web_retalhos SET situacao = 'descartado'/, (sql, [, id]) => { retalhos.find(r => r.id === id).situacao = 'descartado'; return { affectedRows: 1 }; }]
  ];
  const f = criarPoolFalso(regras);
  const semear = {
    retalho: (x = {}) => { const r = { id: proxRetalho++, perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural', comprimento: 1500, situacao: 'disponivel', ...x }; retalhos.push(r); return r; }
  };
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararCorte(t, { perfil = 'Corte', usuario = { codigo: 7, nome: 'Caio' }, banco = bancoCorte(), hoje = '2026-10-15' } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: usuario.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados: [], ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(transacao, 'hojeLocal', () => hoje);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(usuario.codigo, usuario.nome), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { banco, chamar };
}

module.exports = { bancoCorte, prepararCorte, PERFIS };
