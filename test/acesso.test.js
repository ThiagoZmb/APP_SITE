const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { criarAcesso, parseEstados, filtroEstados } = require('../seguranca/acesso');

function poolUsuario({ situacao = 'ATIVO', web = { perfil_id: 4, estados: 'RJ', ativo: 1, perfil_nome: 'Estoquista', perfil_ativo: 1 },
  perfil = ['estoque.ver', 'estoque.movimentar'], excecoes = [] } = {}) {
  return criarPoolFalso([
    [/FROM cliente_usuarios/, [{ CODIGO: 7, NOME: 'Caio', CARGO: 'Produção', RAZAO_SOCIAL: 'ELEGANCE', SITUACAO: situacao }]],
    [/FROM web_usuario_acesso/, web ? [web] : []],
    [/FROM web_perfil_permissoes/, perfil.map(permissao => ({ permissao }))],
    [/FROM web_usuario_excecoes/, excecoes]
  ]);
}

test('parseEstados normaliza e tira repetidos', () => {
  assert.deepEqual(parseEstados('rj, es,RJ'), ['RJ', 'ES']);
  assert.deepEqual(parseEstados(null), []);
  assert.deepEqual(parseEstados(''), []);
});

test('carrega perfil, estados e permissões', async () => {
  const a = await criarAcesso({ pool: poolUsuario() }).carregar(7);
  assert.equal(a.nome, 'Caio');
  assert.equal(a.cargo, 'Produção');
  assert.equal(a.empresa, 'ELEGANCE');
  assert.deepEqual(a.perfil, { id: 4, nome: 'Estoquista' });
  assert.deepEqual(a.estados, ['RJ']);
  assert.equal(a.ativo, true);
  assert.deepEqual([...a.permissoes].sort(), ['estoque.movimentar', 'estoque.ver']);
});

test('usuário INATIVO no VB não fica ativo', async () => {
  const a = await criarAcesso({ pool: poolUsuario({ situacao: 'inativo' }) }).carregar(7);
  assert.equal(a.ativo, false);
  assert.equal(a.permissoes.size, 0);
});

test('sem linha web fica sem acesso', async () => {
  const a = await criarAcesso({ pool: poolUsuario({ web: null }) }).carregar(7);
  assert.equal(a.ativo, false);
  assert.equal(a.perfil, null);
  assert.equal(a.permissoes.size, 0);
});

test('perfil desativado não dá permissões, mas exceção liberar continua valendo', async () => {
  const a = await criarAcesso({ pool: poolUsuario({
    web: { perfil_id: 4, estados: null, ativo: 1, perfil_nome: 'Estoquista', perfil_ativo: 0 },
    excecoes: [{ permissao: 'estoque.ver', tipo: 'liberar' }] }) }).carregar(7);
  assert.deepEqual([...a.permissoes], ['estoque.ver']);
});

test('usuário inexistente devolve null', async () => {
  const a = await criarAcesso({ pool: criarPoolFalso([]) }).carregar(99);
  assert.equal(a, null);
});

test('cache evita nova consulta em 60 s e limpar força recarga', async () => {
  const pool = poolUsuario();
  let agora = 0;
  const acesso = criarAcesso({ pool, agora: () => agora });
  const consultasUsuario = () => pool.chamadas.filter(c => /FROM cliente_usuarios/.test(c.sql)).length;
  await acesso.carregar(7);
  agora = 30000; await acesso.carregar(7);
  assert.equal(consultasUsuario(), 1);
  agora = 61000; await acesso.carregar(7);
  assert.equal(consultasUsuario(), 2);
  acesso.limpar(7); await acesso.carregar(7);
  assert.equal(consultasUsuario(), 3);
  acesso.limpar(); await acesso.carregar(7);
  assert.equal(consultasUsuario(), 4);
});

test('filtroEstados vazio e com RJ', () => {
  assert.deepEqual(filtroEstados({ acesso: { estados: [] } }, 'c.ESTADO'), { sql: '', params: [] });
  assert.deepEqual(filtroEstados({ acesso: { estados: ['RJ', 'ES'] } }, 'c.ESTADO'), { sql: 'c.ESTADO IN (?,?)', params: ['RJ', 'ES'] });
});
