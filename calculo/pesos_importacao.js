// ============================================================
// Importação das estimativas de peso (docs/pesos_estimados_perfis.json) para web_pesos — regra pura, sem banco.
// Entrada do arquivo: [{ tipo, produto, kgPorMetro, unidade, origem, confianca }].
// Regra: NUNCA sobrescreve. Só entra o que ainda não está cadastrado (tipo + produto, sem diferenciar caixa nem espaços);
// o cadastrado, com qualquer origem, fica intacto e aparece no relatório como "já cadastrado".
// ============================================================
const { validarPeso, chaveProduto } = require('./peso');

const ORIGEM_IMPORTADA = 'estimado_desenho';
const chaveDe = (tipo, produto) => `${String(tipo ?? '').trim()}|${chaveProduto(produto)}`;

// estimativas: lista do arquivo; existentes: [{ tipo, produto }] já em web_pesos
// Retorna { inserir:[{tipo,produto,unidadePeso,kgPorUnidade,origem,confianca}], ignorar:[{tipo,produto,motivo}] }
function planejarImportacaoPesos({ estimativas, existentes = [] } = {}) {
  const inserir = [], ignorar = [];
  if (!Array.isArray(estimativas)) return { inserir, ignorar: [{ tipo: '', produto: '', motivo: 'arquivo de estimativas inválido (não é uma lista)' }] };
  const vistos = new Set(existentes.map(e => chaveDe(e.tipo, e.produto)));
  for (const e of estimativas) {
    const x = e && typeof e === 'object' ? e : {};
    const tipo = String(x.tipo ?? '').trim(), produto = String(x.produto ?? '').trim();
    if (String(x.origem ?? '').trim() !== ORIGEM_IMPORTADA) { ignorar.push({ tipo, produto, motivo: `origem diferente de ${ORIGEM_IMPORTADA}` }); continue; }
    const v = validarPeso({ tipo, produto, unidadePeso: x.unidade, kgPorUnidade: x.kgPorMetro, origem: ORIGEM_IMPORTADA, confianca: x.confianca });
    if (v.erros.length) { ignorar.push({ tipo, produto, motivo: v.erros.join(' ') }); continue; }
    const k = chaveDe(v.dados.tipo, v.dados.produto);
    if (vistos.has(k)) { ignorar.push({ tipo, produto, motivo: 'já cadastrado' }); continue; }
    vistos.add(k);
    inserir.push(v.dados);
  }
  return { inserir, ignorar };
}

module.exports = { ORIGEM_IMPORTADA, planejarImportacaoPesos };
