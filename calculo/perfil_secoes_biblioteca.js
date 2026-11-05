// ==========================================================================
// Biblioteca de SEMENTES das seções de perfis (puro, só Node). Cada perfil novo = acrescentar um item em SECOES e fazer deploy.
// Item: { codigo (cadastro_de_produtos.CODIGO), modelo, rev (inteiro da revisão da semente), secao (esquema v2 completo) }.
// A cada subida, seguranca/instalacao.js#semearPerfilSecoes: insere o que falta; atualiza a linha SÓ se ela ainda é de semente
// (atualizado_por = 'semente') e a rev guardada é menor que a daqui; nunca sobrescreve linha editada por pessoa; não ressuscita
// a que o dono apagou pela tela. Para CORRIGIR uma semente errada: ajuste a seção e SUBA a rev (rev + 1).
// ==========================================================================
const PerfilSecoes = require('./perfil_secoes');

// ----- 3345 (código 92, Classe Perfil) -----
// Leitura da imagem de cotas (mm; origem no canto inferior esquerdo externo, y para cima):
//   largura total 19; altura 45; caixa oca 12,6 de largura (x 6,4..19); vidro em canal à ESQUERDA da caixa (x 1,5..6,4);
//   pé em U: base x 0..6,4 / y 0..1,5 e aba externa x 0..1,5 até y = 4 (cota "4" = altura da aba do pé, mesmo papel do 7,8 do 1036).
// ESTIMADO (a imagem NÃO cota): parede = 1,5 mm (também a aba e a base do pé) e a posição interna do oco (recuado a parede em todos os lados).
// DÚVIDAS para o dono conferir: (1) a parede real; (2) se há nervuras internas como no 1036 (ignoradas); (3) a junta (aqui meia-esquadria, 45°);
// (4) se o canal do vidro começa mesmo em y = 1,5 (topo da base do pé).
const P3345 = 1.5;
const X_CAIXA_3345 = 6.4;
const SECAO_3345 = {
  versao: 2, codigo: 92, modelo: '3345',
  largura: 19, altura: 45, parede: P3345,
  junta: 'meia_esquadria',
  estimada: ['parede', 'vazados'],
  // sentido anti-horário a partir da origem: caixa x 6,4..19 / y 0..45 + pé em U (base x 0..6,4 y 0..1,5; aba x 0..1,5 até y 4)
  contorno: [[0, 0], [19, 0], [19, 45], [X_CAIXA_3345, 45], [X_CAIXA_3345, P3345], [P3345, P3345], [P3345, 4], [0, 4]],
  // oco principal: a caixa recuada a parede em todos os lados (x 7,9..17,5 / y 1,5..43,5)
  vazados: [[[7.9, P3345], [17.5, P3345], [17.5, 43.5], [7.9, 43.5]]],
  canalVidro: { x0: P3345, x1: X_CAIXA_3345, y0: P3345 },
  cores: { padrao: '#c3c8cd', porAcabamento: {} }
};

const SECOES = [
  { codigo: 13, modelo: '1036', rev: 1, secao: PerfilSecoes.semente1036() },
  { codigo: 92, modelo: '3345', rev: 1, secao: SECAO_3345 }
];

// cópia profunda (quem chama pode mexer à vontade)
const lista = () => JSON.parse(JSON.stringify(SECOES));

module.exports = { SECOES, lista };
