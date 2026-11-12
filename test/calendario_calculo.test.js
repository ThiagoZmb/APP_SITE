// Calendário de previsão de finalização: funções puras (calculo/calendario.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../calculo/calendario');

test('validarData: só datas reais (ano bissexto, 31/04, formato)', () => {
  assert.equal(K.validarData('2028-02-29'), '2028-02-29');
  assert.equal(K.validarData('2026-02-29'), null);
  assert.equal(K.validarData('2100-02-29'), null, '2100 não é bissexto');
  assert.equal(K.validarData('2026-04-31'), null);
  assert.equal(K.validarData('2026-13-01'), null);
  assert.equal(K.validarData('2026-1-1'), null);
  assert.equal(K.validarData('01/01/2026'), null);
  assert.equal(K.validarData(undefined), null);
  assert.equal(K.validarData('0001-01-01'), null, 'o VB grava 01/01/0001 quando não há data');
});

test('validarMes: limites do mês, fevereiro bissexto e virada de ano', () => {
  assert.deepEqual(K.validarMes('2026-11'), { ano: 2026, mes: 11, chave: '2026-11', inicio: '2026-11-01', fim: '2026-12-01', ultimo: '2026-11-30' });
  assert.deepEqual(K.validarMes('2026-12'), { ano: 2026, mes: 12, chave: '2026-12', inicio: '2026-12-01', fim: '2027-01-01', ultimo: '2026-12-31' });
  assert.equal(K.validarMes('2028-02').ultimo, '2028-02-29');
  assert.equal(K.validarMes('2027-02').ultimo, '2027-02-28');
  for (const ruim of ['2026-00', '2026-13', '2026-1', '26-11', '2026-11-01', '', null, undefined, '2200-01']) assert.equal(K.validarMes(ruim), null, String(ruim));
});

test('validarSituacao: ausente = abertos; só abertos/todos; resto é inválido', () => {
  assert.equal(K.validarSituacao(undefined), 'abertos');
  assert.equal(K.validarSituacao(''), 'abertos');
  assert.equal(K.validarSituacao('abertos'), 'abertos');
  assert.equal(K.validarSituacao('todos'), 'todos');
  for (const ruim of ['Todos', 'aberto', 'x', ['todos', 'abertos']]) assert.equal(K.validarSituacao(ruim), null, String(ruim));
});

test('somarDias: vira mês e ano, conta 29/02', () => {
  assert.equal(K.somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(K.somarDias('2027-01-01', -1), '2026-12-31');
  assert.equal(K.somarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(K.somarDias('2027-02-28', 1), '2027-03-01');
});

test('classificarSituacao: mesmos grupos do painel', () => {
  const c = K.classificarSituacao;
  assert.equal(c('Em Produção'), 'producao');
  assert.equal(c('em producao'), 'producao');
  assert.equal(c('Pronto'), 'pronto');
  assert.equal(c('Finalizado'), 'pronto');
  assert.equal(c('Entregue'), 'entregue');
  assert.equal(c('Retirado'), 'retirado');
  assert.equal(c('Cancelado'), 'cancelado');
  assert.equal(c('Fechado'), 'outro');
  assert.equal(c(null), 'outro');
});

test('emAberto: produção, pronto e desconhecida; não entregue, retirado nem cancelado', () => {
  for (const s of ['Em Produção', 'Pronto', 'Fechado', '', null]) assert.equal(K.emAberto(s), true, String(s));
  for (const s of ['Entregue', 'Retirado', 'Cancelado']) assert.equal(K.emAberto(s), false, s);
});

test('atrasado: data anterior a hoje e ainda em produção/desconhecida; hoje e futuro não; pronto/entregue/cancelado não', () => {
  assert.equal(K.atrasado('Em Produção', '2026-11-04', '2026-11-05'), true);
  assert.equal(K.atrasado('Em Produção', '2026-11-05', '2026-11-05'), false, 'vence hoje: ainda não atrasou');
  assert.equal(K.atrasado('Em Produção', '2026-11-06', '2026-11-05'), false);
  assert.equal(K.atrasado('Fechado', '2026-01-01', '2026-11-05'), true);
  for (const s of ['Pronto', 'Entregue', 'Retirado', 'Cancelado']) assert.equal(K.atrasado(s, '2026-01-01', '2026-11-05'), false, s);
  assert.equal(K.atrasado('Em Produção', '', '2026-11-05'), false);
  assert.equal(K.atrasado('Em Produção', '2025-12-31 00:00:00', '2026-01-01'), true, 'aceita DATETIME e vira de ano');
});

test('dataISO: DATE/DATETIME em texto; vazio, ano < 1900 e lixo viram vazio', () => {
  assert.equal(K.dataISO('2026-11-05'), '2026-11-05');
  assert.equal(K.dataISO('2026-11-05 00:00:00'), '2026-11-05');
  assert.equal(K.dataISO('0001-01-01 00:00:00'), '');
  assert.equal(K.dataISO(null), '');
  assert.equal(K.dataISO('05/11/2026'), '');
});

const linha = (numero, situacao, pronto, extra = {}) => ({ numero, cliente: 'C' + numero, cliente_final: '', situacao, valor: '100.50', pronto_em: pronto, data_entrega: null, ...extra });
const montar = (linhas, hoje = '2026-11-05') => linhas.map(l => K.montarPedido(l, hoje));

test('montarPedido: classe, atraso, datas e valor numérico', () => {
  const p = K.montarPedido(linha(7, 'Em Produção', '2026-11-01 00:00:00', { data_entrega: '0001-01-01', cliente: ' Fulano  ' }), '2026-11-05');
  assert.deepEqual(p, { numero: 7, cliente: 'Fulano', clienteFinal: '', situacao: 'Em Produção', classe: 'producao', atrasado: true, prontoEm: '2026-11-01', dataEntrega: '', comPerfil: false, comVidro: false, comSerralheria: false, comPintura: false, itens: [], qtdItens: 0, valor: 100.5 });   // linha sem composição = nenhum ícone
});

test('agruparPorDia: abertos tira entregue/retirado/cancelado; todos mantém; ordem por data e número; contagens', () => {
  const ps = montar([
    linha(30, 'Em Produção', '2026-11-10'), linha(12, 'Pronto', '2026-11-10'), linha(5, 'Entregue', '2026-11-10'), linha(8, 'Cancelado', '2026-11-03'),
    linha(9, 'Em Produção', '2026-11-03'), linha(20, 'Retirado', '2026-11-20'), linha(21, 'Em Produção', '', {})
  ]);
  const abertos = K.agruparPorDia(ps, 'abertos');
  assert.deepEqual(abertos.map(d => [d.data, d.pedidos.map(p => p.numero), d.qtdPedidos, d.qtdAtrasados]), [['2026-11-03', [9], 1, 1], ['2026-11-10', [12, 30], 2, 0]]);
  const todos = K.agruparPorDia(ps, 'todos');
  assert.deepEqual(todos.map(d => [d.data, d.pedidos.map(p => p.numero)]), [['2026-11-03', [8, 9]], ['2026-11-10', [5, 12, 30]], ['2026-11-20', [20]]]);
  assert.equal(todos[0].qtdAtrasados, 1, 'cancelado não conta como atrasado');
  assert.deepEqual(K.agruparPorDia([], 'todos'), []);
  assert.deepEqual(K.agruparPorDia(undefined), []);
});

test('virada de ano: pedido de 31/12 atrasa em 01/01 e o agrupamento mantém a data', () => {
  const ps = montar([linha(1, 'Em Produção', '2026-12-31')], '2027-01-01');
  assert.equal(ps[0].atrasado, true);
  assert.equal(K.agruparPorDia(ps)[0].data, '2026-12-31');
});

// ---------- itens do balão (ped_orc_lista_itens) ----------
test('linhaItem: porta, porta de correr, serviço, revestimento e serralheria editável viram uma linha legível sem dinheiro', () => {
  const porta = { TIPO_PRODUTO: 'Porta de giro', PRODUTO: 'Porta de giro', QTD: 2, DESCRICAO: 'Tipo de produto: Porta de giro\r\nTamanho: 1860x397 mm\r\nPerfil: 3345 (Pintura Metálica Alumínio) | Cor: Citrino\r\nPuxador: 1x Slim', UNITARIO: '999.00', TOTAL: '1998.00' };
  assert.deepEqual(K.linhaItem(porta), { qtd: 2, texto: 'Porta de giro 1860 × 397 – Perfil 3345 (Pintura Metálica Alumínio)' });
  assert.deepEqual(K.linhaItem({ TIPO_PRODUTO: 'Porta de correr', QTD: 1, DESCRICAO: 'Tam: 2250x580mm | Per: 3445 Anodizado Natural | Sist: Sem sistema' }), { qtd: 1, texto: 'Porta de correr 2250 × 580 – Perfil 3445 Anodizado Natural' });
  assert.deepEqual(K.linhaItem({ TIPO_PRODUTO: 'Serviço', QTD: 27, DESCRICAO: 'Pinturas diversas' }), { qtd: 27, texto: 'Serviço: Pinturas diversas' });
  assert.deepEqual(K.linhaItem({ TIPO_PRODUTO: 'Metalons', QTD: 1, DESCRICAO: 'Estrutura metálica editável', OBSERVACAO: 'estrutura cama  cor Ligth gold' }), { qtd: 1, texto: 'Metalons: estrutura cama cor Ligth gold' });
  assert.deepEqual(K.linhaItem({ TIPO_PRODUTO: 'Metalons', QTD: 1, DESCRICAO: 'Estrutura metálica editável', OBSERVACAO: '' }), { qtd: 1, texto: 'Metalons: Estrutura metálica editável' });
  assert.ok(!JSON.stringify(K.linhaItem(porta)).includes('999'), 'preço nunca entra');
});

test('linhaItem: saneia HTML/controle, corta texto longo, QTD inválida vira 1 e item sem texto some', () => {
  const x = K.linhaItem({ TIPO_PRODUTO: 'Serviço', QTD: 0, DESCRICAO: '<img src=x onerror=1>' + 'a'.repeat(200) });
  assert.equal(x.qtd, 1);
  assert.ok(!/[<>]/.test(x.texto) && x.texto.length <= 90 && x.texto.endsWith('…'));
  assert.equal(K.linhaItem({ TIPO_PRODUTO: '', DESCRICAO: '  ', PRODUTO: '' }), null);
});

test('agruparItens: por pedido, na ordem do ITEM, limita a MAX_ITENS_BALAO e guarda o total real; pedido sem itens fica fora', () => {
  const linhas = [{ NUMERO: 5, ITEM: 2, TIPO_PRODUTO: 'Serviço', QTD: 1, DESCRICAO: 'B' }, { NUMERO: 5, ITEM: 1, TIPO_PRODUTO: 'Serviço', QTD: 1, DESCRICAO: 'A' }];
  for (let i = 1; i <= 20; i++) linhas.push({ NUMERO: 6, ITEM: i, TIPO_PRODUTO: 'Serviço', QTD: i, DESCRICAO: 'S' + i });
  const m = K.agruparItens(linhas);
  assert.deepEqual(m.get(5).itens.map(i => i.texto), ['Serviço: A', 'Serviço: B']);
  assert.equal(m.get(6).itens.length, K.MAX_ITENS_BALAO);
  assert.equal(m.get(6).qtdItens, 20);
  assert.equal(m.get(6).itens[0].texto, 'Serviço: S1');
  assert.equal(m.has(7), false);
  assert.equal(K.agruparItens(null).size, 0);
});

test('montarPedido: leva itens e qtdItens (padrão vazio)', () => {
  const p = K.montarPedido({ numero: 1, situacao: 'Pronto', pronto_em: '2026-11-05', itens: [{ qtd: 1, texto: 'x' }], qtdItens: 3 }, '2026-11-05');
  assert.deepEqual([p.itens, p.qtdItens], [[{ qtd: 1, texto: 'x' }], 3]);
  const v = K.montarPedido({ numero: 2, situacao: 'Pronto', pronto_em: '2026-11-05' }, '2026-11-05');
  assert.deepEqual([v.itens, v.qtdItens], [[], 0]);
});
