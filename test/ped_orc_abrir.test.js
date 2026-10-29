const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');

// mesmo item da parte 1: Perfil P + Vidro V, 2 folhas 2000×500, 2 furos, Fechadura → 705,08
const giro = (mudar = {}) => ({ frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, profundidade: 0, soldas: 0, obs: '',
  furos: { lista: [100, 900], lados: ['Esquerdo', 'Esquerdo'] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: 'Vidro V', corRevest: 'Incolor',
    divisor: '', divH: 0, divV: 0, posicoesFolhas: ['', ''] },
  acessorios: [{ nome: 'Fechadura', qtd: 1, origem: 'MANUAL' }], historico: '', valorTela: 705.08, ...mudar });
const corpo = (mudar = {}) => ({ modo: 'novo', tipo: 'Pedido', clienteCodigo: 7, clienteFinal: 'Fulano', obsGeral: 'obs', descontoPct: 0,
  dataEntrega: '2026-11-05', situacao: 'Em Produção', financeiro: 'A Receber', itens: [giro()], ...mudar });
const salvar = (chamar, c) => chamar('/ped_orc/salvar', 'POST', c);
const abrir = (chamar, tipo, n) => chamar(`/ped_orc/${encodeURIComponent(tipo)}/${n}`);

test('abrir documento salvo pela web: cabeçalho, itens traduzidos e impressão digital', async t => {
  const { chamar } = await prepararPedOrc(t);
  const { numero } = await (await salvar(chamar, corpo())).json();
  const r = await abrir(chamar, 'Pedido', numero);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.cabecalho.tipo, j.cabecalho.numero, j.cabecalho.razaoSocial, j.cabecalho.clienteCodigo, j.cabecalho.dataEntrega],
    ['Pedido', numero, 'CLIENTE TESTE', 7, '2026-11-05']);
  assert.match(j.impressao, /^[0-9a-f]{64}$/);
  assert.equal(j.podeEditar, true);
  const [it] = j.itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual([it.frente, it.qtd, it.valor, it.origem.estado], ['Porta de giro', 2, 705.08, 'intacto']);
  assert.deepEqual(it.acessorios, [{ nome: 'Fechadura', qtd: 1, tamanho: 0, origem: 'MANUAL' }]);
});

test('abrir: 404 com a mensagem; tipo inválido 400', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await abrir(chamar, 'Pedido', 999);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'Pedido nº 999 não encontrado.');
  assert.equal((await abrir(chamar, 'Outro', 1)).status, 400);
});

test('Vendedor abre pedido só para ver; orçamento pode editar', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ id: 1, TIPO: 'Pedido', NUMERO: 5, RAZAO_SOCIAL: 'CLIENTE TESTE' }, { id: 2, TIPO: 'Orçamento', NUMERO: 6, RAZAO_SOCIAL: 'CLIENTE TESTE' });
  const { chamar } = await prepararPedOrc(t, { perfil: 'Vendedor', banco });
  assert.equal((await (await abrir(chamar, 'Pedido', 5)).json()).podeEditar, false);
  assert.equal((await (await abrir(chamar, 'Orçamento', 6)).json()).podeEditar, true);
});

test('representante: outra região dá 403 ao abrir, some da busca e não salva', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ id: 1, TIPO: 'Pedido', NUMERO: 5, RAZAO_SOCIAL: 'CLIENTE TESTE', TOTAL: 10 }, { id: 2, TIPO: 'Pedido', NUMERO: 6, RAZAO_SOCIAL: 'LOJA PAULISTA', TOTAL: 20 });
  const { chamar } = await prepararPedOrc(t, { perfil: 'Representante SP', banco });
  const r = await abrir(chamar, 'Pedido', 5);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'Sem acesso a este documento.');
  assert.equal((await abrir(chamar, 'Pedido', 6)).status, 200);
  const busca = await (await chamar('/ped_orc/buscar?tipo=Pedido&q=')).json();
  assert.deepEqual(busca.map(b => b.numero), [6]);
  const s = await salvar(chamar, corpo()); // cliente 7 é RJ
  assert.equal(s.status, 403);
  assert.equal(banco.pedOrc.length, 2);
});

test('buscar por número exato e por parte do cliente, no máximo 20, mais recentes primeiro', async t => {
  const banco = bancoPedOrc();
  for (let n = 1; n <= 25; n++) banco.pedOrc.push({ id: n, TIPO: 'Orçamento', NUMERO: n, RAZAO_SOCIAL: n % 2 ? 'CLIENTE TESTE' : 'LOJA PAULISTA', TOTAL: n });
  const { chamar } = await prepararPedOrc(t, { banco });
  const porNumero = await (await chamar('/ped_orc/buscar?tipo=Or%C3%A7amento&q=7')).json();
  assert.deepEqual(porNumero.map(b => b.numero), [7]);
  const porCliente = await (await chamar('/ped_orc/buscar?tipo=Or%C3%A7amento&q=paulista')).json();
  assert.deepEqual(porCliente.map(b => b.numero).slice(0, 3), [24, 22, 20]);
  assert.ok(porCliente.every(b => b.cliente === 'LOJA PAULISTA'));
  const todos = await (await chamar('/ped_orc/buscar?tipo=Or%C3%A7amento&q=')).json();
  assert.equal(todos.length, 20);
  assert.equal(todos[0].numero, 25);
});

// ---------- salvar documento aberto (Task 3) ----------
const correr = { frente: 'Porta de Correr', qtd: 2, altura: 2100, largura: 1600, obs: '', furos: { lista: [], lados: [] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: '', sistema: 'S1', transpasse: '50', desempenador: false, posicoesFolhas: ['', ''] },
  acessorios: [], historico: '', valorTela: 671 };
const avulso = { frente: 'Avulso', qtd: 2, altura: 3000, largura: 0, obs: '', furos: { lista: [], lados: [] },
  detalhes: { categoria: 'Perfil', avProduto: 'Perfil P', avAcab: '', avCor: '' }, acessorios: [], historico: '', valorTela: 300 };
const TABELAS = ['pedOrc', 'listaItens', 'itensV4', 'vidros', 'perfis', 'furacao', 'complementos', 'serralheria', 'serralheriaComp'];
const semId = r => Object.fromEntries(Object.entries(r).filter(([k]) => !['id', 'ID', 'DATA'].includes(k)));
const foto = (banco, numero) => Object.fromEntries(TABELAS.map(t => [t, banco[t].filter(r => Number(r.NUMERO) === numero).map(semId)]));
const comoTela = j => j.itens.map(it => ({ ...it, valorTela: it.valor }));
async function salvoEAberto(t, { tipo = 'Pedido', itens = [giro(), correr, avulso], banco = bancoPedOrc() } = {}) {
  const { chamar } = await prepararPedOrc(t, { banco });
  const extra = tipo === 'Pedido' ? {} : { dataEntrega: undefined, situacao: undefined, financeiro: undefined };
  const { numero } = await (await salvar(chamar, corpo({ tipo, itens, ...extra }))).json();
  const aberto = await (await abrir(chamar, tipo, numero)).json();
  return { banco, chamar, numero, aberto };
}
const atualizar = (aberto, mudar = {}) => corpo({ modo: 'atualizar', numero: aberto.cabecalho.numero, impressao: aberto.impressao, manterData: true, itens: comoTela(aberto), ...mudar });

test('ida e volta: abrir e salvar sem mexer deixa todas as linhas iguais', async t => {
  const { banco, chamar, numero, aberto } = await salvoEAberto(t);
  assert.ok(aberto.itens.every(i => !i.travado), JSON.stringify(aberto.itens.map(i => i.motivo)));
  const antes = foto(banco, numero);
  const r = await salvar(chamar, atualizar(aberto));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(foto(banco, numero), antes);
});

test('item travado é preservado e renumerado quando o item de cima é excluído', async t => {
  const { banco, chamar, numero } = await salvoEAberto(t, { itens: [giro()] });
  const p = { TIPO: 'Pedido', NUMERO: numero };
  banco.listaItens.push({ id: 900, ...p, ITEM: 2, TIPO_PRODUTO: 'Porta de passagem', PRODUTO: 'Porta de passagem', QTD: 1, DESCRICAO: 'passagem', UNITARIO: 900, TOTAL: 900, OBSERVACAO: null, PORCENTAGEM: '' });
  banco.itensV4.push({ ID: 901, ...p, TIPO_PRODUTO: 'Porta de passagem', ITEM_PEDIDO: 2, ITEM: 1, PORTA: 'Folha 1', QTD: 1, ALTURA: 2100, LARGURA: 800, PERFIL: 'Perfil P', UNITARIO: 900, TOTAL: 900 });
  banco.furacao.push({ id: 902, ...p, ITEM: 2, FURO: '1', LADO: 'Direito', TAMANHO: 150 });
  banco.vidros.push({ id: 903, MEDICAO: 'Vão', ITEM: 2, NUMERO: numero, QTD: 1, MODELO: 'Vidro V', TAMANHO: '2060x760', M2: 1.57 });
  const aberto = await (await abrir(chamar, 'Pedido', numero)).json();
  assert.equal(aberto.itens[1].travado, true);
  const r = await salvar(chamar, atualizar(aberto, { itens: [comoTela(aberto)[1]] })); // exclui o item 1
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const f = foto(banco, numero);
  assert.deepEqual(f.listaItens.map(l => [l.ITEM, l.TIPO_PRODUTO, l.UNITARIO]), [[1, 'Porta de passagem', 900]]);
  assert.deepEqual(f.itensV4.map(l => [l.ITEM_PEDIDO, l.TIPO_PRODUTO, l.ALTURA]), [[1, 'Porta de passagem', 2100]]);
  assert.deepEqual(f.furacao.map(l => [l.ITEM, l.LADO, l.TAMANHO]), [[1, 'Direito', 150]]);
  assert.deepEqual(f.vidros.map(l => [l.ITEM, l.TAMANHO]), [[1, '2060x760']]);
  assert.deepEqual([f.pedOrc[0].SUB_TOTAL, f.pedOrc[0].TOTAL], [900, 900]);
});

test('só %: nova porcentagem sobre o valor original salvo, sem conferir o cadastro', async t => {
  const { banco, chamar, numero, aberto } = await salvoEAberto(t, { itens: [giro()] });
  banco.produtos.find(p => p.MODELO === 'Perfil P').VALOR_FIXO = 999; // cadastro mudou depois
  const itens = comoTela(aberto);
  itens[0] = { ...itens[0], historico: '+10', valorTela: 775.59, origem: { ...itens[0].origem, estado: 'so_pct' } };
  const r = await salvar(chamar, atualizar(aberto, { itens }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const f = foto(banco, numero);
  assert.deepEqual([f.listaItens[0].PORCENTAGEM, f.listaItens[0].UNITARIO, f.listaItens[0].TOTAL], ['+10', 775.59, 1551.18]);
  assert.deepEqual([f.itensV4[0].UNITARIO, f.itensV4[0].TOTAL], [775.59, 1551.18]);
  assert.equal(f.pedOrc[0].TOTAL, 1551.18);
});

test('editado é recalculado com o cadastro de hoje', async t => {
  const { banco, chamar, aberto } = await salvoEAberto(t, { itens: [giro()] });
  banco.produtos.find(p => p.MODELO === 'Perfil P').VALOR_FIXO = 200;
  const itens = comoTela(aberto);
  itens[0] = { ...itens[0], origem: { ...itens[0].origem, estado: 'editado' } };
  const r = await salvar(chamar, atualizar(aberto, { itens }));
  assert.equal(r.status, 200); // a tela ainda mostra o preço antigo: salva com o de hoje e só avisa
  assert.deepEqual((await r.json()).avisos, { precoMudou: [1] });
});

test('salvar com novo número a partir de um aberto: cópia nova, original intacto', async t => {
  const { banco, chamar, numero, aberto } = await salvoEAberto(t);
  const antes = foto(banco, numero);
  const r = await salvar(chamar, corpo({ modo: 'novo', origemDocumento: { tipo: 'Pedido', numero }, impressao: aberto.impressao, itens: comoTela(aberto) }));
  const j = await r.json();
  assert.equal(j.numero, numero + 1);
  assert.deepEqual(foto(banco, numero), antes);
  const copia = foto(banco, numero + 1);
  for (const t of ['listaItens', 'itensV4', 'vidros', 'perfis', 'furacao', 'complementos'])
    assert.deepEqual(copia[t].map(r => ({ ...r, NUMERO: 0 })), antes[t].map(r => ({ ...r, NUMERO: 0 })), t);
});

test('alterado por outra pessoa: 409 e nada gravado', async t => {
  const { banco, chamar, numero, aberto } = await salvoEAberto(t);
  banco.listaItens.find(l => l.NUMERO === numero).OBSERVACAO = 'mudou no VB';
  const antes = foto(banco, numero);
  const r = await salvar(chamar, atualizar(aberto));
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.deepEqual([j.erro, j.error], ['alterado', 'Este documento foi alterado por outra pessoa desde que você abriu. Recarregue para ver a versão atual.']);
  assert.deepEqual(foto(banco, numero), antes);
});

test('origem.item que não é do documento: 400', async t => {
  const { chamar, aberto } = await salvoEAberto(t, { itens: [giro()] });
  const itens = comoTela(aberto);
  itens[0] = { ...itens[0], origem: { item: 77, estado: 'intacto' } };
  assert.equal((await salvar(chamar, atualizar(aberto, { itens }))).status, 400);
});

test('manter a data salva ou trocar para agora', async t => {
  const { banco, chamar, numero, aberto } = await salvoEAberto(t, { itens: [giro()] });
  const cab = () => banco.pedOrc.find(p => p.NUMERO === numero);
  cab().DATA = '2026-01-02 10:00:00';
  const reaberto = await (await abrir(chamar, 'Pedido', numero)).json();
  assert.equal((await salvar(chamar, atualizar(reaberto, { manterData: true }))).status, 200);
  assert.equal(cab().DATA, '2026-01-02 10:00:00');
  const de_novo = await (await abrir(chamar, 'Pedido', numero)).json();
  assert.equal((await salvar(chamar, atualizar(de_novo, { manterData: false }))).status, 200);
  assert.notEqual(cab().DATA, '2026-01-02 10:00:00');
  void aberto;
});

test('representante não copia itens de um documento de outra região (origem forjada)', async t => {
  const banco = bancoPedOrc();
  const { numero } = await (await (await prepararPedOrc(t, { banco })).chamar('/ped_orc/salvar', 'POST', corpo())).json(); // pedido do cliente RJ
  const aberto = await (await (await prepararPedOrc(t, { banco })).chamar(`/ped_orc/Pedido/${numero}`)).json();
  const { chamar } = await prepararPedOrc(t, { perfil: 'Representante SP', banco });
  const r = await chamar('/ped_orc/salvar', 'POST', corpo({ clienteCodigo: 8, origemDocumento: { tipo: 'Pedido', numero }, impressao: aberto.impressao,
    itens: aberto.itens.map(it => ({ ...it, valorTela: it.valor })) }));
  assert.equal(r.status, 403);
  assert.equal(banco.pedOrc.length, 1);
});

test('buscar devolve clienteFinal, sem total, e acha pelo cliente final', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ id: 1, TIPO: 'Pedido', NUMERO: 1, RAZAO_SOCIAL: 'CLIENTE TESTE', CLIENTE_FINAL: 'Maria Souza', TOTAL: 10 },
    { id: 2, TIPO: 'Pedido', NUMERO: 2, RAZAO_SOCIAL: 'LOJA PAULISTA', CLIENTE_FINAL: null, TOTAL: 20 });
  const { chamar } = await prepararPedOrc(t, { banco });
  const achados = await (await chamar('/ped_orc/buscar?tipo=Pedido&q=souza')).json();
  assert.deepEqual(achados.map(b => b.numero), [1]);
  assert.equal(achados[0].clienteFinal, 'Maria Souza');
  assert.ok(!('total' in achados[0]));
  const todos = await (await chamar('/ped_orc/buscar?tipo=Pedido&q=')).json();
  assert.equal(todos.find(b => b.numero === 2).clienteFinal, null);
});

test('tela: lista do diálogo Abrir mostra cliente final e não mostra valor', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'orcamentos.html'), 'utf8');
  const i = html.indexOf('async function buscarParaAbrir');
  const trecho = html.slice(i, html.indexOf('function abrirJanelaAbrir', i));
  assert.match(trecho, /Cliente final: ' \+ escapeHtml\(d\.clienteFinal\)/);
  assert.doesNotMatch(trecho, /formatCurrency|\.total/);
  assert.match(html, /placeholder="Número, cliente ou cliente final"/);
});
