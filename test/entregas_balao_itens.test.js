// Balão (title) do calendário de Entregas: itens do pedido (mesmo formato do Calendário de pedidos), sem dinheiro, 1 consulta IN, falha não derruba a lista.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const E = require('../entregas.js');

const semear = banco => {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto' });
  banco.semear.pedido({ NUMERO: 502, SITUACAO: 'Pronto' });
  banco.semear.pedido({ NUMERO: 503, SITUACAO: 'Pronto' }); // sem itens
  banco.semear.item({ NUMERO: 501, ITEM: 1, TIPO_PRODUTO: 'Porta de giro', DESCRICAO: 'Tamanho: 2425x670 mm\nPerfil: 1036 (Anodizado Bronze)', QTD: 2 });
  banco.semear.item({ NUMERO: 501, ITEM: 2, TIPO_PRODUTO: 'Serviço', DESCRICAO: 'Instalação', QTD: 1 });
  banco.semear.item({ NUMERO: 502, ITEM: 1, TIPO_PRODUTO: 'Serviço', DESCRICAO: 'Frete', QTD: 1 });
  for (let i = 1; i <= 17; i++) banco.semear.item({ NUMERO: 504, ITEM: i, TIPO_PRODUTO: 'Serviço', DESCRICAO: 'Peça ' + i, QTD: 1 });
  banco.semear.pedido({ NUMERO: 504, SITUACAO: 'Pronto' });
};

test('GET /entregas traz itens/qtdItens por pedido, até 15, sem dinheiro, e pedido sem itens não ganha a seção', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  semear(banco);
  const { entregas } = await (await chamar('/entregas')).json();
  const por = n => entregas.find(e => e.numero === n);
  assert.deepEqual(por(501).itens, [{ qtd: 2, texto: 'Porta de giro 2425 × 670 – Perfil 1036 (Anodizado Bronze)' }, { qtd: 1, texto: 'Serviço: Instalação' }]);
  assert.equal(por(501).qtdItens, 2);
  assert.equal(por(504).itens.length, 15);
  assert.equal(por(504).qtdItens, 17);
  assert.equal(por(503).itens, undefined);
  assert.equal(por(503).qtdItens, undefined);
  assert.doesNotMatch(JSON.stringify(entregas), /UNITARIO|TOTAL|valor/i);
});

test('uma única consulta IN para todos os pedidos da lista (sem N+1)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  semear(banco);
  const r = await chamar('/entregas');
  assert.equal(r.status, 200);
  const itens = banco.f.chamadas.filter(c => /FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN/.test(c.sql) && /TIPO_PRODUTO/.test(c.sql));
  assert.equal(itens.length, 1);
  assert.deepEqual([...itens[0].params].sort(), [501, 502, 503, 504]);
});

test('falha na leitura dos itens só os omite: a lista continua 200', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  semear(banco);
  const exec = banco.f.execute;
  const pool = require('../index.js').pool;
  pool.execute = async (sql, params) => {
    if (/FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN/.test(sql) && /TIPO_PRODUTO/.test(sql)) throw new Error('banco caiu');
    return exec(sql, params);
  };
  const r = await chamar('/entregas');
  assert.equal(r.status, 200);
  const { entregas } = await r.json();
  assert.ok(entregas.length >= 3);
  assert.ok(entregas.every(e => e.itens === undefined));
});

test('textoItens (entregas_comum): linha em branco, "Itens:", bullets e "… e mais N itens"; vazio sem itens', () => {
  const C = require('../entregas_comum.js');
  assert.equal(C.textoItens({}), '');
  assert.equal(C.textoItens({ itens: [] }), '');
  assert.equal(C.textoItens({ itens: [{ qtd: 2, texto: 'Porta' }], qtdItens: 3 }), '\n\nItens:\n• 2× Porta\n… e mais 2 itens');
  assert.equal(C.textoItens({ itens: [{ qtd: 1, texto: 'A' }], qtdItens: 2 }), '\n\nItens:\n• 1× A\n… e mais 1 item');
});

test('o balão do calendário de Entregas acrescenta os itens ao texto atual e escapa', () => {
  const fs = require('node:fs');
  const js = fs.readFileSync(require('node:path').join(__dirname, '..', 'entregas.js'), 'utf8');
  assert.match(js, /rotuloTipo\(e\.tipo\)\)\}\$\{C\.textoItens\(e\)\}`\)\}"/);
  assert.equal(typeof E, 'object');
});
