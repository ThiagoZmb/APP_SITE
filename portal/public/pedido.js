// Detalhe do pedido (etapa 3c): dados do pedido e, com documentos.ver, PDF do pedido e DANFE das notas ligadas a ele.
(function () {
  'use strict';

  const chamar = window.PortalApi.chamar;
  const erro = document.getElementById('erro');
  const secaoDocumentos = document.getElementById('documentos');
  const listaDocumentos = document.getElementById('lista-documentos');

  // YYYY-MM-DD -> DD/MM/AAAA por texto (objeto de data mudaria o dia pelo fuso)
  function formatarData(texto) {
    const m = typeof texto === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto) : null;
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }
  const texto = v => (typeof v === 'string' && v ? v : '—');
  const mensagem = (r, padrao) => (r.dados && typeof r.dados.error === 'string' && r.dados.error) || padrao;

  // o href só é montado a partir do número validado e de chave de exatamente 44 dígitos
  function botao(rotulo, href) {
    const a = document.createElement('a');
    a.textContent = rotulo;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  async function mostrarDocumentos(numero) {
    const eu = await chamar('/portal/api/eu');
    if (eu.status === 401) { window.location.replace('/portal/login.html'); return; }
    const permissoes = eu.status === 200 && eu.dados && eu.dados.usuario && eu.dados.usuario.permissoes;
    if (!Array.isArray(permissoes) || !permissoes.includes('documentos.ver')) return;
    const base = '/portal/api/pedidos/' + numero;
    const r = await chamar(base + '/documentos');
    if (r.status === 401) { window.location.replace('/portal/login.html'); return; }
    if (r.status !== 200 || !r.dados) {
      erro.textContent = mensagem(r, 'Não foi possível carregar os documentos.');
      return;
    }
    listaDocumentos.textContent = '';
    if (r.dados.pdfPedido === true) listaDocumentos.appendChild(botao('PDF do pedido', base + '/pdf'));
    for (const n of Array.isArray(r.dados.notas) ? r.dados.notas : []) {
      if (!n || typeof n.chave !== 'string' || !/^\d{44}$/.test(n.chave)) continue;
      const nf = typeof n.numeroNf === 'string' || typeof n.numeroNf === 'number' ? String(n.numeroNf).replace(/\D/g, '') : '';
      listaDocumentos.appendChild(botao(nf ? 'Nota fiscal ' + nf : 'Nota fiscal', base + '/danfe/' + n.chave));
    }
    secaoDocumentos.hidden = listaDocumentos.children.length === 0;
  }

  async function carregar() {
    const bruto = new URLSearchParams(window.location.search).get('numero');
    if (typeof bruto !== 'string' || !/^\d{1,9}$/.test(bruto)) {
      erro.textContent = 'Pedido não encontrado.';
      return;
    }
    const numero = String(Number(bruto));
    const r = await chamar('/portal/api/pedidos/' + numero);
    if (r.status === 401) { window.location.replace('/portal/login.html'); return; }
    if (r.status !== 200 || !r.dados || !r.dados.pedido) {
      erro.textContent = mensagem(r, 'Não foi possível carregar o pedido.');
      return;
    }
    const p = r.dados.pedido;
    document.getElementById('numero').textContent = String(numero);
    document.getElementById('data').textContent = formatarData(p.data);
    document.getElementById('situacao').textContent = texto(p.situacao);
    document.getElementById('entrega').textContent = texto(p.entrega);
    document.getElementById('previsao').textContent = formatarData(p.dataEntrega || p.dataAgendada);
    await mostrarDocumentos(numero);
  }

  carregar();
})();
