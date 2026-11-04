process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarLimiteBcrypt, ErroOcupado } = require('../seguranca/limite_bcrypt');

const esperar = ms => new Promise(ok => setTimeout(ok, ms));
// trabalho que fica "em andamento" até o teste liberar
function trava() {
  let liberar;
  const promessa = new Promise(ok => { liberar = ok; });
  return { promessa, liberar };
}

test('no máximo N trabalhos em andamento; os demais esperam na fila e depois rodam', async () => {
  const lim = criarLimiteBcrypt({ maxEmAndamento: 2, maxFila: 5 });
  const travas = [trava(), trava(), trava(), trava()];
  let simultaneos = 0, pico = 0, concluidos = 0;
  const rodar = i => lim.executar(async () => {
    simultaneos++; pico = Math.max(pico, simultaneos);
    await travas[i].promessa;
    simultaneos--; concluidos++;
    return i;
  });
  const todos = [0, 1, 2, 3].map(rodar);
  await esperar(10);
  assert.equal(lim.estado().ativos, 2);
  assert.equal(lim.estado().fila, 2);
  travas.forEach(t => t.liberar());
  assert.deepEqual(await Promise.all(todos), [0, 1, 2, 3]);
  assert.equal(pico, 2, 'nunca mais de 2 ao mesmo tempo');
  assert.equal(concluidos, 4);
  assert.deepEqual(lim.estado(), { ativos: 0, fila: 0 });
});

test('fila cheia: o excedente recebe ErroOcupado (503) sem rodar o trabalho', async () => {
  const lim = criarLimiteBcrypt({ maxEmAndamento: 1, maxFila: 1 });
  const t = trava();
  let rodou = 0;
  const a = lim.executar(async () => { rodou++; await t.promessa; });
  const b = lim.executar(async () => { rodou++; });            // fica na fila
  await esperar(10);
  await assert.rejects(lim.executar(async () => { rodou++; }), err => {
    assert.ok(err instanceof ErroOcupado);
    assert.equal(err.status, 503);
    assert.match(err.message, /ocupado/i);
    return true;
  });
  assert.equal(rodou, 1, 'só o primeiro rodou até agora');
  t.liberar();
  await Promise.all([a, b]);
  assert.equal(rodou, 2, 'o da fila rodou; o rejeitado nunca rodou');
});

test('erro no trabalho libera a vaga (não trava o limitador)', async () => {
  const lim = criarLimiteBcrypt({ maxEmAndamento: 1, maxFila: 2 });
  await assert.rejects(lim.executar(async () => { throw new Error('falhou'); }), /falhou/);
  assert.deepEqual(lim.estado(), { ativos: 0, fila: 0 });
  assert.equal(await lim.executar(async () => 'ok'), 'ok');
});

test('compare e hash passam pelo limitador e funcionam de verdade', async () => {
  const { bcryptLimitado } = require('../seguranca/limite_bcrypt');
  const bcrypt = require('bcryptjs');
  const hash = await bcryptLimitado.hash('segredo-forte-123', 4);
  assert.ok(hash.startsWith('$2'));
  assert.equal(await bcryptLimitado.compare('segredo-forte-123', hash), true);
  assert.equal(await bcryptLimitado.compare('outra', hash), false);
  assert.equal(await bcrypt.compare('segredo-forte-123', hash), true);
});
