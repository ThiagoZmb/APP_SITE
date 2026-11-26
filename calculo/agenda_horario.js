// ==========================================================================
// Agendas (Minha semana e Semana compartilhada): horário opcional dos itens dos dias, funções puras.
// Usado pelo servidor (validação, banco <-> API) e pelas duas telas (grade de horários, ordem da lista, sobrepostos lado a lado).
// API: horario = { inicio: 'HH:MM', fim: 'HH:MM' } ou null ("dia todo"). Banco: hora_inicio/hora_fim SMALLINT em minutos (0 a 1440).
// Regras: docs/regras/minha-semana.md ("Horário e grade") e docs/superpowers/specs/2026-11-26-agendas-horarios-design.md
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.AgendaHorario = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DIA = 1440;        // minutos num dia (24:00 só vale como fim)
  const PASSO = 15;        // arrastar, puxar a borda e clicar andam de 15 em 15 minutos
  const DURACAO = 60;      // item novo na grade e item do "dia todo" levado para a grade
  const MINIMO = 15;       // menor duração ao puxar a borda

  const dois = n => String(n).padStart(2, '0');
  // 'HH:MM' -> minutos (00:00 a 24:00); qualquer outra coisa = null
  function paraMin(s) {
    if (typeof s !== 'string') return null;
    if (s === '24:00') return DIA;
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  const paraHora = m => `${dois(Math.floor(m / 60))}:${dois(m % 60)}`;
  const curta = m => `${Math.floor(m / 60)}:${dois(m % 60)}`;
  const rotulo = h => (h ? `${curta(paraMin(h.inicio))}–${curta(paraMin(h.fim))}` : '');

  // undefined = não mexe; null = dia todo; { inicio, fim } com início < fim dentro do dia
  function validarHorario(h) {
    if (h === undefined) return { ok: true, valor: undefined };
    if (h === null) return { ok: true, valor: null };
    if (typeof h !== 'object' || Array.isArray(h)) return { ok: false, motivo: 'Horário inválido.' };
    const i = paraMin(h.inicio), f = paraMin(h.fim);
    if (i === null || f === null || i >= DIA) return { ok: false, motivo: 'Horário inválido.' };
    if (f <= i) return { ok: false, motivo: 'O fim tem de ser depois do início.' };
    return { ok: true, valor: { inicio: paraHora(i), fim: paraHora(f) } };
  }
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  function doBanco(ini, fim) {
    const i = num(ini), f = num(fim);
    if (i === null || f === null || !Number.isInteger(i) || !Number.isInteger(f) || i < 0 || f > DIA || f <= i) return null;
    return { inicio: paraHora(i), fim: paraHora(f) };
  }
  const paraBanco = h => (h ? [paraMin(h.inicio), paraMin(h.fim)] : [null, null]);
  const duracao = h => paraMin(h.fim) - paraMin(h.inicio);
  const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

  // 'baixo' (padrão) = para baixo, como um clique na grade; 'perto' = o passo mais próximo, como no arraste
  function encaixar(m, modo = 'baixo') {
    const v = modo === 'perto' ? Math.round(m / PASSO) * PASSO : Math.floor(m / PASSO) * PASSO;
    return limitar(v, 0, DIA);
  }
  // item novo criado por um clique na grade: 1h a partir do passo clicado (no fim do dia, até 24:00)
  function novoEm(minuto) {
    const i = Math.min(encaixar(minuto), DIA - PASSO);
    return { inicio: paraHora(i), fim: paraHora(Math.min(i + DURACAO, DIA)) };
  }
  // novo início, mesma duração, sem sair do dia
  function mover(h, inicioNovo) {
    const d = duracao(h);
    const i = limitar(encaixar(inicioNovo, 'perto'), 0, DIA - d);
    return { inicio: paraHora(i), fim: paraHora(i + d) };
  }
  // novo fim (borda de baixo): pelo menos 15 min, até 24:00
  function redimensionar(h, fimNovo) {
    const i = paraMin(h.inicio);
    return { inicio: h.inicio, fim: paraHora(limitar(encaixar(fimNovo, 'perto'), i + MINIMO, DIA)) };
  }

  // ordem na lista do dia (tela estreita): "dia todo" primeiro, na ordem de criação; depois por início, fim e criação;
  // linha ainda sem id (a vazia do fim, ou uma sendo escrita) por último
  function comparar(a, b) {
    const sa = !a.id, sb = !b.id;
    if (sa !== sb) return sa ? 1 : -1;
    const ha = a.horario || null, hb = b.horario || null;
    if (!ha !== !hb) return ha ? 1 : -1;
    if (ha) {
      const d = paraMin(ha.inicio) - paraMin(hb.inicio) || paraMin(ha.fim) - paraMin(hb.fim);
      if (d) return d;
    }
    return (a.id || 0) - (b.id || 0);
  }

  // sobrepostos lado a lado: grupos de itens que se encostam no tempo; dentro do grupo, cada item na 1ª coluna livre.
  // Devolve Map id -> { col, cols } (cols = colunas do grupo, para todos terem a mesma largura).
  function distribuir(itens) {
    const r = new Map();
    const lista = (itens || []).filter(x => x && x.horario).map(x => ({ id: x.id, i: paraMin(x.horario.inicio), f: paraMin(x.horario.fim) }))
      .sort((a, b) => a.i - b.i || a.f - b.f || (a.id || 0) - (b.id || 0));
    let grupo = [], colunas = [], fimGrupo = -1;
    const fechar = () => { for (const g of grupo) r.set(g.id, { col: g.col, cols: colunas.length }); grupo = []; colunas = []; };
    for (const x of lista) {
      if (grupo.length && x.i >= fimGrupo) fechar();
      let c = colunas.findIndex(fim => fim <= x.i);
      if (c < 0) { c = colunas.length; colunas.push(x.f); } else colunas[c] = x.f;
      grupo.push({ id: x.id, col: c });
      fimGrupo = grupo.length === 1 ? x.f : Math.max(fimGrupo, x.f);
    }
    fechar();
    return r;
  }

  return { DIA, PASSO, DURACAO, MINIMO, paraMin, paraHora, rotulo, validarHorario, doBanco, paraBanco, duracao, encaixar, novoEm, mover, redimensionar, comparar, distribuir };
});
