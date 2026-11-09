// Indicadores do painel (função pura): mesmas contas que painel_inicial.html fazia no navegador.
// "Hoje" fixo = 2026-11-09 (segunda).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularIndicadores, validarPeriodo, janela, hojeDe, situacao, dataBRSegura } = require('../calculo/indicadores_painel');

const HOJE = '2026-11-09';
const P = (o) => ({ cliente: 'A', data: '05/11/2026', valor: '100.00', situacao: 'Em Produção', financeiro: '', prontoEm: '', dataEntrega: '', ...o });

test('validarPeriodo: padrão 6; aceita só a lista fixa', () => {
  assert.equal(validarPeriodo(undefined), '6');
  assert.equal(validarPeriodo(''), '6');
  for (const v of ['mes', 'mes-ant', '3', '6', '12', 'ano', 'tudo']) assert.equal(validarPeriodo(v), v);
  assert.equal(validarPeriodo('7'), null);
  assert.equal(validarPeriodo('MES'), null);
});

test('hojeDe: valida o texto e a data real', () => {
  assert.equal(hojeDe('2026-02-30'), null);
  assert.equal(hojeDe('09/11/2026'), null);
  assert.equal(hojeDe('2026-11-09').getDate(), 9);
});

test('janela: períodos e anterior equivalente', () => {
  const h = hojeDe(HOJE);
  const m = janela('mes', h);
  assert.equal(m.ini.getMonth(), 10); assert.equal(m.iniAnt.getMonth(), 9);
  assert.equal(m.fimAnt.getDate(), 9); // mesmo ponto do mês passado
  const a = janela('mes-ant', h);
  assert.equal(a.ini.getMonth(), 9); assert.equal(a.fim.getDate(), 31);
  assert.equal(a.iniAnt.getMonth(), 8); assert.equal(a.fimAnt.getDate(), 30);
  const s = janela('6', h);
  assert.equal(s.ini.getMonth(), 5); assert.equal(s.iniAnt.getMonth(), 11); assert.equal(s.iniAnt.getFullYear(), 2025);
  assert.equal(janela('tudo', h).iniAnt, null);
  assert.equal(janela('ano', h).iniAnt.getFullYear(), 2025);
  // dia 31 em mês cujo anterior tem menos dias
  assert.equal(janela('mes', hojeDe('2026-03-31')).fimAnt.getDate(), 28);
});

test('situacao e dataBRSegura', () => {
  assert.equal(situacao('Em Produção'), 'producao');
  assert.equal(situacao('Cancelado'), 'cancelado');
  assert.equal(situacao('FINALIZADO'), 'pronto');
  assert.equal(situacao('Entregue'), 'entregue');
  assert.equal(situacao(null), 'outro');
  assert.equal(dataBRSegura('0001-01-01'), '');
  assert.equal(dataBRSegura('2026-11-03 00:00:00'), '03/11/2026');
  assert.equal(dataBRSegura('3/1/2026'), '03/01/2026');
});

test('resultado do período: cancelado fora dos fechados e contado à parte; anterior; clientes distintos', () => {
  const r = calcularIndicadores({ hoje: HOJE, periodo: 'mes', pedidos: [
    P({ cliente: 'A', valor: '100' }), P({ cliente: 'A', valor: '50' }), P({ cliente: 'B', valor: '30' }),
    P({ cliente: 'C', valor: '999', situacao: 'Cancelado' }),
    P({ cliente: 'A', valor: '10', data: '03/10/2026' }),               // período anterior
    P({ cliente: 'A', valor: '10', data: '20/10/2026' }),               // depois do ponto equivalente (09/10): fora do anterior
    P({ cliente: 'A', data: '' }), P({ cliente: 'A', data: '01/01/1800' }) // sem data válida: ignorados
  ], orcamentos: [P({ valor: '400' }), P({ valor: '100', data: '01/10/2026' }), P({ valor: '5', data: '15/10/2026' })] });
  assert.equal(r.resultado.qtdPedidos, 3);
  assert.equal(r.resultado.qtdPedidosAnt, 1);
  assert.equal(r.resultado.qtdCancelados, 1);
  assert.equal(r.resultado.qtdClientes, 2);
  assert.equal(r.resultado.qtdOrcamentos, 1);
  assert.equal(r.resultado.qtdOrcamentosAnt, 1);
  const v = r.valores.resultado;
  assert.equal(v.pedidos, 180); assert.equal(v.pedidosAnt, 10);
  assert.equal(v.orcamentos, 400); assert.equal(v.orcamentosAnt, 100);
  assert.equal(v.conversao, 180 / 400); assert.equal(v.conversaoAnt, 0.1);
  assert.equal(v.ticketMedio, 60); assert.equal(v.ticketMedioAnt, 10);
  assert.equal(r.periodo.temAnterior, true);
});

test('resultado: sem orçamentos conversão null; sem pedidos ticket 0; "tudo" não tem anterior', () => {
  const r = calcularIndicadores({ hoje: HOJE, periodo: 'tudo', pedidos: [], orcamentos: [] });
  assert.equal(r.valores.resultado.conversao, null);
  assert.equal(r.valores.resultado.ticketMedio, 0);
  assert.equal(r.periodo.temAnterior, false);
  assert.equal(r.resultado.qtdPedidosAnt, 0);
});

test('filtro de cliente: igualdade exata (afeta resultado e operação)', () => {
  const pedidos = [P({ cliente: 'ACME' }), P({ cliente: 'ACME LTDA' }), P({ cliente: 'acme' })];
  const r = calcularIndicadores({ hoje: HOJE, periodo: 'mes', cliente: 'ACME', pedidos, orcamentos: [] });
  assert.equal(r.resultado.qtdPedidos, 1);
  assert.equal(r.operacao.qtdEmProducao, 1);
  assert.equal(r.periodo.cliente, 'ACME');
});

test('operação agora: independe do período; hoje; produção; prontos; prontos parados > 7 dias', () => {
  const pedidos = [
    P({ data: '09/11/2026', situacao: 'Em Produção' }),
    P({ data: '01/01/2020', situacao: 'Em Produção' }),   // fora de qualquer período curto, ainda conta
    P({ situacao: 'Pronto', prontoEm: '01/11/2026' }),     // 8 dias: parado
    P({ situacao: 'Pronto', prontoEm: '02/11/2026' }),     // exatamente 7 dias: NÃO é parado (> 7)
    P({ situacao: 'Pronto', prontoEm: '' }),               // sem data: não é parado
    P({ situacao: 'Entregue' })
  ];
  const orcamentos = [P({ data: '09/11/2026' }), P({ data: '08/11/2026' })];
  // (os dois Prontos com data de pronto passada também contam como entrega atrasada: Pronto só não atrasa sem data/no dia)
  const r = calcularIndicadores({ hoje: HOJE, periodo: 'mes', pedidos, orcamentos });
  assert.deepEqual(r.operacao, { qtdHojePedidos: 1, qtdHojeOrcamentos: 1, qtdEmProducao: 2, qtdProntos: 3, qtdProntosParados: 1, qtdAtrasadas: 2 });
  const r2 = calcularIndicadores({ hoje: HOJE, periodo: 'tudo', pedidos, orcamentos });
  assert.deepEqual(r2.operacao, r.operacao);
});

test('atraso: data de entrega vence a de pronto; hoje não atrasa; finalizados e cancelados não; Pronto atrasa se tem data passada', () => {
  const pedidos = [
    P({ prontoEm: '08/11/2026' }),                                   // atrasado (pronto previsto ontem)
    P({ prontoEm: '09/11/2026' }),                                   // hoje: não
    P({ prontoEm: '01/01/2020', dataEntrega: '20/11/2026' }),        // entrega futura prevalece: não
    P({ dataEntrega: '01/11/2026', prontoEm: '25/11/2026' }),        // entrega passada prevalece: atrasado
    P({ situacao: 'Entregue', prontoEm: '01/01/2020' }),
    P({ situacao: 'Retirado', prontoEm: '01/01/2020' }),
    P({ situacao: 'Cancelado', prontoEm: '01/01/2020' }),
    P({ situacao: 'Pedido Aprovado', prontoEm: '01/01/2020' }),      // situação desconhecida: atrasa
    P({ prontoEm: '' })
  ];
  const r = calcularIndicadores({ hoje: HOJE, pedidos, orcamentos: [] });
  assert.equal(r.operacao.qtdAtrasadas, 3);
  assert.equal(r.valores.operacao.atrasadas, 300);
});

test('a receber / atraso financeiro (dentro de valores) e cancelados excluídos', () => {
  const pedidos = [
    P({ financeiro: 'A Receber', valor: '10' }), P({ financeiro: 'Atrasado', valor: '20' }), P({ financeiro: 'Protestado', valor: '40' }),
    P({ financeiro: 'Recebido', valor: '1000' }), P({ financeiro: 'A Receber', valor: '5000', situacao: 'Cancelado' })
  ];
  const v = calcularIndicadores({ hoje: HOJE, pedidos, orcamentos: [] }).valores.operacao;
  assert.equal(v.aReceber, 70); assert.equal(v.qtdAReceber, 3);
  assert.equal(v.atrasoFinanceiro, 60); assert.equal(v.qtdAtrasoFinanceiro, 2);
});

test('valor não numérico vira 0; hoje inválido lança', () => {
  const r = calcularIndicadores({ hoje: HOJE, periodo: 'mes', pedidos: [P({ valor: 'abc' }), P({ valor: null })], orcamentos: [] });
  assert.equal(r.valores.resultado.pedidos, 0);
  assert.equal(r.resultado.qtdPedidos, 2);
  assert.throws(() => calcularIndicadores({ hoje: 'ontem', pedidos: [], orcamentos: [] }));
});

test('virada de ano: janeiro compara com dezembro', () => {
  const r = calcularIndicadores({ hoje: '2026-01-15', periodo: 'mes-ant', pedidos: [P({ data: '10/12/2025' }), P({ data: '10/11/2025' })], orcamentos: [] });
  assert.equal(r.resultado.qtdPedidos, 1);
  assert.equal(r.resultado.qtdPedidosAnt, 1);
});
