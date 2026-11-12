// ==========================================================================
// entregas.html — tela da EQUIPE do módulo Entregas (A programar, agenda, em rota, concluídas, ocorrências).
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
  const Sit = typeof module === 'object' && module.exports ? require('./situacoes.js') : raiz.Situacoes;
  const { esc, txt, dataValida, dataBR, dataHoraBR, escalaImagem, rotuloSequencia } = C;

  // ============ LÓGICA PURA ============
  const ROTULO_STATUS = { a_programar: 'A programar', agendada: 'Agendada', em_rota: 'Em rota', ocorrencia: 'Ocorrência', entregue: 'Entregue',
    retirado: 'Retirado', enviada: 'Enviada', cancelada: 'Cancelada', encerrada: 'Encerrada', suspensa: 'Suspensa',
    retirada_agendada: 'Retirada agendada' }; // só exibição: no banco continua status 'agendada' + tipo 'retirada'
  const COR_STATUS = { a_programar: 'aviso', agendada: 'info', em_rota: 'info', ocorrencia: 'perigo', entregue: 'ok', retirado: 'ok', enviada: 'info', cancelada: 'neutro', encerrada: 'neutro', suspensa: 'aviso' };
  const ROTULO_TIPO = { motorista: 'Entrega', retirada: 'Retirado pelo cliente', outro_estado: 'Entrega em outro estado' };
  const ROTULO_EVENTO = { criada: 'Entrou na fila', agendada: 'Agendada', reagendada: 'Reagendada', saiu: 'Saiu para a entrega', entregue: 'Entregue',
    retirada: 'Retirada pelo cliente', enviada: 'Enviada', comprovante: 'Comprovante confirmado', cancelada: 'Cancelada', endereco: 'Endereço alterado',
    ausente: 'Ocorrência: cliente ausente', endereco_errado: 'Ocorrência: endereço errado', recusa: 'Ocorrência: recusa', parcial: 'Ocorrência: entrega parcial',
    dividida: 'Itens separados em outra entrega', sobra_encerrada: 'Saldo encerrado',
    editada: 'Entrega editada', encerrada: 'Encerrada com o pedido', reaberta: 'Reaberta' }; // encerrada/reaberta: pedido Entregue/Retirado fora das Entregas (motivo diz como)
  const ABAS = [
    { id: 'fila', rotulo: 'A programar', status: ['a_programar'] },
    { id: 'agenda', rotulo: 'Agenda', status: ['agendada'] },
    { id: 'em_rota', rotulo: 'Em rota', status: ['em_rota', 'enviada'] }, // enviada (outro estado) fica aqui: é onde se anexa o comprovante,
    { id: 'concluidas', rotulo: 'Concluídas', status: ['entregue', 'retirado', 'cancelada'] },
    { id: 'ocorrencias', rotulo: 'Ocorrências', status: ['ocorrencia'] }
  ];

  // aba em que a entrega com esse status aparece (usada por entregas.html?pedido=N para abrir direto na aba certa)
  const abaDoStatus = s => (ABAS.find(a => a.status.includes(s)) || {}).id || null;

  const rotuloStatus = s => ROTULO_STATUS[s] || String(s ?? '');
  const corStatus = s => (s === 'retirada_agendada' ? 'retirada' : Sit.cor('entrega', s));
  // status mostrado nos selos: Agendada de tipo "Retirado pelo cliente" vira "Retirada agendada" (a data é a que o cliente marcou)
  const statusDaEntrega = e => { const s = e.statusExibicao || e.status; return s === 'agendada' && e.tipo === 'retirada' ? 'retirada_agendada' : s; };
  const rotuloTipo = t => ROTULO_TIPO[t] || '—';
  const rotuloEvento = t => ROTULO_EVENTO[t] || String(t ?? '');
  // Linha do tempo: o cancelamento automático por "saiu de Pronto" acompanha o selo (Encerrada/Suspensa), e não "Cancelada".
  // Só o último evento reflete a situação atual do pedido; os anteriores (a entrega já reabriu depois deles) foram Suspensa.
  const MOTIVO_SAIU = 'Pedido saiu de Pronto';
  function eventoExibicao(v, entrega, eventos) {
    const base = { rotulo: rotuloEvento(v.tipo), motivo: v.motivo ?? null };
    if (!v || v.tipo !== 'cancelada' || v.usuario !== 'sistema' || v.motivo !== MOTIVO_SAIU) return base;
    const cancelamentos = (eventos || []).filter(x => x.tipo === 'cancelada');
    const ultimo = cancelamentos.length ? cancelamentos[cancelamentos.length - 1] : null;
    if (ultimo && ultimo.id === v.id && entrega && entrega.statusExibicao === 'encerrada') {
      return { rotulo: ROTULO_STATUS.encerrada, motivo: 'Pedido concluído fora do sistema (Entregue/Retirado)' };
    }
    return { rotulo: ROTULO_STATUS.suspensa, motivo: v.motivo };
  }

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

  // Editar entrega: só entrega aberta (espelha STATUS_EDITAVEIS de calculo/entregas.js; o servidor continua decidindo)
  const STATUS_EDITAVEIS = ['a_programar', 'agendada', 'em_rota', 'ocorrencia', 'enviada'];
  const podeEditarEntrega = e => !!(e && STATUS_EDITAVEIS.includes(e.status));

  // ---- Menu do botão direito (consulta e fiscalização; NADA que altere pedido ou entrega) ----
  // Cada opção só aparece com a permissão da rota que ela usa (perm = códigos separados por espaço: todos são exigidos, como Acesso.pode).
  // `rota` documenta a chamada que a opção faz (conferida em teste contra as rotas registradas); dinheiro só com valores.ver.
  const MENU_ENTREGA = [
    { id: 'detalhe', icone: '📋', rotulo: 'Abrir detalhes da entrega', perm: 'entregas.ver', rota: 'GET /entregas/:id' },
    { id: 'linha_tempo', icone: '🕘', rotulo: 'Ver linha do tempo da entrega', perm: 'entregas.ver', rota: 'GET /entregas/:id' },
    { sep: true },
    { id: 'pdf_pedido', icone: '📄', rotulo: 'Abrir PDF do pedido', perm: 'pedidos.pdf', rota: 'GET /dados_pdf' },
    { id: 'pdf_producao', icone: '🏭', rotulo: 'Guia de produção (PDF)', perm: 'pedidos.pdf', rota: 'GET /dados_pdf' },
    { id: 'pdf_vidros', icone: '🪟', rotulo: 'Vidros (PDF)', perm: 'pedidos.pdf', rota: 'GET /dados_pdf_vidros' },
    { id: 'danfe', icone: '🧾', rotulo: 'Abrir nota fiscal (DANFE)', perm: 'danfe.ver', rota: 'GET /danfe/pedido/:numero' },
    { id: 'checklist', icone: '✅', rotulo: 'Checklist de entrega (PDF)', perm: 'entregas.ver entregas.checklist', rota: 'GET /entregas/:id/checklist.pdf' },
    { sep: true },
    { id: 'historico_pedido', icone: '🕘', rotulo: 'Histórico do pedido', perm: 'pedidos.ver', rota: 'GET /ped_orc/Pedido/:numero/historico' },
    { id: 'etapas', icone: '🧩', rotulo: 'Ver etapas de produção', perm: 'etapas.ver', rota: 'GET /etapas/fila' },
    { id: 'financeiro_cliente', icone: '💰', rotulo: 'Ver financeiro do cliente', perm: 'clientes.receber valores.ver', rota: 'GET /clientes/financeiro/:codigo' },
    { sep: true },
    { id: 'copiar_endereco', icone: '📍', rotulo: 'Copiar endereço', perm: 'entregas.ver', rota: 'GET /entregas/:id' },
    { id: 'copiar_contato', icone: '📋', rotulo: 'Copiar contato no local', perm: 'entregas.ver', rota: 'GET /entregas/:id' },
    { id: 'ligar', icone: '📞', rotulo: 'Ligar para o contato', perm: 'entregas.ver', rota: 'GET /entregas/:id' }
  ];
  function itensMenuEntrega(e, pode) {
    if (!e || typeof pode !== 'function') return [];
    const L = [];
    for (const it of MENU_ENTREGA) {
      if (it.sep) { if (L.length && !L[L.length - 1].sep) L.push({ sep: true }); continue; }
      if (pode(it.perm)) L.push({ ...it });
    }
    while (L.length && L[L.length - 1].sep) L.pop();
    return L;
  }
  // texto da linha do tempo para o evento 'editada' (detalhe = { antes, depois } só do que mudou)
  const ROTULO_CAMPO_EDICAO = { tipo: 'Tipo', dataAgendada: 'Data', motoristaCodigo: 'Motorista', endereco: 'Endereço', contatoLocal: 'Contato no local', observacao: 'Observação' };
  function resumoEdicao(detalhe) {
    const depois = detalhe && typeof detalhe.depois === 'object' && detalhe.depois ? detalhe.depois : null;
    if (!depois) return '';
    const val = (k, v) => (v === null || v === undefined || v === '' ? 'vazio' : k === 'tipo' ? rotuloTipo(v) : k === 'dataAgendada' ? dataBR(v) : typeof v === 'object' ? 'alterado' : String(v));
    return Object.keys(depois).map(k => `${ROTULO_CAMPO_EDICAO[k] || k}: ${val(k, (detalhe.antes || {})[k])} → ${val(k, depois[k])}`).join('; ');
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

  const { enderecoDoViaCep, cepLimpo } = C; // busca de CEP compartilhada (entregas_comum.js)
  const validarRetirada = f => (txt(f.entregueA) ? null : 'Informe quem retirou.');
  const validarEnviada = f => (txt(f.transportadora) ? null : 'Informe a transportadora.');
  const validarComprovante = f => (f.temFoto ? null : 'Anexe a foto do comprovante.');
  const validarCancelamento = m => (txt(m).length >= 3 ? null : 'Informe o motivo (mínimo 3 caracteres).');

  // ---- Várias entregas por pedido: divisão, restante da ocorrência parcial, saldo e ?pedido=N ----
  const TOL = 1e-9;
  const r4 = x => Math.round((Number(x) || 0) * 1e4) / 1e4;
  // "1,5" ou "1.5" -> 1.5; vazio -> 0; texto inválido -> NaN
  const lerNumero = v => { const t = txt(v).replace(',', '.'); return t === '' ? 0 : (/^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN); };
  const numeroBR = n => String(r4(n)).replace('.', ',');

  // linhas do formulário "Separar em outra entrega": itens desta entrega (itensDetalhe da API) com a quantidade a separar
  // `produto` e `obsPedido` (observação do orçamento) vêm da API só para leitura; `observacao` é a do item, digitada aqui
  const linhasSeparacao = (itensDetalhe, separar = {}) => (Array.isArray(itensDetalhe) ? itensDetalhe : [])
    .map(i => ({ item: i.item, descricao: i.descricao, produto: i.produto || '', obsPedido: i.obsPedido || '', qtd: r4(i.qtd), separar: r4(separar[i.item] || 0), observacao: '' }));

  // Ficha do item: o nome (PRODUTO do orçamento, ou o texto antes das etiquetas) e as etiquetas "Rótulo: valor" separadas por " | ".
  // Ex.: "Tam: 660x400mm | Per: 1036 Pintura Sólida Alumínio | Pux: 2018 E" -> Tamanho, Perfil e Puxador. Nada é inventado: texto sem
  // rótulo vira etiqueta sem rótulo, e sem nome nenhum o cartão se chama "Item N".
  const ROTULO_FICHA = { Tam: 'Tamanho', Per: 'Perfil', Pux: 'Puxador', Rev: 'Revestimento' };
  const RE_ETIQUETA = /^([A-Za-zÀ-ÿ]{2,12})\s*:\s*(.+)$/;
  function fichaDoItem(descricao, produto, numeroItem) {
    const partes = txt(descricao).split('|').map(p => txt(p)).filter(Boolean);
    let titulo = '';
    const etiquetas = [];
    partes.forEach((p, k) => {
      let m = RE_ETIQUETA.exec(p);
      if (!m && k === 0) { // "Nome do item Tam: 660x400mm": o nome vem antes da primeira etiqueta
        const corte = /^(.*?\S)\s+([A-Za-zÀ-ÿ]{2,12}\s*:\s*\S.*)$/.exec(p);
        if (corte) { titulo = corte[1]; m = RE_ETIQUETA.exec(corte[2]); }
      }
      if (m) etiquetas.push({ rotulo: ROTULO_FICHA[m[1]] || m[1], texto: m[2].trim() });
      else if (!etiquetas.length && !titulo) titulo = p;
      else etiquetas.push({ rotulo: '', texto: p });
    });
    const nome = txt(produto) || titulo || `Item ${numeroItem}`;
    if (txt(produto) && titulo && titulo !== txt(produto)) etiquetas.unshift({ rotulo: '', texto: titulo });
    return { nome, etiquetas };
  }

  // quantidade em passos: item de quantidade inteira anda de 1 em 1; com fração, de 0,5 em 0,5 (o campo aceita qualquer valor)
  const passoDe = qtd => (Math.abs(r4(qtd) - Math.round(qtd)) < TOL ? 1 : 0.5);
  const ajustarQuantidade = (atual, direcao, max, passo) => {
    const base = Number.isFinite(atual) ? atual : 0;
    return Math.min(r4(max), Math.max(0, r4(base + direcao * passo)));
  };
  const MSG_NADA_SEPARADO = 'Informe a quantidade a separar de pelo menos um item.';
  const MSG_TUDO_SEPARADO = 'Você marcou todos os itens: deixe ao menos um item nesta entrega (isso não é divisão).';
  const LIMITE_OBS_ITEM = 255;

  // Resumo do formulário (antes dos botões) e se o "Separar" pode ser clicado. `aviso` explica o que impede; sem nada marcado
  // não há aviso (o resumo já diz "Nenhum item selecionado").
  function resumoSeparacao(linhas) {
    const l = Array.isArray(linhas) ? linhas : [];
    const marcadas = l.filter(x => Number.isFinite(x.separar) && x.separar > TOL);
    const unidades = r4(marcadas.reduce((s, x) => s + x.separar, 0));
    const erros = validarSeparacao(l);
    const texto = marcadas.length
      ? `${marcadas.length} ${marcadas.length === 1 ? 'item selecionado' : 'itens selecionados'} · ${numeroBR(unidades)} ${unidades === 1 ? 'unidade' : 'unidades'}`
      : 'Nenhum item selecionado';
    return { itens: marcadas.length, unidades, texto, podeEnviar: erros.length === 0, aviso: erros[0] && erros[0] !== MSG_NADA_SEPARADO ? erros[0] : '' };
  }

  // HTML (estático, sem style=) do cartão de um item do formulário "Separar". Só esc() em dado da API.
  function htmlCartaoSeparacao(l, k) {
    const f = fichaDoItem(l.descricao, l.produto, l.item);
    const nome = esc(f.nome);
    const max = esc(String(l.qtd)), disp = esc(numeroBR(l.qtd));
    // todos os dados do item no mesmo formato de etiqueta (rótulo + valor): ficha técnica, quantidade disponível e observação do pedido
    const etiquetas = f.etiquetas.map(e => `<li>${e.rotulo ? `<span class="rot">${esc(e.rotulo)}:</span> ` : ''}<b>${esc(e.texto)}</b></li>`).join('') +
      `<li class="sep-etq-disp"><span class="rot">Disponível:</span> <b>${disp}</b></li>` +
      (l.obsPedido ? `<li class="sep-etq-obs"><span class="rot">Obs. do pedido:</span> <b>${esc(l.obsPedido)}</b></li>` : '');
    return `<li class="sep-cartao" id="sp-cartao-${k}">` +
      `<div class="sep-topo"><span class="sep-nome" id="sp-nome-${k}">${nome}</span><span class="sep-numero">Item ${esc(l.item)}</span></div>` +
      `<ul class="sep-ficha" aria-label="Detalhes do item ${esc(l.item)}">${etiquetas}</ul>` +
      `<div class="sep-qtd" role="group" aria-labelledby="sp-rot-${k}"><span class="sep-rotulo" id="sp-rot-${k}">Separar</span>` +
      `<button type="button" class="sep-passo" data-acao="menos" data-linha="${k}" id="sp-menos-${k}" aria-label="Diminuir a quantidade de ${nome}">−</button>` +
      `<input type="number" class="sep-campo" inputmode="decimal" id="sp-item-${k}" data-linha="${k}" min="0" max="${max}" step="any" value="${esc(l.separar)}" aria-label="Quantidade a separar de ${nome}, de ${disp}">` +
      `<button type="button" class="sep-passo" data-acao="mais" data-linha="${k}" id="sp-mais-${k}" aria-label="Aumentar a quantidade de ${nome}">+</button>` +
      `<span class="sep-de">de ${disp}</span>` +
      `<button type="button" class="sep-todos" data-acao="todos" data-linha="${k}" aria-label="Separar todos os ${disp} de ${nome}">Todos</button></div>` +
      `</li>`;
  }

  // Ocorrência "parcial" do motorista: o restante (não entregue) de cada item, a partir de itensEntregues do ÚLTIMO evento de
  // ocorrência. O motorista informa descrição e quantidade; só dá para inferir se cada descrição casa com UM item desta entrega.
  // Devolve { inferido, linhas }: inferido = false -> lista completa com zero para a equipe marcar.
  const OCORRENCIAS_TELA = ['ausente', 'endereco_errado', 'recusa', 'parcial'];
  function ultimaOcorrencia(eventos) {
    const oc = (Array.isArray(eventos) ? eventos : []).filter(v => OCORRENCIAS_TELA.includes(v.tipo));
    return oc.length ? oc[oc.length - 1] : null;
  }
  function restanteDaOcorrencia(itensDetalhe, eventos) {
    const vazio = { inferido: false, linhas: linhasSeparacao(itensDetalhe) };
    const ult = ultimaOcorrencia(eventos);
    const entregues = ult && ult.tipo === 'parcial' && ult.detalhe && Array.isArray(ult.detalhe.itensEntregues) ? ult.detalhe.itensEntregues : null;
    if (!entregues || !entregues.length) return vazio;
    const itens = Array.isArray(itensDetalhe) ? itensDetalhe : [];
    const chave = s => txt(s).toLowerCase();
    const entregue = {};
    for (const x of entregues) {
      const casam = itens.filter(i => chave(i.descricao) === chave(x.descricao));
      if (casam.length !== 1) return vazio; // descrição repetida ou desconhecida: a equipe marca à mão
      entregue[casam[0].item] = (entregue[casam[0].item] || 0) + (Number(x.qtd) || 0);
    }
    const separar = {};
    for (const i of itens) separar[i.item] = Math.max(0, r4(i.qtd - (entregue[i.item] || 0)));
    return { inferido: true, linhas: linhasSeparacao(itens, separar) };
  }
  // botão "Gerar entrega do restante": entrega em Ocorrência cuja última ocorrência foi "parcial" e que pode ser dividida
  const podeGerarRestante = det => !!(det && det.entrega && det.entrega.status === 'ocorrencia' && det.divisao && det.divisao.podeSeparar &&
    (ultimaOcorrencia(det.eventos) || {}).tipo === 'parcial');

  // confere as quantidades digitadas (linhas com `separar` já lido por lerNumero)
  function validarSeparacao(linhas) {
    const l = Array.isArray(linhas) ? linhas : [];
    const ruim = l.find(x => !Number.isFinite(x.separar) || x.separar < 0 || x.separar > x.qtd + TOL || Math.abs(r4(x.separar) - x.separar) > TOL);
    if (ruim) return [`Quantidade inválida em "${txt(ruim.descricao)}" (de 0 a ${numeroBR(ruim.qtd)}, até 4 casas decimais).`];
    if (!l.some(x => x.separar > TOL)) return [MSG_NADA_SEPARADO];
    if (l.every(x => x.separar >= x.qtd - TOL)) return [MSG_TUDO_SEPARADO];
    const longa = l.find(x => x.separar > TOL && txt(x.observacao).length > LIMITE_OBS_ITEM);
    if (longa) return [`A observação de "${txt(longa.descricao)}" passa de ${LIMITE_OBS_ITEM} caracteres.`];
    return [];
  }
  // só os itens com quantidade levam observação (a do item que fica nesta entrega não é enviada)
  const corpoSeparar = (linhas, observacao) => {
    const b = { itens: linhas.filter(x => x.separar > TOL).map(x => ({ numeroItem: x.item, quantidade: r4(x.separar), ...(txt(x.observacao) ? { observacao: txt(x.observacao) } : {}) })) };
    if (txt(observacao)) b.observacao = txt(observacao);
    return b;
  };

  // ?pedido=N: TODAS as entregas do pedido (qualquer status), na ordem em que foram criadas; a primeira ativa abre o detalhe
  const FINAIS_TELA = ['entregue', 'retirado', 'cancelada'];
  function entregasDoPedido(lista, numero) {
    return (Array.isArray(lista) ? lista : []).filter(e => String(e.numero) === String(numero)).slice().sort((a, b) => a.id - b.id);
  }
  const entregaParaAbrir = doPedido => doPedido.find(e => !FINAIS_TELA.includes(e.status)) || doPedido[doPedido.length - 1] || null;

  // "Saldo a entregar" filtrado pela busca da tela (número ou cliente)
  const filtrarSobras = (sobras, busca) => (Array.isArray(sobras) ? sobras : []).filter(s => {
    const b = txt(busca).toLowerCase();
    return !b || String(s.numero).includes(b) || String(s.cliente || '').toLowerCase().includes(b) || String(s.clienteFinal || '').toLowerCase().includes(b);
  });
  // Nome do motorista: o que o servidor devolveu (motoristaNome/motorista) > lista de motoristas já carregada > "#id" só como último recurso
  const nomeMotorista = (e, lista) => {
    if (!e) return '';
    const direto = String(e.motoristaNome || e.motorista || '').trim();
    if (direto) return direto;
    const achado = (Array.isArray(lista) ? lista : []).find(m => m.codigo === e.motoristaCodigo);
    if (achado && achado.nome) return achado.nome;
    return e.motoristaCodigo ? '#' + e.motoristaCodigo : '';
  };
  // "Item 3 · Descrição" (o número é o ITEM do pedido; sem número, só a descrição)
  const rotuloItem = C.rotuloItem;
  const textoItens = itens => (Array.isArray(itens) ? itens : []).map(i => `${rotuloItem(i)} × ${numeroBR(i.qtd)}`).join('; ');

  // ---- Painel de detalhe (2026-11-12): dados com copiar/ligar, itens com chip, linha do tempo e aviso do cancelamento ----
  // Telefone brasileiro dentro de um texto livre ("João (27) 99876-5432"): DDD de 11 a 99 + 8 ou 9 dígitos (celular começa
  // com 9), com ou sem +55. Só um trecho que pareça telefone vale; nada é inventado. Devolve "tel:+55DDNNNNNNNNN" ou ''.
  function linkLigar(texto) {
    const s = String(texto ?? '');
    const re = /(?:\+?55[\s.-]*)?\(?\s*([1-9][1-9])\s*\)?[\s.-]*(9?\d{4})[\s.-]?(\d{4})(?!\d)/g;
    let m;
    while ((m = re.exec(s))) {
      const antes = s[m.index - 1];
      if (antes && /\d/.test(antes)) continue; // pedaço de um número maior (CEP, documento)
      const local = m[2] + m[3];
      if (local.length === 9 && local[0] !== '9') continue;
      if (local.length === 8 && /^[01]/.test(local)) continue;
      return 'tel:+55' + m[1] + local;
    }
    return '';
  }
  // um item da entrega: chip "Item N", descrição (quebra) e quantidade; observação do item embaixo
  function htmlItemDetalhe(i) {
    const num = i && i.item !== null && i.item !== undefined && i.item !== '' && Number.isFinite(Number(i.item)) ? `<span class="det-chip">Item ${esc(i.item)}</span>` : '<span class="det-chip">—</span>';
    return `<li class="det-item">${num}<span class="det-item-desc">${esc(i && i.descricao ? i.descricao : 'Sem descrição')}</span>` +
      `<span class="det-item-qtd">× ${esc(numeroBR(i && i.qtd))}</span>${i && i.observacao ? `<span class="det-item-obs">Obs.: ${esc(i.observacao)}</span>` : ''}</li>`;
  }
  // um evento da linha do tempo: rótulo em destaque; hora e usuário em tom suave; texto do motivo/detalhe abaixo
  const htmlEventoDetalhe = (rotulo, quando, usuario, texto) => `<li><span class="det-tempo-rot">${esc(rotulo)}</span>` +
    `<span class="det-tempo-meta">${esc([dataHoraBR(quando), usuario].filter(Boolean).join(' · '))}</span>` +
    (texto ? `<div class="det-tempo-txt">${esc(texto)}</div>` : '') + '</li>';
  // texto da confirmação do cancelamento: o que acontece de verdade (a equipe não reabre uma entrega cancelada)
  function avisoCancelamento(det) {
    const e = (det && det.entrega) || {};
    const div = (det && det.divisao) || {};
    const seq = rotuloSequencia(div);
    const base = `Cancelar a entrega do pedido ${e.numero ?? ''}${seq ? ' (' + seq + ')' : ''}? Ela sai da fila e da agenda e não pode ser reaberta por esta tela.`;
    return div.dividido
      ? `${base} Os itens desta entrega voltam para o "Saldo a entregar" do pedido.`
      : `${base} O pedido continua com a situação atual e não volta sozinho para "A programar".`;
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { lista: [], aba: 'fila', busca: '', det: null, motoristas: null, urls: [], anexoEnviado: null, reagendando: false, carregando: false, mes: null, diaAberto: null,
      atualizando: false, sobras: [], pedidoFiltro: '', sobraAlvo: null, separar: null };

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
    // ?pedido=N (link do menu do botão direito em Pedidos/Início): na primeira carga a lista mostra TODAS as entregas desse pedido
    // (qualquer status, com "Entrega n de N") e abre o detalhe da primeira ainda aberta; "Mostrar todas" (ou uma aba) volta ao normal
    let pedidoDoLink = '';
    try { pedidoDoLink = (new win.URLSearchParams(win.location.search).get('pedido') || '').trim(); } catch { /* sem query */ }
    if (!/^\d+$/.test(pedidoDoLink)) pedidoDoLink = '';
    async function carregar() {
      try {
        const d = await chamar('/entregas');
        estado.lista = Array.isArray(d.entregas) ? d.entregas : [];
        estado.sobras = Array.isArray(d.sobras) ? d.sobras : [];
      } catch (err) { toast(err.message, 'erro'); } // falha: mantém o que já estava na tela
      if (pedidoDoLink) {
        estado.pedidoFiltro = pedidoDoLink;
        const alvo = entregaParaAbrir(entregasDoPedido(estado.lista, pedidoDoLink));
        pedidoDoLink = '';
        desenharLista();
        if (alvo) await abrirDetalhe(alvo.id);
        return;
      }
      desenharLista();
    }

    const casa = e => {
      const b = estado.busca.toLowerCase();
      return !b || String(e.numero).includes(b) || String(e.cliente || '').toLowerCase().includes(b) || String(e.clienteFinal || '').toLowerCase().includes(b);
    };
    const local = e => [e.cidade, e.uf].filter(Boolean).join('/');
    const selo = s => `<span class="selo ${corStatus(s)}">${esc(rotuloStatus(s))}</span>`;
    // pedido ainda Em Produção (entrega criada à mão): deixa claro que ainda não está pronto para sair
    const seloProducao = sit => (String(sit || '') === 'Em Produção' ? ' <span class="selo info" title="O pedido ainda está em produção: só dá para dar baixa depois que ficar Pronto">Em produção</span>' : '');
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

    // número do pedido + "Entrega n de N" (só quando o pedido tem mais de uma entrega não cancelada)
    const celulaNumero = e => `<td>${esc(e.numero)}${rotuloSequencia(e) ? `<span class="seq">${esc(rotuloSequencia(e))}</span>` : ''}</td>`;
    function linha(e, aba) {
      const tdBase = `${celulaNumero(e)}${aba === 'fila' ? `<td>${esc(dataBR(e.dataPedido))}</td>` : ''}<td>${esc(e.cliente)}</td><td>${esc(e.clienteFinal || '-')}</td><td>${esc(local(e))}</td>`;
      let resto;
      if (aba === 'fila') resto = `<td>${esc(dataBR(e.dataPrometida))}</td><td>${selo(statusDaEntrega(e))}${seloProducao(e.situacaoPedido)}</td><td class="acao"><div class="acao-pilha">${botaoAcao('agendar', 'Agendar')}${botaoAcao('agendar-retirada', 'Agendar retirada')}</div></td>`;
      else if (aba === 'ocorrencias') resto = `<td>${esc(dataBR(e.dataAgendada))}</td><td>${esc(e.motorista || rotuloTipo(e.tipo))}</td><td>${esc(e.qtdOcorrencias)}</td><td class="acao">${botaoAcao('reagendar', 'Reagendar')}</td>`;
      else resto = `<td>${esc(dataBR(e.dataAgendada))}</td><td>${esc(e.motorista || rotuloTipo(e.tipo))}</td><td>${selo(statusDaEntrega(e))}${seloProducao(e.situacaoPedido)}</td>` +
        (aba === 'em_rota' ? `<td class="acao">${e.status === 'em_rota' ? botaoAcao('reagendar', 'Reagendar') : ''}</td>` : ''); // só em_rota: a equipe destrava; enviada segue o fluxo próprio
      const mais = `<td class="mais"><button type="button" class="ent-mais" data-mais="${esc(e.id)}" aria-haspopup="menu" aria-label="Consultar a entrega do pedido ${esc(e.numero)}" title="Consultar (PDFs, nota fiscal, histórico...)">⋯</button></td>`;
      const classes = [estado.det && estado.det.entrega.id === e.id ? 'selecionado' : '', statusDaEntrega(e) === 'retirada_agendada' ? 'linha-retirada' : ''].filter(Boolean).join(' ');
      return `<tr data-id="${esc(e.id)}"${classes ? ` class="${classes}"` : ''}>${tdBase}${resto}${mais}</tr>`;
    }
    const CABECALHO = {
      fila: ['Pedido', 'Data do pedido', 'Cliente', 'Cliente final', 'Cidade/UF', 'Prometido', 'Status', '', ''],
      ocorrencias: ['Pedido', 'Cliente', 'Cliente final', 'Cidade/UF', 'Agendada', 'Motorista/Tipo', 'Ocorr.', '', ''],
      outras: ['Pedido', 'Cliente', 'Cliente final', 'Cidade/UF', 'Data', 'Motorista/Tipo', 'Status', ''],
      em_rota: ['Pedido', 'Cliente', 'Cliente final', 'Cidade/UF', 'Data', 'Motorista/Tipo', 'Status', '', '']
    };

    // Agenda em calendário mensal: cada entrega é uma etiqueta colorida pelo status; clicar abre o detalhe
    const MAX_ETIQUETAS = 8; // células altas (min-height em entregas.html): cabem bem mais pedidos antes do "+N mais"
    function hojeISO() {
      const d = new win.Date();
      return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
    }
    function desenharCalendario() {
      if (!estado.mes) { const h = new win.Date(); estado.mes = { ano: h.getFullYear(), mes: h.getMonth() }; }
      const { ano, mes } = estado.mes;
      const semanas = montarMes(estado.lista.filter(casa), ano, mes, hojeISO());
      const etiqueta = e => `<button type="button" class="etiqueta ${corStatus(statusDaEntrega(e))}" data-id="${esc(e.id)}" title="${esc(`${e.numero}${rotuloSequencia(e) ? ' · ' + rotuloSequencia(e) : ''} — ${e.cliente || ''} (${rotuloStatus(statusDaEntrega(e))}) · Responsável: ${e.motorista || (e.tipo === 'retirada' ? 'Retirada agendada' : rotuloTipo(e.tipo))}${C.textoItens(e)}`)}">` +
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

    // "Saldo a entregar": pedido dividido com item sem entrega (ou alterado depois da divisão). Botões só com entregas.programar.
    function htmlSobras(sobras) {
      if (!sobras.length) return '';
      const linhaSobra = s => `<tr class="sobra-linha"><td>${esc(s.numero)}</td><td>${esc(s.cliente)}</td>` +
        `<td>${s.qtdItensSemEntrega ? esc(textoItens(s.itensSemEntrega)) : '—'}${s.alterado ? '<p class="aviso-divisao">Pedido alterado depois da divisão: confira os itens.</p>' : ''}</td>` +
        `<td class="acao">${s.alterado || !s.qtdItensSemEntrega ? '' :
          `<button type="button" class="btn btn-mini btn-secondary" data-sobra="gerar" data-numero="${esc(s.numero)}" data-perm="entregas.programar">Gerar entrega do saldo</button> ` +
          `<button type="button" class="btn btn-mini btn-perigo" data-sobra="encerrar" data-numero="${esc(s.numero)}" data-perm="entregas.programar">Encerrar saldo</button>`}</td></tr>`;
      return `<div class="sobras"><h3>Saldo a entregar</h3><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens sem entrega</th><th></th></tr></thead>` +
        `<tbody>${sobras.map(linhaSobra).join('')}</tbody></table></div>`;
    }

    // ?pedido=N: todas as entregas do pedido, de qualquer aba
    function desenharDoPedido() {
      const doPedido = entregasDoPedido(estado.lista, estado.pedidoFiltro);
      const topo = `<div class="filtro-pedido"><strong>Entregas do pedido ${esc(estado.pedidoFiltro)}</strong><span class="cinza">${doPedido.length} entrega(s)</span>` +
        '<button type="button" class="btn btn-mini btn-secondary" data-limpar-pedido>Mostrar todas</button></div>';
      const sobras = estado.sobras.filter(s => String(s.numero) === estado.pedidoFiltro);
      const corpo = doPedido.length
        ? `<table><thead><tr>${CABECALHO.outras.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${doPedido.map(e => linha(e, 'outras')).join('')}</tbody></table>`
        : '<p class="vazio">Nenhuma entrega deste pedido.</p>';
      $('lista').innerHTML = topo + htmlSobras(sobras) + corpo;
    }

    function desenharLista() {
      desenharAbas();
      if (estado.pedidoFiltro) { desenharDoPedido(); return; }
      if (estado.aba === 'agenda') { desenharCalendario(); return; }
      const itens = filtrarAba(estado.lista, estado.aba).filter(casa);
      const alvo = $('lista');
      const sobras = estado.aba === 'fila' ? htmlSobras(filtrarSobras(estado.sobras, estado.busca)) : '';
      if (!itens.length) { alvo.innerHTML = sobras + '<p class="vazio">Nada por aqui.</p>'; return; }
      const cab = CABECALHO[estado.aba] || CABECALHO.outras;
      alvo.innerHTML = sobras + `<table><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${itens.map(e => linha(e, estado.aba)).join('')}</tbody></table>`;
    }

    // ---------- painel ----------
    const VISTAS = ['vazio-painel', 'vista-detalhe', 'vista-agendar', 'vista-cancelar', 'vista-retirada', 'vista-enviada', 'vista-comprovante', 'vista-separar', 'vista-encerrar', 'vista-criar'];
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

    // `extra` = HTML já montado aqui (botões copiar/ligar); o valor sempre passa por esc()
    // cada par fica num <div> (permitido dentro de <dl>): curtos em duas colunas, textos longos em linha inteira
    const LARGOS = ['Cliente', 'Endereço', 'Contato no local', 'Observação', 'Transportadora'];
    function linhaInfo(rot, val, extra = '') {
      return val ? `<div class="det-campo${LARGOS.includes(rot) ? ' det-largo' : ''}"><dt>${esc(rot)}</dt><dd>${esc(val)}${extra}</dd></div>` : '';
    }
    const botaoCopiar = (campo, rotulo) => `<button type="button" class="det-mini" data-copiar="${campo}" aria-label="Copiar ${esc(rotulo)}">Copiar</button>`;
    function acoesContato(texto) {
      const tel = linkLigar(texto);
      return `<span class="det-linha-acoes">${botaoCopiar('contato', 'o contato no local')}${tel ? `<a class="det-mini" href="${esc(tel)}" aria-label="Ligar para o contato no local">Ligar</a>` : ''}</span>`;
    }
    function enderecoTexto(e) {
      const a = e.endereco || {};
      const l1 = [a.rua, a.numero].filter(Boolean).join(', ');
      return [l1, a.bairro, [a.cidade, a.uf].filter(Boolean).join('/'), a.cep, a.ref].filter(Boolean).join(' · ');
    }

    function textoEvento(v) {
      const partes = [];
      if (v.motivo) partes.push(v.motivo);
      if (v.entregueA) partes.push('Recebido por ' + v.entregueA);
      if (v.tipo === 'editada' && v.detalhe) partes.push(resumoEdicao(v.detalhe));
      const itens = v.detalhe && Array.isArray(v.detalhe.itensEntregues) ? v.detalhe.itensEntregues : [];
      if (itens.length) partes.push('Entregue: ' + itens.map(i => `${i.descricao} × ${i.qtd}`).join('; '));
      if (v.detalhe && v.detalhe.transportadora) partes.push('Transportadora: ' + v.detalhe.transportadora + (v.detalhe.rastreio ? ' (rastreio ' + v.detalhe.rastreio + ')' : ''));
      return partes.join(' — ');
    }

    function desenharDetalhe() {
      const { entrega: e, eventos, anexos } = estado.det;
      // itensDetalhe traz o número do item do pedido ("Item 1 · ..."); `itens` (formato antigo) só como reserva
      const itens = Array.isArray(estado.det.itensDetalhe) && estado.det.itensDetalhe.length ? estado.det.itensDetalhe : (estado.det.itens || []);
      const div = estado.det.divisao || {};
      mostrar('vista-detalhe');
      const seq = rotuloSequencia(div);
      $('d-titulo').innerHTML = `Pedido <span class="det-num">${esc(e.numero)}</span>`;
      $('d-titulo').setAttribute('aria-label', `Pedido ${e.numero}${seq ? ', ' + seq : ''}`);
      const sub = [seq, e.cliente].filter(Boolean).join(' · ');
      $('d-sub').textContent = sub;
      $('d-sub').hidden = !sub;
      $('d-status').innerHTML = selo(statusDaEntrega(e)) +seloProducao(div.situacaoPedido);
      // pedido editado depois da divisão: aviso fixo; a divisão fica bloqueada e o pedido não fecha sozinho na última baixa
      const avisos = [];
      if (div.situacaoPedido === 'Em Produção' && !['cancelada', 'entregue', 'retirado'].includes(e.status)) avisos.push('Pedido ainda em produção: a baixa só é possível depois que ele estiver Pronto.');
      if (div.alterado) avisos.push('O pedido foi alterado depois da divisão: confira os itens. Ele não vira Entregue sozinho na última baixa.');
      if (!div.alterado && Array.isArray(div.itensSemEntrega) && div.itensSemEntrega.length) avisos.push('Saldo a entregar: ' + textoItens(div.itensSemEntrega) + '.');
      $('d-aviso').textContent = avisos.join(' ');
      $('d-aviso').hidden = !avisos.length;
      $('btn-separar').hidden = !div.podeSeparar;
      $('btn-restante').hidden = !podeGerarRestante(estado.det);
      $('d-itens-titulo').textContent = div.dividido ? 'Itens desta entrega' : 'Itens do pedido';
      const endereco = enderecoTexto(e);
      $('d-info').innerHTML = linhaInfo('Cliente', e.cliente) + linhaInfo('Tipo', e.tipo ? rotuloTipo(e.tipo) : '') +
        linhaInfo('Data do pedido', dataBR(e.dataPedido)) + linhaInfo('Prometido', dataBR(e.dataPrometida)) + linhaInfo('Agendada', dataBR(e.dataAgendada)) +
        linhaInfo('Motorista', nomeMotorista(e, estado.motoristas)) +
        linhaInfo('Endereço', endereco, `<span class="det-linha-acoes">${botaoCopiar('endereco', 'o endereço')}</span>`) +
        linhaInfo('Contato no local', e.contatoLocal, acoesContato(e.contatoLocal)) + linhaInfo('Transportadora', e.transportadora) +
        linhaInfo('Rastreio', e.rastreio) + linhaInfo('Previsão', dataBR(e.previsao)) + linhaInfo('Observação', e.observacao);
      estado.copiar = { endereco, contato: txt(e.contatoLocal) };
      const acoes = acoesDisponiveis(e);
      ['agendar', 'reagendar', 'cancelar', 'retirada', 'enviada', 'comprovante'].forEach(a => { $('btn-' + a).hidden = !acoes.includes(a); });
      $('btn-editar').hidden = !podeEditarEntrega(e); // concluída/cancelada não edita; o servidor também recusa
      $('btn-agendar-retirada').hidden = !acoes.includes('agendar'); // mesma regra do Agendar: só A programar
      // um primário por vez: com uma baixa disponível (retirada/enviada/comprovante), Reagendar vira secundário
      const temBaixa = ['retirada', 'enviada', 'comprovante'].some(a => acoes.includes(a));
      $('btn-reagendar').classList.toggle('btn-primary', !temBaixa);
      $('btn-reagendar').classList.toggle('btn-secondary', temBaixa);
      ajustarGruposDeAcao();
      $('d-itens').innerHTML = itens.length ? itens.map(htmlItemDetalhe).join('') : '<li class="det-vazio">Sem itens.</li>';
      $('d-eventos').innerHTML = eventos.map(v => { const x = eventoExibicao(v, e, eventos); return htmlEventoDetalhe(x.rotulo, v.quando, v.usuario, textoEvento({ ...v, motivo: x.motivo })); }).join('');
      const caixa = $('d-anexos');
      caixa.innerHTML = anexos.length ? '' : '<p class="det-vazio">Nenhum comprovante anexado a esta entrega.</p>';
      anexos.forEach(a => carregarAnexo(e.id, a, caixa));
    }

    // esconde o grupo de ações que ficou sem nenhum botão visível (por estado ou por permissão: layout.js marca .acesso-oculto)
    const visivel = b => !b.hidden && !b.classList.contains('acesso-oculto');
    function ajustarGruposDeAcao() {
      $('d-acoes-principais').hidden = ![...$('d-acoes-principais').children].some(visivel);
      $('d-acoes-secundarias').hidden = ![...$('d-acoes-secundarias').children].some(visivel);
      $('d-perigo').hidden = !visivel($('btn-cancelar'));
      $('d-acoes').hidden = $('d-acoes-principais').hidden && $('d-acoes-secundarias').hidden && $('d-perigo').hidden;
    }

    async function copiar(campo) {
      const texto = (estado.copiar || {})[campo] || '';
      if (!texto) return;
      try {
        await win.navigator.clipboard.writeText(texto);
        toast(campo === 'endereco' ? 'Endereço copiado.' : 'Contato copiado.', 'ok');
      } catch { toast('Não foi possível copiar aqui. Selecione o texto e copie.', 'erro'); }
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
        // miniatura; o clique abre a imagem inteira numa aba
        const link = doc.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener';
        link.setAttribute('aria-label', 'Abrir ' + leg.textContent + ' em tamanho real');
        const img = doc.createElement('img');
        img.src = url; img.alt = leg.textContent; img.loading = 'lazy';
        link.appendChild(img);
        fig.insertBefore(link, leg);
      } catch (err) { leg.textContent += ' — não foi possível carregar (' + err.message + ')'; }
    }

    // sempre busca de novo: um motorista criado depois que a página abriu precisa aparecer sem recarregar
    async function garantirMotoristas() {
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
      $('rot-data').textContent = t === 'retirada' ? 'Data da retirada (marcada pelo cliente)' : 'Data';
    }
    // tipoInicial = 'retirada' abre o formulário já como "Agendar retirada" (o cliente marcou o dia para vir buscar)
    async function abrirFormAgendar(reagendar, tipoInicial) {
      await garantirMotoristas();
      const e = estado.det.entrega;
      estado.reagendando = reagendar;
      $('ag-titulo').textContent = (reagendar ? 'Reagendar' : tipoInicial === 'retirada' ? 'Agendar retirada' : 'Agendar') + ` — pedido ${e.numero}`;
      $('f-motorista').innerHTML = '<option value="">' + (estado.motoristas.length ? 'Escolha…' : 'Nenhum motorista com permissão de baixa') + '</option>' + estado.motoristas.map(m => `<option value="${esc(m.codigo)}">${esc(m.nome)}</option>`).join('');
      $('f-tipo').value = (!reagendar && tipoInicial) || e.tipo || '';
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
    // busca o CEP no ViaCEP e preenche rua, bairro, cidade e UF (número e referência continuam com quem agenda)
    async function buscarCep() {
      const cep = cepLimpo($('f-cep').value);
      if (cep.length !== 8) { toast('Informe um CEP com 8 números.', 'erro'); return; }
      const botao = $('btn-cep');
      botao.disabled = true;
      try {
        const r = await win.fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const e = enderecoDoViaCep(await r.json());
        if (!e) { toast('CEP não encontrado.', 'erro'); return; }
        $('f-rua').value = e.rua; $('f-bairro').value = e.bairro; $('f-cidade').value = e.cidade; $('f-uf').value = e.uf;
        $('f-numero').focus();
      } catch { toast('Não foi possível consultar o CEP agora.', 'erro'); }
      finally { botao.disabled = false; }
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

    // ---------- Criar entrega (pedido Pronto ou Em Produção sem entrega) ----------
    function enviarCriar() {
      const numero = txt($('cr-numero').value);
      if (!/^[0-9]{1,10}$/.test(numero) || Number(numero) < 1) { $('erro-criar').textContent = 'Informe o número do pedido (somente dígitos).'; return; }
      $('erro-criar').textContent = '';
      return ocupado(async () => {
        let r;
        try { r = await chamar(`/entregas/pedido/${encodeURIComponent(numero)}/criar`, { metodo: 'POST', corpo: {} }); } catch (err) {
          // pedido que já tem entrega: abre a existente em vez de só avisar
          await carregar();
          const alvo = entregaParaAbrir(entregasDoPedido(estado.lista, numero));
          if (alvo && /já tem entrega/.test(err.message || '')) { toast(`O pedido ${numero} já tem entrega: aberta ao lado.`, 'ok'); await abrirDetalhe(alvo.id); return; }
          $('erro-criar').textContent = err.message; return;
        }
        toast(`Entrega criada para o pedido ${numero}.`, 'ok');
        await carregar();
        if (r && r.entrega) await abrirDetalhe(r.entrega.id); else mostrar('vazio-painel');
      });
    }

    // ---------- Editar entrega ----------
    function abrirEditar() {
      const det = estado.det;
      if (!det || !podeEditarEntrega(det.entrega) || !win.EntregaEditar) return;
      const e = det.entrega, id = e.id;
      win.EntregaEditar.abrir(win, {
        entrega: { ...e, rotuloSequencia: rotuloSequencia(det.divisao) }, motoristas: estado.motoristas || [], motoristaNome: nomeMotorista(e, estado.motoristas),
        salvar: async corpo => {
          await chamar(`/entregas/${encodeURIComponent(id)}`, { metodo: 'PUT', corpo });
          toast('Entrega atualizada.', 'ok');
          await recarregarTudo(id);
        }
      });
    }

    // ---------- Menu do botão direito / Shift+F10 / "⋯" (só consulta e fiscalização: nada altera pedido ou entrega) ----------
    const pode = c => !!(win.Acesso && win.Acesso.pode(c));
    const tokenAtual = () => (getAuth() || {}).token || '';
    let menu = null, origemMenu = null;
    function fecharMenu(devolverFoco) {
      if (menu) { menu.remove(); menu = null; }
      doc.querySelectorAll('tr.ctx').forEach(r => r.classList.remove('ctx'));
      if (devolverFoco && origemMenu && origemMenu.isConnected) origemMenu.focus({ preventScroll: true });
      origemMenu = null;
    }
    const entregaDoId = id => estado.lista.find(x => String(x.id) === String(id)) || (estado.det && String(estado.det.entrega.id) === String(id) ? estado.det.entrega : null);
    // detalhe da entrega (endereço, contato, código do cliente): o que já está aberto ou uma leitura nova
    async function detalheDe(id) {
      if (estado.det && String(estado.det.entrega.id) === String(id)) return estado.det;
      return chamar(`/entregas/${encodeURIComponent(id)}`);
    }
    async function copiarTexto(texto, vazio, ok) {
      if (!txt(texto)) { toast(vazio, 'info'); return; }
      try { await win.navigator.clipboard.writeText(texto); toast(ok, 'ok'); } catch { toast('Não foi possível copiar aqui. Selecione o texto e copie.', 'erro'); }
    }
    async function executarMenu(it, e, origem) {
      const n = e.numero, enc = encodeURIComponent, api = C.API_BASE;
      const pdf = url => win.abrirPdfAutenticado(url);
      switch (it.id) {
        case 'detalhe': return ocupado(() => abrirDetalhe(e.id));
        case 'linha_tempo': return ocupado(async () => { await abrirDetalhe(e.id); const el = $('d-eventos'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); });
        case 'pdf_pedido': return pdf(`${api}/dados_pdf?numero=${enc(n)}&tipo=Pedido`);
        case 'pdf_producao': return pdf(`${api}/dados_pdf?numero=${enc(n)}&tipo=Pedido&producao=1`);
        case 'pdf_vidros': return pdf(`${api}/dados_pdf_vidros?numero=${enc(n)}`);
        case 'danfe': return win.DanfePedido && win.DanfePedido.abrir(n, { apiBase: api, loginUrl: C.LOGIN_URL, token: tokenAtual, pode });
        case 'checklist': return estado.checklist && estado.checklist.abrir(e.id, origem);
        case 'historico_pedido': return win.HistoricoPedido && win.HistoricoPedido.abrir({ numero: n, apiBase: api, loginUrl: C.LOGIN_URL, token: tokenAtual });
        case 'etapas': win.location.href = `etapas_producao.html?busca=${enc(n)}`; return undefined;
        case 'financeiro_cliente': return ocupado(async () => {
          const d = await detalheDe(e.id);
          if (!d.clienteCodigo) { toast('Não encontrei o cadastro deste cliente.', 'info'); return; }
          win.location.href = `clientes.html?abrir=${enc(d.clienteCodigo)}&aba=financeiro`;
        });
        case 'copiar_endereco': return ocupado(async () => { const d = await detalheDe(e.id); await copiarTexto(enderecoTexto(d.entrega), 'Esta entrega não tem endereço.', 'Endereço copiado.'); });
        case 'copiar_contato': return ocupado(async () => { const d = await detalheDe(e.id); await copiarTexto(d.entrega.contatoLocal, 'Esta entrega não tem contato no local.', 'Contato copiado.'); });
        case 'ligar': return ocupado(async () => {
          const d = await detalheDe(e.id);
          const tel = linkLigar(d.entrega.contatoLocal) || linkLigar((d.clienteEndereco || {}).telefone);
          if (!tel) { toast('Não há telefone nesta entrega nem no cadastro do cliente.', 'info'); return; }
          win.location.href = tel;
        });
        default: return undefined;
      }
    }
    function abrirMenu(el, x, y) {
      const id = el.getAttribute('data-id') || el.getAttribute('data-mais') || (estado.det && estado.det.entrega.id);
      const e = entregaDoId(id);
      if (!e) return;
      const itens = itensMenuEntrega(e, pode);
      if (!itens.length) return;
      fecharMenu();
      const m = doc.createElement('div');
      m.id = 'ent-menu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', `Consultar a entrega do pedido ${e.numero}`);
      m.innerHTML = `<div class="mc-cab">Pedido nº ${esc(e.numero)}${e.cliente ? ' · ' + esc(e.cliente) : ''}${rotuloSequencia(e) ? ' · ' + esc(rotuloSequencia(e)) : ''}</div>` + itens.map((it, i) => it.sep
        ? '<div class="mc-sep" role="separator"></div>'
        : `<button type="button" role="menuitem" data-i="${i}"><span class="mc-ic">${esc(it.icone)}</span>${esc(it.rotulo)}</button>`).join('');
      m.addEventListener('click', ev => {
        const b = ev.target.closest('button[data-i]'); if (!b) return;
        const it = itens[Number(b.dataset.i)], origem = origemMenu;
        fecharMenu(false);
        if (it) Promise.resolve(executarMenu(it, e, origem)).catch(err => toast(err.message, 'erro'));
      });
      m.addEventListener('keydown', ev => {
        const bs = [...m.querySelectorAll('button')], i = bs.indexOf(doc.activeElement);
        if (ev.key === 'Escape') { ev.preventDefault(); fecharMenu(true); }
        else if (ev.key === 'ArrowDown') { ev.preventDefault(); bs[(i + 1) % bs.length].focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
        else if (ev.key === 'Home') { ev.preventDefault(); bs[0].focus(); }
        else if (ev.key === 'End') { ev.preventDefault(); bs[bs.length - 1].focus(); }
        else if (ev.key === 'Tab') { ev.preventDefault(); fecharMenu(true); }
      });
      doc.body.appendChild(m);
      menu = m; origemMenu = el;
      const linha = el.closest('tr'); if (linha) linha.classList.add('ctx');
      const r = el.getBoundingClientRect();
      const px = x ?? r.left, py = y ?? r.bottom;
      m.style.left = Math.max(8, Math.min(px, win.innerWidth - m.offsetWidth - 8)) + 'px';
      m.style.top = Math.max(8, Math.min(py, win.innerHeight - m.offsetHeight - 8)) + 'px';
      const primeiro = m.querySelector('button');
      if (primeiro) primeiro.focus({ preventScroll: true });
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

    // ---------- Separar em outra entrega / Gerar entrega do restante ----------
    function abrirSeparar(restante) {
      const det = estado.det;
      const r = restante ? restanteDaOcorrencia(det.itensDetalhe, det.eventos) : { inferido: false, linhas: linhasSeparacao(det.itensDetalhe) };
      estado.separar = { linhas: r.linhas };
      $('sp-titulo').textContent = (restante ? 'Gerar entrega do restante' : 'Separar em outra entrega') + ` — pedido ${det.entrega.numero}`;
      $('sp-ajuda').textContent = restante
        ? (r.inferido ? 'Já preenchido com o que o motorista NÃO entregou. Confira e confirme: vai para uma entrega nova, A programar.'
          : 'Não deu para saber pelo relato do motorista o que faltou: marque a quantidade de cada item que vai para a entrega nova.')
        : 'Marque a quantidade de cada item que vai para a entrega nova (A programar, sem data nem motorista). O resto fica nesta entrega.';
      $('sp-itens').innerHTML = r.linhas.map(htmlCartaoSeparacao).join('') || '<li class="cinza">Esta entrega não tem itens.</li>';
      $('sp-obs').value = '';
      $('erro-separar').textContent = '';
      mostrar('vista-separar');
      atualizarSeparacao();
    }
    // lê os cartões: quantidade e observação de cada item (a observação só conta se o item tem quantidade)
    const lerLinhasSeparacao = () => estado.separar.linhas.map((l, k) => ({ ...l, separar: lerNumero($(`sp-item-${k}`).value), observacao: '' }));
    // reflete o que foi digitado: cartão marcado, campo de observação, passos, resumo (aria-live) e o botão Separar
    function atualizarSeparacao() {
      if (!estado.separar) return;
      const linhas = lerLinhasSeparacao();
      linhas.forEach((l, k) => {
        const marcado = Number.isFinite(l.separar) && l.separar > TOL;
        $(`sp-cartao-${k}`).classList.toggle('sep-ativo', marcado);
        $(`sp-menos-${k}`).disabled = !marcado;
        $(`sp-mais-${k}`).disabled = Number.isFinite(l.separar) && l.separar >= l.qtd - TOL;
      });
      const r = resumoSeparacao(linhas);
      $('sp-resumo-texto').textContent = r.texto;
      $('sp-aviso').textContent = r.aviso;
      $('sp-aviso').hidden = !r.aviso;
      $('btn-confirmar-separar').disabled = !r.podeEnviar;
    }
    // botões − / + / Todos e digitação dentro dos cartões (delegação: os cartões são refeitos a cada abertura)
    function mexerNoCartao(ev) {
      const b = ev.target.closest && ev.target.closest('button[data-acao]');
      if (!b || !estado.separar) return;
      const k = Number(b.getAttribute('data-linha'));
      const l = estado.separar.linhas[k];
      const campo = $(`sp-item-${k}`);
      if (!l || !campo) return;
      const atual = lerNumero(campo.value);
      const acao = b.getAttribute('data-acao');
      const novo = acao === 'todos' ? l.qtd : ajustarQuantidade(atual, acao === 'mais' ? 1 : -1, l.qtd, passoDe(l.qtd));
      campo.value = String(novo);
      atualizarSeparacao();
      campo.focus();
    }
    function enviarSeparar() {
      const linhas = lerLinhasSeparacao();
      const erros = validarSeparacao(linhas);
      $('erro-separar').textContent = erros.join(' ');
      if (erros.length) return;
      const e = estado.det.entrega;
      return ocupado(async () => {
        try {
          await chamar(`/entregas/${encodeURIComponent(e.id)}/separar`, { metodo: 'POST', corpo: corpoSeparar(linhas, $('sp-obs').value) });
        } catch (err) { $('erro-separar').textContent = err.message; return; }
        toast('Entrega separada: a nova está em A programar.', 'ok');
        await recarregarTudo(e.id);
      });
    }

    // ---------- Saldo a entregar: gerar entrega / encerrar ----------
    function gerarSobra(numero) {
      if (!win.confirm(`Criar uma entrega nova (A programar) com os itens sem entrega do pedido ${numero}?`)) return;
      return ocupado(async () => {
        await chamar(`/entregas/pedido/${encodeURIComponent(numero)}/saldo`, { metodo: 'POST', corpo: {} });
        toast('Entrega do saldo criada em A programar.', 'ok');
        await carregar();
      });
    }
    function abrirEncerrar(numero) {
      const s = estado.sobras.find(x => String(x.numero) === String(numero));
      if (!s) return;
      estado.sobraAlvo = s.numero;
      $('en-titulo').textContent = `Encerrar saldo — pedido ${s.numero}`;
      $('en-itens').innerHTML = (s.itensSemEntrega || []).map(i => `<li>${esc(i.descricao)} <span class="cinza">× ${esc(String(i.qtd).replace('.', ','))}</span></li>`).join('');
      $('en-motivo').value = '';
      $('erro-encerrar').textContent = '';
      mostrar('vista-encerrar');
    }
    function enviarEncerrar() {
      const motivo = $('en-motivo').value;
      const erro = validarCancelamento(motivo);
      $('erro-encerrar').textContent = erro || '';
      if (erro || !estado.sobraAlvo) return;
      const numero = estado.sobraAlvo;
      return ocupado(async () => {
        let r;
        try {
          r = await chamar(`/entregas/pedido/${encodeURIComponent(numero)}/saldo/encerrar`, { metodo: 'POST', corpo: { motivo: txt(motivo) } });
        } catch (err) { $('erro-encerrar').textContent = err.message; return; }
        toast(r && r.pedidoFechado ? `Saldo encerrado. O pedido ${numero} foi marcado como ${r.situacao}.` : 'Saldo encerrado.', 'ok');
        estado.sobraAlvo = null;
        await carregar();
        if (estado.det) await abrirDetalhe(estado.det.entrega.id); else mostrar('vazio-painel');
      });
    }

    // Botão "Atualizar": só por clique (nenhum timer). GET /entregas já roda a varredura (sincronizarFila) antes de montar a lista,
    // o mesmo caminho da abertura da tela. Aba e busca ficam; o detalhe aberto é relido (ou fechado se a entrega sumiu).
    async function atualizar() {
      if (estado.atualizando || estado.carregando) return;
      estado.atualizando = true;
      const btn = $('btn-atualizar'), rot = btn.querySelector('.rot');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true'); rot.textContent = 'Atualizando...';
      try {
        await carregar();
        if (estado.det) {
          const id = estado.det.entrega.id;
          try { await abrirDetalhe(id); } catch (err) { estado.det = null; mostrar('vazio-painel'); desenharLista(); toast(err.message, 'erro'); }
        }
      } finally {
        estado.atualizando = false;
        btn.disabled = false; btn.removeAttribute('aria-busy'); rot.textContent = 'Atualizar';
      }
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
      doc.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => { estado.aba = b.getAttribute('data-aba'); estado.pedidoFiltro = ''; desenharLista(); }));
      $('btn-atualizar').addEventListener('click', atualizar);
      $('btn-criar-entrega').addEventListener('click', () => abrirForm('vista-criar', ['cr-numero']));
      $('busca').addEventListener('input', ev => { estado.busca = ev.target.value.trim(); desenharLista(); });
      $('lista').addEventListener('click', ev => {
        if (ev.target.closest('[data-limpar-pedido]')) { estado.pedidoFiltro = ''; desenharLista(); return; }
        const sobra = ev.target.closest('button[data-sobra]');
        if (sobra) {
          const numero = sobra.getAttribute('data-numero');
          if (sobra.getAttribute('data-sobra') === 'gerar') gerarSobra(numero); else abrirEncerrar(numero);
          return;
        }
        const maisBtn = ev.target.closest('[data-mais]');
        if (maisBtn) { abrirMenu(maisBtn); return; }
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
          if (botao) {
            const acao = botao.getAttribute('data-acao');
            await abrirFormAgendar(acao === 'reagendar', acao === 'agendar-retirada' ? 'retirada' : undefined);
          }
        });
      });
      $('btn-agendar').addEventListener('click', () => ocupado(() => abrirFormAgendar(false)));
      $('btn-agendar-retirada').addEventListener('click', () => ocupado(() => abrirFormAgendar(false, 'retirada')));
      $('btn-reagendar').addEventListener('click', () => ocupado(() => abrirFormAgendar(true)));
      $('btn-editar').addEventListener('click', () => ocupado(async () => { await garantirMotoristas(); abrirEditar(); }));
      $('btn-mais').addEventListener('click', ev => abrirMenu(ev.currentTarget));
      // botão direito (e Shift+F10 / tecla de menu, que disparam "contextmenu" no item focado) nas linhas e nos cartões do calendário
      $('lista').addEventListener('contextmenu', ev => {
        const alvo = ev.target.closest('[data-mais], tr[data-id], .etiqueta[data-id]');
        if (!alvo) return;
        ev.preventDefault();
        const teclado = ev.clientX === 0 && ev.clientY === 0;
        abrirMenu(alvo, teclado ? undefined : ev.clientX, teclado ? undefined : ev.clientY);
      });
      doc.addEventListener('mousedown', ev => { if (menu && !menu.contains(ev.target)) fecharMenu(false); });
      win.addEventListener('resize', () => fecharMenu(false));
      win.addEventListener('scroll', ev => { if (menu && !(ev.target && ev.target.nodeType === 1 && menu.contains(ev.target))) fecharMenu(false); }, true);
      $('btn-cancelar').addEventListener('click', () => {
        abrirForm('vista-cancelar', ['c-motivo']);
        $('c-titulo').textContent = `Cancelar entrega — pedido ${estado.det.entrega.numero}`;
        $('c-aviso').textContent = avisoCancelamento(estado.det);
        $('c-motivo').focus();
      });
      $('d-info').addEventListener('click', ev => { const b = ev.target.closest('[data-copiar]'); if (b) copiar(b.getAttribute('data-copiar')); });
      // Checklist externo de entrega (janela com os campos; o PDF é gerado no servidor)
      const checklist = estado.checklist = win.EntregaChecklist && win.EntregaChecklist.iniciarJanela(win, {
        apiBase: C.API_BASE, loginUrl: C.LOGIN_URL, token: () => (getAuth() || {}).token || '', chamar, toast,
        podeEditar: () => !!(win.Acesso && win.Acesso.pode('entregas.programar'))
      });
      $('btn-checklist').addEventListener('click', ev => { if (checklist && estado.det) checklist.abrir(estado.det.entrega.id, ev.currentTarget); });
      $('btn-folha-branco').addEventListener('click', () => { if (checklist) checklist.abrirBranco(); });
      $('btn-retirada').addEventListener('click', () => abrirForm('vista-retirada', ['r-entregue', 'r-foto']));
      $('btn-enviada').addEventListener('click', () => {
        abrirForm('vista-enviada', ['e-transp', 'e-rastreio', 'e-previsao']);
        $('e-transp').value = estado.det.entrega.transportadora || '';
      });
      $('btn-comprovante').addEventListener('click', () => abrirForm('vista-comprovante', ['k-entregue', 'k-foto']));
      $('btn-separar').addEventListener('click', () => abrirSeparar(false));
      $('btn-restante').addEventListener('click', () => abrirSeparar(true));
      $('sp-itens').addEventListener('click', mexerNoCartao);
      $('sp-itens').addEventListener('input', atualizarSeparacao);
      $('f-tipo').addEventListener('change', ajustarCamposTipo);
      $('btn-usar-endereco').addEventListener('click', usarEnderecoCliente);
      $('btn-cep').addEventListener('click', buscarCep);
      $('f-cep').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); buscarCep(); } });
      doc.querySelectorAll('.voltar').forEach(b => b.addEventListener('click', () => { if (estado.det) mostrar('vista-detalhe'); else mostrar('vazio-painel'); }));
      const envio = (id, fn) => $(id).addEventListener('submit', ev => { ev.preventDefault(); fn(); });
      envio('vista-agendar', enviarAgendar);
      envio('vista-cancelar', enviarCancelar);
      envio('vista-criar', enviarCriar);
      envio('vista-retirada', enviarRetirada);
      envio('vista-enviada', enviarEnviada);
      envio('vista-comprovante', enviarComprovante);
      envio('vista-separar', enviarSeparar);
      envio('vista-encerrar', enviarEncerrar);
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
    // vindo do menu do pedido ("Programar entrega"): abre o formulário de criar já com o número preenchido
    let abriuCriar = false;
    try {
      const criar = (new win.URLSearchParams(win.location.search).get('criar') || '').trim();
      if (/^\d{1,10}$/.test(criar) && $('btn-criar-entrega')) { abrirForm('vista-criar', ['cr-numero']); $('cr-numero').value = criar; abriuCriar = true; }
    } catch { /* sem query */ }
    // não esconde o formulário de criar que acabou de abrir (vindo do menu "Programar entrega")
    if (!abriuCriar) mostrar('vazio-painel');
    carregar().then(async () => {
      // se o pedido do menu já tem entrega, abre ela em vez de oferecer criar outra
      if (!abriuCriar) return;
      const alvo = entregaParaAbrir(entregasDoPedido(estado.lista, $('cr-numero').value));
      if (alvo) { try { await abrirDetalhe(alvo.id); } catch { /* fica no formulário */ } }
    });
  }

  return { MENU_ENTREGA, itensMenuEntrega, podeEditarEntrega, resumoEdicao, statusDaEntrega, ABAS, esc, dataValida, dataBR, dataHoraBR, rotuloStatus, corStatus, rotuloTipo, rotuloEvento, eventoExibicao, filtrarAba, contadores, agruparAgenda, montarMes, abaDoStatus, acoesDisponiveis,
    validarAgendamento, corpoAgendar, corpoReagendar, enderecoDoCliente, enderecoDoViaCep, cepLimpo, validarRetirada, validarEnviada, validarComprovante, validarCancelamento, escalaImagem,
    rotuloSequencia, lerNumero, linhasSeparacao, restanteDaOcorrencia, podeGerarRestante, validarSeparacao, corpoSeparar, fichaDoItem, passoDe, ajustarQuantidade, resumoSeparacao, htmlCartaoSeparacao, entregasDoPedido, entregaParaAbrir, filtrarSobras, textoItens, nomeMotorista, rotuloItem,
    linkLigar, htmlItemDetalhe, htmlEventoDetalhe, avisoCancelamento, iniciar };
});
