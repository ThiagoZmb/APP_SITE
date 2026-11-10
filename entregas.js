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
  const { esc, txt, dataValida, dataBR, dataHoraBR, escalaImagem, rotuloSequencia } = C;

  // ============ LÓGICA PURA ============
  const ROTULO_STATUS = { a_programar: 'A programar', agendada: 'Agendada', em_rota: 'Em rota', ocorrencia: 'Ocorrência', entregue: 'Entregue',
    retirado: 'Retirado', enviada: 'Enviada', cancelada: 'Cancelada', encerrada: 'Encerrada', suspensa: 'Suspensa' };
  const COR_STATUS = { a_programar: 'aviso', agendada: 'info', em_rota: 'info', ocorrencia: 'perigo', entregue: 'ok', retirado: 'ok', enviada: 'info', cancelada: 'neutro', encerrada: 'neutro', suspensa: 'aviso' };
  const ROTULO_TIPO = { motorista: 'Entrega', retirada: 'Retirado pelo cliente', outro_estado: 'Entrega em outro estado' };
  const ROTULO_EVENTO = { criada: 'Entrou na fila', agendada: 'Agendada', reagendada: 'Reagendada', saiu: 'Saiu para a entrega', entregue: 'Entregue',
    retirada: 'Retirada pelo cliente', enviada: 'Enviada', comprovante: 'Comprovante confirmado', cancelada: 'Cancelada', endereco: 'Endereço alterado',
    ausente: 'Ocorrência: cliente ausente', endereco_errado: 'Ocorrência: endereço errado', recusa: 'Ocorrência: recusa', parcial: 'Ocorrência: entrega parcial',
    dividida: 'Itens separados em outra entrega', sobra_encerrada: 'Saldo encerrado' };
  const ABAS = [
    { id: 'fila', rotulo: 'Fila', status: ['a_programar'] },
    { id: 'agenda', rotulo: 'Agenda', status: ['agendada'] },
    { id: 'em_rota', rotulo: 'Em rota', status: ['em_rota', 'enviada'] }, // enviada (outro estado) fica aqui: é onde se anexa o comprovante,
    { id: 'concluidas', rotulo: 'Concluídas', status: ['entregue', 'retirado', 'cancelada'] },
    { id: 'ocorrencias', rotulo: 'Ocorrências', status: ['ocorrencia'] }
  ];

  // aba em que a entrega com esse status aparece (usada por entregas.html?pedido=N para abrir direto na aba certa)
  const abaDoStatus = s => (ABAS.find(a => a.status.includes(s)) || {}).id || null;

  const rotuloStatus = s => ROTULO_STATUS[s] || String(s ?? '');
  const corStatus = s => COR_STATUS[s] || 'neutro';
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
    const etiquetas = f.etiquetas.map(e => `<li>${e.rotulo ? `<b>${esc(e.rotulo)}</b>` : ''}${esc(e.texto)}</li>`).join('');
    const max = esc(String(l.qtd)), disp = esc(numeroBR(l.qtd));
    return `<li class="sep-cartao" id="sp-cartao-${k}">` +
      `<div class="sep-topo"><span class="sep-nome" id="sp-nome-${k}">${nome}</span><span class="sep-numero">Item ${esc(l.item)}</span></div>` +
      (etiquetas ? `<ul class="sep-ficha" aria-label="Detalhes do item ${esc(l.item)}">${etiquetas}</ul>` : '') +
      `<p class="sep-info"><span class="sep-disp">Disponível: ${disp}</span></p>` +
      (l.obsPedido ? `<p class="sep-obsped">Obs.: ${esc(l.obsPedido)}</p>` : '') +
      `<div class="sep-qtd" role="group" aria-labelledby="sp-rot-${k}"><span class="sep-rotulo" id="sp-rot-${k}">Separar</span>` +
      `<button type="button" class="sep-passo" data-acao="menos" data-linha="${k}" id="sp-menos-${k}" aria-label="Diminuir a quantidade de ${nome}">−</button>` +
      `<input type="number" class="sep-campo" inputmode="decimal" id="sp-item-${k}" data-linha="${k}" min="0" max="${max}" step="any" value="${esc(l.separar)}" aria-label="Quantidade a separar de ${nome}, de ${disp}">` +
      `<button type="button" class="sep-passo" data-acao="mais" data-linha="${k}" id="sp-mais-${k}" aria-label="Aumentar a quantidade de ${nome}">+</button>` +
      `<span class="sep-de">de ${disp}</span>` +
      `<button type="button" class="sep-todos" data-acao="todos" data-linha="${k}" aria-label="Separar todos os ${disp} de ${nome}">Todos</button></div>` +
      `<div class="form-group sep-obs" id="sp-obsw-${k}" hidden><label for="sp-obs-${k}">Observação deste item</label>` +
      `<textarea id="sp-obs-${k}" data-linha="${k}" maxlength="${LIMITE_OBS_ITEM}" rows="2" placeholder="ex.: levar com a ferragem separada">${esc(l.observacao || '')}</textarea></div></li>`;
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
  const textoItens = itens => (Array.isArray(itens) ? itens : []).map(i => `${i.descricao} × ${numeroBR(i.qtd)}`).join('; ');

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { lista: [], aba: 'fila', busca: '', det: null, motoristas: null, urls: [], anexoEnviado: null, reagendando: false, carregando: false, mes: null, diaAberto: null,
      sobras: [], pedidoFiltro: '', sobraAlvo: null, separar: null };

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
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; estado.sobras = []; }
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
      if (aba === 'fila') resto = `<td>${esc(dataBR(e.dataPrometida))}</td><td>${selo(e.statusExibicao || e.status)}</td><td class="acao">${botaoAcao('agendar', 'Agendar')}</td>`;
      else if (aba === 'ocorrencias') resto = `<td>${esc(dataBR(e.dataAgendada))}</td><td>${esc(e.motorista || rotuloTipo(e.tipo))}</td><td>${esc(e.qtdOcorrencias)}</td><td class="acao">${botaoAcao('reagendar', 'Reagendar')}</td>`;
      else resto = `<td>${esc(dataBR(e.dataAgendada))}</td><td>${esc(e.motorista || rotuloTipo(e.tipo))}</td><td>${selo(e.statusExibicao || e.status)}</td>` +
        (aba === 'em_rota' ? `<td class="acao">${e.status === 'em_rota' ? botaoAcao('reagendar', 'Reagendar') : ''}</td>` : ''); // só em_rota: a equipe destrava; enviada segue o fluxo próprio
      return `<tr data-id="${esc(e.id)}"${estado.det && estado.det.entrega.id === e.id ? ' class="selecionado"' : ''}>${tdBase}${resto}</tr>`;
    }
    const CABECALHO = {
      fila: ['Pedido', 'Data do pedido', 'Cliente', 'Cliente final', 'Cidade/UF', 'Prometido', 'Status', ''],
      ocorrencias: ['Pedido', 'Cliente', 'Cliente final', 'Cidade/UF', 'Agendada', 'Motorista/Tipo', 'Ocorr.', ''],
      outras: ['Pedido', 'Cliente', 'Cliente final', 'Cidade/UF', 'Data', 'Motorista/Tipo', 'Status'],
      em_rota: ['Pedido', 'Cliente', 'Cliente final', 'Cidade/UF', 'Data', 'Motorista/Tipo', 'Status', '']
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
      const etiqueta = e => `<button type="button" class="etiqueta ${corStatus(e.status)}" data-id="${esc(e.id)}" title="${esc(`${e.numero}${rotuloSequencia(e) ? ' · ' + rotuloSequencia(e) : ''} — ${e.cliente || ''} (${rotuloStatus(e.status)})`)}">` +
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
    const VISTAS = ['vazio-painel', 'vista-detalhe', 'vista-agendar', 'vista-cancelar', 'vista-retirada', 'vista-enviada', 'vista-comprovante', 'vista-separar', 'vista-encerrar'];
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
      const div = estado.det.divisao || {};
      mostrar('vista-detalhe');
      const seq = rotuloSequencia(div);
      $('d-titulo').textContent = `Pedido ${e.numero}${seq ? ' · ' + seq : ''}`;
      $('d-status').innerHTML = selo(e.statusExibicao || e.status);
      // pedido editado depois da divisão: aviso fixo; a divisão fica bloqueada e o pedido não fecha sozinho na última baixa
      const avisos = [];
      if (div.alterado) avisos.push('O pedido foi alterado depois da divisão: confira os itens. Ele não vira Entregue sozinho na última baixa.');
      if (!div.alterado && Array.isArray(div.itensSemEntrega) && div.itensSemEntrega.length) avisos.push('Saldo a entregar: ' + textoItens(div.itensSemEntrega) + '.');
      $('d-aviso').textContent = avisos.join(' ');
      $('d-aviso').hidden = !avisos.length;
      $('btn-separar').hidden = !div.podeSeparar;
      $('btn-restante').hidden = !podeGerarRestante(estado.det);
      $('d-itens-titulo').textContent = div.dividido ? 'Itens desta entrega' : 'Itens do pedido';
      $('d-info').innerHTML = linhaInfo('Cliente', e.cliente) + linhaInfo('Tipo', e.tipo ? rotuloTipo(e.tipo) : '') +
        linhaInfo('Data do pedido', dataBR(e.dataPedido)) + linhaInfo('Prometido', dataBR(e.dataPrometida)) + linhaInfo('Agendada', dataBR(e.dataAgendada)) +
        linhaInfo('Motorista', (estado.motoristas || []).find(m => m.codigo === e.motoristaCodigo)?.nome || (e.motoristaCodigo ? '#' + e.motoristaCodigo : '')) +
        linhaInfo('Endereço', enderecoTexto(e)) + linhaInfo('Contato no local', e.contatoLocal) + linhaInfo('Transportadora', e.transportadora) +
        linhaInfo('Rastreio', e.rastreio) + linhaInfo('Previsão', dataBR(e.previsao)) + linhaInfo('Observação', e.observacao);
      const acoes = acoesDisponiveis(e);
      ['agendar', 'reagendar', 'cancelar', 'retirada', 'enviada', 'comprovante'].forEach(a => { $('btn-' + a).hidden = !acoes.includes(a); });
      $('d-itens').innerHTML = itens.length ? itens.map(i => `<li>${esc(i.descricao)} <span class="cinza">× ${esc(i.qtd)}</span>${i.observacao ? `<div class="cinza">Obs.: ${esc(i.observacao)}</div>` : ''}</li>`).join('') : '<li class="cinza">Sem itens.</li>';
      $('d-eventos').innerHTML = eventos.map(v => { const x = eventoExibicao(v, e, eventos); return `<li><strong>${esc(x.rotulo)}</strong> <span class="cinza">${esc(dataHoraBR(v.quando))} · ${esc(v.usuario)}</span>` +
        (textoEvento({ ...v, motivo: x.motivo }) ? `<div>${esc(textoEvento({ ...v, motivo: x.motivo }))}</div>` : '') + '</li>'; }).join('');
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
    }
    async function abrirFormAgendar(reagendar) {
      await garantirMotoristas();
      const e = estado.det.entrega;
      estado.reagendando = reagendar;
      $('ag-titulo').textContent = (reagendar ? 'Reagendar' : 'Agendar') + ` — pedido ${e.numero}`;
      $('f-motorista').innerHTML = '<option value="">' + (estado.motoristas.length ? 'Escolha…' : 'Nenhum motorista com permissão de baixa') + '</option>' + estado.motoristas.map(m => `<option value="${esc(m.codigo)}">${esc(m.nome)}</option>`).join('');
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
    const lerLinhasSeparacao = () => estado.separar.linhas.map((l, k) => ({ ...l, separar: lerNumero($(`sp-item-${k}`).value), observacao: $(`sp-obs-${k}`).value }));
    // reflete o que foi digitado: cartão marcado, campo de observação, passos, resumo (aria-live) e o botão Separar
    function atualizarSeparacao() {
      if (!estado.separar) return;
      const linhas = lerLinhasSeparacao();
      linhas.forEach((l, k) => {
        const marcado = Number.isFinite(l.separar) && l.separar > TOL;
        $(`sp-cartao-${k}`).classList.toggle('sep-ativo', marcado);
        $(`sp-obsw-${k}`).hidden = !marcado;
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
        toast('Entrega separada: a nova está na fila, A programar.', 'ok');
        await recarregarTudo(e.id);
      });
    }

    // ---------- Saldo a entregar: gerar entrega / encerrar ----------
    function gerarSobra(numero) {
      if (!win.confirm(`Criar uma entrega nova (A programar) com os itens sem entrega do pedido ${numero}?`)) return;
      return ocupado(async () => {
        await chamar(`/entregas/pedido/${encodeURIComponent(numero)}/saldo`, { metodo: 'POST', corpo: {} });
        toast('Entrega do saldo criada na fila.', 'ok');
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
      $('busca').addEventListener('input', ev => { estado.busca = ev.target.value.trim(); desenharLista(); });
      $('lista').addEventListener('click', ev => {
        if (ev.target.closest('[data-limpar-pedido]')) { estado.pedidoFiltro = ''; desenharLista(); return; }
        const sobra = ev.target.closest('button[data-sobra]');
        if (sobra) {
          const numero = sobra.getAttribute('data-numero');
          if (sobra.getAttribute('data-sobra') === 'gerar') gerarSobra(numero); else abrirEncerrar(numero);
          return;
        }
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
    mostrar('vazio-painel');
    carregar();
  }

  return { ABAS, esc, dataValida, dataBR, dataHoraBR, rotuloStatus, corStatus, rotuloTipo, rotuloEvento, eventoExibicao, filtrarAba, contadores, agruparAgenda, montarMes, abaDoStatus, acoesDisponiveis,
    validarAgendamento, corpoAgendar, corpoReagendar, enderecoDoCliente, enderecoDoViaCep, cepLimpo, validarRetirada, validarEnviada, validarComprovante, validarCancelamento, escalaImagem,
    rotuloSequencia, lerNumero, linhasSeparacao, restanteDaOcorrencia, podeGerarRestante, validarSeparacao, corpoSeparar, fichaDoItem, passoDe, ajustarQuantidade, resumoSeparacao, htmlCartaoSeparacao, entregasDoPedido, entregaParaAbrir, filtrarSobras, textoItens, iniciar };
});
