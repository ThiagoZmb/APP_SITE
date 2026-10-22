const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularPrecoItem, precoAcessorio, fatorHistorico, lerCliente, criarLeitor, ErroPreco } = require('../calculo/precos');
const { criarPoolFalso } = require('./apoio/poolFalso');

// leitor falso: cadastro em memória
function leitorFalso(produtos = {}, acabamentos = {}) {
  return {
    produto: async nome => produtos[nome] || null,
    taxaAcabamento: async nome => acabamentos[nome] || 0,
    fixoSerralheria: async () => 0,
    valorSolda: async () => 0
  };
}
// só o VALOR_FIXO é usado (decisão do Thiago: o VALOR_CHEIO saiu do sistema web)
const PERFIL = { valorFixo: 100, descontoVidro: 20, descontoPerfilPux: 0, tipoPuxador: '' };
const semDesconto = { isFixo: false, desconto: 0 };

test('porta sem puxador: perímetro × preço do perfil', async () => {
  const r = await calcularPrecoItem({ frente: 'Porta de giro', altura: 1000, largura: 500, perfil: 'P', qtd: 1 }, semDesconto, leitorFalso({ P: PERFIL }));
  assert.equal(r.unitario, 300);
});

test('desconto do cliente sobre a porta', async () => {
  const r = await calcularPrecoItem({ frente: 'Porta de giro', altura: 1000, largura: 500, perfil: 'P', qtd: 2 }, { isFixo: false, desconto: 10 }, leitorFalso({ P: PERFIL }));
  assert.equal(r.unitario, 270);
  assert.equal(r.total, 540);
});

test('perfil inexistente rejeita com ErroPreco', async () => {
  await assert.rejects(calcularPrecoItem({ frente: 'Porta de giro', altura: 1000, largura: 500, perfil: 'X', qtd: 1 }, semDesconto, leitorFalso()),
    e => e instanceof ErroPreco && e.message === "Perfil 'X' não encontrado ou sem preços.");
});

test('preço de tabela do acessório: sempre o VALOR_FIXO; desconto do cliente só para quem é de desconto fixo', () => {
  const d = { valorFixo: 10 };
  assert.equal(precoAcessorio(d, { isFixo: true, desconto: 10 }, 'MANUAL'), 9);
  assert.equal(precoAcessorio(d, { isFixo: true, desconto: 10 }, 'SISTEMA DE CORRER'), 9);
  assert.equal(precoAcessorio(d, { isFixo: false, desconto: 10 }, 'MANUAL'), 10);
  assert.equal(precoAcessorio({ valorFixo: 10, valorCheio: 999 }, { isFixo: false, desconto: 0 }, 'MANUAL'), 10); // valorCheio, se vier, é ignorado
});

test('cliente sem desconto fixo também parte do VALOR_FIXO (o VALOR_CHEIO não é mais usado)', async () => {
  const leitor = leitorFalso({ P: { ...PERFIL, valorCheio: 999 } });
  const r = await calcularPrecoItem({ frente: 'Porta de giro', altura: 1000, largura: 500, perfil: 'P', qtd: 1 }, semDesconto, leitor);
  assert.equal(r.unitario, 300); // 3 m × 100
});

test('leitor do cadastro não lê VALOR_CHEIO (produto e solda)', async () => {
  const pool = criarPoolFalso([[/FROM cadastro_de_produtos/, [{ CODIGO: 1, MODELO: 'P', VALOR_FIXO: 50, DESCONTO_VIDRO: 0, TIPO_PUXADOR: '', DESC_PERF_PUX: 0, v: 3 }]]]);
  const leitor = criarLeitor(pool);
  const p = await leitor.produto('P');
  assert.equal(p.valorFixo, 50);
  assert.equal('valorCheio' in p, false);
  assert.equal(await leitor.valorSolda(), 3);
  assert.ok(pool.chamadas.every(c => !/VALOR_CHEIO/.test(c.sql)), pool.chamadas.map(c => c.sql).join('\n'));
});

test('acessório com tamanho é cobrado por metro (Trilho Superior 3086: 119,83/m × 0,8 m = 95,86)', async () => {
  const leitor = leitorFalso({ P: PERFIL, Trilho: { valorFixo: 119.83 }, Kit: { valorFixo: 433.57 } });
  const r = await require('../calculo/precos').precoComAcessorios({ frente: 'Porta de Correr', altura: 1000, largura: 500, perfil: 'P', qtd: 2 }, semDesconto, leitor,
    [{ nome: 'Kit', qtd: 2, tamanho: 0, origem: 'SISTEMA DE CORRER' }, { nome: 'Trilho', qtd: 1, tamanho: 800, origem: 'SISTEMA DE CORRER' }]);
  assert.deepEqual(r.acessorios.map(a => [a.nome, a.valorTabela, a.valorUnitario, a.valorTotal]), [['Kit', 433.57, 433.57, 867.14], ['Trilho', 119.83, 95.86, 95.86]]);
  assert.equal(r.total, 1563); // portas 2 × 300 + 867,14 + 95,86
});

test('histórico de % é aditivo (regra do VB)', () => {
  assert.equal(Math.round(fatorHistorico('+100;+10') * 1000) / 1000, 2.1);
  assert.equal(fatorHistorico('-10'), 0.9);
  assert.equal(fatorHistorico('+5,5%'), 1.055);
  assert.equal(fatorHistorico(''), 1);
});

test('lerCliente: representante só quando há comissão', async () => {
  const linha = c => [{ CODIGO: 7, RAZAO_SOCIAL: 'CLIENTE X', MEDICAO: 'Vão', TIPO_DESCONTO: 'Desconto fixo', DESCONTO: 12, COMISSAO: c, REPRESENTANTE: 'JOÃO' }];
  let pool = criarPoolFalso([[/FROM cadastro_clientes WHERE CODIGO = \?/, linha('0')]]);
  let c = await lerCliente(pool, { clienteCodigo: 7 });
  assert.deepEqual(c, { codigo: 7, razaoSocial: 'CLIENTE X', medicao: 'Vão', estado: '', isFixo: true, desconto: 12, representante: 'Nenhum' });
  pool = criarPoolFalso([[/FROM cadastro_clientes WHERE CODIGO = \?/, linha('5')]]);
  assert.equal((await lerCliente(pool, { clienteCodigo: 7 })).representante, 'JOÃO');
  pool = criarPoolFalso([]);
  assert.equal(await lerCliente(pool, { clienteCodigo: 8 }), null);
});

test('sem acessórios, o preço com acessórios é o mesmo da tela (revisão: 700×409, qtd 2)', async () => {
  const leitor = leitorFalso({ P: PERFIL, V: { valorFixo: 200, descontoVidro: 0, descontoPerfilPux: 0, tipoPuxador: '' } });
  const e = { frente: 'Porta de giro', altura: 700, largura: 409, perfil: 'P', revestimento: 'V', qtd: 2 };
  const tela = await calcularPrecoItem(e, semDesconto, leitor);
  const servidor = await require('../calculo/precos').precoComAcessorios(e, semDesconto, leitor, []);
  assert.equal(servidor.unitario, tela.unitario);
});
