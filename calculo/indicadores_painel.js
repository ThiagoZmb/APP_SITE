// ==========================================================================
// Indicadores de Pedidos e Orçamentos ("Operação agora" e "Resultado do período"), funções puras.
// Reproduz EXATAMENTE as regras que painel_inicial.html usava no navegador (renderPeriodo / renderOperacao):
//   - períodos e período anterior equivalente (janela);
//   - situação por texto (sit); cancelado fora dos "fechados"; atraso por data prevista; "pronto parado" há mais de 7 dias.
// Datas dos registros: "dd/mm/aaaa" (ano < 1900 = vazio). "Hoje" entra como texto AAAA-MM-DD (o servidor passa o dia de São Paulo).
// Nomes: contagens são qtd*; todo dinheiro fica dentro de `valores` (removido de quem não tem valores.ver).
// Regras: docs/regras/outras-regras.md ("Indicadores de Pedidos e Orçamentos")
// ==========================================================================
const DIA = 86400000;
const PERIODOS = ['mes', 'mes-ant', '3', '6', '12', 'ano', 'tudo'];
const PERIODO_PADRAO = '6';

const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// "dd/mm/aaaa" -> Date local (meia-noite); ano < 1900 ou formato errado -> null
function deBR(s) {
  const p = String(s || '').split('/');
  return p.length === 3 && +p[2] >= 1900 ? new Date(+p[2], +p[1] - 1, +p[0]) : null;
}

// mesma lógica de index.js (dataBRSegura): coluna DATE/DATETIME ou texto dd/mm/aaaa; ano < 1900 = vazio
function dataBRSegura(v) {
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return Number(m[1]) < 1900 ? '' : `${m[3]}/${m[2]}/${m[1]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return Number(m[3]) < 1900 ? '' : `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  return '';
}

// situação (mesmas regras do resto do sistema)
function situacao(s) {
  const n = norm(s);
  return n.includes('cancel') ? 'cancelado' : n.includes('produ') ? 'producao' : (n.includes('pronto') || n.includes('finaliz') || n.includes('conclu') || n === 'ok') ? 'pronto'
    : n.includes('entreg') ? 'entregue' : n.includes('retir') ? 'retirado' : n === 'fechado' ? 'fechado' : n === 'baixado' ? 'baixado' : 'outro';
}

function validarPeriodo(v) {
  if (v === undefined || v === null || v === '') return PERIODO_PADRAO;
  const t = String(v).trim();
  return PERIODOS.includes(t) ? t : null;
}

// 'AAAA-MM-DD' -> Date local à meia-noite; texto inválido -> null
function hojeDe(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

// período e período anterior equivalente (para comparar)
function janela(valor, hoje) {
  const a = hoje.getFullYear(), m = hoje.getMonth();
  const fim = new Date(hoje.getTime() + DIA - 1);
  if (valor === 'mes') return { ini: new Date(a, m, 1), fim, iniAnt: new Date(a, m - 1, 1),
    fimAnt: new Date(a, m - 1, Math.min(hoje.getDate(), new Date(a, m, 0).getDate()), 23, 59), nome: 'este mês', ref: 'mesmo ponto do mês passado' };
  if (valor === 'mes-ant') return { ini: new Date(a, m - 1, 1), fim: new Date(a, m, 0, 23, 59), iniAnt: new Date(a, m - 2, 1), fimAnt: new Date(a, m - 1, 0, 23, 59), nome: 'mês passado', ref: 'mês anterior' };
  if (valor === 'ano') return { ini: new Date(a, 0, 1), fim, iniAnt: new Date(a - 1, 0, 1), fimAnt: new Date(a - 1, m, hoje.getDate(), 23, 59), nome: 'este ano', ref: 'mesmo período do ano passado' };
  if (valor === 'tudo') return { ini: new Date(1900, 0, 1), fim, iniAnt: null, fimAnt: null, nome: 'todo o histórico', ref: '' };
  const n = +valor, ini = new Date(a, m - n + 1, 1);
  return { ini, fim, iniAnt: new Date(a, m - 2 * n + 1, 1), fimAnt: new Date(ini.getTime() - 1), nome: `últimos ${n} meses`, ref: `${n} meses anteriores` };
}

const preparar = x => ({ ...x, dt: deBR(x.data), v: parseFloat(x.valor) || 0, s: situacao(x.situacao) });
const entre = (l, a, b) => a ? l.filter(x => x.dt && x.dt >= a && x.dt <= b) : [];
const soma = l => l.reduce((s, x) => s + x.v, 0);
const dataTxt = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;

/**
 * @param {{pedidos: object[], orcamentos: object[], periodo?: string, cliente?: string, hoje: string}} entrada
 *   linhas no formato de /dados_lista: cliente, data (dd/mm/aaaa), valor, situacao, financeiro, prontoEm, dataEntrega (dd/mm/aaaa)
 */
function calcularIndicadores({ pedidos = [], orcamentos = [], periodo = PERIODO_PADRAO, cliente = '', hoje: hojeTexto }) {
  const hoje = hojeDe(hojeTexto);
  if (!hoje) throw new Error('hoje inválido (use AAAA-MM-DD)');
  const j = janela(periodo, hoje);
  const doCliente = l => cliente ? l.filter(x => x.cliente === cliente) : l;
  const P = doCliente(pedidos.map(preparar)), O = doCliente(orcamentos.map(preparar));

  // ---- Resultado do período ----
  const validos = l => l.filter(x => x.s !== 'cancelado');
  const p = validos(entre(P, j.ini, j.fim)), pa = validos(entre(P, j.iniAnt, j.fimAnt));
  const o = entre(O, j.ini, j.fim), oa = entre(O, j.iniAnt, j.fimAnt);
  const canc = entre(P, j.ini, j.fim).filter(x => x.s === 'cancelado');
  const fat = soma(p), fatA = soma(pa), orc = soma(o), orcA = soma(oa);
  const resultado = {
    qtdPedidos: p.length, qtdPedidosAnt: pa.length,
    qtdOrcamentos: o.length, qtdOrcamentosAnt: oa.length,
    qtdCancelados: canc.length,
    qtdClientes: new Set(p.map(x => x.cliente)).size
  };
  const valoresResultado = {
    pedidos: fat, pedidosAnt: fatA, orcamentos: orc, orcamentosAnt: orcA,
    conversao: orc > 0 ? fat / orc : null, conversaoAnt: orcA > 0 ? fatA / orcA : null,
    ticketMedio: p.length ? fat / p.length : 0, ticketMedioAnt: pa.length ? fatA / pa.length : 0
  };

  // ---- Operação agora (independe do período) ----
  const hojeBR = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  const prod = P.filter(x => x.s === 'producao'), pronto = P.filter(x => x.s === 'pronto');
  const finalizado = x => ['entregue', 'retirado', 'cancelado'].includes(x.s);
  const previsto = x => deBR(x.dataEntrega) || deBR(x.prontoEm);
  const atrasadas = P.filter(x => !finalizado(x) && previsto(x) && previsto(x) < hoje);
  const prontoParado = pronto.filter(x => deBR(x.prontoEm) && (hoje - deBR(x.prontoEm)) / DIA > 7);
  const aReceber = P.filter(x => x.s !== 'cancelado' && /receber|atras|protest/.test(norm(x.financeiro)));
  const atrasoFin = aReceber.filter(x => /atras|protest/.test(norm(x.financeiro)));
  const hojeP = P.filter(x => x.data === hojeBR), hojeO = O.filter(x => x.data === hojeBR);
  const operacao = {
    qtdHojePedidos: hojeP.length, qtdHojeOrcamentos: hojeO.length,
    qtdEmProducao: prod.length, qtdProntos: pronto.length, qtdProntosParados: prontoParado.length, qtdAtrasadas: atrasadas.length
  };
  const valoresOperacao = {
    hoje: soma(hojeP), emProducao: soma(prod), prontos: soma(pronto), atrasadas: soma(atrasadas),
    aReceber: soma(aReceber), qtdAReceber: aReceber.length, atrasoFinanceiro: soma(atrasoFin), qtdAtrasoFinanceiro: atrasoFin.length
  };

  return {
    periodo: { chave: periodo, nome: j.nome, ref: j.ref, temAnterior: !!j.iniAnt, ini: dataTxt(j.ini), fim: dataTxt(j.fim), cliente: cliente || null },
    operacao, resultado,
    valores: { operacao: valoresOperacao, resultado: valoresResultado }
  };
}

module.exports = { calcularIndicadores, validarPeriodo, janela, hojeDe, deBR, dataBRSegura, situacao, PERIODOS, PERIODO_PADRAO };
