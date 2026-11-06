// ==========================================================================
// Calendário de previsão de finalização dos pedidos: funções puras (testáveis sem banco).
// A data do calendário é ped_orc.DATA_PRONTO (a data prometida; a mesma que "Alterar data de pronto" muda).
// Regras completas: docs/regras/calendario-pedidos.md
// ==========================================================================

const SITUACOES_FILTRO = ['abertos', 'todos'];
const ANO_MIN = 2000, ANO_MAX = 2100; // fora disso é digitação errada; o VB grava 01/01/0001 quando não há data

const dois = n => String(n).padStart(2, '0');
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function diasNoMes(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); } // mes = 1..12

// 'AAAA-MM-DD' real (rejeita 31/04, 29/02 de ano comum); devolve a própria data ou null
function validarData(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ''));
  if (!m) return null;
  const ano = +m[1], mes = +m[2], dia = +m[3];
  if (ano < ANO_MIN || ano > ANO_MAX || mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) return null;
  return String(v);
}

// 'AAAA-MM-DD' + n dias (n pode ser negativo; vira mês e ano, conta o 29/02)
function somarDias(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

// 'AAAA-MM' -> { ano, mes (1..12), inicio: 'AAAA-MM-01', fim: primeiro dia do mês seguinte (exclusivo), ultimo: 'AAAA-MM-DD' } ou null
function validarMes(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  if (!m) return null;
  const ano = +m[1], mes = +m[2];
  if (ano < ANO_MIN || ano > ANO_MAX || mes < 1 || mes > 12) return null;
  const virada = mes === 12;
  return { ano, mes, chave: `${m[1]}-${m[2]}`, inicio: `${m[1]}-${m[2]}-01`,
    fim: `${virada ? ano + 1 : ano}-${dois(virada ? 1 : mes + 1)}-01`, ultimo: `${m[1]}-${m[2]}-${dois(diasNoMes(ano, mes))}` };
}

// ausente = 'abertos'; qualquer outro valor que não seja abertos/todos = null (a rota responde 400)
function validarSituacao(v) {
  if (v === undefined || v === null || v === '') return 'abertos';
  return SITUACOES_FILTRO.includes(v) ? v : null;
}

// Mesmos grupos do painel (painel_inicial.html, função `sit`): cancelado, producao, pronto, entregue, retirado, outro
function classificarSituacao(s) {
  const n = norm(s);
  if (n.includes('cancel')) return 'cancelado';
  if (n.includes('produ')) return 'producao';
  if (n.includes('pronto') || n.includes('finaliz') || n.includes('conclu') || n === 'ok') return 'pronto';
  if (n.includes('entreg')) return 'entregue';
  if (n.includes('retir')) return 'retirado';
  return 'outro';
}

// "Em aberto" = ainda não saiu da fábrica nem foi cancelado: em produção, pronto aguardando entrega ou situação desconhecida.
// (Mesmo critério do cartão "Entregas da semana" de inicio.html, que tira Entregue, Retirado e Cancelado.)
const emAberto = situacao => !['cancelado', 'entregue', 'retirado'].includes(classificarSituacao(situacao));

// Atrasado = a data de pronto já passou (antes de hoje) e o pedido ainda não foi finalizado: está em produção ou em situação
// desconhecida. Pronto/Entregue/Retirado já cumpriram a promessa de finalizar; Cancelado não conta.
function atrasado(situacao, dataPronto, hoje) {
  const d = String(dataPronto ?? '').slice(0, 10);
  if (!validarData(d) || !validarData(hoje)) return false;
  if (!['producao', 'outro'].includes(classificarSituacao(situacao))) return false;
  return d < hoje;
}

// Data do banco (DATE/DATETIME em texto) -> 'AAAA-MM-DD' ou '' (vazia / ano < 1900 do VB / inválida)
function dataISO(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  if (!m || +m[1] < 1900) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Linha do banco -> pedido do calendário. `valor` só existe aqui; a rota o apaga de quem não tem valores.ver.
function montarPedido(r, hoje) {
  const situacao = String(r.situacao ?? '').trim();
  const prontoEm = dataISO(r.pronto_em);
  return {
    numero: r.numero,
    cliente: String(r.cliente ?? '').trim(),
    clienteFinal: String(r.cliente_final ?? '').trim(),
    situacao,
    classe: classificarSituacao(situacao),
    atrasado: atrasado(situacao, prontoEm, hoje),
    prontoEm,
    dataEntrega: dataISO(r.data_entrega),
    comPerfil: !!r.comPerfil,
    comVidro: !!r.comVidro,
    comSerralheria: !!r.comSerralheria,
    comPintura: !!r.comPintura,
    valor: Number(r.valor) || 0
  };
}

// Pedidos já montados -> [{ data, qtdPedidos, qtdAtrasados, pedidos }] em ordem de data; dentro do dia, por número.
// `situacao`: 'abertos' tira o que não está em aberto; 'todos' mantém tudo.
function agruparPorDia(pedidos, situacao = 'abertos') {
  const porDia = new Map();
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    if (!p.prontoEm) continue;
    if (situacao === 'abertos' && !emAberto(p.situacao)) continue;
    if (!porDia.has(p.prontoEm)) porDia.set(p.prontoEm, []);
    porDia.get(p.prontoEm).push(p);
  }
  return [...porDia.keys()].sort().map(data => {
    const lista = porDia.get(data).sort((a, b) => Number(a.numero) - Number(b.numero));
    return { data, qtdPedidos: lista.length, qtdAtrasados: lista.filter(p => p.atrasado).length, pedidos: lista };
  });
}

module.exports = { SITUACOES_FILTRO, diasNoMes, somarDias, validarData, validarMes, validarSituacao, classificarSituacao, emAberto, atrasado, dataISO, montarPedido, agruparPorDia };
