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
