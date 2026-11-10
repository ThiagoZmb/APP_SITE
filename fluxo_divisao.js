// Recebimento dividido em várias formas de pagamento (tela financeiro.html, gaveta "Novo movimento", só Entrada nova).
// A primeira forma é a dos campos de sempre; as outras entram como linhas aqui. Tudo é enviado de uma vez a POST /fluxo/salvar_varios.
// As contas (soma, falta, aviso) são puras e testadas no Node; o resto liga a tela.
// FluxoDivisao.iniciar({ $, api, lerNumero, moeda, escapeHtml, hojeISO, pode, getMovimento }) → { reiniciar, atualizarVisibilidade, ativo, montarEnvio, rotuloSalvar, depoisDeSalvar }
(function (raiz) {
  'use strict';
  const SITUACOES_ENTRADA = ['A Receber', 'Atrasado', 'Faturado', 'Protestado', 'Recebido'];
  const SITUACOES_SAIDA = ['A Pagar', 'Atrasado', 'Faturado', 'Pago', 'Protestado'];
  const situacoesDe = mov => (mov === 'Saída' ? SITUACOES_SAIDA : SITUACOES_ENTRADA);
  // "ainda por vir": a forma de pagamento só se sabe no dia em que o dinheiro entra ou sai, então pode ficar em branco (igual ao servidor)
  const SEM_FORMA = ['A Receber', 'A Pagar'];
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

  // Dividir um movimento que já existe (Editar movimento): a soma das parcelas deve dar o valor original; diferença = só aviso.
  // `falta` = quanto ainda não foi distribuído (negativo = passou do original); fmt = formatador de moeda.
  function avaliarEdicao(original, linhas) {
    const soma = somar(linhas).soma, falta = arred(Number(original) - soma);
    return { soma, falta: Math.abs(falta) < 0.005 ? 0 : falta, diferente: Math.abs(falta) >= 0.005 };
  }
  function textoEdicao(av, original, fmt) {
    let t = `Valor original ${fmt(original)} · soma das parcelas ${fmt(av.soma)}`;
    if (!av.diferente) return { texto: t + ' · tudo distribuído.', aviso: false };
    t += av.falta > 0 ? ` · falta distribuir ${fmt(av.falta)}.` : ` · passou ${fmt(-av.falta)} do valor original.`;
    return { texto: t + ' Atenção: o total do movimento vai mudar.', aviso: true };
  }
  // parcela que ainda falta para completar o valor original (nunca negativa)
  const restanteEdicao = (original, linhas) => Math.max(0, avaliarEdicao(original, linhas).falta);
  function rotuloSalvarEdicao(extras) { return extras > 0 ? `💾 Atualizar e criar ${extras} ${extras > 1 ? 'registros' : 'registro'}` : '💾 Atualizar'; }

  const api = { SITUACOES_ENTRADA, SITUACOES_SAIDA, SEM_FORMA, MAX_LINHAS, somar, avaliar, textoResumo, rotuloSalvar, calcularRestante, maiorDataPronto,
    avaliarEdicao, textoEdicao, restanteEdicao, rotuloSalvarEdicao };

  function iniciar(d) {
    const { $, lerNumero, moeda, escapeHtml } = d;
    const bloco = $('bloco-divisao'), lista = $('div-linhas'), resumoEl = $('div-resumo');
    const quitarRotulo = $('div-quitar-rotulo'), quitar = $('div-quitar');
    const infoTotal = $('info-total'), restCaixa = $('rest-caixa'), restTexto = $('rest-texto'), restData = $('rest-data');
    const btnDividir = $('btn-dividir-valor'), divTitulo = $('div-titulo'), divDica = $('div-dica'), addBtn = $('div-add');
    let resumo = null, buscaN = 0, quitarMexido = false;
    let contexto = null;   // { base, totalPedidos, credito, pedidos, entrega }: só quando a gaveta abre pelo botão Receber da ficha do cliente
    let edicao = null;     // { id, valorOriginal }: quando a gaveta é "Editar movimento" (dividir um registro que já existe)
    let edicaoLigada = false;   // o usuário clicou em "Dividir este valor"

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
    const emEdicao = () => !!$('f-id').value;
    const ativo = () => (entradaNova() && (extras().length > 0 || restante() > 0)) || (emEdicao() && edicaoLigada && !!edicao && extras().length > 0);
    const caminho = () => (emEdicao() ? '/fluxo/dividir' : '/fluxo/salvar_varios');
    const rotuloLinha = i => (emEdicao() ? `Parcela ${i}` : `Forma de pagamento ${i}`);

    function numeroPedido() { const t = $('f-pedido').value.trim(); return /^\d{1,9}$/.test(t) ? t : ''; }

    function renomear() {
      extras().forEach((el, i) => { el.querySelector('.d-titulo').textContent = rotuloLinha(i + 2); });
      addBtn.disabled = extras().length + 1 >= MAX_LINHAS;
    }

    // Editar movimento: a última parcela extra "automática" recebe o que falta para fechar o valor original (some quando o usuário digita nela)
    function autoPreencher() {
      if (!edicao) return;
      const linhas = extras();
      const alvo = [...linhas].reverse().find(el => el.dataset.auto === '1');
      if (!alvo) return;
      const outros = [principal(), ...linhas.filter(el => el !== alvo).map(lerLinha)];
      alvo.querySelector('.d-valor').value = moeda(restanteEdicao(edicao.valorOriginal, outros));
    }

    function recalcularEdicao() {
      infoTotal.hidden = true; restCaixa.hidden = true; quitarRotulo.hidden = true;
      const mostrar = edicaoLigada && !!edicao && extras().length > 0;
      resumoEl.hidden = !mostrar;
      if (edicao) autoPreencher();
      if (edicao) $('btn-salvar').textContent = rotuloSalvarEdicao(edicaoLigada ? extras().length : 0);
      if (!mostrar) return;
      const av = avaliarEdicao(edicao.valorOriginal, todas()), r = textoEdicao(av, edicao.valorOriginal, moeda);
      resumoEl.textContent = r.texto;
      resumoEl.classList.toggle('aviso', r.aviso);
    }

    function recalcular() {
      if (emEdicao()) { recalcularEdicao(); return; }
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
      if (n && extras().length && !contexto && !emEdicao()) {
        try { const r = await d.api('/fluxo/pedido_resumo?numero=' + encodeURIComponent(n)); if (minha === buscaN) resumo = r; }
        catch { /* sem resumo: só mostra a soma */ }
      }
      if (minha === buscaN) recalcular();
    }

    function adicionar({ semFoco = false } = {}) {
      if (extras().length + 1 >= MAX_LINHAS) return;
      const li = document.createElement('div');
      li.className = 'div-linha';
      const mov = d.getMovimento(), situacoes = situacoesDe(mov), editando = emEdicao() && !!edicao;
      const falta = editando ? restanteEdicao(edicao.valorOriginal, todas()) : contexto ? restante() : resumo ? arred(Math.max(0, avaliar(todas(), resumo).falta)) : 0;
      if (editando) { extras().forEach(el => { el.dataset.auto = '0'; }); li.dataset.auto = '1'; }
      li.innerHTML = `
        <div class="d-cab"><strong class="d-titulo"></strong><button type="button" class="d-remover" aria-label="Remover esta forma">✕</button></div>
        <div class="form-group"><label>Forma de pagamento</label><input class="d-forma" list="lista-formas"></div>
        <div class="form-group"><label>Banco</label><input class="d-banco" list="lista-bancos"></div>
        <div class="form-group"><label>Valor</label><input class="num dec d-valor" value="${escapeHtml(moeda(falta))}"></div>
        <div class="form-group"><label>Data</label><input type="date" class="d-data" value="${escapeHtml($('f-data').value || d.hojeISO())}"></div>
        <div class="form-group full"><label>Situação</label><select class="d-situacao">${situacoes.map(s => `<option>${escapeHtml(s)}</option>`).join('')}</select></div>`;
      li.querySelector('.d-situacao').value = situacoes.includes($('f-situacao').value) ? $('f-situacao').value : situacoes[situacoes.length - 1];
      lista.appendChild(li);
      renomear();
      if (!resumo && !editando) buscarResumo(); else recalcular();
      if (!semFoco) li.querySelector('.d-forma').focus();
    }

    function reiniciar() {
      lista.innerHTML = '';
      resumo = null; buscaN++; quitarMexido = false; quitar.checked = false; contexto = null; edicao = null; edicaoLigada = false;
      resumoEl.textContent = ''; resumoEl.hidden = true; quitarRotulo.hidden = true;
      infoTotal.hidden = true; infoTotal.textContent = ''; restCaixa.hidden = true; restData.value = '';
      btnDividir.hidden = true;
      renomear();
    }

    // chamado ao abrir um movimento existente (Editar movimento), depois de preencher os campos e de reiniciar
    function definirEdicao(e) {
      edicao = e && e.id ? { id: e.id, valorOriginal: arred(e.valorOriginal) } : null;
      edicaoLigada = false;
      lista.innerHTML = '';
      renomear();
      atualizarVisibilidade();
    }

    // botão "Dividir este valor" (liga e desliga); ao ligar, já abre a parcela 2 e leva o foco ao valor da parcela 1
    function alternarDivisaoEdicao() {
      if (!emEdicao() || !edicao) return;
      edicaoLigada = !edicaoLigada;
      if (edicaoLigada) { if (!extras().length) adicionar({ semFoco: true }); }
      else { lista.innerHTML = ''; renomear(); }
      atualizarVisibilidade();
      if (edicaoLigada) { $('f-valor').focus(); $('f-valor').select(); }
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
      const editando = emEdicao(), lancar = d.pode('financeiro.lancar');
      btnDividir.hidden = !(editando && !!edicao && lancar);
      btnDividir.textContent = edicaoLigada ? '✖ Cancelar divisão' : '✂️ Dividir este valor';
      const pode = lancar && (editando ? edicaoLigada && !!edicao : d.getMovimento() === 'Entrada');
      bloco.hidden = !pode;
      divTitulo.textContent = editando ? 'Dividir este valor' : 'Dividir em mais formas';
      divDica.textContent = editando
        ? 'A parcela de cima é este registro: o valor dele passa a ser o que você digitar. As demais viram registros novos. Tudo é salvo de uma vez.'
        : 'Para receber o mesmo pedido em mais de uma forma (ex.: Pix + cartão), a forma de cima é a primeira; adicione as outras aqui. Tudo é salvo de uma vez.';
      addBtn.textContent = editando ? '＋ Adicionar parcela' : '＋ Adicionar forma de pagamento';
      if (!pode && extras().length) { if (editando) { lista.innerHTML = ''; renomear(); } else reiniciar(); }
      recalcular();
    }

    // linhas enviadas: as formas recebidas agora + (se sobrou) o restante como "A Receber", sem forma nem banco
    function linhasParaEnviar() {
      const l = todas(), rest = restante();
      if (rest > 0) l.push({ formaPgto: '', banco: '', valor: rest, data: restData.value, situacao: 'A Receber' });
      return l;
    }

    function montarEnvio(comum) {
      if (emEdicao() && edicao) {
        return { id: edicao.id, movimento: d.getMovimento(), nome: comum.nome, pedido: comum.pedido, pdv: comum.pdv, preNota: comum.preNota, notaFiscal: comum.notaFiscal,
          observacao: comum.observacao, codClassificacao: comum.codClassificacao, linhas: todas() };
      }
      return {
        movimento: 'Entrada', nome: comum.nome, pedido: comum.pedido, pdv: comum.pdv, preNota: comum.preNota, notaFiscal: comum.notaFiscal,
        observacao: comum.observacao, codClassificacao: comum.codClassificacao, linhas: linhasParaEnviar(),
        quitarPedido: !quitarRotulo.hidden && quitar.checked ? true : undefined
      };
    }

    // cada linha precisa de forma e valor; devolve a mensagem do primeiro problema ou ''
    function conferir() {
      const l = todas(), situacoes = situacoesDe(d.getMovimento());
      for (let i = 0; i < l.length; i++) {
        const nome = rotuloLinha(i + 1);
        if (!l[i].formaPgto && !SEM_FORMA.includes(l[i].situacao)) return `${nome}: favor escolher uma forma de pagamento!`;
        if (!l[i].data) return `${nome}: favor inserir uma data válida!`;
        if (!(l[i].valor > 0)) return `${nome}: favor inserir um valor maior que zero!`;
        if (!situacoes.includes(l[i].situacao)) return `${nome}: favor escolher a situação desse registro!`;
      }
      if (restante() > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(restData.value)) return 'Informe o vencimento do restante a receber.';
      return '';
    }

    // máscara dos campos de valor criados aqui (os de sempre ganham a deles no carregamento da página)
    lista.addEventListener('keypress', e => { if (e.target.classList.contains('d-valor') && e.key.length === 1 && !/[0-9,]/.test(e.key)) e.preventDefault(); });
    lista.addEventListener('focusin', e => { if (e.target.classList.contains('d-valor')) { e.target.value = String(lerNumero(e.target.value)).replace('.', ','); e.target.select(); } });
    lista.addEventListener('focusout', e => { if (e.target.classList.contains('d-valor')) { e.target.value = moeda(lerNumero(e.target.value)); recalcular(); } });
    // digitou no valor de uma parcela: ela deixa de ser a "automática" (que completa o valor original)
    lista.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('d-valor')) { const li = e.target.closest('.div-linha'); if (li) li.dataset.auto = '0'; } recalcular(); });
    lista.addEventListener('change', recalcular);
    btnDividir.addEventListener('click', alternarDivisaoEdicao);
    lista.addEventListener('click', e => { if (e.target.closest('.d-remover')) { e.target.closest('.div-linha').remove(); renomear(); recalcular(); } });
    $('div-add').addEventListener('click', adicionar);
    quitar.addEventListener('change', () => { quitarMexido = true; });
    ['f-valor', 'f-situacao', 'f-data'].forEach(id => $(id).addEventListener('input', recalcular));
    $('f-situacao').addEventListener('change', recalcular);
    $('f-valor').addEventListener('blur', recalcular);
    $('f-pedido').addEventListener('change', () => { quitarMexido = false; buscarResumo(); });

    return { reiniciar, atualizarVisibilidade, ativo, caminho, montarEnvio, conferir, recalcular, buscarResumo, definirContexto, definirEdicao, temRestante: () => restante() > 0 };
  }

  api.iniciar = iniciar;
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.FluxoDivisao = api;
})(typeof window !== 'undefined' ? window : globalThis);
