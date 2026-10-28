// ============================================================
// PLANO DE CORTE DE VIDROS — peças de vidro de um Pedido. Funções puras (as linhas chegam prontas).
// Fonte: tabela `vidros` (preenchida na gravação do pedido, calculo/engenharia.js `medidasVidro`).
//  - vidros.TAMANHO = 'altura x largura' e já é a medida FINAL de corte (nada é recalculado).
//  - vidros.QTD = peças de vidro daquela linha (o VB grava por peça de vidro, não por porta).
// Conferência: a linha de `vidros` só vale se, nos itens do Pedido do MESMO ITEM_PEDIDO, existir
// REVESTIMENTO = MODELO e COR_REVESTIMENTO igual (nulo = vazio; sem diferenciar caixa/espaços).
// As quantidades NÃO são comparadas. O que não confere vira pendência; nunca se estima.
// ============================================================
const crypto = require('crypto');

const txt = v => String(v ?? '').trim();
const inteiro = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const normalizar = s => txt(s).replace(/\s+/g, ' ').toLowerCase();

const REGEX_TAMANHO = /^\s*(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*$/;
const numero = s => Number(String(s).replace(',', '.'));

function chaveGrupoVidro(p) { return `${p.modelo}|${p.cor}`; }

// `vidros`: linhas da tabela vidros do pedido; `itens`: linhas de ped_orc_itens_v4 do pedido (TIPO = 'Pedido')
function montarPecasVidro({ vidros = [], itens = [] }) {
  const pecas = [], pendencias = [];
  const pendencia = (item, modelo, motivo) => pendencias.push({ item, modelo, motivo });

  // chaves "revestimento|cor" normalizadas existentes em cada item do pedido
  const revestimentos = new Map();
  for (const it of itens) {
    const n = Number(it.ITEM_PEDIDO);
    if (!revestimentos.has(n)) revestimentos.set(n, new Set());
    revestimentos.get(n).add(`${normalizar(it.REVESTIMENTO)}|${normalizar(it.COR_REVESTIMENTO)}`);
  }

  for (const v of [...vidros].sort((a, b) => Number(a.id) - Number(b.id))) {
    const n = Number(v.ITEM), modelo = txt(v.MODELO), cor = txt(v.COR_REVESTIMENTO);

    const doItem = revestimentos.get(n);
    if (!doItem) { pendencia(n, modelo, 'O item do vidro não existe nos itens do pedido; confira o pedido.'); continue; }
    if (!doItem.has(`${normalizar(modelo)}|${normalizar(cor)}`)) {
      pendencia(n, modelo, 'O modelo e a cor do vidro não conferem com o revestimento dos itens do pedido; confira o pedido.');
      continue;
    }

    const qtd = Number(v.QTD);
    if (v.QTD === null || v.QTD === undefined || !Number.isInteger(qtd) || qtd <= 0) {
      pendencia(n, modelo, 'Vidro sem quantidade válida (precisa ser um número inteiro maior que zero).');
      continue;
    }

    const m = REGEX_TAMANHO.exec(txt(v.TAMANHO));
    const altura = m ? inteiro(numero(m[1])) : 0, largura = m ? inteiro(numero(m[2])) : 0;
    if (!m || altura <= 0 || largura <= 0) {
      pendencia(n, modelo, `Vidro sem tamanho válido ("${txt(v.TAMANHO)}"); esperado altura x largura em mm.`);
      continue;
    }

    for (let i = 0; i < qtd; i++) pecas.push({ modelo, cor, altura, largura, item: n, medicao: txt(v.MEDICAO) });
  }
  return { pecas, pendencias };
}

// SHA-256 da lista ordenada: o mesmo conjunto de peças dá sempre a mesma impressão (detecta pedido alterado depois do plano)
function impressaoPecasVidro(pecas) {
  const linhas = pecas.map(p => [p.modelo, p.cor, p.altura, p.largura, p.item].join('|')).sort();
  return crypto.createHash('sha256').update(linhas.join('\n')).digest('hex');
}

module.exports = { montarPecasVidro, chaveGrupoVidro, impressaoPecasVidro, normalizar };
