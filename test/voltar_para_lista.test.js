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

test('lista de pedidos/orçamentos: botões Pedidos/Orçamentos ficam no canto esquerdo (antes do título)', () => {
  const h = ler('painel_inicial.html');
  assert.match(h, /\.lista-topo \.tipo-toggle \{ order: -1; \}/);
});

test('lista de pedidos/orçamentos: imprimir PDF direto (iframe com blob, sem abrir outra página) e CSP libera frame blob:', () => {
  const h = ler('painel_inicial.html');
  const csp = h.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(/frame-src blob:/.test(csp) && /object-src 'self' blob:/.test(csp), 'o iframe de blob precisa de frame-src e object-src');
  assert.ok(h.includes('async function imprimirPdf(url) {'));
  assert.ok(h.includes('quadro.contentWindow.print()') && h.includes("document.createElement('iframe')"));
  assert.ok(!/imprimirPdf[\s\S]{0,1500}window\.open/.test(h), 'imprimir não abre aba nova');
  for (const rotulo of ["'Imprimir guia de produção'", "'Imprimir vidros'", "'Imprimir orçamento'"]) assert.ok(h.includes(rotulo), rotulo);
  assert.ok(h.includes('imprimirPdf(urlPdf(numero, true))') && h.includes('imprimirPdf(`${API_BASE}/dados_pdf_vidros?numero='));
});

test('menu do botão direito da lista não tem mais "Copiar nº" nem "Copiar nome do cliente"', () => {
  const h = ler('painel_inicial.html');
  assert.ok(!h.includes('Copiar nº') && !h.includes('Copiar nome do cliente') && !h.includes('copiarTexto'));
});
