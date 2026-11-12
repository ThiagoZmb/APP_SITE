process.env.JWT_SECRET = 'teste'; process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../calculo/horario_acesso');
const { criarAcesso } = require('../seguranca/acesso');

const semana = { dias: { 0: null, 1: { inicio: '07:00', fim: '18:00' }, 2: { inicio: '07:00', fim: '18:00' }, 3: { inicio: '07:00', fim: '18:00' }, 4: { inicio: '07:00', fim: '18:00' }, 5: { inicio: '07:00', fim: '18:00' }, 6: null } };
// 2026-11-11 (quarta) em Brasília = UTC-3
const brasilia = (iso) => new Date(iso + '-03:00');

test('validarHorario: formato, ordem e dias sem acesso', () => {
  assert.deepEqual(H.validarHorario(null), { horario: null });
  assert.ok(H.validarHorario(semana).horario);
  assert.match(H.validarHorario({ dias: { ...semana.dias, 1: { inicio: '18:00', fim: '07:00' } } }).erro, /depois da inicial/);
  assert.match(H.validarHorario({ dias: { ...semana.dias, 2: { inicio: '7h', fim: '18:00' } } }).erro, /HH:MM/);
  assert.ok(H.validarHorario('x').erro);
});

test('dentroDoHorario: usa a hora de Brasília, fim exclusivo, dia sem acesso fechado', () => {
  const h = H.validarHorario(semana).horario;
  assert.equal(H.dentroDoHorario(h, brasilia('2026-11-11T07:00:00')), true);
  assert.equal(H.dentroDoHorario(h, brasilia('2026-11-11T17:59:00')), true);
  assert.equal(H.dentroDoHorario(h, brasilia('2026-11-11T18:00:00')), false);
  assert.equal(H.dentroDoHorario(h, brasilia('2026-11-11T06:59:00')), false);
  assert.equal(H.dentroDoHorario(h, brasilia('2026-11-14T10:00:00')), false, 'sábado');
  assert.equal(H.dentroDoHorario(null, brasilia('2026-11-14T10:00:00')), true, 'sem horário = livre');
});

test('bloqueioAgora: manual vence; lerHorario ruim = sem restrição', () => {
  assert.equal(H.bloqueioAgora({ bloqueioManual: true }, new Date()).motivo, 'manual');
  assert.equal(H.bloqueioAgora({ horario: H.validarHorario(semana).horario }, brasilia('2026-11-11T20:00:00')).motivo, 'horario');
  assert.equal(H.bloqueioAgora({ horario: H.lerHorario('{lixo') }, new Date()), null);
});

function poolCom({ permissoes, manual = 0, horario = null, inat = null }) {
  return { async execute(sql) {
    if (/FROM cliente_usuarios/.test(sql)) return [[{ CODIGO: 1, NOME: 'X', CARGO: '', RAZAO_SOCIAL: '', SITUACAO: 'ATIVO' }]];
    if (/FROM web_usuario_acesso/.test(sql)) return [[{ perfil_id: 5, estados: '', ativo: 1, perfil_nome: 'P', perfil_ativo: 1, bloqueio_manual: manual, horario: horario && JSON.stringify(horario), inatividade_min: inat }]];
    if (/web_usuario_excecoes/.test(sql)) return [[]];
    return [permissoes.map(p => ({ permissao: p }))];
  } };
}

test('acesso.carregar: fora do horário o usuário fica inativo SEM reler o banco; administrador nunca é barrado', async () => {
  let agora = brasilia('2026-11-11T10:00:00').getTime();
  const a = criarAcesso({ pool: poolCom({ permissoes: ['pedidos.ver'], horario: semana, inat: 3 }), agora: () => agora });
  const dentro = await a.carregar(1);
  assert.equal(dentro.ativo, true);
  assert.equal(dentro.inatividadeMin, 3);
  agora = brasilia('2026-11-11T19:00:00').getTime(); // cache ainda vale (60 s? não: passou) -> força nova leitura mas mesmo assim bloqueia
  const fora = await a.carregar(1);
  assert.equal(fora.ativo, false);
  assert.equal(fora.bloqueio.motivo, 'horario');
  assert.equal(fora.permissoes.size, 0);
  const adm = criarAcesso({ pool: poolCom({ permissoes: ['admin.usuarios'], manual: 1, horario: semana, inat: 3 }), agora: () => agora });
  const r = await adm.carregar(1);
  assert.equal(r.ativo, true);
  assert.equal(r.inatividadeMin, null);
});

test('acesso.carregar: bloqueio manual barra na próxima chamada, mesmo com cadastro em cache', async () => {
  const agora = brasilia('2026-11-11T10:00:00').getTime();
  const pool = poolCom({ permissoes: ['pedidos.ver'], manual: 1 });
  const a = criarAcesso({ pool, agora: () => agora });
  const r = await a.carregar(1);
  assert.equal(r.bloqueio.motivo, 'manual');
  const de_novo = await a.carregar(1); // veio do cache
  assert.equal(de_novo.ativo, false);
});
