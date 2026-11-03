// Ativação do convite. O token vem no FRAGMENTO da URL (não vai ao servidor nem a logs de acesso) e é apagado da barra
// de endereço antes de qualquer outra coisa. Senha, segredo, códigos e token ficam só em variáveis da página: nada em
// storage, console ou atributos. Os códigos de recuperação aparecem uma vez; recarregar a página não os mostra de novo.
(function () {
  'use strict';

  const SENHA_MINIMA = 12;
  const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const INVALIDO = 'Convite inválido ou expirado.';
  const REABRIR = 'Abra de novo o link do convite que você recebeu por e-mail. Atenção: ao abrir o link de novo será preciso configurar o aplicativo autenticador outra vez.';

  // apaga o fragmento ANTES de qualquer outra coisa; o token não é decodificado (base64url já é seguro para URL)
  const fragmento = window.location.hash.replace(/^#/, '').replace(/^token=/, '');
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  const chamar = window.PortalApi.chamar;
  const erro = document.getElementById('erro');
  const form = document.getElementById('form-convite');
  const secaoRecuperacao = document.getElementById('recuperacao');
  let token = FORMATO_TOKEN.test(fragmento) ? fragmento : '';
  let termoVersao = '';

  const mostrarErro = texto => { erro.textContent = texto; };
  const mensagemDe = r => (r.dados && typeof r.dados.error === 'string' && r.dados.error) || 'Não foi possível concluir. Tente de novo.';
  // segredo em grupos de 4 caracteres para facilitar a digitação
  const emGrupos = texto => (String(texto).match(/.{1,4}/g) || []).join(' ');
  const limparCodigos = () => { document.getElementById('lista-codigos').textContent = ''; };

  async function iniciar() {
    if (!token) {
      // sem fragmento (página recarregada) o link já foi apagado da barra; com fragmento malformado o convite não vale
      mostrarErro(fragmento ? INVALIDO : 'Abra de novo o link do convite que você recebeu por e-mail.');
      return;
    }
    const r = await chamar('/portal/api/convite/iniciar', { token });
    if (r.status !== 200 || !r.dados || !r.dados.segredo) {
      token = '';
      mostrarErro(r.status === 400 ? INVALIDO : mensagemDe(r));
      return;
    }
    termoVersao = r.dados.termoVersao;
    document.getElementById('conta-email').textContent = r.dados.email;
    document.getElementById('segredo').textContent = emGrupos(r.dados.segredo);
    document.getElementById('uri').textContent = r.dados.uri;
    document.getElementById('termo-versao').textContent = termoVersao;
    form.classList.remove('oculto');
    // o botão nasce desabilitado no HTML: só com a página pronta o envio passa a ser tratado aqui
    document.getElementById('concluir').disabled = false;
  }

  function mostrarCodigos(codigos) {
    const lista = document.getElementById('lista-codigos');
    for (const c of codigos) {
      const item = document.createElement('li');
      item.textContent = c;
      lista.appendChild(item);
    }
    form.classList.add('oculto');
    secaoRecuperacao.classList.remove('oculto');
    document.getElementById('titulo-codigos').focus();
  }

  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    mostrarErro('');
    const senha = document.getElementById('senha').value;
    if (senha.length < SENHA_MINIMA) return mostrarErro(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    if (senha !== document.getElementById('confirmacao').value) return mostrarErro('A confirmação da senha não confere.');
    if (!document.getElementById('aceite').checked) return mostrarErro('É preciso aceitar os termos de uso.');
    const botao = document.getElementById('concluir');
    botao.disabled = true;
    const r = await chamar('/portal/api/convite/concluir', {
      token,
      senha,
      codigo: document.getElementById('codigo').value.trim(),
      aceitoTermo: true,
      termoVersao
    });
    if (r.status === 200 && r.dados && r.dados.ok && Array.isArray(r.dados.codigosRecuperacao)) {
      token = '';
      document.getElementById('senha').value = '';
      document.getElementById('confirmacao').value = '';
      mostrarCodigos(r.dados.codigosRecuperacao);
      return;
    }
    if (r.status === 400 && r.dados && r.dados.error === INVALIDO) {
      token = '';
      form.classList.add('oculto');
      mostrarErro(INVALIDO);
      return;
    }
    if (r.status === 400 && /termos de uso foram atualizados/.test(mensagemDe(r))) {
      // a versão do termo mudou: a página precisa ser aberta de novo a partir do link
      token = '';
      form.classList.add('oculto');
      mostrarErro(`${mensagemDe(r)} ${REABRIR}`);
      return;
    }
    mostrarErro(mensagemDe(r));
    botao.disabled = false;
  });

  document.getElementById('guardei').addEventListener('click', () => {
    limparCodigos();
    window.location.assign('/portal/login.html');
  });

  // voltar/avançar do navegador pode restaurar a página com os códigos na tela: nunca mostrá-los de novo
  window.addEventListener('pageshow', evento => {
    if (evento.persisted) {
      limparCodigos();
      window.location.replace('/portal/login.html');
    }
  });

  iniciar();
})();
