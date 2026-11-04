const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc } = require('./apoio/bancoPedOrc');

// Item gravado pela web (giro, 3 folhas, 1 puxador lateral, 4 furos por folha, cor do vidro vazia) precisa voltar editável.
const FUROS = [100, 700, 1300, 1900];
const item = (posicoesFolhas, lados) => ({ frente: 'Porta de giro', qtd: 3, altura: 2234, largura: 545, profundidade: 0, soldas: 0, obs: 'Ver furação',
  furos: { lista: FUROS, lados },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Inox Escovado', puxador: 'Puxador X', tipoPuxador: 'Sobreposto', acabPux: 'Anodizado', corPux: 'Inox Escovado',
    tamanhoPux: '150', posicao: posicoesFolhas[0], posicoesFolhas, revestimento: 'Vidro V', corRevest: '', divisor: '', divH: 0, divV: 0 },
  acessorios: [], historico: '', valorTela: 1000 });
const corpo = (tipo, itens) => ({ modo: 'novo', tipo, clienteCodigo: 7, clienteFinal: 'F', obsGeral: '', descontoPct: 0, itens,
  ...(tipo === 'Pedido' ? { dataEntrega: '2026-11-05', situacao: 'Em Produção', financeiro: 'A Receber' } : {}) });

const D = 'Lateral Direita Centro', E = 'Lateral Esquerda Centro';
for (const [nome, pos, lados] of [
  ['3 folhas iguais (D,D,D)', [D, D, D], ['Esquerdo', 'Esquerdo', 'Esquerdo']],
  ['folhas alternadas (D,E,D) como a tela gera', [D, E, D], ['Direito', 'Esquerdo', 'Direito']],
  ['folhas alternadas, furos sempre do mesmo lado', [D, E, D], ['Esquerdo', 'Esquerdo', 'Esquerdo']]
]) {
  test(`web grava, reabre editável e converte em Pedido: ${nome}`, async t => {
    const { chamar } = await prepararPedOrc(t);
    const r = await chamar('/ped_orc/salvar', 'POST', corpo('Orçamento', [item(pos, lados)]));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const { numero } = await r.json();
    const aberto = await (await chamar(`/ped_orc/${encodeURIComponent('Orçamento')}/${numero}`)).json();
    assert.equal(aberto.itens[0].travado, undefined, aberto.itens[0].motivo);
    const itens = aberto.itens.map(({ origem, ...i }) => ({ ...i, valorTela: i.valor }));
    const p = await chamar('/ped_orc/salvar', 'POST', { ...corpo('Pedido', itens), modo: 'novo' });
    assert.equal(p.status, 200, JSON.stringify(await p.clone().json()));
  });
}

test('furos decimais que viram o mesmo inteiro ao gravar não travam o item', async t => {
  const { chamar } = await prepararPedOrc(t);
  const it = item([D, D, D], ['Esquerdo', 'Esquerdo', 'Esquerdo']);
  it.furos.lista = [100.4, 100.2, 700.5, 1300, 1900];
  const r = await chamar('/ped_orc/salvar', 'POST', corpo('Orçamento', [it]));
  const { numero } = await r.json();
  const aberto = await (await chamar(`/ped_orc/${encodeURIComponent('Orçamento')}/${numero}`)).json();
  assert.equal(aberto.itens[0].travado, undefined, aberto.itens[0].motivo);
});

// ------------------------------------------------------------------------------------------------
// Caso do dono: Porta de giro, 3 un, 2234x545, perfil 3345 (Anodizado Inox Escovado, sem cor), puxador 2018 E (Anodizado Inox Escovado,
// Lateral Direita Centro, 150 mm), vidro "Incolor 4mm" sem cor, 4 furos por folha, obs "Ver furação". Varia o que a tela pode mandar.
// Cada variação é lida de duas formas: pela rota (banco falso) e traduzida com os valores como o MySQL devolve (inteiros, NULL no lugar de '').
// ------------------------------------------------------------------------------------------------
const { traduzirDocumento } = require('../calculo/leitura_vb');
const { bancoPedOrc } = require('./apoio/bancoPedOrc');

const produtoFalso = (MODELO, VALOR_FIXO, DESCONTO_VIDRO = 0, DESC_PERF_PUX = 0, TIPO_PUXADOR = '') => ({ MODELO, VALOR_FIXO, DESCONTO_VIDRO, DESC_PERF_PUX, TIPO_PUXADOR, SITUACAO: 'Ativo' });
const L = 'Lateral Direita Centro', LE = 'Lateral Esquerda Centro';
function itemDoDono(mudar = {}, detalhes = {}) {
  return { frente: 'Porta de giro', qtd: 3, altura: 2234, largura: 545, profundidade: 0, soldas: 0, obs: 'Ver furação',
    furos: { lista: [100, 700, 1300, 1900], lados: ['Direito', 'Direito', 'Direito'], referenciaInvertida: false },
    detalhes: { perfil: '3345', acabamento: 'Anodizado Inox Escovado', cor: '', puxador: '2018 E', tipoPuxador: 'Sobreposto', tipoPuxadorNativo: 'Sobreposto',
      posicao: L, posicoesFolhas: [L, L, L],
      acabPux: 'Anodizado Inox Escovado', corPux: '', tamanhoPux: '150', revestimento: 'Incolor 4mm', corRevest: '', divisor: '', divH: 0, divV: 0,
      pares: false, todaExt: false, sistema: '', transpasse: '', largurasFolhas: [], desempenador: false, produto: '', material: '', acabSerr: '', corSerr: '',
      categoria: '', avProduto: '', avAcab: '', avCor: '', ...detalhes },
    acessorios: [], historico: '', valorTela: 1000, ...mudar };
}
// o que o MySQL devolve: inteiros nas colunas inteiras e NULL no lugar de texto vazio
const INTEIROS = ['ALTURA', 'LARGURA', 'ALTURA_VAO', 'LARGURA_VAO', 'TAM_PUXADOR', 'QTD', 'QTD_PUXADOR', 'QTD_HORIZONTAL', 'QTD_VERTICAL', 'TAMANHO', 'FURO'];
const comoMySQL = rows => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k,
  INTEIROS.includes(k) && v !== null ? Math.round(Number(v)) : v === '' ? null : v])));

async function gravarELer(t, it) {
  const banco = bancoPedOrc();
  for (const p of [produtoFalso('3345', 100, 20), produtoFalso('2018 E', 50, 10, 30, 'Sobreposto'), produtoFalso('Incolor 4mm', 200)]) banco.produtos.push(p);
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar('/ped_orc/salvar', 'POST', corpo('Orçamento', [it]));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const { numero } = await r.json();
  const aberto = await (await chamar(`/ped_orc/${encodeURIComponent('Orçamento')}/${numero}`)).json();
  const linhas = { cab: banco.pedOrc.find(p => p.NUMERO === numero), lista: banco.listaItens, itensV4: comoMySQL(banco.itensV4), complementos: banco.complementos,
    furacao: comoMySQL(banco.furacao), serralheria: [], serralheriaComp: [] };
  return { aberto: aberto.itens[0], mysql: traduzirDocumento(linhas).itens[0] };
}

const FUROS4 = lados => ({ lista: [100, 700, 1300, 1900], lados });
const VARIACOES = [
  ['caso do dono, 3 folhas iguais', {}, {}],
  ['perfil e puxador com espaços nas pontas', {}, { perfil: ' 3345 ', puxador: ' 2018 E ' }],
  ['acabamento + cor separados', {}, { acabamento: 'Anodizado', cor: 'Inox Escovado', acabPux: 'Anodizado', corPux: 'Inox Escovado' }],
  ['tamanho do puxador com vírgula', {}, { tamanhoPux: '150,0' }],
  ['tamanho do puxador decimal 150,4', {}, { tamanhoPux: '150,4' }],
  ['altura e largura decimais', { altura: 2234.4, largura: 544.6 }, {}],
  ['altura e largura como texto', { altura: '2234', largura: '545' }, {}],
  ['qtd como texto', { qtd: '3' }, {}],
  ['posições D,E,D e furos do lado oposto', { furos: FUROS4(['Esquerdo', 'Direito', 'Esquerdo']) }, { posicoesFolhas: [L, LE, L] }],
  ['posições D,D,E', { furos: FUROS4(['Esquerdo', 'Esquerdo', 'Direito']) }, { posicoesFolhas: [L, L, LE] }],
  ['posições E,D,D', { furos: FUROS4(['Direito', 'Esquerdo', 'Esquerdo']) }, { posicoesFolhas: [LE, L, L] }],
  ['uma só posição para 3 folhas', {}, { posicoesFolhas: [L] }],
  ['posicoesFolhas maior que a quantidade', {}, { posicoesFolhas: [L, L, L, LE] }],
  ['sem posicoesFolhas (só posicao)', {}, { posicoesFolhas: null }],
  ['lados com uma só entrada', { furos: FUROS4(['Direito']) }, {}],
  ['lados vazios', { furos: FUROS4([]) }, {}],
  ['furos fora de ordem e repetidos', { furos: { lista: [1900, 100, 700, 100, 1300], lados: ['Direito', 'Direito', 'Direito'] } }, {}],
  ['furos como texto', { furos: { lista: ['100', '700', '1300', '1900'], lados: ['Direito', 'Direito', 'Direito'] } }, {}],
  ['furos decimais', { furos: { lista: [100.5, 700.5, 1300.4, 1900.6], lados: ['Direito', 'Direito', 'Direito'] } }, {}],
  ['furos com zero e negativo', { furos: { lista: [0, 100, -5, 700, 1300, 1900], lados: ['Direito', 'Direito', 'Direito'] } }, {}],
  ['sem furos', { furos: { lista: [], lados: [] } }, {}],
  ['qtd 1', { qtd: 1 }, { posicoesFolhas: [L] }],
  ['qtd 2 com posições diferentes', { qtd: 2 }, { posicoesFolhas: [L, LE] }],
  ['puxador embutido', {}, { tipoPuxador: 'Embutido' }],
  ['tipo de puxador vazio', {}, { tipoPuxador: '' }],
  ['posição composta (2 puxadores)', {}, { posicoesFolhas: [`${L}, ${LE}`, `${L}, ${LE}`, `${L}, ${LE}`] }],
  ['posição Total', {}, { posicoesFolhas: ['Lateral Direita Total', 'Lateral Direita Total', 'Lateral Direita Total'], todaExt: true }],
  ['posição topo', {}, { posicoesFolhas: ['Topo Centro', 'Topo Centro', 'Topo Centro'] }],
  ['sem puxador', {}, { puxador: '', posicoesFolhas: ['', '', ''], tamanhoPux: '' }],
  ['tamanho do puxador vazio', {}, { tamanhoPux: '' }],
  ['revestimento com cor', {}, { corRevest: 'Incolor' }],
  ['sem revestimento', {}, { revestimento: '', corRevest: '' }],
  ['obs com espaços nas pontas', { obs: '  Ver furação  ' }, {}],
  ['obs vazia', { obs: '' }, {}],
  ['obs com quebra de linha', { obs: 'Ver\r\nfuração' }, {}],
  ['divisor horizontal', {}, { divisor: '3345', divH: 1 }],
  ['histórico +10', { historico: '+10' }, {}]
];
for (const [nome, mud, det] of VARIACOES) {
  test(`caso do dono, variação: ${nome}`, async t => {
    const it = itemDoDono(mud, det);
    if (det.posicoesFolhas === null) delete it.detalhes.posicoesFolhas;
    const { aberto, mysql } = await gravarELer(t, it);
    assert.equal(aberto.travado, undefined, `${aberto.motivo} -> ${aberto.detalheTecnico}`);
    assert.equal(mysql.travado, undefined, `(valores como o MySQL) ${mysql.motivo} -> ${mysql.detalheTecnico}`);
  });
}

// Fluxos de ida e volta completos com o item do dono: gravar -> reabrir -> (editar | só regravar | virar pedido) -> reabrir de novo.
async function preparar(t) {
  const banco = bancoPedOrc();
  for (const p of [produtoFalso('3345', 100, 20), produtoFalso('2018 E', 50, 10, 30, 'Sobreposto'), produtoFalso('Incolor 4mm', 200)]) banco.produtos.push(p);
  const { chamar } = await prepararPedOrc(t, { banco });
  const abrir = async (tipo, n) => (await (await chamar(`/ped_orc/${encodeURIComponent(tipo)}/${n}`)).json());
  return { banco, chamar, abrir };
}
const comoTelaDe = j => j.itens.map(it => ({ ...it, valorTela: it.valor }));
const sobre = (j, mudar) => ({ ...corpo(j.cabecalho.tipo, comoTelaDe(j)), modo: 'atualizar', numero: j.cabecalho.numero, impressao: j.impressao, manterData: true, ...mudar });

for (const [nome, mud, det] of [['3 folhas iguais', {}, {}], ['D,E,D', { furos: FUROS4(['Esquerdo', 'Direito', 'Esquerdo']) }, { posicoesFolhas: [L, LE, L] }]]) {
  for (const tipo of ['Orçamento', 'Pedido']) {
    test(`fluxos de reabrir/regravar (${tipo}, ${nome})`, async t => {
      const { chamar, abrir, banco } = await preparar(t);
      const r = await chamar('/ped_orc/salvar', 'POST', corpo(tipo, [itemDoDono(mud, det)]));
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
      const { numero } = await r.json();
      let j = await abrir(tipo, numero);
      assert.equal(j.itens[0].travado, undefined, `${j.itens[0].motivo} -> ${j.itens[0].detalheTecnico}`);
      // 1) regravar sem mexer (intacto)
      let s = await chamar('/ped_orc/salvar', 'POST', sobre(j, {}));
      assert.equal(s.status, 200, JSON.stringify(await s.clone().json()));
      j = await abrir(tipo, numero);
      assert.equal(j.itens[0].travado, undefined, `intacto: ${j.itens[0].motivo} -> ${j.itens[0].detalheTecnico}`);
      // 2) editar o item (a tela manda origem 'editado' e recalcula tudo)
      const itens = comoTelaDe(j).map(it => ({ ...it, origem: { ...it.origem, estado: 'editado' } }));
      s = await chamar('/ped_orc/salvar', 'POST', sobre(j, { itens }));
      assert.equal(s.status, 200, JSON.stringify(await s.clone().json()));
      j = await abrir(tipo, numero);
      assert.equal(j.itens[0].travado, undefined, `editado: ${j.itens[0].motivo} -> ${j.itens[0].detalheTecnico}`);
      // 3) só %
      const itens3 = comoTelaDe(j).map(it => ({ ...it, historico: '+10', origem: { ...it.origem, estado: 'so_pct' } }));
      s = await chamar('/ped_orc/salvar', 'POST', sobre(j, { itens: itens3 }));
      assert.equal(s.status, 200, JSON.stringify(await s.clone().json()));
      j = await abrir(tipo, numero);
      assert.equal(j.itens[0].travado, undefined, `so_pct: ${j.itens[0].motivo} -> ${j.itens[0].detalheTecnico}`);
    });
  }
}

test('tela real: o item reaberto, passado de novo pelo formulário (campos como texto), continua editável', async t => {
  const { chamar, abrir } = await preparar(t);
  const r = await chamar('/ped_orc/salvar', 'POST', corpo('Orçamento', [itemDoDono()]));
  const { numero } = await r.json();
  const j = await abrir('Orçamento', numero);
  const it = j.itens[0];
  // como o formulário devolve: tudo texto vindo dos inputs
  const daTela = { ...it, altura: parseFloat(String(it.altura)), largura: parseFloat(String(it.largura)),
    detalhes: { ...it.detalhes, tamanhoPux: String(it.detalhes.tamanhoPux), divH: 0, divV: 0 }, origem: { ...it.origem, estado: 'editado' }, valorTela: it.valor };
  const s = await chamar('/ped_orc/salvar', 'POST', sobre(j, { itens: [daTela] }));
  assert.equal(s.status, 200, JSON.stringify(await s.clone().json()));
  const j2 = await abrir('Orçamento', numero);
  assert.equal(j2.itens[0].travado, undefined, `${j2.itens[0].motivo} -> ${j2.itens[0].detalheTecnico}`);
});

// Diagnóstico: o motivo mostrado ao usuário não muda, mas o item travado traz `detalheTecnico` com a coluna que diverge e os dois valores.
async function gravadoDoDono(t) {
  const banco = bancoPedOrc();
  for (const p of [produtoFalso('3345', 100, 20), produtoFalso('2018 E', 50, 10, 30, 'Sobreposto'), produtoFalso('Incolor 4mm', 200)]) banco.produtos.push(p);
  const { chamar } = await prepararPedOrc(t, { banco });
  const { numero } = await (await chamar('/ped_orc/salvar', 'POST', corpo('Orçamento', [itemDoDono()]))).json();
  const linhas = () => ({ cab: banco.pedOrc.find(p => p.NUMERO === numero), lista: banco.listaItens, itensV4: banco.itensV4, complementos: banco.complementos,
    furacao: banco.furacao, serralheria: [], serralheriaComp: [] });
  return { banco, linhas, traduzir: () => traduzirDocumento(linhas()).itens[0] };
}

test('detalheTecnico: furos repetidos gravados pela versão antiga da web (100,4 e 100,2 viraram dois 100) travam e mostram os furos', async t => {
  const { banco, traduzir } = await gravadoDoDono(t);
  assert.equal(traduzir().travado, undefined);
  const primeiro = banco.furacao.find(f => Number(f.FURO) === 1);
  banco.furacao.splice(banco.furacao.indexOf(primeiro), 0, { ...primeiro });   // 100 aparece duas vezes na 1ª sequência
  banco.furacao.forEach((f, i, a) => { if (i < 2) f.FURO = i + 1; });
  const it = traduzir();
  assert.equal(it.travado, true);
  assert.equal(it.motivo, 'a tradução não reproduz o que está gravado');
  assert.match(it.detalheTecnico, /^linha 1, FUROS: gravado=\[100,100,700,1300,1900\] regenerado=\[100,700,1300,1900\]$/);
});

test('detalheTecnico: aponta a coluna que diverge com o valor gravado e o regenerado', async t => {
  const { banco, traduzir } = await gravadoDoDono(t);
  // força uma divergência real: quantidade de puxadores gravada diferente da que a posição gera
  banco.itensV4[0].QTD_PUXADOR = 2;
  let it = traduzir();
  assert.equal(it.travado, true);
  assert.equal(it.detalheTecnico, 'linha 1 (ITEM 1), QTD_PUXADOR: gravado=2 regenerado=1');
  banco.itensV4[0].QTD_PUXADOR = 1;
  banco.furacao.forEach(f => { f.LADO = 'Esquerdo'; });
  it = traduzir();
  assert.equal(it.travado, undefined, 'o lado dos furos é lido do banco: a volta reproduz');
});

test('detalheTecnico: nome de campo não casa com REGEX_VALOR (a rota não apaga o diagnóstico para quem não vê valores)', () => {
  const { REGEX_VALOR } = require('../seguranca/valores');
  assert.equal(REGEX_VALOR.test('detalheTecnico'), false);
});
