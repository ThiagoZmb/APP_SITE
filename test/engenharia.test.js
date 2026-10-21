const test = require('node:test');
const assert = require('node:assert/strict');
const { folhasDoItem, agruparFolhas, medidasVidro, medidasPerfil, furosUnicos, acessoriosDoSistema, exigePerfil, ErroEngenharia } = require('../calculo/engenharia');

const PERFIL = { descontoVidro: 20, descontoPerfilPux: 0 };
const PUX = { descontoVidro: 10, descontoPerfilPux: 30 };
const folha = (mudar = {}) => ({ altura: 2000, largura: 500, revestimento: 'Vidro', perfil: 'P', puxador: 'X', tipoPuxador: 'Sobreposto', qtdPuxador: 1, posicaoPuxador: '', ...mudar });

test('sem puxador: vidro e perfil descontam só o perfil', () => {
  const f = folha({ puxador: '', qtdPuxador: 0 });
  assert.deepEqual(medidasVidro(f, PERFIL, null), { altura: 1960, largura: 460 });
  assert.deepEqual(medidasPerfil(f, null), { qtdAltura: 2, tamAltura: 2000, qtdLargura: 2, tamLargura: 500 });
});

test('embutido conta como sem puxador', () => {
  const f = folha({ tipoPuxador: 'Embutido', posicaoPuxador: 'Lateral Esquerda Superior' });
  assert.deepEqual(medidasVidro(f, PERFIL, PUX), { altura: 1960, largura: 460 });
  assert.deepEqual(medidasPerfil(f, PUX), { qtdAltura: 2, tamAltura: 2000, qtdLargura: 2, tamLargura: 500 });
});

test('sobreposto lateral', () => {
  const f = folha({ posicaoPuxador: 'Lateral Esquerda Superior' });
  assert.deepEqual(medidasVidro(f, PERFIL, PUX), { altura: 1960, largura: 450 });
  assert.deepEqual(medidasPerfil(f, PUX), { qtdAltura: 2, tamAltura: 2000, qtdLargura: 2, tamLargura: 470 });
});

test('sobreposto topo', () => {
  const f = folha({ posicaoPuxador: 'Topo Centro' });
  assert.deepEqual(medidasVidro(f, PERFIL, PUX), { altura: 1950, largura: 460 });
  assert.deepEqual(medidasPerfil(f, PUX), { qtdAltura: 2, tamAltura: 1970, qtdLargura: 2, tamLargura: 500 });
});

test('total lateral com 1 e com 2 puxadores', () => {
  const f = folha({ tipoPuxador: 'Sobreposto Total', posicaoPuxador: 'Lateral Esquerda Total' });
  assert.deepEqual(medidasVidro(f, PERFIL, PUX), { altura: 1960, largura: 460 });
  assert.deepEqual(medidasPerfil(f, PUX), { qtdAltura: 1, tamAltura: 2000, qtdLargura: 2, tamLargura: 470 });
  const f2 = folha({ tipoPuxador: 'Total', qtdPuxador: 2, posicaoPuxador: 'Lateral Esquerda Total, Lateral Direita Total' });
  assert.deepEqual(medidasPerfil(f2, PUX), { qtdAltura: 0, tamAltura: 2000, qtdLargura: 2, tamLargura: 440 });
});

test('total topo', () => {
  const f = folha({ tipoPuxador: 'Total', posicaoPuxador: 'Topo Total' });
  assert.deepEqual(medidasVidro(f, PERFIL, PUX), { altura: 1970, largura: 460 });
  assert.deepEqual(medidasPerfil(f, PUX), { qtdAltura: 2, tamAltura: 1970, qtdLargura: 2, tamLargura: 470 });
});

test('posição não reconhecida não grava 0×0', () => {
  const f = folha({ posicaoPuxador: 'XYZ' });
  assert.throws(() => medidasVidro(f, PERFIL, PUX), e => e instanceof ErroEngenharia && /cálculo do vidro/.test(e.message));
  assert.throws(() => medidasPerfil(f, PUX), e => e instanceof ErroEngenharia && /cálculo do perfil/.test(e.message));
});

test('sem revestimento não há vidro', () => {
  assert.equal(medidasVidro(folha({ revestimento: '' }), PERFIL, PUX), null);
});

test('folhas iguais se agrupam; espelhadas ficam separadas', () => {
  const item = { frente: 'Porta de giro', qtd: 4, altura: 2000, largura: 500, furos: { lista: [100, 900], lados: ['Esquerdo', 'Direito', 'Esquerdo', 'Direito'] },
    detalhes: { perfil: 'P', puxador: 'X', tipoPuxador: 'Sobreposto', revestimento: 'Vidro',
      posicoesFolhas: ['Lateral Direita Superior', 'Lateral Esquerda Superior', 'Lateral Direita Superior', 'Lateral Esquerda Superior'] } };
  const grupos = agruparFolhas(folhasDoItem(item, {}));
  assert.equal(grupos.length, 2);
  assert.deepEqual(grupos.map(g => g.qtd), [2, 2]);
  assert.equal(grupos[0].folha.posicaoFuros, 'Esquerdo');
  assert.equal(grupos[0].folha.qtdPuxador, 1);
  assert.deepEqual(grupos[0].folha.furos, [100, 900]);
});

test('furos: positivos, únicos e em ordem', () => {
  assert.deepEqual(furosUnicos([900, 100, 0, 100, -5]), [100, 900]);
});

test('porta de correr: com sistema calcula a porta pelo vão; sem sistema usa a medida', () => {
  const base = { frente: 'Porta de Correr', qtd: 2, altura: 2100, largura: 1600, furos: { lista: [], lados: [] }, detalhes: { perfil: 'P', sistema: 'S1', transpasse: '50', posicoesFolhas: ['', ''] } };
  const [f] = folhasDoItem(base, { descontoAlturaSistema: 40 });
  assert.deepEqual([f.altura, f.largura, f.alturaVao, f.larguraVao], [2060, 825, 2100, 1600]);
  const [g] = folhasDoItem({ ...base, detalhes: { ...base.detalhes, sistema: 'Sem sistema' } }, { descontoAlturaSistema: 40 });
  assert.deepEqual([g.altura, g.largura, g.alturaVao, g.larguraVao], [2100, 1600, null, null]);
});

test('itens do sistema de correr: trilho pela config e vão, demais × folhas, desempenador opcional', () => {
  const itens = [{ modelo: 'Trilho Sup', qtd: 1, multiplicador: '', classe: 'Trilho superior' },
    { modelo: 'Roldana', qtd: 2, multiplicador: '', classe: 'Roldana' },
    { modelo: 'Desemp', qtd: 1, multiplicador: '', classe: 'Desempenador' }];
  const r = acessoriosDoSistema(itens, { qtdTrilhoSup: 2, qtdTrilhoInf: 1 }, { larguraVao: 2400, folhas: 3, incluirDesempenador: false });
  assert.deepEqual(r, [{ nome: 'Trilho Sup', classe: 'Trilho superior', qtd: 2, tamanho: 2400 }, { nome: 'Roldana', classe: 'Roldana', qtd: 6, tamanho: 0 }]);
  const c = acessoriosDoSistema(itens, null, { larguraVao: 2400, folhas: 3, incluirDesempenador: true });
  assert.deepEqual(c.map(a => [a.nome, a.qtd]), [['Trilho Sup', 1], ['Roldana', 6], ['Desemp', 3]]);
});

test('itens que não exigem perfil', () => {
  assert.equal(exigePerfil('Revestimento avulso'), false);
  assert.equal(exigePerfil('Kit'), false);
  assert.equal(exigePerfil('Porta de giro'), true);
});

test('divisor herda acabamento/cor do perfil e mede a folha (frmPortasCorrer:1519)', () => {
  const item = { frente: 'Porta de giro', qtd: 1, altura: 2000, largura: 500, furos: { lista: [], lados: [] },
    detalhes: { perfil: 'P', acabamento: 'Anodizado', cor: 'Preto', divisor: 'D', divH: 2, divV: 0 } };
  const [f] = folhasDoItem(item, {});
  assert.deepEqual([f.acabDivisor, f.corDivisor, f.tamDivH, f.tamDivV], ['Anodizado', 'Preto', 500, 0]);
  const [g] = folhasDoItem({ ...item, detalhes: { ...item.detalhes, divH: 0 } }, {});
  assert.deepEqual([g.acabDivisor, g.corDivisor, g.tamDivH, g.tamDivV], ['', '', 0, 0]);
});

test('descontos fracionários viram inteiros como o CInt do VB (arredonda para o par)', () => {
  const f = folha({ puxador: '', qtdPuxador: 0 });
  assert.deepEqual(medidasVidro(f, { descontoVidro: 12.5, descontoPerfilPux: 0 }, null), { altura: 1976, largura: 476 });
  assert.deepEqual(medidasVidro(f, { descontoVidro: 13.5, descontoPerfilPux: 0 }, null), { altura: 1972, largura: 472 });
  const g = folha({ posicaoPuxador: 'Lateral Esquerda Superior', altura: 2000.4 });
  assert.deepEqual(medidasPerfil(g, { descontoVidro: 10, descontoPerfilPux: 12.5 }), { qtdAltura: 2, tamAltura: 2000, qtdLargura: 2, tamLargura: 488 });
});

test('item do sistema com quantidade 0 fica de fora', () => {
  const r = acessoriosDoSistema([{ modelo: 'Trilho Sup', qtd: 1, classe: 'Trilho superior' }, { modelo: 'Roldana', qtd: 0, classe: 'Roldana' }],
    { qtdTrilhoSup: 0, qtdTrilhoInf: 1 }, { larguraVao: 2400, folhas: 2, incluirDesempenador: false });
  assert.deepEqual(r, []);
});
