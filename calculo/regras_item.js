'use strict';
// Livro de regras de orçamentos/pedidos (funções puras). As regras só LEEM o item, nunca alteram valor nem preço.
// Item = formato de coletarForm() de orcamentos.html: { frente, altura, largura, detalhes: { perfil, acabamento, cor, ... } }.
const { tipoCorDoAcabamento } = require('./cores');

const LIMITES = Object.freeze({ portaMedidaAlertaMm: 300, puxadorEmbutidoMinMm: 50, puxadorEmbutidoMaxMm: 400 });
const NIVEIS = Object.freeze({ BLOQUEIA: 'bloqueia', CONFIRMA: 'confirma', AVISA: 'avisa' });
const ESCOPOS = Object.freeze({ ITEM: 'item', DOCUMENTO: 'documento' });

const FRENTES_PORTA = Object.freeze(['porta de giro', 'porta basculante', 'frente de gaveta', 'porta de correr']);

// Só inteiros: texto "123" ou número inteiro positivo/zero; qualquer outra coisa = null
function inteiroOuNull(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return /^\d+$/.test(t) ? parseInt(t, 10) : null;
}

const texto = v => (v == null ? '' : String(v).trim());
const det = item => (item && item.detalhes && typeof item.detalhes === 'object' ? item.detalhes : {});

function ehPorta(item) {
  return FRENTES_PORTA.includes(texto(item && item.frente).toLowerCase());
}

// Mesma leitura do motor (precos.js ~317): posição TOPO/BASE = puxador horizontal (largura); outra posição = vertical (altura); sem posição, a maior das duas.
function dimensaoDaPortaParaPuxador(item) {
  const d = det(item);
  const a = inteiroOuNull(item && item.altura), l = inteiroOuNull(item && item.largura);
  const pos = texto(Array.isArray(d.posicoesFolhas) && d.posicoesFolhas.length ? d.posicoesFolhas[0] : d.posicao).toUpperCase();
  if (pos && (pos.includes('TOPO') || pos.includes('BASE'))) return l != null ? l : null;
  if (pos) return a != null ? a : null;
  if (a == null && l == null) return null;
  return Math.max(a == null ? 0 : a, l == null ? 0 : l);
}

// Tamanhos e quantidades que só podem ser inteiros (regra do dono, 2026-11-23). Dinheiro (valor, descontoPct) NÃO entra.
// caminho: chaves a seguir; '*' percorre os elementos de um array ({n} no rótulo = posição, de 1 em diante).
const CAMPOS_INTEIROS = Object.freeze([
  ['Altura', ['altura']], ['Largura', ['largura']], ['Profundidade', ['profundidade']], ['Soldas', ['soldas']],
  ['Quantidade', ['qtd']], ['Qtd. de altura', ['qtdAltura']], ['Qtd. de largura', ['qtdLargura']], ['Qtd. de profundidade', ['qtdProfundidade']],
  ['Tamanho do puxador', ['detalhes', 'tamanhoPux']], ['Divisores horizontais', ['detalhes', 'divH']], ['Divisores verticais', ['detalhes', 'divV']],
  ['Transpasse', ['detalhes', 'transpasse']], ['Largura da folha {n}', ['detalhes', 'largurasFolhas', '*']],
  ['Furo {n}', ['furos', 'lista', '*']],
  ['Acessório {n} (quantidade)', ['acessorios', '*', 'qtd']], ['Acessório {n} (tamanho)', ['acessorios', '*', 'tamanho']],
  ['Peça {n} (altura)', ['pecas', '*', 'altura']], ['Peça {n} (largura)', ['pecas', '*', 'largura']], ['Peça {n} (profundidade)', ['pecas', '*', 'profundidade']],
  ['Peça {n} (quantidade)', ['pecas', '*', 'qtd']], ['Peça {n} (qtd. de altura)', ['pecas', '*', 'qtdAltura']], ['Peça {n} (qtd. de largura)', ['pecas', '*', 'qtdLargura']],
  ['Peça {n} (qtd. de profundidade)', ['pecas', '*', 'qtdProfundidade']], ['Peça {n} (soldas)', ['pecas', '*', 'soldas']],
  ['Complemento {n} (quantidade)', ['complementos', '*', 'qtd']],
].map(([rotulo, caminho]) => Object.freeze({ rotulo, caminho: Object.freeze(caminho) })));

// Vazio/ausente não dispara (obrigatoriedade é de outras regras); número exige inteiro; texto só dígitos.
function valorNaoInteiro(v) {
  if (v == null) return false;
  if (typeof v === 'number') return !Number.isInteger(v);
  const t = String(v).trim();
  return t !== '' && !/^\d+$/.test(t);
}

function camposInteirosInvalidos(item) {
  const out = [];
  const visitar = (no, caminho, i, rotulo, n) => {
    if (no == null) return;
    if (i === caminho.length) { if (valorNaoInteiro(no)) out.push(rotulo.replace('{n}', n)); return; }
    if (caminho[i] === '*') { if (Array.isArray(no)) no.forEach((x, j) => visitar(x, caminho, i + 1, rotulo, j + 1)); return; }
    if (typeof no === 'object') visitar(no[caminho[i]], caminho, i + 1, rotulo, n);
  };
  for (const c of CAMPOS_INTEIROS) visitar(item, c.caminho, 0, c.rotulo, 1);
  return out;
}

const REGRAS = Object.freeze([
  {
    codigo: 'itens_minimo', nivel: NIVEIS.BLOQUEIA, escopo: ESCOPOS.DOCUMENTO,
    titulo: 'O documento precisa de pelo menos 1 item',
    verifica: corpo => (Array.isArray(corpo && corpo.itens) && corpo.itens.length > 0 ? null : 'Favor inserir pelomenos 1 item no pedido!'),
  },
  {
    codigo: 'acabamento_perfil', nivel: NIVEIS.BLOQUEIA, escopo: ESCOPOS.ITEM,
    titulo: 'Porta com perfil exige acabamento do perfil',
    verifica: item => (ehPorta(item) && texto(det(item).perfil) && !texto(det(item).acabamento) ? 'Escolha o acabamento do perfil.' : null),
  },
  {
    codigo: 'acabamento_puxador', nivel: NIVEIS.BLOQUEIA, escopo: ESCOPOS.ITEM,
    titulo: 'Porta com puxador exige acabamento do puxador',
    verifica: item => (ehPorta(item) && texto(det(item).puxador) && !texto(det(item).acabPux) ? 'Escolha o acabamento do puxador.' : null),
  },
  {
    codigo: 'cor_obrigatoria', nivel: NIVEIS.BLOQUEIA, escopo: ESCOPOS.ITEM,
    titulo: 'Acabamento pintado exige cor (perfil e puxador)',
    verifica: item => {
      if (!ehPorta(item)) return null;
      const d = det(item);
      if (tipoCorDoAcabamento(d.acabamento) && !texto(d.cor)) return 'Escolha a cor do perfil.';
      if (tipoCorDoAcabamento(d.acabPux) && !texto(d.corPux)) return 'Escolha a cor do puxador.';
      return null;
    },
  },
  {
    codigo: 'sem_revestimento', nivel: NIVEIS.CONFIRMA, escopo: ESCOPOS.ITEM,
    titulo: 'Porta sem revestimento pede confirmação',
    verifica: item => (ehPorta(item) && !texto(det(item).revestimento) ? 'Sem revestimento escolhido. Inserir na lista mesmo assim?' : null),
  },
  {
    codigo: 'porta_medida_pequena', nivel: NIVEIS.AVISA, escopo: ESCOPOS.ITEM,
    titulo: 'Porta com altura ou largura abaixo de ' + LIMITES.portaMedidaAlertaMm + ' mm',
    verifica: item => {
      if (!ehPorta(item)) return null;
      const lim = LIMITES.portaMedidaAlertaMm;
      const a = inteiroOuNull(item.altura), l = inteiroOuNull(item.largura);
      if ((a != null && a > 0 && a < lim) || (l != null && l > 0 && l < lim)) {
        return 'Altura ou largura menor que ' + lim + ' mm. Confira se a medida está em milímetros.';
      }
      return null;
    },
  },
  {
    codigo: 'puxador_embutido_limites', nivel: NIVEIS.BLOQUEIA, escopo: ESCOPOS.ITEM,
    titulo: 'Puxador embutido entre ' + LIMITES.puxadorEmbutidoMinMm + ' e ' + LIMITES.puxadorEmbutidoMaxMm + ' mm',
    verifica: item => {
      if (!ehPorta(item) || !texto(det(item).tipoPuxador).toLowerCase().includes('embutido')) return null;
      const t = inteiroOuNull(det(item).tamanhoPux);
      if (t == null) return null;
      const { puxadorEmbutidoMinMm: mn, puxadorEmbutidoMaxMm: mx } = LIMITES;
      return t < mn || t > mx ? 'Puxador embutido deve ter entre ' + mn + ' e ' + mx + ' mm.' : null;
    },
  },
  {
    codigo: 'puxador_maior_que_porta', nivel: NIVEIS.BLOQUEIA, escopo: ESCOPOS.ITEM,
    titulo: 'Puxador não pode ser maior que a porta',
    verifica: item => {
      if (!ehPorta(item) || det(item).todaExt === true || texto(det(item).todaExt).toLowerCase() === 'true') return null;
      const t = inteiroOuNull(det(item).tamanhoPux), dim = dimensaoDaPortaParaPuxador(item);
      return t != null && dim != null && t > dim ? 'O puxador (' + t + ' mm) é maior que a porta (' + dim + ' mm).' : null;
    },
  },
  {
    codigo: 'numero_inteiro', nivel: NIVEIS.BLOQUEIA, escopo: ESCOPOS.ITEM,
    titulo: 'Tamanhos e quantidades só aceitam números inteiros',
    // devolve uma mensagem por campo inválido (verifica pode devolver lista)
    verifica: item => camposInteirosInvalidos(item).map(r => r + ': só números inteiros, sem vírgula nem ponto.'),
  },
]);

function rodar(escopo, alvo) {
  const out = [];
  for (const r of REGRAS) {
    if (r.escopo !== escopo) continue;
    const res = r.verifica(alvo);
    for (const mensagem of (Array.isArray(res) ? res : [res])) {
      if (mensagem) out.push({ codigo: r.codigo, nivel: r.nivel, mensagem });
    }
  }
  return out;
}

const avaliar = item => rodar(ESCOPOS.ITEM, item);
const avaliarDocumento = corpo => rodar(ESCOPOS.DOCUMENTO, corpo);
const livro = () => REGRAS.map(({ codigo, nivel, escopo, titulo }) => ({ codigo, nivel, escopo, titulo }));

module.exports = { CAMPOS_INTEIROS, LIMITES, NIVEIS, ESCOPOS, inteiroOuNull, ehPorta, dimensaoDaPortaParaPuxador, REGRAS, avaliar, avaliarDocumento, livro };
