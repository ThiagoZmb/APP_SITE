const test = require('node:test');
const assert = require('node:assert/strict');
const { quantidadeSugerida, entraNaSugestao, montarSugestao, distribuirBaixa, situacaoPelaChegada, acaoPermitida, validarPedido } = require('../calculo/pedidos_compra');

const base = { qtd: 4, minimo: 10, consumoDia: 0, prazoDias: 15, diasDados: 90, aCaminho: 0, porCaixa: 1 };

test('quantidade sugerida', () => {
  assert.equal(quantidadeSugerida(base), 6);
  assert.equal(quantidadeSugerida({ ...base, consumoDia: 1 }), 41);          // 1 × 45 − 4
  assert.equal(quantidadeSugerida({ ...base, consumoDia: 1, diasDados: 10 }), 6);
  assert.equal(quantidadeSugerida({ ...base, porCaixa: 50 }), 50);
  assert.equal(quantidadeSugerida({ ...base, aCaminho: 6 }), null);
  assert.equal(quantidadeSugerida({ ...base, qtd: 10 }), null);              // no mínimo: entra na lista, campo vazio
  assert.equal(quantidadeSugerida({ ...base, qtd: 4.5 }), 6);                // 5,5 sobe para 6
});

test('quem entra', () => {
  assert.ok(entraNaSugestao({ qtd: 10, minimo: 10, alerta: 'ok', consumoAno: 0 }));
  assert.ok(entraNaSugestao({ qtd: 40, minimo: 0, alerta: 'comprar', consumoAno: 90 }));
  assert.ok(entraNaSugestao({ qtd: 0, minimo: 0, alerta: 'falta', consumoAno: 3 }));
  assert.ok(!entraNaSugestao({ qtd: 0, minimo: 0, alerta: 'falta', consumoAno: 0 }));
  assert.ok(!entraNaSugestao({ qtd: 11, minimo: 10, alerta: 'ok', consumoAno: 5 }));
});

test('montar a sugestão: inativo fora; rascunho e marca antiga vêm desmarcados com aviso', () => {
  const analise = [1, 2, 3, 4, 5].map(codigo => ({ codigo, produto: 'P' + codigo, unidade: 'un', qtd: 4, minimo: 10, consumoDia: 0,
    prazoDias: 15, diasCobertura: null, alerta: 'sem_consumo', consumoAno: 0 }));
  const produtos = new Map([[1, { situacao: 'Ativo', aguardando: '', codFornecedor: 'F-1', nomeFornecedor: 'NOME DO FORNECEDOR' }], [2, { situacao: 'Inativo', aguardando: '' }],
    [3, { situacao: 'Ativo', aguardando: 'Aguardando' }], [4, { situacao: 'Ativo', aguardando: '' }]]);   // o 5 é de outro fornecedor
  const itens = montarSugestao({ analise, diasDados: 90, produtos, aCaminho: new Map(), rascunhos: new Map([[4, 9]]), porCaixa: new Map([[1, 4]]) });
  const de = c => itens.find(i => i.codigo === c);
  assert.deepEqual(itens.map(i => i.codigo).sort(), [1, 3, 4]);
  assert.deepEqual(de(1), { codigo: 1, produto: 'P1', codFornecedor: 'F-1', nomeFornecedor: 'NOME DO FORNECEDOR', unidade: 'un', qtd: 4, minimo: 10, diasCobertura: null, aCaminho: 0, porCaixa: 4, sugerido: 8, marcado: true, aviso: '' });
  assert.equal(de(3).marcado, false); assert.equal(de(3).aviso, 'marcado como aguardando fora destes pedidos');
  assert.equal(de(4).marcado, false); assert.equal(de(4).aviso, 'em rascunho nº 9');
});

test('item com a necessidade coberta pelo que está a caminho aparece desmarcado', () => {
  const [i] = montarSugestao({ analise: [{ codigo: 1, produto: 'P', unidade: '', qtd: 4, minimo: 10, consumoDia: 0, prazoDias: 15, diasCobertura: null, alerta: 'sem_consumo', consumoAno: 0 }],
    diasDados: 90, produtos: new Map([[1, { situacao: 'Ativo', aguardando: 'Aguardando' }]]), aCaminho: new Map([[1, 50]]), rascunhos: new Map(), porCaixa: new Map() });
  assert.deepEqual([i.aCaminho, i.sugerido, i.marcado, i.aviso], [50, null, false, '']);
});

test('baixa: mais antigo primeiro, sobra ignorada', () => {
  const abertos = [{ itemId: 1, pedidoId: 1, produtoCodigo: 7, falta: 5 }, { itemId: 2, pedidoId: 2, produtoCodigo: 7, falta: 5 }];
  assert.deepEqual(distribuirBaixa(abertos, new Map([[7, 8]])).map(b => [b.itemId, b.qtd]), [[1, 5], [2, 3]]);
  const chegada = new Map([[7, 30]]);
  assert.deepEqual(distribuirBaixa(abertos, chegada).map(b => b.qtd), [5, 5]);
  assert.equal(abertos[0].falta, 5);
  assert.equal(chegada.get(7), 30);
  assert.deepEqual(distribuirBaixa(abertos, new Map([[8, 3]])), []);
});

test('situação pela chegada', () => {
  const s = (atual, ...chegou) => situacaoPelaChegada(atual, chegou.map(c => ({ qtd: 10, chegou: c })));
  assert.equal(s('enviado', 0, 0), 'enviado');
  assert.equal(s('enviado', 3, 0), 'parcial');
  assert.equal(s('parcial', 10, 12), 'recebido');
  assert.equal(s('recebido', 0, 0), 'enviado');          // desfazer a entrada
  for (const fixa of ['rascunho', 'encerrado', 'cancelado']) assert.equal(s(fixa, 10, 10), fixa);
});

test('ações permitidas', () => {
  assert.equal(acaoPermitida('enviar', 'rascunho', false), 'enviado');
  assert.equal(acaoPermitida('encerrar', 'enviado', false), 'encerrado');
  assert.equal(acaoPermitida('encerrar', 'parcial', true), 'encerrado');
  assert.equal(acaoPermitida('cancelar', 'enviado', false), 'cancelado');
  for (const [a, s, c] of [['enviar', 'enviado', false], ['cancelar', 'parcial', true], ['cancelar', 'enviado', true], ['cancelar', 'rascunho', false],
    ['encerrar', 'rascunho', false], ['encerrar', 'recebido', true], ['encerrar', 'cancelado', false], ['apagar', 'enviado', false], ['toString', 'enviado', false]]) {
    assert.equal(acaoPermitida(a, s, c), null, `${a} em ${s}`);
  }
});

test('validar pedido', () => {
  const corpo = (mudar = {}) => ({ fornecedor: ' FORN ', observacao: ' ok ', itens: [{ produtoCodigo: 1, quantidade: 2, porCaixa: 50 }], ...mudar });
  assert.deepEqual(validarPedido(corpo()), { fornecedor: 'FORN', observacao: 'ok', itens: [{ produtoCodigo: 1, qtd: 100, porCaixa: 50 }] });
  assert.deepEqual(validarPedido(corpo({ itens: [{ produtoCodigo: 1, quantidade: 3 }] })).itens, [{ produtoCodigo: 1, qtd: 3, porCaixa: 1 }]);
  const item = i => corpo({ itens: [{ produtoCodigo: 1, quantidade: 1, porCaixa: 1, ...i }] });
  for (const ruim of [corpo({ fornecedor: '  ' }), corpo({ itens: [] }), corpo({ itens: 'x' }), corpo({ itens: Array(301).fill(0).map((_, k) => ({ produtoCodigo: k + 1, quantidade: 1 })) }),
    item({ quantidade: 0 }), item({ quantidade: 1.5 }), item({ quantidade: '2' }), item({ porCaixa: 0 }), item({ porCaixa: 100001 }), item({ quantidade: 100000, porCaixa: 100 }),
    item({ produtoCodigo: 0 }), corpo({ itens: [{ produtoCodigo: 1, quantidade: 1 }, { produtoCodigo: 1, quantidade: 2 }] }), undefined]) {
    assert.equal(typeof validarPedido(ruim).erro, 'string', JSON.stringify(ruim)?.slice(0, 80));
  }
});

test('último preço: prefere o fornecedor escolhido, senão a compra mais recente; zero é ignorado; sem compra não aparece', () => {
  const { ultimosPrecos } = require('../calculo/pedidos_compra');
  const produtos = ['Pérfil A', 'Perfil B', 'Perfil C', 'Perfil D', 'Sem compra'].map((produto, i) => ({ codigo: i + 1, produto }));
  const compra = (NOME_PRODUTO, DATA, FABRICANTE, VALOR_UNITARIO) => ({ NOME_PRODUTO, DATA, FABRICANTE, VALOR_UNITARIO });
  // já na ordem DATA, id (como a consulta devolve)
  const compras = [
    compra('PERFIL A', '2026-01-10', 'forn x  ', '10.50'),   // mesmo fornecedor (caixa e espaço no fim) e nome sem acento
    compra('Perfil B', '2026-02-01', 'Outro', 7),
    compra('Perfil C', '2026-02-02', 'FORN X', 0),
    compra('Perfil B', '2026-03-01', 'Mais um', 8),
    compra('Pérfil A', '2026-04-01', 'Outro', 99),
    compra('Perfil C', '2026-04-02', 'Outro', 3),
    compra('Perfil D', '2026-05-01', 'FORN X', -1)
  ];
  assert.deepEqual(ultimosPrecos(produtos, compras, 'FORN X'), [
    { codigo: 1, precoUnitario: 10.5, data: '2026-01-10' },
    { codigo: 2, precoUnitario: 8, data: '2026-03-01' },
    { codigo: 3, precoUnitario: 3, data: '2026-04-02' }
  ]);
});
