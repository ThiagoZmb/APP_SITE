// Banco simulado com estado para as rotas do plano de corte de vidros (rotas/corte_vidros.js).
// Mesmo molde de bancoCorte.js: cada regra imita um SQL da rota; as listas em memória são o "banco";
// o ROLLBACK volta o estado ao do BEGIN (a foto guarda o conteúdo).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const transacao = require('../../rotas/transacao');
const { app, pool, acesso } = require('../../index.js');

const PERFIS = {
  'Corte': ['corte.ver', 'corte.planejar', 'corte.parametros', 'estoque.ver', 'estoque.movimentar'],
  'Só ver corte': ['corte.ver'],
  'Planeja': ['corte.ver', 'corte.planejar', 'estoque.ver', 'estoque.movimentar'],
  'Planeja sem estoque': ['corte.ver', 'corte.planejar'],
  'Planeja, estoque só ver': ['corte.ver', 'corte.planejar', 'estoque.ver'],
  'Sem acesso': ['pedidos.ver']
};

const produto = (CODIGO, NOME_PRODUTO, ALTURA, LARGURA, extra = {}) => ({ CODIGO, NOME_PRODUTO, UNIDADE: 'Chapa', CLASSE: 'Revestimento', SITUACAO: 'Ativo',
  ALTURA, LARGURA, QTD_ESTOQUE: 10, CODIGO_BARRA: String(CODIGO), FORNECEDOR: 'FORN', NOME_PRODUTO_FORNECEDOR: NOME_PRODUTO.toUpperCase(), VALOR: 100, ...extra });

function bancoVidros() {
  // estoque do VB: vidros (Revestimento) ativos, um inativo e um produto de outra classe
  const estoque = [
    produto(10, 'Vidro Incolor 4mm', 3210, 2400, { QTD_ESTOQUE: 26 }),
    produto(11, 'Vidro Extra Clear 4mm - 2400mm', 3210, 2400),
    produto(12, 'Vidro Extra Clear 4mm - 2540mm', 3210, 2540),
    produto(13, 'Vidro Reflecta Fumê 4mm', 3210, 2400),
    produto(14, 'Vidro Antigo 3mm', 3210, 2200, { SITUACAO: 'Inativo' }),
    produto(15, 'Perfil P100', 6000, 0, { CLASSE: 'Perfil', UNIDADE: 'Barra' })
  ];
  const estado = { config: [], retalhos: [], auditoria: [], pedidos: [], vidros: [], itens: [], planos: [], estoque, saidas: [] };
  const { config, retalhos, auditoria, pedidos, vidros, itens, planos } = estado;
  let proxRetalho = 1, proxVidro = 1, proxPlano = 1;
  const formatarRetalho = r => ({ id: r.id, produto_codigo: r.produto_codigo, produto_nome: r.produto_nome, altura: r.altura, largura: r.largura, situacao: r.situacao,
    plano_origem: r.plano_origem ?? null, plano_reserva: r.plano_reserva ?? null, criado_em: r.criado_em ?? null });
  const candidato = e => e.CLASSE === 'Revestimento' && e.SITUACAO === 'Ativo' && Number(e.ALTURA) > 0 && Number(e.LARGURA) > 0;

  const regras = [
    [/^INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    // parâmetros (linha única id = 1, criada pelo upsert)
    [/^SELECT serra, sobra_minima FROM web_vidro_config WHERE id = 1/, () => config.filter(c => c.id === 1).map(c => ({ serra: c.serra, sobra_minima: c.sobra_minima }))],
    [/^INSERT INTO web_vidro_config/, (sql, [serra, sobra_minima, atualizado_em, atualizado_por]) => {
      const atual = config.find(c => c.id === 1);
      if (atual) Object.assign(atual, { serra, sobra_minima, atualizado_em, atualizado_por }); else config.push({ id: 1, serra, sobra_minima, atualizado_em, atualizado_por });
      return { affectedRows: 1 };
    }],

    // ---- estoque do VB ----
    [/^SELECT CODIGO, NOME_PRODUTO, UNIDADE, ALTURA, LARGURA, QTD_ESTOQUE FROM estoque WHERE CLASSE = 'Revestimento'/, () =>
      estoque.filter(candidato).sort((a, b) => a.NOME_PRODUTO.localeCompare(b.NOME_PRODUTO))
        .map(e => ({ CODIGO: e.CODIGO, NOME_PRODUTO: e.NOME_PRODUTO, UNIDADE: e.UNIDADE, ALTURA: e.ALTURA, LARGURA: e.LARGURA, QTD_ESTOQUE: e.QTD_ESTOQUE }))],
    [/^SELECT CODIGO, NOME_PRODUTO, CLASSE, SITUACAO, ALTURA, LARGURA FROM estoque WHERE CODIGO IN/, (sql, cods) =>
      estoque.filter(e => cods.map(Number).includes(e.CODIGO)).map(e => ({ CODIGO: e.CODIGO, NOME_PRODUTO: e.NOME_PRODUTO, CLASSE: e.CLASSE, SITUACAO: e.SITUACAO, ALTURA: e.ALTURA, LARGURA: e.LARGURA }))],

    // ---- pedido, vidros e plano ----
    [/^SELECT NUMERO, RAZAO_SOCIAL, SITUACAO FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido'/, (sql, [n]) =>
      pedidos.filter(p => p.NUMERO === Number(n) && p.TIPO === 'Pedido').map(p => ({ NUMERO: p.NUMERO, RAZAO_SOCIAL: p.RAZAO_SOCIAL, SITUACAO: p.SITUACAO }))],
    [/^SELECT id, MEDICAO, ITEM, QTD, MODELO, COR_REVESTIMENTO, TAMANHO FROM vidros WHERE NUMERO = \?/, (sql, [n]) =>
      vidros.filter(v => v.NUMERO === Number(n)).sort((a, b) => a.id - b.id).map(({ NUMERO, ...v }) => v)],
    [/^SELECT ITEM_PEDIDO, REVESTIMENTO, COR_REVESTIMENTO FROM ped_orc_itens_v4 WHERE NUMERO = \? AND TIPO = 'Pedido'/, (sql, [n]) =>
      itens.filter(i => i.NUMERO === Number(n) && i.TIPO === 'Pedido').map(i => ({ ITEM_PEDIDO: i.ITEM_PEDIDO, REVESTIMENTO: i.REVESTIMENTO, COR_REVESTIMENTO: i.COR_REVESTIMENTO }))],
    [/^SELECT id, produto_codigo, produto_nome, altura, largura FROM web_vidro_retalhos WHERE situacao = 'disponivel' OR/, (sql, [planoId]) =>
      retalhos.filter(r => r.situacao === 'disponivel' || (r.situacao === 'reservado' && r.plano_reserva === planoId))
        .map(r => ({ id: r.id, produto_codigo: r.produto_codigo, produto_nome: r.produto_nome, altura: r.altura, largura: r.largura })).sort((a, b) => a.id - b.id)],
    [/^SELECT id, situacao, impressao_pecas, criado_por, criado_em, conferido_em FROM web_vidro_planos WHERE pedido = \?/, (sql, [n]) => {
      const p = planos.filter(x => x.pedido === Number(n) && x.situacao !== 'cancelado' && !x.excluido_em).sort((a, b) => b.id - a.id)[0];
      return p ? [{ id: p.id, situacao: p.situacao, impressao_pecas: p.impressao_pecas, criado_por: p.criado_por, criado_em: p.criado_em, conferido_em: p.conferido_em ?? null }] : [];
    }],
    [/^SELECT COUNT\(\*\) AS qtd, SUM\(situacao = 'conferido'\) AS conferidos FROM web_vidro_planos WHERE pedido = \?/, (sql, [n]) => {
      const meus = planos.filter(p => p.pedido === Number(n) && !p.excluido_em);
      return [{ qtd: meus.length, conferidos: meus.filter(p => p.situacao === 'conferido').length }];
    }],

    // ---- salvar, ler, marcar e cancelar plano ----
    [/^SELECT id, pedido, situacao, impressao_pecas, parametros, resultado, progresso/, (sql, [id]) => planos.filter(p => p.id === Number(id)).map(p => ({ ...p }))],
    [/^INSERT INTO web_vidro_planos/, (sql, [pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em]) => {
      const p = { id: proxPlano++, pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em, conferido_por: null, conferido_em: null };
      planos.push(p); return { insertId: p.id, affectedRows: 1 };
    }],
    [/^UPDATE web_vidro_retalhos SET situacao = 'reservado'/, (sql, [planoId, , id]) => {
      const r = retalhos.find(x => x.id === id);
      if (!r || r.situacao !== 'disponivel') return { affectedRows: 0 };
      r.situacao = 'reservado'; r.plano_reserva = planoId; return { affectedRows: 1 };
    }],
    [/^UPDATE web_vidro_retalhos SET situacao = 'disponivel', plano_reserva = NULL, atualizado_em = \? WHERE plano_reserva = \? AND situacao = 'reservado'/, (sql, [, planoId]) => {
      let n = 0; for (const r of retalhos) if (r.plano_reserva === planoId && r.situacao === 'reservado') { r.situacao = 'disponivel'; r.plano_reserva = null; n++; }
      return { affectedRows: n };
    }],
    [/^UPDATE web_vidro_planos SET situacao = 'cancelado' WHERE id = \?/, (sql, [id]) => { planos.find(p => p.id === id).situacao = 'cancelado'; return { affectedRows: 1 }; }],
    [/^UPDATE web_vidro_planos SET progresso = \?/, (sql, [progresso, id]) => {
      const p = planos.find(x => x.id === id); if (!p || p.situacao !== 'gerado') return { affectedRows: 0 };
      p.progresso = progresso; return { affectedRows: 1 };
    }],
    [/^SELECT id FROM web_vidro_planos WHERE pedido = \?/, (sql, [n]) => planos.filter(p => p.pedido === Number(n) && p.situacao === 'gerado').map(p => ({ id: p.id }))],
    [/^UPDATE web_vidro_planos SET excluido_em = \?/, (sql, [agora, n]) => {
      let c = 0; for (const p of planos) if (p.pedido === Number(n) && p.situacao === 'conferido' && !p.excluido_em) { p.excluido_em = agora; c++; }
      return { affectedRows: c };
    }],

    // ---- retalhos ----
    [/^SELECT id, produto_codigo, produto_nome, altura, largura, situacao, plano_origem, plano_reserva, criado_em FROM web_vidro_retalhos/, (sql, params) => {
      const filtro = /WHERE situacao = \?/.test(sql) ? params[0] : null;
      return retalhos.filter(r => !filtro || r.situacao === filtro).map(formatarRetalho)
        .sort((a, b) => a.produto_nome.localeCompare(b.produto_nome) || a.altura - b.altura || a.largura - b.largura || a.id - b.id);
    }],
    [/^INSERT INTO web_vidro_retalhos/, (sql, [produto_codigo, produto_nome, altura, largura, criado_por, criado_em]) => {
      const r = { id: proxRetalho++, produto_codigo, produto_nome, altura, largura, situacao: 'disponivel', criado_por, criado_em };
      retalhos.push(r); return { insertId: r.id, affectedRows: 1 };
    }],
    [/^SELECT id, situacao FROM web_vidro_retalhos WHERE id = \?/, (sql, [id]) => retalhos.filter(r => r.id === Number(id)).map(r => ({ id: r.id, situacao: r.situacao }))],
    [/^UPDATE web_vidro_retalhos SET produto_codigo = \?/, (sql, [produto_codigo, produto_nome, altura, largura, , id]) => {
      Object.assign(retalhos.find(r => r.id === id), { produto_codigo, produto_nome, altura, largura }); return { affectedRows: 1 };
    }],
    [/^UPDATE web_vidro_retalhos SET situacao = 'descartado'/, (sql, [, id]) => { retalhos.find(r => r.id === id).situacao = 'descartado'; return { affectedRows: 1 }; }]
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
          foto[k].forEach((o, i) => { if (atual[i] && typeof o === 'object') { for (const ch of Object.keys(atual[i])) delete atual[i][ch]; Object.assign(atual[i], o); } });
          atual.splice(foto[k].length, atual.length - foto[k].length);
          for (let i = atual.length; i < foto[k].length; i++) atual.push(foto[k][i]);
        }
        await c.rollback();
      } };
  };
  const semear = {
    pedido: (x = {}) => { const r = { NUMERO: 100, TIPO: 'Pedido', RAZAO_SOCIAL: 'Cliente X', SITUACAO: 'Em Produção', ...x }; pedidos.push(r); return r; },
    vidro: (x = {}) => { const r = { id: proxVidro++, NUMERO: 100, MEDICAO: 'M1', ITEM: 1, QTD: 2, MODELO: 'Incolor 4mm', COR_REVESTIMENTO: '', TAMANHO: '2000 x 800', ...x }; vidros.push(r); return r; },
    item: (x = {}) => { const r = { NUMERO: 100, TIPO: 'Pedido', ITEM_PEDIDO: 1, ITEM: 1, REVESTIMENTO: 'Incolor 4mm', COR_REVESTIMENTO: '', ...x }; itens.push(r); return r; },
    retalho: (x = {}) => { const r = { id: proxRetalho++, produto_codigo: 10, produto_nome: 'Vidro Incolor 4mm', altura: 1500, largura: 1000, situacao: 'disponivel', ...x }; retalhos.push(r); return r; }
  };
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararVidros(t, { perfil = 'Corte', usuario = { codigo: 7, nome: 'Caio' }, banco = bancoVidros(), hoje = '2026-10-15' } = {}) {
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

// corpo de confirmação (usado a partir da Tarefa 6): sobras do plano guardadas com a medida calculada, mais o que vier em `extra`
async function corpoConfirmacao(chamar, planoId, extra = {}) {
  const plano = await (await chamar(`/corte_vidros/plano/${planoId}`)).json();
  const sobras = [];
  plano.plano.grupos.forEach(g => g.chapas.forEach((c, ci) => (c.sobras || []).forEach((s, si) =>
    sobras.push({ grupo: g.chave, chapa: ci, sobra: si, destino: 'guardar', altura: s.altura, largura: s.largura }))));
  return { sobras, ...extra };
}

module.exports = { bancoVidros, prepararVidros, corpoConfirmacao, PERFIS };
