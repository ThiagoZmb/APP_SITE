// ==========================================================================
// entregas.html — tela da EQUIPE do módulo Entregas (fila, agenda, em rota, concluídas, ocorrências).
// Rotas: GET /entregas, GET /entregas/motoristas, GET /entregas/:id, POST /entregas/:id/{agendar,reagendar,cancelar,retirada,enviada,comprovante},
// PUT /entregas/:id/anexo?tipo=foto (binário), GET /entregas/:id/anexo/:anexoId (binário, com Authorization -> blob URL).
// Aqui ficam as funções puras (testadas no Node, test/entregas_tela.test.js) e, no fim, o desenho da tela (só no navegador).
// Dado vindo da API só entra na tela por esc() ou textContent. Nenhum valor em dinheiro passa por aqui.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Entregas = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  // helpers compartilhados com a tela do motorista (entregas_comum.js, carregado antes no navegador)
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt, dataValida, dataBR, dataHoraBR, escalaImagem } = C;

  // ============ LÓGICA PURA ============
  const ROTULO_STATUS = { a_programar: 'A programar', agendada: 'Agendada', em_rota: 'Em rota', ocorrencia: 'Ocorrência', entregue: 'Entregue',
    retirado: 'Retirado', enviada: 'Enviada', cancelada: 'Cancelada' };
  const COR_STATUS = { a_programar: 'aviso', agendada: 'info', em_rota: 'info', ocorrencia: 'perigo', entregue: 'ok', retirado: 'ok', enviada: 'info', cancelada: 'neutro' };
  const ROTULO_TIPO = { motorista: 'Motorista', retirada: 'Retirada', outro_estado: 'Outro estado' };
  const ROTULO_EVENTO = { criada: 'Entrou na fila', agendada: 'Agendada', reagendada: 'Reagendada', saiu: 'Saiu para a entrega', entregue: 'Entregue',
    retirada: 'Retirada pelo cliente', enviada: 'Enviada', comprovante: 'Comprovante confirmado', cancelada: 'Cancelada', endereco: 'Endereço alterado',
    ausente: 'Ocorrência: cliente ausente', endereco_errado: 'Ocorrência: endereço errado', recusa: 'Ocorrência: recusa', parcial: 'Ocorrência: entrega parcial' };
  const ABAS = [
    { id: 'fila', rotulo: 'Fila', status: ['a_programar'] },
    { id: 'agenda', rotulo: 'Agenda', status: ['agendada'] },
    { id: 'em_rota', rotulo: 'Em rota', status: ['em_rota', 'enviada'] }, // enviada (outro estado) fica aqui: é onde se anexa o comprovante,
    { id: 'concluidas', rotulo: 'Concluídas', status: ['entregue', 'retirado', 'cancelada'] },
    { id: 'ocorrencias', rotulo: 'Ocorrências', status: ['ocorrencia'] }
  ];

  const rotuloStatus = s => ROTULO_STATUS[s] || String(s ?? '');
  const corStatus = s => COR_STATUS[s] || 'neutro';
  const rotuloTipo = t => ROTULO_TIPO[t] || '—';
  const rotuloEvento = t => ROTULO_EVENTO[t] || String(t ?? '');

  function filtrarAba(lista, aba) {
    const def = ABAS.find(a => a.id === aba);
    if (!def || !Array.isArray(lista)) return [];
    const r = lista.filter(e => def.status.includes(e.status));
    if (aba === 'agenda') r.sort((a, b) => String(a.dataAgendada || '').localeCompare(String(b.dataAgendada || '')) || a.numero - b.numero);
    return r;
  }
  const contadores = lista => ({
    fila: filtrarAba(lista, 'fila').length,
    ocorrencias: filtrarAba(lista, 'ocorrencias').length
  });

  // Agenda: [{ dia, grupos: [{ nome, entregas }] }] — dias em ordem, grupos por motorista (ou pelo tipo, se não houver motorista)
  function agruparAgenda(lista) {
    const dias = new Map();
    for (const e of filtrarAba(lista, 'agenda')) {
      const dia = e.dataAgendada || '';
      const nome = e.motorista || rotuloTipo(e.tipo);
      if (!dias.has(dia)) dias.set(dia, new Map());
      const grupos = dias.get(dia);
      if (!grupos.has(nome)) grupos.set(nome, []);
      grupos.get(nome).push(e);
    }
    return [...dias.keys()].sort().map(dia => ({
      dia,
      grupos: [...dias.get(dia).entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([nome, entregas]) => ({ nome, entregas }))
    }));
  }

  // Agenda em calendário: semanas (domingo a sábado) que cobrem o mês `mes` (0-11) de `ano`. Cada célula: { dia: 'AAAA-MM-DD', num, doMes, hoje, entregas }.
  // Entra toda entrega com data agendada, menos as canceladas; a ordem do dia é pelo número do pedido.
  const dois = n => String(n).padStart(2, '0');
  const isoUTC = d => `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
  function montarMes(lista, ano, mes, hojeISO) {
    const porDia = new Map();
    for (const e of Array.isArray(lista) ? lista : []) {
      const dia = e.dataAgendada ? String(e.dataAgendada).slice(0, 10) : '';
      if (!dia || e.status === 'cancelada') continue;
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(e);
    }
    const primeiro = new Date(Date.UTC(ano, mes, 1));
    const inicio = new Date(Date.UTC(ano, mes, 1 - primeiro.getUTCDay()));
    const ultimo = new Date(Date.UTC(ano, mes + 1, 0));
    const semanas = [];
    for (let d = new Date(inicio); d <= ultimo || d.getUTCDay() !== 0; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 0) semanas.push([]);
      const dia = isoUTC(d);
      semanas[semanas.length - 1].push({
        dia, num: d.getUTCDate(), doMes: d.getUTCMonth() === mes, hoje: dia === hojeISO,
        entregas: (porDia.get(dia) || []).slice().sort((a, b) => a.numero - b.numero)
      });
    }
    return semanas;
  }
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  // Ações que o servidor aceita para cada estado (espelha calculo/entregas.js; o servidor continua decidindo)
  function acoesDisponiveis(e) {
    if (!e) return [];
    const r = [];
    if (e.status === 'a_programar') r.push('agendar');
    if (['ocorrencia', 'agendada', 'em_rota'].includes(e.status)) r.push('reagendar');
    if (e.status === 'agendada' && e.tipo === 'retirada') r.push('retirada');
    if (e.status === 'agendada' && e.tipo === 'outro_estado') r.push('enviada');
    if (e.status === 'enviada' && e.tipo === 'outro_estado') r.push('comprovante');
    if (['a_programar', 'agendada', 'ocorrencia', 'em_rota'].includes(e.status)) r.push('cancelar');
    return r;
  }

  const CAMPOS_ENDERECO = ['rua', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'ref'];
  const enderecoPreenchido = f => CAMPOS_ENDERECO.some(c => txt(f[c]));

  function validarAgendamento(f) {
    const erros = [];
    if (!Object.keys(ROTULO_TIPO).includes(f.tipo)) erros.push('Escolha o tipo da entrega.');
    if (!dataValida(f.dataAgendada)) erros.push('Informe uma data válida (AAAA-MM-DD).');
    if (f.tipo === 'motorista' && !txt(f.motoristaCodigo)) erros.push('Escolha o motorista.');
    if (f.tipo !== 'retirada' && enderecoPreenchido(f) && !/^[A-Za-z]{2}$/.test(txt(f.uf))) erros.push('UF deve ter 2 letras.');
    if (f.tipo === 'outro_estado' && txt(f.previsao) && !dataValida(txt(f.previsao))) erros.push('Previsão inválida (AAAA-MM-DD).');
    return erros;
  }

  function corpoAgendar(f) {
    const b = { tipo: f.tipo, dataAgendada: txt(f.dataAgendada) };
    if (f.tipo === 'motorista') b.motoristaCodigo = Number(f.motoristaCodigo);
    if (f.tipo !== 'retirada' && enderecoPreenchido(f)) {
      b.endereco = {};
      for (const c of CAMPOS_ENDERECO) b.endereco[c] = c === 'uf' ? txt(f[c]).toUpperCase() : txt(f[c]);
    }
    if (txt(f.contatoLocal)) b.contatoLocal = txt(f.contatoLocal);
    if (txt(f.observacao)) b.observacao = txt(f.observacao);
    if (f.tipo === 'outro_estado') {
      if (txt(f.transportadora)) b.transportadora = txt(f.transportadora);
      if (txt(f.rastreio)) b.rastreio = txt(f.rastreio);
      if (txt(f.previsao)) b.previsao = txt(f.previsao);
    }
    return b;
  }
  const corpoReagendar = corpoAgendar;

  // "Usar endereço do cliente": só devolve os campos do formulário (nada é gravado)
  const enderecoDoCliente = c => {
    const o = {};
    for (const k of ['rua', 'numero', 'bairro', 'cidade', 'uf', 'cep']) o[k] = txt(c?.[k]);
    return o;
  };

  const validarRetirada = f => (txt(f.entregueA) ? null : 'Informe quem retirou.');
  const validarEnviada = f => (txt(f.transportadora) ? null : 'Informe a transportadora.');
  const validarComprovante = f => (f.temFoto ? null : 'Anexe a foto do comprovante.');
  const validarCancelamento = m => (txt(m).length >= 3 ? null : 'Informe o motivo (mínimo 3 caracteres).');

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { lista: [], aba: 'fila', busca: '', det: null, motoristas: null, urls: [], anexoEnviado: null, reagendando: false, carregando: false, mes: null, diaAberto: null };

    const { getAuth, chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);

    // desabilita os botões do painel durante a chamada (evita envio duplo)
    async function ocupado(fn) {
      if (estado.carregando) return;
      estado.carregando = true;
      const botoes = [...doc.querySelectorAll('#painel button, #painel input, #painel select, #painel textarea')];
      const antes = botoes.map(b => b.disabled);
      botoes.forEach(b => { b.disabled = true; });
      try { return await fn(); } catch (err) { toast(err.message, 'erro'); } finally {
        estado.carregando = false;
        botoes.forEach((b, i) => { b.disabled = antes[i]; });
      }
    }

    // ---------- lista ----------
    async function carregar() {
      try {
        const d = await chamar('/entregas');
        estado.lista = Array.isArray(d.entregas) ? d.entregas : [];
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; }
      desenharLista();
    }

    const casa = e => {
      const b = estado.busca.toLowerCase();
      return !b || String(e.numero).includes(b) || String(e.cliente || '').toLowerCase().includes(b);
    };
    const local = e => [e.cidade, e.uf].filter(Boolean).join('/');
    const selo = s => `<span class="selo ${corStatus(s)}">${esc(rotuloStatus(s))}</span>`;
    const botaoAcao = (acao, rotulo) => `<button type="button" class="btn btn-mini btn-secondary" data-acao="${acao}" data-perm="entregas.programar">${rotulo}</button>`;

    function desenharAbas() {
      const c = contadores(estado.lista);
      doc.querySelectorAll('[data-aba]').forEach(b => {
        const id = b.getAttribute('data-aba');
        b.classList.toggle('ativo', id === estado.aba);
        b.setAttribute('aria-selected', id === estado.aba ? 'true' : 'false');
        const n = b.querySelector('.contagem');
        if (n) { n.textContent = c[id] ?? ''; n.hidden = !(c[id] > 0); }
      });
    }

    function linha(e, aba) {
      const tdBase = `<td>${esc(e.numero)}</td><td>${esc(e.cliente)}</td><td>${esc(local(e))}</td>`;
      let resto;
      if (aba === 'fila') resto = `<td>${esc(dataBR(e.dataPrometida))}</td><td>${selo(e.status)}</td><td>${botaoAcao('agendar', 'Agendar')}</td>`;
      else if (aba === 'ocorrencias') resto = `<td>${esc(dataBR(e.dataAgendada))}</td><td>${esc(e.motorista || rotuloTipo(e.tipo))}</td><td>${esc(e.qtdOcorrencias)}</td><td>${botaoAcao('reagendar', 'Reagendar')}</td>`;
      else resto = `<td>${esc(dataBR(e.dataAgendada))}</td><td>${esc(e.motorista || rotuloTipo(e.tipo))}</td><td>${selo(e.status)}</td>` +
        (aba === 'em_rota' ? `<td>${e.status === 'em_rota' ? botaoAcao('reagendar', 'Reagendar') : ''}</td>` : ''); // só em_rota: a equipe destrava; enviada segue o fluxo próprio
      return `<tr data-id="${esc(e.id)}"${estado.det && estado.det.entrega.id === e.id ? ' class="selecionado"' : ''}>${tdBase}${resto}</tr>`;
    }
    const CABECALHO = {
      fila: ['Pedido', 'Cliente', 'Cidade/UF', 'Prometido', 'Status', ''],
      ocorrencias: ['Pedido', 'Cliente', 'Cidade/UF', 'Agendada', 'Motorista/Tipo', 'Ocorr.', ''],
      outras: ['Pedido', 'Cliente', 'Cidade/UF', 'Data', 'Motorista/Tipo', 'Status'],
      em_rota: ['Pedido', 'Cliente', 'Cidade/UF', 'Data', 'Motorista/Tipo', 'Status', '']
    };

    // Agenda em calendário mensal: cada entrega é uma etiqueta colorida pelo status; clicar abre o detalhe
    const MAX_ETIQUETAS = 3;
    function hojeISO() {
      const d = new win.Date();
      return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
    }
    function desenharCalendario() {
      if (!estado.mes) { const h = new win.Date(); estado.mes = { ano: h.getFullYear(), mes: h.getMonth() }; }
      const { ano, mes } = estado.mes;
      const semanas = montarMes(estado.lista.filter(casa), ano, mes, hojeISO());
      const etiqueta = e => `<button type="button" class="etiqueta ${corStatus(e.status)}" data-id="${esc(e.id)}" title="${esc(`${e.numero} — ${e.cliente || ''} (${rotuloStatus(e.status)})`)}">` +
        `<strong>${esc(e.numero)}</strong> ${esc(e.cliente || '')}</button>`;
      const celula = c => {
        const aberto = estado.diaAberto === c.dia;
        const vistas = aberto ? c.entregas : c.entregas.slice(0, MAX_ETIQUETAS);
        const mais = c.entregas.length - vistas.length;
        return `<div class="cel${c.doMes ? '' : ' fora'}${c.hoje ? ' hoje' : ''}"><span class="num">${c.num}</span>` +
          vistas.map(etiqueta).join('') +
          (mais > 0 ? `<button type="button" class="mais" data-dia="${esc(c.dia)}">+${mais} mais</button>` : '') +
          (aberto && c.entregas.length > MAX_ETIQUETAS ? '<button type="button" class="mais" data-dia="">recolher</button>' : '') + '</div>';
      };
      const total = semanas.flat().reduce((n, c) => n + (c.doMes ? c.entregas.length : 0), 0);
      $('lista').innerHTML = '<div class="cal-topo"><button type="button" class="btn btn-mini btn-secondary" data-mes="-1" aria-label="Mês anterior">‹</button>' +
        '<button type="button" class="btn btn-mini btn-secondary" data-mes="0">Hoje</button>' +
        '<button type="button" class="btn btn-mini btn-secondary" data-mes="1" aria-label="Próximo mês">›</button>' +
        `<h3>${MESES[mes]} de ${ano}</h3><span class="cinza">${total} entrega(s) no mês</span></div>` +
        `<div class="cal"><div class="cal-sem">${DIAS_SEMANA.map(d => `<span>${d}</span>`).join('')}</div>` +
        semanas.map(sem => `<div class="cal-linha">${sem.map(celula).join('')}</div>`).join('') + '</div>';
    }

    function desenharLista() {
      desenharAbas();
      if (estado.aba === 'agenda') { desenharCalendario(); return; }
      const itens = filtrarAba(estado.lista, estado.aba).filter(casa);
      const alvo = $('lista');
      if (!itens.length) { alvo.innerHTML = '<p class="vazio">Nada por aqui.</p>'; return; }
      const cab = CABECALHO[estado.aba] || CABECALHO.outras;
      alvo.innerHTML = `<table><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${itens.map(e => linha(e, estado.aba)).join('')}</tbody></table>`;
    }

    // ---------- painel ----------
    const VISTAS = ['vazio-painel', 'vista-detalhe', 'vista-agendar', 'vista-cancelar', 'vista-retirada', 'vista-enviada', 'vista-comprovante'];
    function mostrar(nome) { VISTAS.forEach(v => { $(v).hidden = v !== nome; }); }
    function limparUrls() { estado.urls.forEach(u => URL.revokeObjectURL(u)); estado.urls = []; }

    async function abrirDetalhe(id) {
      limparUrls();
      estado.anexoEnviado = null;
      const d = await chamar(`/entregas/${encodeURIComponent(id)}`);
      estado.det = d;
      desenharDetalhe();
      desenharLista();
    }

    function linhaInfo(rot, val) { return val ? `<dt>${esc(rot)}</dt><dd>${esc(val)}</dd>` : ''; }
    function enderecoTexto(e) {
      const a = e.endereco || {};
      const l1 = [a.rua, a.numero].filter(Boolean).join(', ');
      return [l1, a.bairro, [a.cidade, a.uf].filter(Boolean).join('/'), a.cep, a.ref].filter(Boolean).join(' · ');
    }

    function textoEvento(v) {
      const partes = [];
      if (v.motivo) partes.push(v.motivo);
      if (v.entregueA) partes.push('Recebido por ' + v.entregueA);
      const itens = v.detalhe && Array.isArray(v.detalhe.itensEntregues) ? v.detalhe.itensEntregues : [];
      if (itens.length) partes.push('Entregue: ' + itens.map(i => `${i.descricao} × ${i.qtd}`).join('; '));
      if (v.detalhe && v.detalhe.transportadora) partes.push('Transportadora: ' + v.detalhe.transportadora + (v.detalhe.rastreio ? ' (rastreio ' + v.detalhe.rastreio + ')' : ''));
      return partes.join(' — ');
    }

    function desenharDetalhe() {
      const { entrega: e, eventos, itens, anexos } = estado.det;
      mostrar('vista-detalhe');
      $('d-titulo').textContent = `Pedido ${e.numero}`;
      $('d-status').innerHTML = selo(e.status);
      $('d-info').innerHTML = linhaInfo('Cliente', e.cliente) + linhaInfo('Tipo', e.tipo ? rotuloTipo(e.tipo) : '') +
        linhaInfo('Prometido', dataBR(e.dataPrometida)) + linhaInfo('Agendada', dataBR(e.dataAgendada)) +
        linhaInfo('Motorista', (estado.motoristas || []).find(m => m.codigo === e.motoristaCodigo)?.nome || (e.motoristaCodigo ? '#' + e.motoristaCodigo : '')) +
        linhaInfo('Endereço', enderecoTexto(e)) + linhaInfo('Contato no local', e.contatoLocal) + linhaInfo('Transportadora', e.transportadora) +
        linhaInfo('Rastreio', e.rastreio) + linhaInfo('Previsão', dataBR(e.previsao)) + linhaInfo('Observação', e.observacao);
      const acoes = acoesDisponiveis(e);
      ['agendar', 'reagendar', 'cancelar', 'retirada', 'enviada', 'comprovante'].forEach(a => { $('btn-' + a).hidden = !acoes.includes(a); });
      $('d-itens').innerHTML = itens.length ? itens.map(i => `<li>${esc(i.descricao)} <span class="cinza">× ${esc(i.qtd)}</span></li>`).join('') : '<li class="cinza">Sem itens.</li>';
      $('d-eventos').innerHTML = eventos.map(v => `<li><strong>${esc(rotuloEvento(v.tipo))}</strong> <span class="cinza">${esc(dataHoraBR(v.quando))} · ${esc(v.usuario)}</span>` +
        (textoEvento(v) ? `<div>${esc(textoEvento(v))}</div>` : '') + '</li>').join('');
      const caixa = $('d-anexos');
      caixa.innerHTML = anexos.length ? '' : '<p class="cinza">Nenhum comprovante.</p>';
      anexos.forEach(a => carregarAnexo(e.id, a, caixa));
    }

    // o binário exige Authorization: busca com fetch e mostra por blob URL
    async function carregarAnexo(entregaId, a, caixa) {
      const fig = doc.createElement('figure');
      const leg = doc.createElement('figcaption');
      leg.textContent = `${a.tipo === 'assinatura' ? 'Assinatura' : 'Foto'} · ${dataHoraBR(a.criadoEm)}`;
      fig.appendChild(leg);
      caixa.appendChild(fig);
      try {
        const blob = await chamar(`/entregas/${encodeURIComponent(entregaId)}/anexo/${encodeURIComponent(a.id)}`, { blob: true });
        const url = URL.createObjectURL(blob);
        estado.urls.push(url);
        const img = doc.createElement('img');
        img.src = url; img.alt = leg.textContent;
        fig.insertBefore(img, leg);
      } catch (err) { leg.textContent += ' — não foi possível carregar (' + err.message + ')'; }
    }

    async function garantirMotoristas() {
      if (estado.motoristas) return;
      const d = await chamar('/entregas/motoristas');
      estado.motoristas = Array.isArray(d.motoristas) ? d.motoristas : [];
    }

    // ---------- Agendar / Reagendar ----------
    const CAMPOS_FORM = { tipo: 'f-tipo', dataAgendada: 'f-data', motoristaCodigo: 'f-motorista', rua: 'f-rua', numero: 'f-numero', bairro: 'f-bairro', cidade: 'f-cidade',
      uf: 'f-uf', cep: 'f-cep', ref: 'f-ref', contatoLocal: 'f-contato', observacao: 'f-obs', transportadora: 'f-transp', rastreio: 'f-rastreio', previsao: 'f-previsao' };
    const lerForm = () => Object.fromEntries(Object.entries(CAMPOS_FORM).map(([k, id]) => [k, $(id).value]));
    function ajustarCamposTipo() {
      const t = $('f-tipo').value;
      $('w-motorista').hidden = t !== 'motorista';
      $('w-endereco').hidden = t === 'retirada';
      $('w-outro').hidden = t !== 'outro_estado';
    }
    async function abrirFormAgendar(reagendar) {
      await garantirMotoristas();
      const e = estado.det.entrega;
      estado.reagendando = reagendar;
      $('ag-titulo').textContent = (reagendar ? 'Reagendar' : 'Agendar') + ` — pedido ${e.numero}`;
      $('f-motorista').innerHTML = '<option value="">Escolha…</option>' + estado.motoristas.map(m => `<option value="${esc(m.codigo)}">${esc(m.nome)}</option>`).join('');
      $('f-tipo').value = e.tipo || '';
      $('f-data').value = e.dataAgendada || '';
      $('f-motorista').value = e.motoristaCodigo ? String(e.motoristaCodigo) : '';
      const a = e.endereco || {};
      for (const c of CAMPOS_ENDERECO) $(CAMPOS_FORM[c]).value = a[c] || '';
      $('f-contato').value = e.contatoLocal || '';
      $('f-obs').value = e.observacao || '';
      $('f-transp').value = e.transportadora || '';
      $('f-rastreio').value = e.rastreio || '';
      $('f-previsao').value = e.previsao || '';
      $('erro-agendar').textContent = '';
      ajustarCamposTipo();
      mostrar('vista-agendar');
    }
    function usarEnderecoCliente() {
      const end = enderecoDoCliente(estado.det && estado.det.clienteEndereco);
      for (const c of Object.keys(end)) $(CAMPOS_FORM[c]).value = end[c];
      if (!Object.values(end).some(Boolean)) toast('O cadastro do cliente não tem endereço.', 'info');
    }
    function enviarAgendar() {
      const f = lerForm();
      const erros = validarAgendamento(f);
      $('erro-agendar').textContent = erros.join(' ');
      if (erros.length) return;
      const e = estado.det.entrega;
      const rota = estado.reagendando ? 'reagendar' : 'agendar';
      const corpo = estado.reagendando ? corpoReagendar(f) : corpoAgendar(f);
      return ocupado(async () => {
        await chamar(`/entregas/${encodeURIComponent(e.id)}/${rota}`, { metodo: 'POST', corpo });
        toast(estado.reagendando ? 'Entrega reagendada.' : 'Entrega agendada.', 'ok');
        await recarregarTudo(e.id);
      });
    }

    // ---------- Cancelar ----------
    function enviarCancelar() {
      const motivo = $('c-motivo').value;
      const erro = validarCancelamento(motivo);
      $('erro-cancelar').textContent = erro || '';
      if (erro) return;
      const e = estado.det.entrega;
      return ocupado(async () => {
        await chamar(`/entregas/${encodeURIComponent(e.id)}/cancelar`, { metodo: 'POST', corpo: { motivo: txt(motivo) } });
        toast('Entrega cancelada.', 'ok');
        await recarregarTudo(e.id);
      });
    }

    // ---------- foto (reduzida para ≤ 1 MB) ----------
    const reduzirImagem = arquivo => C.reduzirImagem(win, arquivo);
    // envia a foto uma única vez por arquivo escolhido (um novo clique após erro na baixa não duplica o anexo)
    async function enviarFoto(entregaId, arquivo) {
      if (estado.anexoEnviado && estado.anexoEnviado.arquivo === arquivo) return estado.anexoEnviado.id;
      const blob = await reduzirImagem(arquivo);
      const r = await chamar(`/entregas/${encodeURIComponent(entregaId)}/anexo?tipo=foto`, { metodo: 'PUT', binario: blob, mime: 'image/jpeg' });
      estado.anexoEnviado = { arquivo, id: r.anexoId };
      return r.anexoId;
    }

    // ---------- baixas: retirada / enviada / comprovante ----------
    function enviarRetirada() {
      const erro = validarRetirada({ entregueA: $('r-entregue').value });
      $('erro-retirada').textContent = erro || '';
      if (erro) return;
      const e = estado.det.entrega, arq = $('r-foto').files[0];
      return ocupado(async () => {
        const corpo = { entregueA: txt($('r-entregue').value), anexoIds: arq ? [await enviarFoto(e.id, arq)] : [] };
        await chamar(`/entregas/${encodeURIComponent(e.id)}/retirada`, { metodo: 'POST', corpo });
        toast('Retirada registrada.', 'ok');
        await recarregarTudo(e.id);
      });
    }
    function enviarEnviada() {
      const erro = validarEnviada({ transportadora: $('e-transp').value });
      $('erro-enviada').textContent = erro || '';
      if (erro) return;
      if (txt($('e-previsao').value) && !dataValida(txt($('e-previsao').value))) { $('erro-enviada').textContent = 'Previsão inválida (AAAA-MM-DD).'; return; }
      const e = estado.det.entrega;
      return ocupado(async () => {
        await chamar(`/entregas/${encodeURIComponent(e.id)}/enviada`, { metodo: 'POST',
          corpo: { transportadora: txt($('e-transp').value), rastreio: txt($('e-rastreio').value), previsao: txt($('e-previsao').value) } });
        toast('Marcada como enviada.', 'ok');
        await recarregarTudo(e.id);
      });
    }
    function enviarComprovante() {
      const arq = $('k-foto').files[0];
      const erro = validarComprovante({ temFoto: !!arq });
      $('erro-comprovante').textContent = erro || '';
      if (erro) return;
      const e = estado.det.entrega;
      return ocupado(async () => {
        const id = await enviarFoto(e.id, arq);
        await chamar(`/entregas/${encodeURIComponent(e.id)}/comprovante`, { metodo: 'POST', corpo: { entregueA: txt($('k-entregue').value), anexoIds: [id] } });
        toast('Comprovante registrado.', 'ok');
        await recarregarTudo(e.id);
      });
    }

    async function recarregarTudo(id) {
      await carregar();
      await abrirDetalhe(id);
    }

    function abrirForm(nome, limpar) {
      limpar.forEach(id => { const el = $(id); if (el.type === 'file') el.value = ''; else el.value = ''; });
      doc.querySelectorAll('.erro-form').forEach(x => { x.textContent = ''; });
      estado.anexoEnviado = null;
      mostrar(nome);
    }

    // ---------- eventos ----------
    function ligar() {
      doc.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => { estado.aba = b.getAttribute('data-aba'); desenharLista(); }));
      $('busca').addEventListener('input', ev => { estado.busca = ev.target.value.trim(); desenharLista(); });
      $('lista').addEventListener('click', ev => {
        const nav = ev.target.closest('[data-mes]');
        if (nav) {
          const h = new win.Date(), m = estado.mes || { ano: h.getFullYear(), mes: h.getMonth() };
          const passo = Number(nav.getAttribute('data-mes'));
          const d = passo === 0 ? new win.Date(h.getFullYear(), h.getMonth(), 1) : new win.Date(m.ano, m.mes + passo, 1);
          estado.mes = { ano: d.getFullYear(), mes: d.getMonth() };
          estado.diaAberto = null;
          desenharLista();
          return;
        }
        const mais = ev.target.closest('[data-dia]');
        if (mais) { estado.diaAberto = mais.getAttribute('data-dia') || null; desenharLista(); return; }
        const botao = ev.target.closest('button[data-acao]');
        const alvo = ev.target.closest('[data-id]');
        if (!alvo) return;
        const id = alvo.getAttribute('data-id');
        ocupado(async () => {
          await abrirDetalhe(id);
          if (botao) await abrirFormAgendar(botao.getAttribute('data-acao') === 'reagendar');
        });
      });
      $('btn-agendar').addEventListener('click', () => ocupado(() => abrirFormAgendar(false)));
      $('btn-reagendar').addEventListener('click', () => ocupado(() => abrirFormAgendar(true)));
      $('btn-cancelar').addEventListener('click', () => abrirForm('vista-cancelar', ['c-motivo']));
      $('btn-retirada').addEventListener('click', () => abrirForm('vista-retirada', ['r-entregue', 'r-foto']));
      $('btn-enviada').addEventListener('click', () => {
        abrirForm('vista-enviada', ['e-transp', 'e-rastreio', 'e-previsao']);
        $('e-transp').value = estado.det.entrega.transportadora || '';
      });
      $('btn-comprovante').addEventListener('click', () => abrirForm('vista-comprovante', ['k-entregue', 'k-foto']));
      $('f-tipo').addEventListener('change', ajustarCamposTipo);
      $('btn-usar-endereco').addEventListener('click', usarEnderecoCliente);
      doc.querySelectorAll('.voltar').forEach(b => b.addEventListener('click', () => { if (estado.det) mostrar('vista-detalhe'); else mostrar('vazio-painel'); }));
      const envio = (id, fn) => $(id).addEventListener('submit', ev => { ev.preventDefault(); fn(); });
      envio('vista-agendar', enviarAgendar);
      envio('vista-cancelar', enviarCancelar);
      envio('vista-retirada', enviarRetirada);
      envio('vista-enviada', enviarEnviada);
      envio('vista-comprovante', enviarComprovante);
    }

    // ---------- init ----------
    const auth = getAuth();
    if (!auth) { win.location.href = C.LOGIN_URL; return; }
    $('user-empresa').textContent = auth.user.empresa || 'Elegance';
    $('user-name').textContent = auth.user.nome || '';
    $('user-cargo').textContent = auth.user.cargo || '';
    $('user-avatar').textContent = (auth.user.nome || 'E').charAt(0).toUpperCase();
    if (win.Acesso && !win.Acesso.paginaLiberada()) return; // sem permissão: o layout.js já mostrou "Sem acesso"
    ligar();
    mostrar('vazio-painel');
    carregar();
  }

  return { ABAS, esc, dataValida, dataBR, dataHoraBR, rotuloStatus, corStatus, rotuloTipo, rotuloEvento, filtrarAba, contadores, agruparAgenda, montarMes, acoesDisponiveis,
    validarAgendamento, corpoAgendar, corpoReagendar, enderecoDoCliente, validarRetirada, validarEnviada, validarComprovante, validarCancelamento, escalaImagem, iniciar };
});
