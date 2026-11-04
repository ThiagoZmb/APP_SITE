// Meus pedidos (etapa 3a): lista paginada e somente leitura de /portal/api/pedidos.
(function () {
  'use strict';

  const chamar = window.PortalApi.chamar;
  const erro = document.getElementById('erro');
  const corpo = document.getElementById('corpo');
  const anterior = document.getElementById('anterior');
  const proxima = document.getElementById('proxima');
  let paginaAtual = 1;

  // YYYY-MM-DD -> DD/MM/AAAA por texto (objeto de data mudaria o dia pelo fuso)
  function formatarData(texto) {
    const m = typeof texto === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto) : null;
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }
  const texto = v => (typeof v === 'string' && v ? v : '—');

  function linha(p) {
    const tr = document.createElement('tr');
    const previsao = p.dataEntrega || p.dataAgendada;
    for (const valor of [String(p.numero), formatarData(p.data), texto(p.situacao), texto(p.entrega), formatarData(previsao)]) {
      const td = document.createElement('td');
      td.textContent = valor;
      tr.appendChild(td);
    }
    return tr;
  }

  async function carregar(pagina) {
    erro.textContent = '';
    anterior.disabled = true;
    proxima.disabled = true;
    const r = await chamar('/portal/api/pedidos?pagina=' + pagina);
    if (r.status === 401) {
      window.location.replace('/portal/login.html');
      return;
    }
    if (r.status !== 200 || !r.dados || !Array.isArray(r.dados.pedidos)) {
      erro.textContent = (r.dados && typeof r.dados.error === 'string' && r.dados.error) || 'Não foi possível carregar seus pedidos.';
      return;
    }
    paginaAtual = pagina;
    corpo.textContent = '';
    for (const p of r.dados.pedidos) corpo.appendChild(linha(p));
    if (!r.dados.pedidos.length) erro.textContent = 'Nenhum pedido encontrado.';
    anterior.disabled = paginaAtual <= 1;
    proxima.disabled = r.dados.temMais !== true;
  }

  anterior.addEventListener('click', () => carregar(paginaAtual - 1));
  proxima.addEventListener('click', () => carregar(paginaAtual + 1));

  carregar(1);
})();
