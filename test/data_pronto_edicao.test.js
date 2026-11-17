// Salvar um Pedido existente (POST /ped_orc/salvar, modo 'atualizar') com outra data de pronto audita data_pronto_alterada {de, para, origem: 'edicao'}.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const { resumoDoEvento } = require('../calculo/historico_pedido');

const giro = () => ({ frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, profundidade: 0, soldas: 0, obs: '',
  furos: { lista: [100, 900], lados: ['Esquerdo', 'Esquerdo'] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: 'Vidro V', corRevest: 'Incolor',
    divisor: '', divH: 0, divV: 0, posicoesFolhas: ['', ''] },
  acessorios: [{ nome: 'Fechadura', qtd: 1, origem: 'MANUAL' }], historico: '', valorTela: 705.08 });
const pedido = (dataEntrega, mudar = {}) => ({ modo: 'atualizar', numero: 10, tipo: 'Pedido', clienteCodigo: 7, clienteFinal: 'Fulano', obsGeral: '',
  descontoPct: 0, totalTela: 1410.16, itens: [giro()], dataEntrega, situacao: 'Em Produção', financeiro: 'A Receber', ...mudar });
const preparar = async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ TIPO: 'Pedido', NUMERO: 10, RAZAO_SOCIAL: 'CLIENTE TESTE', DATA_PRONTO: '2026-11-16' });
  const { chamar } = await prepararPedOrc(t, { banco });
  return { banco, chamar };
};
const eventos = banco => banco.auditoria.filter(l => l.acao === 'data_pronto_alterada');

test('editar pedido com outra data de pronto grava de/para e origem edicao', async t => {
  const { banco, chamar } = await preparar(t);
  assert.equal((await chamar('/ped_orc/salvar', 'POST', pedido('2026-11-18'))).status, 200);
  const ev = eventos(banco);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].alvo, 'Pedido 10');
  const d = typeof ev[0].detalhe === 'string' ? JSON.parse(ev[0].detalhe) : ev[0].detalhe;
  assert.deepEqual([d.de, d.para, d.origem, d.cliente], ['2026-11-16', '2026-11-18', 'edicao', 'CLIENTE TESTE']);
  assert.equal(resumoDoEvento('data_pronto_alterada', d), 'Data de pronto: 16/11/2026 → 18/11/2026 (editando o pedido)');
});

test('editar pedido com a mesma data de pronto não grava evento', async t => {
  const { banco, chamar } = await preparar(t);
  assert.equal((await chamar('/ped_orc/salvar', 'POST', pedido('2026-11-16'))).status, 200);
  assert.equal(eventos(banco).length, 0);
});

test('criar pedido novo não grava data_pronto_alterada', async t => {
  const { banco, chamar } = await preparar(t);
  assert.equal((await chamar('/ped_orc/salvar', 'POST', pedido('2026-11-18', { modo: 'novo', numero: undefined }))).status, 200);
  assert.equal(eventos(banco).length, 0);
});

test('texto do histórico: origens conhecidas e sem origem não mudam', () => {
  assert.equal(resumoDoEvento('data_pronto_alterada', { de: '2026-11-16', para: '2026-11-18' }), 'Data de pronto: 16/11/2026 → 18/11/2026');
  assert.equal(resumoDoEvento('data_pronto_alterada', { de: '2026-11-16', para: '2026-11-18', origem: 'etapas_producao' }),
    'Data de pronto: 16/11/2026 → 18/11/2026 (pela etapa "Pedido finalizado")');
});
