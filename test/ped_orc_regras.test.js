const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc } = require('./apoio/bancoPedOrc');

// Livro de regras aplicado pelo servidor em POST /ped_orc/salvar (validar() em rotas/ped_orc.js).
const giro = (mudar = {}, detalhes = {}) => ({ frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, profundidade: 0, soldas: 0, obs: '',
  furos: { lista: [100, 900], lados: ['Esquerdo', 'Esquerdo'] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: 'Vidro V', corRevest: 'Incolor',
    divisor: '', divH: 0, divV: 0, posicoesFolhas: ['', ''], ...detalhes },
  acessorios: [{ nome: 'Fechadura', qtd: 1, origem: 'MANUAL' }], historico: '', valorTela: 705.08, ...mudar });
const corpo = (mudar = {}) => ({ modo: 'novo', tipo: 'Pedido', clienteCodigo: 7, clienteFinal: 'Fulano', obsGeral: '', descontoPct: 0,
  dataEntrega: '2026-11-05', situacao: 'Em Produção', financeiro: 'A Receber', itens: [giro()], ...mudar });
const salvar = (chamar, c) => chamar('/ped_orc/salvar', 'POST', c);

test('porta sem acabamento: 400 "Item 1: ..." e nada gravado', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro({}, { acabamento: '' })] }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^Item 1: /);
  assert.equal(banco.pedOrc.length, 0);
  assert.equal(banco.listaItens.length, 0);
});

test('o primeiro bloqueio é o do item certo (Item 2)', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro(), giro({}, { acabamento: '' })] }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^Item 2: /);
});

test('porta sem revestimento: sem confirmacoes 400; com o código 200', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro({}, { revestimento: '' })] }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^Item 1: confirmação pendente — /);
  const ok = await salvar(chamar, corpo({ itens: [giro({ confirmacoes: ['sem_revestimento'] }, { revestimento: '' })] }));
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
});

test('número decimal é recusado', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro({ altura: 2000.5 })] }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^Item 1: Altura: só números inteiros/);
});

test('porta com altura 250 (só avisa) é gravada', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro({ altura: 250 })] }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
});

test('documento sem itens: 400 com a mensagem de sempre', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [] }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'Favor inserir pelomenos 1 item no pedido!');
});

// pedido antigo: itens copiados do banco (intacto) nunca são revalidados, mesmo que o corpo viole regras
async function salvoEAberto(t) {
  const ctx = await prepararPedOrc(t);
  const { numero } = await (await salvar(ctx.chamar, corpo())).json();
  const aberto = await (await ctx.chamar(`/ped_orc/Pedido/${numero}`)).json();
  return { ...ctx, numero, aberto };
}
const TABELAS = ['pedOrc', 'listaItens', 'itensV4', 'vidros', 'perfis', 'furacao', 'complementos', 'serralheria', 'serralheriaComp'];
const semId = r => Object.fromEntries(Object.entries(r).filter(([k]) => !['id', 'ID', 'DATA'].includes(k)));
const foto = (banco, numero) => Object.fromEntries(TABELAS.map(t => [t, banco[t].filter(r => Number(r.NUMERO) === numero).map(semId)]));
const atualizar = (aberto, numero, itens) => corpo({ modo: 'atualizar', numero, impressao: aberto.impressao, itens });

test('pedido antigo: itens intactos que violariam as regras são aceitos (200)', async t => {
  const { banco, chamar, numero, aberto } = await salvoEAberto(t);
  const antes = foto(banco, numero);
  const origem = aberto.itens.map(i => i.origem);
  const itens = origem.map(o => ({ origem: { ...o, estado: 'intacto' }, frente: 'Porta de giro', altura: 1.5, detalhes: { perfil: 'X', acabamento: '' } }));
  const r = await salvar(chamar, atualizar(aberto, numero, itens));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(foto(banco, numero), antes, 'o item intacto continua igual ao do banco (nada vindo do corpo ruim)');
});

test('item editado que viola regra: 400', async t => {
  const { banco, chamar, numero, aberto } = await salvoEAberto(t);
  const antes = foto(banco, numero);
  const it = aberto.itens[0];
  const itens = [{ ...it, valorTela: it.valor, origem: { ...it.origem, estado: 'editado' }, altura: 1.5 }];
  const r = await salvar(chamar, atualizar(aberto, numero, itens));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^Item 1: Altura/);
  assert.deepEqual(foto(banco, numero), antes, 'recusado: o pedido existente ficou intacto');
});

// I3: a recusa ao SALVAR diz como resolver (abrir o item e clicar em Atualizar), no bloqueio e na confirmação pendente
test('mensagem ao salvar ensina a resolver: bloqueio e confirmação pendente terminam com "Para resolver, abra o item N (✏️) e clique em Atualizar."', async t => {
  const { chamar } = await prepararPedOrc(t);
  const b = await salvar(chamar, corpo({ itens: [giro(), giro({}, { acabamento: '' })] }));
  assert.equal(b.status, 400);
  assert.equal((await b.json()).error, 'Item 2: Escolha o acabamento do perfil. Para resolver, abra o item 2 (✏️) e clique em Atualizar.');
  const c = await salvar(chamar, corpo({ itens: [giro({}, { revestimento: '' })] }));
  assert.equal(c.status, 400);
  assert.equal((await c.json()).error,
    'Item 1: confirmação pendente — Sem revestimento escolhido. Inserir na lista mesmo assim? Para resolver, abra o item 1 (✏️) e clique em Atualizar.');
});

// M3: itens fora de array nunca viram 500, mesmo se o nível de itens_minimo mudar no livro
test('itens que não são lista: 400 com a mensagem de sempre, mesmo com itens_minimo rebaixado a "avisa"', async t => {
  const Regras = require('../calculo/regras_item');
  const regra = Regras.REGRAS.find(r => r.codigo === 'itens_minimo');
  const nivel = regra.nivel;
  regra.nivel = 'avisa';
  t.after(() => { regra.nivel = nivel; });
  const { chamar } = await prepararPedOrc(t);
  for (const itens of [{}, 'x', null]) {
    const r = await salvar(chamar, corpo({ itens }));
    assert.equal(r.status, 400, JSON.stringify(itens));
    assert.equal((await r.json()).error, 'Favor inserir pelomenos 1 item no pedido!');
  }
});

// C1/R8: a opção interna de virar_pedido (itens montados pelo servidor) nunca vem do corpo da requisição
test('campo "origemServidor" forjado no corpo NÃO libera o item das regras (400)', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const forjado = corpo({ origemServidor: true, itensDoServidor: [0], itens: [giro({ origemServidor: true }, { revestimento: '' })] });
  const r = await salvar(chamar, forjado);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^Item 1: confirmação pendente — /);
  assert.equal(banco.pedOrc.length, 0);
});

// C1/R9: orçamento aberto na tela, tipo trocado para Pedido e salvo ("converte"): os itens que vieram do banco sem edição
// são remontados pelo servidor a partir do orçamento gravado (conferido pela impressão digital) e não são revalidados.
async function orcamentoAberto(t, itens) {
  const ctx = await prepararPedOrc(t);
  const r = await salvar(ctx.chamar, corpo({ tipo: 'Orçamento', situacao: undefined, financeiro: undefined, itens }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const { numero } = await r.json();
  const aberto = await (await ctx.chamar(`/ped_orc/Orçamento/${numero}`)).json();
  return { ...ctx, numero, aberto };
}
const RegrasTela = require('../regras_tela');
// corpo do jeito que a tela monta (gravar() em orcamentos.html usa RegrasTela.origemNoCorpo)
const corpoConverte = (aberto, numero, itens) => corpo({ origemConversao: { tipo: 'Orçamento', numero, impressao: aberto.impressao },
  itens: itens.map(it => ({ ...it, valorTela: it.valor, confirmacoes: [], ...RegrasTela.origemNoCorpo(it, true) })) });

test('converte na tela: porta sem revestimento intacta do orçamento vira pedido (200) e os dados vêm do banco, não do corpo', async t => {
  const { banco, chamar, numero, aberto } = await orcamentoAberto(t, [giro({ confirmacoes: ['sem_revestimento'] }, { revestimento: '' })]);
  // o corpo tenta trocar a altura: o servidor ignora, porque o item intacto é remontado do orçamento gravado
  const itens = aberto.itens.map(it => ({ ...it, altura: 1234 }));
  const r = await salvar(chamar, corpoConverte(aberto, numero, itens));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const ped = banco.itensV4.filter(x => x.TIPO === 'Pedido');
  assert.ok(ped.length >= 1);
  assert.ok(ped.every(x => Number(x.ALTURA) === 2000), 'altura do orçamento gravado, não a do corpo');
  assert.ok(banco.perfis.length >= 1, 'pedido gerado do zero (perfis da produção)');
});

test('converte na tela: só a % e o valor (so_pct) vêm do corpo', async t => {
  const { banco, chamar, numero, aberto } = await orcamentoAberto(t, [giro({ confirmacoes: ['sem_revestimento'] }, { revestimento: '' })]);
  const itens = aberto.itens.map(it => ({ ...it, origem: { ...it.origem, estado: 'so_pct' }, historico: '+10', valor: 775.59 }));
  const r = await salvar(chamar, corpoConverte(aberto, numero, itens));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const l = banco.listaItens.find(x => x.TIPO === 'Pedido');
  assert.equal(l.PORCENTAGEM, '+10'); assert.equal(Number(l.UNITARIO), 775.59);
});

test('converte na tela: item EDITADO passa pelas regras (400 sem a confirmação) e orçamento alterado por outro = 409', async t => {
  const { banco, chamar, numero, aberto } = await orcamentoAberto(t, [giro({ confirmacoes: ['sem_revestimento'] }, { revestimento: '' })]);
  const editados = aberto.itens.map(it => ({ ...it, origem: { ...it.origem, estado: 'editado' } }));
  const r = await salvar(chamar, corpoConverte(aberto, numero, editados));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^Item 1: confirmação pendente — /);
  const mudou = await salvar(chamar, corpoConverte({ ...aberto, impressao: 'outra' }, numero, aberto.itens));
  assert.equal(mudou.status, 409);
  assert.equal((await mudou.json()).erro, 'alterado');
  // item de outro número / documento de origem com o mesmo tipo: recusado
  const fora = await salvar(chamar, corpoConverte(aberto, numero, aberto.itens.map(it => ({ ...it, origem: { item: 99, estado: 'intacto' } }))));
  assert.equal(fora.status, 400);
  const mesmoTipo = corpoConverte(aberto, numero, aberto.itens); mesmoTipo.origemConversao.tipo = 'Pedido';
  assert.equal((await salvar(chamar, mesmoTipo)).status, 400);
  assert.equal(banco.pedOrc.filter(p => p.TIPO === 'Pedido').length, 0);
});
