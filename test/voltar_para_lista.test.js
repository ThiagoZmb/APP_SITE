const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('lista de pedidos/orçamentos: os dois caminhos de "Abrir para editar" levam o endereço de volta', () => {
  const h = ler('painel_inicial.html');
  assert.match(h, /const voltarParaEstaPagina = \(\) => encodeURIComponent\(location\.pathname\.split\('\/'\)\.pop\(\) \+ location\.search\);/);
  assert.equal((h.match(/&voltar=\$\{voltarParaEstaPagina\(\)\}/g) || []).length, 2);
  assert.ok(h.indexOf('const voltarParaEstaPagina') < h.indexOf('&voltar='), 'declarada antes de ser usada');
});

test('orçamentos: só volta para páginas do próprio sistema e só quando o salvar não deixou pendências', () => {
  const h = ler('orcamentos.html');
  const m = h.match(/let paginaDeRetorno = \(\(\) => \{[\s\S]*?\}\)\(\);/)[0];
  const re = new RegExp(m.match(/test\(v\)/) ? m.match(/return (\/.*\/i)\.test\(v\)/)[1].slice(1, -2) : '', 'i');
  for (const ok of ['painel_inicial.html', 'painel_inicial.html?cliente=ACME']) assert.ok(re.test(ok), ok);
  for (const ruim of ['https://outro.site/x', '//outro.site', 'javascript:alert(1)', '../x.html', 'a.html#x']) assert.ok(!re.test(ruim), ruim);
  assert.match(h, /if \(paginaDeRetorno && !falhasDesenho && !avisosPreco\.length\)/);
  assert.match(h, /paginaDeRetorno = ''; \/\/ documento novo/);
});
