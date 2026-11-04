process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { bcryptLimitado, ErroOcupado } = require('../seguranca/limite_bcrypt');
const { app, pool, acesso } = require('../index.js');

const HASH = bcrypt.hashSync('segredo123', 4);
const acessoOk = { codigo: 7, nome: 'Caio', cargo: 'Produção', empresa: 'ELEGANCE', perfil: { id: 4, nome: 'Estoquista' },
  estados: [], ativo: true, permissoes: new Set(['estoque.ver']) };

let seqIp = 0;
const proximoIp = () => `10.8.0.${(seqIp++ % 250) + 1}`;

test('servidor ocupado (limite global de bcrypt) responde 503 no login e NÃO conta como senha errada', async t => {
  const s = await subir(app); t.after(s.fechar); acesso.limpar();
  t.mock.method(acesso, 'carregar', async () => acessoOk);
  const f = criarPoolFalso([
    [/FROM cliente_usuarios WHERE NOME/, () => [{ CODIGO: 4242, NOME: 'Ocupado', RAZAO_SOCIAL: 'ELEGANCE', CARGO: 'Produção', SENHA: HASH }]]
  ]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  const post = body => fetch(s.url + '/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': proximoIp() }, body: JSON.stringify(body) });

  const mock = t.mock.method(bcryptLimitado, 'compare', async () => { throw new ErroOcupado(); });
  // mais do que o limite por conta (5): se 503 contasse como falha, a conta já estaria bloqueada (429)
  for (let i = 0; i < 7; i++) {
    const r = await post({ username: 'Ocupado', password: 'segredo123' });
    assert.equal(r.status, 503, `tentativa ${i + 1}`);
    assert.equal(r.headers.get('retry-after'), '5');
    const d = await r.json();
    assert.equal(d.success, false);
    assert.match(d.message, /ocupado/i);
  }
  assert.equal(mock.mock.callCount(), 7, 'o limitador foi realmente consultado em cada tentativa');
  mock.mock.restore();

  const ok = await post({ username: 'Ocupado', password: 'segredo123' });
  assert.equal(ok.status, 200, 'passada a sobrecarga, a conta entra normalmente (não ficou bloqueada)');
  assert.equal((await ok.json()).success, true);
});
