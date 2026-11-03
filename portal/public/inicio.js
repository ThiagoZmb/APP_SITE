// Início do portal (provisório até a etapa 3): confirma a sessão em /portal/api/eu e oferece o botão Sair.
(function () {
  'use strict';

  const chamar = window.PortalApi.chamar;
  const erro = document.getElementById('erro');

  async function carregar() {
    const r = await chamar('/portal/api/eu');
    if (r.status === 401) {
      window.location.replace('/portal/login.html');
      return;
    }
    if (r.status !== 200 || !r.dados || !r.dados.usuario) {
      erro.textContent = (r.dados && typeof r.dados.error === 'string' && r.dados.error) || 'Não foi possível carregar seus dados.';
      return;
    }
    const u = r.dados.usuario;
    document.getElementById('usuario-email').textContent = u.email;
    document.getElementById('usuario-empresa').textContent = u.empresa ? u.empresa.razaoSocial : '';
  }

  document.getElementById('sair').addEventListener('click', async () => {
    const r = await chamar('/portal/api/logout', {});
    if (r.status === 200) {
      window.location.assign('/portal/login.html');
      return;
    }
    erro.textContent = (r.dados && typeof r.dados.error === 'string' && r.dados.error) || 'Não foi possível sair. Tente de novo.';
  });

  carregar();
})();
