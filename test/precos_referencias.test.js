const test = require('node:test');
const assert = require('node:assert/strict');
const { referenciaComissao, referenciaDesconto, referenciaCustoFixo } = require('../calculo/precos_referencias');

const quase = (a, b, casas = 3) => assert.ok(a !== null && Math.abs(a - b) < 10 ** -casas, `${a} ≠ ${b}`);

test('comissão: média e mais frequente; vazio e texto ilegível ficam fora', () => {
  const r = referenciaComissao([{ COMISSAO: '5' }, { COMISSAO: '5%' }, { COMISSAO: '3' }, { COMISSAO: 'abc' }, { COMISSAO: null }]);
  quase(r.media, 4.333);
  assert.equal(r.maisFrequente, 5);
  assert.equal(r.qtd, 3);
  assert.equal(r.ilegiveis, 2);
  assert.equal(r.motivo, null);
  assert.equal(referenciaComissao([{ COMISSAO: '2' }, { COMISSAO: '4' }]).maisFrequente, 2); // empate → o menor
  const vazio = referenciaComissao([]);
  assert.equal(vazio.media, null);
  assert.ok(vazio.motivo);
});

test('desconto: só clientes de desconto fixo; média, mais frequente e maior', () => {
  const r = referenciaDesconto([
    { DESCONTO: 28, TIPO_DESCONTO: 'Desconto fixo' }, { DESCONTO: 28, TIPO_DESCONTO: 'DESCONTO FIXO' },
    { DESCONTO: 40, TIPO_DESCONTO: 'Desconto fixo' }, { DESCONTO: 50, TIPO_DESCONTO: 'Desconto progressivo' }
  ]);
  assert.equal(r.media, 32);
  assert.equal(r.maisFrequente, 28);
  assert.equal(r.maior, 40);
  assert.equal(r.qtd, 3);
  assert.equal(r.motivo, null);
  const so = referenciaDesconto([{ DESCONTO: 50, TIPO_DESCONTO: 'Desconto progressivo' }]);
  assert.equal(so.maior, null);
  assert.ok(so.motivo);
});

const grupos = () => [
  { classificacaoId: 1, nome: 'Despesas › Aluguel', COMPORTAMENTO: 'Fixo', ENTRA_DRE: 1, SITUACAO: 'Pago', total: 120000 },
  { classificacaoId: 2, nome: 'Despesas › Fornecedores', COMPORTAMENTO: 'Variável', ENTRA_DRE: 1, SITUACAO: 'Pago', total: 500000 },
  { classificacaoId: 3, nome: 'Receitas › Vendas', COMPORTAMENTO: null, ENTRA_DRE: 1, SITUACAO: 'Recebido', total: 1000000 },
  { classificacaoId: 4, nome: 'Receitas › Empréstimo', COMPORTAMENTO: null, ENTRA_DRE: 0, SITUACAO: 'Recebido', total: 200000 },
  { classificacaoId: null, nome: null, COMPORTAMENTO: null, ENTRA_DRE: null, SITUACAO: 'Recebido', total: 200000 }
];

test('custo fixo: despesas fixas ÷ receitas (DRE + sem classificação), por mês', () => {
  const r = referenciaCustoFixo(grupos(), 12);
  quase(r.pct, 10);
  quase(r.despesasMes, 10000);
  quase(r.receitasMes, 100000);
  assert.equal(r.receitasSemClassificacao, 200000);
  assert.deepEqual(r.contas, [{ nome: 'Despesas › Aluguel', total: 120000 }]);
  assert.equal(r.motivo, null);
});

test('custo fixo: "FIXA" e "fixo " também contam', () => {
  const g = grupos();
  g[1].COMPORTAMENTO = 'fixa ';
  g.push({ classificacaoId: 5, nome: 'Despesas › Contador', COMPORTAMENTO: 'FIXO', ENTRA_DRE: 1, SITUACAO: 'Pago', total: 60000 });
  const r = referenciaCustoFixo(g, 12);
  assert.equal(r.contas.length, 3);
  quase(r.despesasMes, 680000 / 12);
});

test('custo fixo: nenhuma classificação fixa → vazio com motivo e o que foi encontrado', () => {
  const g = grupos();
  g[0].COMPORTAMENTO = null;
  const r = referenciaCustoFixo(g, 12);
  assert.equal(r.pct, null);
  assert.equal(r.motivo, 'nenhuma classificação marcada como fixa no fluxo de caixa');
  assert.deepEqual(r.comportamentos, ['Variável']);
  assert.deepEqual(r.semComportamento, ['Despesas › Aluguel']);
});

test('custo fixo: sem receitas → vazio com motivo', () => {
  const r = referenciaCustoFixo(grupos().filter(g => g.SITUACAO === 'Pago'), 12);
  assert.equal(r.pct, null);
  assert.match(r.motivo, /receita/);
});

test('revisão I1: DESCONTO vazio em cliente de desconto fixo não vira 0%', () => {
  const r = referenciaDesconto([{ DESCONTO: null, TIPO_DESCONTO: 'Desconto fixo' }, { DESCONTO: '', TIPO_DESCONTO: 'Desconto fixo' }, { DESCONTO: 30, TIPO_DESCONTO: 'Desconto fixo' }]);
  assert.deepEqual([r.media, r.maisFrequente, r.maior, r.qtd, r.semDesconto], [30, 30, 30, 1, 2]);
  const todos = referenciaDesconto([{ DESCONTO: null, TIPO_DESCONTO: 'Desconto fixo' }]);
  assert.equal(todos.maior, null);
  assert.ok(todos.motivo);
});
