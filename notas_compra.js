// ==========================================================================
// notas_compra.html — NF-e de compra achadas na SEFAZ pelo serviço local do PC (local/sefaz.js, http://127.0.0.1:3917).
// O certificado A1 e a senha ficam só no PC da empresa: esta página nunca os vê. Ela só fala com o serviço local
// (/sefaz/*) e, para importar, leva o XML para a entrada de estoque (movimentacao_estoque.html), que manda o XML
// ao servidor pela rota que já existe (/estoque/entrada/xml): a regra de estoque continua só no servidor.
// Também é carregado por movimentacao_estoque.html (lerPacote, marcarImportada): lá a tela desta página não monta.
// Funções puras testadas no Node (test/notas_compra_tela.test.js). Dado de fora só entra na tela por esc()/textContent.
// O valor da nota só aparece para quem tem valores.ver (é a tela que esconde: o serviço local não conhece o usuário).
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.NotasCompra = lib;
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => { if (document.getElementById('nc-lista')) lib.iniciar(raiz); });
  }
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const SERVICO = 'http://127.0.0.1:3917';
  const CHAVE_PACOTE = 'nfe_sefaz_importar';                 // sessionStorage: XML levado para a entrada de estoque
  const CHAVE_PENDENTES = 'nfe_sefaz_importadas_pendentes';  // localStorage: notas lançadas que o serviço ainda não marcou
  const LIMITE_XML = 1024 * 1024;                            // o mesmo limite da rota /estoque/entrada/xml
  const VALIDADE_PACOTE = 30 * 60 * 1000;
  const MAX_LOTE = 20;                                       // eventos por lote aceitos pela SEFAZ
  const SERVICO_FORA = 'O serviço local deste PC não respondeu. Instale ou inicie o serviço local (local\\instalar_salvador_pdf.bat, ' +
    'o mesmo que grava os PDFs) e confira se este é o PC da empresa com o certificado digital. Depois clique em "Atualizar".';

  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moeda = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });   // "R$ 1.234,56"
  const dataBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const cnpjBR = v => String(v ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

  function chaveValida(chave) {
    const s = String(chave ?? '');
    if (!/^\d{44}$/.test(s)) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11;
    return Number(s[43]) === (r < 2 ? 0 : 11 - r);
  }
  const formatarChave = chave => String(chave ?? '').replace(/(\d{4})(?=\d)/g, '$1 ');
  const numeroDaChave = chave => chaveValida(chave) ? { serie: String(Number(chave.slice(22, 25))), numero: String(Number(chave.slice(25, 34))) } : { serie: '', numero: '' };

  const SITUACOES = {
    resumo: ['Só resumo', 'aviso', 'A SEFAZ mandou só o resumo. Dê a ciência da operação para liberar o XML completo.'],
    ciencia: ['Ciência dada', 'info', 'Ciência registrada. O XML completo chega na próxima sincronização ou em "Baixar XML".'],
    completa: ['XML completo', 'ok', 'Pronta para importar na entrada de estoque.'],
    importada: ['Importada', 'neutro', 'Já levada para a entrada de estoque.']
  };
  const rotulo = n => n && n.cancelada ? ['Cancelada', 'perigo', 'O emitente cancelou esta nota.'] : (SITUACOES[n && n.situacao] || ['?', 'neutro', '']);
  // Ciência da Operação DESATIVADA a pedido do dono (é uma manifestação fiscal oficial da empresa). Para religar: true.
  const CIENCIA_LIBERADA = false;
  const MOTIVO_CIENCIA_OFF = 'Ciência da operação desativada.';
  const podeCiencia = n => !!n && !n.cancelada && n.situacao === 'resumo';
  const podeBaixar = n => !!n && !n.cancelada && (n.situacao === 'resumo' || n.situacao === 'ciencia');
  const podeImportar = n => !!n && !n.cancelada && n.situacao === 'completa';

  const FILTROS = { '': () => true, importar: podeImportar, pendentes: n => podeCiencia(n) || podeBaixar(n), importadas: n => n.situacao === 'importada', canceladas: n => !!n.cancelada };
  const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function filtrar(notas, { filtro = '', busca = '' } = {}) {
    const f = FILTROS[filtro] || FILTROS[''];
    const q = semAcento(busca).trim(), dig = String(busca ?? '').replace(/\D/g, '');
    return (Array.isArray(notas) ? notas : []).filter(n => f(n) && (!q ||
      semAcento(n.emitente).includes(q) || (dig && (String(n.cnpjEmitente || '').includes(dig) || String(n.numero || '') === String(Number(dig)) || String(n.chave).includes(dig)))));
  }

  // uma linha da tabela; perms = { comValores, importar, movimentar }
  function linhaHtml(n, perms = {}) {
    const [texto, classe, dica] = rotulo(n);
    const num = n.numero || numeroDaChave(n.chave).numero, serie = n.serie || numeroDaChave(n.chave).serie;
    const acoes = [];
    if (perms.importar && podeCiencia(n)) acoes.push(`<button type="button" class="btn btn-secondary btn-mini" data-acao="ciencia" data-chave="${esc(n.chave)}"${CIENCIA_LIBERADA ? '' : ` disabled title="${MOTIVO_CIENCIA_OFF}"`}>Ciência da operação</button>`);
    if (perms.importar && podeBaixar(n)) acoes.push(`<button type="button" class="btn btn-secondary btn-mini" data-acao="baixar" data-chave="${esc(n.chave)}">Baixar XML</button>`);
    if (perms.importar && perms.movimentar && podeImportar(n)) acoes.push(`<button type="button" class="btn btn-primary btn-mini" data-acao="importar" data-chave="${esc(n.chave)}">Importar na entrada de estoque</button>`);
    const marcar = perms.importar && podeCiencia(n) ? `<input type="checkbox" class="nc-marcar" data-chave="${esc(n.chave)}"${CIENCIA_LIBERADA ? '' : ' disabled'} aria-label="Selecionar a nota ${esc(num)}">` : '';
    return `<tr data-chave="${esc(n.chave)}"><td>${marcar}</td>` +
      `<td><b>${esc(n.emitente || '(emitente ainda não informado)')}</b><br><span class="cinza">${esc(cnpjBR(n.cnpjEmitente))}</span></td>` +
      `<td>${esc(num)}<span class="cinza"> / série ${esc(serie)}</span></td><td>${esc(dataBR(n.dataEmissao))}</td>` +
      (perms.comValores ? `<td class="num">${n.valor == null ? '' : esc(moeda(n.valor))}</td>` : '') +
      `<td><span class="selo ${classe}" title="${esc(dica)}">${esc(texto)}</span>${n.paraEmpresa === false ? ' <span class="selo aviso" title="O destinatário desta nota não é o CNPJ da empresa">outro destinatário</span>' : ''}</td>` +
      `<td class="acoes-linha">${acoes.join(' ')}</td></tr>`;
  }

  // pacote levado para a entrada de estoque (sessionStorage da mesma aba)
  const montarPacote = (chave, xml, agora = Date.now()) => JSON.stringify({ chave, xml, criadoEm: agora });
  function lerPacote(texto, agora = Date.now()) {
    let p;
    try { p = JSON.parse(String(texto ?? '')); } catch { return null; }
    if (!p || typeof p !== 'object' || !chaveValida(p.chave) || typeof p.xml !== 'string' || !p.xml.trim()) return null;
    if (p.xml.length > LIMITE_XML || !(Number(p.criadoEm) > agora - VALIDADE_PACOTE) || Number(p.criadoEm) > agora + 60000) return null;
    return { chave: p.chave, xml: p.xml };
  }
  // lista de pendentes (chaves válidas, sem repetir, no máximo 200)
  function lerPendentes(texto) {
    let l;
    try { l = JSON.parse(String(texto ?? '[]')); } catch { return []; }
    return Array.isArray(l) ? [...new Set(l.filter(chaveValida))].slice(-200) : [];
  }

  // pasta compartilhada entre os PCs (status.compartilhada): linha discreta no quadro de status; vazio = desligada
  function linhaCompartilhada(s) {
    const c = s && s.compartilhada;
    if (!c || !c.ativa) return '';
    const extra = c.acessivel === false ? ' (a pasta não está acessível agora)'
      : (c.emUsoPor ? ` · em uso agora pelo computador ${esc(c.emUsoPor)}` : '');
    return `<p class="cinza">Notas compartilhadas com os outros computadores${extra}.</p>`;
  }
  // aviso (amarelo) e não erro: espera da SEFAZ (429) ou outro computador/operação com a trava (409)
  const ehAviso = e => !!e && (e.status === 429 || (e.status === 409 && !!e.dados && e.dados.trava === true));

  // ---------- serviço local ----------
  class ServicoFora extends Error { constructor() { super(SERVICO_FORA); this.name = 'ServicoFora'; } }
  // marcar "importada" que não deu certo agora mas pode dar depois: serviço fora, trava de outro PC, pasta fora do ar
  const tentarDepois = e => e instanceof ServicoFora || (!!e && (e.status === 503 || (e.status === 409 && !!e.dados && e.dados.trava === true)));
  async function chamarLocal(win, caminho, { metodo = 'GET', corpo, texto = false, tempo = 120000 } = {}) {
    let res;
    try {
      res = await win.fetch(SERVICO + caminho, { method: metodo, headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined, signal: win.AbortSignal && win.AbortSignal.timeout ? win.AbortSignal.timeout(tempo) : undefined });
    } catch { throw new ServicoFora(); }
    if (texto && res.ok) return res.text();
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.error || `Erro ${res.status} no serviço local.`); e.status = res.status; e.dados = d; throw e; }
    return d;
  }
  // marca a nota como importada no serviço local; sem resposta, guarda para a tela de notas de compra marcar depois
  async function marcarImportada(win, chave) {
    if (!chaveValida(chave)) return false;
    try { await chamarLocal(win, '/sefaz/importada', { metodo: 'POST', corpo: { chave }, tempo: 5000 }); return true; }
    catch (e) {
      if (tentarDepois(e)) {
        try {
          const l = lerPendentes(win.localStorage.getItem(CHAVE_PENDENTES));
          if (!l.includes(chave)) l.push(chave);
          win.localStorage.setItem(CHAVE_PENDENTES, JSON.stringify(l));
        } catch { /* sem armazenamento: a nota continua "XML completo" e o servidor recusa lançar a mesma nota de novo */ }
      }
      return false;
    }
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { notas: [], status: null, filtro: '', busca: '', ocupado: false, temporizador: null };
    const pode = c => !!(win.Acesso && win.Acesso.pode(c));
    const perms = () => ({ comValores: pode('valores.ver'), importar: pode('compras_nfe.importar'), movimentar: pode('estoque.movimentar') });
    function toast(msg, tipo = 'info') {
      const t = doc.createElement('div');
      t.className = `toast ${tipo}`; t.textContent = msg;
      $('toasts').appendChild(t); win.setTimeout(() => t.remove(), 7000);
    }
    function aviso(msg, tipo = 'info') {
      $('nc-aviso').hidden = !msg; $('nc-aviso').textContent = msg || ''; $('nc-aviso').className = `aviso-caixa ${tipo}`;
    }

    function desenharStatus() {
      const s = estado.status;
      const caixa = $('nc-status');
      if (!s) { caixa.innerHTML = ''; return; }
      if (!s.configurada) { caixa.innerHTML = `<p><span class="selo aviso">SEFAZ não configurada</span> ${esc(s.motivo)}</p>`; return; }
      const amb = s.ambiente === 'producao' ? '<span class="selo ok">Produção</span>' : '<span class="selo info">Homologação (teste)</span>';
      const prox = s.proximaConsultaHora ? `Próxima consulta liberada às <b>${esc(s.proximaConsultaHora)}</b>.` : 'Consulta liberada.';
      const cert = s.certificado ? `certificado válido até <b>${esc(dataBR(s.certificado.validoAte))}</b>`
        : '<span class="selo aviso">Somente consulta</span> certificado indisponível neste PC';
      caixa.innerHTML = `<p>${amb} CNPJ <b>${esc(cnpjBR(s.cnpj))}</b> · UF ${esc(s.uf)} · ${cert}</p>` +
        `<p class="cinza">${prox} Consultas por chave na última hora: ${esc(s.consultasChaveNaHora)} de ${esc(s.limiteConsultasChave)}.` +
        `${s.ultimaSincronizacao ? ` Última sincronização: ${esc(new Date(s.ultimaSincronizacao).toLocaleString('pt-BR'))}.` : ''}</p>` +
        linhaCompartilhada(s) +
        (s.avisos || []).map(a => `<p class="erro-form">${esc(a)}</p>`).join('');
    }
    function desenharLista() {
      const p = perms();
      const lista = filtrar(estado.notas, { filtro: estado.filtro, busca: estado.busca });
      $('nc-qtd').textContent = `${lista.length} de ${estado.notas.length} nota(s)`;
      if (!lista.length) { $('nc-lista').innerHTML = `<p class="vazio">${estado.notas.length ? 'Nenhuma nota neste filtro.' : 'Nenhuma nota ainda. Clique em "Sincronizar com a SEFAZ".'}</p>`; atualizarLote(); return; }
      $('nc-lista').innerHTML = '<table><thead><tr><th></th><th>Emitente</th><th>Número</th><th>Emissão</th>' + (p.comValores ? '<th class="num">Valor</th>' : '') +
        '<th>Situação</th><th></th></tr></thead><tbody>' + lista.map(n => linhaHtml(n, p)).join('') + '</tbody></table>';
      atualizarLote();
    }
    const marcadas = () => [...doc.querySelectorAll('.nc-marcar:checked')].map(c => c.getAttribute('data-chave'));
    function atualizarLote() { const q = marcadas().length; $('btn-ciencia-lote').disabled = !CIENCIA_LIBERADA || !q || estado.ocupado; $('btn-ciencia-lote').textContent = q ? `Ciência das selecionadas (${q})` : 'Ciência das selecionadas'; }

    async function enviarPendentes() {
      let l;
      try { l = lerPendentes(win.localStorage.getItem(CHAVE_PENDENTES)); } catch { return; }
      if (!l.length) return;
      const resta = [];
      for (const chave of l) {
        try { await chamarLocal(win, '/sefaz/importada', { metodo: 'POST', corpo: { chave }, tempo: 5000 }); }
        catch (e) { if (tentarDepois(e)) resta.push(chave); }   // outro erro (nota não está mais no índice): desiste dela
      }
      try { if (resta.length) win.localStorage.setItem(CHAVE_PENDENTES, JSON.stringify(resta)); else win.localStorage.removeItem(CHAVE_PENDENTES); } catch { /* nada */ }
    }

    async function carregar() {
      aviso('');
      try { estado.status = await chamarLocal(win, '/sefaz/status', { tempo: 5000 }); }
      catch (e) { estado.status = null; estado.notas = []; desenharStatus(); desenharLista(); aviso(e.message, e instanceof ServicoFora ? 'erro' : 'aviso'); travar(true); return; }
      desenharStatus();
      if (!estado.status.configurada) { estado.notas = []; desenharLista(); travar(true); aviso('Peça para configurar o serviço local da SEFAZ neste PC (docs/sefaz_configuracao.md).', 'aviso'); return; }
      await enviarPendentes();
      try { estado.notas = (await chamarLocal(win, '/sefaz/notas')).notas || []; }
      catch (e) { estado.notas = []; aviso(e.message, 'erro'); }
      travar(!!estado.status.somenteConsulta);      // sem certificado neste PC: não sincroniza (a lista e a importação continuam)
      desenharLista();
    }
    function travar(sim) {
      $('btn-sincronizar').disabled = sim || estado.ocupado;
      if ($('btn-rebuscar')) $('btn-rebuscar').disabled = sim || estado.ocupado;
      atualizarLote();
    }
    async function ocupar(botao, acao) {
      if (estado.ocupado) return;
      estado.ocupado = true;
      const original = botao ? botao.textContent : '';
      if (botao) { botao.disabled = true; botao.textContent = 'Aguarde…'; }
      $('btn-sincronizar').disabled = true;
      if ($('btn-rebuscar')) $('btn-rebuscar').disabled = true;
      try { await acao(); }
      catch (e) { const leve = ehAviso(e); aviso(e.message, leve ? 'aviso' : 'erro'); toast(e.message, leve ? 'info' : 'erro'); }
      finally {
        estado.ocupado = false;
        if (botao && botao.isConnected) { botao.disabled = false; botao.textContent = original; }
        await carregar();
      }
    }

    async function sincronizar(reiniciarHistorico = false) {
      await ocupar($('btn-sincronizar'), async () => {
        const r = await chamarLocal(win, '/sefaz/sincronizar', { metodo: 'POST', corpo: reiniciarHistorico ? { reiniciarHistorico: true } : {}, tempo: 10 * 60 * 1000 });
        const partes = [`${r.novas} nota(s) nova(s), ${r.atualizadas} atualizada(s).`];
        if (r.recebidos !== undefined) partes.push(`A SEFAZ entregou ${r.recebidos} documento(s).`);
        const ig = r.ignorados ? r.ignorados.ilegivel + r.ignorados.tipoDesconhecido + r.ignorados.xmlInvalido : 0;
        if (ig) partes.push(`${ig} não puderam ser lidos (ilegíveis: ${r.ignorados.ilegivel}, tipo desconhecido: ${r.ignorados.tipoDesconhecido}, XML inválido: ${r.ignorados.xmlInvalido}).`);
        if (r.haMais) partes.push('Ainda há documentos na SEFAZ: clique em Sincronizar de novo.');
        else if (r.proximaConsultaHora) partes.push(`A SEFAZ só aceita nova consulta às ${r.proximaConsultaHora}.`);
        toast(partes.join(' '), 'ok');
      });
    }
    async function ciencia(chaves) {
      if (!CIENCIA_LIBERADA || !chaves.length) return;
      const texto = `Registrar a CIÊNCIA DA OPERAÇÃO na SEFAZ para ${chaves.length} nota(s)?\n\n` +
        'É uma manifestação oficial da empresa como destinatária (com o certificado digital). Ela libera o XML completo; ' +
        'não confirma nem recusa a compra.';
      if (!win.confirm(texto)) return;
      await ocupar(chaves.length === 1 ? doc.querySelector(`button[data-acao="ciencia"][data-chave="${chaves[0]}"]`) : $('btn-ciencia-lote'), async () => {
        const r = await chamarLocal(win, '/sefaz/ciencia', { metodo: 'POST', corpo: { chaves } });
        const ok = r.resultados.filter(x => x.ok).length, erros = r.resultados.filter(x => !x.ok);
        toast(`Ciência registrada em ${ok} nota(s).${ok ? ' O XML completo costuma chegar em alguns minutos.' : ''}`, ok ? 'ok' : 'erro');
        if (erros.length) aviso(erros.map(x => `Nota ${numeroDaChave(x.chave).numero}: ${x.mensagem}`).join(' · '), 'erro');
      });
    }
    async function baixar(chave, botao) {
      await ocupar(botao, async () => {
        const r = await chamarLocal(win, '/sefaz/baixar', { metodo: 'POST', corpo: { chave } });
        toast(r.mensagem, r.completa ? 'ok' : 'info');
      });
    }
    async function importar(chave, botao) {
      if (estado.ocupado) return;
      botao.disabled = true;
      try {
        const xml = await chamarLocal(win, '/sefaz/xml/' + chave, { texto: true, tempo: 10000 });
        if (xml.length > LIMITE_XML) throw new Error('O XML desta nota passa de 1 MB, o limite da entrada de estoque.');
        win.sessionStorage.setItem(CHAVE_PACOTE, montarPacote(chave, xml));
        win.location.href = 'movimentacao_estoque.html?aba=entrada&origem=sefaz';
      } catch (e) { botao.disabled = false; aviso(e.message, 'erro'); }
    }

    // ---------- eventos ----------
    $('nc-lista').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-acao]');
      if (!b) return;
      const chave = b.getAttribute('data-chave');
      if (!chaveValida(chave)) return;
      const acao = b.getAttribute('data-acao');
      if (acao === 'ciencia') ciencia([chave]);
      else if (acao === 'baixar') baixar(chave, b);
      else if (acao === 'importar') importar(chave, b);
    });
    $('nc-lista').addEventListener('change', ev => { if (ev.target.classList.contains('nc-marcar')) atualizarLote(); });
    $('btn-sincronizar').addEventListener('click', () => sincronizar(false));
    const rebuscar = $('btn-rebuscar');
    if (rebuscar) rebuscar.addEventListener('click', () => {
      const pergunta = 'Buscar de novo TODO o histórico que a SEFAZ ainda guarda?\n\n' +
        'Volta o ponteiro para o início. Use quando faltarem notas antigas. ' +
        'A SEFAZ limita as consultas: se ela responder "consumo indevido", é preciso esperar 1 hora.';
      if (!win.confirm(pergunta)) return;
      sincronizar(true);
    });
    $('btn-atualizar').addEventListener('click', () => { if (!estado.ocupado) carregar(); });
    $('btn-ciencia-lote').addEventListener('click', () => {
      const m = marcadas();
      if (m.length > MAX_LOTE) { aviso(`Selecione no máximo ${MAX_LOTE} notas por vez (limite da SEFAZ por lote).`, 'aviso'); return; }
      ciencia(m);
    });
    $('nc-filtro').addEventListener('change', ev => { estado.filtro = ev.target.value; desenharLista(); });
    $('nc-busca').addEventListener('input', ev => {
      estado.busca = ev.target.value;
      win.clearTimeout(estado.temporizador);
      estado.temporizador = win.setTimeout(desenharLista, 200);
    });
    carregar();
  }

  return { SERVICO, CHAVE_PACOTE, CHAVE_PENDENTES, LIMITE_XML, SERVICO_FORA, ServicoFora, esc, moeda, dataBR, cnpjBR, chaveValida, formatarChave, numeroDaChave,
    rotulo, podeCiencia, podeBaixar, podeImportar, filtrar, linhaHtml, montarPacote, lerPacote, lerPendentes, chamarLocal, marcarImportada, iniciar,
    linhaCompartilhada, ehAviso, tentarDepois };
});
