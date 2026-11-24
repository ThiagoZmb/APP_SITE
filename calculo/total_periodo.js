// Total dos pedidos entre duas datas escolhidas (painel_inicial.html, "Total dos pedidos"). Funções puras.
// O que entra: pedidos (nunca orçamentos) com `ped_orc.DATA` de `de` a `ate` (inclusive, a mesma data da lista), do cliente e dos
// estados já aplicados pela rota, EXCLUINDO os Cancelados (mesmo critério de "Pedidos fechados" de /painel/indicadores).
const { situacao } = require('./indicadores_painel');

const MAX_DIAS = 3660; // ~10 anos
const DIA = 86400000;

// 'AAAA-MM-DD' real (rejeita 2026-02-30) -> Date UTC; senão null
function dataIso(t) {
  if (typeof t !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 1990 ? d : null;
}

// -> { de, ate } ou { erro }
function validarIntervalo(de, ate) {
  const a = dataIso(de), b = dataIso(ate);
  if (!a || !b) return { erro: 'Informe a data inicial e a data final no formato AAAA-MM-DD.' };
  if (a > b) return { erro: 'A data inicial não pode ser depois da data final.' };
  if ((b - a) / DIA + 1 > MAX_DIAS) return { erro: 'Intervalo grande demais (máximo de 10 anos).' };
  return { de, ate };
}

// linhas: [{ situacao, valor }] -> { qtd, total } (Cancelado fora; valor inválido conta como 0; centavos arredondados)
function somarPedidos(linhas) {
  let total = 0, qtd = 0;
  for (const r of linhas || []) {
    if (situacao(r && r.situacao) === 'cancelado') continue;
    total += parseFloat(r && r.valor) || 0; qtd++;
  }
  return { qtd, total: Math.round(total * 100) / 100 };
}

module.exports = { dataIso, validarIntervalo, somarPedidos, MAX_DIAS };
