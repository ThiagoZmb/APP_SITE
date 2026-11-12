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

// ---------- itens do pedido (ped_orc_lista_itens) para o balão ----------
// Só texto legível, sem dinheiro (UNITARIO/TOTAL/PORCENTAGEM nem são lidos). O balão mostra no máximo MAX_ITENS_BALAO por pedido.
const MAX_ITENS_BALAO = 15;
const MAX_TEXTO_ITEM = 90;
const limpar = s => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
const cortar = (s, n = MAX_TEXTO_ITEM) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// Linha de ped_orc_lista_itens -> { qtd, texto } ou null (item sem nenhum texto).
//  - Portas (DESCRICAO de várias linhas "Tamanho: 2425x670 mm / Perfil: 1036 (Anodizado Bronze)"): "Porta de giro 2425 × 670 – Perfil 1036 (Anodizado Bronze)"
//  - Porta de correr (uma linha "Tam: ... | Per: ..."): idem
//  - Demais (Serviço, Revestimento, Metalons, Perfil...): "Tipo: descrição" (a descrição é cortada em 90 caracteres)
function linhaItem(r) {
  const tipo = limpar(r.TIPO_PRODUTO ?? r.tipo_produto);
  const bruta = String(r.DESCRICAO ?? r.descricao ?? '');
  const qtd = Math.max(1, parseInt(r.QTD ?? r.qtd, 10) || 1);
  let texto = '';
  const tam = /(?:Tamanho|Tam):\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*mm/i.exec(bruta);
  if (tam && /^porta|^frente/i.test(tipo)) {
    const perfil = /(?:Perfil|Per):\s*([^\r\n|]+)/i.exec(bruta);
    texto = `${tipo} ${tam[1]} × ${tam[2]}${perfil && limpar(perfil[1]) ? ' – Perfil ' + limpar(perfil[1]) : ''}`;
  } else {
    const desc = limpar(bruta.split(/\r?\n/)[0]);
    const obs = limpar(r.OBSERVACAO ?? r.observacao);
    // estrutura de serralheria "editável" só diz isso: a observação (ex.: "estrutura cama cor Ligth gold") é o que identifica o item
    const base = (/edit[aá]vel/i.test(desc) && obs ? obs : desc) || limpar(r.PRODUTO ?? r.produto);
    texto = !base ? tipo : !tipo || base.toLowerCase() === tipo.toLowerCase() ? base : `${tipo}: ${base}`;
  }
  texto = cortar(limpar(texto));
  return texto ? { qtd, texto } : null;
}

// Linhas de ped_orc_lista_itens (qualquer ordem) -> Map numero -> { itens: [{ qtd, texto }] (até MAX_ITENS_BALAO, na ordem do ITEM), qtdItens (total real) }
function agruparItens(linhas) {
  const porPedido = new Map();
  for (const r of Array.isArray(linhas) ? linhas : []) {
    const numero = Number(r.NUMERO ?? r.numero);
    if (!porPedido.has(numero)) porPedido.set(numero, []);
    porPedido.get(numero).push(r);
  }
  const saida = new Map();
  for (const [numero, lista] of porPedido) {
    const itens = lista.sort((a, b) => (Number(a.ITEM ?? a.item) || 0) - (Number(b.ITEM ?? b.item) || 0)).map(linhaItem).filter(Boolean);
    if (itens.length) saida.set(numero, { itens: itens.slice(0, MAX_ITENS_BALAO), qtdItens: itens.length });
  }
  return saida;
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
    itens: Array.isArray(r.itens) ? r.itens : [],
    qtdItens: Number(r.qtdItens) || 0,
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

module.exports = { SITUACOES_FILTRO, diasNoMes, somarDias, validarData, validarMes, validarSituacao, classificarSituacao, emAberto, atrasado, dataISO, montarPedido, agruparPorDia, MAX_ITENS_BALAO, linhaItem, agruparItens };
