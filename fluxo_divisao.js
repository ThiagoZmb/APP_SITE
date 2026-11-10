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

  // Restante a receber: quando a gaveta abre pela ficha do cliente (botão Receber), `base` é o total dos pedidos marcados
  // (já descontado o crédito). Se o que entra agora como Recebido for menor, o que sobra vira uma linha "A Receber".
  // Só vale quando a linha de cima é "Recebido"; arredonda em centavos e ignora diferença menor que meio centavo.
  function calcularRestante(base, linhas) {
    if (!(Number(base) > 0) || !linhas.length || linhas[0].situacao !== 'Recebido') return 0;
    const r = arred(Number(base) - somar(linhas).recebidoAgora);
    return r > 0.004 ? r : 0;
  }

  // maior data de pronto entre os pedidos: recebe datas "dd/mm/aaaa" (vazias ou inválidas são ignoradas) e devolve "aaaa-mm-dd" ou ''
  function maiorDataPronto(datasBR) {
    let melhor = '';
    for (const t of datasBR || []) {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(t || '').trim());
      if (!m || Number(m[3]) < 1900) continue;
      const iso = `${m[3]}-${m[2]}-${m[1]}`;
      if (isNaN(new Date(iso + 'T00:00:00'))) continue;
      if (iso > melhor) melhor = iso;
    }
    return melhor;
  }

  const api = { SITUACOES_ENTRADA, MAX_LINHAS, somar, avaliar, textoResumo, rotuloSalvar, calcularRestante, maiorDataPronto };

  function iniciar(d) {
    const { $, lerNumero, moeda, escapeHtml } = d;
    const bloco = $('bloco-divisao'), lista = $('div-linhas'), resumoEl = $('div-resumo');
    const quitarRotulo = $('div-quitar-rotulo'), quitar = $('div-quitar');
    const infoTotal = $('info-total'), restCaixa = $('rest-caixa'), restTexto = $('rest-texto'), restData = $('rest-data');
    let resumo = null, buscaN = 0, quitarMexido = false;
    let contexto = null;   // { base, totalPedidos, credito, pedidos, entrega }: só quando a gaveta abre pelo botão Receber da ficha do cliente

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
    const entradaNova = () => d.getMovimento() === 'Entrada' && !$('f-id').value;
    const restante = () => (contexto && entradaNova() ? calcularRestante(contexto.base, todas()) : 0);
    const ativo = () => entradaNova() && (extras().length > 0 || restante() > 0);

    function numeroPedido() { const t = $('f-pedido').value.trim(); return /^\d{1,9}$/.test(t) ? t : ''; }

    function renomear() {
      extras().forEach((el, i) => { el.querySelector('.d-titulo').textContent = `Forma de pagamento ${i + 2}`; });
      $('div-add').disabled = extras().length + 1 >= MAX_LINHAS;
    }

    function recalcular() {
      const mostrar = extras().length > 0;
      const rest = restante();
      resumoEl.hidden = !mostrar;
      quitarRotulo.hidden = true;
      // total dos pedidos selecionados, no topo da gaveta (só quando veio da ficha do cliente)
      const comTotal = !!contexto && entradaNova();
      infoTotal.hidden = !comTotal;
      if (comTotal) {
        const recebido = somar(todas()).recebidoAgora;
        let t = `Total dos pedidos selecionados: ${moeda(contexto.totalPedidos)} (${contexto.pedidos})`;
        if (contexto.credito) t += ` · crédito descontado: ${moeda(contexto.credito)} · a receber: ${moeda(contexto.base)}`;
        if (recebido > contexto.base + 0.004) t += ` · Atenção: o valor recebido (${moeda(recebido)}) é maior que o total.`;
        infoTotal.textContent = t;
        infoTotal.classList.toggle('aviso', recebido > contexto.base + 0.004);
      }
      // restante vira uma linha "A Receber" ao salvar
      restCaixa.hidden = !(rest > 0);
      if (rest > 0) {
        restTexto.textContent = `Restante a receber: ${moeda(rest)}. Será gravado como "A Receber", com vencimento em:`;
        if (!restData.value) restData.value = contexto.entrega || d.hojeISO();
      }
      if (entradaNova()) $('btn-salvar').textContent = rotuloSalvar(ativo() ? extras().length + 1 + (rest > 0 ? 1 : 0) : 1);
      if (!mostrar) return;
      const av = avaliar(todas(), resumo), r = textoResumo(av, resumo, moeda);
      resumoEl.textContent = r.texto;
      resumoEl.classList.toggle('aviso', r.aviso);
      // com o restante automático, os pedidos são marcados como Recebido pela ficha do cliente: sem a caixinha de quitar
      if (!contexto && resumo && d.pode('clientes.receber')) {
        quitarRotulo.hidden = false;
        if (!quitarMexido) quitar.checked = av.cobreTotal;
      }
    }

    async function buscarResumo() {
      const n = numeroPedido(), minha = ++buscaN;
      resumo = null;
      if (n && extras().length && !contexto) {
        try { const r = await d.api('/fluxo/pedido_resumo?numero=' + encodeURIComponent(n)); if (minha === buscaN) resumo = r; }
        catch { /* sem resumo: só mostra a soma */ }
      }
      if (minha === buscaN) recalcular();
    }

    function adicionar() {
      if (extras().length + 1 >= MAX_LINHAS) return;
      const li = document.createElement('div');
      li.className = 'div-linha';
      const falta = contexto ? restante() : resumo ? arred(Math.max(0, avaliar(todas(), resumo).falta)) : 0;
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
      resumo = null; buscaN++; quitarMexido = false; quitar.checked = false; contexto = null;
      resumoEl.textContent = ''; resumoEl.hidden = true; quitarRotulo.hidden = true;
      infoTotal.hidden = true; infoTotal.textContent = ''; restCaixa.hidden = true; restData.value = '';
      renomear();
    }

    // chamado quando a gaveta abre pelo botão Receber da ficha do cliente (depois de reiniciar)
    function definirContexto(c) {
      contexto = c && Number(c.base) > 0
        ? { base: arred(c.base), totalPedidos: arred(c.totalPedidos || c.base), credito: arred(c.credito || 0), pedidos: String(c.pedidos || ''), entrega: /^\d{4}-\d{2}-\d{2}$/.test(c.entrega || '') ? c.entrega : '' }
        : null;
      restData.value = contexto ? contexto.entrega : '';
      recalcular();
    }

    function atualizarVisibilidade() {
      const pode = d.getMovimento() === 'Entrada' && !$('f-id').value && d.pode('financeiro.lancar');
      bloco.hidden = !pode;
      if (!pode && extras().length) reiniciar();
      recalcular();
    }

    // linhas enviadas: as formas recebidas agora + (se sobrou) o restante como "A Receber", sem forma nem banco
    function linhasParaEnviar() {
      const l = todas(), rest = restante();
      if (rest > 0) l.push({ formaPgto: '', banco: '', valor: rest, data: restData.value, situacao: 'A Receber' });
      return l;
    }

    function montarEnvio(comum) {
      return {
        movimento: 'Entrada', nome: comum.nome, pedido: comum.pedido, pdv: comum.pdv, preNota: comum.preNota, notaFiscal: comum.notaFiscal,
        observacao: comum.observacao, codClassificacao: comum.codClassificacao, linhas: linhasParaEnviar(),
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
      if (restante() > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(restData.value)) return 'Informe o vencimento do restante a receber.';
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

    return { reiniciar, atualizarVisibilidade, ativo, montarEnvio, conferir, recalcular, buscarResumo, definirContexto, temRestante: () => restante() > 0 };
  }

  api.iniciar = iniciar;
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.FluxoDivisao = api;
})(typeof window !== 'undefined' ? window : globalThis);
