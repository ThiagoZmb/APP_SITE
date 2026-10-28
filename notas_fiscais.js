// ==========================================================================
// notas_fiscais.html — notas fiscais de entrada e saída, só cabeçalho (tabela da web web_notas_fiscais).
// Rotas: GET /notas_fiscais, GET /notas_fiscais/contrapartes, GET /notas_fiscais/:id, POST /notas_fiscais,
//        PUT /notas_fiscais/:id, POST /notas_fiscais/:id/cancelar.
// Funções puras testadas no Node (test/notas_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou value/textContent. O valor (dinheiro) só existe para quem tem valores.ver.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.NotasFiscais = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt, dataValida, dataBR } = C;

  const CAMPOS = ['tipo', 'numero', 'serie', 'chave', 'dataEmissao', 'contraparteCodigo', 'valorTotal', 'observacao'];
  // "1.500" (milhar ou decimal?) é ambíguo e recusado, como no servidor
  const numero = v => /^\d+([.,]\d+)?$/.test(txt(v)) && !/^\d{1,3}(\.\d{3})+$/.test(txt(v)) ? Number(txt(v).replace(',', '.')) : NaN;
  const paraTela = n => String(n ?? '').replace('.', ',');   // o brasileiro lê e digita a vírgula
  const rotuloContraparte = tipo => tipo === 'saida' ? 'cliente' : 'fornecedor';

  // espelha as regras do servidor (o servidor continua decidindo)
  function validarForm(f, { comValores = false, editando = false } = {}) {
    const erros = [];
    if (!editando) {
      if (!txt(f.contraparteCodigo)) erros.push(`Escolha o ${rotuloContraparte(f.tipo)}.`);
      if (!/^[0-9A-Za-z]{1,20}$/.test(txt(f.numero)) || /^0+$/.test(txt(f.numero))) erros.push('Número da nota inválido (letras e números, até 20, sem espaços).');
      if (txt(f.serie).length > 5) erros.push('Série muito longa.');
      const chave = txt(f.chave).replace(/\s+/g, '');
      if (chave && !/^\d{44}$/.test(chave)) erros.push('Chave de acesso deve ter 44 dígitos.');
    }
    if (!dataValida(f.dataEmissao)) erros.push('Informe a data de emissão.');
    if (comValores && !(numero(f.valorTotal) > 0)) erros.push('Informe o valor da nota (maior que zero, com vírgula ou ponto).');
    return erros;
  }

  function corpoCriar(f, { comValores = false } = {}) {
    const b = {};
    for (const c of CAMPOS) if (c !== 'valorTotal' || comValores) b[c] = txt(f[c]);
    return b;
  }
  function corpoEditar(f, { comValores = false } = {}) {
    const b = { dataEmissao: txt(f.dataEmissao), observacao: txt(f.observacao) };
    if (comValores) b.valorTotal = txt(f.valorTotal);
    return b;
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { lista: [], tipo: 'entrada', busca: '', atual: null, ocupado: false, temporizador: null, contrapartes: {} };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const podeEditar = () => !!(win.Acesso && win.Acesso.pode('notas.editar'));
    const comValores = () => !!(win.Acesso && win.Acesso.pode('valores.ver'));
    const ID = c => 'n-' + c;

    async function carregarContrapartes(tipo) {
      if (!estado.contrapartes[tipo]) {
        try { estado.contrapartes[tipo] = (await chamar('/notas_fiscais/contrapartes?tipo=' + tipo)).contrapartes || []; }
        catch (err) { toast(err.message, 'erro'); return []; }
      }
      return estado.contrapartes[tipo];
    }
    async function preencherContrapartes(tipo, selecionado) {
      const itens = await carregarContrapartes(tipo);
      // value explícito: o nome vem do banco e não pode ser reinterpretado pelo navegador
      $(ID('contraparteCodigo')).innerHTML = '<option value=""></option>' + itens.map(i => `<option value="${esc(i.codigo)}">${esc(i.nome)}</option>`).join('');
      $(ID('contraparteCodigo')).value = selecionado ? String(selecionado) : '';
      $('rotulo-contraparte').textContent = tipo === 'saida' ? 'Cliente' : 'Fornecedor';
    }

    async function carregar() {
      const q = new win.URLSearchParams({ tipo: estado.tipo });
      if (estado.busca) q.set('q', estado.busca);
      if ($('de').value) q.set('de', $('de').value);
      if ($('ate').value) q.set('ate', $('ate').value);
      if ($('filtro-situacao').value) q.set('situacao', $('filtro-situacao').value);
      try {
        const d = await chamar('/notas_fiscais?' + q);
        estado.lista = Array.isArray(d.notas) ? d.notas : [];
        estado.limitada = !!d.limitada;
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; estado.limitada = false; }
      desenharLista();
    }
    function desenharLista() {
      const alvo = $('lista');
      $('qtd').textContent = estado.lista.length ? `${estado.lista.length} nota(s)` + (estado.limitada ? ' — mostrando as 200 mais recentes; refine a busca' : '') : '';
      if (!estado.lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma nota encontrada.</p>'; return; }
      const mostrarValor = comValores();
      alvo.innerHTML = '<table><thead><tr><th>Número</th><th>Emissão</th><th>' + (estado.tipo === 'saida' ? 'Cliente' : 'Fornecedor') + '</th>' + (mostrarValor ? '<th>Valor</th>' : '') + '<th></th></tr></thead><tbody>' +
        estado.lista.map(n => `<tr data-id="${esc(n.id)}"${estado.atual && estado.atual.id === n.id ? ' class="selecionado"' : ''}>` +
          `<td><b>${esc(n.numero)}</b>/${esc(n.serie)}</td><td>${esc(dataBR(n.dataEmissao))}</td><td>${esc(n.contraparteNome)}</td>` +
          (mostrarValor ? `<td>${esc(Number(n.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))}</td>` : '') +
          `<td>${n.situacao === 'cancelada' ? '<span class="selo perigo">Cancelada</span>' : ''}</td></tr>`).join('') + '</tbody></table>';
    }

    // ---------- formulário ----------
    function travarForm() {
      const n = estado.atual;
      const ok = podeEditar() && !(n && n.situacao === 'cancelada');
      const novo = !n;
      for (const c of CAMPOS) {
        const el = $(ID(c));
        if (el) el.disabled = !ok || (!novo && !['dataEmissao', 'valorTotal', 'observacao'].includes(c));
      }
      $('btn-salvar').hidden = !ok;
      $('btn-cancelar-nota').hidden = !ok || novo;
    }
    async function mostrarForm(n) {
      estado.atual = n;
      $('vazio-painel').hidden = true; $('form').hidden = false;
      const tipo = n ? n.tipo : estado.tipo;
      $('titulo-form').textContent = n ? `Nota ${n.numero}/${n.serie} — ${tipo === 'saida' ? 'saída' : 'entrada'}` : (tipo === 'saida' ? 'Nova nota de saída' : 'Nova nota de entrada');
      await preencherContrapartes(tipo, n ? n.contraparteCodigo : null);
      for (const c of CAMPOS) {
        if (c === 'contraparteCodigo') continue;
        const el = $(ID(c));
        if (!el) continue;
        if (c === 'valorTotal') el.value = n ? paraTela(n.valorTotal) : '';
        else if (c === 'tipo') continue;
        else el.value = n ? (n[c] ?? '') : (c === 'serie' ? '1' : '');
      }
      const aviso = $('aviso-cancelada');
      aviso.hidden = !(n && n.situacao === 'cancelada');
      aviso.textContent = n && n.situacao === 'cancelada' ? 'Nota cancelada' + (n.motivoCancelamento ? ': ' + n.motivoCancelamento : '') + '.' : '';
      $('erro-form').textContent = '';
      travarForm();
      desenharLista();
    }
    async function abrir(id) {
      try { const d = await chamar('/notas_fiscais/' + encodeURIComponent(id)); await mostrarForm(d.nota); }
      catch (err) { toast(err.message, 'erro'); }
    }
    const lerForm = () => {
      const f = Object.fromEntries(CAMPOS.filter(c => $(ID(c))).map(c => [c, $(ID(c)).value]));
      f.tipo = estado.atual ? estado.atual.tipo : estado.tipo;
      return f;
    };
    function fecharForm() { estado.atual = null; $('form').hidden = true; $('vazio-painel').hidden = false; desenharLista(); }

    async function salvar(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const f = lerForm();
      const opcao = { comValores: comValores(), editando: !!estado.atual };
      const erros = validarForm(f, opcao);
      $('erro-form').textContent = erros.join(' ');
      if (erros.length) return;
      estado.ocupado = true; $('btn-salvar').disabled = true;
      try {
        const r = estado.atual
          ? await chamar('/notas_fiscais/' + encodeURIComponent(estado.atual.id), { metodo: 'PUT', corpo: corpoEditar(f, opcao) })
          : await chamar('/notas_fiscais', { metodo: 'POST', corpo: corpoCriar(f, opcao) });
        toast(estado.atual ? 'Nota atualizada.' : 'Nota lançada.', 'ok');
        await carregar();
        await abrir(r.id);
      } catch (err) { $('erro-form').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-salvar').disabled = false; }
    }
    async function cancelarNota() {
      if (!estado.atual || estado.ocupado) return;
      const motivo = win.prompt(`Cancelar a nota ${estado.atual.numero}/${estado.atual.serie}? O cancelamento não pode ser desfeito. Informe o motivo:`);
      if (motivo === null) return;
      if (!txt(motivo)) { $('erro-form').textContent = 'Informe o motivo do cancelamento.'; return; }
      estado.ocupado = true;
      try {
        await chamar(`/notas_fiscais/${encodeURIComponent(estado.atual.id)}/cancelar`, { metodo: 'POST', corpo: { motivo: txt(motivo) } });
        toast('Nota cancelada.', 'ok');
        const id = estado.atual.id;
        await carregar();
        await abrir(id);
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
    for (const id of ['de', 'ate', 'filtro-situacao']) $(id).addEventListener('change', carregar);
    for (const aba of doc.querySelectorAll('.aba')) aba.addEventListener('click', () => {
      estado.tipo = aba.getAttribute('data-tipo');
      doc.querySelectorAll('.aba').forEach(a => a.classList.toggle('ativo', a === aba));
      fecharForm();
      carregar();
    });
    $('btn-novo').addEventListener('click', () => mostrarForm(null));
    $('form').addEventListener('submit', salvar);
    $('btn-cancelar-nota').addEventListener('click', cancelarNota);
    $('btn-fechar').addEventListener('click', fecharForm);
    carregar();
  }

  return { CAMPOS, paraTela, validarForm, corpoCriar, corpoEditar, iniciar };
});
