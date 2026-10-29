const test = require('node:test');
const assert = require('node:assert/strict');
const { traduzirDocumento, impressaoDigital } = require('../calculo/leitura_vb');

const cab = { id: 1, TIPO: 'Pedido', NUMERO: 123, RAZAO_SOCIAL: 'CLIENTE TESTE', CLIENTE_FINAL: 'Fulano', OBS_GERAL: 'obs', DESCONTO: 5,
  DATA: '2026-08-10 14:30:00', DATA_PRONTO: '2026-09-01 00:00:00', SITUACAO: 'Em Produção', FINANCEIRO: 'A Receber' };
const vazio = () => ({ cab, lista: [], itensV4: [], complementos: [], furacao: [], serralheria: [], serralheriaComp: [], vidros: [], perfis: [] });
// configuração de folha no formato do ModPedOrc (ped_orc_itens_v4)
const cfg = (item, k, mudar = {}) => ({ ID: item * 10 + k, TIPO: 'Pedido', NUMERO: 123, TIPO_PRODUTO: 'Porta de giro', ITEM_PEDIDO: item, ITEM: k, PORTA: `Folha ${k}`,
  QTD: 2, ALTURA_VAO: 0, LARGURA_VAO: 0, ALTURA: 2000, LARGURA: 500, PERFIL: 'Perfil P', ACABAMENTO_PERFIL: 'Anodizado', COR_PERFIL: 'Preto',
  USINAGEM_PERFIL: null, REVESTIMENTO: 'Vidro V', COR_REVESTIMENTO: 'Incolor', PUXADOR: 'Puxador X', ACABAMENTO_PUXADOR: 'Escovado', COR_PUXADOR: 'Preto',
  TAM_PUXADOR: 300, USINAGEM_PUXADOR: null, TIPO_PUXADOR: 'Sobreposto', QTD_PUXADOR: 1, POSICAO_PUXADOR: 'Lateral Direita Superior',
  DIVISOR: null, ACABAMENTO_DIVISOR: null, COR_DIVISOR: null, QTD_HORIZONTAL: 0, QTD_VERTICAL: 0, TAM_DIV_HORIZONTAL: 0, TAM_DIV_VERTICAL: 0,
  OBS: null, UNITARIO: 700, TOTAL: 1400, ...mudar });
const linha = (item, mudar = {}) => ({ id: item, TIPO: 'Pedido', NUMERO: 123, ITEM: item, TIPO_PRODUTO: 'Porta de giro', PRODUTO: 'Porta de giro', QTD: 4,
  DESCRICAO: 'Tipo de produto: Porta de giro\r\n', UNITARIO: 700, TOTAL: 2800, OBSERVACAO: null, PORCENTAGEM: '', ...mudar });
const furo = (id, item, n, tam, lado) => ({ id, NUMERO: 123, TIPO: 'Pedido', ITEM: item, FURO: String(n), LADO: lado, TAMANHO: tam });

function giro4() {
  const l = vazio();
  l.lista.push(linha(1));
  l.itensV4.push(cfg(1, 1), cfg(1, 2, { POSICAO_PUXADOR: 'Lateral Esquerda Superior' }));
  l.furacao.push(furo(1, 1, 1, 100, 'Esquerdo'), furo(2, 1, 2, 900, 'Esquerdo'), furo(3, 1, 1, 100, 'Direito'), furo(4, 1, 2, 900, 'Direito'));
  return l;
}

test('cabeçalho', () => {
  const { cabecalho } = traduzirDocumento(vazio(), { sistemas: {} });
  assert.deepEqual(cabecalho, { tipo: 'Pedido', numero: 123, razaoSocial: 'CLIENTE TESTE', clienteFinal: 'Fulano', obsGeral: 'obs', descontoPct: 5,
    data: '2026-08-10 14:30:00', dataEntrega: '2026-09-01', situacao: 'Em Produção', financeiro: 'A Receber' });
});

test('porta de giro com 4 folhas em 2 configurações e furos por configuração', () => {
  const [it] = traduzirDocumento(giro4(), { sistemas: {} }).itens;
  assert.equal(it.travado, undefined);
  assert.deepEqual(it.origem, { item: 1, estado: 'intacto' });
  assert.deepEqual([it.frente, it.qtd, it.altura, it.largura], ['Porta de giro', 4, 2000, 500]);
  assert.deepEqual(it.detalhes.posicoesFolhas, ['Lateral Direita Superior', 'Lateral Direita Superior', 'Lateral Esquerda Superior', 'Lateral Esquerda Superior']);
  assert.deepEqual(it.furos, { lista: [100, 900], lados: ['Esquerdo', 'Esquerdo', 'Direito', 'Direito'], referenciaInvertida: false });
  assert.deepEqual([it.detalhes.perfil, it.detalhes.acabamento, it.detalhes.cor, it.detalhes.puxador, it.detalhes.tamanhoPux, it.detalhes.revestimento],
    ['Perfil P', 'Anodizado', 'Preto', 'Puxador X', '300', 'Vidro V']);
  assert.deepEqual([it.valor, it.valorBase, it.historico], [700, 700, '']);
});

test('% gravada: valor original sem %', () => {
  const l = giro4();
  l.lista[0] = linha(1, { PORCENTAGEM: '+10', UNITARIO: 110 });
  const [it] = traduzirDocumento(l, { sistemas: {} }).itens;
  assert.deepEqual([it.valor, it.valorBase, it.historico], [110, 100, '+10']);
});

const S1 = { descontoAltura: 40, itens: [{ modelo: 'Trilho Sup', classe: 'Trilho superior' }, { modelo: 'Desemp', classe: 'Desempenador' }] };
function correr(mudarCfg = {}, mudarLinha = {}) {
  const l = vazio();
  l.lista.push(linha(1, { TIPO_PRODUTO: 'Porta de correr', PRODUTO: 'Porta de correr', QTD: 1, UNITARIO: 1300, TOTAL: 1300,
    DESCRICAO: 'Tam: 2100x1600mm | Per: Perfil P Anodizado | Sist: S1 | Pux:  | Rev:  | Portas: 2 | Furos: 0', ...mudarLinha }));
  l.itensV4.push(cfg(1, 1, { TIPO_PRODUTO: 'Porta de correr', ALTURA: 2060, LARGURA: 825, ALTURA_VAO: 2100, LARGURA_VAO: 1600,
    PUXADOR: null, ACABAMENTO_PUXADOR: null, COR_PUXADOR: null, TAM_PUXADOR: 0, TIPO_PUXADOR: null, QTD_PUXADOR: 0, POSICAO_PUXADOR: null, REVESTIMENTO: null, COR_REVESTIMENTO: null, ...mudarCfg }));
  l.complementos.push({ id: 1, TIPO: 'Pedido', NUMERO: 123, ITEM_PEDIDO: 1, ITEM: 1, QTD: 2, COMPLEMENTO: 'Trilho Sup', TAMANHO: 1600, UNITARIO: 40 },
    { id: 2, TIPO: 'Pedido', NUMERO: 123, ITEM_PEDIDO: 1, ITEM: 2, QTD: 2, COMPLEMENTO: 'Desemp', TAMANHO: 0, UNITARIO: 60 },
    { id: 3, TIPO: 'Pedido', NUMERO: 123, ITEM_PEDIDO: 1, ITEM: 3, QTD: 1, COMPLEMENTO: 'Fechadura', TAMANHO: 0, UNITARIO: 30 });
  return l;
}

test('porta de correr com sistema: vão na tela, transpasse, desempenador e acessórios por origem', () => {
  const [it] = traduzirDocumento(correr(), { sistemas: { S1 } }).itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual([it.frente, it.qtd, it.altura, it.largura], ['Porta de Correr', 2, 2100, 1600]);
  assert.deepEqual([it.detalhes.sistema, it.detalhes.transpasse, it.detalhes.desempenador], ['S1', '50', true]);
  assert.deepEqual(it.acessorios, [{ nome: 'Trilho Sup', qtd: 2, tamanho: 1600, origem: 'SISTEMA DE CORRER' },
    { nome: 'Desemp', qtd: 2, tamanho: 0, origem: 'SISTEMA DE CORRER' }, { nome: 'Fechadura', qtd: 1, tamanho: 0, origem: 'MANUAL' }]);
  assert.equal(it.valor, 650); // por folha, como a tela mostra
});

test('porta de correr sem vão gravado = Sem sistema, medida da porta', () => {
  const l = correr({ ALTURA: 2100, LARGURA: 1600, ALTURA_VAO: null, LARGURA_VAO: null });
  l.complementos = [];
  const [it] = traduzirDocumento(l, { sistemas: {} }).itens;
  assert.deepEqual([it.detalhes.sistema, it.altura, it.largura, it.detalhes.desempenador], ['Sem sistema', 2100, 1600, false]);
});

test('avulso e serralheria simples são traduzidos', () => {
  const l = vazio();
  l.lista.push(linha(1, { TIPO_PRODUTO: 'Perfil', PRODUTO: '', QTD: 2, UNITARIO: 300, TOTAL: 600 }),
    linha(2, { TIPO_PRODUTO: 'Metalons', PRODUTO: 'Grade', QTD: 1, UNITARIO: 45, TOTAL: 45 }));
  l.itensV4.push(cfg(1, 1, { TIPO_PRODUTO: 'Perfil', PORTA: '1', QTD: 2, ALTURA: 3000, LARGURA: 0, PERFIL: 'Perfil P', ACABAMENTO_PERFIL: null, COR_PERFIL: null, REVESTIMENTO: null, PUXADOR: null }));
  l.serralheria.push({ id: 1, TIPO: 'Pedido', NUMERO: 123, ITEM_PEDIDO: 2, ITEM: 1, QTD_ITENS: 1, PRODUTO: 'Grade', MATERIAL: 'Metalon 20', ACABAMENTO: '', COR: '',
    QTD_ALTURA: 1, ALTURA: 1000, QTD_LARGURA: 1, LARGURA: 500, QTD_PROFUNDIDADE: 1, PROFUNDIDADE: 0, QTD_SOLDAS: 2, UNITARIO: 45, TOTAL: 45, OBS: 'soldar' });
  const [a, s] = traduzirDocumento(l, { sistemas: {} }).itens;
  assert.deepEqual([a.frente, a.qtd, a.altura, a.detalhes.categoria, a.detalhes.avProduto, a.valor], ['Avulso', 2, 3000, 'Perfil', 'Perfil P', 300]);
  assert.deepEqual([s.frente, s.qtd, s.altura, s.largura, s.soldas, s.detalhes.produto, s.detalhes.material, s.obs], ['Serralheria', 1, 1000, 500, 2, 'Grade', 'Metalon 20', 'soldar']);
});

const motivo = (l, sistemas = {}) => { const [it] = traduzirDocumento(l, { sistemas }).itens; assert.equal(it.travado, true, 'devia travar'); return it.motivo; };

test('travas, cada uma com o motivo', () => {
  let l = vazio(); l.lista.push(linha(1, { TIPO_PRODUTO: 'Porta de passagem' }));
  assert.match(motivo(l), /só o VB edita/);
  l = vazio(); l.lista.push(linha(1));
  assert.match(motivo(l), /folhas gravadas/);
  l = giro4(); l.itensV4[1].PERFIL = 'Outro';
  assert.match(motivo(l), /diferentes/);
  l = giro4(); l.furacao[3].TAMANHO = 950;
  assert.match(motivo(l), /furos/);
  l = giro4(); l.itensV4[0].USINAGEM_PERFIL = 'Fresa';
  assert.match(motivo(l), /usinagem/);
  l = correr({}, { DESCRICAO: 'Tam: 2100x1600mm' });
  assert.match(motivo(l, { S1 }), /sistema/);
  l = correr();
  assert.match(motivo(l, {}), /sistema/); // S1 não está no cadastro
});

test('travado traz descrição, quantidade, valor e % para a lista', () => {
  const l = vazio(); l.lista.push(linha(1, { TIPO_PRODUTO: 'Porta de passagem', PORCENTAGEM: '+5', OBSERVACAO: 'x' }));
  const [it] = traduzirDocumento(l, { sistemas: {} }).itens;
  assert.deepEqual({ ...it, motivo: undefined }, { travado: true, motivo: undefined, frente: 'Porta de passagem', qtd: 4, descricao: 'Tipo de produto: Porta de giro\r\n',
    valor: 700, historico: '+5', obs: 'x', origem: { item: 1, estado: 'travado' } });
});

test('serralheria com várias peças no mesmo item vira a lista de peças (frmSerralheria.listaItens)', () => {
  const l = vazio();
  l.lista.push(linha(1, { TIPO_PRODUTO: 'Metalons', PRODUTO: 'Grade', QTD: 1 }));
  const s = { TIPO: 'Pedido', NUMERO: 123, ITEM_PEDIDO: 1, QTD_ITENS: 1, PRODUTO: 'Grade', ACABAMENTO: '', COR: '', QTD_ALTURA: 2, QTD_LARGURA: 3, QTD_PROFUNDIDADE: 1, PROFUNDIDADE: 0, OBS: '' };
  l.serralheria.push({ ...s, id: 2, ITEM: 2, MATERIAL: 'Cantoneira', ALTURA: 2000, LARGURA: 0, QTD_SOLDAS: 20 },
    { ...s, id: 1, ITEM: 1, MATERIAL: 'Metalon 20', ALTURA: 1000, LARGURA: 500, QTD_SOLDAS: 10 });
  const [it] = traduzirDocumento(l, { sistemas: {}, componentesSerr: {} }).itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual(it.pecas.map(p => [p.material, p.altura, p.largura, p.soldas, p.qtdAltura]), [['Metalon 20', 1000, 500, 10, 2], ['Cantoneira', 2000, 0, 20, 2]]);
  // a 1ª peça continua nos campos do item (compatibilidade)
  assert.deepEqual([it.altura, it.detalhes.material, it.detalhes.produto], [1000, 'Metalon 20', 'Grade']);
});

test('ida e volta: quantidade de puxador gravada diferente das posições trava', () => {
  const l = giro4(); l.itensV4[0].QTD_PUXADOR = 2; l.itensV4[1].QTD_PUXADOR = 2;
  assert.match(motivo(l), /não reproduz/);
});

test('impressão digital', () => {
  const a = giro4(), b = giro4();
  assert.match(impressaoDigital(a, 'Pedido'), /^[0-9a-f]{64}$/);
  assert.equal(impressaoDigital(a, 'Pedido'), impressaoDigital(b, 'Pedido'));
  b.itensV4[0] = Object.fromEntries(Object.entries(b.itensV4[0]).reverse()); // ordem das colunas não importa
  assert.equal(impressaoDigital(a, 'Pedido'), impressaoDigital(b, 'Pedido'));
  b.furacao[2].TAMANHO = 101;
  assert.notEqual(impressaoDigital(a, 'Pedido'), impressaoDigital(b, 'Pedido'));
  const c = giro4(); c.vidros.push({ id: 1, NUMERO: 123, MODELO: 'V' });
  assert.equal(impressaoDigital(giro4(), 'Orçamento'), impressaoDigital(c, 'Orçamento'));
  assert.notEqual(impressaoDigital(giro4(), 'Pedido'), impressaoDigital(c, 'Pedido'));
});

test('furos gravados fora de ordem pelo VB travam (a web regravaria em ordem)', () => {
  const l = giro4();
  l.furacao = [furo(1, 1, 1, 900, 'Esquerdo'), furo(2, 1, 2, 100, 'Esquerdo'), furo(3, 1, 1, 900, 'Direito'), furo(4, 1, 2, 100, 'Direito')];
  assert.match(motivo(l), /não reproduz/);
});

test('porta de correr de uma folha mais estreita que o vão: reabre com a largura própria da porta e o vão na tela', () => {
  const l = correr({ QTD: 1, LARGURA: 800, LARGURA_VAO: 1500 }, { DESCRICAO: 'Tam: 2100x1500mm | Per: Perfil P Anodizado | Sist: S1 | Pux:  | Rev:  | Portas: 1 | Furos: 0' });
  l.complementos = [{ id: 1, TIPO: 'Pedido', NUMERO: 123, ITEM_PEDIDO: 1, ITEM: 1, QTD: 1, COMPLEMENTO: 'Trilho Sup', TAMANHO: 1500, UNITARIO: 40 }];
  const [it] = traduzirDocumento(l, { sistemas: { S1 } }).itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual([it.qtd, it.largura, it.detalhes.largurasFolhas], [1, 1500, [800]]);
});
