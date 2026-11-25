// Banco em memória das duas semanas (web_tarefas, web_tarefas_admin, web_tarefas_admin_avisos) e dos alarmes.
// Entende só o SQL das rotas rotas/minha_semana.js, rotas/semana_admin.js e rotas/alarmes.js; obedece aos parâmetros
// (usuário, versão, id): se a rota esquecer um filtro, o teste correspondente falha.
const { criarPoolFalso } = require('./poolFalso');

function criarBancoSemana() {
  const pessoais = [], admin = [], avisos = [];
  const seq = { pessoal: 0, admin: 0 };
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

  const f = criarPoolFalso([
    // ----- pessoal -----
    [/^INSERT INTO web_tarefas \(/, (sql, [usuario_codigo, quadro, data, texto]) => {
      const id = ++seq.pessoal;
      pessoais.push({ id, usuario_codigo, quadro, data, texto, feita: 0, alarme: null, alarme_visto: null, alarme_adiado: null });
      return { insertId: id, affectedRows: 1 };
    }],
    [/^SELECT .* FROM web_tarefas WHERE usuario_codigo = \? AND \(quadro/, (sql, [u, de, ate]) => pessoais.filter(l => l.usuario_codigo === u && naSemana(l, de, ate)).map(copia)],
    [/^SELECT .* FROM web_tarefas WHERE usuario_codigo = \? AND feita = 0 AND alarme IS NOT NULL/, (sql, [u]) =>
      pessoais.filter(l => l.usuario_codigo === u && !l.feita && l.alarme && l.alarme_visto !== l.alarme)
        .map(l => ({ id: l.id, texto: l.texto, alarme: l.alarme, adiado: l.alarme_adiado }))],
    [/^SELECT .* FROM web_tarefas WHERE id = \? AND usuario_codigo = \?/, (sql, [id, u]) => pessoais.filter(l => l.id === Number(id) && l.usuario_codigo === u).map(copia)],
    [/^UPDATE web_tarefas SET /, (sql, params) => atualizar(pessoais, sql, params)],
    [/^DELETE FROM web_tarefas WHERE id = \? AND usuario_codigo = \?/, (sql, [id, u]) => apagar(pessoais, l => l.id === Number(id) && l.usuario_codigo === u)],
    // ----- compartilhada -----
    [/^INSERT INTO web_tarefas_admin \(/, (sql, [quadro, data, texto, criada_por_codigo, criada_por]) => {
      const id = ++seq.admin;
      admin.push({ id, quadro, data, texto, feita: 0, alarme: null, versao: 1, criada_por_codigo, criada_por, feita_por: null });
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
  return { f, pessoais, admin, avisos };
}

module.exports = { criarBancoSemana };
