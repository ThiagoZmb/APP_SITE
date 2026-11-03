process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { limparPortal } = require('../portal/limpeza');

const AGORA = new Date('2026-11-03T12:00:00.000Z');
const DIA = 86400000;

test('apaga auditoria > 12 meses, sessões expiradas há > 1 dia e convites expirados há > 30 dias', async () => {
  const pool = criarPoolFalso([
    [/DELETE FROM web_portal_auditoria/, () => ({ affectedRows: 4 })],
    [/DELETE FROM web_portal_sessoes/, () => ({ affectedRows: 2 })],
    [/DELETE FROM web_portal_convites/, () => ({ affectedRows: 1 })]
  ]);
  const r = await limparPortal(pool, { agora: () => AGORA });
  assert.deepEqual(r, { auditoria: 4, sessoes: 2, convites: 1 });
  assert.equal(pool.chamadas.length, 3);
  const [a, s, c] = pool.chamadas;
  assert.match(a.sql, /^DELETE FROM web_portal_auditoria WHERE quando < \?$/);
  assert.match(s.sql, /^DELETE FROM web_portal_sessoes WHERE expira_em < \?$/);
  assert.match(c.sql, /^DELETE FROM web_portal_convites WHERE expira_em < \?$/);
  const doze = new Date(AGORA);
  doze.setUTCMonth(doze.getUTCMonth() - 12);
  assert.equal(a.params[0].getTime(), doze.getTime());
  assert.equal(s.params[0].getTime(), AGORA.getTime() - DIA);
  assert.equal(c.params[0].getTime(), AGORA.getTime() - 30 * DIA);
});

test('sem linhas afetadas devolve zeros', async () => {
  const pool = criarPoolFalso([]);
  assert.deepEqual(await limparPortal(pool), { auditoria: 0, sessoes: 0, convites: 0 });
});
