// Ligação pedido -> nota do DANFE, extraída de rotas/danfe.js (rotas/danfe_ligacao.js).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoDanfe, chaveCom } = require('./apoio/bancoDanfe');
const { criarLigacaoDanfe } = require('../rotas/danfe_ligacao');

const CNPJ = '08951388000118';
function montar() {
  const banco = bancoDanfe();
  const lig = criarLigacaoDanfe({ pool: banco.f });
  return { banco, lig };
}

test('notasDoPedido: pedido sem ligação devolve listas vazias', async () => {
  const { lig } = montar();
  assert.deepEqual(await lig.notasDoPedido(100), { notas: [], semArquivo: [] });
});

test('notasDoPedido: manual vem antes do financeiro, sem repetir a chave, e marca a origem', async () => {
  const { banco, lig } = montar();
  const a = banco.semear.danfe({ numero: 11290, cnpj: CNPJ });
  const b = banco.semear.danfe({ numero: 11291, cnpj: CNPJ, cNF: '00000286' });
  banco.semear.vinculo(b.chave, 100);
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290/11291' });
  const r = await lig.notasDoPedido(100);
  assert.deepEqual(r.notas.map(n => [n.chave, n.origem]), [[b.chave, 'manual'], [a.chave, 'financeiro']]);
  assert.deepEqual(r.semArquivo, []);
  assert.equal(r.notas[0].numeroNf, 11291);
  assert.deepEqual(Object.keys(r.notas[0]).sort(), ['chave', 'enviadoEm', 'numeroNf', 'origem', 'serie']);
});

test('notasDoPedido: número de NF do financeiro sem PDF vai para semArquivo', async () => {
  const { banco, lig } = montar();
  banco.semear.danfe({ numero: 11290, cnpj: CNPJ });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290/8888' });
  const r = await lig.notasDoPedido(100);
  assert.equal(r.notas.length, 1);
  assert.deepEqual(r.semArquivo, [8888]);
});

test('pedidosDaNota: junta o vínculo manual e o financeiro, sem repetir', async () => {
  const { banco, lig } = montar();
  const d = banco.semear.danfe({ numero: 11290, cnpj: CNPJ });
  banco.semear.vinculo(d.chave, 100);
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290' });
  banco.semear.fluxo({ PEDIDO: '200', NOTA_FISCAL: '11290' });
  const empresa = await lig.cnpjEmpresa(banco.f);
  assert.equal(empresa, CNPJ);
  assert.deepEqual((await lig.pedidosDaNota(d, empresa)).sort(), [100, 200]);
});

// ---- caminho do portal: notasDoPedidoCliente(numero, razaoSocial) ----
const ACME = 'ACME LTDA', BETA = 'BETA LTDA';
const lanc = (PEDIDO, NOTA_FISCAL, RAZAO_SOCIAL, RAZAO_FABRICANTE = '') => ({ PEDIDO, NOTA_FISCAL, RAZAO_SOCIAL, RAZAO_FABRICANTE });
const so = notas => notas.map(n => n.chave);

test('notasDoPedidoCliente: manual primeiro, depois financeiro (entrada do próprio cliente), só chave/numeroNf/serie, sem repetir', async () => {
  const { banco, lig } = montar();
  const a = banco.semear.danfe({ numero: 11290 });
  const b = banco.semear.danfe({ numero: 11291, cNF: '00000286' });
  banco.semear.vinculo(b.chave, 100);
  banco.semear.fluxo(lanc('100', '11290/11291', ACME));
  const r = await lig.notasDoPedidoCliente(100, ACME);
  assert.ok(r.length > 0);
  assert.deepEqual(so(r), [b.chave, a.chave]);
  assert.deepEqual(r[0], { chave: b.chave, numeroNf: 11291, serie: 1 });
  for (const n of r) assert.deepEqual(Object.keys(n).sort(), ['chave', 'numeroNf', 'serie']);
});

test('notasDoPedidoCliente: lançamento de outra razão social com o mesmo PEDIDO não liga a nota', async () => {
  const { banco, lig } = montar();
  const d = banco.semear.danfe({ numero: 33333 });
  banco.semear.fluxo(lanc('100', '33333', BETA));
  assert.deepEqual(await lig.notasDoPedidoCliente(100, ACME), []);
  banco.semear.fluxo(lanc('100', '33333', ACME)); // o do próprio cliente passa, mas a citação de BETA ainda a descarta
  assert.deepEqual(await lig.notasDoPedidoCliente(100, ACME), []);
  assert.ok(d.chave);
});

test('notasDoPedidoCliente: saída (RAZAO_FABRICANTE preenchido) é ignorada; a entrada do cliente liga (controle)', async () => {
  const { banco, lig } = montar();
  const d = banco.semear.danfe({ numero: 66666 });
  banco.semear.fluxo(lanc('100', '66666', ACME, 'Fornecedor X'));
  assert.deepEqual(await lig.notasDoPedidoCliente(100, ACME), []);
  banco.semear.fluxo(lanc('100', '66666', ACME));
  assert.deepEqual(so(await lig.notasDoPedidoCliente(100, ACME)), [d.chave]);
});

test('notasDoPedidoCliente: mesmo número em duas séries é descartado pelo financeiro, o vínculo manual de uma continua', async () => {
  const { banco, lig } = montar();
  const s1 = banco.semear.danfe({ numero: 77777, serie: 1 });
  const s2 = banco.semear.danfe({ numero: 77777, serie: 2, cNF: '00000286' });
  banco.semear.fluxo(lanc('100', '77777', ACME));
  assert.deepEqual(await lig.notasDoPedidoCliente(100, ACME), []);
  banco.semear.vinculo(s1.chave, 100);
  assert.deepEqual(so(await lig.notasDoPedidoCliente(100, ACME)), [s1.chave]);
  assert.ok(s2.chave);
});

test('notasDoPedidoCliente: número citado por entrada de outra razão social ("88888/1") é descartado; sem a citação, liga', async () => {
  const { banco, lig } = montar();
  const d = banco.semear.danfe({ numero: 88888 });
  banco.semear.fluxo(lanc('100', '88888', ACME));
  assert.deepEqual(so(await lig.notasDoPedidoCliente(100, ACME)), [d.chave]);
  banco.semear.fluxo(lanc('200', '88888/1', BETA));
  assert.deepEqual(await lig.notasDoPedidoCliente(100, ACME), []);
  // citação de OUTRA SAÍDA não conta (só entradas)
  const { banco: b2, lig: l2 } = montar();
  const d2 = b2.semear.danfe({ numero: 88888 });
  b2.semear.fluxo(lanc('100', '88888', ACME));
  b2.semear.fluxo(lanc('200', '88888', BETA, 'Fornecedor X'));
  assert.deepEqual(so(await l2.notasDoPedidoCliente(100, ACME)), [d2.chave]);
});

test('notasDoPedidoCliente: um número que só aparece como trecho de outro ("188888") não descarta nada', async () => {
  const { banco, lig } = montar();
  const d = banco.semear.danfe({ numero: 88888 });
  banco.semear.fluxo(lanc('100', '88888', ACME));
  banco.semear.fluxo(lanc('200', '188888', BETA));
  assert.deepEqual(so(await lig.notasDoPedidoCliente(100, ACME)), [d.chave]);
});

test('notasDoPedidoCliente: sem razão social ou sem DANFE enviado devolve só o vínculo manual', async () => {
  const { banco, lig } = montar();
  assert.deepEqual(await lig.notasDoPedidoCliente(100, ACME), []);
  const d = banco.semear.danfe({ numero: 11290 });
  banco.semear.fluxo(lanc('100', '11290', ACME));
  assert.deepEqual(await lig.notasDoPedidoCliente(100, ''), []);
  assert.deepEqual(so(await lig.notasDoPedidoCliente(100, ACME)), [d.chave]);
});
