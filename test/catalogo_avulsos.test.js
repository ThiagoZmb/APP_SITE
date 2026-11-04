// /catalogos_filtro?campo=avulsos: itens da venda avulsa por CLASSE (frmServicos.CarregarListaProdutos).
process.env.JWT_SECRET = 'teste'; process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoPedOrc, prepararPedOrc } = require('./apoio/bancoPedOrc');

// cadastro_de_produtos simulado (CLASSE como está no banco real; o MySQL compara sem caixa/acento)
const CADASTRO = [
  { MODELO: 'Colagem de Vidro P', CLASSE: 'Acessórios', SITUACAO: 'Ativo' },
  { MODELO: 'Kit Sliding TV', CLASSE: 'Acessórios', SITUACAO: 'Ativo' },
  { MODELO: 'Acessório Velho', CLASSE: 'Acessórios', SITUACAO: 'Inativo' },
  { MODELO: 'Sistema S1', CLASSE: 'Sistema de correr', SITUACAO: 'Ativo' },
  { MODELO: 'Perfil P', CLASSE: 'Perfil', SITUACAO: 'Ativo' },
  { MODELO: 'Puxador X', CLASSE: 'Puxador', SITUACAO: 'Ativo' }
];
function comCadastro(banco) {
  banco.f.regras.unshift([/FROM cadastro_de_produtos\s+WHERE SITUACAO = 'Ativo' AND CLASSE IN/, (sql, classes) => {
    const quer = new Set(classes);
    return [...new Set(CADASTRO.filter(p => p.SITUACAO === 'Ativo' && quer.has(p.CLASSE)).map(p => p.MODELO))].sort().map(nome => ({ nome }));
  }]);
}
const lista = async (chamar, cat) => {
  const r = await chamar('/catalogos_filtro?campo=avulsos&chave=' + encodeURIComponent(cat));
  return { status: r.status, corpo: await r.json() };
};

test('Serviço lista os ativos de Acessórios e Sistema de correr (como o VB)', async t => {
  const { banco, chamar } = await prepararPedOrc(t); comCadastro(banco);
  const r = await lista(chamar, 'Serviço');
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, ['Colagem de Vidro P', 'Kit Sliding TV', 'Sistema S1']);
  const sql = banco.f.chamadas.find(c => /CLASSE IN/.test(c.sql));
  assert.deepEqual(sql.params, ['Acessórios', 'Sistema de correr']);
  assert.match(sql.sql, /SITUACAO = 'Ativo'/);
});

test('as outras categorias continuam nas suas classes', async t => {
  const { banco, chamar } = await prepararPedOrc(t); comCadastro(banco);
  assert.deepEqual((await lista(chamar, 'Perfil')).corpo, ['Perfil P']);
  assert.deepEqual((await lista(chamar, 'Puxador')).corpo, ['Puxador X']);
  assert.deepEqual((await lista(chamar, 'Acessório')).corpo, ['Colagem de Vidro P', 'Kit Sliding TV']);
  assert.equal((await lista(chamar, 'Inexistente')).status, 400);
});
