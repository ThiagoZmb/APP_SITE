// Janela "Ajustar desconto adicional" do menu do botão direito do Pedido (Pedidos e Orçamentos, Início e Calendário).
// Para o cliente que decide a forma de pagar depois do pedido feito (ex.: à vista). Duas formas, como o "Alterar valor" do orçamento:
//   (1) Desconto adicional (%) → o total é calculado;  (2) caixinha "Valor final" → o % é calculado a partir do total digitado.
// As contas são de calculo/desconto_pedido.js (as mesmas do servidor, que recalcula tudo). Grava só DESCONTO e TOTAL do pedido.
// AjustarDesconto.abrir({ numero, apiBase, loginUrl, token: () => string, recarregar: () => void })
(function () {
  'use strict';
  const moeda = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pctTexto = v => String(Number(v) || 0).replace('.', ',');

  async function chamar(cfg, caminho, metodo, corpo) {
    const r = await fetch(cfg.apiBase + caminho, { method: metodo, headers: { Authorization: 'Bearer ' + cfg.token(), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined });
    if (r.status === 401) { try { localStorage.removeItem('auth'); } catch { /* sem storage */ } window.location.href = cfg.loginUrl; throw new Error('Sessão expirada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || `Erro HTTP: ${r.status}`); e.status = r.status; throw e; }
    return d;
  }

  async function abrir(cfg) {
    let dados;
    try { dados = await chamar(cfg, `/ped_orc/Pedido/${encodeURIComponent(cfg.numero)}/desconto`, 'GET'); }
    catch (err) { alert(err.message); return; }
    const D = window.DescontoPedido;
    const mk = (tag, cls, txt) => { const el = document.createElement(tag); if (cls) el.className = cls; if (txt !== undefined) el.textContent = txt; return el; };

    const fundo = mk('div', 'dp-fundo');
    const caixa = mk('div', 'dp-caixa');
    caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', 'Ajustar desconto adicional');
    caixa.append(mk('div', 'dp-titulo', 'Ajustar desconto adicional'), mk('div', 'dp-sub', `Pedido nº ${dados.numero}${dados.cliente ? ' · ' + dados.cliente : ''}`));

    const resumo = mk('div', 'dv-resumo');
    const celula = (rot, val) => { const c = mk('div'); c.append(mk('small', '', rot), mk('strong', '', val)); return c; };
    resumo.append(celula('Subtotal', moeda(dados.subTotal)), celula('Desconto atual', pctTexto(dados.descontoPct) + ' %'), celula('Total atual', moeda(dados.total)));

    const rPct = mk('label', 'dp-rotulo', 'Desconto adicional (%)'); const inPct = mk('input', 'dp-data'); inPct.id = 'dv-pct'; inPct.inputMode = 'decimal'; inPct.autocomplete = 'off'; rPct.htmlFor = inPct.id;
    const linhaFinal = mk('label', 'dv-final-chk'); const chk = mk('input'); chk.type = 'checkbox'; chk.id = 'dv-final-chk'; linhaFinal.append(chk, document.createTextNode(' Valor final (digitar o total e calcular o %)'));
    const rTot = mk('label', 'dp-rotulo', 'Total final (R$)'); const inTot = mk('input', 'dp-data'); inTot.id = 'dv-total'; inTot.inputMode = 'decimal'; inTot.autocomplete = 'off'; rTot.htmlFor = inTot.id;
    const dif = mk('div', 'dv-dif'); dif.setAttribute('aria-live', 'polite');
    const erro = mk('div', 'dv-erro'); erro.setAttribute('role', 'alert');

    const acoes = mk('div', 'dp-acoes');
    const bCancelar = mk('button', 'dp-btn', 'Cancelar'); bCancelar.type = 'button';
    const bSalvar = mk('button', 'dp-btn dp-btn-ok', 'Aplicar'); bSalvar.type = 'button';
    acoes.append(bCancelar, bSalvar);
    caixa.append(resumo, rPct, inPct, linhaFinal, rTot, inTot, dif, erro, acoes);
    fundo.append(caixa);

    // estado: resultado calculado da forma escolhida (ou null se inválido / sem mudança)
    let calc = null;
    const entrada = () => (chk.checked ? { subTotal: dados.subTotal, totalFinal: inTot.value } : { subTotal: dados.subTotal, descontoPct: inPct.value });
    function atualizar(origem) {
      erro.textContent = ''; dif.textContent = ''; dif.className = 'dv-dif';
      const vazio = chk.checked ? !inTot.value.trim() : !inPct.value.trim();
      const r = vazio ? null : D.calcular(entrada());
      calc = null;
      if (r && r.ok) {
        // o campo calculado acompanha (sem mexer no que o usuário está digitando)
        if (chk.checked && origem !== 'pct') inPct.value = pctTexto(r.descontoPct);
        if (!chk.checked && origem !== 'total') inTot.value = r.total.toFixed(2).replace('.', ',');
        const d = D.arred2(r.total - dados.total);
        const igual = Math.abs(r.total - dados.total) < 0.005 && Math.abs(r.descontoPct - dados.descontoPct) < 0.00005;
        dif.textContent = igual ? 'Sem mudança em relação ao atual.' : `Total: ${moeda(dados.total)} → ${moeda(r.total)} · ${d < 0 ? '▼' : '▲'} ${moeda(Math.abs(d))}`;
        dif.classList.add(d < 0 ? 'desce' : 'sobe');
        if (!igual) calc = r;
      } else if (r && !r.ok) {
        erro.textContent = r.erro;
      } else if (!chk.checked) { inTot.value = ''; }
      bSalvar.disabled = !calc;
    }
    function modo() {
      inPct.readOnly = chk.checked; inTot.readOnly = !chk.checked;
      inPct.classList.toggle('dv-travado', chk.checked); inTot.classList.toggle('dv-travado', !chk.checked);
      (chk.checked ? inTot : inPct).focus(); (chk.checked ? inTot : inPct).select();
      atualizar();
    }

    const fecha = () => { document.removeEventListener('keydown', teclas, true); fundo.remove(); };
    async function aplicar() {
      if (!calc) return;
      bSalvar.disabled = true; bSalvar.textContent = 'Aplicando...';
      try {
        const corpo = { conferencia: { descontoPct: dados.descontoPct, total: dados.total }, ...(chk.checked ? { totalFinal: inTot.value } : { descontoPct: inPct.value }) };
        await chamar(cfg, `/ped_orc/Pedido/${encodeURIComponent(cfg.numero)}/desconto`, 'POST', corpo);
        fecha();
        if (cfg.recarregar) cfg.recarregar();
      } catch (err) {
        if (err.status === 409) { fecha(); alert(err.message); if (cfg.recarregar) cfg.recarregar(); return; }
        erro.textContent = err.message; bSalvar.textContent = 'Aplicar'; bSalvar.disabled = !calc;
      }
    }
    const teclas = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(); }
      else if (e.key === 'Enter' && (e.target === inPct || e.target === inTot)) { e.preventDefault(); aplicar(); }
      else if (e.key === 'Tab') {
        const itens = [inPct, chk, inTot, bSalvar, bCancelar].filter(x => !x.disabled && !x.readOnly), i = itens.indexOf(document.activeElement);
        e.preventDefault(); itens[(i + (e.shiftKey ? itens.length - 1 : 1) + itens.length) % itens.length].focus();
      }
    };
    inPct.addEventListener('input', () => atualizar('pct'));
    inTot.addEventListener('input', () => atualizar('total'));
    chk.addEventListener('change', modo);
    bSalvar.addEventListener('click', aplicar);
    bCancelar.addEventListener('click', fecha);
    fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(); });
    document.addEventListener('keydown', teclas, true);
    document.body.append(fundo);
    inPct.value = pctTexto(dados.descontoPct); inTot.value = dados.total.toFixed(2).replace('.', ',');
    inTot.readOnly = true; inTot.classList.add('dv-travado');
    bSalvar.disabled = true;
    inPct.focus(); inPct.select();
  }

  window.AjustarDesconto = { abrir };
})();
