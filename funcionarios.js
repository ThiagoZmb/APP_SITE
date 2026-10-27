// ==========================================================================
// funcionarios.html — cadastro de funcionários (tabela do VB funcionarios).
// Rotas: GET /funcionarios, GET /funcionarios/cargos, GET /funcionarios/:codigo, POST /funcionarios/salvar.
// Salário e encargos só aparecem (e só são enviados) para quem tem `valores.ver`; o servidor também confere.
// A senha do VB nunca vem para a web. Dado vindo da API só entra na tela por esc() ou value/textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Funcionarios = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt, dataValida, dataBR, consultarCep } = C;

  const SITUACOES = ['Ativo', 'Inativo', 'Demitido'];
  const CAMPOS = ['nome', 'situacao', 'cargo', 'cpf', 'identidade', 'telefone', 'admissao', 'demissao', 'cep', 'endereco', 'bairro', 'cidade', 'uf'];
  // chave da API -> rótulo (mesmos campos de DINHEIRO_FUNCIONARIO em calculo/cadastros.js)
  const DINHEIRO = [['salarioBase', 'Salário base'], ['fgts', 'FGTS'], ['ferias', 'Férias (1/12)'], ['feriasFgts', 'FGTS das férias'], ['decimo', '13º (1/12)'],
    ['decimoFgts', 'FGTS do 13º'], ['almoco', 'Almoço'], ['transporte', 'Transporte'], ['planoSaude', 'Plano de saúde'], ['segVida', 'Seguro de vida'], ['outros', 'Outros']];

  // espelha as regras do servidor (o servidor continua decidindo)
  function validarForm(f, { comValores = false } = {}) {
    const erros = [];
    if (!txt(f.nome)) erros.push('Informe o nome.');
    if (!SITUACOES.includes(txt(f.situacao))) erros.push('Escolha a situação.');
    if (!txt(f.cargo)) erros.push('Informe o cargo.');
    if (!dataValida(txt(f.admissao))) erros.push('Informe a data de admissão.');
    if (txt(f.situacao) === 'Demitido' && !dataValida(txt(f.demissao))) erros.push('Informe a data de demissão.');
    if (txt(f.demissao) && !dataValida(txt(f.demissao))) erros.push('Data de demissão inválida.');
    if (txt(f.uf) && !/^[A-Za-z]{2}$/.test(txt(f.uf))) erros.push('UF deve ter 2 letras.');
    if (comValores) {
      for (const [k, rotulo] of DINHEIRO) {
        const v = txt(f[k]);
        if (v !== '' && !(Number.isFinite(Number(v)) && Number(v) >= 0)) erros.push(`${rotulo}: informe um número maior ou igual a zero.`);
      }
    }
    return erros;
  }
  function corpoSalvar(f, codigo, { comValores = false } = {}) {
    const b = {};
    for (const c of CAMPOS) b[c] = txt(f[c]);
    b.insalubridade = !!f.insalubridade;
    if (comValores) for (const [k] of DINHEIRO) b[k] = txt(f[k]);
    if (codigo) b.codigo = codigo;
    return b;
  }
  const seloSituacao = s => `<span class="selo ${s === 'Ativo' ? 'ok' : s === 'Demitido' ? 'perigo' : 'neutro'}">${esc(s || 'Ativo')}</span>`;

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { lista: [], situacao: 'Ativo', busca: '', atual: null, ocupado: false, temporizador: null };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const pode = p => !!(win.Acesso && win.Acesso.pode(p));
    const comValores = () => pode('valores.ver');

    async function carregar() {
      const q = new win.URLSearchParams();
      if (estado.situacao) q.set('situacao', estado.situacao);
      if (estado.busca) q.set('busca', estado.busca);
      try {
        const d = await chamar('/funcionarios' + (q.toString() ? '?' + q : ''));
        estado.lista = Array.isArray(d.funcionarios) ? d.funcionarios : [];
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; }
      desenharLista();
    }
    function desenharLista() {
      const alvo = $('lista');
      $('qtd').textContent = estado.lista.length ? `${estado.lista.length} funcionário(s)` : '';
      if (!estado.lista.length) { alvo.innerHTML = '<p class="vazio">Nenhum funcionário encontrado.</p>'; return; }
      alvo.innerHTML = '<table><thead><tr><th>Nome</th><th>Cargo</th><th>Telefone</th><th>Admissão</th><th>Situação</th></tr></thead><tbody>' +
        estado.lista.map(f => `<tr data-id="${esc(f.codigo)}"${estado.atual && estado.atual.codigo === f.codigo ? ' class="selecionado"' : ''}>` +
          `<td><b>${esc(f.nome)}</b></td><td>${esc(f.cargo)}</td><td>${esc(f.telefone)}</td><td>${esc(dataBR(f.admissao))}</td><td>${seloSituacao(f.situacao)}</td></tr>`).join('') + '</tbody></table>';
    }

    // ---------- formulário ----------
    const ID = c => 'f-' + c;
    const todosOsCampos = () => [...CAMPOS, ...DINHEIRO.map(([k]) => k)];
    function travarForm() {
      const ok = pode('funcionarios.editar');
      doc.querySelectorAll('#form input, #form select').forEach(el => { el.disabled = !ok; });
      $('btn-cep').disabled = !ok;
      $('btn-salvar').hidden = !ok;
    }
    function ajustarDemissao() { $('w-demissao').hidden = $(ID('situacao')).value !== 'Demitido'; }
    function mostrarForm(f) {
      estado.atual = f;
      $('vazio-painel').hidden = true; $('form').hidden = false;
      $('titulo-form').textContent = f ? f.nome : 'Novo funcionário';
      for (const c of todosOsCampos()) {
        const el = $(ID(c));
        if (!el) continue;
        el.value = f ? (f[c] ?? '') : (c === 'situacao' ? 'Ativo' : '');
      }
      $(ID('insalubridade')).checked = !!(f && f.insalubridade);
      $('erro-form').textContent = '';
      ajustarDemissao();
      travarForm();
      desenharLista();
    }
    async function abrir(codigo) {
      try { const d = await chamar('/funcionarios/' + encodeURIComponent(codigo)); mostrarForm(d.funcionario); }
      catch (err) { toast(err.message, 'erro'); }
    }
    function lerForm() {
      const f = {};
      for (const c of todosOsCampos()) { const el = $(ID(c)); if (el) f[c] = el.value; }
      f.insalubridade = $(ID('insalubridade')).checked;
      return f;
    }

    async function salvar(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const f = lerForm(), cv = comValores();
      const erros = validarForm(f, { comValores: cv });
      $('erro-form').textContent = erros.join(' ');
      if (erros.length) return;
      estado.ocupado = true; $('btn-salvar').disabled = true;
      try {
        const r = await chamar('/funcionarios/salvar', { metodo: 'POST', corpo: corpoSalvar(f, estado.atual ? estado.atual.codigo : null, { comValores: cv }) });
        toast(r.criado ? 'Funcionário cadastrado.' : 'Funcionário atualizado.', 'ok');
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
      } catch (err) { toast(err.message, 'erro'); }
      finally { botao.disabled = !pode('funcionarios.editar'); }
    }
    async function carregarCargos() {
      try {
        const d = await chamar('/funcionarios/cargos');
        $('lista-cargos').innerHTML = (d.cargos || []).map(c => `<option value="${esc(c)}">`).join('');
      } catch { /* sem a lista, o cargo continua digitável */ }
    }

    // ---------- eventos ----------
    $('lista').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-id]'); if (tr) abrir(tr.getAttribute('data-id')); });
    $('busca').addEventListener('input', ev => {
      estado.busca = ev.target.value.trim();
      win.clearTimeout(estado.temporizador);
      estado.temporizador = win.setTimeout(carregar, 250);
    });
    $('filtro-situacao').addEventListener('change', ev => { estado.situacao = ev.target.value; carregar(); });
    $('btn-novo').addEventListener('click', () => mostrarForm(null));
    $('form').addEventListener('submit', salvar);
    $('btn-cep').addEventListener('click', buscarCep);
    $(ID('cep')).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); buscarCep(); } });
    $(ID('situacao')).addEventListener('change', ajustarDemissao);
    $('btn-cancelar').addEventListener('click', () => { estado.atual = null; $('form').hidden = true; $('vazio-painel').hidden = false; desenharLista(); });
    carregarCargos();
    carregar();
  }

  return { SITUACOES, CAMPOS, DINHEIRO, validarForm, corpoSalvar, iniciar };
});
