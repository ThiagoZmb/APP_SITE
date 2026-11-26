// Banco em memória das duas semanas (web_tarefas, web_tarefas_admin, web_tarefas_admin_avisos) e dos alarmes.
// Entende só o SQL das rotas rotas/minha_semana.js, rotas/semana_admin.js e rotas/alarmes.js; obedece aos parâmetros
// (usuário, versão, id): se a rota esquecer um filtro, o teste correspondente falha.
const { criarPoolFalso } = require('./poolFalso');

function criarBancoSemana() {
  const pessoais = [], admin = [], avisos = [], catPessoais = [], catAdmin = [];
  const seq = { pessoal: 0, admin: 0, catPessoal: 0, catAdmin: 0 };
  // como o utf8mb4_unicode_ci: "Médico" e "medico" são o mesmo nome (a chave única recusa)
  const chave = n => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const duplicado = (lista, nome, id) => lista.some(c => c.id !== id && chave(c.nome) === chave(nome));
  const erroDup = () => { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; e.errno = 1062; return e; };
  const porNome = (a, b) => chave(a.nome).localeCompare(chave(b.nome)) || a.id - b.id;
  const copia = l => ({ ...l });
  const dt = v => (typeof v === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(v) ? v + ':00' : v);   // como o MySQL devolve DATETIME com dateStrings

  // UPDATE genérico: "col = ?" consome um parâmetro, "versao = versao + 1" soma; o WHERE é todo de "col = ?"
  function atualizar(tabela, sql, params) {
    const [, sets, onde] = /SET (.*) WHERE (.*)$/.exec(sql);
    const p = [...params];
    const mudancas = sets.split(', ').map(c => (c === 'versao = versao + 1' ? ['versao', null, true] : [c.split(' = ')[0], p.shift(), false]));
    const filtros = onde.split(' AND ').map(c => [c.split(' = ')[0], p.shift()]);
    const alvo = tabela.filter(l => filtros.every(([c, v]) => String(l[c]) === String(dt(v))));
    for (const l of alvo) for (const [c, v, soma] of mudancas) l[c] = soma ? l[c] + 1 : (/^alarme/.test(c) ? dt(v) : v);
    return { affectedRows: alvo.length };
  }
  const apagar = (lista, cond) => {
    const antes = lista.length;
    for (let i = lista.length - 1; i >= 0; i--) if (cond(lista[i])) lista.splice(i, 1);
    return { affectedRows: antes - lista.length };
  };
  const naSemana = (l, de, ate) => l.quadro !== 'dia' || (l.data >= de && l.data <= ate);
  const avisoDe = (t, usuario) => avisos.find(a => a.tarefa_id === t.id && a.usuario_codigo === usuario && a.alarme === t.alarme);
  // "id IN (?, ?, ...)": os ids são os últimos parâmetros
  const ids = (sql, params) => { const n = (/id IN \(([^)]*)\)/.exec(sql)[1].match(/\?/g) || []).length; return params.slice(params.length - n).map(Number); };
  // UPDATE ... SET a = ?, b = ?, [versao = versao + 1] WHERE [usuario_codigo = ? AND] id IN (...)
  function atualizarIn(tabela, sql, params, comDono) {
    const [, sets] = /SET (.*) WHERE /.exec(sql);
    const lista = ids(sql, params);
    const p = [...params];
    const mudancas = sets.split(', ').map(c => (c === 'versao = versao + 1' ? ['versao', null, true] : [c.split(' = ')[0], p.shift(), false]));
    const dono = comDono ? p.shift() : undefined;
    const alvo = tabela.filter(l => lista.includes(l.id) && (!comDono || l.usuario_codigo === dono));
    for (const l of alvo) for (const [c, v, soma] of mudancas) l[c] = soma ? l[c] + 1 : v;
    return { affectedRows: alvo.length };
  }
  // INSERT de várias linhas: `por` parâmetros em cada grupo de VALUES
  const grupos = (params, por) => Array.from({ length: params.length / por }, (_, i) => params.slice(i * por, (i + 1) * por));

  const f = criarPoolFalso([
    // ----- pessoal: série (várias linhas, por série, por lista de ids) -----
    [/^INSERT INTO web_tarefas \(usuario_codigo, quadro, data, texto, feita, criado_em, atualizado_em, categoria_id, serie_id, serie_pos\) VALUES /, (sql, params) => {
      let primeiro = 0;
      for (const [usuario_codigo, data, texto, , , categoria_id, serie_id, serie_pos] of grupos(params, 8)) {
        const id = ++seq.pessoal;
        primeiro ||= id;
        pessoais.push({ id, usuario_codigo, quadro: 'dia', data, texto, feita: 0, alarme: null, alarme_visto: null, alarme_adiado: null, categoria_id, serie_id, serie_pos });
      }
      return { insertId: primeiro, affectedRows: params.length / 8 };
    }],
    [/^SELECT .* FROM web_tarefas WHERE usuario_codigo = \? AND serie_id = \? ORDER BY serie_pos, id/, (sql, [u, s]) =>
      pessoais.filter(l => l.usuario_codigo === u && l.serie_id === s).sort((a, b) => a.serie_pos - b.serie_pos || a.id - b.id).map(copia)],
    [/^UPDATE web_tarefas SET .* WHERE usuario_codigo = \? AND id IN \(/, (sql, params) => atualizarIn(pessoais, sql, params, true)],
    [/^DELETE FROM web_tarefas WHERE usuario_codigo = \? AND id IN \(/, (sql, params) => { const [u] = params; const lista = ids(sql, params); return apagar(pessoais, l => l.usuario_codigo === u && lista.includes(l.id)); }],
    // ----- pessoal -----
    [/^INSERT INTO web_tarefas \(/, (sql, [usuario_codigo, quadro, data, texto, , , categoria_id]) => {
      const id = ++seq.pessoal;
      pessoais.push({ id, usuario_codigo, quadro, data, texto, feita: 0, alarme: null, alarme_visto: null, alarme_adiado: null, categoria_id: categoria_id ?? null, serie_id: null, serie_pos: null });
      return { insertId: id, affectedRows: 1 };
    }],
    // ----- categorias da pessoal (sempre com o dono) -----
    [/^SELECT id, nome, cor FROM web_tarefas_categorias WHERE usuario_codigo = \? ORDER BY nome, id$/, (sql, [u]) => catPessoais.filter(c => c.usuario_codigo === u).sort(porNome).map(copia)],
    [/^SELECT id FROM web_tarefas_categorias WHERE id = \? AND usuario_codigo = \?$/, (sql, [id, u]) => catPessoais.filter(c => c.id === Number(id) && c.usuario_codigo === u).map(c => ({ id: c.id }))],
    [/^INSERT INTO web_tarefas_categorias \(usuario_codigo, nome, cor, criado_em, atualizado_em\) VALUES \(\?, \?, \?, \?, \?\)$/, (sql, [usuario_codigo, nome, cor]) => {
      if (duplicado(catPessoais.filter(c => c.usuario_codigo === usuario_codigo), nome)) throw erroDup();
      const id = ++seq.catPessoal;
      catPessoais.push({ id, usuario_codigo, nome, cor });
      return { insertId: id, affectedRows: 1 };
    }],
    [/^UPDATE web_tarefas_categorias SET /, (sql, params) => {
      const alvo = catPessoais.find(c => c.id === Number(params.at(-2)) && c.usuario_codigo === params.at(-1));
      if (alvo && /nome = \?/.test(sql) && duplicado(catPessoais.filter(c => c.usuario_codigo === alvo.usuario_codigo), params[0], alvo.id)) throw erroDup();
      return atualizar(catPessoais, sql, params);
    }],
    [/^DELETE FROM web_tarefas_categorias WHERE id = \? AND usuario_codigo = \?$/, (sql, [id, u]) => apagar(catPessoais, c => c.id === Number(id) && c.usuario_codigo === u)],
    // ----- categorias da compartilhada (lista única) -----
    [/^SELECT id, nome, cor FROM web_tarefas_admin_categorias ORDER BY nome, id$/, () => [...catAdmin].sort(porNome).map(copia)],
    [/^SELECT id FROM web_tarefas_admin_categorias WHERE id = \?$/, (sql, [id]) => catAdmin.filter(c => c.id === Number(id)).map(c => ({ id: c.id }))],
    [/^INSERT INTO web_tarefas_admin_categorias \(nome, cor, criado_por_codigo, criado_em, atualizado_em\) VALUES \(\?, \?, \?, \?, \?\)$/, (sql, [nome, cor, criado_por_codigo]) => {
      if (duplicado(catAdmin, nome)) throw erroDup();
      const id = ++seq.catAdmin;
      catAdmin.push({ id, nome, cor, criado_por_codigo });
      return { insertId: id, affectedRows: 1 };
    }],
    [/^UPDATE web_tarefas_admin_categorias SET /, (sql, params) => {
      const alvo = catAdmin.find(c => c.id === Number(params.at(-1)));
      if (alvo && /nome = \?/.test(sql) && duplicado(catAdmin, params[0], alvo.id)) throw erroDup();
      return atualizar(catAdmin, sql, params);
    }],
    [/^DELETE FROM web_tarefas_admin_categorias WHERE id = \?$/, (sql, [id]) => apagar(catAdmin, c => c.id === Number(id))],
    [/^SELECT .* FROM web_tarefas WHERE usuario_codigo = \? AND \(quadro/, (sql, [u, de, ate]) => pessoais.filter(l => l.usuario_codigo === u && naSemana(l, de, ate)).map(copia)],
    [/^SELECT .* FROM web_tarefas WHERE usuario_codigo = \? AND feita = 0 AND alarme IS NOT NULL/, (sql, [u]) =>
      pessoais.filter(l => l.usuario_codigo === u && !l.feita && l.alarme && l.alarme_visto !== l.alarme)
        .map(l => ({ id: l.id, texto: l.texto, alarme: l.alarme, adiado: l.alarme_adiado }))],
    [/^SELECT .* FROM web_tarefas WHERE id = \? AND usuario_codigo = \?/, (sql, [id, u]) => pessoais.filter(l => l.id === Number(id) && l.usuario_codigo === u).map(copia)],
    [/^UPDATE web_tarefas SET /, (sql, params) => atualizar(pessoais, sql, params)],
    [/^DELETE FROM web_tarefas WHERE id = \? AND usuario_codigo = \?/, (sql, [id, u]) => apagar(pessoais, l => l.id === Number(id) && l.usuario_codigo === u)],
    // ----- compartilhada: série -----
    [/^INSERT INTO web_tarefas_admin \(quadro, data, texto, criada_por_codigo, criada_por, feita, versao, criado_em, atualizado_em, categoria_id, serie_id, serie_pos\) VALUES /, (sql, params) => {
      let primeiro = 0;
      for (const [data, texto, criada_por_codigo, criada_por, , , categoria_id, serie_id, serie_pos] of grupos(params, 9)) {
        const id = ++seq.admin;
        primeiro ||= id;
        admin.push({ id, quadro: 'dia', data, texto, feita: 0, alarme: null, versao: 1, criada_por_codigo, criada_por, feita_por: null, categoria_id, serie_id, serie_pos });
      }
      return { insertId: primeiro, affectedRows: params.length / 9 };
    }],
    [/^SELECT .* FROM web_tarefas_admin WHERE serie_id = \? ORDER BY serie_pos, id/, (sql, [s]) =>
      admin.filter(l => l.serie_id === s).sort((a, b) => a.serie_pos - b.serie_pos || a.id - b.id).map(copia)],
    [/^UPDATE web_tarefas_admin SET .* WHERE id IN \(/, (sql, params) => atualizarIn(admin, sql, params, false)],
    [/^DELETE FROM web_tarefas_admin WHERE id IN \(/, (sql, params) => { const lista = ids(sql, params); return apagar(admin, l => lista.includes(l.id)); }],
    [/^DELETE FROM web_tarefas_admin_avisos WHERE tarefa_id IN \(/, (sql, params) => apagar(avisos, a => params.map(Number).includes(a.tarefa_id))],
    // ----- compartilhada -----
    [/^INSERT INTO web_tarefas_admin \(/, (sql, [quadro, data, texto, criada_por_codigo, criada_por, , , categoria_id]) => {
      const id = ++seq.admin;
      admin.push({ id, quadro, data, texto, feita: 0, alarme: null, versao: 1, criada_por_codigo, criada_por, feita_por: null, categoria_id: categoria_id ?? null, serie_id: null, serie_pos: null });
      return { insertId: id, affectedRows: 1 };
    }],
    [/^SELECT .* FROM web_tarefas_admin t LEFT JOIN web_tarefas_admin_avisos/, (sql, [u]) => admin
      .filter(t => !t.feita && t.alarme && !avisoDe(t, u)?.visto)
      .map(t => ({ id: t.id, texto: t.texto, alarme: t.alarme, adiado: avisoDe(t, u)?.adiado ?? null }))],
    [/^SELECT .* FROM web_tarefas_admin WHERE quadro IN/, (sql, [de, ate]) => admin.filter(l => naSemana(l, de, ate)).map(copia)],
    [/^SELECT .* FROM web_tarefas_admin WHERE id = \?/, (sql, [id]) => admin.filter(l => l.id === Number(id)).map(copia)],
    [/^UPDATE web_tarefas_admin SET /, (sql, params) => atualizar(admin, sql, params)],
    [/^DELETE FROM web_tarefas_admin WHERE id = \? AND versao = \?/, (sql, [id, versao]) => apagar(admin, l => l.id === Number(id) && l.versao === versao)],
    [/^DELETE FROM web_tarefas_admin_avisos WHERE tarefa_id = \?/, (sql, [id]) => apagar(avisos, a => a.tarefa_id === Number(id))],
    [/^INSERT INTO web_tarefas_admin_avisos /, (sql, [tarefa, usuario_codigo, alarme, ate]) => {
      const tarefa_id = Number(tarefa);
      const ok = /VALUES \(\?, \?, \?, 1, NULL\)/.test(sql);
      const novo = { tarefa_id, usuario_codigo, alarme: dt(alarme), visto: ok ? 1 : 0, adiado: ok ? null : dt(ate) };
      const velho = avisos.find(a => a.tarefa_id === tarefa_id && a.usuario_codigo === usuario_codigo);
      if (!velho) { avisos.push(novo); return { affectedRows: 1 }; }
      if (!ok && velho.alarme === novo.alarme) novo.visto = velho.visto;   // adiar não desfaz um OK do MESMO alarme
      Object.assign(velho, novo);
      return { affectedRows: 2 };
    }]
  ]);
  // trava de linha como no InnoDB: "SELECT ... WHERE id = ? ... FOR UPDATE" numa transação espera a outra transação que já travou
  // a mesma linha terminar (COMMIT ou ROLLBACK). Sem isso o teste do clique duplo não provaria nada.
  const travas = new Map();
  const conexao = f.getConnection;
  f.getConnection = async () => {
    const c = await conexao();
    const minhas = new Set();
    const liberar = () => { for (const k of minhas) { travas.get(k).soltar(); travas.delete(k); } minhas.clear(); };
    const execute = async (sql, params = []) => {
      const m = /^SELECT .* FROM (web_tarefas(?:_admin)?) WHERE id = \?.* FOR UPDATE$/.exec(sql);
      if (m) {
        const k = m[1] + ':' + Number(params[0]);
        while (travas.has(k) && !minhas.has(k)) await travas.get(k).espera;
        if (!travas.has(k)) { let soltar; const espera = new Promise(r => { soltar = r; }); travas.set(k, { espera, soltar }); minhas.add(k); }
      }
      return c.execute(sql, params);
    };
    return { ...c, execute, query: execute, commit: async () => { await c.commit(); liberar(); }, rollback: async () => { await c.rollback(); liberar(); }, release: () => { liberar(); c.release(); } };
  };
  return { f, pessoais, admin, avisos, catPessoais, catAdmin };
}

module.exports = { criarBancoSemana };
