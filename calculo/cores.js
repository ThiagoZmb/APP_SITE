'use strict';
// Lista de cores do sistema (tabela do VB `cores`, colunas NOME_COR e TIPO).
// REGRA DO DONO (2026-11-12): em todo o sistema só entram na lista as cores cujo TIPO seja "Metálica" ou "Sólida".
// TIPO vazio, "Eletrostática" ou qualquer outro valor nunca aparece para escolha. A comparação ignora caixa, acento e
// espaços (Metalica, METÁLICA, " sólida " valem). Funções puras: o servidor aplica aqui, o front só confia no resultado.
// Item já salvo com cor fora da regra NÃO passa por aqui: a tela mostra o texto gravado (selecionarComboPorTexto) e o
// motor de preço e o PDF nunca consultam esta lista.

const TIPOS_COR = Object.freeze({ SOLIDA: 'Sólida', METALICA: 'Metálica' });

const semAcento = t => String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = t => semAcento(t).replace(/\s+/g, ' ').trim();

// 'Sólida' | 'Metálica' | null (null = tipo que não pode ser escolhido)
function tipoCorPermitido(tipo) {
  const c = chave(tipo);
  if (c === 'solida') return TIPOS_COR.SOLIDA;
  if (c === 'metalica') return TIPOS_COR.METALICA;
  return null;
}

// Tipo de cor que o nome de um acabamento pede ("Pintura Sólida Aço Carbono" -> Sólida; "Pintura Metálica ..." -> Metálica).
// Mesma regra de filtrarCores() de orcamentos.html (metálic antes de sólid). Sem tipo (Anodizado, Sem pintura) = null.
function tipoCorDoAcabamento(acabamento) {
  const c = chave(acabamento);
  if (c.includes('metalic')) return TIPOS_COR.METALICA;
  if (c.includes('solid')) return TIPOS_COR.SOLIDA;
  return null;
}

// linhas {NOME_COR, TIPO} -> { 'Sólida': [nomes], 'Metálica': [nomes] }, só tipos permitidos, nome vazio descartado, sem repetir
function agruparCoresPermitidas(linhas) {
  const grupos = { [TIPOS_COR.SOLIDA]: [], [TIPOS_COR.METALICA]: [] };
  const vistos = new Set();
  for (const r of linhas || []) {
    const tipo = tipoCorPermitido(r && r.TIPO);
    const nome = r && r.NOME_COR != null ? String(r.NOME_COR) : '';
    if (!tipo || !nome.trim()) continue;
    const k = tipo + '\u0000' + nome;
    if (vistos.has(k)) continue;
    vistos.add(k);
    grupos[tipo].push(nome);
  }
  return grupos;
}

// lista única (sem grupo) de nomes permitidos, na ordem recebida
function nomesCoresPermitidas(linhas) {
  const g = agruparCoresPermitidas(linhas);
  return [...new Set([...g[TIPOS_COR.SOLIDA], ...g[TIPOS_COR.METALICA]])];
}

// cores que o acabamento aceita: só as do tipo dele; acabamento sem tipo = nenhuma
function coresDoAcabamento(grupos, acabamento) {
  const tipo = tipoCorDoAcabamento(acabamento);
  return tipo && grupos && Array.isArray(grupos[tipo]) ? grupos[tipo] : [];
}

// Única consulta de cores do servidor (lê todas e filtra aqui, tolerante a acento/caixa que o SQL não garante)
async function lerLinhasCores(pool) {
  const [rows] = await pool.execute('SELECT NOME_COR, TIPO FROM cores ORDER BY NOME_COR');
  return rows;
}
async function carregarCoresPermitidas(pool) { return agruparCoresPermitidas(await lerLinhasCores(pool)); }

module.exports = { TIPOS_COR, tipoCorPermitido, tipoCorDoAcabamento, agruparCoresPermitidas, nomesCoresPermitidas,
  coresDoAcabamento, lerLinhasCores, carregarCoresPermitidas };
