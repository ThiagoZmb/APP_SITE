// Banco simulado com estado para as rotas de EPI (rotas/epis.js). Cada regra imita um SQL da rota.
// Imita o que importa da transação: `FOR UPDATE` numa linha segura as outras conexões até commit/rollback,
// e rollback desfaz o que a conexão gravou.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { app, pool, acesso, sessoes } = require('../../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./sessaoFalsa');
aceitarSidDeTeste(sessoes);

const PERFIS = {
  'Almoxarife': ['epi.ver', 'epi.registrar'],
  'Gestor': ['epi.ver', 'epi.registrar', 'epi.gerir'],
  'Administrativo': ['epi.ver', 'administrativo.ver', 'valores.ver'],
  'Só resumo sem valores': ['epi.ver', 'administrativo.ver'],
  'Só ver': ['epi.ver'],
  'Registrar sem ver': ['epi.registrar', 'epi.gerir'],
  'Sem acesso': ['funcionarios.ver']
};

function bancoEpis() {
  const t = {
    epis: [], entradas: [], entregas: [], itens: [], fotos: [], auditoria: [],
    funcionarios: [
      { CODIGO: 1, NOME: 'Ana Lima', SITUACAO: 'Ativo', CPF: '529.982.247-25', SALARIO_BASE: 3000 },
      { CODIGO: 2, NOME: 'Bruno Reis', SITUACAO: 'Demitido', CPF: '', SALARIO_BASE: 2000 },
      { CODIGO: 3, NOME: 'Caio Souza', SITUACAO: 'Ativo', CPF: '', SALARIO_BASE: 2500 }
    ]
  };
  const chamadas = [];
  const proximo = { epis: 1, entradas: 1, entregas: 1, itens: 1, fotos: 1 };
  const falhas = new Set(); // RegExp de SQL que deve estourar (para testar o rollback)
  const dono = new Map(), fila = new Map(); // travas de linha

  const inserir = (tabela, linha, desfazer) => { linha.id = proximo[tabela]++; t[tabela].push(linha); desfazer?.push(() => t[tabela].splice(t[tabela].indexOf(linha), 1)); return { insertId: linha.id, affectedRows: 1 }; };
  const alterar = (linha, novo, desfazer) => { const antes = { ...linha }; Object.assign(linha, novo); desfazer?.push(() => Object.assign(linha, antes)); };
  const validas = () => new Set(t.entregas.filter(e => !e.cancelada_em).map(e => e.id));
  const somar = linhas => [...linhas.reduce((m, l) => m.set(l.epi_id, (m.get(l.epi_id) || 0) + l.quantidade), new Map())];
  const copia = l => l.map(x => ({ ...x }));

  const regras = [
    [/^INSERT INTO web_auditoria/, (p, d) => { const linha = { quando: p[0], quem: p[1], acao: p[2], alvo: p[3], detalhe: JSON.parse(p[4]) }; t.auditoria.push(linha); d?.push(() => t.auditoria.splice(t.auditoria.indexOf(linha), 1)); return { affectedRows: 1 }; }],
    [/^SELECT id, nome, ca, minimo, ativo FROM web_epis ORDER BY nome/, () => copia(t.epis).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))],
    [/^SELECT id, nome, ca, ativo FROM web_epis WHERE id IN/, p => copia(t.epis.filter(e => p.includes(e.id))).sort((a, b) => a.id - b.id)],
    [/^SELECT id, nome, ca, minimo, ativo FROM web_epis WHERE id = \? FOR UPDATE/, ([id]) => copia(t.epis.filter(e => e.id === id))],
    [/^SELECT id FROM web_epis WHERE nome = \? AND id <> \?/, ([nome, id]) => t.epis.filter(e => e.nome.toLowerCase() === nome.toLowerCase() && e.id !== id).map(e => ({ id: e.id }))],
    [/^INSERT INTO web_epis /, ([nome, ca, minimo, criado_em, criado_por], d) => inserir('epis', { nome, ca, minimo, ativo: 1, criado_em, criado_por }, d)],
    [/^UPDATE web_epis SET/, ([nome, ca, minimo, ativo, atualizado_em, atualizado_por, id], d) => { alterar(t.epis.find(e => e.id === id), { nome, ca, minimo, ativo, atualizado_em, atualizado_por }, d); return { affectedRows: 1 }; }],

    [/^SELECT epi_id, SUM\(quantidade\) AS qtd FROM web_epi_entradas/, p => somar(t.entradas.filter(e => !p.length || p.includes(e.epi_id))).map(([epi_id, qtd]) => ({ epi_id, qtd: String(qtd) }))],
    [/^SELECT id, epi_id FROM web_epi_entradas WHERE chave = \?/, ([c]) => copia(t.entradas.filter(e => e.chave === c))],
    [/^INSERT INTO web_epi_entradas/, ([epi_id, quantidade, chave, quando, quem], d) => inserir('entradas', { epi_id, quantidade, chave, quando, quem }, d)],
    [/^SELECT i\.epi_id, SUM\(i\.quantidade\) AS qtd, SUM\(CASE/, ([desde]) => {
      const ok = validas();
      const linhas = t.itens.filter(i => ok.has(i.entrega_id));
      const dentro = linhas.filter(i => t.entregas.find(e => e.id === i.entrega_id).data_entrega >= desde);
      const trinta = new Map(somar(dentro));
      return somar(linhas).map(([epi_id, qtd]) => ({ epi_id, qtd: String(qtd), qtd_30: String(trinta.get(epi_id) || 0) }));
    }],
    [/^SELECT i\.epi_id, SUM\(i\.quantidade\) AS qtd FROM web_epi_entrega_itens/, p => {
      const ok = validas();
      return somar(t.itens.filter(i => ok.has(i.entrega_id) && p.includes(i.epi_id))).map(([epi_id, qtd]) => ({ epi_id, qtd: String(qtd) }));
    }],
    [/^SELECT e\.data_entrega, e\.funcionario_codigo/, () => {
      const ok = validas();
      return t.itens.filter(i => ok.has(i.entrega_id)).map(i => { const e = t.entregas.find(x => x.id === i.entrega_id);
        return { data_entrega: e.data_entrega, funcionario_codigo: e.funcionario_codigo, funcionario_nome: e.funcionario_nome, epi_id: i.epi_id, nome: i.nome, quantidade: i.quantidade }; });
    }],

    [/^SELECT CODIGO, NOME FROM funcionarios WHERE CODIGO = \? AND SITUACAO = 'Ativo'/, ([c]) => t.funcionarios.filter(f => f.CODIGO === c && f.SITUACAO === 'Ativo').map(f => ({ CODIGO: f.CODIGO, NOME: f.NOME }))],
    [/^SELECT CODIGO, NOME FROM funcionarios WHERE SITUACAO = 'Ativo'/, () => t.funcionarios.filter(f => f.SITUACAO === 'Ativo').map(f => ({ CODIGO: f.CODIGO, NOME: f.NOME }))],
    [/^SELECT COUNT\(\*\) AS qtd FROM funcionarios WHERE SITUACAO = 'Ativo'/, () => [{ qtd: t.funcionarios.filter(f => f.SITUACAO === 'Ativo').length }]],

    [/^SELECT id FROM web_epi_entregas WHERE chave = \?/, ([c]) => t.entregas.filter(e => e.chave === c).map(e => ({ id: e.id }))],
    [/^INSERT INTO web_epi_entregas/, ([funcionario_codigo, funcionario_nome, data_entrega, observacao, chave, criado_em, criado_por], d) =>
      inserir('entregas', { funcionario_codigo, funcionario_nome, data_entrega, observacao, chave, criado_em, criado_por, cancelada_em: null, cancelada_por: null, motivo_cancelamento: null }, d)],
    [/^INSERT INTO web_epi_entrega_itens/, (p, d) => {
      for (let i = 0; i < p.length; i += 5) inserir('itens', { entrega_id: p[i], epi_id: p[i + 1], nome: p[i + 2], ca: p[i + 3], quantidade: p[i + 4] }, d);
      return { affectedRows: p.length / 5 };
    }],
    [/^SELECT id, funcionario_codigo, funcionario_nome, data_entrega[\s\S]*FROM web_epi_entregas ORDER BY/, () => copia(t.entregas).sort((a, b) => b.data_entrega.localeCompare(a.data_entrega) || b.id - a.id)],
    [/^SELECT entrega_id, epi_id, nome, ca, quantidade FROM web_epi_entrega_itens/, () => copia(t.itens)],
    [/^SELECT id, funcionario_nome, cancelada_em FROM web_epi_entregas WHERE id = \? FOR UPDATE/, ([id]) => copia(t.entregas.filter(e => e.id === id))],
    [/^UPDATE web_epi_entregas SET cancelada_em/, ([cancelada_em, cancelada_por, motivo_cancelamento, id], d) => { alterar(t.entregas.find(e => e.id === id), { cancelada_em, cancelada_por, motivo_cancelamento }, d); return { affectedRows: 1 }; }],

    [/^SELECT id, entrega_id FROM web_epi_fotos WHERE removida_em IS NULL/, () => t.fotos.filter(f => !f.removida_em).map(f => ({ id: f.id, entrega_id: f.entrega_id }))],
    [/^SELECT id FROM web_epi_fotos WHERE entrega_id = \? AND chave = \?/, ([e, c]) => t.fotos.filter(f => f.entrega_id === e && f.chave === c).map(f => ({ id: f.id }))],
    [/^SELECT COUNT\(\*\) AS qtd FROM web_epi_fotos/, ([e]) => [{ qtd: t.fotos.filter(f => f.entrega_id === e && !f.removida_em).length }]],
    [/^INSERT INTO web_epi_fotos/, ([entrega_id, mime, dados, chave, criado_em, criado_por], d) => inserir('fotos', { entrega_id, mime, dados, chave, criado_em, criado_por, removida_em: null, removida_por: null }, d)],
    [/^SELECT mime, dados FROM web_epi_fotos/, ([id, e]) => copia(t.fotos.filter(f => f.id === id && f.entrega_id === e && !f.removida_em))],
    [/^UPDATE web_epi_fotos SET removida_em/, ([removida_em, removida_por, id, e], d) => {
      const f = t.fotos.find(x => x.id === id && x.entrega_id === e && !x.removida_em);
      if (!f) return { affectedRows: 0 };
      alterar(f, { removida_em, removida_por }, d);
      return { affectedRows: 1 };
    }]
  ];

  async function rodar(sql, params, desfazer) {
    const s = sql.replace(/\s+/g, ' ').trim();
    chamadas.push({ sql: s, params });
    for (const re of falhas) if (re.test(s)) throw new Error('falha simulada');
    for (const [re, fn] of regras) if (re.test(s)) return [fn(params, desfazer), []];
    return [[], []];
  }

  async function getConnection() {
    const eu = Symbol('conexao');
    let desfazer = [];
    const minhas = [];
    const soltar = () => {
      for (const k of minhas.splice(0)) { dono.delete(k); fila.get(k)?.shift()?.(); }
    };
    async function travar(chave) {
      while (dono.has(chave) && dono.get(chave) !== eu) await new Promise(ok => { if (!fila.has(chave)) fila.set(chave, []); fila.get(chave).push(ok); });
      if (!dono.has(chave)) { dono.set(chave, eu); minhas.push(chave); }
    }
    return {
      async execute(sql, params = []) {
        if (/FOR UPDATE/.test(sql)) {
          const tabela = /FROM (\w+)/.exec(sql)[1];
          for (const id of [...params].sort((a, b) => a - b)) await travar(tabela + ':' + id);
        }
        await new Promise(setImmediate); // deixa as outras conexões intercalarem
        return rodar(sql, params, desfazer);
      },
      async beginTransaction() { desfazer = []; chamadas.push({ sql: 'BEGIN', params: [] }); },
      async commit() { desfazer = []; chamadas.push({ sql: 'COMMIT', params: [] }); soltar(); },
      async rollback() { desfazer.reverse().forEach(f => f()); desfazer = []; chamadas.push({ sql: 'ROLLBACK', params: [] }); soltar(); },
      release() { soltar(); }
    };
  }

  const semear = {
    epi: (x = {}) => { const e = { nome: 'Luva nitrílica', ca: '12345', minimo: 2, ativo: 1, ...x }; inserir('epis', e); return e; },
    entrada: (epi_id, quantidade) => inserir('entradas', { epi_id, quantidade, chave: 'semente-' + proximo.entradas })
  };
  return { ...t, chamadas, falhas, semear, execute: (sql, params = []) => rodar(sql, params), getConnection };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function prepararEpis(t, { perfil = 'Gestor', banco = bancoEpis() } = {}) {
  pool.execute = banco.execute; pool.getConnection = banco.getConnection;
  const atual = { perfil };
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Caio', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: atual.perfil },
    estados: [], ativo: true, permissoes: new Set(PERFIS[atual.perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const auth = { Authorization: 'Bearer ' + token(7, 'Caio') };
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { ...auth, 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const enviarFoto = (caminho, bytes, mime = 'image/jpeg') => fetch(s.url + caminho, { method: 'PUT', headers: { ...auth, 'Content-Type': mime }, body: bytes });
  return { banco, chamar, enviarFoto, atual };
}

module.exports = { bancoEpis, prepararEpis, PERFIS };
