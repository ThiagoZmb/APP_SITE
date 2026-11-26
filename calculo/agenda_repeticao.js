// ==========================================================================
// Agendas (Minha semana e Semana compartilhada): repetição de itens, funções puras.
// Usado pelo servidor (rotas/minha_semana.js e rotas/semana_admin.js calculam as datas; a tela nunca manda a lista) e pelas duas
// telas (prévia "Vai criar N itens" da janela "Repetir..."). Datas 'AAAA-MM-DD' sem fuso: toda conta é em UTC e lida pelos campos.
// Regras: docs/regras/minha-semana.md ("Repetir") e docs/superpowers/specs/2026-11-26-agendas-repeticao-design.md
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.AgendaRepeticao = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_DIAS = 366;     // período da repetição diária (contando o primeiro e o último dia)
  const MAX_MESES = 60;     // ocorrências da repetição mensal
  const ANO_MIN = 2000, ANO_MAX = 2100;
  // a quais itens da série vale uma mudança de texto/categoria ou uma exclusão
  const ESCOPOS = ['este', 'proximos', 'todos'];

  const dois = n => String(n).padStart(2, '0');
  const iso = (a, m, d) => `${a}-${dois(m)}-${dois(d)}`;
  const deUtc = x => iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
  const diasNoMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();   // m = 1..12

  // 'AAAA-MM-DD' que existe no calendário, entre 2000 e 2100; devolve [a, m, d] ou null
  function partes(s) {
    const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!r) return null;
    const a = +r[1], m = +r[2], d = +r[3];
    if (a < ANO_MIN || a > ANO_MAX || m < 1 || m > 12 || d < 1 || d > diasNoMes(a, m)) return null;
    return [a, m, d];
  }
  const utc = s => { const [a, m, d] = partes(s); return Date.UTC(a, m - 1, d); };
  const dataBR = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

  // corpo da requisição -> regra. { tipo: 'diaria', de, ate, pularFimDeSemana } | { tipo: 'mensal', dia, meses }
  function validarRegra(corpo) {
    const c = corpo || {};
    if (c.tipo === 'diaria') {
      if (!partes(c.de) || !partes(c.ate)) return { ok: false, motivo: 'Escolha as duas datas.' };
      if (c.pularFimDeSemana !== undefined && typeof c.pularFimDeSemana !== 'boolean') return { ok: false, motivo: 'Opção inválida.' };
      return { ok: true, regra: { tipo: 'diaria', de: c.de, ate: c.ate, pularFimDeSemana: c.pularFimDeSemana === true } };
    }
    if (c.tipo === 'mensal') {
      if (!Number.isInteger(c.dia) || c.dia < 1 || c.dia > 31) return { ok: false, motivo: 'O dia do mês vai de 1 a 31.' };
      if (!Number.isInteger(c.meses) || c.meses < 2 || c.meses > MAX_MESES) return { ok: false, motivo: `Escolha de 2 a ${MAX_MESES} meses.` };
      return { ok: true, regra: { tipo: 'mensal', dia: c.dia, meses: c.meses } };
    }
    return { ok: false, motivo: 'Escolha como repetir.' };
  }

  // As datas da série, em ordem; a primeira é para onde vai o próprio item.
  // `referencia`: a data do item (quadro do dia) ou hoje (item em Tarefas); só a mensal usa.
  // Diária: todos os dias de `de` a `ate` (sábados e domingos entram, a não ser com pularFimDeSemana).
  // Mensal: a primeira data >= referencia com o dia N; mês sem o dia N cai no último dia dele (30 -> 28/29 em fevereiro)
  // e o mês seguinte volta ao dia N. Fim de semana fica no dia certo.
  function datasDaRegra(regra, referencia) {
    if (regra.tipo === 'diaria') {
      const de = utc(regra.de), ate = utc(regra.ate);
      if (ate < de) return { ok: false, motivo: 'A data final é antes da inicial.' };
      const total = Math.round((ate - de) / 86400000) + 1;
      if (total > MAX_DIAS) return { ok: false, motivo: `O período pode ter até ${MAX_DIAS} dias.` };
      const datas = [];
      for (let i = 0; i < total; i++) {
        const x = new Date(de + i * 86400000);
        if (regra.pularFimDeSemana && (x.getUTCDay() === 0 || x.getUTCDay() === 6)) continue;
        datas.push(deUtc(x));
      }
      if (datas.length < 2) return { ok: false, motivo: regra.pularFimDeSemana ? 'Sem os fins de semana, o período precisa ter pelo menos dois dias.' : 'O período precisa ter pelo menos dois dias.' };
      return { ok: true, datas };
    }
    const ref = partes(referencia);
    if (!ref) return { ok: false, motivo: 'Data do item inválida.' };
    let [a, m] = ref;
    const noMes = (ano, mes) => iso(ano, mes, Math.min(regra.dia, diasNoMes(ano, mes)));
    if (noMes(a, m) < referencia) { m++; if (m > 12) { m = 1; a++; } }
    const datas = [];
    for (let i = 0; i < regra.meses; i++) {
      datas.push(noMes(a, m));
      m++; if (m > 12) { m = 1; a++; }
    }
    if (+datas[datas.length - 1].slice(0, 4) > ANO_MAX) return { ok: false, motivo: 'A repetição passa de 2100.' };
    return { ok: true, datas };
  }

  // texto da prévia: "Vai criar 7 itens: de 26/11/2026 a 02/12/2026."
  const resumo = datas => `Vai criar ${datas.length} ${datas.length === 1 ? 'item' : 'itens'}: de ${dataBR(datas[0])} a ${dataBR(datas[datas.length - 1])}.`;
  const escopoValido = e => e === undefined || ESCOPOS.includes(e);

  // os itens da série que a escolha alcança. `membros` = linhas da série (com id e serie_pos), `clicado` = o item mexido.
  // "Este e os próximos" = posição na série >= a deste (a ordem em que a série foi criada; mover um dia não muda a posição).
  function noEscopo(membros, clicado, escopo) {
    const id = Number(clicado.id);
    const lista = membros.some(m => Number(m.id) === id) ? membros : [clicado, ...membros];
    if (escopo === 'todos') return lista;
    if (escopo === 'proximos' && clicado.serie_pos != null) return lista.filter(m => Number(m.id) === id || (m.serie_pos != null && Number(m.serie_pos) >= Number(clicado.serie_pos)));
    return lista.filter(m => Number(m.id) === id);
  }

  return { MAX_DIAS, MAX_MESES, ESCOPOS, validarRegra, datasDaRegra, resumo, dataBR, escopoValido, noEscopo };
});
