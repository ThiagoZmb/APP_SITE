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
