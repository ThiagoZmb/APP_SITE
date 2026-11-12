// ==========================================================================
// portal_admin.html — tela da EQUIPE do portal do cliente (sistema interno; não é a tela do cliente).
// Rotas (rotas/portal_admin.js, exigem portal.gerir): GET /admin/portal/clientes?q=, GET /admin/portal/empresas,
// GET /admin/portal/empresas/:codigo/usuarios, POST /admin/portal/empresas, .../suspender, .../reativar,
// POST /admin/portal/convites, POST /admin/portal/usuarios/:id/reenviar_convite, .../reiniciar_2fa, .../desativar e .../remover.
// Dado vindo da API só entra na tela por textContent/value (a tela é montada com createElement; não há innerHTML).
// O link do convite existe só em memória e no campo da tela: não vai a localStorage/sessionStorage nem a log,
// e some ao fechar ou trocar de empresa. A tela no navegador real não tem teste automático.
// ==========================================================================
(function (raiz) {
  'use strict';
  const C = raiz.EntregasComum;

  const ROTULO_SITUACAO_PORTAL = { nao_liberada: 'Não liberada', ativa: 'Ativa', suspensa: 'Suspensa' };
  const cor = v => raiz.Situacoes.cor('cadastro', v);
  const ROTULO_PAPEL = { admin_geral: 'Administrador geral' };
  const ROTULO_SITUACAO_USUARIO = { convidado: 'Convidado', ativo: 'Ativo', inativo: 'Inativo' };
  const MSG_DESATIVAR = 'A pessoa perde o acesso e as sessões abertas caem. Continuar?';
  const MSG_REMOVER = 'Remover apaga este convite e o cadastro da pessoa no portal; só vale para quem ainda não aceitou o convite (e-mail digitado errado). Continuar?';
  const MSG_SUSPENDER = 'Suspender derruba todas as sessões desta empresa. Continuar?';
  const MSG_REINICIAR = 'Reiniciar o 2º fator: a pessoa terá de configurar o aplicativo de autenticação de novo e perderá os códigos de recuperação atuais. Continuar?';

  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { clientes: [], empresas: [], empresa: null, usuarios: [], ocupado: false, temporizador: null, seqBusca: 0 };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);

    // ---------- montagem da tela (sempre textContent) ----------
    function el(tag, texto, classe) {
      const n = doc.createElement(tag);
      if (texto !== undefined && texto !== null) n.textContent = String(texto);
      if (classe) n.className = classe;
      return n;
    }
    function selo(texto, classe) { return el('span', texto, 'selo' + (classe ? ' ' + classe : '')); }
    function botao(texto, classe, aoClicar) {
      const b = el('button', texto, 'btn btn-mini ' + classe);
      b.type = 'button';
      b.addEventListener('click', aoClicar);
      return b;
    }
    function tabela(cabecalhos, linhas, selecionada) {
      const t = el('table');
      const cab = el('tr');
      for (const c of cabecalhos) cab.appendChild(el('th', c));
      t.appendChild(el('thead')).appendChild(cab);
      const corpo = el('tbody');
      linhas.forEach((celulas, i) => {
        const tr = el('tr', null, i === selecionada ? 'selecionado' : '');
        for (const c of celulas) {
          const td = el('td');
          if (c && c.nodeType) td.appendChild(c); else td.textContent = c === undefined || c === null ? '' : String(c);
          tr.appendChild(td);
        }
        corpo.appendChild(tr);
      });
      t.appendChild(corpo);
      return t;
    }
    function trocarConteudo(alvo, no) { alvo.replaceChildren(no); }
    const mostrarVazio = (alvo, texto) => trocarConteudo(alvo, el('p', texto, 'vazio'));

    // ---------- link do convite (só em memória/tela) ----------
    function limparLink() {
      $('campo-link').value = '';
      $('caixa-link').hidden = true;
      $('msg-copia').textContent = '';
      $('msg-convite').hidden = true;
      $('msg-convite').textContent = '';
    }
    // resposta de convite/reenvio/reinício: com e-mail enviado não há link; sem envio a equipe repassa o link
    function mostrarResultadoConvite(r) {
      limparLink();
      if (r && r.emailEnviado) {
        $('msg-convite').textContent = 'Convite enviado por e-mail.';
        $('msg-convite').hidden = false;
        toast('Convite enviado por e-mail.', 'ok');
      } else if (r && r.link) {
        $('campo-link').value = r.link;
        $('caixa-link').hidden = false;
        toast('Convite criado. Copie o link abaixo.', 'info');
      }
    }
    async function copiarLink() {
      const campo = $('campo-link');
      if (!campo.value) return;
      try {
        await win.navigator.clipboard.writeText(campo.value);
        $('msg-copia').textContent = 'Link copiado.';
      } catch {
        // sem permissão da área de transferência: deixa o texto selecionado para copiar à mão
        campo.focus(); campo.select();
        $('msg-copia').textContent = 'Não foi possível copiar sozinho. Use Ctrl+C com o link selecionado.';
      }
    }

    // ---------- busca e liberação de clientes ----------
    function desenharClientes(termo) {
      const alvo = $('lista-clientes');
      $('dica-duplicados').hidden = !estado.clientes.some(c => !c.liberavel && c.situacaoPortal === 'nao_liberada');
      if (!estado.clientes.length) { mostrarVazio(alvo, termo ? 'Nenhum cliente encontrado.' : 'Digite para buscar um cliente.'); return; }
      const linhas = estado.clientes.map(c => {
        const acao = el('div');
        if (c.liberavel) acao.appendChild(botao('Liberar', 'btn-primary', () => liberar(c)));
        else if (c.motivo) acao.appendChild(el('span', c.motivo, 'cinza'));
        return [
          c.codigo,
          c.razaoSocial,
          selo(ROTULO_SITUACAO_PORTAL[c.situacaoPortal] || c.situacaoPortal, cor(c.situacaoPortal)),
          acao
        ];
      });
      trocarConteudo(alvo, tabela(['Código', 'Razão social', 'Portal', ''], linhas));
    }
    async function buscar() {
      const termo = $('busca').value.trim();
      const seq = ++estado.seqBusca;
      if (!termo) { estado.clientes = []; desenharClientes(''); return; }
      try {
        const d = await chamar('/admin/portal/clientes?q=' + encodeURIComponent(termo));
        if (seq !== estado.seqBusca) return;   // resposta velha
        estado.clientes = Array.isArray(d.clientes) ? d.clientes : [];
      } catch (err) { if (seq !== estado.seqBusca) return; toast(err.message, 'erro'); estado.clientes = []; }
      desenharClientes(termo);
    }
    async function liberar(cliente) {
      if (estado.ocupado) return;
      estado.ocupado = true;
      try {
        await chamar('/admin/portal/empresas', { metodo: 'POST', corpo: { clienteCodigo: cliente.codigo } });
        toast('Empresa liberada para o portal.', 'ok');
        await Promise.all([buscar(), carregarEmpresas()]);
      } catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }

    // ---------- empresas liberadas ----------
    function desenharEmpresas() {
      const alvo = $('lista-empresas');
      $('qtd-empresas').textContent = estado.empresas.length ? `${estado.empresas.length} empresa(s)` : '';
      if (!estado.empresas.length) { mostrarVazio(alvo, 'Nenhuma empresa liberada ainda.'); return; }
      let selecionada = -1;
      const linhas = estado.empresas.map((e, i) => {
        if (estado.empresa && estado.empresa.clienteCodigo === e.clienteCodigo) selecionada = i;
        const acoes = el('div', null, 'acoes');
        acoes.appendChild(botao('Abrir', 'btn-secondary', () => abrirEmpresa(e)));
        if (e.situacao === 'suspensa') acoes.appendChild(botao('Reativar', 'btn-secondary', () => reativar(e)));
        else acoes.appendChild(botao('Suspender', 'btn-perigo', () => suspender(e)));
        return [
          e.razaoSocial || ('Cliente ' + e.clienteCodigo),
          selo(ROTULO_SITUACAO_PORTAL[e.situacao] || e.situacao, cor(e.situacao)),
          e.qtdUsuarios,
          acoes
        ];
      });
      trocarConteudo(alvo, tabela(['Empresa', 'Situação', 'Usuários', ''], linhas, selecionada));
    }
    async function carregarEmpresas() {
      try {
        const d = await chamar('/admin/portal/empresas');
        estado.empresas = Array.isArray(d.empresas) ? d.empresas : [];
      } catch (err) { toast(err.message, 'erro'); estado.empresas = []; }
      // a empresa aberta acompanha a lista (situação nova, ou saiu dela)
      if (estado.empresa) {
        estado.empresa = estado.empresas.find(e => e.clienteCodigo === estado.empresa.clienteCodigo) || null;
        if (!estado.empresa) fecharEmpresa();
        else desenharCabecalhoEmpresa();
      }
      desenharEmpresas();
    }
    async function suspender(empresa) {
      if (estado.ocupado) return;
      if (!win.confirm(MSG_SUSPENDER)) return;
      estado.ocupado = true;
      try {
        await chamar('/admin/portal/empresas/' + encodeURIComponent(empresa.clienteCodigo) + '/suspender', { metodo: 'POST' });
        toast('Empresa suspensa.', 'ok');
        await carregarEmpresas();
      } catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }
    async function reativar(empresa) {
      if (estado.ocupado) return;
      estado.ocupado = true;
      try {
        await chamar('/admin/portal/empresas/' + encodeURIComponent(empresa.clienteCodigo) + '/reativar', { metodo: 'POST' });
        toast('Empresa reativada.', 'ok');
        await carregarEmpresas();
      } catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }

    // ---------- empresa aberta: usuários e convite ----------
    function desenharCabecalhoEmpresa() {
      const e = estado.empresa;
      $('titulo-empresa').textContent = e.razaoSocial || ('Cliente ' + e.clienteCodigo);
      $('situacao-empresa').textContent = `Código ${e.clienteCodigo} · ${ROTULO_SITUACAO_PORTAL[e.situacao] || e.situacao}`;
      $('btn-convidar').disabled = e.situacao !== 'ativa';
    }
    function desenharUsuarios() {
      const alvo = $('lista-usuarios');
      if (!estado.usuarios.length) { mostrarVazio(alvo, 'Nenhum usuário convidado ainda.'); return; }
      const linhas = estado.usuarios.map(u => {
        const acoes = el('div', null, 'acoes');
        if (u.situacao === 'convidado') {
          acoes.appendChild(botao('Reenviar convite', 'btn-secondary', () => reenviar(u)));
          acoes.appendChild(botao('Remover', 'btn-perigo', () => remover(u)));
        }
        if (u.situacao === 'ativo') acoes.appendChild(botao('Reiniciar 2º fator', 'btn-perigo', () => reiniciar2fa(u)));
        if (u.situacao === 'convidado' || u.situacao === 'ativo') acoes.appendChild(botao('Desativar', 'btn-perigo', () => desativar(u)));
        return [
          u.email,
          ROTULO_PAPEL[u.papel] || u.papel,
          selo(ROTULO_SITUACAO_USUARIO[u.situacao] || u.situacao, cor(u.situacao)),
          acoes
        ];
      });
      trocarConteudo(alvo, tabela(['E-mail', 'Papel', 'Situação', ''], linhas));
    }
    async function carregarUsuarios() {
      if (!estado.empresa) return;
      const codigo = estado.empresa.clienteCodigo;
      try {
        const d = await chamar('/admin/portal/empresas/' + encodeURIComponent(codigo) + '/usuarios');
        if (!estado.empresa || estado.empresa.clienteCodigo !== codigo) return;   // trocou de empresa no meio
        estado.usuarios = Array.isArray(d.usuarios) ? d.usuarios : [];
      } catch (err) { toast(err.message, 'erro'); estado.usuarios = []; }
      desenharUsuarios();
    }
    async function abrirEmpresa(empresa) {
      limparLink();
      estado.empresa = empresa;
      estado.usuarios = [];
      $('erro-convite').textContent = '';
      $('convite-email').value = '';
      $('vazio-painel').hidden = true;
      $('detalhe').hidden = false;
      desenharCabecalhoEmpresa();
      mostrarVazio($('lista-usuarios'), 'Carregando…');
      desenharEmpresas();
      await carregarUsuarios();
    }
    function fecharEmpresa() {
      limparLink();
      estado.empresa = null;
      estado.usuarios = [];
      $('detalhe').hidden = true;
      $('vazio-painel').hidden = false;
      $('convite-email').value = '';
      $('erro-convite').textContent = '';
      desenharEmpresas();
    }

    async function convidar(ev) {
      ev.preventDefault();
      if (estado.ocupado || !estado.empresa) return;
      const emailInformado = $('convite-email').value.trim();
      if (!emailInformado) { $('erro-convite').textContent = 'Informe o e-mail do administrador geral.'; return; }
      $('erro-convite').textContent = '';
      limparLink();
      estado.ocupado = true; $('btn-convidar').disabled = true;
      try {
        const r = await chamar('/admin/portal/convites', { metodo: 'POST', corpo: { clienteCodigo: estado.empresa.clienteCodigo, email: emailInformado } });
        $('convite-email').value = '';
        mostrarResultadoConvite(r);
        await Promise.all([carregarUsuarios(), carregarEmpresas()]);
      } catch (err) { $('erro-convite').textContent = err.message; }
      finally { estado.ocupado = false; if (estado.empresa) $('btn-convidar').disabled = estado.empresa.situacao !== 'ativa'; }
    }
    async function reenviar(usuario) {
      if (estado.ocupado) return;
      limparLink();
      estado.ocupado = true;
      try {
        const r = await chamar('/admin/portal/usuarios/' + encodeURIComponent(usuario.id) + '/reenviar_convite', { metodo: 'POST' });
        mostrarResultadoConvite(r);
        await carregarUsuarios();
      } catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }
    async function reiniciar2fa(usuario) {
      if (estado.ocupado) return;
      if (!win.confirm(MSG_REINICIAR)) return;
      limparLink();
      estado.ocupado = true;
      try {
        const r = await chamar('/admin/portal/usuarios/' + encodeURIComponent(usuario.id) + '/reiniciar_2fa', { metodo: 'POST' });
        mostrarResultadoConvite(r);
        await carregarUsuarios();
      } catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }

    // Desativar: a pessoa perde o acesso (convites e sessões caem). Remover: só para quem nunca aceitou o convite (e-mail errado).
    async function desativar(usuario) {
      if (estado.ocupado) return;
      if (!win.confirm(MSG_DESATIVAR)) return;
      limparLink();
      estado.ocupado = true;
      try {
        await chamar('/admin/portal/usuarios/' + encodeURIComponent(usuario.id) + '/desativar', { metodo: 'POST' });
        toast('Usuário desativado.', 'ok');
        await Promise.all([carregarUsuarios(), carregarEmpresas()]);
      } catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }
    async function remover(usuario) {
      if (estado.ocupado) return;
      if (!win.confirm(MSG_REMOVER)) return;
      limparLink();
      estado.ocupado = true;
      try {
        await chamar('/admin/portal/usuarios/' + encodeURIComponent(usuario.id) + '/remover', { metodo: 'POST' });
        toast('Usuário removido.', 'ok');
        await Promise.all([carregarUsuarios(), carregarEmpresas()]);
      } catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }

    // ---------- eventos ----------
    $('busca').addEventListener('input', () => {
      win.clearTimeout(estado.temporizador);
      estado.temporizador = win.setTimeout(buscar, 300);
    });
    $('form-convite').addEventListener('submit', convidar);
    $('btn-fechar').addEventListener('click', fecharEmpresa);
    $('btn-copiar').addEventListener('click', copiarLink);
    desenharClientes('');
    carregarEmpresas();
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => iniciar(raiz));
})(typeof self !== 'undefined' ? self : this);
