// Financeiro (etapa 3b): resumo e lista paginada, somente leitura, de /portal/api/financeiro.
(function () {
  'use strict';

  const chamar = window.PortalApi.chamar;
  const erro = document.getElementById('erro');
  const corpo = document.getElementById('corpo');
  const anterior = document.getElementById('anterior');
  const proxima = document.getElementById('proxima');
  const abas = { abertos: document.getElementById('aba-abertos'), pagos: document.getElementById('aba-pagos') };
  const resumoReceber = document.getElementById('resumo-receber');
  const resumoAtraso = document.getElementById('resumo-atraso');
  let visaoAtual = 'abertos';
  let paginaAtual = 1;

  // YYYY-MM-DD -> DD/MM/AAAA por texto (objeto de data mudaria o dia pelo fuso)
  function formatarData(texto) {
    const m = typeof texto === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto) : null;
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }
  // 1000.5 -> "R$ 1.000,50", por texto (sem depender do idioma do navegador)
  function formatarDinheiro(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    const centavos = Math.round(Math.abs(n) * 100);
    const inteiro = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const resto = String(centavos % 100).padStart(2, '0');
    return (n < 0 && centavos > 0 ? '-' : '') + 'R$ ' + inteiro + ',' + resto;
  }
  const texto = v => (typeof v === 'string' && v ? v : '—');
  const numero = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '—');

  function linha(t) {
    const tr = document.createElement('tr');
    for (const valor of [formatarData(t.vencimento), numero(t.pedido), texto(t.notaFiscal), formatarDinheiro(t.valor), texto(t.situacao)]) {
      const td = document.createElement('td');
      td.textContent = valor;
      tr.appendChild(td);
    }
    return tr;
  }

  function marcarAba(visao) {
    for (const nome of Object.keys(abas)) abas[nome].setAttribute('aria-pressed', nome === visao ? 'true' : 'false');
  }

  async function carregar(visao, pagina) {
    erro.textContent = '';
    const anteriorAntes = anterior.disabled;
    const proximaAntes = proxima.disabled;
    anterior.disabled = true;
    proxima.disabled = true;
    const r = await chamar('/portal/api/financeiro?visao=' + visao + '&pagina=' + pagina);
    if (r.status === 401) {
      window.location.replace('/portal/login.html');
      return;
    }
    if (r.status !== 200 || !r.dados || !Array.isArray(r.dados.titulos)) {
      // falhou: tabela, aba e página ficam como estavam e os botões voltam, para tentar de novo sem recarregar
      anterior.disabled = anteriorAntes;
      proxima.disabled = proximaAntes;
      erro.textContent = (r.dados && typeof r.dados.error === 'string' && r.dados.error) || 'Não foi possível carregar seu financeiro.';
      return;
    }
    visaoAtual = visao;
    paginaAtual = pagina;
    marcarAba(visaoAtual);
    const resumo = r.dados.resumo || {};
    resumoReceber.textContent = formatarDinheiro(resumo.aReceber);
    resumoAtraso.textContent = formatarDinheiro(resumo.emAtraso);
    corpo.textContent = '';
    for (const t of r.dados.titulos) corpo.appendChild(linha(t));
    if (!r.dados.titulos.length) erro.textContent = 'Nenhum título encontrado.';
    anterior.disabled = paginaAtual <= 1;
    proxima.disabled = r.dados.temMais !== true;
  }

  anterior.addEventListener('click', () => carregar(visaoAtual, paginaAtual - 1));
  proxima.addEventListener('click', () => carregar(visaoAtual, paginaAtual + 1));
  abas.abertos.addEventListener('click', () => carregar('abertos', 1));
  abas.pagos.addEventListener('click', () => carregar('pagos', 1));

  marcarAba(visaoAtual);
  carregar(visaoAtual, 1);
})();
