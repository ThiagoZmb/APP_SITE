// Banco simulado com estado para as rotas de DANFE (rotas/danfe.js). Cada regra imita um SQL da rota.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');

const PERFIS = {
  'Administrador': ['danfe.ver', 'danfe.enviar', 'danfe.vincular'],
  'Só ver': ['danfe.ver'],
  'Sem acesso': ['pedidos.ver']
};

// gera uma chave de acesso válida (DV módulo 11) com os campos pedidos
function chaveCom({ uf = '32', aamm = '2606', cnpj = '08951388000118', modelo = '55', serie = 1, numero = 11290, tpEmis = '1', cNF = '00000285' } = {}) {
  const base = uf + aamm + cnpj + modelo + String(serie).padStart(3, '0') + String(numero).padStart(9, '0') + tpEmis + cNF;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base + (r < 2 ? 0 : 11 - r);
}
const pdfBytes = (texto = 'x') => Buffer.from('%PDF-1.4\n' + texto + '\n%%EOF');

function bancoDanfe() {
  const estado = { danfe: [], vinculos: [], pedidos: [], clientes: [], fluxo: [], auditoria: [] };
  const { danfe, vinculos, pedidos, clientes, fluxo, auditoria } = estado;
  let proximoId = 1, proximoVinculo = 1;
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const sqlLike = (v, campo) => String(campo ?? '').includes(String(v).replace(/^%|%$/g, '').replace(/\\(.)/g, '$1'));

  const regras = [
    [/INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quando, quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    [/^SELECT cnpj_emitente, COUNT\(\*\) AS qtd FROM web_danfe GROUP BY/, () => {
      const cont = {};
      for (const d of danfe) cont[d.cnpj_emitente] = (cont[d.cnpj_emitente] || 0) + 1;
      const ord = Object.entries(cont).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return ord.length ? [{ cnpj_emitente: ord[0][0], qtd: ord[0][1] }] : [];
    }],
    [/^SELECT chave FROM web_danfe WHERE chave IN/, (sql, chaves) => danfe.filter(d => chaves.includes(d.chave)).map(d => ({ chave: d.chave }))],
    [/^SELECT id, sha256 FROM web_danfe WHERE chave = \?/, (sql, [chave]) => danfe.filter(d => d.chave === chave).map(d => ({ id: d.id, sha256: d.sha256 }))],
    [/^SELECT id FROM web_danfe WHERE chave = \?/, (sql, [chave]) => danfe.filter(d => d.chave === chave).map(d => ({ id: d.id }))],
    [/^INSERT INTO web_danfe \(/, (sql, [chave, numero_nf, serie, modelo, cnpj_emitente, data_emissao_aamm, pdf, tamanho, sha256, enviado_por, enviado_em]) => {
      if (estado.falharInsertDuplicado) { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e; }
      danfe.push({ id: proximoId++, chave, numero_nf, serie, modelo, cnpj_emitente, data_emissao_aamm, pdf, tamanho, sha256, enviado_por, enviado_em });
      return { affectedRows: 1 };
    }],
    [/^UPDATE web_danfe SET pdf/, (sql, [pdf, tamanho, sha256, enviado_por, enviado_em, id]) => {
      Object.assign(danfe.find(d => d.id === id), { pdf, tamanho, sha256, enviado_por, enviado_em });
      return { affectedRows: 1 };
    }],
    [/^SELECT chave, numero_nf, modelo, cnpj_emitente, pdf FROM web_danfe WHERE chave = \?/, (sql, [chave]) => danfe.filter(d => d.chave === chave).map(d => ({ ...d }))],
    [/^SELECT NUMERO, RAZAO_SOCIAL FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido'/, (sql, [n]) => pedidos.filter(p => p.NUMERO === Number(n) && p.TIPO === 'Pedido').map(p => ({ ...p }))],
    [/^SELECT NUMERO FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido'/, (sql, [n]) => pedidos.filter(p => p.NUMERO === Number(n) && p.TIPO === 'Pedido').map(p => ({ NUMERO: p.NUMERO }))],
    [/^SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = \?/, (sql, [razao]) => clientes.filter(c => c.RAZAO_SOCIAL === razao).map(c => ({ ESTADO: c.ESTADO }))],
    [/^SELECT p\.NUMERO FROM ped_orc p JOIN cadastro_clientes c/, (sql, params) => {
      const n = (sql.match(/IN \(([?, ]+)\) AND/) || [, ''])[1].split(',').length;
      const nums = params.slice(0, n).map(Number), estados = params.slice(n);
      return pedidos.filter(p => p.TIPO === 'Pedido' && nums.includes(p.NUMERO) && clientes.some(c => c.RAZAO_SOCIAL === p.RAZAO_SOCIAL && estados.includes(c.ESTADO))).map(p => ({ NUMERO: p.NUMERO }));
    }],
    [/^SELECT NOTA_FISCAL FROM fluxo_de_caixa WHERE TRIM\(PEDIDO\) = \?/, (sql, [p]) => fluxo.filter(f => String(f.PEDIDO).trim() === String(p) && f.NOTA_FISCAL).map(f => ({ NOTA_FISCAL: f.NOTA_FISCAL }))],
    [/^SELECT PEDIDO, NOTA_FISCAL FROM fluxo_de_caixa WHERE NOTA_FISCAL LIKE \?/, (sql, [l]) => fluxo.filter(f => f.PEDIDO && sqlLike(l, f.NOTA_FISCAL)).map(f => ({ PEDIDO: f.PEDIDO, NOTA_FISCAL: f.NOTA_FISCAL }))],
    [/^SELECT chave, numero_nf, serie, enviado_em FROM web_danfe WHERE modelo = \? AND cnpj_emitente = \?/, (sql, [modelo, cnpj, ...numeros]) =>
      danfe.filter(d => d.modelo === modelo && d.cnpj_emitente === cnpj && numeros.includes(d.numero_nf)).sort((a, b) => a.numero_nf - b.numero_nf || a.id - b.id).map(d => ({ ...d }))],
    [/^SELECT d\.chave, d\.numero_nf, d\.serie, d\.enviado_em FROM web_danfe_vinculos v JOIN web_danfe d/, (sql, [n]) =>
      vinculos.filter(v => v.pedido_numero === Number(n)).map(v => danfe.find(d => d.chave === v.chave)).filter(Boolean).map(d => ({ ...d }))],
    [/^SELECT chave, numero_nf, serie, enviado_em FROM web_danfe/, (sql, params) => {
      let r = danfe.map(d => ({ ...d }));
      if (sql.includes('numero_nf = ?')) r = r.filter(d => d.numero_nf === params[0] || d.chave.includes(String(params[1]).replace(/^%|%$/g, '')));
      const lim = Number((/LIMIT (\d+)/.exec(sql) || [])[1] || 1e9);
      return r.sort((a, b) => String(b.enviado_em).localeCompare(String(a.enviado_em)) || b.id - a.id).slice(0, lim);
    }],
    [/^SELECT chave, pedido_numero FROM web_danfe_vinculos WHERE chave IN/, (sql, chaves) => vinculos.filter(v => chaves.includes(v.chave)).map(v => ({ ...v }))],
    [/^SELECT pedido_numero FROM web_danfe_vinculos WHERE chave = \?/, (sql, [chave]) => vinculos.filter(v => v.chave === chave).map(v => ({ pedido_numero: v.pedido_numero }))],
    [/^INSERT IGNORE INTO web_danfe_vinculos/, (sql, [chave, pedido, criado_por, criado_em]) => {
      if (vinculos.some(v => v.chave === chave && v.pedido_numero === pedido)) return { affectedRows: 0 };
      vinculos.push({ id: proximoVinculo++, chave, pedido_numero: pedido, criado_por, criado_em });
      return { affectedRows: 1 };
    }],
    [/^DELETE FROM web_danfe_vinculos WHERE chave = \? AND pedido_numero = \?/, (sql, [chave, pedido]) => {
      const i = vinculos.findIndex(v => v.chave === chave && v.pedido_numero === pedido);
      if (i < 0) return { affectedRows: 0 };
      vinculos.splice(i, 1); return { affectedRows: 1 };
    }]
  ];
  const f = criarPoolFalso(regras);
  const semear = {
    cliente: (x = {}) => { const r = { RAZAO_SOCIAL: 'Construtora Alfa', ESTADO: 'RJ', ...x }; clientes.push(r); return r; },
    pedido: (x = {}) => { const r = { NUMERO: 100, TIPO: 'Pedido', RAZAO_SOCIAL: 'Construtora Alfa', ...x }; pedidos.push(r); return r; },
    fluxo: (x = {}) => { const r = { PEDIDO: '100', NOTA_FISCAL: '11290', ...x }; fluxo.push(r); return r; },
    // DANFE direto no banco (sem passar pela rota)
    danfe: (x = {}) => {
      const chave = x.chave || chaveCom(x);
      const l = { chave, numero: Number(chave.slice(25, 34)), serie: Number(chave.slice(22, 25)), modelo: chave.slice(20, 22), cnpj: chave.slice(6, 20), aamm: chave.slice(2, 6) };
      const pdf = x.pdf || pdfBytes(chave);
      const r = { id: proximoId++, chave, numero_nf: l.numero, serie: l.serie, modelo: l.modelo, cnpj_emitente: l.cnpj, data_emissao_aamm: l.aamm, pdf, tamanho: pdf.length,
        sha256: sha(pdf), enviado_por: 'Caio', enviado_em: x.enviado_em || '2026-10-20 10:00:00' };
      danfe.push(r); return r;
    },
    vinculo: (chave, pedido) => { const r = { id: proximoVinculo++, chave, pedido_numero: pedido, criado_por: 'Caio', criado_em: '2026-10-20 10:00:00' }; vinculos.push(r); return r; }
  };
  semear.cliente({ RAZAO_SOCIAL: 'Construtora Alfa', ESTADO: 'RJ' });
  semear.cliente({ RAZAO_SOCIAL: 'Obras Beta', ESTADO: 'SP' });
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararDanfe(t, { perfil = 'Administrador', usuario = { codigo: 7, nome: 'Caio' }, banco = bancoDanfe(), estados = [] } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: usuario.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados, ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const cab = { Authorization: 'Bearer ' + token(usuario.codigo, usuario.nome) };
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { ...cab, 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const enviar = (chave, corpo, tipo = 'application/pdf') => fetch(s.url + '/danfe/' + chave, { method: 'PUT', headers: { ...cab, 'Content-Type': tipo }, body: corpo });
  return { banco, chamar, enviar, url: s.url };
}

module.exports = { bancoDanfe, prepararDanfe, chaveCom, pdfBytes, PERFIS };
