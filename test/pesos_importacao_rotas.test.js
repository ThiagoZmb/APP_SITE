// POST /admin/importar_pesos (banco falso).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoPesos, prepararPesos } = require('./apoio/bancoPesos');

process.env.ADMIN_KEY = 'chave-de-teste';
const importar = (url, corpo, chave = 'chave-de-teste') => fetch(url + '/admin/importar_pesos', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(chave ? { 'x-admin-key': chave } : {}) }, body: JSON.stringify(corpo ?? {}) });

test('importar pesos: sem a chave de admin dá 403 e nada é gravado', async t => {
  const { banco, url } = await prepararPesos(t);
  assert.equal((await importar(url, { simular: false }, null)).status, 403);
  assert.equal((await importar(url, { simular: false }, 'errada')).status, 403);
  assert.equal(banco.pesos.length, 0);
});

test('importar pesos: por padrão só simula (relatório, nada gravado)', async t => {
  const banco = bancoPesos();
  banco.semear.peso({ tipo: 'perfil', produto: '3345', origem: 'pesado', valor: 9 });
  const { url } = await prepararPesos(t, { banco });
  const r = await importar(url, {});
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.simulacao, true);
  assert.deepEqual([j.qtdInserir, j.qtdIgnorar], [16, 1]);
  assert.deepEqual(j.ignorar, [{ tipo: 'perfil', produto: '3345', motivo: 'já cadastrado' }]);
  assert.equal(banco.pesos.length, 1);
  assert.equal(banco.auditoria.length, 0);
});

test('importar pesos: simular:false grava com origem/confiança, não sobrescreve existente, audita só contagens e é idempotente', async t => {
  const banco = bancoPesos();
  const existente = banco.semear.peso({ tipo: 'perfil', produto: '3345', origem: 'pesado', valor: 9 });
  const { url } = await prepararPesos(t, { banco });
  let j = await (await importar(url, { simular: false })).json();
  assert.deepEqual([j.simulacao, j.qtdImportados], [false, 16]);
  assert.equal(banco.pesos.length, 17);
  assert.deepEqual([existente.valor, existente.origem], [9, 'pesado']);
  const p = banco.pesos.find(x => x.produto === '3180');
  assert.deepEqual([p.tipo, p.unidade_peso, p.valor, p.origem, p.confianca, p.atualizado_por], ['puxador', 'kg_m', 0.738, 'estimado_desenho', 'media', 'importação das estimativas']);
  const a = banco.auditoria.at(-1);
  assert.deepEqual([a.acao, a.detalhe], ['pesos_importados', { qtdImportados: 16, qtdIgnorados: 1 }]);
  j = await (await importar(url, { simular: false })).json();
  assert.equal(j.qtdImportados, 0);
  assert.equal(banco.pesos.length, 17);
});
