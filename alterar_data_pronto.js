// Janela "Alterar data de pronto" do menu do botão direito (Pedidos, Orçamentos e Início).
// A data de pronto (ped_orc.DATA_PRONTO) é a data prometida; mudar aqui NÃO muda situação nem a data de entrega.
// perguntar({ tipo, numero, cliente, dataAtual }) devolve 'AAAA-MM-DD' ou null (cancelou / sem mudança).
(function () {
  'use strict';
  const dataISO = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? '')); return m ? m[1] : ''; };

  function perguntar({ tipo, numero, cliente, dataAtual }) {
    return new Promise(resolver => {
      const atual = dataISO(dataAtual);
      const fundo = document.createElement('div');
      fundo.className = 'dp-fundo';
      const caixa = document.createElement('div');
      caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', 'Alterar data de pronto');
      caixa.className = 'dp-caixa';
      const t = document.createElement('div'); t.className = 'dp-titulo'; t.textContent = 'Alterar data de pronto';
      const p = document.createElement('div'); p.className = 'dp-sub'; p.textContent = `${tipo === 'Pedido' ? 'Pedido' : 'Orçamento'} nº ${numero}${cliente ? ' · ' + cliente : ''}`;
      const rotulo = document.createElement('label'); rotulo.textContent = 'Nova data de pronto:'; rotulo.className = 'dp-rotulo';
      const entrada = document.createElement('input'); entrada.type = 'date'; entrada.id = 'alterar-data-pronto'; entrada.value = atual; rotulo.htmlFor = entrada.id;
      entrada.className = 'dp-data';
      const linha = document.createElement('div'); linha.className = 'dp-acoes';
      const bCancelar = document.createElement('button'); bCancelar.type = 'button'; bCancelar.textContent = 'Cancelar'; bCancelar.className = 'dp-btn';
      const bSalvar = document.createElement('button'); bSalvar.type = 'button'; bSalvar.textContent = 'Salvar'; bSalvar.className = 'dp-btn dp-btn-ok';
      const valida = () => !!entrada.value && entrada.value !== atual;
      const atualizar = () => { const ok = valida(); bSalvar.disabled = !ok; };
      const fecha = valor => { document.removeEventListener('keydown', teclas, true); fundo.remove(); resolver(valor); };
      const salvar = () => { if (valida()) fecha(entrada.value); };
      const teclas = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(null); }
        else if (e.key === 'Enter' && e.target === entrada) { e.preventDefault(); salvar(); }
        else if (e.key === 'Tab') {
          const itens = [entrada, bSalvar, bCancelar].filter(x => !x.disabled), i = itens.indexOf(document.activeElement);
          e.preventDefault(); itens[(i + (e.shiftKey ? itens.length - 1 : 1) + itens.length) % itens.length].focus();
        }
      };
      entrada.addEventListener('input', atualizar);
      bSalvar.addEventListener('click', salvar);
      bCancelar.addEventListener('click', () => fecha(null));
      fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(null); });
      document.addEventListener('keydown', teclas, true);
      linha.append(bCancelar, bSalvar);
      caixa.append(t, p, rotulo, entrada, linha);
      fundo.append(caixa);
      document.body.append(fundo);
      atualizar();
      entrada.focus();
    });
  }

  window.AlterarDataPronto = { perguntar, dataISO };
})();
