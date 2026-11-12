// ==========================================================================
// "Editar entrega" (entregas.html, só equipe com entregas.programar): janela com tipo, data, motorista, endereço, contato no local e
// observação de UMA entrega aberta. Não mexe em status, pedido nem itens (isso é do servidor: PUT /entregas/:id).
// Funções puras (testadas no Node) + a janela (só no navegador, visual = .dp-* do tema.css). Dado da API só entra por value/textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.EntregaEditar = lib;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';

  const TIPOS = [['motorista', 'Entrega'], ['retirada', 'Retirado pelo cliente'], ['outro_estado', 'Entrega em outro estado']];
  const CAMPOS_END = [['rua', 'Rua', 190], ['numero', 'Número', 30], ['cep', 'CEP', 12], ['bairro', 'Bairro', 120], ['cidade', 'Cidade', 120], ['uf', 'UF', 2], ['ref', 'Referência', 190]];
  const AGENDA_TRAVADA = ['em_rota', 'enviada']; // espelha calculo/entregas.js
  const txt = v => String(v ?? '').trim();
  const dataOk = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  };

  const agendaTravada = e => !!(e && AGENDA_TRAVADA.includes(e.status));
  // valores iniciais do formulário, a partir da entrega do detalhe (GET /entregas/:id)
  function formularioInicial(e) {
    const a = (e && e.endereco) || {};
    return { tipo: e.tipo || '', dataAgendada: e.dataAgendada || '', motoristaCodigo: e.motoristaCodigo ? String(e.motoristaCodigo) : '',
      rua: a.rua || '', numero: a.numero || '', cep: a.cep || '', bairro: a.bairro || '', cidade: a.cidade || '', uf: a.uf || '', ref: a.ref || '',
      contatoLocal: e.contatoLocal || '', observacao: e.observacao || '' };
  }
  function validarFormulario(f, e) {
    const erros = [];
    if (!agendaTravada(e)) {
      if (f.tipo && !TIPOS.some(([v]) => v === f.tipo)) erros.push('Tipo de entrega inválido.');
      if (txt(f.dataAgendada) && !dataOk(txt(f.dataAgendada))) erros.push('Informe uma data válida (AAAA-MM-DD).');
      if (!txt(f.dataAgendada) && e.status !== 'a_programar') erros.push('A entrega já está programada: informe a data.');
      if (f.tipo === 'motorista' && !txt(f.motoristaCodigo)) erros.push('Escolha o motorista.');
    }
    if (txt(f.uf) && !/^[A-Za-z]{2}$/.test(txt(f.uf))) erros.push('UF deve ter 2 letras.');
    if (txt(f.observacao).length > 500) erros.push('A observação passa de 500 caracteres.');
    if (txt(f.contatoLocal).length > 190) erros.push('O contato no local passa de 190 caracteres.');
    return erros;
  }
  // Corpo do PUT só com o que mudou em relação à entrega aberta (nada mudou = null). O endereço vai inteiro quando qualquer parte muda.
  function corpoEdicao(f, e) {
    const ini = formularioInicial(e), b = {};
    if (!agendaTravada(e)) {
      if (f.tipo && f.tipo !== ini.tipo) b.tipo = f.tipo;
      if (txt(f.dataAgendada) !== ini.dataAgendada) b.dataAgendada = txt(f.dataAgendada) || null;
      const tipoFinal = f.tipo || ini.tipo;
      if (tipoFinal === 'motorista' && (b.tipo || txt(f.motoristaCodigo) !== ini.motoristaCodigo)) b.motoristaCodigo = Number(f.motoristaCodigo);
    }
    if (CAMPOS_END.some(([c]) => (c === 'uf' ? txt(f[c]).toUpperCase() : txt(f[c])) !== (c === 'uf' ? ini[c].toUpperCase() : txt(ini[c])))) {
      b.endereco = Object.fromEntries(CAMPOS_END.map(([c]) => [c, c === 'uf' ? txt(f[c]).toUpperCase() : txt(f[c])]));
    }
    if (txt(f.contatoLocal) !== txt(ini.contatoLocal)) b.contatoLocal = txt(f.contatoLocal) || null;
    if (txt(f.observacao) !== txt(ini.observacao)) b.observacao = txt(f.observacao) || null;
    return Object.keys(b).length ? b : null;
  }

  // ---- janela ----
  // abrir(win, { entrega, motoristas, salvar: async corpo => void, origem }) ; `salvar` lança Error com a mensagem do servidor
  function abrir(win, cfg) {
    const doc = win.document, e = cfg.entrega, anterior = doc.activeElement;
    const mk = (tag, cls, texto) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (texto !== undefined) el.textContent = texto; return el; };
    const travada = agendaTravada(e);
    const grupo = (id, rotulo, controle) => { const g = mk('div', 'form-group'); const l = mk('label', '', rotulo); l.htmlFor = id; controle.id = id; g.append(l, controle); return g; };
    const campo = (id, rotulo, max, extra) => { const i = mk('input'); i.maxLength = max; if (extra) Object.assign(i, extra); return grupo(id, rotulo, i); };

    const fundo = mk('div', 'dp-fundo'), caixa = mk('form', 'dp-caixa ee-caixa');
    caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', `Editar entrega do pedido ${e.numero}`); caixa.noValidate = true;
    const ini = formularioInicial(e);

    const sel = mk('select'); sel.append(new win.Option('Escolha…', ''), ...TIPOS.map(([v, r]) => new win.Option(r, v)));
    const gTipo = grupo('ee-tipo', 'Tipo', sel);
    const data = mk('input'); data.type = 'date'; const gData = grupo('ee-data', 'Data', data);
    const mot = mk('select'); mot.append(new win.Option('Escolha…', ''), ...(cfg.motoristas || []).map(m => new win.Option(m.nome, String(m.codigo))));
    if (ini.motoristaCodigo && ![...mot.options].some(o => o.value === ini.motoristaCodigo)) mot.append(new win.Option(cfg.motoristaNome || '#' + ini.motoristaCodigo, ini.motoristaCodigo));
    const gMot = grupo('ee-motorista', 'Motorista', mot);
    const fs = mk('fieldset', 'ee-end'); fs.append(mk('legend', '', 'Endereço de entrega'));
    const campos = {};
    const grade = mk('div', 'ee-grade');
    for (const [c, r, max] of CAMPOS_END) { const g = campo('ee-' + c, r, max, c === 'cep' ? { inputMode: 'numeric', autocomplete: 'off' } : null); campos[c] = g.querySelector('input'); g.classList.add('ee-' + c); grade.append(g); }
    fs.append(grade);
    const contato = campo('ee-contato', 'Contato no local', 190);
    const obsC = mk('textarea'); obsC.maxLength = 500; const gObs = grupo('ee-obs', 'Observação', obsC);
    const aviso = mk('p', 'ee-aviso', travada ? 'Com a entrega em rota ou enviada, tipo, data e motorista não mudam aqui (use Reagendar). O restante pode ser corrigido.' : '');
    aviso.hidden = !travada;
    const erro = mk('p', 'erro-form'); erro.setAttribute('role', 'alert');
    const acoes = mk('div', 'dp-acoes');
    const bCancelar = mk('button', 'dp-btn', 'Cancelar'); bCancelar.type = 'button';
    const bSalvar = mk('button', 'dp-btn dp-btn-ok', 'Salvar alterações'); bSalvar.type = 'submit';
    acoes.append(bCancelar, bSalvar);
    const sub = [e.cliente, e.rotuloSequencia].filter(Boolean).join(' · ');
    caixa.append(mk('div', 'dp-titulo', `Editar entrega — pedido ${e.numero}`), mk('div', 'dp-sub', sub || 'Só esta entrega: pedido, itens e situação não mudam.'), aviso);
    if (!travada) caixa.append(gTipo, gData, gMot);
    caixa.append(fs, contato, gObs, erro, acoes);
    fundo.append(caixa);

    sel.value = ini.tipo; data.value = ini.dataAgendada; mot.value = ini.motoristaCodigo;
    for (const [c] of CAMPOS_END) campos[c].value = ini[c];
    contato.querySelector('input').value = ini.contatoLocal; obsC.value = ini.observacao;
    const ajustar = () => { gMot.hidden = sel.value !== 'motorista'; };
    sel.addEventListener('change', ajustar); ajustar();

    const ler = () => ({ tipo: sel.value, dataAgendada: data.value, motoristaCodigo: mot.value, ...Object.fromEntries(CAMPOS_END.map(([c]) => [c, campos[c].value])),
      contatoLocal: contato.querySelector('input').value, observacao: obsC.value });
    const fechar = () => { doc.removeEventListener('keydown', teclas, true); fundo.remove(); if (anterior && anterior.isConnected) anterior.focus?.({ preventScroll: true }); };
    let ocupado = false;
    async function enviar() {
      if (ocupado) return;
      const f = ler(), erros = validarFormulario(f, e);
      if (erros.length) { erro.textContent = erros.join(' '); return; }
      const corpo = corpoEdicao(f, e);
      if (!corpo) { erro.textContent = 'Nenhuma alteração para gravar.'; return; }
      ocupado = true; bSalvar.disabled = true; erro.textContent = '';
      try { await cfg.salvar(corpo); fechar(); } catch (err) { erro.textContent = err.message || 'Não foi possível salvar.'; ocupado = false; bSalvar.disabled = false; }
    }
    function teclas(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (!ocupado) fechar(); return; }
      if (ev.key !== 'Tab') return;
      const itens = [...caixa.querySelectorAll('input, select, textarea, button')].filter(x => !x.disabled && !x.closest('[hidden]'));
      if (!itens.length) return;
      const i = itens.indexOf(doc.activeElement), prox = ev.shiftKey ? i - 1 : i + 1;
      if (i === -1 || prox < 0 || prox >= itens.length) { ev.preventDefault(); itens[prox < 0 || i === -1 ? itens.length - 1 : 0].focus(); }
    }
    caixa.addEventListener('submit', ev => { ev.preventDefault(); enviar(); });
    bCancelar.addEventListener('click', () => { if (!ocupado) fechar(); });
    fundo.addEventListener('mousedown', ev => { if (ev.target === fundo && !ocupado) fechar(); });
    doc.addEventListener('keydown', teclas, true);
    doc.body.append(fundo);
    (travada ? campos.rua : sel).focus();
    return { fechar };
  }

  return { TIPOS, CAMPOS_END, agendaTravada, formularioInicial, validarFormulario, corpoEdicao, abrir };
});
