// ============================================================
// PLANO DE CORTE — peças de perfil de um Pedido. Funções puras (as linhas chegam prontas).
// Fontes: tabela `perfis` (medidas já calculadas na gravação do pedido, rotas/ped_orc.js) e
// `ped_orc_itens_v4` (acabamento, cor e divisores). Nada é recalculado nem estimado: dado ausente vira pendência (tamanho, ligação); acabamento e cor em branco são válidos.
//
// Como as linhas são gravadas (rotas/ped_orc.js:281-300):
//  - `perfis` tem UMA linha por grupo de folhas iguais; QTD_PORTAS = portas do grupo.
//  - QTD_ALTURA / QTD_LARGURA / QTD_PUXADOR são POR PORTA; TAM_PUXADOR é o comprimento de cada peça de puxador.
//  - `perfis` não guarda o nº da folha: a k-ésima linha de `perfis` do item corresponde à k-ésima linha de
//    `ped_orc_itens_v4` do item que tem PERFIL (as duas saem do mesmo laço, na mesma ordem).
//  - Divisor só existe em `ped_orc_itens_v4`: QTD_HORIZONTAL × TAM_DIV_HORIZONTAL e QTD_VERTICAL × TAM_DIV_VERTICAL por porta.
// ============================================================
const crypto = require('crypto');

const txt = v => String(v ?? '').trim();
const inteiro = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const porItem = (linhas, campo) => {
  const m = new Map();
  for (const l of linhas) { const k = Number(l[campo]); if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
  return m;
};

function chaveGrupo(p) { return `${p.perfil}|${p.acabamento}|${p.cor}`; }

// `perfis`: linhas da tabela perfis do pedido; `itens`: linhas de ped_orc_itens_v4 do pedido (TIPO = 'Pedido')
function montarPecas({ perfis = [], itens = [] }) {
  const pecas = [], pendencias = [];
  const pendencia = (item, perfil, motivo) => pendencias.push({ item, perfil, motivo });
  const adicionar = (qtd, tamanho, base) => { for (let i = 0; i < qtd; i++) pecas.push({ ...base, tamanho }); };

  const itensPorItem = porItem(itens, 'ITEM_PEDIDO');
  for (const lista of itensPorItem.values()) lista.sort((a, b) => Number(a.ITEM) - Number(b.ITEM));
  const perfisPorItem = porItem([...perfis].sort((a, b) => Number(a.id) - Number(b.id)), 'ITEM');

  for (const [n, linhasPerfis] of perfisPorItem) {
    const comPerfil = (itensPorItem.get(n) || []).filter(l => txt(l.PERFIL));
    if (comPerfil.length !== linhasPerfis.length) {
      pendencia(n, txt(linhasPerfis[0].PERFIL), 'Não foi possível ligar acabamento e cor ao perfil (as linhas de perfis e de itens do pedido não conferem).');
      continue;
    }
    linhasPerfis.forEach((p, k) => {
      const it = comPerfil[k], portas = inteiro(p.QTD_PORTAS), nome = txt(p.PERFIL);
      // `perfis` não tem TIPO e o VB também grava/apaga essa tabela para orçamento de mesmo número: a ordem sozinha não basta.
      // Linha ligada só vale se perfil, quantidade de portas e puxador batem com a linha de itens; senão pendência (nunca peça com medida de outro documento).
      if (txt(p.PERFIL) !== txt(it.PERFIL) || portas !== inteiro(it.QTD) || txt(p.PUXADOR) !== txt(it.PUXADOR)) {
        pendencia(n, nome, 'Não foi possível ligar acabamento e cor ao perfil (perfil, quantidade ou puxador das linhas de perfis e de itens não conferem).');
        return;
      }
      // acabamento e cor em branco são dados válidos do pedido (acabamento sem lista de cores deixa a cor vazia; perfil pode ir sem acabamento):
      // entram no agrupamento com o valor vazio, não são pendência
      const base = { perfil: nome, acabamento: txt(it.ACABAMENTO_PERFIL), cor: txt(it.COR_PERFIL), item: n };
      for (const [qtd, tam, origem, rotulo] of [[p.QTD_ALTURA, p.TAM_ALTURA, 'porta-altura', 'altura'], [p.QTD_LARGURA, p.TAM_LARGURA, 'porta-largura', 'largura']]) {
        if (inteiro(qtd) <= 0) continue;
        if (inteiro(tam) <= 0) pendencia(n, nome, `Perfil sem tamanho de ${rotulo}.`);
        else adicionar(portas * inteiro(qtd), inteiro(tam), { ...base, origem });
      }
      const qtdPux = inteiro(p.QTD_PUXADOR), puxador = txt(p.PUXADOR);
      if (puxador && qtdPux > 0) {
        if (inteiro(p.TAM_PUXADOR) <= 0) pendencia(n, puxador, 'Puxador sem tamanho.');
        else adicionar(portas * qtdPux, inteiro(p.TAM_PUXADOR), { perfil: puxador, acabamento: txt(it.ACABAMENTO_PUXADOR), cor: txt(it.COR_PUXADOR), item: n, origem: 'puxador' });
      }
    });
  }

  for (const it of itens) {
    const divisor = txt(it.DIVISOR), n = Number(it.ITEM_PEDIDO);
    if (!divisor) continue;
    const portas = inteiro(it.QTD);
    // horizontal = largura da porta, vertical = altura (engenharia.js folhasDoItem); medida que não bate com a porta
    // (o VB recarrega H e V trocados ao reabrir o pedido) não é confiável: pendência
    const trechos = [[it.QTD_HORIZONTAL, it.TAM_DIV_HORIZONTAL, 'horizontal', it.LARGURA], [it.QTD_VERTICAL, it.TAM_DIV_VERTICAL, 'vertical', it.ALTURA]].filter(([q]) => inteiro(q) > 0);
    if (!trechos.length) continue;
    const acab = txt(it.ACABAMENTO_DIVISOR), cor = txt(it.COR_DIVISOR);
    for (const [qtd, tam, rotulo, porta] of trechos) {
      if (inteiro(tam) <= 0) pendencia(n, divisor, `Divisor ${rotulo} sem tamanho.`);
      else if (inteiro(tam) !== inteiro(porta)) pendencia(n, divisor, `Divisor ${rotulo}: a medida gravada (${inteiro(tam)} mm) não bate com a da porta (${inteiro(porta)} mm); confira o pedido.`);
      else adicionar(portas * inteiro(qtd), inteiro(tam), { perfil: divisor, acabamento: acab, cor, item: n, origem: 'divisor' });
    }
  }
  return { pecas, pendencias };
}

// SHA-256 da lista ordenada: o mesmo conjunto de peças dá sempre a mesma impressão (detecta pedido alterado depois do plano)
function impressaoPecas(pecas) {
  const linhas = pecas.map(p => [p.perfil, p.acabamento, p.cor, p.tamanho, p.item, p.origem].join('|')).sort();
  return crypto.createHash('sha256').update(linhas.join('\n')).digest('hex');
}

module.exports = { montarPecas, chaveGrupo, impressaoPecas };
