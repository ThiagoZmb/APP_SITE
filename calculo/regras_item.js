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
]);

function rodar(escopo, alvo) {
  const out = [];
  for (const r of REGRAS) {
    if (r.escopo !== escopo) continue;
    const mensagem = r.verifica(alvo);
    if (mensagem) out.push({ codigo: r.codigo, nivel: r.nivel, mensagem });
  }
  return out;
}

const avaliar = item => rodar(ESCOPOS.ITEM, item);
const avaliarDocumento = corpo => rodar(ESCOPOS.DOCUMENTO, corpo);
const livro = () => REGRAS.map(({ codigo, nivel, escopo, titulo }) => ({ codigo, nivel, escopo, titulo }));

module.exports = { LIMITES, NIVEIS, ESCOPOS, inteiroOuNull, ehPorta, dimensaoDaPortaParaPuxador, REGRAS, avaliar, avaliarDocumento, livro };
