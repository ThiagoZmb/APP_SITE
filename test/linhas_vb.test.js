const test = require('node:test');
const assert = require('node:assert/strict');
const { linhaComercial } = require('../calculo/linhas_vb');
const { folhasDoItem } = require('../calculo/engenharia');

const giro = { frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, obs: 'Cuidado',
  furos: { lista: [100, 900], lados: ['Esquerdo', 'Direito'] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: 'Puxador X', acabPux: 'Escovado', tipoPuxador: 'Sobreposto',
    tamanhoPux: '300', posicoesFolhas: ['Lateral Direita Superior', 'Lateral Esquerda Superior'], revestimento: 'Vidro V', corRevest: 'Incolor',
    divisor: '', divH: 0, divV: 0 } };

test('porta de giro: tipo = produto = frente, descrição no formato do frmPortasAbrir', () => {
  const l = linhaComercial(giro, { folhas: folhasDoItem(giro, {}), acessorios: [{ nome: 'Fechadura', qtd: 1, tamanho: 0 }] });
  assert.equal(l.tipoProduto, 'Porta de giro');
  assert.equal(l.produto, 'Porta de giro');
  assert.equal(l.qtd, 2);
  assert.deepEqual(l.descricao.split('\r\n'), [
    'Tipo de produto: Porta de giro',
    'Tamanho: 2000x500 mm',
    'Perfil: Perfil P (Anodizado) | Cor: Preto',
    'Puxador: 1x Puxador X (Escovado) | Posição: Lateral Direita Superior | Tam: 300 mm',
    'Revestimento: Vidro V (Incolor)',
    'Folha 1: H = 2000 x L = 500 mm',
    'Porta 1: 2 furos',
    'Folha 2: H = 2000 x L = 500 mm',
    'Porta 2: 2 furos',
    'Complemento: 1x Fechadura de 0 mm',
    'Obs: Cuidado',
    '']);
});

test('porta de correr: 1 conjunto, produto "Porta de correr"', () => {
  const item = { frente: 'Porta de Correr', qtd: 2, altura: 2100, largura: 1600, furos: { lista: [], lados: [] },
    detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', sistema: 'S1', puxador: '', revestimento: 'Vidro V', posicoesFolhas: ['', ''] } };
  const l = linhaComercial(item, { folhas: folhasDoItem(item, { descontoAlturaSistema: 40 }), acessorios: [] });
  assert.deepEqual([l.tipoProduto, l.produto, l.qtd], ['Porta de correr', 'Porta de correr', 1]); // VB compara com c minúsculo
  assert.equal(l.descricao, 'Tam: 2100x1600mm | Per: Perfil P Anodizado | Sist: S1 | Pux:  | Rev: Vidro V | Portas: 2 | Furos: 0');
});

test('serralheria vira Metalons; avulso usa a categoria e produto vazio', () => {
  const s = linhaComercial({ frente: 'Serralheria', qtd: 3, detalhes: { produto: 'Grade' } }, { folhas: [], acessorios: [] });
  assert.deepEqual([s.tipoProduto, s.produto, s.qtd, s.descricao], ['Metalons', 'Grade', 3, 'Grade']);
  const a = linhaComercial({ frente: 'Avulso', qtd: 2, altura: 3000, largura: 0, detalhes: { categoria: 'Perfil', avProduto: 'Perfil P', avAcab: 'Anodizado', avCor: 'Preto' } }, { folhas: [], acessorios: [] });
  assert.deepEqual([a.tipoProduto, a.produto, a.qtd, a.descricao], ['Perfil', '', 2, 'Perfil P Anodizado Preto | Medida: 3000mm']);
  const r = linhaComercial({ frente: 'Avulso', qtd: 1, altura: 1000, largura: 500, detalhes: { categoria: 'Revestimento', avProduto: 'Vidro V', avAcab: '', avCor: '' } }, { folhas: [], acessorios: [] });
  assert.equal(r.descricao, 'Vidro V | Tam: 1000x500mm');
});
