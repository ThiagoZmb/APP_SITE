process.env.JWT_SECRET = 'teste'; process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calcularPrecoItem, precoComAcessorios, chavePosicaoPreco } = require('../calculo/precos');
const { folhasDoItem } = require('../calculo/engenharia');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');

// Posição do puxador POR FOLHA: definida só no desenho (orcamentos.html), gravada uma por linha de itens_v4,
// e usada no preço folha a folha (MotorFinanceiro.CalcularValorVendaPorta é por porta).

const PROD = {
  'Perfil P': { valorFixo: 100, descontoVidro: 20, descontoPerfilPux: 0, tipoPuxador: '' },
  'Puxador X': { valorFixo: 50, descontoVidro: 10, descontoPerfilPux: 30, tipoPuxador: 'Sobreposto' },
  'Puxador T': { valorFixo: 50, descontoVidro: 10, descontoPerfilPux: 30, tipoPuxador: 'Total' },
  'Vidro V': { valorFixo: 200, descontoVidro: 0, descontoPerfilPux: 0, tipoPuxador: '' }
};
const leitor = { produto: async m => PROD[m] || null, taxaAcabamento: async () => 0, fixoSerralheria: async () => 0, valorSolda: async () => 0 };
const cliente = { isFixo: false, desconto: 0 };
const porta = (mudar = {}) => ({ frente: 'Porta de giro', altura: 2000, largura: 500, qtd: 2, perfil: 'Perfil P', revestimento: 'Vidro V',
  puxador: 'Puxador T', tipoPuxador: 'Total', tamanhoPuxador: 500, ...mudar });
const sozinha = async (pos, mudar = {}) => calcularPrecoItem(porta({ ...mudar, qtd: 1, posicaoPuxador: pos }), cliente, leitor);

test('chave do preço: só eixo (topo/base x lateral), nº de puxadores e Total importam', () => {
  assert.equal(chavePosicaoPreco('Lateral Direita Superior'), chavePosicaoPreco('Lateral Esquerda Inferior'));
  assert.equal(chavePosicaoPreco('Topo Esquerda'), chavePosicaoPreco('Base Direita'));
  assert.notEqual(chavePosicaoPreco('Topo Total'), chavePosicaoPreco('Lateral Direita Total'));
  assert.notEqual(chavePosicaoPreco('Lateral Direita Centro'), chavePosicaoPreco('Lateral Direita Centro, Lateral Esquerda Centro'));
  assert.notEqual(chavePosicaoPreco('Lateral Direita Centro'), chavePosicaoPreco(''));
  assert.notEqual(chavePosicaoPreco('Lateral Direita Centro'), chavePosicaoPreco('Lateral Direita Total'));
});

test('sem regressão: folhas com a mesma conta (iguais ou espelhadas) dão exatamente o preço de antes', async () => {
  const casos = [
    [{ puxador: 'Puxador X', tipoPuxador: 'Sobreposto', tamanhoPuxador: 300 }, ['Lateral Direita Superior', 'Lateral Esquerda Superior']],
    [{ puxador: 'Puxador X', tipoPuxador: 'Sobreposto', tamanhoPuxador: 300, qtd: 3 }, ['Topo Centro', 'Topo Centro', 'Base Esquerda']],
    [{}, ['Lateral Direita Total', 'Lateral Esquerda Total']],
    [{ puxador: '', tipoPuxador: '' }, ['', '']]
  ];
  for (const [m, poss] of casos) {
    const antes = await calcularPrecoItem(porta({ ...m, posicaoPuxador: poss[0] }), cliente, leitor);
    const agora = await calcularPrecoItem(porta({ ...m, posicaoPuxador: poss[0], posicoesFolhas: poss }), cliente, leitor);
    assert.deepEqual([agora.unitario, agora.total, agora.diag.perimetroMm], [antes.unitario, antes.total, antes.diag.perimetroMm], JSON.stringify(poss));
  }
});

test('giro com posições diferentes por folha: cada folha é calculada com a sua posição e o total é a soma', async () => {
  // Topo Total: perfil 2×2000 + 500 = 4,5 m → 450; puxador 0,5 m × 50 = 25; vidro 1,98 × 0,48 × 200 = 190,08 → 665,08
  // Lateral Direita Total: perfil 2×500 + 2000 = 3 m → 300; puxador 2 m × 50 = 100; vidro 190,08 → 590,08
  assert.equal((await sozinha('Topo Total')).total, 665.08);
  assert.equal((await sozinha('Lateral Direita Total')).total, 590.08);
  const r = await calcularPrecoItem(porta({ posicaoPuxador: 'Topo Total', posicoesFolhas: ['Topo Total', 'Lateral Direita Total'] }), cliente, leitor);
  assert.deepEqual([r.total, r.unitario], [1255.16, 627.58]);
  // antes (só a folha 1, × 2) dava 1330,16
  const so1 = await calcularPrecoItem(porta({ posicaoPuxador: 'Topo Total' }), cliente, leitor);
  assert.equal(so1.total, 1330.16);
});

test('correr: folha com 2 puxadores, folha com 1 e folha sem puxador (soma porta a porta, como frmPortasCorrer)', async () => {
  const m = { frente: 'Porta de Correr', qtd: 3, puxador: 'Puxador X', tipoPuxador: 'Sobreposto', tamanhoPuxador: 300 };
  const poss = ['Lateral Esquerda Centro, Lateral Direita Centro', 'Lateral Direita Centro', ''];
  const esperado = (await Promise.all(poss.map(p => sozinha(p, m)))).reduce((s, x) => s + x.total, 0);
  const r = await calcularPrecoItem(porta({ ...m, posicaoPuxador: poss[0], posicoesFolhas: poss }), cliente, leitor);
  assert.equal(r.total, Math.round(esperado * 100) / 100);
  assert.equal(r.unitario, Math.round(r.total / 3 * 100) / 100);
  // com acessórios: unitário = (portas + acessórios) / folhas, como sempre
  const c = await precoComAcessorios(porta({ ...m, posicoesFolhas: poss }), cliente, leitor, []);
  assert.equal(c.total, r.total);
});

test('correr com larguras e posições diferentes ao mesmo tempo: cada folha com a sua largura e a sua posição', async () => {
  const m = { frente: 'Porta de Correr', qtd: 2, puxador: 'Puxador X', tipoPuxador: 'Sobreposto', tamanhoPuxador: 300 };
  const r = await calcularPrecoItem(porta({ ...m, largurasFolhas: [500, 700], posicoesFolhas: ['Lateral Direita Centro', 'Lateral Esquerda Centro, Lateral Direita Centro'] }), cliente, leitor);
  const a = await sozinha('Lateral Direita Centro', { ...m, largura: 500 });
  const b = await sozinha('Lateral Esquerda Centro, Lateral Direita Centro', { ...m, largura: 700 });
  assert.equal(r.total, Math.round((a.total + b.total) * 100) / 100);
});

test('lista de posições mais curta que as folhas: as que faltam usam a da folha 1 (como folhasDoItem)', async () => {
  const r = await calcularPrecoItem(porta({ qtd: 3, posicoesFolhas: ['Topo Total'] }), cliente, leitor);
  assert.equal(r.total, Math.round(3 * 665.08 * 100) / 100);
});

// ---------------- ida e volta: salvar → abrir ----------------
const itemGiro = (mudar = {}) => ({ frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, profundidade: 0, soldas: 0, obs: '',
  furos: { lista: [], lados: [] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: 'Puxador T', tipoPuxador: 'Total', tipoPuxadorNativo: 'Total',
    acabPux: '', corPux: '', tamanhoPux: '500', todaExt: true, revestimento: 'Vidro V', corRevest: 'Incolor', divisor: '', divH: 0, divV: 0,
    posicoesFolhas: ['Topo Total', 'Lateral Direita Total'] },
  acessorios: [], historico: '', valorTela: 627.58, ...mudar });
const corpo = itens => ({ modo: 'novo', tipo: 'Pedido', clienteCodigo: 7, clienteFinal: '', obsGeral: '', descontoPct: 0,
  dataEntrega: '2026-11-05', situacao: 'Em Produção', financeiro: 'A Receber', itens });

test('salvar → abrir com posições diferentes por folha: preço por folha, uma linha por posição e o mesmo item de volta', async t => {
  const banco = bancoPedOrc();
  banco.produtos.push({ MODELO: 'Puxador T', VALOR_FIXO: 50, DESCONTO_VIDRO: 10, DESC_PERF_PUX: 30, TIPO_PUXADOR: 'Total', SITUACAO: 'Ativo' });
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar('/ped_orc/salvar', 'POST', corpo([itemGiro()]));
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.avisos, undefined, 'o servidor refaz o mesmo preço da tela (por folha)');
  const l = banco.listaItens[0];
  assert.deepEqual([l.QTD, l.UNITARIO, l.TOTAL], [2, 627.58, 1255.16]);
  // uma linha de itens_v4 por posição, cada uma com a sua quantidade de puxadores
  assert.deepEqual(banco.itensV4.map(v => [v.PORTA, v.QTD, v.POSICAO_PUXADOR, v.QTD_PUXADOR]),
    [['Folha 1', 1, 'Topo Total', 1], ['Folha 2', 1, 'Lateral Direita Total', 1]]);
  // perfis (corte) também por folha: Topo Total desconta o puxador no topo, lateral desconta na largura
  assert.equal(banco.perfis.length, 2);

  const aberto = await (await chamar(`/ped_orc/Pedido/${j.numero}`)).json();
  const [it] = aberto.itens;
  assert.equal(it.travado, undefined, it.motivo);
  assert.deepEqual(it.detalhes.posicoesFolhas, ['Topo Total', 'Lateral Direita Total']);
  assert.equal(it.valor, 627.58);
  // o que a tela recalcula ao reabrir (mesma entrada que o servidor) dá o mesmo preço
  const folhas = folhasDoItem(it);
  assert.deepEqual(folhas.map(f => f.posicaoPuxador), ['Topo Total', 'Lateral Direita Total']);
  const re = await calcularPrecoItem(porta({ posicaoPuxador: folhas[0].posicaoPuxador, posicoesFolhas: folhas.map(f => f.posicaoPuxador) }), cliente, leitor);
  assert.equal(re.unitario, it.valor);

  // salvar de novo o item reaberto (editado) mantém tudo
  const r2 = await chamar('/ped_orc/salvar', 'POST', { ...corpo([{ ...it, origem: { item: 1, estado: 'editado' }, valorTela: it.valor }]),
    modo: 'atualizar', numero: j.numero, impressao: aberto.impressao });
  assert.equal(r2.status, 200, JSON.stringify(await r2.clone().json()));
  assert.deepEqual(banco.itensV4.map(v => [v.QTD, v.POSICAO_PUXADOR]), [[1, 'Topo Total'], [1, 'Lateral Direita Total']]);
  assert.equal(banco.listaItens[0].UNITARIO, 627.58);
});

test('salvar: pares espelhados continuam com o preço de antes (uma porta × qtd)', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const item = itemGiro({ valorTela: 0, detalhes: { ...itemGiro().detalhes, puxador: 'Puxador X', tipoPuxador: 'Sobreposto', tipoPuxadorNativo: 'Sobreposto',
    tamanhoPux: '300', todaExt: false, posicoesFolhas: ['Lateral Direita Superior', 'Lateral Esquerda Superior'] } });
  const r = await chamar('/ped_orc/salvar', 'POST', corpo([item]));
  assert.equal(r.status, 200);
  const uma = await calcularPrecoItem(porta({ qtd: 1, puxador: 'Puxador X', tipoPuxador: 'Sobreposto', tamanhoPuxador: '300', posicaoPuxador: 'Lateral Direita Superior' }), cliente, leitor);
  assert.equal(banco.listaItens[0].UNITARIO, uma.unitario);
  assert.equal(banco.listaItens[0].TOTAL, Math.round(uma.unitario * 2 * 100) / 100);
});

test('salvar: correr com larguras diferentes grava o mesmo preço que a tela mostra (antes usava só a largura da folha 1)', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const item = { frente: 'Porta de Correr', qtd: 2, altura: 2000, largura: 500, profundidade: 0, soldas: 0, obs: '', furos: { lista: [], lados: [] },
    detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: 'Vidro V', corRevest: 'Incolor', divisor: '', divH: 0, divV: 0,
      sistema: 'Sem sistema', transpasse: '0', largurasFolhas: [0, 700], posicoesFolhas: ['', ''] }, acessorios: [], historico: '', valorTela: 0 };
  const r = await chamar('/ped_orc/salvar', 'POST', corpo([item]));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const tela = await calcularPrecoItem({ frente: 'Porta de Correr', altura: 2000, largura: 500, qtd: 2, perfil: 'Perfil P', revestimento: 'Vidro V', largurasFolhas: [500, 700] }, cliente, leitor);
  // correr: a linha da lista é o conjunto (QTD 1, como frmPortasCorrer); o total é a soma das portas
  assert.deepEqual([banco.listaItens[0].QTD, banco.listaItens[0].TOTAL], [1, tela.total]);
  const soLargura1 = await calcularPrecoItem({ frente: 'Porta de Correr', altura: 2000, largura: 500, qtd: 2, perfil: 'Perfil P', revestimento: 'Vidro V' }, cliente, leitor);
  assert.notEqual(tela.total, soLargura1.total); // o caso testado é mesmo um em que a regra antiga dava outro valor
});

// ---------------- tela ----------------
test('orcamentos.html: sem o campo "Posição (folha 1)"; posição só pelo desenho e preço com a posição de cada folha', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.doesNotMatch(h, /f-posicao|wrap-posicao|atualizarOpcoesPosicao|posicaoParaCalculo|Posição \(folha 1\)/);
  assert.match(h, /id="btn-modo-pux"[^>]*>🎯 Posicionar puxador \(clique no desenho\)</);
  assert.match(h, /id="pux-resumo"/);
  assert.match(h, /posicoesFolhas: posicoesParaCalculo\(\)/);                 // corpo do /calcular_preco
  assert.match(h, /function posicoesParaCalculo\(\) \{ return posicoesFolhas\.slice\(0, qtdFolhasAtual\(\)\); \}/);
  assert.match(h, /posicao: posicoesFolhas\[0\] \|\| '', posicoesFolhas: \[\.\.\.posicoesFolhas\]/); // item salvo leva todas
  assert.match(h, /folha\(s\) sem posição do puxador/);                       // aviso ao adicionar
});
