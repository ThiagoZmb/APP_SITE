// Helper compartilhado das páginas do portal: toda chamada vai à mesma origem, com cookie de sessão e os dois cabeçalhos
// que a API exige. Devolve { status, dados } e nunca lança por erro de HTTP (só rede/resposta ilegível viram status 0).
(function () {
  'use strict';

  // `metodo` é opcional e só vale com corpo ('POST' por padrão); sem corpo a chamada é GET
  async function chamar(caminho, corpo, metodo) {
    const opcoes = {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Portal': '1' }
    };
    if (corpo !== undefined) {
      opcoes.method = metodo || 'POST';
      opcoes.body = JSON.stringify(corpo);
    }
    let resposta;
    try {
      resposta = await fetch(caminho, opcoes);
    } catch {
      return { status: 0, dados: { error: 'Não foi possível conectar. Verifique a internet e tente de novo.' } };
    }
    let dados = {};
    try { dados = await resposta.json(); } catch { dados = {}; }
    return { status: resposta.status, dados, retryAfter: resposta.headers.get('Retry-After') };
  }

  window.PortalApi = { chamar };
})();
