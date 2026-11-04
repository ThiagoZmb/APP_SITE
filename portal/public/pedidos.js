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
    const numero = String(p.numero);
    [numero, formatarData(p.data), texto(p.situacao), texto(p.entrega), formatarData(previsao)].forEach((valor, i) => {
      const td = document.createElement('td');
      if (i === 0 && /^\d{1,9}$/.test(numero)) {
        // o href só nasce de número inteiro validado
        const a = document.createElement('a');
        a.textContent = numero;
        a.href = 'pedido.html?numero=' + numero;
        td.appendChild(a);
      } else {
        td.textContent = valor;
      }
      tr.appendChild(td);
    });
    return tr;
  }

  async function carregar(pagina) {
    erro.textContent = '';
    const anteriorAntes = anterior.disabled;
    const proximaAntes = proxima.disabled;
    anterior.disabled = true;
    proxima.disabled = true;
    const r = await chamar('/portal/api/pedidos?pagina=' + pagina);
    if (r.status === 401) {
      window.location.replace('/portal/login.html');
      return;
    }
    if (r.status !== 200 || !r.dados || !Array.isArray(r.dados.pedidos)) {
      // falhou: a tabela e a página atual ficam como estavam e os botões voltam, para tentar de novo sem recarregar
      anterior.disabled = anteriorAntes;
      proxima.disabled = proximaAntes;
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
