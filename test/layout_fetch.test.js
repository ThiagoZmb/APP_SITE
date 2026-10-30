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

test('indicador de carregamento: porta de correr em miniatura (trilho, duas folhas, sombra, texto), keyframes presentes e o giro dos botões preservado', () => {
  for (const c of ['.cg-porta', '.cg-trilho', '.cg-folha', '.cg-f1', '.cg-f2', '.cg-sombra', '.cg-texto']) assert.ok(fonte.includes('#carregando-global ' + c), c);
  for (const k of ['@keyframes cg-desliza', '@keyframes cg-brilho', '@keyframes cg-sombra', '@keyframes cg-ponto', '@keyframes carregando-entrada']) assert.ok(fonte.includes(k), k);
  assert.ok(fonte.includes('@keyframes carregando-giro'), 'os botões ocupados ainda usam o giro');
  assert.ok(fonte.includes('<div class="cg-porta"><span class="cg-trilho"></span><span class="cg-folha cg-f1"></span><span class="cg-folha cg-f2"></span><span class="cg-sombra"></span></div>'));
  assert.ok(!fonte.includes('carregando-pulso') && !fonte.includes('#carregando-global i '), 'o anel antigo saiu');
  assert.ok(fonte.includes('prefers-reduced-motion'), 'respeita quem pede menos movimento');
});
