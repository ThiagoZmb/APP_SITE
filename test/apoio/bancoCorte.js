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
  const estado = { config: [], retalhos: [], auditoria: [], pedidos: [], perfis: [], itens: [], planos: [] };
  const { config, retalhos, auditoria, pedidos, perfis, itens, planos } = estado;
  let proxConfig = 1, proxRetalho = 1, proxPlano = 1, proxPerfil = 1;
  const formatarRetalho = r => ({ id: r.id, perfil: r.perfil, acabamento: r.acabamento, cor: r.cor, comprimento: r.comprimento, situacao: r.situacao,
    plano_origem: r.plano_origem ?? null, plano_reserva: r.plano_reserva ?? null, criado_em: r.criado_em ?? null });

  const regras = [
    [/^INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    // parâmetros
    [/^SELECT perfil, comprimento_vara, serra, sobra_minima FROM web_corte_config/, () => config.map(c => ({ ...c })).sort((a, b) => a.perfil.localeCompare(b.perfil))],
    [/^SELECT id FROM web_corte_config WHERE perfil = \?/, (sql, [perfil]) => config.filter(c => c.perfil === perfil).map(c => ({ id: c.id }))],
    [/^UPDATE web_corte_config SET/, (sql, [comprimento_vara, serra, sobra_minima, , , id]) => { Object.assign(config.find(c => c.id === id), { comprimento_vara, serra, sobra_minima }); return { affectedRows: 1 }; }],
    [/^INSERT INTO web_corte_config/, (sql, [perfil, comprimento_vara, serra, sobra_minima]) => { config.push({ id: proxConfig++, perfil, comprimento_vara, serra, sobra_minima }); return { affectedRows: 1 }; }],

    // ---- pedido, peças e plano ----
    [/^SELECT NUMERO, RAZAO_SOCIAL, SITUACAO FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido'/, (sql, [n]) =>
      pedidos.filter(p => p.NUMERO === Number(n)).map(p => ({ NUMERO: p.NUMERO, RAZAO_SOCIAL: p.RAZAO_SOCIAL, SITUACAO: p.SITUACAO }))],
    [/^SELECT id, ITEM, QTD_PORTAS, PERFIL, QTD_ALTURA/, (sql, [n]) => perfis.filter(p => p.NUMERO === Number(n)).sort((a, b) => a.id - b.id)],
    [/^SELECT ITEM_PEDIDO, ITEM, QTD, PERFIL, ACABAMENTO_PERFIL/, (sql, [n]) => itens.filter(p => p.NUMERO === Number(n) && p.TIPO === 'Pedido')
      .sort((a, b) => a.ITEM_PEDIDO - b.ITEM_PEDIDO || a.ITEM - b.ITEM)],
    [/^SELECT id, perfil, acabamento, cor, comprimento FROM web_retalhos WHERE situacao = 'disponivel' OR/, (sql, [planoId]) =>
      retalhos.filter(r => r.situacao === 'disponivel' || (r.situacao === 'reservado' && r.plano_reserva === planoId))
        .map(r => ({ id: r.id, perfil: r.perfil, acabamento: r.acabamento, cor: r.cor, comprimento: r.comprimento })).sort((a, b) => a.id - b.id)],
    [/^SELECT id, situacao, impressao_pecas, criado_por, criado_em, conferido_em FROM web_corte_planos WHERE pedido = \?/, (sql, [n]) => {
      const p = planos.filter(x => x.pedido === Number(n) && x.situacao !== 'cancelado').sort((a, b) => b.id - a.id)[0];
      return p ? [{ id: p.id, situacao: p.situacao, impressao_pecas: p.impressao_pecas, criado_por: p.criado_por, criado_em: p.criado_em, conferido_em: p.conferido_em ?? null }] : [];
    }],
    [/^SELECT id FROM web_corte_planos WHERE pedido = \?/, (sql, [n]) => planos.filter(p => p.pedido === Number(n) && p.situacao === 'gerado').map(p => ({ id: p.id }))],
    [/^UPDATE web_retalhos SET situacao = 'disponivel', plano_reserva = NULL, atualizado_em = \? WHERE plano_reserva = \? AND situacao = 'reservado'/, (sql, [, planoId]) => {
      let n = 0; for (const r of retalhos) if (r.plano_reserva === planoId && r.situacao === 'reservado') { r.situacao = 'disponivel'; r.plano_reserva = null; n++; }
      return { affectedRows: n };
    }],
    [/^UPDATE web_corte_planos SET situacao = 'cancelado' WHERE id = \?/, (sql, [id]) => { planos.find(p => p.id === id).situacao = 'cancelado'; return { affectedRows: 1 }; }],
    [/^INSERT INTO web_corte_planos/, (sql, [pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em]) => {
      const p = { id: proxPlano++, pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em, conferido_por: null, conferido_em: null };
      planos.push(p); return { insertId: p.id, affectedRows: 1 };
    }],
    [/^UPDATE web_retalhos SET situacao = 'reservado'/, (sql, [planoId, , id]) => {
      const r = retalhos.find(x => x.id === id);
      if (!r || r.situacao !== 'disponivel') return { affectedRows: 0 };
      r.situacao = 'reservado'; r.plano_reserva = planoId; return { affectedRows: 1 };
    }],
    [/^SELECT id, pedido, situacao, impressao_pecas, parametros, resultado, progresso/, (sql, [id]) => planos.filter(p => p.id === Number(id)).map(p => ({ ...p }))],
    [/^UPDATE web_corte_planos SET progresso = \?/, (sql, [progresso, id]) => {
      const p = planos.find(x => x.id === id); if (!p || p.situacao !== 'gerado') return { affectedRows: 0 };
      p.progresso = progresso; return { affectedRows: 1 };
    }],
    [/^UPDATE web_retalhos SET situacao = 'usado'/, (sql, [, id, planoId]) => {
      const r = retalhos.find(x => x.id === id); if (!r || r.situacao !== 'reservado' || r.plano_reserva !== planoId) return { affectedRows: 0 };
      r.situacao = 'usado'; return { affectedRows: 1 };
    }],
    [/^UPDATE web_retalhos SET situacao = 'disponivel', plano_reserva = NULL, atualizado_em = \? WHERE id = \?/, (sql, [, id, planoId]) => {
      const r = retalhos.find(x => x.id === id); if (!r || r.situacao !== 'reservado' || r.plano_reserva !== planoId) return { affectedRows: 0 };
      r.situacao = 'disponivel'; r.plano_reserva = null; return { affectedRows: 1 };
    }],
    [/^UPDATE web_corte_planos SET situacao = 'conferido'/, (sql, [quem, agora, id]) => {
      const p = planos.find(x => x.id === id); if (!p || p.situacao !== 'gerado') return { affectedRows: 0 };
      Object.assign(p, { situacao: 'conferido', conferido_por: quem, conferido_em: agora }); return { affectedRows: 1 };
    }],
    // retalhos
    [/^SELECT id, perfil, acabamento, cor, comprimento, situacao, plano_origem, plano_reserva, criado_em FROM web_retalhos/, (sql, params) => {
      const filtro = /WHERE situacao = \?/.test(sql) ? params[0] : null;
      return retalhos.filter(r => !filtro || r.situacao === filtro).map(formatarRetalho)
        .sort((a, b) => a.perfil.localeCompare(b.perfil) || a.comprimento - b.comprimento || a.id - b.id);
    }],
    [/^INSERT INTO web_retalhos \(perfil, acabamento, cor, comprimento, situacao, plano_origem/, (sql, [perfil, acabamento, cor, comprimento, plano_origem, criado_por, criado_em]) => {
      const r = { id: proxRetalho++, perfil, acabamento, cor, comprimento, situacao: 'disponivel', plano_origem, criado_por, criado_em };
      retalhos.push(r); return { insertId: r.id, affectedRows: 1 };
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
    pedido: (x = {}) => { const r = { NUMERO: 100, RAZAO_SOCIAL: 'Cliente X', SITUACAO: 'Em Produção', ...x }; pedidos.push(r); return r; },
    perfil: (x = {}) => { const r = { id: proxPerfil++, NUMERO: 100, ITEM: 1, QTD_PORTAS: 2, PERFIL: 'P100', QTD_ALTURA: 2, TAM_ALTURA: 2100, QTD_LARGURA: 2, TAM_LARGURA: 900,
      PUXADOR: null, QTD_PUXADOR: 0, TAM_PUXADOR: 0, ...x }; perfis.push(r); return r; },
    item: (x = {}) => { const r = { NUMERO: 100, TIPO: 'Pedido', ITEM_PEDIDO: 1, ITEM: 1, QTD: 2, PERFIL: 'P100', ACABAMENTO_PERFIL: 'Anodizado', COR_PERFIL: 'Natural',
      PUXADOR: null, ACABAMENTO_PUXADOR: null, COR_PUXADOR: null, DIVISOR: null, ACABAMENTO_DIVISOR: null, COR_DIVISOR: null,
      QTD_HORIZONTAL: 0, QTD_VERTICAL: 0, TAM_DIV_HORIZONTAL: 0, TAM_DIV_VERTICAL: 0, ...x }; itens.push(r); return r; },
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
