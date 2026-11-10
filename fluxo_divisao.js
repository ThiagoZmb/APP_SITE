// Recebimento dividido em várias formas de pagamento (tela financeiro.html, gaveta "Novo movimento", só Entrada nova).
// A primeira forma é a dos campos de sempre; as outras entram como linhas aqui. Tudo é enviado de uma vez a POST /fluxo/salvar_varios.
// As contas (soma, falta, aviso) são puras e testadas no Node; o resto liga a tela.
// FluxoDivisao.iniciar({ $, api, lerNumero, moeda, escapeHtml, hojeISO, pode, getMovimento }) → { reiniciar, atualizarVisibilidade, ativo, montarEnvio, rotuloSalvar, depoisDeSalvar }
(function (raiz) {
  'use strict';
  const SITUACOES_ENTRADA = ['A Receber', 'Atrasado', 'Faturado', 'Protestado', 'Recebido'];
  const MAX_LINHAS = 10;
  const arred = n => Math.round((Number(n) || 0) * 100) / 100;

  // soma de todas as linhas e só das que entram como Recebido (as "A Receber" não contam como dinheiro que entrou)
  function somar(linhas) {
    let soma = 0, recebidoAgora = 0;
    for (const l of linhas) {
      const v = Number(l.valor) || 0;
      soma += v;
      if (l.situacao === 'Recebido') recebidoAgora += v;
    }
    return { soma: arred(soma), recebidoAgora: arred(recebidoAgora) };
  }

  // resumo = resposta de GET /fluxo/pedido_resumo (ou null quando não há um único pedido); fmt = formatador de moeda
  function avaliar(linhas, resumo) {
    const { soma, recebidoAgora } = somar(linhas);
    if (!resumo) return { soma, recebidoAgora, cobreTotal: false, diferente: false };
    const recebido = arred(resumo.recebido + recebidoAgora);
    const falta = arred(Math.max(0, resumo.total - recebido));
    return { soma, recebidoAgora, recebido, falta, cobreTotal: resumo.total > 0 && recebido >= resumo.total, diferente: arred(soma) !== arred(resumo.falta) };
  }

  function textoResumo(av, resumo, fmt) {
    let t = `Soma das formas: ${fmt(av.soma)}.`;
    if (!resumo) return { texto: t, aviso: false };
    t += ` Pedido ${resumo.numero}: total ${fmt(resumo.total)} · já recebido ${fmt(resumo.recebido)} · com este lançamento ${fmt(av.recebido)} · falta ${fmt(av.falta)}.`;
    if (av.diferente) t += ` Atenção: a soma (${fmt(av.soma)}) é diferente do que faltava receber (${fmt(resumo.falta)}).`;
    return { texto: t, aviso: av.diferente };
  }

  function rotuloSalvar(qtd) { return qtd > 1 ? `💾 Salvar ${qtd} recebimentos` : '💾 Salvar'; }

  const api = { SITUACOES_ENTRADA, MAX_LINHAS, somar, avaliar, textoResumo, rotuloSalvar };

  function iniciar(d) {
    const { $, lerNumero, moeda, escapeHtml } = d;
    const bloco = $('bloco-divisao'), lista = $('div-linhas'), resumoEl = $('div-resumo');
    const quitarRotulo = $('div-quitar-rotulo'), quitar = $('div-quitar');
    let resumo = null, buscaN = 0, quitarMexido = false;

    const extras = () => [...lista.querySelectorAll('.div-linha')];
    const lerLinha = el => ({
      formaPgto: el.querySelector('.d-forma').value.trim(), banco: el.querySelector('.d-banco').value.trim(),
      valor: lerNumero(el.querySelector('.d-valor').value), data: el.querySelector('.d-data').value, situacao: el.querySelector('.d-situacao').value
    });
    const principal = () => ({
      formaPgto: $('f-forma').value.trim(), banco: $('f-banco').value.trim(), valor: lerNumero($('f-valor').value),
      data: $('f-data').value, situacao: $('f-situacao').value
    });
    const todas = () => [principal(), ...extras().map(lerLinha)];
    const ativo = () => d.getMovimento() === 'Entrada' && !$('f-id').value && extras().length > 0;

    function numeroPedido() { const t = $('f-pedido').value.trim(); return /^\d{1,9}$/.test(t) ? t : ''; }

    function renomear() {
      extras().forEach((el, i) => { el.querySelector('.d-titulo').textContent = `Forma de pagamento ${i + 2}`; });
      $('div-add').disabled = extras().length + 1 >= MAX_LINHAS;
    }

    function recalcular() {
      const mostrar = extras().length > 0;
      resumoEl.hidden = !mostrar;
      quitarRotulo.hidden = true;
      $('btn-salvar').textContent = d.getMovimento() === 'Entrada' && !$('f-id').value ? rotuloSalvar(ativo() ? extras().length + 1 : 1) : $('btn-salvar').textContent;
      if (!mostrar) return;
      const av = avaliar(todas(), resumo), r = textoResumo(av, resumo, moeda);
      resumoEl.textContent = r.texto;
      resumoEl.classList.toggle('aviso', r.aviso);
      if (resumo && d.pode('clientes.receber')) {
        quitarRotulo.hidden = false;
        if (!quitarMexido) quitar.checked = av.cobreTotal;
      }
    }

    async function buscarResumo() {
      const n = numeroPedido(), minha = ++buscaN;
      resumo = null;
      if (n && extras().length) {
        try { const r = await d.api('/fluxo/pedido_resumo?numero=' + encodeURIComponent(n)); if (minha === buscaN) resumo = r; }
        catch { /* sem resumo: só mostra a soma */ }
      }
      if (minha === buscaN) recalcular();
    }

    function adicionar() {
      if (extras().length + 1 >= MAX_LINHAS) return;
      const li = document.createElement('div');
      li.className = 'div-linha';
      const falta = resumo ? arred(Math.max(0, avaliar(todas(), resumo).falta)) : 0;
      li.innerHTML = `
        <div class="d-cab"><strong class="d-titulo"></strong><button type="button" class="d-remover" aria-label="Remover esta forma">✕</button></div>
        <div class="form-group"><label>Forma de pagamento</label><input class="d-forma" list="lista-formas"></div>
        <div class="form-group"><label>Banco</label><input class="d-banco" list="lista-bancos"></div>
        <div class="form-group"><label>Valor</label><input class="num dec d-valor" value="${escapeHtml(moeda(falta))}"></div>
        <div class="form-group"><label>Data</label><input type="date" class="d-data" value="${escapeHtml($('f-data').value || d.hojeISO())}"></div>
        <div class="form-group full"><label>Situação</label><select class="d-situacao">${SITUACOES_ENTRADA.map(s => `<option>${s}</option>`).join('')}</select></div>`;
      li.querySelector('.d-situacao').value = SITUACOES_ENTRADA.includes($('f-situacao').value) ? $('f-situacao').value : 'Recebido';
      lista.appendChild(li);
      renomear();
      if (!resumo) buscarResumo(); else recalcular();
      li.querySelector('.d-forma').focus();
    }

    function reiniciar() {
      lista.innerHTML = '';
      resumo = null; buscaN++; quitarMexido = false; quitar.checked = false;
      resumoEl.textContent = ''; resumoEl.hidden = true; quitarRotulo.hidden = true;
      renomear();
    }

    function atualizarVisibilidade() {
      const pode = d.getMovimento() === 'Entrada' && !$('f-id').value && d.pode('financeiro.lancar');
      bloco.hidden = !pode;
      if (!pode && extras().length) reiniciar();
      recalcular();
    }

    function montarEnvio(comum) {
      return {
        movimento: 'Entrada', nome: comum.nome, pedido: comum.pedido, pdv: comum.pdv, preNota: comum.preNota, notaFiscal: comum.notaFiscal,
        observacao: comum.observacao, codClassificacao: comum.codClassificacao, linhas: todas(),
        quitarPedido: !quitarRotulo.hidden && quitar.checked ? true : undefined
      };
    }

    // cada linha precisa de forma e valor; devolve a mensagem do primeiro problema ou ''
    function conferir() {
      const l = todas();
      for (let i = 0; i < l.length; i++) {
        if (!l[i].formaPgto) return `Forma de pagamento ${i + 1}: favor escolher uma forma de pagamento!`;
        if (!l[i].data) return `Forma de pagamento ${i + 1}: favor inserir uma data válida!`;
        if (!(l[i].valor > 0)) return `Forma de pagamento ${i + 1}: favor inserir um valor maior que zero!`;
        if (!SITUACOES_ENTRADA.includes(l[i].situacao)) return `Forma de pagamento ${i + 1}: favor escolher a situação desse registro!`;
      }
      return '';
    }

    // máscara dos campos de valor criados aqui (os de sempre ganham a deles no carregamento da página)
    lista.addEventListener('keypress', e => { if (e.target.classList.contains('d-valor') && e.key.length === 1 && !/[0-9,]/.test(e.key)) e.preventDefault(); });
    lista.addEventListener('focusin', e => { if (e.target.classList.contains('d-valor')) { e.target.value = String(lerNumero(e.target.value)).replace('.', ','); e.target.select(); } });
    lista.addEventListener('focusout', e => { if (e.target.classList.contains('d-valor')) { e.target.value = moeda(lerNumero(e.target.value)); recalcular(); } });
    lista.addEventListener('input', recalcular);
    lista.addEventListener('change', recalcular);
    lista.addEventListener('click', e => { if (e.target.closest('.d-remover')) { e.target.closest('.div-linha').remove(); renomear(); recalcular(); } });
    $('div-add').addEventListener('click', adicionar);
    quitar.addEventListener('change', () => { quitarMexido = true; });
    ['f-valor', 'f-situacao', 'f-data'].forEach(id => $(id).addEventListener('input', recalcular));
    $('f-situacao').addEventListener('change', recalcular);
    $('f-valor').addEventListener('blur', recalcular);
    $('f-pedido').addEventListener('change', () => { quitarMexido = false; buscarResumo(); });

    return { reiniciar, atualizarVisibilidade, ativo, montarEnvio, conferir, recalcular, buscarResumo };
  }

  api.iniciar = iniciar;
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.FluxoDivisao = api;
})(typeof window !== 'undefined' ? window : globalThis);
