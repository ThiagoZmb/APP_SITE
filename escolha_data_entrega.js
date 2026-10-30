// Janela "Marcar como Entregue / Retirado": o usuário escolhe a data de entrega.
//   - atualizar para HOJE;
//   - manter a data já gravada (ou, se não houver, usar a data de PRONTO);
//   - escolher OUTRA data (campo de data, nunca no futuro).
// Usada pelo menu da lista de Pedidos e Orçamentos e pelo menu do Início.
// perguntar() devolve 'hoje', 'manter', 'pronto', 'data:AAAA-MM-DD' ou null (cancelou).
(function () {
  'use strict';
  const dataBR = v => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v ?? '').trim();
  };
  const vazia = v => { const t = dataBR(v); return !t || t === '-' || t === '—'; };
  const hojeISO = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD no fuso do computador

  // dataAtual = data de entrega já gravada; dataPronto = data de pronto do pedido. Sem data gravada, o segundo botão usa a data de pronto.
  function perguntar({ numero, cliente, nome, dataAtual, dataPronto }) {
    return new Promise(resolver => {
      const hoje = new Date().toLocaleDateString('pt-BR'), maxISO = hojeISO();
      const fundo = document.createElement('div');
      fundo.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(20,16,18,.45);display:flex;align-items:center;justify-content:center;padding:16px';
      const caixa = document.createElement('div');
      caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', `Marcar como ${nome}`);
      caixa.style.cssText = 'background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.35);max-width:420px;width:100%;padding:22px;font:14px/1.5 sans-serif;color:#1c2230';
      const t = document.createElement('div'); t.style.cssText = 'font-size:17px;font-weight:800;margin-bottom:6px'; t.textContent = `Marcar como ${nome}`;
      const p = document.createElement('div'); p.style.cssText = 'color:#555;margin-bottom:4px'; p.textContent = `Pedido nº ${numero}${cliente ? ' · ' + cliente : ''}`;
      const d = document.createElement('div'); d.style.cssText = 'margin-bottom:16px';
      d.append('Data de entrega gravada: ');
      const forte = document.createElement('b'); forte.textContent = vazia(dataAtual) ? 'nenhuma' : dataBR(dataAtual); d.append(forte);
      if (!vazia(dataPronto)) { const pr = document.createElement('div'); pr.style.cssText = 'color:#555'; pr.textContent = `Data de pronto: ${dataBR(dataPronto)}`; d.append(pr); }
      const fecha = valor => { document.removeEventListener('keydown', teclas, true); fundo.remove(); resolver(valor); };
      const base = 'display:block;width:100%;margin-top:8px;padding:11px 14px;border-radius:10px;font:inherit;font-weight:700;cursor:pointer;';
      const botao = (texto, estilo, valor) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = texto; b.style.cssText = base + estilo;
        b.addEventListener('click', () => fecha(valor)); return b;
      };
      const bHoje = botao(`Atualizar a data para hoje (${hoje})`, 'border:none;background:#8B0000;color:#fff', 'hoje');
      const semDataGravada = vazia(dataAtual), temPronto = !vazia(dataPronto);
      const textoSegundo = !semDataGravada ? `Manter a data atual (${dataBR(dataAtual)})`
        : temPronto ? `Usar a data de pronto (${dataBR(dataPronto)})` : 'Manter sem data';
      const bManter = botao(textoSegundo, 'border:1px solid #c9ced6;background:#fff;color:#1c2230', semDataGravada && temPronto ? 'pronto' : 'manter');

      // escolher outra data (não pode ser futura)
      const linhaData = document.createElement('div'); linhaData.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb';
      const rotulo = document.createElement('label'); rotulo.textContent = 'Ou escolha outra data:'; rotulo.style.cssText = 'display:block;font-weight:700;margin-bottom:6px;cursor:pointer';
      const entrada = document.createElement('input'); entrada.type = 'date'; entrada.max = maxISO; entrada.id = 'escolha-data-entrega';
      rotulo.htmlFor = entrada.id;
      entrada.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #c9ced6;border-radius:10px;font:inherit;cursor:pointer';
      const bData = document.createElement('button'); bData.type = 'button'; bData.textContent = 'Usar a data escolhida';
      const estiloData = 'border:1px solid #8B0000;background:#fff;color:#8B0000';
      const valida = () => !!entrada.value && entrada.value <= maxISO;
      const atualizarBotaoData = () => { const ok = valida(); bData.disabled = !ok; bData.style.cssText = base + estiloData + (ok ? '' : ';opacity:.5;cursor:not-allowed'); };
      entrada.addEventListener('input', atualizarBotaoData);
      entrada.addEventListener('keydown', e => { if (e.key === 'Enter' && valida()) { e.preventDefault(); fecha('data:' + entrada.value); } });
      bData.addEventListener('click', () => { if (valida()) fecha('data:' + entrada.value); });
      atualizarBotaoData();
      linhaData.append(rotulo, entrada, bData);

      const bCancelar = botao('Cancelar', 'border:none;background:transparent;color:#666;font-weight:600', null);
      const teclas = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(null); }
        else if (e.key === 'Tab') { // foco preso na janela
          const itens = [bHoje, bManter, entrada, bData, bCancelar].filter(x => !x.disabled), i = itens.indexOf(document.activeElement);
          e.preventDefault(); itens[(i + (e.shiftKey ? itens.length - 1 : 1)) % itens.length].focus();
        }
      };
      fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(null); });
      document.addEventListener('keydown', teclas, true);
      caixa.append(t, p, d, bHoje, bManter, linhaData, bCancelar);
      fundo.append(caixa);
      document.body.append(fundo);
      bHoje.focus();
    });
  }

  window.EscolhaDataEntrega = { perguntar, dataBR };
})();
