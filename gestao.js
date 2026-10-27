// ==========================================================================
// gestao.html — Central de Gestão, entrega 1 (metas, caixa realizado x previsto, orçamento por categoria, alertas).
// Rotas: GET /gestao/painel, GET /gestao/orcamento, GET /gestao/metas_vb, PUT /gestao/meta, PUT /gestao/orcamento.
// Funções puras testadas no Node (test/gestao_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou value/textContent. Quem decide o acesso é o servidor.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Gestao = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt } = C;

  // ---------- formatação ----------
  const moeda = n => (n === null || n === undefined || !Number.isFinite(Number(n))) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = n => (n === null || n === undefined || !Number.isFinite(Number(n))) ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
  const sinal = n => (n === null || n === undefined) ? '—' : (Number(n) > 0 ? '+' : '') + moeda(n);

  // mesmo critério do servidor: >= 0, até 2 casas; "1.500" sozinho é ambíguo e recusado
  function lerDinheiro(v) {
    const s = txt(v).replace(/^R\$\s*/i, '');
    let n;
    if (/^\d+$/.test(s)) n = s;
    else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) n = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d+,\d{1,2}$/.test(s)) n = s.replace(',', '.');
    else if (/^\d+\.\d{1,2}$/.test(s)) n = s;
    else return NaN;
    return Number(n);
  }
  const paraCampo = n => String(n ?? '').replace('.', ',');
  const mesValido = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(txt(m));
  function somarMeses(m, n) { const [a, mm] = m.split('-').map(Number); const t = a * 12 + (mm - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; }
  const mesDeHoje = (agora = new Date()) => `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const rotuloMes = m => { if (!mesValido(m)) return ''; const [a, mm] = m.split('-'); return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(mm) - 1] + ' de ' + a; };

  // ---------- texto dos estados ----------
  // realizado x meta: sempre diz o que aconteceu ("sem meta", "não calculável") em vez de mostrar 0 ou NaN
  function textoComparacao(c) {
    if (!c) return { principal: '—', detalhe: '' };
    if (c.estado === 'sem_meta') return { principal: 'Sem meta', detalhe: c.motivo || 'Nenhuma meta definida para este mês.' };
    if (c.estado === 'nao_calculavel') return { principal: 'Não calculável', detalhe: c.motivo || '' };
    return { principal: pct(c.percentual) + ' da meta', detalhe: `Diferença: ${sinal(c.diferenca)}` };
  }
  function textoVariacao(v, rotulo) {
    if (!v || v.absoluta === null) return `${rotulo}: sem dado para comparar`;
    if (v.percentual === null) return `${rotulo}: ${sinal(v.absoluta)} (percentual não calculável)`;
    return `${rotulo}: ${sinal(v.absoluta)} (${v.percentual > 0 ? '+' : ''}${pct(v.percentual)})`;
  }
  // risco: sempre texto + símbolo além da cor
  const RISCO = {
    estourado: { texto: 'Estourado', simbolo: '✖', classe: 'perigo' },
    alerta: { texto: 'Alerta', simbolo: '▲', classe: 'perigo' },
    risco_ritmo: { texto: 'Risco pelo ritmo', simbolo: '▲', classe: 'aviso' },
    atencao: { texto: 'Atenção', simbolo: '●', classe: 'aviso' },
    ok: { texto: 'Dentro do orçado', simbolo: '✔', classe: 'ok' },
    sem_orcamento: { texto: 'Sem orçamento', simbolo: '–', classe: 'neutro' },
    nao_calculavel: { texto: 'Não calculável', simbolo: '?', classe: 'neutro' }
  };
  const riscoDe = r => RISCO[r] || RISCO.nao_calculavel;
  // largura da barra de consumo, limitada a 0-100 (o excedente aparece no texto)
  const larguraBarra = p => (p === null || p === undefined || !Number.isFinite(Number(p))) ? 0 : Math.max(0, Math.min(100, Number(p)));

  // ---------- corpos de envio ----------
  const corpoMeta = f => ({ mes: txt(f.mes), tipo: txt(f.tipo), valor: txt(f.valor), origem: f.origem === 'vb' ? 'vb' : 'web' });
  function corpoOrcamento(f) {
    const b = { mes: txt(f.mes), classificacaoId: Number(f.classificacaoId) || 0, nivel: Number(f.nivel) === 2 ? 2 : 1, valor: txt(f.valor) };
    if (txt(f.limiarAtencao)) b.limiarAtencao = txt(f.limiarAtencao);
    if (txt(f.limiarAlerta)) b.limiarAlerta = txt(f.limiarAlerta);
    return b;
  }
  function validarMetaForm(f) {
    const erros = [];
    if (!mesValido(f.mes)) erros.push('Escolha o mês.');
    if (!['faturamento', 'despesa'].includes(txt(f.tipo))) erros.push('Escolha o tipo da meta.');
    if (Number.isNaN(lerDinheiro(f.valor))) erros.push('Valor inválido (números maiores ou iguais a zero, ex.: 1500,50).');
    return erros;
  }
  function validarOrcamentoForm(f) {
    const erros = [];
    if (!mesValido(f.mes)) erros.push('Escolha o mês.');
    if (!(Number(f.classificacaoId) > 0)) erros.push('Escolha a categoria.');
    if (Number.isNaN(lerDinheiro(f.valor))) erros.push('Valor inválido (números maiores ou iguais a zero, ex.: 1500,50).');
    const a = txt(f.limiarAtencao).replace(',', '.'), b = txt(f.limiarAlerta).replace(',', '.');
    if (a && !(Number(a) >= 1 && Number(a) <= 100)) erros.push('Limiar de atenção entre 1 e 100.');
    if (b && !(Number(b) >= 1 && Number(b) <= 100)) erros.push('Limiar de alerta entre 1 e 100.');
    if (!erros.length && !((a ? Number(a) : 70) < (b ? Number(b) : 85))) erros.push('O limiar de atenção deve ser menor que o de alerta.');
    return erros;
  }

  // ---------- HTML dos blocos (puro: recebe dados, devolve texto já escapado) ----------
  function htmlCartao(titulo, dados, comparacao, extras = []) {
    const t = textoComparacao(comparacao);
    return `<h3>${esc(titulo)}</h3>` +
      `<p class="grande">${esc(moeda(dados.realizado))}</p>` +
      `<p class="cinza">Meta: ${dados.meta === null || dados.meta === undefined ? 'sem meta' : esc(moeda(dados.meta)) + (dados.origemMeta === 'vb' ? ' (confirmada a partir do VB)' : '')}</p>` +
      `<p><span class="selo ${comparacao && comparacao.estado === 'ok' ? 'info' : 'neutro'}">${esc(t.principal)}</span></p>` +
      `<p class="cinza">${esc(t.detalhe)}</p>` +
      extras.map(x => `<p class="cinza">${esc(x)}</p>`).join('') +
      `<p class="fonte">Fonte: ${esc(dados.fonte || '')}</p>`;
  }
  function htmlCaixa(caixa) {
    const r = caixa.realizado, p = caixa.previsto;
    return `<div class="duas">` +
      `<div class="bloco realizado"><h4>Realizado (já aconteceu)</h4><p class="cinza">Recebido e Pago no mês.</p>` +
      `<dl class="info"><dt>Entradas (Recebido)</dt><dd>${esc(moeda(r.entradas))}</dd><dt>Saídas (Pago)</dt><dd>${esc(moeda(r.saidas))}</dd><dt>Resultado do mês</dt><dd><b>${esc(moeda(r.resultado))}</b></dd></dl></div>` +
      `<div class="bloco previsto"><h4>Previsto (ainda não é caixa)</h4><p class="cinza">Previsão não é caixa: A Receber e A Pagar não entram no realizado.</p>` +
      `<dl class="info"><dt>A Receber</dt><dd>${esc(moeda(p.aReceber))}</dd><dt>A Pagar</dt><dd>${esc(moeda(p.aPagar))}</dd></dl></div></div>` +
      (caixa.semLancamentos ? '<p class="cinza">Nenhum lançamento no fluxo de caixa neste mês.</p>' : '') +
      `<p class="cinza">${esc(textoVariacao(caixa.mesAnterior && caixa.mesAnterior.variacaoEntradas, 'Entradas vs. mês anterior'))}</p>` +
      `<p class="cinza">${esc(textoVariacao(caixa.mesAnterior && caixa.mesAnterior.variacaoSaidas, 'Saídas vs. mês anterior'))}</p>` +
      `<p class="cinza">${esc(textoVariacao(caixa.anoAnterior && caixa.anoAnterior.variacaoEntradas, 'Entradas vs. mesmo mês do ano anterior'))}</p>` +
      `<p class="cinza">${esc(textoVariacao(caixa.anoAnterior && caixa.anoAnterior.variacaoSaidas, 'Saídas vs. mesmo mês do ano anterior'))}</p>` +
      `<p class="fonte">Fonte: ${esc(caixa.fonte || '')}</p>`;
  }
  function htmlAlertas(alertas) {
    if (!alertas || !alertas.length) return '<p class="vazio">Nenhum alerta para este mês. Os alertas são calculados na hora a partir dos dados do VB e das metas; eles só informam, não bloqueiam nada.</p>';
    const classe = { critico: 'perigo', atencao: 'aviso', info: 'info' };
    const nome = { critico: 'Crítico', atencao: 'Atenção', info: 'Informação' };
    return '<ul class="alertas">' + alertas.map(a =>
      `<li><span class="selo ${classe[a.gravidade] || 'neutro'}">${esc(nome[a.gravidade] || a.gravidade)}</span> <b>${esc(a.titulo)}</b>` +
      `<br><span>${esc(a.motivo)}</span><br><span class="fonte">Período: ${esc(a.periodo)} · Fonte: ${esc(a.fonte)}</span></li>`).join('') + '</ul>';
  }
  function htmlOrcamento(o) {
    if (!o || !o.itens || (!o.itens.length && !(o.semCategoria && o.semCategoria.qtdLancamentos))) {
      return '<p class="vazio">Nenhuma despesa paga ou a pagar neste mês e nenhum orçamento definido. Use o formulário abaixo para definir o orçamento de uma categoria.</p>';
    }
    const linhas = o.itens.map(i => {
      const r = riscoDe(i.risco);
      const barra = i.orcado === null ? '<span class="cinza">sem orçamento</span>'
        : `<div class="trilho" role="img" aria-label="${esc(pct(i.consumidoPct))} consumido"><div class="enche ${r.classe}" style="width:${larguraBarra(i.consumidoPct)}%"></div></div>` +
          `<span class="cinza">${esc(i.consumidoPct === null ? 'não calculável' : pct(i.consumidoPct) + ' consumido')}</span>`;
      const proj = i.orcado === null ? '' : (i.projecao !== null ? moeda(i.projecao) : (i.dadosInsuficientes ? 'dados insuficientes' : '—'));
      return `<tr><td><b>${esc(i.rotulo)}</b>${i.categoriaRemovida ? ' <span class="cinza">(categoria não existe mais)</span>' : ''}<br><span class="cinza">${esc(String(i.qtdLancamentos))} lançamento(s)</span></td>` +
        `<td class="num">${i.orcado === null ? '—' : esc(moeda(i.orcado))}</td><td class="num">${esc(moeda(i.realizadoPago))}</td><td class="num">${esc(moeda(i.aPagar))}</td>` +
        `<td class="num">${i.saldo === null ? '—' : esc(moeda(i.saldo))}</td><td class="barra-col">${barra}</td><td class="num">${esc(proj)}</td>` +
        `<td><span class="selo ${r.classe}">${esc(r.simbolo + ' ' + r.texto)}</span>${i.motivo ? `<br><span class="cinza">${esc(i.motivo)}</span>` : ''}</td></tr>`;
    });
    const sc = o.semCategoria;
    if (sc && sc.qtdLancamentos > 0) {
      linhas.push(`<tr class="sem-cat"><td><b>${esc(sc.rotulo)}</b><br><span class="cinza">${esc(String(sc.qtdLancamentos))} lançamento(s) sem categoria válida: limitação de qualidade dos dados</span></td>` +
        `<td class="num">—</td><td class="num">${esc(moeda(sc.realizadoPago))}</td><td class="num">${esc(moeda(sc.aPagar))}</td><td class="num">—</td><td>—</td><td>—</td><td><span class="selo neutro">– Sem orçamento</span></td></tr>`);
    }
    return '<table><thead><tr><th>Categoria</th><th>Orçado</th><th>Pago</th><th>A pagar</th><th>Saldo</th><th>Consumo</th><th>Projeção no ritmo</th><th>Situação</th></tr></thead><tbody>' + linhas.join('') + '</tbody></table>';
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { mes: mesDeHoje(), ocupado: false, orcamento: null, vb: null, seq: 0 };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const podeEditar = () => !!(win.Acesso && win.Acesso.pode('gestao.editar'));

    function mensagemEstado(id, texto, tipo) { $(id).innerHTML = `<p class="${tipo === 'erro' ? 'erro-estado' : 'vazio'}" role="${tipo === 'erro' ? 'alert' : 'status'}">${esc(texto)}</p>`; }
    function emCarregamento() { for (const id of ['cartao-faturamento', 'cartao-despesa', 'caixa', 'alertas', 'orcamento']) mensagemEstado(id, 'Carregando…'); }

    function desenharPainel(d) {
      $('aviso-periodo').hidden = !d.avisoPeriodo;
      $('aviso-periodo').textContent = d.avisoPeriodo || '';
      const fat = d.faturamento, des = d.despesa;
      const exF = [];
      if (fat.semPedidos) exF.push('Nenhum pedido válido neste mês.');
      exF.push(textoVariacao(fat.mesAnterior && fat.mesAnterior.variacao, 'vs. mês anterior'), textoVariacao(fat.anoAnterior && fat.anoAnterior.variacao, 'vs. mesmo mês do ano anterior'));
      $('cartao-faturamento').innerHTML = htmlCartao('Faturamento x meta', fat, fat.comparacao, exF);
      const p = des.progresso;
      const exD = [];
      if (p && p.consumidoPct !== null) {
        exD.push(`Risco: ${riscoDe(p.risco).simbolo} ${riscoDe(p.risco).texto}`);
        exD.push(p.projecao !== null ? `Projeção no ritmo do mês: ${moeda(p.projecao)}` : (p.dadosInsuficientes ? `Projeção: ${p.motivo}` : ''));
      }
      $('cartao-despesa').innerHTML = htmlCartao('Despesa (paga) x meta', des, des.comparacao, exD.filter(Boolean));
      $('caixa').innerHTML = htmlCaixa(d.caixa);
      $('alertas').innerHTML = htmlAlertas(d.alertas);
      const rv = d.recebiveisVencidos;
      $('vencidos').textContent = rv && (rv.aReceberVencido > 0 || rv.marcadosAtrasado > 0)
        ? `Hoje (${d.hoje}): A Receber vencido ${moeda(rv.aReceberVencido)}; marcado como atrasado/protestado ${moeda(rv.marcadosAtrasado)}.` : '';
      $('limitacoes').innerHTML = (d.limitacoes || []).map(l => `<li>${esc(l)}</li>`).join('');
    }
    function preencherCategorias(o) {
      const sel = $('o-categoria');
      const atual = sel.value;
      // só as categorias de saída; value = id do VB (o servidor usa a "canônica" do grupo)
      sel.innerHTML = '<option value=""></option>' + (o.categorias || []).map(c =>
        `<option value="${esc(c.id)}">${esc([c.classe1, c.classe2, c.classe3].filter(Boolean).join(' › ') || 'Categoria ' + c.id)}</option>`).join('');
      sel.value = atual;
    }
    async function carregar() {
      const seq = ++estado.seq;
      emCarregamento();
      $('mes').value = estado.mes;
      $('titulo-mes').textContent = rotuloMes(estado.mes);
      const q = '?mes=' + encodeURIComponent(estado.mes);
      try {
        const [painel, orc] = await Promise.all([chamar('/gestao/painel' + q), chamar('/gestao/orcamento' + q)]);
        if (seq !== estado.seq) return; // o usuário já trocou de mês
        desenharPainel(painel);
        estado.orcamento = orc;
        $('orcamento').innerHTML = htmlOrcamento(orc);
        preencherCategorias(orc);
      } catch (err) {
        if (seq !== estado.seq) return;
        const msg = err.status === 403 ? 'Você não tem permissão para ver a Central de Gestão (é preciso também a permissão de valores financeiros).' : 'Não foi possível carregar: ' + err.message;
        for (const id of ['cartao-faturamento', 'cartao-despesa', 'caixa', 'alertas', 'orcamento']) mensagemEstado(id, msg, 'erro');
      }
    }

    async function salvarMeta(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const f = { mes: estado.mes, tipo: $('m-tipo').value, valor: $('m-valor').value, origem: estado.origemMeta || 'web' };
      const erros = validarMetaForm(f);
      $('erro-meta').textContent = erros.join(' ');
      if (erros.length) return;
      estado.ocupado = true; $('btn-meta').disabled = true;
      try {
        await chamar('/gestao/meta', { metodo: 'PUT', corpo: corpoMeta(f) });
        toast('Meta gravada.', 'ok');
        estado.origemMeta = 'web';
        await carregar();
      } catch (err) { $('erro-meta').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-meta').disabled = false; }
    }
    async function buscarVB() {
      $('erro-meta').textContent = '';
      try {
        const d = await chamar('/gestao/metas_vb?mes=' + encodeURIComponent(estado.mes));
        const tipo = $('m-tipo').value;
        const v = d.sugestao ? d.sugestao[tipo] : null;
        if (!d.disponivel || v === null || v === undefined) { toast(d.motivo || 'O VB não tem meta deste tipo para o mês.', 'info'); return; }
        $('m-valor').value = paraCampo(v);
        estado.origemMeta = 'vb';
        toast(`Sugestão do VB: ${moeda(v)}. Confira e clique em Salvar meta para confirmar.`, 'info');
      } catch (err) { toast(err.message, 'erro'); }
    }
    async function salvarOrcamento(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const f = { mes: estado.mes, classificacaoId: $('o-categoria').value, nivel: $('o-nivel').value, valor: $('o-valor').value,
        limiarAtencao: $('o-atencao').value, limiarAlerta: $('o-alerta').value };
      const erros = validarOrcamentoForm(f);
      $('erro-orc').textContent = erros.join(' ');
      if (erros.length) return;
      estado.ocupado = true; $('btn-orc').disabled = true;
      try {
        await chamar('/gestao/orcamento', { metodo: 'PUT', corpo: corpoOrcamento(f) });
        toast('Orçamento gravado.', 'ok');
        await carregar();
      } catch (err) { $('erro-orc').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-orc').disabled = false; }
    }

    function aplicarEdicao() {
      $('forms').hidden = !podeEditar();   // a segurança de verdade é no servidor (gestao.editar)
    }

    $('mes').addEventListener('change', ev => { if (mesValido(ev.target.value)) { estado.mes = ev.target.value; carregar(); } });
    $('mes-ant').addEventListener('click', () => { estado.mes = somarMeses(estado.mes, -1); carregar(); });
    $('mes-prox').addEventListener('click', () => { estado.mes = somarMeses(estado.mes, 1); carregar(); });
    $('mes-hoje').addEventListener('click', () => { estado.mes = mesDeHoje(); carregar(); });
    $('form-meta').addEventListener('submit', salvarMeta);
    $('form-orc').addEventListener('submit', salvarOrcamento);
    $('btn-vb').addEventListener('click', buscarVB);
    $('m-valor').addEventListener('input', () => { estado.origemMeta = 'web'; });
    $('m-tipo').addEventListener('change', () => { estado.origemMeta = 'web'; });
    aplicarEdicao();
    carregar();
  }

  return { moeda, pct, sinal, lerDinheiro, paraCampo, mesValido, somarMeses, mesDeHoje, rotuloMes, textoComparacao, textoVariacao, riscoDe, RISCO, larguraBarra,
    corpoMeta, corpoOrcamento, validarMetaForm, validarOrcamentoForm, htmlCartao, htmlCaixa, htmlAlertas, htmlOrcamento, iniciar };
});
