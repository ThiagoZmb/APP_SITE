// Login do portal: e-mail, senha e código do aplicativo (ou um código de recuperação). A mensagem de erro vem pronta do
// servidor (igual para qualquer falha); nenhum dado digitado é guardado no navegador nem escrito em console.
(function () {
  'use strict';

  const chamar = window.PortalApi.chamar;
  const form = document.getElementById('form-login');
  const campoCodigo = document.getElementById('codigo');
  const rotuloCodigo = document.getElementById('rotulo-codigo');
  const botaoTrocar = document.getElementById('trocar-codigo');
  const botaoEntrar = document.getElementById('entrar');
  const erro = document.getElementById('erro');
  let modoRecuperacao = false;
  // o botão nasce desabilitado no HTML: só com o script pronto o envio é tratado aqui (nunca um envio nativo com a senha na URL)
  botaoEntrar.disabled = false;

  function aplicarModo() {
    if (modoRecuperacao) {
      rotuloCodigo.textContent = 'Código de recuperação';
      campoCodigo.removeAttribute('inputmode');
      campoCodigo.setAttribute('autocomplete', 'off');
      campoCodigo.removeAttribute('maxlength');
      botaoTrocar.textContent = 'Usar código do aplicativo';
    } else {
      rotuloCodigo.textContent = 'Código do aplicativo (6 dígitos)';
      campoCodigo.setAttribute('inputmode', 'numeric');
      campoCodigo.setAttribute('autocomplete', 'one-time-code');
      campoCodigo.setAttribute('maxlength', '7');
      botaoTrocar.textContent = 'Usar código de recuperação';
    }
    campoCodigo.value = '';
    campoCodigo.focus();
  }

  botaoTrocar.addEventListener('click', () => {
    modoRecuperacao = !modoRecuperacao;
    erro.textContent = '';
    aplicarModo();
  });

  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    erro.textContent = '';
    botaoEntrar.disabled = true;
    const valor = campoCodigo.value.trim();
    const corpo = { email: document.getElementById('email').value.trim(), senha: document.getElementById('senha').value };
    if (modoRecuperacao) corpo.codigoRecuperacao = valor;
    else corpo.codigo = valor;
    const r = await chamar('/portal/api/login', corpo);
    if (r.status === 200 && r.dados && r.dados.ok) {
      window.location.assign('/portal/inicio.html');
      return;
    }
    // 401 e 429 trazem a mensagem do servidor; sem mensagem usa um texto genérico
    erro.textContent = (r.dados && typeof r.dados.error === 'string' && r.dados.error) || 'Não foi possível entrar. Tente de novo.';
    document.getElementById('senha').value = '';
    campoCodigo.value = '';
    botaoEntrar.disabled = false;
  });
})();
