// Central de Gestão, entrega 1: contas puras (sem banco) sobre linhas já lidas.
// Dinheiro: tudo é somado em centavos inteiros (a base do VB é DOUBLE) e devolvido em reais com 2 casas.
// Divisão por zero ou denominador ausente = "não calculável" (null + motivo), nunca 0 nem Infinity.
// Previsto (A Receber / A Pagar) nunca é somado ao realizado (Recebido / Pago).

// ----- regras adotadas (constantes nomeadas; mudar aqui muda o sistema inteiro) -----
// limiares do consumo do orçamento, em % do orçado: atenção >= 70, alerta >= 85, estouro >= 100
const LIMIARES_PADRAO = Object.freeze({ atencao: 70, alerta: 85, estouro: 100 });
// a projeção linear só é confiável depois de alguns dias do mês; antes disso é "dados insuficientes"
const MIN_DIAS_PROJECAO = 7;
const SEM_CATEGORIA = 'Sem categoria';
const FONTES = Object.freeze({ fluxo: 'fluxo_de_caixa (VB)', pedidos: 'ped_orc (VB)', metas: 'web_gestao_metas', orcamento: 'web_gestao_orcamento' });
// o que esta entrega NÃO resolve (devolvido ao painel para a tela avisar)
const LIMITACOES = Object.freeze([
  'O fluxo de caixa do VB guarda uma data só por lançamento: vencimento e pagamento não são separados.',
  'Não há saldo inicial: o resultado do mês é entradas menos saídas, não o saldo em conta.',
  'Transferências entre contas não são tratadas: entram como entrada ou saída comuns.',
  'Faturamento vem dos pedidos (ped_orc) e caixa vem do fluxo (fluxo_de_caixa): são visões diferentes e não fecham entre si.'
]);

// ----- dinheiro -----
const centavos = v => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const reais = c => c / 100;
const arred2 = n => Math.round(n * 100) / 100;
const numeroOuNull = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// ----- texto / situação -----
// sem acento, sem espaços nas pontas, minúsculas: 'A receber' e 'A Receber' (caixa mista no VB) viram a mesma coisa
const normalizar = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const SITUACOES = { 'recebido': 'recebido', 'a receber': 'a_receber', 'pago': 'pago', 'a pagar': 'a_pagar', 'faturado': 'faturado', 'protestado': 'protestado', 'atrasado': 'atrasado' };
const classificarSituacao = s => SITUACOES[normalizar(s)] || 'outra';

// ----- meses -----
const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const mesValido = m => MES_RE.test(String(m ?? ''));
const p2 = n => String(n).padStart(2, '0');
const diasNoMes = m => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).getUTCDate(); };
const mesDeData = d => { const m = String(d ?? '').slice(0, 7); return mesValido(m) ? m : null; };
function somarMeses(m, n) { const [a, mm] = m.split('-').map(Number); const t = a * 12 + (mm - 1) + n; return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`; }
const mesAnterior = m => somarMeses(m, -1);
const mesmoMesAnoAnterior = m => somarMeses(m, -12);

// Situação do período em relação a "hoje" (AAAA-MM-DD, fuso de Brasília, informado por quem chama).
// completo: mês já terminou; emAndamento: é o mês de hoje (dados parciais); futuro: ainda não começou.
function periodoDoMes(mes, hoje) {
  const total = diasNoMes(mes);
  const mesHoje = mesDeData(hoje);
  const base = { mes, inicio: `${mes}-01`, fim: `${mes}-${p2(total)}`, diasNoMes: total, hoje };
  if (!mesHoje || mes < mesHoje) return { ...base, completo: true, emAndamento: false, futuro: false, dia: total };
  if (mes > mesHoje) return { ...base, completo: false, emAndamento: false, futuro: true, dia: 0 };
  return { ...base, completo: false, emAndamento: true, futuro: false, dia: Number(hoje.slice(8, 10)) };
}

// ----- caixa por mês -----
// grupos: [{ mes, situacao, entrada, qtd, soma }]  (uma linha por mês + situação + sentido, já somada no banco)
// Recebido = entrada realizada; Pago = saída realizada; A Receber / A Pagar = previsto.
// Atrasado/Protestado de entrada (cliente e sem fornecedor) = recebível já marcado como vencido.
function agregarCaixaPorMes(grupos) {
  const meses = {};
  for (const g of grupos || []) {
    const mes = mesDeData(g.mes);
    if (!mes) continue;
    const m = meses[mes] || (meses[mes] = { recebido: 0, pago: 0, aReceber: 0, aPagar: 0, marcadosAtrasado: 0, qtdLancamentos: 0 });
    const c = centavos(g.soma);
    m.qtdLancamentos += Number(g.qtd) || 0;
    switch (classificarSituacao(g.situacao)) {
      case 'recebido': m.recebido += c; break;
      case 'pago': m.pago += c; break;
      case 'a_receber': m.aReceber += c; break;
      case 'a_pagar': m.aPagar += c; break;
      case 'atrasado': case 'protestado': if (g.entrada) m.marcadosAtrasado += c; break;
      default: break;
    }
  }
  for (const m of Object.values(meses)) for (const k of ['recebido', 'pago', 'aReceber', 'aPagar', 'marcadosAtrasado']) m[k] = reais(m[k]);
  return meses;
}

// Realizado e previsto do mês, sempre separados. Mês sem nenhum lançamento: semLancamentos (zeros não são "dado").
function caixaDoMes(porMes, mes) {
  const m = porMes[mes];
  const z = m || { recebido: 0, pago: 0, aReceber: 0, aPagar: 0, marcadosAtrasado: 0, qtdLancamentos: 0 };
  return {
    mes, semLancamentos: !m,
    realizado: { entradas: z.recebido, saidas: z.pago, resultado: reais(centavos(z.recebido) - centavos(z.pago)) },
    previsto: { aReceber: z.aReceber, aPagar: z.aPagar },
    marcadosAtrasado: z.marcadosAtrasado,
    qtdLancamentos: z.qtdLancamentos
  };
}

// ----- variação e metas -----
// absoluta = atual - base; percentual = absoluta / |base| * 100 (2 casas); base 0 ou ausente => percentual null
function variacao(atual, base) {
  const a = numeroOuNull(atual), b = numeroOuNull(base);
  if (a === null || b === null) return { absoluta: null, percentual: null, motivo: 'Sem dado do período de comparação.' };
  const dif = centavos(a) - centavos(b);
  if (centavos(b) === 0) return { absoluta: reais(dif), percentual: null, motivo: 'Base igual a zero: percentual não calculável.' };
  return { absoluta: reais(dif), percentual: arred2((dif / Math.abs(centavos(b))) * 100), motivo: null };
}

// realizado x meta: percentual = realizado / meta * 100; diferença = realizado - meta
// estado: 'ok' | 'sem_meta' (nenhuma meta gravada) | 'nao_calculavel' (meta zero ou realizado ausente)
function compararMeta({ realizado, meta }) {
  const r = numeroOuNull(realizado), m = numeroOuNull(meta);
  if (m === null) return { estado: 'sem_meta', realizado: r, meta: null, percentual: null, diferenca: null, motivo: 'Nenhuma meta definida para este mês.' };
  if (r === null) return { estado: 'nao_calculavel', realizado: null, meta: m, percentual: null, diferenca: null, motivo: 'Sem valor realizado para comparar.' };
  const dif = reais(centavos(r) - centavos(m));
  if (centavos(m) === 0) return { estado: 'nao_calculavel', realizado: r, meta: m, percentual: null, diferenca: dif, motivo: 'Meta igual a zero: percentual não calculável.' };
  return { estado: 'ok', realizado: r, meta: m, percentual: arred2((centavos(r) / centavos(m)) * 100), diferenca: dif, motivo: null };
}

// ----- progresso de orçamento / meta de despesa -----
// limiares próprios só valem se 0 < atenção < alerta <= 100; senão volta ao padrão
function limiaresEfetivos(l) {
  const a = numeroOuNull(l?.atencao), b = numeroOuNull(l?.alerta);
  const atencao = a ?? LIMIARES_PADRAO.atencao, alerta = b ?? LIMIARES_PADRAO.alerta;
  if (atencao > 0 && atencao < alerta && alerta <= LIMIARES_PADRAO.estouro) return { atencao, alerta, estouro: LIMIARES_PADRAO.estouro };
  return { ...LIMIARES_PADRAO };
}

const GRAVIDADE_NIVEL = { estourado: 3, alerta: 2, risco_ritmo: 2, atencao: 1, ok: 0, sem_orcamento: -1, nao_calculavel: -1 };
const ROTULO_NIVEL = {
  estourado: 'Estourado', alerta: 'Alerta', risco_ritmo: 'Risco pelo ritmo', atencao: 'Atenção', ok: 'Dentro do orçado',
  sem_orcamento: 'Sem orçamento', nao_calculavel: 'Não calculável'
};

// orçado x consumido (consumido = realizado pago)
//  consumidoPct = consumido / orçado * 100        saldo = orçado - consumido
//  projeção linear (só mês em andamento) = consumido / dia * dias do mês; mês fechado: projeção = consumido
//  risco pelo ritmo = projeção > orçado ainda sem ter estourado (consumido < 100%); exige >= MIN_DIAS_PROJECAO dias
//  risco: >= estouro 'estourado'; >= alerta 'alerta'; >= atenção 'atencao'; risco pelo ritmo; senão 'ok'
function progressoOrcamento({ orcado, consumido, periodo, limiares } = {}) {
  const lim = limiaresEfetivos(limiares);
  const o = numeroOuNull(orcado);
  const c = numeroOuNull(consumido) ?? 0;
  const base = { orcado: o, consumido: c, limiares: lim, consumidoPct: null, saldo: null, projecao: null, riscoRitmo: false, dadosInsuficientes: false, motivo: null };
  const pronto = (risco, extra = {}) => ({ ...base, ...extra, risco, rotuloRisco: ROTULO_NIVEL[risco] });
  if (o === null) return pronto('sem_orcamento', { motivo: 'Nenhum orçamento/meta definido para este período.' });
  if (centavos(o) <= 0) return pronto('nao_calculavel', { saldo: reais(centavos(o) - centavos(c)), motivo: 'Orçamento igual a zero: percentual não calculável.' });
  const bruto = (centavos(c) / centavos(o)) * 100;   // limiares comparam o valor exato; o arredondado é só para mostrar
  const pct = arred2(bruto);
  const saldo = reais(centavos(o) - centavos(c));
  let projecao = null, dadosInsuficientes = false, motivo = null;
  if (!periodo || periodo.completo) projecao = c;
  else if (periodo.futuro) { dadosInsuficientes = true; motivo = 'O mês ainda não começou: sem projeção.'; }
  else if (periodo.dia < MIN_DIAS_PROJECAO) { dadosInsuficientes = true; motivo = `Menos de ${MIN_DIAS_PROJECAO} dias decorridos: projeção pelo ritmo ainda não é confiável.`; }
  else projecao = reais(Math.round((centavos(c) * periodo.diasNoMes) / periodo.dia));
  const riscoRitmo = projecao !== null && centavos(projecao) > centavos(o) && bruto < lim.estouro;
  let risco = 'ok';
  if (bruto >= lim.estouro) risco = 'estourado';
  else if (bruto >= lim.alerta) risco = 'alerta';
  else if (bruto >= lim.atencao) risco = 'atencao';
  else if (riscoRitmo) risco = 'risco_ritmo';
  return pronto(risco, { consumidoPct: pct, saldo, projecao, riscoRitmo, dadosInsuficientes, motivo });
}

// ----- categorias (fluxo_de_caixa_classificacao) -----
// Orçamento no nível 1 (CLASSE1) ou 2 (CLASSE1 + CLASSE2). A chave ignora caixa e acento.
function chaveCategoria(c, nivel) {
  return nivel === 2 ? `${normalizar(c.classe1)}|${normalizar(c.classe2)}` : normalizar(c.classe1);
}
function rotuloCategoria(c, nivel) {
  const n1 = String(c.classe1 || '').trim() || '(sem nome)';
  return nivel === 2 ? `${n1} › ${String(c.classe2 || '').trim() || '(sem nome)'}` : n1;
}
const ehSaida = c => normalizar(c?.tipo) === 'saida';

// Orçamentos x realizado por categoria.
//  classificacoes: [{ id, tipo, classe1, classe2, classe3 }]
//  grupos: [{ classificacaoId, situacao, qtd, soma }]  (só Pago / A Pagar entram; o resto é ignorado)
//  orcamentos: [{ id, classificacaoId, nivel, valor, limiarAtencao, limiarAlerta }]
// Categoria com gasto e sem orçamento aparece "sem orçamento" (no nível 1), exceto se já há orçamento de nível 2 dentro dela.
function orcamentoPorCategoria({ classificacoes = [], grupos = [], orcamentos = [], periodo } = {}) {
  const porId = new Map(classificacoes.map(c => [Number(c.id), c]));
  const n1 = new Map(), n2 = new Map();
  const semCat = { pago: 0, aPagar: 0, qtdLancamentos: 0 };
  let pagoTotal = 0, aPagarTotal = 0;
  const somar = (mapa, chave, rotulo, tipo, c, qtd) => {
    const x = mapa.get(chave) || { rotulo, pago: 0, aPagar: 0, qtdLancamentos: 0 };
    x[tipo] += c; x.qtdLancamentos += qtd; mapa.set(chave, x);
  };
  for (const g of grupos) {
    const sit = classificarSituacao(g.situacao);
    if (sit !== 'pago' && sit !== 'a_pagar') continue;
    const tipo = sit === 'pago' ? 'pago' : 'aPagar';
    const c = centavos(g.soma), qtd = Number(g.qtd) || 0;
    if (tipo === 'pago') pagoTotal += c; else aPagarTotal += c;
    const cat = porId.get(Number(g.classificacaoId));
    if (!cat) { semCat[tipo] += c; semCat.qtdLancamentos += qtd; continue; }
    somar(n1, chaveCategoria(cat, 1), rotuloCategoria(cat, 1), tipo, c, qtd);
    somar(n2, chaveCategoria(cat, 2), rotuloCategoria(cat, 2), tipo, c, qtd);
  }
  const itens = [];
  const usados1 = new Set();
  for (const o of orcamentos) {
    const nivel = Number(o.nivel) === 2 ? 2 : 1;
    const cat = porId.get(Number(o.classificacaoId));
    const real = cat ? (nivel === 2 ? n2 : n1).get(chaveCategoria(cat, nivel)) : null;
    if (cat) usados1.add(chaveCategoria(cat, 1));
    const pago = reais(real?.pago || 0), aPagar = reais(real?.aPagar || 0);
    const prog = progressoOrcamento({ orcado: o.valor, consumido: pago, periodo, limiares: { atencao: o.limiarAtencao, alerta: o.limiarAlerta } });
    const comprometidoPct = centavos(o.valor) > 0 ? arred2(((centavos(pago) + centavos(aPagar)) / centavos(o.valor)) * 100) : null;
    itens.push({
      orcamentoId: o.id ?? null, classificacaoId: Number(o.classificacaoId), nivel,
      rotulo: cat ? rotuloCategoria(cat, nivel) : `Categoria ${o.classificacaoId} (não encontrada)`,
      categoriaRemovida: !cat,
      ...prog, realizadoPago: pago, aPagar, comprometidoPct, qtdLancamentos: real?.qtdLancamentos || 0
    });
  }
  for (const [chave, x] of n1) {
    if (usados1.has(chave)) continue;
    const pago = reais(x.pago), aPagar = reais(x.aPagar);
    itens.push({
      orcamentoId: null, classificacaoId: null, nivel: 1, rotulo: x.rotulo, categoriaRemovida: false,
      ...progressoOrcamento({ orcado: null, consumido: pago, periodo }), realizadoPago: pago, aPagar, comprometidoPct: null, qtdLancamentos: x.qtdLancamentos
    });
  }
  // mais grave primeiro; empate por nome
  itens.sort((a, b) => (GRAVIDADE_NIVEL[b.risco] - GRAVIDADE_NIVEL[a.risco]) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  const comOrcamento = itens.filter(i => i.orcado !== null);
  return {
    itens,
    semCategoria: { rotulo: SEM_CATEGORIA, realizadoPago: reais(semCat.pago), aPagar: reais(semCat.aPagar), qtdLancamentos: semCat.qtdLancamentos },
    totais: {
      orcado: reais(comOrcamento.reduce((s, i) => s + centavos(i.orcado), 0)),
      realizadoPago: reais(pagoTotal), aPagar: reais(aPagarTotal)
    },
    qtdSemOrcamento: itens.length - comOrcamento.length
  };
}

const GRAVIDADE_ALERTA = { critico: 3, atencao: 2, info: 1 };
const moedaBR = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Alertas calculados na hora (nada é gravado, nada bloqueia nada). Cada um traz motivo, período e fonte.
//  despesa: { progresso }  faturamento: { comparacao }  orcamento: resultado de orcamentoPorCategoria
//  vencidos: { aReceberVencido, marcadosAtrasado, maisAntigo }  qtdSemCategoria: lançamentos de saída do mês sem categoria
function gerarAlertas({ periodo, faturamento, despesa, orcamento, vencidos, qtdSemCategoria } = {}) {
  const lista = [];
  const mes = periodo.mes;
  const add = (codigo, gravidade, titulo, motivo, fonte) => lista.push({ codigo, gravidade, titulo, motivo, periodo: mes, fonte });
  const p = despesa?.progresso;
  if (p && !['ok', 'sem_orcamento', 'nao_calculavel'].includes(p.risco)) {
    const t = { estourado: ['despesa_acima_meta', 'critico', 'Despesa acima da meta'], alerta: ['despesa_perto_meta', 'atencao', 'Despesa perto da meta'],
      atencao: ['despesa_atencao_meta', 'info', 'Despesa consumindo a meta'], risco_ritmo: ['despesa_ritmo', 'atencao', 'Despesa pode estourar a meta pelo ritmo'] }[p.risco];
    add(t[0], t[1], t[2], p.risco === 'risco_ritmo'
      ? `Pago ${moedaBR(p.consumido)} (${p.consumidoPct}% da meta de ${moedaBR(p.orcado)}); no ritmo do mês chegaria a ${moedaBR(p.projecao)}.`
      : `Pago ${moedaBR(p.consumido)} de uma meta de ${moedaBR(p.orcado)} (${p.consumidoPct}%).`, FONTES.fluxo + ' + ' + FONTES.metas);
  }
  for (const i of orcamento?.itens || []) {
    if (i.orcado === null || ['ok', 'nao_calculavel', 'sem_orcamento'].includes(i.risco)) continue;
    const g = { estourado: 'critico', alerta: 'atencao', atencao: 'info', risco_ritmo: 'atencao' }[i.risco];
    add('orcamento_' + i.risco, g, `${i.rotulo}: ${i.rotuloRisco.toLowerCase()}`,
      i.risco === 'risco_ritmo'
        ? `Pago ${moedaBR(i.consumido)} (${i.consumidoPct}% do orçado de ${moedaBR(i.orcado)}); no ritmo do mês chegaria a ${moedaBR(i.projecao)}.`
        : `Pago ${moedaBR(i.consumido)} do orçado de ${moedaBR(i.orcado)} (${i.consumidoPct}%).`, FONTES.fluxo + ' + ' + FONTES.orcamento);
  }
  if (vencidos && centavos(vencidos.aReceberVencido) > 0) {
    add('a_receber_vencido', 'atencao', 'Recebimentos vencidos',
      `${moedaBR(vencidos.aReceberVencido)} em "A Receber" com data anterior a ${periodo.hoje}` + (vencidos.maisAntigo ? ` (o mais antigo é de ${vencidos.maisAntigo})` : '') + '. Sem tolerância de dias.', FONTES.fluxo);
  }
  if (vencidos && centavos(vencidos.marcadosAtrasado) > 0) {
    add('recebiveis_marcados_atrasados', 'atencao', 'Recebimentos marcados como atrasados ou protestados',
      `${moedaBR(vencidos.marcadosAtrasado)} de clientes com situação Atrasado ou Protestado no fluxo de caixa.`, FONTES.fluxo);
  }
  if (qtdSemCategoria > 0) {
    add('sem_categoria', 'info', 'Lançamentos de saída sem categoria',
      `${qtdSemCategoria} lançamento(s) pagos ou a pagar no mês não têm categoria válida; o orçamento por categoria fica incompleto.`, FONTES.fluxo);
  }
  const fc = faturamento?.comparacao;
  if (fc && fc.estado === 'ok' && periodo.completo && fc.percentual < 100) {
    add('faturamento_abaixo_meta', 'info', 'Faturamento abaixo da meta',
      `Faturado ${moedaBR(fc.realizado)} de uma meta de ${moedaBR(fc.meta)} (${fc.percentual}%) no mês fechado.`, FONTES.pedidos + ' + ' + FONTES.metas);
  }
  lista.sort((a, b) => GRAVIDADE_ALERTA[b.gravidade] - GRAVIDADE_ALERTA[a.gravidade]);
  return lista;
}

module.exports = {
  LIMIARES_PADRAO, MIN_DIAS_PROJECAO, SEM_CATEGORIA, FONTES, LIMITACOES, GRAVIDADE_NIVEL, ROTULO_NIVEL,
  centavos, reais, arred2, numeroOuNull, normalizar, classificarSituacao, mesValido, diasNoMes, mesDeData, somarMeses, mesAnterior, mesmoMesAnoAnterior, periodoDoMes,
  agregarCaixaPorMes, caixaDoMes, variacao, compararMeta, limiaresEfetivos, progressoOrcamento, chaveCategoria, rotuloCategoria, ehSaida, orcamentoPorCategoria, gerarAlertas
};
