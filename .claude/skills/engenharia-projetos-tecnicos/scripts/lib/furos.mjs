// Posição dos furos de dobradiça quando o projeto NÃO cota as posições.
// Regra aprovada pelo usuário do sistema em 2026-11-19: desconta 100 mm de cada extremidade da porta e distribui
// os furos igualmente no trecho que sobra. Medidas em mm, a partir do topo (padrão da tela de orçamentos);
// arredondadas para inteiro como a tela grava (Math.round). Só vale para furos SEM cota no projeto; posição cotada manda.
export const MARGEM_FURO_MM = 100;
export const REGRA_FUROS = 'furos-100mm-das-pontas';

// dimensaoMm: altura (giro) ou largura (basculante) da porta; quantidade: furos por porta (inteiro >= 1)
export function furosPorRegra(dimensaoMm, quantidade, margemMm = MARGEM_FURO_MM) {
  if (!Number.isFinite(dimensaoMm) || dimensaoMm <= 2 * margemMm) throw new Error(`dimensão inválida para furos: ${dimensaoMm}`);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 20) throw new Error(`quantidade de furos inválida: ${quantidade}`);
  if (quantidade === 1) return [Math.round(dimensaoMm / 2)];
  const util = dimensaoMm - 2 * margemMm;
  const posicoes = Array.from({ length: quantidade }, (_, i) => Math.round(margemMm + (util * i) / (quantidade - 1)));
  return [...new Set(posicoes)];
}
