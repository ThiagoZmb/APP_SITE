// ==========================================================================
// Composição do pedido/orçamento para os ícones da lista do Início (Perfil, Vidro, Serralheria, Pintura): funções puras.
// Só indica o que o documento TEM; não calcula medida nem preço. Nomes de campo sem relação com dinheiro (seguranca/valores.js).
// Regras completas: docs/regras/outras-regras.md
// ==========================================================================

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Pintura = acabamento de perfil "Pintura ...", revestimento "Pintado ..." de um item que é VIDRO (mesmo critério das etapas "Perfil pintado" e
// "Vidro pintado") ou item avulso de pintura: o campo PERFIL guarda o nome do serviço ("Pintura Metálica ML", "Pintura Sólida ML", "Pinturas diversas"),
// que então é Pintura e NÃO Perfil. Revestimento que não é vidro ("Pintura Sólida M2", "Chapa Perfurada ... Pintado") não conta: vidro = o item tem
// revestimento e linha em `vidros` (a ligação usa ITEM ou ITEM_PEDIDO do item, pois os dois aparecem nos dados).
const pintadoPerfil = acabamento => /pintur/.test(norm(acabamento));
// Serralheria: o ACABAMENTO da peça (ped_orc_serralheria.ACABAMENTO, ex. "Pintura Metálica Aço Carbono") também liga Pintura. Negação ("Sem pintura",
// "Não pintar") NÃO conta; nenhum valor assim é conhecido no código, a guarda é só por segurança.
const pintadoSerralheria = acabamento => { const t = norm(acabamento); return /pintur/.test(t) && !/\b(sem|nao)\b[^,;]{0,15}pintur|\bnao pintar/.test(t); };
const pintadoVidro = revestimento => /pintad/.test(norm(revestimento));

// Entrada (linhas já lidas do banco, de UM tipo de documento):
//   itens:       [{ NUMERO, ITEM, ITEM_PEDIDO, PERFIL, ACABAMENTO_PERFIL, REVESTIMENTO }]   (ped_orc_itens_v4)
//   vidros:      [{ NUMERO, ITEM }]                                            (vidros)
//   serralheria: [NUMERO | { NUMERO, ACABAMENTO }, ...]                        (ped_orc_serralheria; ACABAMENTO opcional)
//   tipos:       [{ NUMERO, TIPO_PRODUTO }]                                    (ped_orc_lista_itens)
// Saída: Map numero -> { comPerfil, comVidro, comSerralheria, comPintura } (só números com algum item; ausente = sem ícones)
function compor({ itens = [], vidros = [], serralheria = [], tipos = [] } = {}) {
  const mapa = new Map();
  const de = n => { const k = Number(n); if (!mapa.has(k)) mapa.set(k, { comPerfil: false, comVidro: false, comSerralheria: false, comPintura: false }); return mapa.get(k); };
  const vidroDoItem = new Set((vidros || []).map(v => `${Number(v.NUMERO)}|${Number(v.ITEM)}`));
  for (const it of itens || []) {
    const d = de(it.NUMERO);
    const perfil = String(it.PERFIL ?? '').trim();
    if (perfil) {
      if (pintadoPerfil(perfil)) d.comPintura = true;   // serviço de pintura avulso
      else { d.comPerfil = true; if (pintadoPerfil(it.ACABAMENTO_PERFIL)) d.comPintura = true; }
    }
    const n = Number(it.NUMERO);
    if (String(it.REVESTIMENTO ?? '').trim() && (vidroDoItem.has(`${n}|${Number(it.ITEM)}`) || vidroDoItem.has(`${n}|${Number(it.ITEM_PEDIDO)}`))) {
      d.comVidro = true; if (pintadoVidro(it.REVESTIMENTO)) d.comPintura = true;
    }
  }
  for (const s of serralheria || []) {
    const obj = s !== null && typeof s === 'object';
    const d = de(obj ? s.NUMERO : s); d.comSerralheria = true;
    if (obj && pintadoSerralheria(s.ACABAMENTO)) d.comPintura = true;
  }
  for (const t of tipos || []) {
    const tp = norm(t.TIPO_PRODUTO);
    if (tp === 'metalons') de(t.NUMERO).comSerralheria = true;   // (TIPO_PRODUTO 'Perfil' não conta: inclui os serviços de pintura; o perfil avulso já é visto pelo nome em PERFIL)
  }
  return mapa;
}

const SEM_COMPOSICAO = Object.freeze({ comPerfil: false, comVidro: false, comSerralheria: false, comPintura: false });

module.exports = { compor, pintadoPerfil, pintadoSerralheria, pintadoVidro, SEM_COMPOSICAO };
