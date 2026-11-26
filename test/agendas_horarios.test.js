// Agendas: horário opcional dos itens dos dias (calculo/agenda_horario.js, usado pelo servidor e pelas duas telas).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../calculo/agenda_horario.js');

test('horas <-> minutos: 00:00 a 24:00; formato inválido = null', () => {
  assert.equal(H.paraMin('00:00'), 0);
  assert.equal(H.paraMin('09:30'), 570);
  assert.equal(H.paraMin('23:59'), 1439);
  assert.equal(H.paraMin('24:00'), 1440);
  for (const s of ['24:01', '25:00', '9:30', '09:60', '0930', '', null, 570, '09:30:00', ' 09:30'])
    assert.equal(H.paraMin(s), null, String(s));
  assert.equal(H.paraHora(0), '00:00');
  assert.equal(H.paraHora(570), '09:30');
  assert.equal(H.paraHora(1440), '24:00');
  assert.equal(H.rotulo({ inicio: '09:30', fim: '10:30' }), '9:30–10:30');
  assert.equal(H.rotulo({ inicio: '00:00', fim: '24:00' }), '0:00–24:00');
  assert.equal(H.rotulo(null), '');
});

test('validarHorario: ausente, null (dia todo) ou início < fim dentro do dia', () => {
  assert.deepEqual(H.validarHorario(undefined), { ok: true, valor: undefined });
  assert.deepEqual(H.validarHorario(null), { ok: true, valor: null });
  assert.deepEqual(H.validarHorario({ inicio: '09:00', fim: '10:15' }), { ok: true, valor: { inicio: '09:00', fim: '10:15' } });
  assert.deepEqual(H.validarHorario({ inicio: '23:00', fim: '24:00' }), { ok: true, valor: { inicio: '23:00', fim: '24:00' } });
  for (const h of [{ inicio: '10:00', fim: '10:00' }, { inicio: '11:00', fim: '10:00' }, { inicio: '24:00', fim: '24:00' }, { inicio: '09:00' }, { fim: '10:00' },
    { inicio: '9:00', fim: '10:00' }, '09:00-10:00', [], 5, { inicio: 540, fim: 600 }])
    assert.equal(H.validarHorario(h).ok, false, JSON.stringify(h));
});

test('banco <-> API: SMALLINT em minutos; só os dois juntos valem', () => {
  assert.deepEqual(H.doBanco(570, 630), { inicio: '09:30', fim: '10:30' });
  assert.deepEqual(H.doBanco('570', '630'), { inicio: '09:30', fim: '10:30' }, 'o mysql2 pode devolver texto');
  assert.equal(H.doBanco(null, null), null);
  assert.equal(H.doBanco(570, null), null);
  assert.deepEqual(H.paraBanco({ inicio: '09:30', fim: '10:30' }), [570, 630]);
  assert.deepEqual(H.paraBanco(null), [null, null]);
});

test('encaixe em 15 min; novo item = 1h a partir do clique; mover mantém a duração dentro do dia; puxar a borda', () => {
  assert.equal(H.encaixar(578), 570);
  assert.equal(H.encaixar(578, 'perto'), 585);
  assert.equal(H.encaixar(-20), 0);
  assert.deepEqual(H.novoEm(578), { inicio: '09:30', fim: '10:30' });
  assert.deepEqual(H.novoEm(1420), { inicio: '23:30', fim: '24:00' }, 'no fim do dia fica mais curto');
  assert.deepEqual(H.mover({ inicio: '09:00', fim: '10:30' }, 600), { inicio: '10:00', fim: '11:30' });
  assert.deepEqual(H.mover({ inicio: '09:00', fim: '10:30' }, 1400), { inicio: '22:30', fim: '24:00' }, 'não passa da meia-noite');
  assert.deepEqual(H.mover({ inicio: '09:00', fim: '10:30' }, -50), { inicio: '00:00', fim: '01:30' });
  assert.deepEqual(H.redimensionar({ inicio: '09:00', fim: '10:00' }, 700), { inicio: '09:00', fim: '11:45' });
  assert.deepEqual(H.redimensionar({ inicio: '09:00', fim: '10:00' }, 500), { inicio: '09:00', fim: '09:15' }, 'mínimo de 15 min');
  assert.deepEqual(H.redimensionar({ inicio: '23:00', fim: '23:30' }, 2000), { inicio: '23:00', fim: '24:00' });
  assert.equal(H.duracao({ inicio: '09:00', fim: '10:30' }), 90);
});

test('ordem na lista do dia: "dia todo" primeiro (ordem de criação), depois por horário; linha sem id por último', () => {
  const itens = [
    { id: 5, horario: { inicio: '14:00', fim: '15:00' } }, { id: 2, horario: null }, { id: 9, horario: { inicio: '09:00', fim: '11:00' } },
    { id: 7, horario: { inicio: '09:00', fim: '10:00' } }, { id: null, horario: null }, { id: 1, horario: null }, { id: 3, horario: { inicio: '09:00', fim: '10:00' } }];
  assert.deepEqual([...itens].sort(H.comparar).map(i => i.id), [1, 2, 3, 7, 9, 5, null]);
});

test('distribuir: sobrepostos lado a lado; quem não encosta ocupa a largura toda', () => {
  const r = H.distribuir([
    { id: 1, horario: { inicio: '09:00', fim: '10:00' } },
    { id: 2, horario: { inicio: '09:30', fim: '10:30' } },
    { id: 3, horario: { inicio: '10:00', fim: '11:00' } },   // começa quando o 1 acaba: volta à 1ª coluna
    { id: 4, horario: { inicio: '12:00', fim: '13:00' } },   // sozinho
    { id: 5, horario: { inicio: '09:15', fim: '09:45' } }    // terceiro ao mesmo tempo
  ]);
  assert.deepEqual(r.get(1), { col: 0, cols: 3 });
  assert.deepEqual(r.get(5), { col: 1, cols: 3 });
  assert.deepEqual(r.get(2), { col: 2, cols: 3 });
  assert.deepEqual(r.get(3), { col: 0, cols: 3 }, 'mesmo grupo (encosta no 2)');
  assert.deepEqual(r.get(4), { col: 0, cols: 1 });
  assert.equal(H.distribuir([]).size, 0);
});
