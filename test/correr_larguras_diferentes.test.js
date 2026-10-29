process.env.JWT_SECRET = 'teste'; process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { folhasDoItem, agruparFolhas, larguraRealDoVao } = require('../calculo/engenharia');
const { calcularPrecoItem } = require('../calculo/precos');
const { traduzirDocumento } = require('../calculo/leitura_vb');
const { linhaComercial } = require('../calculo/linhas_vb');

// frmPortasCorrer: cada porta pode ter largura própria (LarguraEditada); 0 = a automática
const base = (detalhes = {}) => ({ frente: 'Porta de Correr', qtd: 3, altura: 2100, largura: 2400, furos: { lista: [], lados: [] },
  detalhes: { perfil: 'P', sistema: 'S1', transpasse: '50', posicoesFolhas: ['', '', ''], ...detalhes } });

test('folhas: a largura editada vale só para a folha; as outras ficam automáticas (vão + transpasse)', () => {
  const fl = folhasDoItem(base({ largurasFolhas: [0, 900, 0] }), { descontoAlturaSistema: 40 });
  assert.deepEqual(fl.map(f => f.largura), [833, 900, 833]); // (2400 + 50×2) / 3 = 833,3
  assert.deepEqual(fl.map(f => f.larguraVao), [2400, 2400, 2400]);
  assert.equal(agruparFolhas(fl).length, 2); // duas configurações: 833 × 2 e 900 × 1
});

test('sem larguras editadas nada muda', () => {
  const fl = folhasDoItem(base(), { descontoAlturaSistema: 40 });
  assert.deepEqual(fl.map(f => f.largura), [833, 833, 833]);
  assert.equal(agruparFolhas(fl).length, 1);
});

test('vão real dos trilhos = soma das folhas − transpasse × (n − 1), só quando há edição', () => {
  const comEdicao = base({ largurasFolhas: [0, 900, 0] });
  assert.equal(larguraRealDoVao(comEdicao, folhasDoItem(comEdicao, { descontoAlturaSistema: 40 })), 833 + 900 + 833 - 100);
  const sem = base();
  assert.equal(larguraRealDoVao(sem, folhasDoItem(sem, { descontoAlturaSistema: 40 })), 2400);
});

test('divisor acompanha a largura da própria folha', () => {
  const fl = folhasDoItem(base({ sistema: 'Sem sistema', divH: 1, largurasFolhas: [0, 700, 0] }), {});
  assert.deepEqual(fl.map(f => f.tamDivH), [2400, 700, 2400]);
});

const leitor = { produto: async () => ({ valorFixo: 100, descontoVidro: 20, descontoPerfilPux: 0, tipoPuxador: '' }), taxaAcabamento: async () => 0, fixoSerralheria: async () => 0, valorSolda: async () => 0 };

test('preço: soma o preço de cada porta (perímetro × perfil), unitário = média', async () => {
  const b = { frente: 'Porta de Correr', altura: 1000, largura: 500, perfil: 'P', qtd: 2, largurasFolhas: [500, 700] };
  const r = await calcularPrecoItem(b, { isFixo: false, desconto: 0 }, leitor);
  assert.equal(r.total, 300 + 340); // 2×1+2×0,5 = 3 m e 2×1+2×0,7 = 3,4 m a R$ 100/m
  assert.equal(r.unitario, 320);
  const iguais = await calcularPrecoItem({ ...b, largurasFolhas: [500, 500] }, { isFixo: false, desconto: 0 }, leitor);
  assert.equal(iguais.total, 600);
});

// ida e volta pelo que a gravação escreve: itens_v4 por configuração + descrição com o transpasse
function linhasGravadas(item, { descontoAlturaSistema = 40 } = {}) {
  const folhas = folhasDoItem(item, { descontoAlturaSistema });
  const grupos = agruparFolhas(folhas);
  const l = { cab: { TIPO: 'Pedido', NUMERO: 1 }, lista: [], itensV4: [], complementos: [], furacao: [], serralheria: [], serralheriaComp: [], vidros: [], perfis: [] };
  const lc = linhaComercial(item, { folhas });
  l.lista.push({ id: 1, TIPO: 'Pedido', NUMERO: 1, ITEM: 1, TIPO_PRODUTO: lc.tipoProduto, PRODUTO: lc.produto, QTD: lc.qtd, DESCRICAO: lc.descricao, UNITARIO: 900, TOTAL: 900, OBSERVACAO: null, PORCENTAGEM: '' });
  grupos.forEach((g, k) => { const f = g.folha; l.itensV4.push({ ID: k + 1, TIPO: 'Pedido', NUMERO: 1, TIPO_PRODUTO: 'Porta de correr', ITEM_PEDIDO: 1, ITEM: k + 1, PORTA: `Folha ${k + 1}`,
    QTD: g.qtd, ALTURA: f.altura, LARGURA: f.largura, ALTURA_VAO: f.alturaVao || 0, LARGURA_VAO: f.larguraVao || 0, PERFIL: f.perfil, ACABAMENTO_PERFIL: null, COR_PERFIL: null,
    USINAGEM_PERFIL: null, REVESTIMENTO: null, COR_REVESTIMENTO: null, PUXADOR: null, ACABAMENTO_PUXADOR: null, COR_PUXADOR: null, TAM_PUXADOR: 0, USINAGEM_PUXADOR: null,
    TIPO_PUXADOR: null, QTD_PUXADOR: 0, POSICAO_PUXADOR: null, DIVISOR: null, ACABAMENTO_DIVISOR: null, COR_DIVISOR: null, QTD_HORIZONTAL: 0, QTD_VERTICAL: 0,
    TAM_DIV_HORIZONTAL: 0, TAM_DIV_VERTICAL: 0, OBS: null }); });
  return l;
}
const S1 = { descontoAltura: 40, itens: [] };

test('reabrir: com sistema, as larguras editadas voltam e o transpasse vem da descrição', () => {
  const item = base({ largurasFolhas: [0, 900, 0] });
  const [it] = traduzirDocumento(linhasGravadas(item), { sistemas: { S1 } }).itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual([it.qtd, it.altura, it.largura, it.detalhes.transpasse], [3, 2100, 2400, '50']);
  assert.deepEqual(it.detalhes.largurasFolhas, [0, 0, 900]); // folhas iguais voltam agrupadas (como no VB)
  const refeitas = folhasDoItem(it, { descontoAlturaSistema: 40 }).map(f => f.largura);
  assert.deepEqual(refeitas, [833, 833, 900]);
});

test('reabrir: sem sistema, a 1ª configuração é a da tela e as diferentes ficam como editadas (folhas iguais voltam agrupadas)', () => {
  const item = base({ sistema: 'Sem sistema', largurasFolhas: [0, 700, 0] });
  const [it] = traduzirDocumento(linhasGravadas(item, { descontoAlturaSistema: 0 }), { sistemas: {} }).itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual([it.largura, it.detalhes.sistema, it.detalhes.largurasFolhas], [2400, 'Sem sistema', [0, 0, 700]]);
});

test('reabrir: larguras iguais seguem o caminho de sempre (sem largurasFolhas)', () => {
  const [it] = traduzirDocumento(linhasGravadas(base()), { sistemas: { S1 } }).itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.equal(it.detalhes.largurasFolhas, undefined);
  assert.equal(it.detalhes.transpasse, '50');
});

test('descrição só leva o transpasse quando as larguras são diferentes', () => {
  const desc = i => linhaComercial(i, { folhas: folhasDoItem(i, { descontoAlturaSistema: 40 }) }).descricao;
  assert.match(desc(base({ largurasFolhas: [0, 900, 0] })), /\| Transp: 50$/);
  assert.doesNotMatch(desc(base()), /Transp/);
});

test('orcamentos.html: caixas por porta, preço, vão dos trilhos, desenho e item levam as larguras', () => {
  const h = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.match(h, /id="correr-larguras"/);
  assert.match(h, /\.\.\.\(temLarguraEditada\(\) \? \{ largurasFolhas: largurasDasFolhas\(\) \} : \{\}\)/); // /calcular_preco
  assert.match(h, /larguraVao: vaoRealCorrer\(\)/);                                                          // trilhos pelo vão real
  assert.match(h, /const largura = lfs\[f\], largPx = largura \* esc/);                                      // desenho por folha
  assert.match(h, /largurasFolhas: temLarguraEditada\(\) \? Array\.from/);                                    // item enviado ao salvar
  assert.match(h, /largurasFolhas = Array\.isArray\(d\.largurasFolhas\)/);                                   // ao reabrir o item
});
