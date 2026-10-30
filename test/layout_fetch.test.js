const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'layout.js'), 'utf8');

test('layout.js: SEGUNDO_PLANO é uma expressão regular válida (o fetch de TODAS as telas passa por ela)', () => {
  const linha = fonte.split(/\r?\n/).find(l => l.trim().startsWith('const SEGUNDO_PLANO ='));
  assert.ok(linha, 'declaração encontrada');
  const re = vm.runInNewContext(linha.trim().replace(/^const SEGUNDO_PLANO =\s*/, '').replace(/;\s*$/, ''));
  assert.equal(Object.prototype.toString.call(re), '[object RegExp]', 'é RegExp, não comentário nem outra coisa');
  for (const u of ['https://x/peso/itens', 'https://x/calcular_preco', 'https://x/calcular_preco?a=1', 'https://x/ped_orc/sistema_correr?nome=S', 'http://127.0.0.1:3917/ping'])
    assert.ok(re.test(u), u);
  for (const u of ['https://x/entregas', 'https://x/ped_orc/salvar', 'https://x/clientes', 'https://x/pesos'])
    assert.ok(!re.test(u), u);
});

test('layout.js compila e o wrapper do fetch deixa as chamadas normais passarem', () => {
  assert.doesNotThrow(() => new vm.Script(fonte));
  // o wrapper chama a regra com o endereço da chamada e devolve o fetch original nas consultas de segundo plano
  assert.match(fonte, /if \(SEGUNDO_PLANO\.test\(alvo\)\) return fetchOriginal\(\.\.\.args\);/);
});

test('menu lateral: sem o item "Início" nem o título "Visão geral"; o logo continua levando à primeira página liberada', () => {
  assert.ok(!fonte.includes("texto: 'Início'") && !fonte.includes("{ secao: 'Visão geral' }"));
  assert.ok(fonte.includes("'inicio.html': ['paineis.ver']"), 'a página Início continua existindo e protegida pela permissão');
  assert.ok(fonte.includes("<a class=\"sb-marca\" href=\"${window.Acesso.primeiraPagina() || 'inicio.html'}\">"), 'o logo é o atalho para o início');
});
