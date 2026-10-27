// ==========================================================================
// tintas.html — cadastro de tintas (tabela do VB tintas).
// Rotas: GET /tintas, GET /tintas/:codigo, POST /tintas/salvar, DELETE /tintas/:codigo.
// Funções puras testadas no Node (test/tintas_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou value/textContent. O valor (dinheiro) só existe para quem tem valores.ver.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Tintas = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt } = C;

  const CAMPOS = ['fabricante', 'classe', 'tipo', 'conjunto', 'valor', 'porcentagem', 'refFabricante', 'corElegance', 'cor', 'rendimento'];
  const numero = v => /^\d+([.,]\d+)?$/.test(txt(v)) ? Number(txt(v).replace(',', '.')) : NaN;

  // cor do banco = ARGB de 8 dígitos (como o VB); o seletor de cor do navegador usa #rrggbb
  const corParaInput = argb => /^[0-9A-Fa-f]{8}$/.test(txt(argb)) ? '#' + txt(argb).slice(2).toLowerCase() : '#000000';
  const inputParaCor = hex => 'FF' + txt(hex).replace('#', '').toUpperCase();

  // espelha as regras do servidor (o servidor continua decidindo)
  function validarForm(f, { comValores = false } = {}) {
    const erros = [];
    if (!txt(f.fabricante)) erros.push('Escolha o fabricante.');
    if (!txt(f.classe)) erros.push('Escolha a classe.');
    if (!txt(f.tipo)) erros.push('Escolha o tipo.');
    if (!txt(f.conjunto)) erros.push('Escolha o conjunto.');
    if (comValores && Number.isNaN(numero(f.valor))) erros.push('Informe o valor (números, com vírgula ou ponto).');
    const p = numero(f.porcentagem);
    if (Number.isNaN(p) || p > 100) erros.push('% da mistura deve ser de 0 a 100.');
    if (txt(f.rendimento) && Number.isNaN(numero(f.rendimento))) erros.push('Rendimento inválido.');
    return erros;
  }
  function corpoSalvar(f, codigo, { comValores = false } = {}) {
    const b = {};
    for (const c of CAMPOS) if (c !== 'valor' || comValores) b[c] = txt(f[c]);
    if (codigo) b.codigo = codigo;
    return b;
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { lista: [], classe: '', busca: '', atual: null, ocupado: false, temporizador: null, listas: false };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const podeEditar = () => !!(win.Acesso && win.Acesso.pode('tintas.editar'));
    const comValores = () => !!(win.Acesso && win.Acesso.pode('valores.ver'));
    const ID = c => 't-' + c;

    function preencherListas(d) {
      if (estado.listas) return;
      estado.listas = true;
      const opcoes = (el, itens) => { el.innerHTML = '<option value=""></option>' + itens.map(i => `<option>${esc(i)}</option>`).join(''); };
      opcoes($(ID('fabricante')), d.fabricantes || []);
      opcoes($(ID('classe')), d.classes || []);
      opcoes($(ID('tipo')), d.tipos || []);
      opcoes($(ID('conjunto')), d.conjuntos || []);
      $('filtro-classe').innerHTML = '<option value="">Todas as classes</option>' + (d.classes || []).map(i => `<option>${esc(i)}</option>`).join('');
    }
    async function carregar() {
      const q = new win.URLSearchParams();
      if (estado.classe) q.set('classe', estado.classe);
      if (estado.busca) q.set('busca', estado.busca);
      try {
        const d = await chamar('/tintas' + (q.toString() ? '?' + q : ''));
        preencherListas(d);
        estado.lista = Array.isArray(d.tintas) ? d.tintas : [];
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; }
      desenharLista();
    }
    function desenharLista() {
      const alvo = $('lista');
      $('qtd').textContent = estado.lista.length ? `${estado.lista.length} registro(s)` : '';
      if (!estado.lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma tinta encontrada.</p>'; return; }
      const mostrarValor = comValores();
      alvo.innerHTML = '<table><thead><tr><th></th><th>Referência</th><th>Cor Elegance</th><th>Classe</th><th>Fabricante</th>' + (mostrarValor ? '<th>Valor</th>' : '') + '</tr></thead><tbody>' +
        estado.lista.map(t => `<tr data-id="${esc(t.codigo)}"${estado.atual && estado.atual.codigo === t.codigo ? ' class="selecionado"' : ''}>` +
          `<td><span class="bola" style="background:${corParaInput(t.cor)}"></span></td><td><b>${esc(t.refFabricante)}</b></td><td>${esc(t.corElegance)}</td>` +
          `<td>${esc(t.classe)}</td><td>${esc(t.fabricante)}</td>` +
          (mostrarValor ? `<td>${esc(Number(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))}</td>` : '') + '</tr>').join('') + '</tbody></table>';
    }

    // ---------- formulário ----------
    function travarForm() {
      const ok = podeEditar();
      doc.querySelectorAll('#form input, #form select').forEach(el => { el.disabled = !ok; });
      $('btn-excluir').hidden = !ok || !estado.atual;
    }
    function mostrarForm(t) {
      estado.atual = t;
      $('vazio-painel').hidden = true; $('form').hidden = false;
      $('titulo-form').textContent = t ? (t.refFabricante || 'Tinta ' + t.codigo) : 'Nova tinta';
      for (const c of CAMPOS) {
        if (c === 'cor') $(ID('cor')).value = corParaInput(t ? t.cor : '');
        else $(ID(c)).value = t ? (t[c] ?? '') : (c === 'porcentagem' || c === 'rendimento' ? '0' : '');
      }
      $('erro-form').textContent = '';
      travarForm();
      desenharLista();
    }
    async function abrir(codigo) {
      try { const d = await chamar('/tintas/' + encodeURIComponent(codigo)); mostrarForm(d.tinta); }
      catch (err) { toast(err.message, 'erro'); }
    }
    const lerForm = () => {
      const f = Object.fromEntries(CAMPOS.map(c => [c, $(ID(c)).value]));
      f.cor = inputParaCor(f.cor);
      return f;
    };

    async function salvar(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const f = lerForm();
      const opcao = { comValores: comValores() };
      const erros = validarForm(f, opcao);
      $('erro-form').textContent = erros.join(' ');
      if (erros.length) return;
      estado.ocupado = true; $('btn-salvar').disabled = true;
      try {
        const r = await chamar('/tintas/salvar', { metodo: 'POST', corpo: corpoSalvar(f, estado.atual ? estado.atual.codigo : null, opcao) });
        toast(r.criado ? 'Tinta cadastrada.' : 'Tinta atualizada.', 'ok');
        await carregar();
        await abrir(r.codigo);
      } catch (err) { $('erro-form').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-salvar').disabled = false; }
    }
    async function excluir() {
      if (!estado.atual || estado.ocupado) return;
      if (!win.confirm(`Tem certeza que deseja excluir a tinta "${estado.atual.refFabricante}"?`)) return;
      estado.ocupado = true;
      try {
        await chamar('/tintas/' + encodeURIComponent(estado.atual.codigo), { metodo: 'DELETE' });
        toast('Tinta excluída.', 'ok');
        estado.atual = null; $('form').hidden = true; $('vazio-painel').hidden = false;
        await carregar();
      } catch (err) { $('erro-form').textContent = err.message; }
      finally { estado.ocupado = false; }
    }

    // ---------- eventos ----------
    $('lista').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-id]'); if (tr) abrir(tr.getAttribute('data-id')); });
    $('busca').addEventListener('input', ev => {
      estado.busca = ev.target.value.trim();
      win.clearTimeout(estado.temporizador);
      estado.temporizador = win.setTimeout(carregar, 250);
    });
    $('filtro-classe').addEventListener('change', ev => { estado.classe = ev.target.value; carregar(); });
    $('btn-novo').addEventListener('click', () => mostrarForm(null));
    $('form').addEventListener('submit', salvar);
    $('btn-excluir').addEventListener('click', excluir);
    $('btn-cancelar').addEventListener('click', () => { estado.atual = null; $('form').hidden = true; $('vazio-painel').hidden = false; desenharLista(); });
    carregar();
  }

  return { CAMPOS, corParaInput, inputParaCor, validarForm, corpoSalvar, iniciar };
});
