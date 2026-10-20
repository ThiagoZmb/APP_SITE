const test = require('node:test');
const assert = require('node:assert/strict');
const { removerValores, semValores, preservarValores, podeVerValores, redeDeValores } = require('../seguranca/valores');

const reqCom = (...perms) => ({ method: 'GET', path: '/x', acesso: { permissoes: new Set(perms) } });

test('remove valor/total aninhados em listas', () => {
  const { dado, removidos } = removerValores({ itens: [{ nome: 'A', valor: 10, qtd: 2 }], total: 10 });
  assert.deepEqual(dado, { itens: [{ nome: 'A', qtd: 2 }] });
  assert.ok(removidos.includes('valor') && removidos.includes('total'));
});

test('campos técnicos sobrevivem', () => {
  const { dado } = removerValores({ descontoVidro: 5, descPerfPux: 3, tipoDesconto: 'FIXO', valorCheio: 9 });
  assert.deepEqual(dado, { descontoVidro: 5, descPerfPux: 3, tipoDesconto: 'FIXO' });
});

test('qtd e nomes neutros ficam', () => {
  const entrada = { qtd: 3, pedidos: 4, ativos: 1, nome: 'x', data: '2026-01-01' };
  assert.deepEqual(removerValores(entrada).dado, entrada);
});

test('remover não altera o objeto original', () => {
  const original = { valor: 1, nome: 'a' };
  removerValores(original);
  assert.deepEqual(original, { valor: 1, nome: 'a' });
});

test('semValores com permissão devolve igual', () => {
  const d = { valor: 1, pedidos12m: 5 };
  assert.deepEqual(semValores(reqCom('valores.ver'), d, ['pedidos12m']), d);
});

test('semValores sem permissão remove os campos pedidos em qualquer nível', () => {
  const d = { empresa: { pedidos12m: 5, clientesAtivos12m: 2 }, lista: [{ pedidos12m: 1, n: 1 }] };
  assert.deepEqual(semValores(reqCom(), d, ['pedidos12m']), { empresa: { clientesAtivos12m: 2 }, lista: [{ n: 1 }] });
});

test('podeVerValores', () => {
  assert.equal(podeVerValores(reqCom('valores.ver')), true);
  assert.equal(podeVerValores(reqCom('estoque.ver')), false);
  assert.equal(podeVerValores({}), false);
});

test('preservarValores sem permissão usa o atual', () => {
  assert.deepEqual(preservarValores(reqCom(), { VALOR: 0, NOME: 'x' }, { VALOR: 12.5 }, ['VALOR']), { VALOR: 12.5, NOME: 'x' });
  assert.deepEqual(preservarValores(reqCom('valores.ver'), { VALOR: 0 }, { VALOR: 12.5 }, ['VALOR']), { VALOR: 0 });
});

test('redeDeValores avisa no log e limpa a resposta', t => {
  const aviso = t.mock.method(console, 'warn', () => {});
  let enviado;
  const res = { json(d) { enviado = d; return this; } };
  const req = reqCom('estoque.ver');
  redeDeValores(req, res, () => {});
  res.json({ nome: 'A', valor: 3 });
  assert.deepEqual(enviado, { nome: 'A' });
  assert.equal(aviso.mock.callCount(), 1);
  assert.match(aviso.mock.calls[0].arguments[0], /campos removidos pela rede: valor/);
});

test('redeDeValores não mexe em quem vê valores', t => {
  const aviso = t.mock.method(console, 'warn', () => {});
  let enviado;
  const res = { json(d) { enviado = d; return this; } };
  redeDeValores(reqCom('valores.ver'), res, () => {});
  res.json({ valor: 3 });
  assert.deepEqual(enviado, { valor: 3 });
  assert.equal(aviso.mock.callCount(), 0);
});
