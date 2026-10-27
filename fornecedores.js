// ==========================================================================
// fornecedores.html — cadastro de fornecedores (tabela do VB cadastro_fornecedores).
// Rotas: GET /fornecedores, GET /fornecedores/:codigo, POST /fornecedores/salvar.
// Funções puras testadas no Node (test/cadastros_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou value/textContent. Nenhum valor em dinheiro passa por aqui.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Fornecedores = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt, consultarCep } = C;

  const CLASSES = ['Matéria prima', 'Insumos', 'Serviços', 'Geral'];
  const CAMPOS = ['razao', 'fantasia', 'classe', 'status', 'cnpj', 'inscricaoEstadual', 'cep', 'endereco', 'numero', 'bairro', 'cidade', 'uf', 'email', 'telefone'];

  // espelha as regras do servidor (o servidor continua decidindo)
  function validarForm(f) {
    const erros = [];
    if (!txt(f.razao)) erros.push('Informe a razão social.');
    if (!CLASSES.includes(txt(f.classe))) erros.push('Escolha a classe.');
    if (!txt(f.cidade)) erros.push('Informe a cidade.');
    if (!/^[A-Za-z]{2}$/.test(txt(f.uf))) erros.push('UF deve ter 2 letras.');
    if (txt(f.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(f.email))) erros.push('E-mail inválido.');
    return erros;
  }
  function corpoSalvar(f, codigo) {
    const b = {};
    for (const c of CAMPOS) b[c] = txt(f[c]);
    if (codigo) b.codigo = codigo;
    return b;
  }
  const seloStatus = s => `<span class="selo ${s === 'Inativo' ? 'neutro' : 'ok'}">${esc(s || 'Ativo')}</span>`;

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { lista: [], status: 'Ativo', busca: '', atual: null, ocupado: false, temporizador: null };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const podeEditar = () => !!(win.Acesso && win.Acesso.pode('fornecedores.editar'));

    async function carregar() {
      const q = new win.URLSearchParams();
      if (estado.status) q.set('status', estado.status);
      if (estado.busca) q.set('busca', estado.busca);
      try {
        const d = await chamar('/fornecedores' + (q.toString() ? '?' + q : ''));
        estado.lista = Array.isArray(d.fornecedores) ? d.fornecedores : [];
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; }
      desenharLista();
    }
    function desenharLista() {
      const alvo = $('lista');
      $('qtd').textContent = estado.lista.length ? `${estado.lista.length} fornecedor(es)` : '';
      if (!estado.lista.length) { alvo.innerHTML = '<p class="vazio">Nenhum fornecedor encontrado.</p>'; return; }
      alvo.innerHTML = '<table><thead><tr><th>Razão social</th><th>Cidade/UF</th><th>Classe</th><th>Telefone</th><th>Situação</th></tr></thead><tbody>' +
        estado.lista.map(f => `<tr data-id="${esc(f.codigo)}"${estado.atual && estado.atual.codigo === f.codigo ? ' class="selecionado"' : ''}>` +
          `<td><b>${esc(f.razao)}</b>${f.fantasia ? `<br><span class="cinza">${esc(f.fantasia)}</span>` : ''}</td><td>${esc([f.cidade, f.uf].filter(Boolean).join('/'))}</td>` +
          `<td>${esc(f.classe)}</td><td>${esc(f.telefone)}</td><td>${seloStatus(f.status)}</td></tr>`).join('') + '</tbody></table>';
    }

    // ---------- formulário ----------
    const ID = c => 'f-' + c;
    function travarForm() {
      const ok = podeEditar();
      doc.querySelectorAll('#form input, #form select').forEach(el => { el.disabled = !ok || el.dataset.fixo === '1'; });
      $('btn-cep').disabled = !ok;
    }
    function mostrarForm(f) {
      estado.atual = f;
      $('vazio-painel').hidden = true; $('form').hidden = false;
      $('titulo-form').textContent = f ? f.razao : 'Novo fornecedor';
      for (const c of CAMPOS) $(ID(c)).value = f ? (f[c] ?? '') : (c === 'status' ? 'Ativo' : '');
      // a razão social é a chave que estoque, compras e financeiro usam: depois de cadastrada não muda
      $(ID('razao')).dataset.fixo = f ? '1' : '0';
      $('dica-razao').hidden = !f;
      $('erro-form').textContent = '';
      travarForm();
      desenharLista();
    }
    async function abrir(codigo) {
      try { const d = await chamar('/fornecedores/' + encodeURIComponent(codigo)); mostrarForm(d.fornecedor); }
      catch (err) { toast(err.message, 'erro'); }
    }
    const lerForm = () => Object.fromEntries(CAMPOS.map(c => [c, $(ID(c)).value]));

    async function salvar(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const f = lerForm();
      const erros = validarForm(f);
      $('erro-form').textContent = erros.join(' ');
      if (erros.length) return;
      estado.ocupado = true; $('btn-salvar').disabled = true;
      try {
        const r = await chamar('/fornecedores/salvar', { metodo: 'POST', corpo: corpoSalvar(f, estado.atual ? estado.atual.codigo : null) });
        toast(r.criado ? 'Fornecedor cadastrado.' : 'Fornecedor atualizado.', 'ok');
        await carregar();
        await abrir(r.codigo);
      } catch (err) { $('erro-form').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-salvar').disabled = false; }
    }

    async function buscarCep() {
      const botao = $('btn-cep');
      botao.disabled = true;
      try {
        const e = await consultarCep(win, $(ID('cep')).value);
        if (!e) { toast('CEP não encontrado.', 'erro'); return; }
        $(ID('endereco')).value = e.rua; $(ID('bairro')).value = e.bairro; $(ID('cidade')).value = e.cidade; $(ID('uf')).value = e.uf;
        $(ID('numero')).focus();
      } catch (err) { toast(err.message, 'erro'); }
      finally { botao.disabled = !podeEditar(); }
    }

    // ---------- eventos ----------
    $('lista').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-id]'); if (tr) abrir(tr.getAttribute('data-id')); });
    $('busca').addEventListener('input', ev => {
      estado.busca = ev.target.value.trim();
      win.clearTimeout(estado.temporizador);
      estado.temporizador = win.setTimeout(carregar, 250);
    });
    $('filtro-status').addEventListener('change', ev => { estado.status = ev.target.value; carregar(); });
    $('btn-novo').addEventListener('click', () => mostrarForm(null));
    $('form').addEventListener('submit', salvar);
    $('btn-cep').addEventListener('click', buscarCep);
    $(ID('cep')).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); buscarCep(); } });
    $('btn-cancelar').addEventListener('click', () => { estado.atual = null; $('form').hidden = true; $('vazio-painel').hidden = false; desenharLista(); });
    carregar();
  }

  return { CLASSES, CAMPOS, validarForm, corpoSalvar, iniciar };
});
