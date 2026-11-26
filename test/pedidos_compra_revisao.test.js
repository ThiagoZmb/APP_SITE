// Achados da revisão final: troca de fornecedor, abertura sobreposta de pedidos e consultas da sugestão em paralelo.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pedidos_compra.js');
const Situacoes = require('../situacoes.js');
const { carregarAnalises } = require('../rotas/estoque_analises');

const pausa = () => new Promise(r => setImmediate(r));
const assentar = async () => { for (let i = 0; i < 20; i++) await pausa(); };

// DOM mínimo: cada id vira um objeto que guarda valor, HTML e ouvintes
function tela(responder) {
  const elementos = new Map(), perguntas = [], pedidos = [];
  const el = () => {
    const ouvintes = {};
    return { value: '', innerHTML: '', textContent: '', hidden: false, ouvintes, add() {}, focus() {},
      addEventListener: (tipo, fn) => { ouvintes[tipo] = fn; }, setAttribute() {},
      querySelector: () => el() };
  };
  const doc = { getElementById: id => { if (!elementos.has(id)) elementos.set(id, el()); return elementos.get(id); }, createElement: el, body: { appendChild() {} }, addEventListener() {} };
  const win = {
    document: doc, Situacoes, Acesso: { pode: () => true }, resposta: false,
    confirm: t => { perguntas.push(t); return win.resposta; },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, Option: function () {},
    localStorage: { getItem: () => JSON.stringify({ token: 't', user: {}, exp: Date.now() + 1e6 }), removeItem() {} },
    location: {},
    fetch: async url => {
      const caminho = url.replace(/^https:\/\/[^/]+/, '');
      pedidos.push(caminho);
      const corpo = await responder(caminho);
      return { status: 200, ok: true, json: async () => corpo };
    }
  };
  P.iniciar(win);
  const $ = id => doc.getElementById(id);
  const abrir = numero => $('tb-lista').ouvintes.click({ target: { closest: () => ({ dataset: { numero: String(numero) } }) } });
  return { $, win, perguntas, pedidos, abrir };
}
const pedido = (numero, fornecedor, produto) => ({ numero, fornecedor, situacao: 'rascunho', observacao: 'obs ' + numero,
  itens: [{ codigo: numero, produto, unidade: 'un', qtd: 2, porCaixa: 1, chegou: 0, falta: 2 }] });
const padrao = caminho => caminho === '/pedidos_compra' ? []
  : caminho === '/pedidos_compra/fornecedores' ? [{ fornecedor: 'A', qtdSugeridos: 0 }, { fornecedor: 'B', qtdSugeridos: 0 }]
  : caminho === '/pedidos_compra/1' ? pedido(1, 'A', 'Produto do um')
  : caminho === '/pedidos_compra/2' ? pedido(2, 'B', 'Produto do dois')
  : caminho.startsWith('/pedidos_compra/produtos') ? []
  : { itens: [] };

test('trocar de fornecedor num rascunho salvo pergunta antes de descartar os itens', async () => {
  const { $, perguntas, pedidos, abrir } = tela(padrao);
  await assentar();
  abrir(1);
  await assentar();
  $('fornecedor').value = 'B';
  $('fornecedor').ouvintes.change();
  await assentar();
  assert.equal(perguntas.length, 1);
  assert.equal($('fornecedor').value, 'A', 'respondeu não: volta o fornecedor');
  assert.match($('tb-itens').innerHTML, /Produto do um/);
  assert.ok(!pedidos.some(p => p.endsWith('fornecedor=B')), 'nada do outro fornecedor foi carregado');
});

test('abrir dois pedidos depressa: vale o último, sem mistura', async () => {
  let soltar;
  const segura = new Promise(r => { soltar = r; });
  let vezes = 0;
  const { $, abrir } = tela(async caminho => {
    if (caminho === '/pedidos_compra/fornecedores' && ++vezes === 1) await segura;   // a lista do primeiro demora
    return padrao(caminho);
  });
  await assentar();
  abrir(1);
  await assentar();
  abrir(2);
  await assentar();
  soltar();
  await assentar();
  assert.equal($('fornecedor').value, 'B');
  assert.equal($('observacao').value, 'obs 2');
  assert.match($('tb-itens').innerHTML, /Produto do dois/);
  assert.ok(!$('tb-itens').innerHTML.includes('Produto do um'));
  assert.match($('titulo-form').textContent, /nº 2/);
});

test('as consultas das análises saem juntas', async () => {
  let abertas = 0, maximo = 0;
  const pool = { execute: async sql => {
    maximo = Math.max(maximo, ++abertas);
    await pausa();
    abertas--;
    return [/AS primeira/.test(sql) ? [{ primeira: null }] : [], []];
  } };
  await carregarAnalises(pool, { hoje: '2026-11-26', janela: 90, verValores: false });
  assert.equal(maximo, 6);
});

test('a tela mostra o código e a descrição do fornecedor; sem descrição, o nome da casa', async () => {
  const { $, abrir } = tela(caminho => caminho === '/pedidos_compra/1' ? { numero: 1, fornecedor: 'A', situacao: 'rascunho', observacao: '', itens: [
    { codigo: 71, produto: 'Casa um', codFornecedor: 'F-AAA', nomeFornecedor: 'DESCRICAO DO FORNECEDOR', unidade: 'un', qtd: 2, porCaixa: 1, chegou: 0, falta: 2 },
    { codigo: 72, produto: 'Casa dois', codFornecedor: '', nomeFornecedor: '', unidade: 'un', qtd: 2, porCaixa: 1, chegou: 0, falta: 2 }] }
    : caminho === '/pedidos_compra/2' ? { numero: 2, fornecedor: 'A', situacao: 'enviado', observacao: '', criadoEm: '2026-11-26', enviadoEm: null, itens: [
      { codigo: 73, produto: 'Casa tres', codFornecedor: 'F-CCC', nomeFornecedor: 'OUTRA DESCRICAO', unidade: 'un', qtd: 2, porCaixa: 1, chegou: 0, falta: 2 }] }
    : padrao(caminho));
  await assentar();
  abrir(1);
  await assentar();
  const form = $('tb-itens').innerHTML;
  for (const s of ['<td>F-AAA</td>', 'DESCRICAO DO FORNECEDOR', '<td>—</td>', 'Casa dois']) assert.ok(form.includes(s), s);
  assert.ok(!form.includes('Casa um') && !form.includes('<td>71</td>'));
  abrir(2);
  await assentar();
  const det = $('tb-detalhe').innerHTML;
  assert.ok(det.includes('<td>F-CCC</td><td>OUTRA DESCRICAO</td>'), det);
});

const doFornecedor = [
  { codigo: 5, produto: 'PERFIL 1036 BRONZE', codFornecedor: 'B-1', nomeFornecedor: 'ESTRUTURAL 1036 BZ', unidade: 'un', qtd: 40, porCaixa: 1, aCaminho: 12, pedidos: [3, 7], aguardando: false },
  { codigo: 6, produto: 'ROLDANA', codFornecedor: '', nomeFornecedor: 'ROLDANA DUPLA', unidade: 'un', qtd: 2, porCaixa: 50 }];
const sugestaoA = { itens: [{ codigo: 6, produto: 'ROLDANA', codFornecedor: '', nomeFornecedor: 'ROLDANA DUPLA', unidade: 'un', qtd: 2, minimo: 10,
  diasCobertura: 4, aCaminho: 0, porCaixa: 50, sugerido: 100, marcado: true, aviso: '' }] };

test('combo: todos os itens com os dois nomes, os que faltam primeiro; o escolhido sai da combo', () => {
  const nada = P.opcoesCombo(doFornecedor, sugestaoA.itens, [], null);
  assert.deepEqual(nada.map(o => [o.codigo, o.texto]), [[6, 'ROLDANA | ROLDANA DUPLA  [sugerido: 100 un]'], [5, 'PERFIL 1036 BRONZE | ESTRUTURAL 1036 BZ']]);
  assert.deepEqual(P.opcoesCombo(doFornecedor, sugestaoA.itens, [6], null).map(o => o.codigo), [5]);
  const rascunho = [{ ...sugestaoA.itens[0], marcado: false, aviso: 'em rascunho nº 3' }];
  assert.match(P.opcoesCombo(doFornecedor, rascunho, [], null).find(o => o.codigo === 6).texto, /\[em rascunho nº 3\]$/);
  assert.match(P.opcoesCombo(doFornecedor, rascunho, [], 3)[0].texto, /\[sugerido: 100 un\]$/, 'o próprio rascunho aberto não conta como aviso');
  const iguais = P.opcoesCombo([doFornecedor[0], { ...doFornecedor[0], codigo: 8 }], [], [], null);
  assert.equal(new Set(iguais.map(o => o.texto)).size, 2, 'textos repetidos ganham o código');
});

test('combo própria: dois nomes em colunas separadas; clicar adiciona, o ✕ devolve; teclado escolhe e Esc fecha', async () => {
  const { $, abrir } = tela(caminho => caminho.startsWith('/pedidos_compra/produtos') ? doFornecedor
    : caminho.startsWith('/pedidos_compra/sugestao') ? sugestaoA : padrao(caminho));
  await assentar();
  $('btn-novo').ouvintes.click();
  await assentar();
  $('fornecedor').value = 'A';
  $('fornecedor').ouvintes.change();
  await assentar();
  const lista = () => $('combo-lista').innerHTML;
  const tecla = key => $('busca-item').ouvintes.keydown({ key, preventDefault() {} });
  const digitar = v => { $('busca-item').value = v; $('busca-item').ouvintes.input(); };
  assert.ok(!$('tb-itens').innerHTML.includes('ROLDANA'), 'nada entra sozinho');
  assert.equal($('combo-lista').hidden, true);
  $('busca-item').ouvintes.click();
  assert.equal($('combo-lista').hidden, false);
  assert.match(lista(), /<span class="c-nome">ROLDANA<\/span><span class="c-forn">ROLDANA DUPLA<\/span><span class="c-qtd" data-rot="Estoque">2 un<\/span><span class="c-chegar" data-rot="A chegar">—<\/span><span class="c-nota">sugerido: 100 un<\/span>[\s\S]*<span class="c-nome">PERFIL 1036 BRONZE<\/span><span class="c-forn">ESTRUTURAL 1036 BZ<\/span><span class="c-qtd" data-rot="Estoque">40 un<\/span><span class="c-chegar" data-rot="A chegar">12 \(pedidos 3, 7\)<\/span>/);

  $('combo-lista').ouvintes.click({ target: { closest: () => ({ dataset: { i: '0' } }) } });
  assert.match($('tb-itens').innerHTML, /ROLDANA DUPLA/);
  assert.match($('tb-itens').innerHTML, /l-qtd[^>]*value="2"/);   // 100 un em caixas de 50
  assert.equal($('combo-lista').hidden, true);

  digitar('1036');
  assert.equal($('combo-lista').hidden, false);
  assert.match(lista(), /PERFIL 1036 BRONZE/);
  tecla('Escape');
  assert.equal($('combo-lista').hidden, true);
  assert.ok(!$('tb-itens').innerHTML.includes('1036'), 'Esc não adiciona');
  digitar('xyz');
  assert.match(lista(), /Nenhum item/);
  tecla('Enter');
  digitar('1036');
  tecla('Enter');
  assert.match($('tb-itens').innerHTML, /ESTRUTURAL 1036 BZ/);
  assert.equal($('busca-item').value, '');

  $('tb-itens').ouvintes.click({ target: { closest: sel => sel === '.l-tirar' ? { closest: () => ({ dataset: { k: '0' } }) } : null } });
  assert.ok(!$('tb-itens').innerHTML.includes('ROLDANA DUPLA'));
  digitar('roldana');
  tecla('ArrowDown');
  assert.match(lista(), /class="ativo"[^>]*>|aria-selected="true"/);
  tecla('Enter');
  assert.match($('tb-itens').innerHTML, /ROLDANA DUPLA/);
});

test('coluna "A chegar": um pedido, marca sem pedido na web e nada', () => {
  assert.equal(P.textoChegar({ aCaminho: 5, pedidos: [4], aguardando: false }), '5 (pedido 4)');
  assert.equal(P.textoChegar({ aCaminho: 0, pedidos: [], aguardando: true }), 'Aguardando (sem pedido aqui)');
  assert.equal(P.textoChegar({ aCaminho: 0, pedidos: [], aguardando: false }), '—');
});
