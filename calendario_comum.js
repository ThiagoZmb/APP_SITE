// ==========================================================================
// Helpers compartilhados das telas do calendário de pedidos (calendario.html = mês, calendario_dia.html = um dia).
// Funções puras (testadas no Node, test/calendario_tela.test.js) e a ligação do menu do botão direito (InicioMenu).
// Dado vindo da API só entra na tela por esc() ou textContent. O valor (dinheiro) só aparece se a API o mandou (valores.ver).
// Regras: docs/regras/calendario-pedidos.md
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.CalendarioComum = lib;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  // esc, dataBR, dataValida, criarApi e criarToast vêm de entregas_comum.js (carregado antes no navegador)
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, dataBR, dataValida } = C;

  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const DIAS_EXTENSO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const SITUACOES = [{ id: 'abertos', rotulo: 'Em aberto' }, { id: 'todos', rotulo: 'Todos' }];
  // classe do pedido (calculo/calendario.js) -> cor do selo (selo-*-bg/fg do tema.css) e texto curto
  const COR_CLASSE = { producao: 'info', pronto: 'ok', entregue: 'ok', retirado: 'ok', cancelado: 'neutro', outro: 'aviso' };
  const SIGLA_CLASSE = { producao: 'Produção', pronto: 'Pronto', entregue: 'Entregue', retirado: 'Retirado', cancelado: 'Cancelado', outro: '' };
  const MAX_ETIQUETAS = 8;   // etiquetas por dia na grade; o resto vira "+N mais" (a célula cresce na vertical)
  const VISOES = [{ id: 'grade', rotulo: 'Calendário' }, { id: 'lista', rotulo: 'Lista' }];

  const dois = n => String(n).padStart(2, '0');
  const isoUTC = d => `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
  const situacaoValida = v => (SITUACOES.some(s => s.id === v) ? v : 'abertos');
  const visaoValida = v => (VISOES.some(s => s.id === v) ? v : 'grade');

  // ---------- datas ----------
  const mesValido = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v ?? ''));
  const mesDe = iso => String(iso ?? '').slice(0, 7);
  function somarMeses(chave, n) { // 'AAAA-MM' + n meses (vira o ano)
    const [a, m] = chave.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}`;
  }
  function somarDias(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    return isoUTC(new Date(Date.UTC(a, m - 1, d + n)));
  }
  const nomeMes = chave => `${MESES[Number(chave.slice(5, 7)) - 1]} de ${chave.slice(0, 4)}`;
  function dataExtenso(iso) { // 'quinta-feira, 5 de novembro de 2026'
    const [a, m, d] = iso.split('-').map(Number);
    return `${DIAS_EXTENSO[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]}, ${d} de ${MESES[m - 1].toLowerCase()} de ${a}`;
  }
  function hojeISO(win) {
    const d = new win.Date();
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  }

  // ---------- grade do mês ----------
  // Semanas (domingo a sábado) que cobrem o mês `chave` ('AAAA-MM'). Célula: { dia, num, doMes, hoje, qtdPedidos, qtdAtrasados, pedidos }.
  // `dias` = [{ data, qtdPedidos, qtdAtrasados, pedidos }] como a API devolve. Dias de outros meses ficam vazios.
  function montarGrade(dias, chave, hoje) {
    const porDia = new Map((Array.isArray(dias) ? dias : []).map(d => [d.data, d]));
    const [ano, mes] = chave.split('-').map(Number);
    const inicio = new Date(Date.UTC(ano, mes - 1, 1 - new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay()));
    const ultimo = new Date(Date.UTC(ano, mes, 0));
    const semanas = [];
    for (let d = new Date(inicio); d <= ultimo || d.getUTCDay() !== 0; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 0) semanas.push([]);
      const dia = isoUTC(d), doMes = d.getUTCMonth() === mes - 1, dado = doMes ? porDia.get(dia) : null;
      semanas[semanas.length - 1].push({ dia, num: d.getUTCDate(), doMes, hoje: dia === hoje,
        qtdPedidos: dado ? dado.qtdPedidos : 0, qtdAtrasados: dado ? dado.qtdAtrasados : 0, pedidos: dado ? dado.pedidos : [] });
    }
    return semanas;
  }

  // ---------- textos e HTML ----------
  function abreviar(nome, max = 16) {
    const t = String(nome ?? '').trim().replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
  }
  const moeda = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const urlDia = (data, situacao) => `calendario_dia.html?data=${encodeURIComponent(data)}&situacao=${encodeURIComponent(situacao)}`;
  const urlMes = (mes, situacao, visao) => `calendario.html?mes=${encodeURIComponent(mes)}&situacao=${encodeURIComponent(situacao)}${visao === 'lista' ? '&visao=lista' : ''}`;
  const rotuloPedido = p => `Pedido ${p.numero}, ${p.cliente || 'sem cliente'}, ${p.situacao || 'sem situação'}${p.atrasado ? ', atrasado' : ''}`;
  const ITENS_DOC = [['comPerfil', '📏', 'Perfil'], ['comVidro', '🔷', 'Vidro'], ['comSerralheria', '🔩', 'Serralheria'], ['comPintura', '🎨', 'Pintura']];
  const iconesItens = p => {
    const tem = ITENS_DOC.filter(([chave]) => p[chave]);
    return tem.length ? ` <span class="itens-doc" role="img" aria-label="Contém: ${tem.map(t => t[2]).join(', ')}">${tem.map(([, icone, nome]) => `<span class="item-doc" title="${nome}">${icone}</span>`).join('')}</span>` : '';
  };

  // Etiqueta do pedido no calendário (classe etq: "chip" já é do tema.css). É um <li data-numero> focável: o InicioMenu abre o menu pelo botão direito, pela tecla de menu e por Shift+F10.
  function htmlEtiqueta(p, situacao) {
    const sit = situacao === 'todos' && SIGLA_CLASSE[p.classe] ? ` <span class="etq-sit">${esc(SIGLA_CLASSE[p.classe])}</span>` : '';
    return `<li class="etq ${COR_CLASSE[p.classe] || 'aviso'}${p.atrasado ? ' atraso' : ''}" data-numero="${esc(p.numero)}" tabindex="0" title="${esc(rotuloPedido(p))}" aria-label="${esc(rotuloPedido(p))}">` +
      `<span class="etq-num">#${esc(p.numero)}</span> <span class="etq-cli">${esc(abreviar(p.cliente))}</span>${iconesItens(p)}${sit}` +
      (p.atrasado ? ' <span class="etq-atraso">Atrasado</span>' : '') + '</li>';
  }
  function htmlCelula(c, situacao) {
    const vistos = c.pedidos.slice(0, MAX_ETIQUETAS), mais = c.pedidos.length - vistos.length;
    const rotulo = `${dataBR(c.dia)}${c.qtdPedidos ? `: ${c.qtdPedidos} pedido(s)${c.qtdAtrasados ? `, ${c.qtdAtrasados} atrasado(s)` : ''}` : ''}`;
    return `<div class="cel${c.doMes ? '' : ' fora'}${c.hoje ? ' hoje' : ''}"${c.doMes ? ` data-dia="${esc(c.dia)}"` : ''}>` +
      (c.doMes ? `<a class="num" href="${esc(urlDia(c.dia, situacao))}" aria-label="${esc(rotulo)}"${c.hoje ? ' aria-current="date"' : ''}>${c.num}</a>` : `<span class="num">${c.num}</span>`) +
      (vistos.length ? `<ul class="etqs">${vistos.map(p => htmlEtiqueta(p, situacao)).join('')}</ul>` : '') +
      (mais > 0 ? `<a class="mais" href="${esc(urlDia(c.dia, situacao))}">+${mais} mais</a>` : '') + '</div>';
  }
  function htmlGrade(semanas, situacao) {
    return `<div class="cal"><div class="cal-sem">${DIAS_SEMANA.map(d => `<span>${d}</span>`).join('')}</div>` +
      semanas.map(sem => `<div class="cal-linha">${sem.map(c => htmlCelula(c, situacao)).join('')}</div>`).join('') + '</div>';
  }
  // Celular: em vez da grade, uma lista só dos dias que têm pedido
  function htmlListaDias(semanas, situacao) {
    const dias = semanas.flat().filter(c => c.doMes && c.pedidos.length);
    if (!dias.length) return '<p class="vazio">Nenhum pedido previsto neste mês.</p>';
    return dias.map(c => `<section class="dia-lista${c.hoje ? ' hoje' : ''}"><h3><a href="${esc(urlDia(c.dia, situacao))}">${esc(DIAS_SEMANA[new Date(c.dia + 'T00:00:00Z').getUTCDay()])}, ${esc(dataBR(c.dia).slice(0, 5))}</a>` +
      `<span class="cinza">${c.qtdPedidos} pedido(s)${c.qtdAtrasados ? ` · ${c.qtdAtrasados} atrasado(s)` : ''}</span></h3>` +
      `<ul class="etqs">${c.pedidos.map(p => htmlEtiqueta(p, situacao)).join('')}</ul></section>`).join('');
  }
  // Visão em lista, como a folha de papel da produção: cada dia com pedido vira um bloco (data e dia da semana) e uma linha por pedido
  // "P 23392 - Cliente | Cliente final". A linha é <li data-numero>: o menu do botão direito funciona como no calendário.
  function htmlLinhaFolha(p, situacao) {
    const sit = situacao === 'todos' && SIGLA_CLASSE[p.classe] ? ` <span class="folha-sit">(${esc(SIGLA_CLASSE[p.classe])})</span>` : '';
    return `<li class="folha-linha${p.atrasado ? ' atraso' : ''}" data-numero="${esc(p.numero)}" tabindex="0" title="${esc(rotuloPedido(p))}" aria-label="${esc(rotuloPedido(p))}">` +
      `<span class="folha-p">P ${esc(p.numero)}</span> - <span class="folha-cli">${esc(p.cliente || '—')}</span>${p.clienteFinal ? ` | <span class="folha-final">${esc(p.clienteFinal)}</span>` : ''}${iconesItens(p)}${sit}` +
      (p.atrasado ? ' <span class="folha-atraso">Atrasado</span>' : '') + '</li>';
  }
  function htmlFolha(semanas, situacao) {
    const dias = semanas.flat().filter(c => c.doMes && c.pedidos.length);
    if (!dias.length) return '<p class="vazio">Nenhum pedido previsto neste mês.</p>';
    return dias.map(c => `<section class="folha-dia${c.hoje ? ' hoje' : ''}"><h3><a href="${esc(urlDia(c.dia, situacao))}">${esc(dataBR(c.dia))} (${DIAS_EXTENSO[new Date(c.dia + 'T00:00:00Z').getUTCDay()]})</a></h3>` +
      `<ul>${c.pedidos.map(p => htmlLinhaFolha(p, situacao)).join('')}</ul></section>`).join('');
  }
  // alternador "Calendário | Lista" ao lado do título: só os botões (o contêiner #cal-visao é o .tipo-toggle do tema.css, o mesmo de Pedidos | Orçamentos no Início)
  function htmlVisao(visao) {
    return VISOES.map(s => `<button type="button" class="toggle-btn${s.id === visao ? ' active' : ''}" data-visao="${s.id}" aria-pressed="${s.id === visao}">${s.rotulo}</button>`).join('');
  }
  const seloSituacao = p => `<span class="selo ${COR_CLASSE[p.classe] || 'aviso'}">${esc(p.situacao || '—')}</span>`;
  const seloAtraso = p => (p.atrasado ? '<span class="selo perigo">Atrasado</span>' : '');
  // Linha do pedido na página do dia. `valor` só existe se a API o mandou (valores.ver).
  function htmlLinhaDia(p) {
    const temValor = Object.prototype.hasOwnProperty.call(p, 'valor');
    return `<li class="linha-dia${p.atrasado ? ' atraso' : ''}" data-numero="${esc(p.numero)}" tabindex="0" aria-label="${esc(rotuloPedido(p))}">` +
      `<span class="ld-num">#${esc(p.numero)}</span>` +
      `<div class="ld-meio"><b>${esc(p.cliente || '—')}</b>${p.clienteFinal ? `<small>${esc(p.clienteFinal)}</small>` : ''}${iconesItens(p)}</div>` +
      `<div class="ld-sit">${seloSituacao(p)} ${seloAtraso(p)}</div>` +
      (temValor ? `<span class="ld-valor" data-valor>${esc(moeda(p.valor))}</span>` : '') +
      `<button type="button" class="btn btn-mini btn-secondary ld-acoes" aria-haspopup="menu" aria-label="Ações do pedido ${esc(p.numero)}">Ações</button></li>`;
  }

  // ---------- menu do botão direito (inicio_menu.js, o mesmo da página Início) ----------
  // Os itens e as permissões são os de lá. `docDe(numero)` devolve o pedido da tela; `recarregar()` busca de novo (o pedido muda de dia/situação).
  function ligarMenu(win, { auth, recarregar, docDe }) {
    if (!win.InicioMenu || !win.Acesso || !win.Acesso.pode('pedidos.ver')) return null;
    return win.InicioMenu.iniciar({
      apiBase: C.API_BASE, loginUrl: C.LOGIN_URL, token: () => (auth() ? auth().token : ''), pode: p => win.Acesso.pode(p),
      docDe, recarregar, esc, voltar: win.location.pathname.split('/').pop() + win.location.search
    });
  }
  // botão "Ações" da linha: dispara o mesmo evento de contexto (celular e quem não usa o botão direito)
  function abrirMenuDaLinha(win, li) {
    const r = li.getBoundingClientRect();
    li.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.right - 24), clientY: Math.round(r.top + r.height / 2) }));
  }

  function iniciarComum(win) {
    const doc = win.document, $ = id => doc.getElementById(id);
    const { getAuth, chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const auth = getAuth();
    if (!auth) { win.location.href = C.LOGIN_URL; return null; }
    $('user-empresa').textContent = auth.user.empresa || 'Elegance';
    $('user-name').textContent = auth.user.nome || '';
    $('user-cargo').textContent = auth.user.cargo || '';
    $('user-avatar').textContent = (auth.user.nome || 'E').charAt(0).toUpperCase();
    if (win.Acesso && !win.Acesso.paginaLiberada()) return null; // sem permissão: o layout.js já mostrou "Sem acesso"
    return { doc, $, getAuth, chamar, toast };
  }

  // alternador "Em aberto | Todos" (botões com aria-pressed); `aoTrocar(id)` roda ao escolher
  function htmlSituacao(situacao) {
    return `<div class="grupo-sit" role="group" aria-label="Quais pedidos mostrar">${SITUACOES.map(s =>
      `<button type="button" class="btn btn-mini ${s.id === situacao ? 'btn-primary ativo' : 'btn-secondary'}" data-sit="${s.id}" aria-pressed="${s.id === situacao}">${s.rotulo}</button>`).join('')}</div>`;
  }

  return { MESES, DIAS_SEMANA, SITUACOES, VISOES, COR_CLASSE, MAX_ETIQUETAS, esc, dataBR, dataValida, situacaoValida, visaoValida, htmlFolha, htmlLinhaFolha, htmlVisao, mesValido, mesDe, somarMeses, somarDias, nomeMes, dataExtenso, hojeISO,
    montarGrade, abreviar, moeda, urlDia, urlMes, htmlEtiqueta, htmlCelula, htmlGrade, htmlListaDias, htmlLinhaDia, htmlSituacao, ligarMenu, abrirMenuDaLinha, iniciarComum, C };
});
