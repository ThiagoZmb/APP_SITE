process.env.JWT_SECRET = 'teste'; process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calcularPrecoItem, acabamentoDoPuxador } = require('../calculo/precos');
const { folhasDoItem } = require('../calculo/engenharia');

// Regra do dono: o acabamento do puxador é SEMPRE o do perfil (tela trava o campo; servidor impõe no preço e na gravação).

const PROD = {
  'Perfil P': { valorFixo: 100, descontoVidro: 0, descontoPerfilPux: 0, tipoPuxador: '' },
  'Puxador X': { valorFixo: 50, descontoVidro: 0, descontoPerfilPux: 0, tipoPuxador: 'Sobreposto' }
};
const TAXAS = { Anodizado: 10, Pintado: 30 };
const pedidos = [];
const leitor = { produto: async m => PROD[m] || null, taxaAcabamento: async n => { pedidos.push(n); return TAXAS[n] || 0; }, fixoSerralheria: async () => 0, valorSolda: async () => 0 };
const cliente = { isFixo: false, desconto: 0 };
const porta = (mudar = {}) => ({ frente: 'Porta de giro', altura: 2000, largura: 500, qtd: 1, perfil: 'Perfil P', acabPerfil: 'Anodizado',
  puxador: 'Puxador X', tipoPuxador: 'Sobreposto', tamanhoPuxador: 300, posicaoPuxador: 'Lateral Direita Centro', ...mudar });

test('acabamentoDoPuxador: usa o do perfil; sem acabamento no perfil mantém o que veio', () => {
  assert.equal(acabamentoDoPuxador('Anodizado', 'Pintado'), 'Anodizado');
  assert.equal(acabamentoDoPuxador(' Anodizado ', ''), 'Anodizado');
  assert.equal(acabamentoDoPuxador('', 'Pintado'), 'Pintado');
  assert.equal(acabamentoDoPuxador(undefined, undefined), '');
});

test('preço: puxador com acabamento diferente do perfil é cobrado com o do perfil', async () => {
  const igual = await calcularPrecoItem(porta({ acabPuxador: 'Anodizado' }), cliente, leitor);
  const outro = await calcularPrecoItem(porta({ acabPuxador: 'Pintado' }), cliente, leitor);
  const vazio = await calcularPrecoItem(porta({ acabPuxador: '' }), cliente, leitor);
  assert.equal(JSON.stringify(outro), JSON.stringify(igual));
  assert.equal(JSON.stringify(vazio), JSON.stringify(igual));
  assert.ok(!pedidos.includes('Pintado'), 'a taxa de Pintado não pode ser consultada para o puxador');
});

test('sem puxador a regra não interfere (não cria trava de compatibilidade)', async () => {
  const r = await calcularPrecoItem(porta({ puxador: '', tipoPuxador: '', posicaoPuxador: '', acabPuxador: 'Pintado' }), cliente, leitor);
  assert.ok(r);
});

test('gravação: folhasDoItem grava ACABAMENTO_PUXADOR = acabamento do perfil, mesmo se a tela mandar outro', () => {
  const item = { frente: 'Porta de giro', qtd: 1, altura: 2000, largura: 500,
    detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', puxador: 'Puxador X', acabPux: 'Pintado', tipoPuxador: 'Sobreposto', tamanhoPux: 300, posicoesFolhas: ['Lateral Direita Centro'] } };
  assert.equal(folhasDoItem(item)[0].acabPuxador, 'Pintado'); // leitura do VB: como foi gravado
  const f = folhasDoItem(item, { acabPuxadorDoPerfil: true });
  assert.equal(f[0].acabPuxador, 'Anodizado');
  assert.equal(f[0].posicaoPuxador, 'Lateral Direita Centro'); // posição por folha preservada
  const sem = folhasDoItem({ ...item, detalhes: { ...item.detalhes, puxador: '', acabPux: 'Pintado' } });
  assert.equal(sem[0].puxador, '');
});

test('tela: o acabamento do puxador segue o do perfil e o campo fica travado, com aviso se faltar a variante', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.match(h, /function sincronizarAcabPuxador\(\)/);
  assert.match(h, /sel\.disabled = true/);
  assert.match(h, /id="aviso-acab-pux"/);
  assert.match(h, /if \(val\('f-puxador'\)\) \{ sincronizarAcabPuxador\(\); aoMudarAcabPuxador\(\); \}/);
});
