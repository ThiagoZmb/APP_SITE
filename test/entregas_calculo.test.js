const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUS, TIPOS, proximo, pedidoPara, validarAnexo } = require('../calculo/entregas');

const e = (status, tipo = null) => ({ status, tipo });

test('constantes: 8 status e 3 tipos', () => {
  assert.equal(Object.keys(STATUS).length, 8);
  assert.equal(Object.keys(TIPOS).length, 3);
});

test('agendar só em a_programar', () => {
  assert.deepEqual(proximo(e('a_programar'), 'agendar'), { status: 'agendada', evento: 'agendada' });
  assert.equal(proximo(e('agendada'), 'agendar'), null);
});

test('reagendar vale em ocorrencia e agendada', () => {
  assert.deepEqual(proximo(e('ocorrencia', 'motorista'), 'reagendar'), { status: 'agendada', evento: 'reagendada' });
  assert.deepEqual(proximo(e('agendada', 'motorista'), 'reagendar'), { status: 'agendada', evento: 'reagendada' });
  assert.equal(proximo(e('em_rota', 'motorista'), 'reagendar'), null);
});

test('saiu exige tipo motorista', () => {
  assert.deepEqual(proximo(e('agendada', 'motorista'), 'saiu'), { status: 'em_rota', evento: 'saiu' });
  assert.equal(proximo(e('agendada', 'retirada'), 'saiu'), null);
});

test('entregue e ocorrências a partir de em_rota', () => {
  assert.deepEqual(proximo(e('em_rota', 'motorista'), 'entregue'), { status: 'entregue', evento: 'entregue' });
  for (const m of ['ausente', 'endereco_errado', 'recusa', 'parcial']) {
    assert.deepEqual(proximo(e('em_rota', 'motorista'), 'ocorrencia:' + m), { status: 'ocorrencia', evento: m });
  }
  assert.equal(proximo(e('em_rota', 'motorista'), 'ocorrencia:outro'), null);
  assert.equal(proximo(e('agendada', 'motorista'), 'entregue'), null);
});

test('retirada e outro estado', () => {
  assert.deepEqual(proximo(e('agendada', 'retirada'), 'retirada'), { status: 'retirado', evento: 'retirada' });
  assert.equal(proximo(e('agendada', 'motorista'), 'retirada'), null);
  assert.deepEqual(proximo(e('agendada', 'outro_estado'), 'enviada'), { status: 'enviada', evento: 'enviada' });
  assert.equal(proximo(e('agendada', 'retirada'), 'enviada'), null);
  assert.deepEqual(proximo(e('enviada', 'outro_estado'), 'comprovante'), { status: 'entregue', evento: 'comprovante' });
  assert.equal(proximo(e('enviada', 'motorista'), 'comprovante'), null);
});

test('cancelar', () => {
  for (const s of ['a_programar', 'agendada', 'ocorrencia']) {
    assert.deepEqual(proximo(e(s, 'motorista'), 'cancelar'), { status: 'cancelada', evento: 'cancelada' });
  }
  assert.equal(proximo(e('em_rota', 'motorista'), 'cancelar'), null);
});

test('estados finais e ação desconhecida', () => {
  for (const s of ['entregue', 'retirado', 'cancelada']) {
    for (const a of ['agendar', 'reagendar', 'saiu', 'entregue', 'cancelar', 'retirada']) {
      assert.equal(proximo(e(s, 'motorista'), a), null);
    }
  }
  assert.equal(proximo(e('agendada', 'motorista'), 'xyz'), null);
  assert.equal(proximo(null, 'agendar'), null);
});

test('pedidoPara', () => {
  assert.equal(pedidoPara('entregue'), 'Entregue');
  assert.equal(pedidoPara('retirado'), 'Retirado');
  for (const s of ['a_programar', 'agendada', 'em_rota', 'ocorrencia', 'enviada', 'cancelada', 'x']) assert.equal(pedidoPara(s), null);
});

test('validarAnexo', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(10)]);
  assert.deepEqual(validarAnexo(jpeg, 'image/jpeg'), { ok: true, tipo: 'jpeg' });
  assert.deepEqual(validarAnexo(png, 'image/png'), { ok: true, tipo: 'png' });
  assert.equal(validarAnexo(Buffer.from('texto qualquer'), 'image/jpeg').ok, false);
  assert.equal(validarAnexo(png, 'image/jpeg').ok, false);
  assert.equal(validarAnexo(jpeg, 'image/gif').ok, false);
  assert.equal(validarAnexo(Buffer.alloc(0), 'image/jpeg').ok, false);
  assert.equal(validarAnexo('abc', 'image/jpeg').ok, false);
  const limite = Buffer.alloc(1048576); jpeg.copy(limite);
  assert.equal(validarAnexo(limite, 'image/jpeg').ok, true);
  const acima = Buffer.alloc(1048577); jpeg.copy(acima);
  const r = validarAnexo(acima, 'image/jpeg');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /1 MB|grande/i);
});
