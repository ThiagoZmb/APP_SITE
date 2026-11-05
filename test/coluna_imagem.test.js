const test = require('node:test');
const assert = require('node:assert/strict');
const { garantirColunaImagemProduto } = require('../seguranca/coluna_imagem');

function poolFalso(existe) {
  const sqls = [];
  return { sqls, execute: async sql => { sqls.push(sql); return /information_schema/.test(sql) ? [[{ n: existe ? 1 : 0 }]] : [{}]; } };
}

test('coluna IMAGEM ausente: ADD COLUMN nulo, só isso', async () => {
  const p = poolFalso(false);
  assert.deepEqual(await garantirColunaImagemProduto(p), { feito: true });
  const alter = p.sqls.filter(s => /ALTER/i.test(s));
  assert.equal(alter.length, 1);
  assert.match(alter[0], /ALTER TABLE cadastro_de_produtos ADD COLUMN IMAGEM LONGBLOB NULL/);
  assert.doesNotMatch(alter[0], /DROP|MODIFY|CHANGE/i);
});

test('coluna IMAGEM já existe: não altera nada', async () => {
  const p = poolFalso(true);
  assert.deepEqual(await garantirColunaImagemProduto(p), { feito: false });
  assert.equal(p.sqls.filter(s => /ALTER/i.test(s)).length, 0);
});
