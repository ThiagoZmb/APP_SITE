// Agendas: repetição de itens, funções puras (calculo/agenda_repeticao.js), usadas pelo servidor e pela prévia das telas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../calculo/agenda_repeticao.js');

const datas = (regra, ref) => { const r = R.datasDaRegra(regra, ref); assert.ok(r.ok, r.motivo); return r.datas; };

test('diária: todos os dias de/até, sábados e domingos entram por padrão; pular fins de semana tira os dois', () => {
  assert.deepEqual(datas({ tipo: 'diaria', de: '2026-11-26', ate: '2026-12-02', pularFimDeSemana: false }), ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(datas({ tipo: 'diaria', de: '2026-11-26', ate: '2026-12-02', pularFimDeSemana: true }), ['2026-11-26', '2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(datas({ tipo: 'diaria', de: '2026-12-30', ate: '2027-01-02', pularFimDeSemana: false }), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'], 'virada de ano');
  assert.deepEqual(datas({ tipo: 'diaria', de: '2028-02-28', ate: '2028-03-01', pularFimDeSemana: false }), ['2028-02-28', '2028-02-29', '2028-03-01'], 'ano bissexto');
});

test('diária: até 366 dias; final antes do inicial, um dia só ou só fim de semana pulado = recusado', () => {
  assert.equal(datas({ tipo: 'diaria', de: '2026-01-01', ate: '2027-01-01', pularFimDeSemana: false }).length, 366);
  assert.equal(R.datasDaRegra({ tipo: 'diaria', de: '2026-01-01', ate: '2027-01-02', pularFimDeSemana: false }).ok, false);
  assert.match(R.datasDaRegra({ tipo: 'diaria', de: '2026-01-01', ate: '2027-01-02', pularFimDeSemana: false }).motivo, /366/);
  assert.match(R.datasDaRegra({ tipo: 'diaria', de: '2026-12-02', ate: '2026-12-01', pularFimDeSemana: false }).motivo, /antes/);
  assert.equal(R.datasDaRegra({ tipo: 'diaria', de: '2026-12-01', ate: '2026-12-01', pularFimDeSemana: false }).ok, false);
  assert.equal(R.datasDaRegra({ tipo: 'diaria', de: '2026-11-28', ate: '2026-11-29', pularFimDeSemana: true }).ok, false, 'sábado e domingo pulados: nada sobra');
});

test('mensal: começa na primeira data com o dia N >= referência; mês sem o dia cai no último e volta ao dia N', () => {
  assert.deepEqual(datas({ tipo: 'mensal', dia: 30, meses: 4 }, '2026-12-10'), ['2026-12-30', '2027-01-30', '2027-02-28', '2027-03-30']);
  assert.deepEqual(datas({ tipo: 'mensal', dia: 30, meses: 3 }, '2028-01-31'), ['2028-02-29', '2028-03-30', '2028-04-30'], 'fevereiro bissexto; a referência 31/01 já passou do dia 30');
  assert.deepEqual(datas({ tipo: 'mensal', dia: 31, meses: 5 }, '2026-01-31'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'], 'o próprio dia vale');
  assert.deepEqual(datas({ tipo: 'mensal', dia: 5, meses: 2 }, '2026-12-06'), ['2027-01-05', '2027-02-05'], 'o dia 5 de dezembro já passou: começa em janeiro');
  // fim de semana fica no dia certo (07/03/2027 é domingo)
  assert.deepEqual(datas({ tipo: 'mensal', dia: 7, meses: 2 }, '2027-02-08'), ['2027-03-07', '2027-04-07']);
  assert.equal(datas({ tipo: 'mensal', dia: 1, meses: 60 }, '2026-11-26').length, 60);
});

test('validarRegra: tipos, datas reais, dia 1 a 31, meses 2 a 60, opção booleana', () => {
  assert.deepEqual(R.validarRegra({ tipo: 'diaria', de: '2026-11-26', ate: '2026-11-30' }), { ok: true, regra: { tipo: 'diaria', de: '2026-11-26', ate: '2026-11-30', pularFimDeSemana: false } });
  assert.deepEqual(R.validarRegra({ tipo: 'mensal', dia: 30, meses: 12, extra: 1 }), { ok: true, regra: { tipo: 'mensal', dia: 30, meses: 12 } });
  for (const c of [null, {}, { tipo: 'semanal' }, { tipo: 'anual' }, { tipo: 'diaria', de: '2026-02-30', ate: '2026-03-01' }, { tipo: 'diaria', de: '2026-11-26' },
    { tipo: 'diaria', de: '1999-12-31', ate: '2000-01-02' }, { tipo: 'diaria', de: '2026-11-26', ate: '2026-11-30', pularFimDeSemana: 'sim' },
    { tipo: 'mensal', dia: 0, meses: 2 }, { tipo: 'mensal', dia: 32, meses: 2 }, { tipo: 'mensal', dia: 1.5, meses: 2 }, { tipo: 'mensal', dia: '5', meses: 2 },
    { tipo: 'mensal', dia: 5, meses: 1 }, { tipo: 'mensal', dia: 5, meses: 61 }])
    assert.equal(R.validarRegra(c).ok, false, JSON.stringify(c));
  assert.deepEqual(R.ESCOPOS, ['este', 'proximos', 'todos']);
  assert.equal(R.escopoValido(undefined), true);
  assert.equal(R.escopoValido('todos'), true);
  assert.equal(R.escopoValido('tudo'), false);
});

test('prévia e datas sem fuso (nada de toISOString)', () => {
  assert.equal(R.resumo(['2026-11-26', '2026-11-27', '2026-12-02']), 'Vai criar 3 itens: de 26/11/2026 a 02/12/2026.');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'calculo', 'agenda_repeticao.js'), 'utf8'), /toISOString|getDate\(\)|getMonth\(\)/);
});
