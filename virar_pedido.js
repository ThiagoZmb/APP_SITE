// Janela "Transformar em pedido" (menu do botão direito de Orçamentos e botão da tela de orçamentos).
// Escolhe data de pronto, Financeiro (já "A Receber") e Produção (já "Em Produção") e tem duas saídas:
//   "Editar pedido" = cria o pedido e abre para edição; "Enviar do jeito que está" = cria o pedido direto.
// perguntar({ numero, cliente, dataPronto }) devolve { acao: 'editar'|'enviar', dataPronto, financeiro, situacao } ou null (cancelou).
// executar({ numero, cliente, dataPronto, apiBase, loginUrl, token, aoEditar(n), aoEnviar(n) }) pergunta, chama
// POST /ped_orc/orcamentos/:numero/virar_pedido (com a confirmação de orçamento já transformado) e chama o callback certo com o nº do pedido.
(function () {
  'use strict';
  const FINANCEIROS = ['Recebido', 'A Receber', 'Atrasado', 'Sem custo'];
  const SITUACOES = ['Em Produção'];
  const PADRAO = { financeiro: 'A Receber', situacao: 'Em Produção' };
  const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // aceita 'AAAA-MM-DD...' ou 'DD/MM/AAAA' (formato da lista) e devolve 'AAAA-MM-DD' ou ''
  const paraISO = v => {
    const s = String(v ?? '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  };
  // data de pronto sugerida: a do orçamento, se ainda não passou; senão vazia (a pessoa escolhe)
  const dataSugerida = (v, hoje = hojeISO()) => { const d = paraISO(v); return d && d >= hoje ? d : ''; };

  function perguntar({ numero, cliente, dataPronto }) {
    return new Promise(resolver => {
      const fundo = document.createElement('div'); fundo.className = 'dp-fundo';
      const caixa = document.createElement('div'); caixa.className = 'dp-caixa vp-caixa';
      caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', 'Transformar em pedido');
      const t = document.createElement('div'); t.className = 'dp-titulo'; t.textContent = 'Transformar em pedido';
      const sub = document.createElement('div'); sub.className = 'dp-sub'; sub.textContent = `Orçamento nº ${numero}${cliente ? ' · ' + cliente : ''}`;
      const campo = (id, texto, el) => { const l = document.createElement('label'); l.className = 'dp-rotulo vp-rotulo'; l.htmlFor = id; l.textContent = texto; el.id = id; return [l, el]; };
      const data = document.createElement('input'); data.type = 'date'; data.className = 'dp-data'; data.value = dataSugerida(dataPronto);
      const opcoes = (lista, padrao) => { const s = document.createElement('select'); s.className = 'dp-data'; for (const o of lista) s.add(new Option(o, o)); s.value = padrao; return s; };
      const fin = opcoes(FINANCEIROS, PADRAO.financeiro), sit = opcoes(SITUACOES, PADRAO.situacao);
      const nota = document.createElement('div'); nota.className = 'dp-sub vp-nota';
      nota.textContent = 'O orçamento continua como está; o pedido é criado com um número novo, com os mesmos itens e valores.';
      const acoes = document.createElement('div'); acoes.className = 'dp-acoes vp-acoes';
      const bCancelar = document.createElement('button'); bCancelar.type = 'button'; bCancelar.className = 'dp-btn'; bCancelar.textContent = 'Cancelar';
      const bEditar = document.createElement('button'); bEditar.type = 'button'; bEditar.className = 'dp-btn'; bEditar.textContent = 'Editar pedido';
      const bEnviar = document.createElement('button'); bEnviar.type = 'button'; bEnviar.className = 'dp-btn dp-btn-ok'; bEnviar.textContent = 'Enviar do jeito que está';
      const valida = () => /^\d{4}-\d{2}-\d{2}$/.test(data.value);
      const atualizar = () => { const ok = valida(); bEditar.disabled = !ok; bEnviar.disabled = !ok; };
      const fecha = valor => { document.removeEventListener('keydown', teclas, true); fundo.remove(); resolver(valor); };
      const escolher = acao => { if (valida()) fecha({ acao, dataPronto: data.value, financeiro: fin.value, situacao: sit.value }); };
      const teclas = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(null); }
        else if (e.key === 'Tab') {
          const itens = [data, fin, sit, bEnviar, bEditar, bCancelar].filter(x => !x.disabled), i = itens.indexOf(document.activeElement);
          e.preventDefault(); itens[(i + (e.shiftKey ? itens.length - 1 : 1) + itens.length) % itens.length].focus();
        }
      };
      data.addEventListener('input', atualizar);
      bEditar.addEventListener('click', () => escolher('editar'));
      bEnviar.addEventListener('click', () => escolher('enviar'));
      bCancelar.addEventListener('click', () => fecha(null));
      fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(null); });
      document.addEventListener('keydown', teclas, true);
      acoes.append(bCancelar, bEditar, bEnviar);
      caixa.append(t, sub, ...campo('vp-data', 'Data de pronto', data), ...campo('vp-financeiro', 'Financeiro', fin), ...campo('vp-producao', 'Produção', sit), nota, acoes);
      fundo.append(caixa); document.body.append(fundo);
      atualizar(); data.focus();
    });
  }

  async function executar({ numero, cliente, dataPronto, prontoEm, apiBase, loginUrl, token, aoEditar, aoEnviar }) {
    const e = await perguntar({ numero, cliente, dataPronto: dataPronto || prontoEm });
    if (!e) return;
    const url = `${apiBase}/ped_orc/orcamentos/${encodeURIComponent(numero)}/virar_pedido`;
    const enviar = confirmarDuplicado => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({ dataPronto: e.dataPronto, financeiro: e.financeiro, situacao: e.situacao, ...(confirmarDuplicado ? { confirmarDuplicado: true } : {}) }) });
    try {
      let r = await enviar(false);
      if (r.status === 401) { localStorage.removeItem('auth'); location.href = loginUrl; return; }
      let d = await r.json().catch(() => ({}));
      if (r.status === 409 && d.aviso === 'ja_convertido') {
        if (!confirm(`${d.error} Criar outro pedido mesmo assim?`)) return;
        r = await enviar(true);
        if (r.status === 401) { localStorage.removeItem('auth'); location.href = loginUrl; return; }
        d = await r.json().catch(() => ({}));
      }
      if (!r.ok || !d.ok) throw new Error(d.error || `Erro HTTP: ${r.status}`);
      if (e.acao === 'editar') aoEditar(d.numero); else aoEnviar(d.numero);
    } catch (err) { alert('Não foi possível transformar em pedido: ' + err.message); }
  }

  window.VirarPedido = { perguntar, executar, paraISO, dataSugerida, FINANCEIROS, SITUACOES, PADRAO };
})();
