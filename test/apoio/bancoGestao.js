// Banco simulado com estado para as rotas da Central de Gestão (rotas/gestao.js).
// Cada regra imita um SQL da rota (inclusive as somas por mês/situação); as listas em memória são o "banco".
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const transacao = require('../../rotas/transacao');
const { app, pool, acesso } = require('../../index.js');

const PERFIS = {
  'Gestão': ['gestao.ver', 'gestao.editar', 'valores.ver'],
  'Só ver gestão': ['gestao.ver', 'valores.ver'],
  'Gestão sem valores': ['gestao.ver', 'gestao.editar'],
  'Só valores': ['valores.ver'],
  'Só editar': ['gestao.editar', 'valores.ver'],
  'Sem acesso': ['pedidos.ver']
};

const norm = s => String(s ?? '').trim().toLowerCase();
const mesDe = d => String(d).slice(0, 7);
const entre = (d, ini, fim) => d >= ini && d <= fim;

function bancoGestao() {
  const estado = { pedidos: [], fluxo: [], classificacoes: [], metas: [], orcamentos: [], auditoria: [], previsao: [] /* null = tabela inexistente */ };
  const { pedidos, fluxo, classificacoes, metas, orcamentos, auditoria } = estado;
  let proxMeta = 1, proxOrc = 1;
  const ehEntrada = l => !!(l.RAZAO_SOCIAL) && !l.RAZAO_FABRICANTE;

  const regras = [
    [/^INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    [/^SELECT id, TIPO, CLASSE1, CLASSE2, CLASSE3 FROM fluxo_de_caixa_classificacao/, () =>
      classificacoes.map(c => ({ id: c.id, TIPO: c.TIPO, CLASSE1: c.CLASSE1, CLASSE2: c.CLASSE2, CLASSE3: c.CLASSE3 })).sort((a, b) => a.id - b.id)],
    // faturamento por mês
    [/^SELECT DATE_FORMAT\(DATA, '%Y-%m'\) AS mes, SUM\(TOTAL\)/, (sql, [ini, fim]) => {
      const por = {};
      for (const p of pedidos) {
        if (p.TIPO !== 'Pedido' || (p.SITUACAO || '') === 'Cancelado' || (p.FINANCEIRO || '') === 'Sem custo' || !entre(p.DATA, ini, fim)) continue;
        const x = por[mesDe(p.DATA)] || (por[mesDe(p.DATA)] = { mes: mesDe(p.DATA), soma: 0, qtd: 0 });
        x.soma += p.TOTAL; x.qtd++;
      }
      return Object.values(por);
    }],
    // fluxo por mês + situação (caixa mista junta no MySQL por ser case-insensitive; aqui cada grafia vira um grupo, como "A receber"/"A Receber" distintos no JS)
    [/^SELECT DATE_FORMAT\(DATA, '%Y-%m'\) AS mes, SITUACAO AS situacao/, (sql, [ini, fim]) => {
      const por = {};
      for (const l of fluxo) {
        if (!entre(l.DATA, ini, fim)) continue;
        const k = `${mesDe(l.DATA)}|${l.SITUACAO}|${ehEntrada(l)}`;
        const x = por[k] || (por[k] = { mes: mesDe(l.DATA), situacao: l.SITUACAO, entrada: ehEntrada(l) ? 1 : 0, qtd: 0, soma: 0 });
        x.qtd++; x.soma += l.VALOR;
      }
      return Object.values(por);
    }],
    // vencidos hoje
    [/^SELECT SITUACAO AS situacao, \(COALESCE/, (sql, [hoje]) => {
      const por = {};
      for (const l of fluxo) {
        if (!(l.DATA < hoje || ['atrasado', 'protestado'].includes(norm(l.SITUACAO)))) continue;
        const k = `${l.SITUACAO}|${ehEntrada(l)}`;
        const x = por[k] || (por[k] = { situacao: l.SITUACAO, entrada: ehEntrada(l) ? 1 : 0, qtd: 0, soma: 0, maisAntigo: l.DATA });
        x.qtd++; x.soma += l.VALOR; if (l.DATA < x.maisAntigo) x.maisAntigo = l.DATA;
      }
      return Object.values(por);
    }],
    // pagos / a pagar por classificação
    [/^SELECT COD_CLASSIFICACAO AS classificacaoId/, (sql, [ini, fim]) => {
      const por = {};
      for (const l of fluxo) {
        if (!entre(l.DATA, ini, fim) || !['pago', 'a pagar'].includes(norm(l.SITUACAO))) continue;
        const k = `${l.COD_CLASSIFICACAO}|${norm(l.SITUACAO)}`;
        const x = por[k] || (por[k] = { classificacaoId: l.COD_CLASSIFICACAO ?? null, situacao: l.SITUACAO, qtd: 0, soma: 0 });
        x.qtd++; x.soma += l.VALOR;
      }
      return Object.values(por);
    }],
    [/^SELECT periodo, tipo, valor, origem FROM web_gestao_metas WHERE periodo = \?/, (sql, [p]) =>
      metas.filter(m => m.periodo === p).map(m => ({ periodo: m.periodo, tipo: m.tipo, valor: m.valor.toFixed(2), origem: m.origem }))],
    [/^SELECT id, valor, origem FROM web_gestao_metas WHERE periodo = \? AND tipo = \?/, (sql, [p, t]) =>
      metas.filter(m => m.periodo === p && m.tipo === t).map(m => ({ id: m.id, valor: m.valor.toFixed(2), origem: m.origem }))],
    [/^INSERT INTO web_gestao_metas/, (sql, [periodo, tipo, valor, origem, criado_por]) => { metas.push({ id: proxMeta++, periodo, tipo, valor, origem, criado_por }); return { affectedRows: 1 }; }],
    [/^UPDATE web_gestao_metas SET/, (sql, [valor, origem, , , id]) => { const m = metas.find(x => x.id === id); m.valor = valor; m.origem = origem; return { affectedRows: 1 }; }],
    [/^SELECT id, classificacao_id, nivel, valor, limiar_atencao, limiar_alerta FROM web_gestao_orcamento WHERE periodo = \?/, (sql, [p]) =>
      orcamentos.filter(o => o.periodo === p).map(o => ({ id: o.id, classificacao_id: o.classificacao_id, nivel: o.nivel, valor: o.valor.toFixed(2), limiar_atencao: o.limiar_atencao, limiar_alerta: o.limiar_alerta }))],
    [/^SELECT id, nivel, valor, limiar_atencao, limiar_alerta FROM web_gestao_orcamento WHERE periodo = \? AND classificacao_id = \?/, (sql, [p, c]) =>
      orcamentos.filter(o => o.periodo === p && o.classificacao_id === c).map(o => ({ id: o.id, nivel: o.nivel, valor: o.valor.toFixed(2) }))],
    [/^INSERT INTO web_gestao_orcamento/, (sql, [periodo, classificacao_id, nivel, valor, limiar_atencao, limiar_alerta, criado_por]) => {
      orcamentos.push({ id: proxOrc++, periodo, classificacao_id, nivel, valor, limiar_atencao, limiar_alerta, criado_por }); return { affectedRows: 1 };
    }],
    [/^UPDATE web_gestao_orcamento SET/, (sql, [nivel, valor, limiar_atencao, limiar_alerta, , , id]) => {
      Object.assign(orcamentos.find(x => x.id === id), { nivel, valor, limiar_atencao, limiar_alerta }); return { affectedRows: 1 };
    }],
    [/^SELECT META_FATURAMENTO, META_DESPESA FROM previsao_financeiro/, (sql, chaves) => {
      if (estado.previsao === null) { const e = new Error("Table 'previsao_financeiro' doesn't exist"); e.code = 'ER_NO_SUCH_TABLE'; e.errno = 1146; throw e; }
      return estado.previsao.filter(p => chaves.includes(p.MES));
    }]
  ];
  const f = criarPoolFalso(regras);
  const semear = {
    pedido: (x = {}) => { const r = { TIPO: 'Pedido', TOTAL: 1000, DATA: '2026-09-10', SITUACAO: 'Em Produção', FINANCEIRO: 'A Receber', ...x }; pedidos.push(r); return r; },
    fluxo: (x = {}) => { const r = { ID: fluxo.length + 1, DATA: '2026-09-10', RAZAO_SOCIAL: null, RAZAO_FABRICANTE: 'Fornecedor A', SITUACAO: 'Pago', VALOR: 100, COD_CLASSIFICACAO: 10, ...x }; fluxo.push(r); return r; },
    classificacao: (x = {}) => { const r = { id: classificacoes.length + 1, TIPO: 'Saída', CLASSE1: 'Materiais', CLASSE2: '', CLASSE3: '', ...x }; classificacoes.push(r); return r; }
  };
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

// hoje: data fixa de Brasília (AAAA-MM-DD) para os testes de mês em andamento
async function prepararGestao(t, { perfil = 'Gestão', usuario = { codigo: 7, nome: 'Caio' }, banco = bancoGestao(), hoje = '2026-10-15' } = {}) {
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

module.exports = { bancoGestao, prepararGestao, PERFIS };
