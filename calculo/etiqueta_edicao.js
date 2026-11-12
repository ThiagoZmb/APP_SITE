// Edição de última hora das etiquetas da Zebra (volumes = nº de etiquetas por item, medidas e estado de destino geral). Funções puras, sem banco.
// Os ajustes valem só para a impressão em curso: nada disso é gravado. O servidor valida aqui e monta o ZPL em
// calculo/etiqueta_zpl.js; o texto digitado na tela nunca vai direto para a impressora.
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const QTD_MIN = 1;
const QTD_MAX = 999;
const MEDIDAS_MAX = 30;
const MAX_ITENS = 500;
const MAX_ETIQUETAS = 200; // teto de segurança: total de etiquetas (soma dos volumes de todos os itens) por impressão

const ehObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const vazio = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// "ES" / " es " -> "ES"; vazio -> ''; fora das 27 siglas -> null
function normalizarUf(v) {
  if (vazio(v)) return '';
  if (typeof v !== 'string') return null;
  const uf = v.trim().toUpperCase();
  return UFS.includes(uf) ? uf : null;
}

// inteiro 1 a 999 (número ou texto só de dígitos); vazio -> undefined (usa o padrão); inválido -> null
function normalizarQtd(v) {
  if (vazio(v)) return undefined;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = typeof v === 'number' ? v : (/^\d{1,4}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
  return Number.isInteger(n) && n >= QTD_MIN && n <= QTD_MAX ? n : null;
}

// só dígitos, x, X, ×, ponto, vírgula, espaço, hífen e "mm"; até 30 caracteres; pelo menos um dígito. Vazio -> ''; inválido -> null
function normalizarMedidas(v) {
  if (vazio(v)) return '';
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length > MEDIDAS_MAX) return null;
  if (!/^[0-9xX×.,\s-]*$/.test(t.replace(/mm/gi, ''))) return null;
  if (!/\d/.test(t)) return null;
  return t;
}

// corpo = { itens: [{ item, qtd (volumes), medidas, incluirMedidas }], uf (estado de destino geral) }; itensDoPedido = ['1','2',...]
// Item sem qtd = 1 volume. Um "uf" por item (formato antigo) é ignorado em silêncio: só vale o estado geral.
// -> { ok: true, uf, porItem: Map(item -> { qtd?, medidas }), total } | { ok: false, erro }   (total = nº de etiquetas)
function validarEdicao(corpo, itensDoPedido) {
  if (corpo === undefined || corpo === null) return { ok: true, uf: '', porItem: new Map(), total: (itensDoPedido || []).length };
  if (!ehObjeto(corpo)) return { ok: false, erro: 'Corpo inválido: envie um objeto com "itens" e "uf".' };
  const uf = normalizarUf(corpo.uf);
  if (uf === null) return { ok: false, erro: 'Estado de destino inválido: use a sigla de uma das 27 UFs (ex.: ES, RJ, SP).' };
  const lista = corpo.itens === undefined || corpo.itens === null ? [] : corpo.itens;
  if (!Array.isArray(lista) || lista.length > MAX_ITENS) return { ok: false, erro: `"itens" deve ser uma lista de até ${MAX_ITENS} itens.` };
  const validos = new Set((itensDoPedido || []).map(String));
  const porItem = new Map();
  for (const e of lista) {
    if (!ehObjeto(e)) return { ok: false, erro: 'Cada item editado deve ser um objeto.' };
    const id = typeof e.item === 'number' ? String(e.item) : (typeof e.item === 'string' ? e.item.trim() : '');
    if (!id || !validos.has(id)) return { ok: false, erro: `O item ${id || '(vazio)'} não existe neste pedido.` };
    if (porItem.has(id)) return { ok: false, erro: `O item ${id} veio repetido.` };
    const qtd = normalizarQtd(e.qtd);
    if (qtd === null) return { ok: false, erro: `Qtd de etiquetas (volumes) do item ${id} inválida: informe um número inteiro de ${QTD_MIN} a ${QTD_MAX}.` };
    if (e.incluirMedidas !== undefined && typeof e.incluirMedidas !== 'boolean') return { ok: false, erro: `"incluirMedidas" do item ${id} deve ser verdadeiro ou falso.` };
    let medidas = '';
    if (e.incluirMedidas === true) {
      const m = normalizarMedidas(e.medidas);
      if (m === null) return { ok: false, erro: `Medidas do item ${id} inválidas: até ${MEDIDAS_MAX} caracteres, só números, x, ×, ponto, vírgula, espaço, hífen e mm.` };
      medidas = m;
    }
    porItem.set(id, { qtd, medidas });
  }
  let total = 0;
  for (const id of validos) total += porItem.get(id)?.qtd ?? 1;
  if (total > MAX_ETIQUETAS) return { ok: false, erro: `Total de ${total} etiquetas passa do limite de ${MAX_ETIQUETAS} por impressão: reduza a quantidade de volumes dos itens.` };
  return { ok: true, uf, porItem, total };
}

// medida legível: número positivo de até 5 dígitos inteiros, com no máximo 2 decimais (vírgula ou ponto); o resto não é sugerido
function numeroLegivel(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
const texto = n => String(Math.round(n * 100) / 100).replace('.', ',');

// linhas = linhas de ped_orc_itens_v4 do item ({ ALTURA, LARGURA }) -> "ALTURA × LARGURA" ou '' (nada legível ou folhas diferentes: não inventa)
function sugerirMedidas(linhas) {
  const distintas = new Set();
  for (const l of linhas || []) {
    const a = numeroLegivel(l?.ALTURA), w = numeroLegivel(l?.LARGURA);
    if (a === null || w === null) return '';
    distintas.add(`${texto(a)} × ${texto(w)}`);
  }
  return distintas.size === 1 ? [...distintas][0] : '';
}

module.exports = { UFS, QTD_MIN, QTD_MAX, MAX_ETIQUETAS, MEDIDAS_MAX, normalizarUf, normalizarQtd, normalizarMedidas, validarEdicao, sugerirMedidas };
