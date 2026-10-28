// Banco simulado com estado para as rotas de notas fiscais (rotas/notas_fiscais.js).
// Cada regra imita um SQL da rota; as listas em memória são o "banco".
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');

const PERFIS = {
  'Notas': ['notas.ver', 'notas.editar'],
  'Notas com valores': ['notas.ver', 'notas.editar', 'valores.ver'],
  'Somente ver notas': ['notas.ver', 'valores.ver'],
  'Sem acesso': ['pedidos.ver']
};

function bancoNotas() {
  const estado = { notas: [], fornecedores: [], clientes: [], auditoria: [], falharInsertDuplicado: false, nfEntrada: [], nfSaida: [], falharLeituraNf: false };
  const { notas, fornecedores, clientes, auditoria, nfEntrada, nfSaida } = estado;
  let proximoId = 1, proximoForn = 1, proximoCli = 1;
  const sqlLike = (v, ...campos) => { const t = String(v).replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase(); return campos.some(c => String(c ?? '').toLowerCase().includes(t)); };

  const regras = [
    [/INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    [/^SELECT COD, RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE COD = \?/, (sql, [cod]) =>
      fornecedores.filter(f => f.COD === Number(cod) && f.RAZAO_FABRICANTE !== '.').map(f => ({ ...f }))],
    [/^SELECT COD, RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE <> '\.' ORDER BY/, () =>
      fornecedores.filter(f => f.RAZAO_FABRICANTE !== '.').sort((a, b) => a.RAZAO_FABRICANTE.localeCompare(b.RAZAO_FABRICANTE, 'pt-BR')).map(f => ({ ...f }))],
    [/^SELECT CODIGO, RAZAO_SOCIAL FROM cadastro_clientes/, (sql, estados) =>
      clientes.filter(c => !sql.includes('ESTADO IN') || estados.includes(c.ESTADO)).sort((a, b) => a.RAZAO_SOCIAL.localeCompare(b.RAZAO_SOCIAL, 'pt-BR')).map(c => ({ ...c }))],
    [/^SELECT CODIGO, RAZAO_SOCIAL, ESTADO FROM cadastro_clientes WHERE CODIGO = \?/, (sql, [cod]) =>
      clientes.filter(c => c.CODIGO === Number(cod)).map(c => ({ ...c }))],
    [/^SELECT \* FROM web_notas_fiscais WHERE id = \?/, (sql, [id]) => notas.filter(n => n.id === Number(id)).map(n => ({ ...n }))],
    [/^SELECT id FROM web_notas_fiscais WHERE tipo = \? AND serie = \? AND numero = \? AND contraparte_codigo = \?/, (sql, [tipo, serie, numero, cod]) =>
      notas.filter(n => n.tipo === tipo && n.serie === serie && n.numero === numero && n.contraparte_codigo === Number(cod)).map(n => ({ id: n.id }))],
    [/^SELECT id FROM web_notas_fiscais WHERE chave = \?/, (sql, [chave]) => notas.filter(n => n.chave === chave).map(n => ({ id: n.id }))],
    [/^SELECT \* FROM nf_entrada/, () => { if (estado.falharLeituraNf) throw new Error("Table nf_entrada doesn't exist"); return nfEntrada.map(x => ({ ...x })); }],
    [/^SELECT \* FROM nf_saida/, () => nfSaida.map(x => ({ ...x }))],
    [/^SELECT COD, RAZAO_FABRICANTE FROM cadastro_fornecedores$/, () => fornecedores.map(f => ({ ...f }))],
    [/^SELECT tipo, serie, numero, contraparte_codigo FROM web_notas_fiscais/, () => notas.map(n => ({ tipo: n.tipo, serie: n.serie, numero: n.numero, contraparte_codigo: n.contraparte_codigo }))],
    [/^INSERT INTO web_notas_fiscais \(tipo, numero, serie, data_emissao/, (sql, p) => {
      for (let i = 0; i < p.length; i += 9) {
        const [tipo, numero, serie, data_emissao, contraparte_codigo, contraparte_nome, valor_total, criado_por, criado_em] = p.slice(i, i + 9);
        notas.push({ id: proximoId++, tipo, numero, serie, chave: null, chave_original: null, data_emissao, contraparte_codigo, contraparte_nome, valor_total: Number(valor_total).toFixed(2),
          observacao: 'Importada do VB', situacao: 'ativa', motivo_cancelamento: null, criado_por, criado_em, alterado_por: null, alterado_em: null });
      }
      return { affectedRows: p.length / 9 };
    }],
    [/^INSERT INTO web_notas_fiscais/, (sql, p) => {
      if (estado.falharInsertDuplicado) { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e; }
      const [tipo, numero, serie, chave, data_emissao, contraparte_codigo, contraparte_nome, valor_total, observacao, criado_por, criado_em] = p;
      notas.push({ id: proximoId, tipo, numero, serie, chave, data_emissao, contraparte_codigo, contraparte_nome, valor_total: Number(valor_total).toFixed(2),
        observacao, situacao: 'ativa', motivo_cancelamento: null, criado_por, criado_em, alterado_por: null, alterado_em: null });
      return { affectedRows: 1, insertId: proximoId++ };
    }],
    [/^UPDATE web_notas_fiscais SET data_emissao/, (sql, [data, valor, obs, quem, quando, id]) => {
      const n = notas.find(x => x.id === Number(id));
      Object.assign(n, { data_emissao: data, valor_total: Number(valor).toFixed(2), observacao: obs, alterado_por: quem, alterado_em: quando });
      return { affectedRows: 1 };
    }],
    [/^UPDATE web_notas_fiscais SET situacao = 'cancelada'/, (sql, [motivo, quem, quando, id]) => {
      const n = notas.find(x => x.id === Number(id));
      Object.assign(n, { situacao: 'cancelada', chave_original: n.chave, chave: null, motivo_cancelamento: motivo, alterado_por: quem, alterado_em: quando });
      return { affectedRows: 1 };
    }],
    // lista: parâmetros na ordem tipo, de, ate, situacao, q (número e nome), estados do usuário
    [/^SELECT \* FROM web_notas_fiscais/, (sql, params) => {
      const p = [...params];
      const tipo = sql.includes('tipo = ?') ? p.shift() : null;
      const de = sql.includes('data_emissao >= ?') ? p.shift() : null;
      const ate = sql.includes('data_emissao <= ?') ? p.shift() : null;
      const situacao = sql.includes('situacao = ?') ? p.shift() : null;
      const q = sql.includes('numero LIKE ?') ? (p.shift(), p.shift()) : null;
      const estados = sql.includes('ESTADO IN') ? p : null;
      const lim = Number((/LIMIT (\d+)/.exec(sql) || [])[1] || 1e9);
      return notas.filter(n => (tipo === null || n.tipo === tipo) && (de === null || n.data_emissao >= de) && (ate === null || n.data_emissao <= ate)
        && (situacao === null || n.situacao === situacao) && (q === null || sqlLike(q, n.numero, n.contraparte_nome))
        && (estados === null || n.tipo === 'entrada' || clientes.some(c => c.CODIGO === n.contraparte_codigo && estados.includes(c.ESTADO))))
        .sort((a, b) => b.data_emissao.localeCompare(a.data_emissao) || b.id - a.id).slice(0, lim).map(n => ({ ...n }));
    }]
  ];
  const f = criarPoolFalso(regras);
  const semear = {
    fornecedor: (razao = 'Alumínios Brasil') => { const r = { COD: proximoForn++, RAZAO_FABRICANTE: razao }; fornecedores.push(r); return r; },
    cliente: (x = {}) => { const r = { CODIGO: proximoCli++, RAZAO_SOCIAL: 'Construtora Alfa', ESTADO: 'RJ', ...x }; clientes.push(r); return r; },
    nota: (x = {}) => {
      const r = { id: proximoId++, tipo: 'entrada', numero: '100', serie: '1', chave: null, data_emissao: '2026-10-10', contraparte_codigo: 1,
        contraparte_nome: 'Alumínios Brasil', valor_total: '500.00', observacao: '', situacao: 'ativa', motivo_cancelamento: null,
        criado_por: 'Caio', criado_em: '2026-10-10 10:00:00', alterado_por: null, alterado_em: null, ...x };
      notas.push(r); return r;
    }
  };
  semear.fornecedor('Alumínios Brasil');
  semear.cliente({ RAZAO_SOCIAL: 'Construtora Alfa', ESTADO: 'RJ' });
  semear.cliente({ RAZAO_SOCIAL: 'Obras Beta', ESTADO: 'SP' });
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararNotas(t, { perfil = 'Notas com valores', usuario = { codigo: 7, nome: 'Caio' }, banco = bancoNotas(), estados = [] } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: usuario.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados, ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(usuario.codigo, usuario.nome), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { banco, chamar, url: s.url };
}

module.exports = { bancoNotas, prepararNotas, PERFIS };
