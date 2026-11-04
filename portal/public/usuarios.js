// Usuários da empresa (etapa 4): o administrador geral convida, ajusta permissões, promove/rebaixa, desativa, reenvia e remove.
// Todo texto vai por textContent; o link de convite (quando o e-mail não saiu) aparece como TEXTO para copiar, nunca como link.
(function () {
  'use strict';

  const chamar = window.PortalApi.chamar;
  const erro = document.getElementById('erro');
  const aviso = document.getElementById('aviso');
  const painel = document.getElementById('painel');
  const lista = document.getElementById('lista');
  const resultado = document.getElementById('resultado-convite');
  const conviteEmail = document.getElementById('convite-email');
  const convitePedidos = document.getElementById('convite-pedidos');
  const conviteFinanceiro = document.getElementById('convite-financeiro');
  const conviteDocumentos = document.getElementById('convite-documentos');

  const PERMISSOES = [
    ['pedidos.ver', 'Ver pedidos'],
    ['financeiro.ver', 'Ver financeiro'],
    ['documentos.ver', 'Ver documentos']
  ];
  const SITUACOES = { ativo: 'Ativo', convidado: 'Convite pendente', inativo: 'Desativado' };
  const PAPEIS = { admin_geral: 'Administrador', usuario: 'Usuário' };
  let meuEmail = '';

  const mensagemDe = (r, padrao) => (r.dados && typeof r.dados.error === 'string' && r.dados.error) || padrao;
  const idValido = id => /^\d{1,9}$/.test(String(id));

  // documentos exige pedidos: marcar documentos marca pedidos; desmarcar pedidos desmarca documentos
  function ligarDependencia(pedidos, documentos) {
    documentos.addEventListener('change', () => { if (documentos.checked) pedidos.checked = true; });
    pedidos.addEventListener('change', () => { if (!pedidos.checked) documentos.checked = false; });
  }
  // caixas = [[codigo, input], ...]
  function permissoesMarcadas(caixas) {
    const marcadas = caixas.filter(c => c[1].checked).map(c => c[0]);
    if (marcadas.includes('documentos.ver') && !marcadas.includes('pedidos.ver')) marcadas.push('pedidos.ver');
    return marcadas;
  }

  ligarDependencia(convitePedidos, conviteDocumentos);

  function mostrarConvite(dados, para) {
    if (dados && typeof dados.link === 'string' && dados.link) {
      resultado.textContent = 'O e-mail não pôde ser enviado. Copie este link e entregue a ' + para + ': ' + dados.link;
    } else if (dados && dados.enviado === true) {
      resultado.textContent = 'Convite enviado por e-mail para ' + para + '.';
    } else {
      resultado.textContent = '';
    }
  }

  // Confirma, chama a rota e, se deu certo, recarrega a lista. Erro: só mostra a mensagem (a lista fica como estava).
  async function executar(usuario, texto, caminho, corpo, metodo, aoConcluir) {
    let pergunta = texto;
    if (meuEmail && typeof usuario.email === 'string' && usuario.email.toLowerCase() === meuEmail) {
      pergunta += '\n\nATENÇÃO: este é o seu próprio usuário (você mesmo). A mudança pode tirar o seu acesso de gerenciar.';
    }
    if (!window.confirm(pergunta)) return;
    erro.textContent = '';
    const r = await chamar(caminho, corpo, metodo);
    if (r.status === 401) {
      window.location.replace('/portal/login.html');
      return;
    }
    if (r.status !== 200) {
      erro.textContent = mensagemDe(r, 'Não foi possível concluir a ação.');
      return;
    }
    if (aoConcluir) aoConcluir(r.dados); else resultado.textContent = '';
    await carregarLista();
  }

  function botao(texto, acao, usuario, aoClicar) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'secundario';
    b.textContent = texto;
    b.setAttribute('data-acao', acao);
    b.setAttribute('data-usuario', String(usuario.id));
    b.addEventListener('click', aoClicar);
    return b;
  }

  function cartao(u) {
    const div = document.createElement('div');
    div.className = 'usuario';
    const titulo = document.createElement('p');
    const email = document.createElement('strong');
    email.textContent = String(u.email);
    titulo.appendChild(email);
    div.appendChild(titulo);
    const estado = document.createElement('p');
    estado.textContent = (PAPEIS[u.papel] || '—') + ' · ' + (SITUACOES[u.situacao] || '—');
    div.appendChild(estado);
    if (!idValido(u.id) || (u.situacao !== 'ativo' && u.situacao !== 'convidado' && u.situacao !== 'inativo')) return div;
    const id = Number(u.id);
    const alvo = { id, email: String(u.email) };
    const acoes = document.createElement('div');
    acoes.className = 'acoes';
    const caminho = fim => '/portal/api/usuarios/' + id + '/' + fim;

    let caixas = [];
    if (u.papel === 'usuario' && u.situacao !== 'inativo') {
      const atuais = Array.isArray(u.permissoes) ? u.permissoes : [];
      for (const [codigo, rotulo] of PERMISSOES) {
        const rot = document.createElement('label');
        rot.className = 'permissao';
        const caixa = document.createElement('input');
        caixa.type = 'checkbox';
        caixa.checked = atuais.includes(codigo);
        caixa.setAttribute('data-permissao', codigo);
        caixa.setAttribute('data-usuario', String(id));
        const nome = document.createElement('span');
        nome.textContent = ' ' + rotulo;
        rot.appendChild(caixa);
        rot.appendChild(nome);
        div.appendChild(rot);
        caixas.push([codigo, caixa]);
      }
      ligarDependencia(caixas[0][1], caixas[2][1]);
    }

    if (u.papel === 'usuario' && u.situacao !== 'inativo') {
      acoes.appendChild(botao('Salvar permissões', 'salvar', alvo, () => executar(alvo,
        'Salvar as permissões de ' + alvo.email + '?', caminho('permissoes'), { permissoes: permissoesMarcadas(caixas) }, 'PUT')));
    }
    if (u.papel === 'usuario' && u.situacao === 'ativo') {
      acoes.appendChild(botao('Tornar administrador', 'promover', alvo, () => executar(alvo,
        'Tornar ' + alvo.email + ' administrador? Ele passa a ter todas as permissões e a gerenciar os usuários.', caminho('papel'), { papel: 'admin_geral' })));
    }
    if (u.papel === 'admin_geral' && u.situacao === 'ativo') {
      acoes.appendChild(botao('Tornar usuário comum', 'rebaixar', alvo, () => executar(alvo,
        'Tornar ' + alvo.email + ' usuário comum? Ele fica sem permissões até você concedê-las e perde a gestão de usuários.', caminho('papel'), { papel: 'usuario', permissoes: [] })));
    }
    if (u.situacao === 'convidado') {
      acoes.appendChild(botao('Reenviar convite', 'reenviar', alvo, () => executar(alvo,
        'Reenviar o convite para ' + alvo.email + '? O convite anterior deixa de valer.', caminho('reenviar_convite'), {}, undefined,
        dados => mostrarConvite(dados, alvo.email))));
    }
    if (u.situacao === 'ativo' || u.situacao === 'convidado') {
      acoes.appendChild(botao('Desativar', 'desativar', alvo, () => executar(alvo,
        'Desativar ' + alvo.email + '? O acesso é encerrado agora.', caminho('desativar'), {})));
    }
    if (u.situacao === 'convidado') {
      acoes.appendChild(botao('Remover', 'remover', alvo, () => executar(alvo,
        'Remover o convite de ' + alvo.email + '? Isto apaga o cadastro e não pode ser desfeito.', caminho('remover'), {})));
    }
    if (acoes.children.length) div.appendChild(acoes);
    return div;
  }

  async function carregarLista() {
    const r = await chamar('/portal/api/usuarios');
    if (r.status === 401) {
      window.location.replace('/portal/login.html');
      return;
    }
    if (r.status !== 200 || !r.dados || !Array.isArray(r.dados.usuarios)) {
      erro.textContent = mensagemDe(r, 'Não foi possível carregar os usuários.');
      return;
    }
    lista.textContent = '';
    for (const u of r.dados.usuarios) lista.appendChild(cartao(u));
  }

  document.getElementById('convidar').addEventListener('click', async () => {
    erro.textContent = '';
    const email = String(conviteEmail.value || '').trim();
    if (!email) {
      erro.textContent = 'Informe o e-mail do usuário.';
      return;
    }
    const permissoes = [];
    if (convitePedidos.checked || conviteDocumentos.checked) permissoes.push('pedidos.ver');
    if (conviteFinanceiro.checked) permissoes.push('financeiro.ver');
    if (conviteDocumentos.checked) permissoes.push('documentos.ver');
    const r = await chamar('/portal/api/usuarios', { email, permissoes });
    if (r.status === 401) {
      window.location.replace('/portal/login.html');
      return;
    }
    if (r.status !== 200) {
      erro.textContent = mensagemDe(r, 'Não foi possível enviar o convite.');
      return;
    }
    mostrarConvite(r.dados, email);
    conviteEmail.value = '';
    convitePedidos.checked = false;
    conviteFinanceiro.checked = false;
    conviteDocumentos.checked = false;
    await carregarLista();
  });

  async function iniciar() {
    const r = await chamar('/portal/api/eu');
    if (r.status === 401) {
      window.location.replace('/portal/login.html');
      return;
    }
    if (r.status !== 200 || !r.dados || !r.dados.usuario) {
      erro.textContent = mensagemDe(r, 'Não foi possível carregar seus dados.');
      return;
    }
    const u = r.dados.usuario;
    meuEmail = typeof u.email === 'string' ? u.email.toLowerCase() : '';
    // a tela só aparece com a permissão; as rotas continuam exigindo usuarios.gerir no servidor
    if (!Array.isArray(u.permissoes) || !u.permissoes.includes('usuarios.gerir')) {
      aviso.hidden = false;
      return;
    }
    painel.hidden = false;
    await carregarLista();
  }

  iniciar();
})();
