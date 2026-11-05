// Banco simulado com estado para as etapas de produção (rotas/etapas_producao.js, rotas/etapas_banco.js) e a parte de ped_orc que elas usam
// (trava do cabeçalho, estados do cliente, situação, data de pronto) e a varredura das Entregas. Como no MySQL, ROLLBACK volta ao estado do BEGIN.
// `regrasEtapas(estado)` também é usada pelos testes do gatilho do corte (acrescentada às regras de bancoCorte/bancoVidros).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso, sessoes } = require('../../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./sessaoFalsa');
aceitarSidDeTeste(sessoes);

const TODAS_ETAPAS = ['etapas.ver', 'etapas.corte_perfil', 'etapas.corte_vidro', 'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem', 'etapas.finalizar', 'etapas.gerir'];
const PERFIS = {
  'Administrador': [...TODAS_ETAPAS, 'pedidos.situacao', 'pedidos.ver'],
  'Gerente sem situação': [...TODAS_ETAPAS],
  'Cortador': ['etapas.ver', 'etapas.corte_perfil'],
  'Pintor de vidro': ['etapas.ver', 'etapas.pintura_vidro'],
  'Montador': ['etapas.ver', 'etapas.montagem'],
  'Finalizador': ['etapas.ver', 'etapas.finalizar'],
  'Finalizador com situação': ['etapas.ver', 'etapas.finalizar', 'pedidos.situacao'],
  'Só ver': ['etapas.ver'],
  'Sem etapas': ['etapas.corte_perfil', 'pedidos.ver']
};

// tipo dos itens do pedido (lista comercial e serralheria), sobre `estado.lista` / `estado.serralheria`
function regrasItens(estado) {
  const de = (linhas, ns) => linhas.filter(l => ns.map(Number).includes(l.NUMERO) && l.TIPO === 'Pedido');
  return [
    [/^SELECT NUMERO, ITEM, TIPO_PRODUTO FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN/, (sql, ns) => de(estado.lista, ns).map(l => ({ NUMERO: l.NUMERO, ITEM: l.ITEM, TIPO_PRODUTO: l.TIPO_PRODUTO }))],
    [/^SELECT NUMERO, ITEM_PEDIDO FROM ped_orc_serralheria WHERE TIPO = 'Pedido' AND NUMERO IN/, (sql, ns) => de(estado.serralheria, ns).map(s => ({ NUMERO: s.NUMERO, ITEM_PEDIDO: s.ITEM_PEDIDO }))]
  ];
}

// regras de web_producao_etapas e eventos sobre `estado.etapas` / `estado.eventos`
function regrasEtapas(estado) {
  let proxEtapa = 1, proxEvento = 1;
  const { etapas, eventos } = estado;
  const copia = l => ({ ...l });
  return [
    [/^SELECT id, numero, etapa, estado, origem, usuario, quando, observacao FROM web_producao_etapas WHERE numero = \? AND origem = 'corte' AND estado = 'ok'/, (sql, [n]) =>
      etapas.filter(e => e.numero === Number(n) && e.origem === 'corte' && e.estado === 'ok').map(copia)],
    [/^SELECT id, numero, etapa, estado, origem, usuario, quando, observacao FROM web_producao_etapas WHERE numero = \? AND etapa = \?/, (sql, [n, et]) =>
      etapas.filter(e => e.numero === Number(n) && e.etapa === et).map(copia)],
    [/^SELECT id, numero, etapa, estado, origem, usuario, quando, observacao FROM web_producao_etapas WHERE numero IN \(/, (sql, ns) =>
      etapas.filter(e => ns.map(Number).includes(e.numero)).sort((a, b) => a.id - b.id).map(copia)],
    [/^SELECT id, numero, etapa, estado, origem, usuario, quando, observacao FROM web_producao_etapas WHERE numero = \?/, (sql, [n]) =>
      etapas.filter(e => e.numero === Number(n)).sort((a, b) => a.id - b.id).map(copia)],
    [/^UPDATE web_producao_etapas SET estado = \?/, (sql, [est, origem, usuario, quando, observacao, id]) => {
      Object.assign(etapas.find(e => e.id === id), { estado: est, origem, usuario, quando, observacao }); return { affectedRows: 1 };
    }],
    [/^INSERT INTO web_producao_etapas \(/, (sql, [numero, etapa, est, origem, usuario, quando, observacao]) => {
      if (etapas.some(e => e.numero === numero && e.etapa === etapa)) { const err = new Error('Duplicate entry'); err.code = 'ER_DUP_ENTRY'; err.errno = 1062; throw err; }
      const l = { id: proxEtapa++, numero, etapa, estado: est, origem, usuario, quando, observacao }; etapas.push(l); return { insertId: l.id, affectedRows: 1 };
    }],
    [/^INSERT INTO web_producao_etapas_eventos/, (sql, [numero, etapa, estado_antes, estado_depois, origem, usuario, quando, observacao, detalhe]) => {
      eventos.push({ id: proxEvento++, numero, etapa, estado_antes, estado_depois, origem, usuario, quando, observacao, detalhe }); return { affectedRows: 1 };
    }],
    [/^SELECT COUNT\(\*\) AS qtd FROM web_producao_etapas WHERE numero = \?/, (sql, [n]) => [{ qtd: etapas.filter(e => e.numero === Number(n)).length }]],
    [/^DELETE FROM web_producao_etapas_eventos WHERE numero = \?/, (sql, [n]) => { const antes = eventos.length; eventos.splice(0, eventos.length, ...eventos.filter(e => e.numero !== Number(n))); return { affectedRows: antes - eventos.length }; }],
    [/^DELETE FROM web_producao_etapas WHERE numero = \?/, (sql, [n]) => { const antes = etapas.length; etapas.splice(0, etapas.length, ...etapas.filter(e => e.numero !== Number(n))); return { affectedRows: antes - etapas.length }; }],
    [/^SELECT id, etapa, estado_antes, estado_depois/, (sql, [n, et]) =>
      eventos.filter(e => e.numero === Number(n) && (!et || e.etapa === et)).sort((a, b) => b.id - a.id).map(copia)]
  ];
}

function bancoEtapas() {
  const estado = { pedidos: [], clientes: [], perfis: [], itens: [], vidros: [], lista: [], serralheria: [], etapas: [], eventos: [], auditoria: [], entregas: [], entregaEventos: [] };
  const { pedidos, clientes, perfis, itens, vidros, lista, serralheria, auditoria, entregas } = estado;
  let proxPerfil = 1, proxVidro = 1, proxEntrega = 1;
  const doNumero = (linhas, ns) => linhas.filter(l => ns.map(Number).includes(l.NUMERO));
  const regras = [
    ...regrasEtapas(estado),
    [/^INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    // ---- ped_orc ----
    [/^SELECT \* FROM ped_orc WHERE NUMERO = \? AND TIPO = \? FOR UPDATE/, (sql, [n, tipo]) => pedidos.filter(p => p.NUMERO === Number(n) && p.TIPO === tipo).map(p => ({ ...p }))],
    [/^SELECT NUMERO, RAZAO_SOCIAL, SITUACAO FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido'/, (sql, [n]) =>
      pedidos.filter(p => p.NUMERO === Number(n) && p.TIPO === 'Pedido').map(p => ({ NUMERO: p.NUMERO, RAZAO_SOCIAL: p.RAZAO_SOCIAL, SITUACAO: p.SITUACAO }))],
    [/^SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = \?/, (sql, [r]) => clientes.filter(c => c.RAZAO_SOCIAL === r).slice(0, 1).map(c => ({ ESTADO: c.ESTADO }))],
    [/^UPDATE ped_orc SET SITUACAO = \?, DATA_ENTREGA = \? WHERE NUMERO = \? AND TIPO = \?/, (sql, [s, de, n, tipo]) => {
      const p = pedidos.find(x => x.NUMERO === n && x.TIPO === tipo); Object.assign(p, { SITUACAO: s, DATA_ENTREGA: de }); return { affectedRows: 1 };
    }],
    [/^UPDATE ped_orc SET SITUACAO = \? WHERE NUMERO = \? AND TIPO = \?/, (sql, [s, n, tipo]) => { pedidos.find(x => x.NUMERO === n && x.TIPO === tipo).SITUACAO = s; return { affectedRows: 1 }; }],
    [/^UPDATE ped_orc SET DATA_PRONTO = \? WHERE NUMERO = \? AND TIPO = \?/, (sql, [d, n, tipo]) => { pedidos.find(x => x.NUMERO === n && x.TIPO === tipo).DATA_PRONTO = d; return { affectedRows: 1 }; }],
    [/^SELECT p\.NUMERO AS numero, p\.RAZAO_SOCIAL AS cliente, p\.CLIENTE_FINAL AS cliente_final, p\.SITUACAO AS situacao, CAST\(p\.DATA_PRONTO AS CHAR\) AS pronto_em/, (sql, params) => {
      const comEstados = /INNER JOIN cadastro_clientes/.test(sql);
      return pedidos.filter(p => p.TIPO === 'Pedido' && !['Cancelado', 'Entregue', 'Retirado'].includes(p.SITUACAO))
        .filter(p => !comEstados || clientes.some(c => c.RAZAO_SOCIAL === p.RAZAO_SOCIAL && params.includes(c.ESTADO)))
        .map(p => ({ numero: p.NUMERO, cliente: p.RAZAO_SOCIAL, cliente_final: p.CLIENTE_FINAL, situacao: p.SITUACAO, pronto_em: p.DATA_PRONTO }));
    }],
    // ---- peças (aplicabilidade) ----
    [/^SELECT NUMERO, id, ITEM, QTD_PORTAS, PERFIL/, (sql, ns) => doNumero(perfis, ns)],
    [/^SELECT NUMERO, ITEM_PEDIDO, ITEM, QTD, PERFIL/, (sql, ns) => doNumero(itens, ns).filter(i => i.TIPO === 'Pedido')],
    [/^SELECT NUMERO, id, MEDICAO, ITEM, QTD, MODELO/, (sql, ns) => doNumero(vidros, ns)],
    ...regrasItens(estado),
    // ---- entregas (trava ao voltar para produção; varredura depois do finalizado) ----
    [/^SELECT id, status FROM web_entregas WHERE numero = \? AND status IN/, (sql, [n]) => entregas.filter(e => e.numero === Number(n) && ['agendada', 'em_rota', 'ocorrencia'].includes(e.status)).map(e => ({ id: e.id, status: e.status }))],
    [/^\s*INSERT IGNORE INTO web_entregas/, () => {
      let n = 0;
      for (const p of pedidos.filter(x => x.TIPO === 'Pedido' && x.SITUACAO === 'Pronto')) if (!entregas.some(e => e.numero === p.NUMERO)) { entregas.push({ id: proxEntrega++, numero: p.NUMERO, status: 'a_programar' }); n++; }
      return { affectedRows: n };
    }]
  ];
  const f = criarPoolFalso(regras);
  const conectar = f.getConnection;
  f.getConnection = async () => {
    const c = await conectar();
    let foto = null;
    return { ...c,
      beginTransaction: async () => { foto = JSON.parse(JSON.stringify(estado)); await c.beginTransaction(); },
      rollback: async () => {
        if (foto) for (const k of Object.keys(estado)) { estado[k].splice(0, estado[k].length, ...foto[k]); }
        await c.rollback();
      } };
  };
  const semear = {
    pedido: (x = {}) => { const r = { NUMERO: 100, TIPO: 'Pedido', RAZAO_SOCIAL: 'Cliente X', CLIENTE_FINAL: 'Final Y', SITUACAO: 'Em Produção', DATA_PRONTO: '2099-12-01', DATA_ENTREGA: null, TOTAL: 999, ...x }; pedidos.push(r); return r; },
    cliente: (x = {}) => { const r = { RAZAO_SOCIAL: 'Cliente X', ESTADO: 'RJ', ...x }; clientes.push(r); return r; },
    // porta com perfil P100 (2 portas, 2 alturas + 2 larguras por porta) no item 1
    perfil: (x = {}) => { const r = { id: proxPerfil++, NUMERO: 100, ITEM: 1, QTD_PORTAS: 2, PERFIL: 'P100', QTD_ALTURA: 2, TAM_ALTURA: 2100, QTD_LARGURA: 2, TAM_LARGURA: 900, PUXADOR: null, QTD_PUXADOR: 0, TAM_PUXADOR: 0, ...x }; perfis.push(r); return r; },
    item: (x = {}) => { const r = { NUMERO: 100, TIPO: 'Pedido', ITEM_PEDIDO: 1, ITEM: 1, QTD: 2, ALTURA: 2100, LARGURA: 900, PERFIL: 'P100', ACABAMENTO_PERFIL: 'Anodizado', COR_PERFIL: 'Natural',
      PUXADOR: null, ACABAMENTO_PUXADOR: null, COR_PUXADOR: null, DIVISOR: null, ACABAMENTO_DIVISOR: null, COR_DIVISOR: null, QTD_HORIZONTAL: 0, QTD_VERTICAL: 0, TAM_DIV_HORIZONTAL: 0, TAM_DIV_VERTICAL: 0,
      REVESTIMENTO: 'Incolor', COR_REVESTIMENTO: 'Incolor', ...x }; itens.push(r); return r; },
    vidro: (x = {}) => { const r = { id: proxVidro++, NUMERO: 100, MEDICAO: 'Porta', ITEM: 1, QTD: 2, MODELO: 'Incolor', COR_REVESTIMENTO: 'Incolor', TAMANHO: '2000 x 800', ...x }; vidros.push(r); return r; },
    // pedido completo: perfil + vidro
    completo: (x = {}) => { const p = semear.pedido(x); semear.perfil({ NUMERO: p.NUMERO }); semear.item({ NUMERO: p.NUMERO }); semear.vidro({ NUMERO: p.NUMERO }); return p; },
    // linha da lista comercial (ped_orc_lista_itens) e peça de serralheria (ped_orc_serralheria)
    listaItem: (x = {}) => { const r = { NUMERO: 100, TIPO: 'Pedido', ITEM: 1, TIPO_PRODUTO: 'Porta de giro', ...x }; lista.push(r); return r; },
    serralheria: (x = {}) => { const r = { NUMERO: 100, TIPO: 'Pedido', ITEM_PEDIDO: 1, ITEM: 1, PRODUTO: 'Portão', ...x }; serralheria.push(r); return r; },
    // pedido só de serralheria como o VB/web gravam: lista 'Metalons' + ped_orc_serralheria; nada em perfis/itens_v4/vidros
    soSerralheria: (x = {}) => { const p = semear.pedido(x); semear.listaItem({ NUMERO: p.NUMERO, TIPO_PRODUTO: 'Metalons' }); semear.serralheria({ NUMERO: p.NUMERO }); return p; },
    etapa: (x = {}) => { const r = { id: 1000 + estado.etapas.length, numero: 100, etapa: 'perfil_cortado', estado: 'ok', origem: 'manual', usuario: 'Ana', quando: '2026-11-01 08:00:00', observacao: null, ...x }; estado.etapas.push(r); return r; }
  };
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararEtapas(t, { perfil = 'Administrador', permissoes = null, estados = [], usuario = { codigo: 7, nome: 'Bia' }, banco = bancoEtapas() } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: usuario.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados, ativo: true, permissoes: new Set(permissoes || PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(usuario.codigo, usuario.nome), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { banco, chamar };
}

module.exports = { bancoEtapas, prepararEtapas, regrasEtapas, regrasItens, PERFIS, TODAS_ETAPAS };
