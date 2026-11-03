process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { opcoesSsl } = require('../seguranca/mysql_ssl');

const nunca = () => { throw new Error('não deveria ler arquivo'); };

test('sem DB_SSL não liga TLS', () => {
  assert.equal(opcoesSsl({}, nunca), undefined);
});

test('DB_SSL diferente de exatamente "1" não liga TLS', () => {
  for (const v of ['true', '0', '', ' 1', 'yes']) {
    assert.equal(opcoesSsl({ DB_SSL: v }, nunca), undefined, `DB_SSL=${JSON.stringify(v)}`);
  }
});

test('DB_SSL_CA sem DB_SSL=1 é ignorado', () => {
  assert.equal(opcoesSsl({ DB_SSL_CA: 'x.pem' }, nunca), undefined);
});

test('DB_SSL=1 confere o certificado e nunca devolve rejectUnauthorized false', () => {
  const o = opcoesSsl({ DB_SSL: '1' }, nunca);
  assert.deepEqual(o, { rejectUnauthorized: true });
  assert.notEqual(o.rejectUnauthorized, false);
});

test('com DB_SSL_CA devolve o conteúdo do arquivo em ca', () => {
  let pedido;
  const o = opcoesSsl({ DB_SSL: '1', DB_SSL_CA: 'x.pem' }, (c, enc) => { pedido = [c, enc]; return 'PEM-FALSO'; });
  assert.deepEqual(o, { rejectUnauthorized: true, ca: 'PEM-FALSO' });
  assert.deepEqual(pedido, ['x.pem', 'utf8']);
});

test('arquivo ilegível ou vazio lança erro em português sem o caminho', () => {
  const caminho = 'C:\segredo\ca-do-banco.pem';
  for (const ler of [() => { throw new Error('ENOENT ' + caminho); }, () => '', () => '  \n']) {
    assert.throws(() => opcoesSsl({ DB_SSL: '1', DB_SSL_CA: caminho }, ler), (e) => {
      assert.equal(e.message, 'Não consegui ler o certificado do banco (DB_SSL_CA).');
      assert.ok(!e.message.includes(caminho) && !e.message.includes('segredo') && !e.message.includes('ENOENT'));
      return true;
    });
  }
});
