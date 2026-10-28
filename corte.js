// ==========================================================================
// corte.html — Plano de corte de perfis de um Pedido (varas, retalhos, conferência do corte real) e parâmetros.
// Rotas: GET /corte/pedido/:n, POST /corte/pedido/:n/salvar, GET /corte/plano/:id, PUT /corte/plano/:id/pecas,
//        POST /corte/plano/:id/confirmar|cancelar, GET /corte/estoque/produtos (baixa das varas novas), GET/PUT /corte/config, GET/POST/PUT /corte/retalhos, POST /corte/retalhos/:id/descartar.
// Funções puras testadas no Node (test/corte_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou value/textContent. Quem decide o acesso é o servidor.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Corte = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt } = C;

  // ---------- formatação ----------
  const mm = n => (n === null || n === undefined || !Number.isFinite(Number(n))) ? '—' : Number(n).toLocaleString('pt-BR') + ' mm';
  const pctTxt = n => (n === null || n === undefined || !Number.isFinite(Number(n))) ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  const larguraPct = (parte, total) => (!(total > 0) || !(parte > 0)) ? 0 : Math.min(100, Math.round(parte / total * 10000) / 100);
  const ORIGENS = { 'porta-altura': 'Altura', 'porta-largura': 'Largura', puxador: 'Puxador', divisor: 'Divisor' };
  const rotuloOrigem = o => ORIGENS[o] || String(o ?? '');
  const SITUACOES = { gerado: 'Gerado (aguardando corte)', conferido: 'Conferido (corte confirmado)', cancelado: 'Cancelado',
    desatualizado: 'Desatualizado: o pedido mudou depois do plano — refaça o plano' };
  const rotuloSituacao = s => SITUACOES[s] || String(s ?? '');
  // acabamento/cor em branco são válidos no pedido: a tela diz isso em vez de deixar o espaço vazio
  const semAcab = v => txt(v) || '(sem acabamento)';
  const semCor = v => txt(v) || '(sem cor)';
  // cada perfil do plano ganha uma cor própria (fundo, faixa, peça); verde fica reservado para "cortada" e amarelo para a sobra
  const MATIZES = [212, 275, 24, 336, 190, 252, 8, 300];
  const estiloGrupo = i => { const h = MATIZES[((i % MATIZES.length) + MATIZES.length) % MATIZES.length]; return `--g-solido:hsl(${h} 55% 30%);--g-fundo:hsl(${h} 60% 95%);--g-peca:hsl(${h} 70% 83%);--g-borda:hsl(${h} 50% 42%)`; };
  const contarPecas = plano => ((plano && plano.grupos) || []).reduce((s, g) => s + g.barras.reduce((t, b) => t + b.pecas.length, 0), 0);
  const chaveCortada = (grupo, barra, peca) => `${grupo}\u0001${barra}\u0001${peca}`;

  // ---------- HTML do plano ----------
  function htmlConferencia(chave, b, i) {
    const retalho = b.tipo === 'retalho';
    if (!(b.sobra > 0) && !retalho) return '';
    return `<div class="conf-linha" data-grupo="${esc(chave)}" data-barra="${i}">` +
      (b.sobra > 0 ? `<label>Sobra real (mm) <input class="conf-medida" inputmode="numeric" value="${esc(b.sobra)}" aria-label="Medida real da sobra"></label>` +
        `<label>Destino <select class="conf-destino"><option value="guardar"${b.destinoSobra === 'guardar' ? ' selected' : ''}>Guardar como retalho</option>` +
        `<option value="descartar"${b.destinoSobra === 'descartar' ? ' selected' : ''}>Descartar</option></select></label>` : '') +
      (retalho ? `<label class="nao-usado"><input type="checkbox" class="conf-naousado" data-id="${esc(b.retalhoId)}"> Este retalho não foi usado</label>` : '') + `</div>`;
  }
  // opcoes: { cortadas: Set, clicavel: bool, conferindo: bool }
  function htmlBarra(chave, b, i, opcoes = {}) {
    const cortadas = opcoes.cortadas || new Set();
    const titulo = b.tipo === 'retalho' ? `Retalho nº ${esc(b.retalhoId)} · ${esc(mm(b.comprimento))}` : `Vara nova · ${esc(mm(b.comprimento))}`;
    const pecas = (b.pecas || []).map((p, k) => {
      const feita = cortadas.has(chaveCortada(chave, i, k));
      return `<button type="button" class="peca${feita ? ' cortada' : ''}" style="width:${larguraPct(p.tamanho, b.comprimento)}%" aria-pressed="${feita}"` +
        `${opcoes.clicavel ? '' : ' disabled'} data-grupo="${esc(chave)}" data-barra="${i}" data-peca="${k}" title="${esc(mm(p.tamanho))} · item ${esc(p.item)} · ${esc(rotuloOrigem(p.origem))}">` +
        `${feita ? '✓ ' : ''}${esc(p.tamanho)}<small>item ${esc(p.item)} · ${esc(rotuloOrigem(p.origem))}</small></button>`;
    }).join('');
    const sobra = b.sobra > 0 ? `<span class="sobra ${b.destinoSobra === 'guardar' ? 'guardar' : 'descartar'}" style="width:${larguraPct(b.sobra, b.comprimento)}%">Sobra ${esc(b.sobra)}</span>` : '';
    const destino = b.sobra > 0 ? ` — sobra de ${esc(mm(b.sobra))}: ${b.destinoSobra === 'guardar' ? 'guardar como retalho' : 'descartar (abaixo da sobra mínima)'}` : ' — sem sobra';
    const feitas = (b.pecas || []).filter((p, k) => cortadas.has(chaveCortada(chave, i, k))).length;
    const completa = (b.pecas || []).length > 0 && feitas === b.pecas.length;
    const selo = completa ? `<span class="selo-completa">✓ ${b.tipo === 'retalho' ? 'Retalho completo' : 'Vara completa'}</span>` : '';
    return `<div class="barra${completa ? ' completa' : ''}" role="group" aria-label="${titulo}"><div class="barra-titulo"><b>${titulo}</b>${selo}<span class="cinza">${destino}</span></div>` +
      `<div class="faixa">${pecas}${sobra}</div>${opcoes.conferindo ? htmlConferencia(chave, b, i) : ''}</div>`;
  }
  function htmlGrupo(g, opcoes = {}, indice = 0) {
    const cortadas = opcoes.cortadas || new Set();
    const total = g.barras.reduce((s, b) => s + b.pecas.length, 0);
    const feitas = g.barras.reduce((s, b, i) => s + b.pecas.filter((p, k) => cortadas.has(chaveCortada(g.chave, i, k))).length, 0);
    return `<section class="grupo" style="${estiloGrupo(indice)}"><h3><span class="nome-perfil">${esc(g.perfil)}</span> <span class="chip">${esc(semAcab(g.acabamento))}</span> <span class="chip">${esc(semCor(g.cor))}</span>` +
      `<span class="progresso-grupo">${feitas} de ${total} peças cortadas</span></h3>` +
      g.barras.map((b, i) => htmlBarra(g.chave, b, i, opcoes)).join('') + '</section>';
  }
  // confirmação do botão "Excluir dados do pedido": mais forte quando há plano já conferido (corte real confirmado)
  function textoConfirmarExclusao(previa) {
    const n = previa.qtdPlanosGravados, base = `Excluir TODOS os dados de plano de corte do pedido nº ${previa.pedido.numero} (${n} plano${n === 1 ? '' : 's'})?\n\nOs retalhos reservados por esses planos voltam a ficar disponíveis. Isto não pode ser desfeito.`;
    if (!(previa.qtdConferidos > 0)) return base;
    return base + `\n\nATENÇÃO: ${previa.qtdConferidos} plano${previa.qtdConferidos === 1 ? ' JÁ CONFERIDO' : 's JÁ CONFERIDOS'} (corte real confirmado) serão apagados do histórico. ` +
      'Os retalhos que esses cortes usaram ou criaram continuam no estoque de retalhos: o material físico não volta.';
  }
  // linha de status acima do plano: explica quando dá para marcar peças e mostra o andamento
  function textoStatusPlano({ modo, salvo, total = 0, cortadas = 0, planoSalvoConferido = false }) {
    if (modo !== 'salvo') return planoSalvoConferido ? 'Este pedido já tem um plano conferido; abaixo está só uma simulação.'
      : 'Pré-visualização: nada foi gravado nem reservado. Salve o plano para marcar as peças cortadas e reservar os retalhos.';
    const aberto = salvo.situacao === 'gerado' || salvo.situacao === 'desatualizado';
    return `Plano nº ${salvo.id}: ${rotuloSituacao(salvo.situacao)}. ${cortadas} de ${total} peças cortadas.` + (aberto ? ' Clique numa peça para dar baixa quando ela for cortada (clique de novo para desfazer). As baixas ficam salvas neste aparelho na hora e são enviadas ao servidor em lote.' : '');
  }
  function htmlResumo(r) {
    const cel = (t, v) => `<div><dt>${esc(t)}</dt><dd>${esc(v)}</dd></div>`;
    return '<dl class="resumo">' + cel('Varas novas', r.qtdVarasNovas) + cel('Retalhos usados', r.qtdRetalhosUsados) + cel('Aproveitamento', pctTxt(r.aproveitamentoPct)) + cel('Sobra somada', mm(r.sobraSomaMm)) + '</dl>';
  }
  const htmlPendencias = lista => !lista || !lista.length ? '' :
    `<div class="aviso-pendencia" role="alert"><b>Pendências — estas peças ficaram fora do plano:</b><ul>${lista.map(p => `<li>Item ${esc(p.item)} — ${esc(p.perfil)}: ${esc(p.motivo)}</li>`).join('')}</ul></div>`;
  const htmlErros = lista => !lista || !lista.length ? '' :
    `<div class="aviso-pendencia" role="alert"><b>Peças que não cabem em nenhuma vara:</b><ul>${lista.map(e => `<li>${esc(mm(e.peca.tamanho))} (${esc(e.peca.perfil)}, item ${esc(e.peca.item)}): ${esc(e.motivo)}</li>`).join('')}</ul></div>`;

  // ---------- baixa no estoque das varas novas ----------
  // um grupo (perfil + acabamento + cor) por linha, só os que usam vara nova (retalho não está no estoque)
  const gruposComVarasNovas = plano => ((plano && plano.grupos) || [])
    .map(g => ({ chave: g.chave, perfil: g.perfil, acabamento: g.acabamento, cor: g.cor, varas: g.barras.filter(b => b.tipo === 'vara').length }))
    .filter(g => g.varas > 0);
  const normalizarNomeProduto = v => txt(v).replace(/\s+/g, ' ').toLowerCase();
  // pré-seleção: o produto de estoque de mesmo nome do perfil (sem diferenciar caixa nem espaços); se houver 0 ou mais de 1, o usuário escolhe
  function sugerirProduto(perfil, produtos) {
    const alvo = normalizarNomeProduto(perfil);
    const iguais = alvo ? (produtos || []).filter(p => normalizarNomeProduto(p.nome) === alvo) : [];
    return iguais.length === 1 ? iguais[0].codigo : null;
  }
  // produtos: lista de { codigo, nome, unidade, qtdEstoque } ou null (não carregada); escolhas: { chave: codigo } já feitas pelo usuário
  function htmlBaixaEstoque(grupos, produtos, escolhas = {}) {
    if (!grupos.length) return '';
    const cabecalho = '<section class="baixa-estoque"><h3>Baixa no estoque</h3><p class="cinza">As varas novas usadas saem do estoque ao confirmar. Retalhos não entram. Confira o produto de cada perfil.</p>';
    if (!produtos) return cabecalho + '<p class="erro-estado" role="alert">Não foi possível carregar a lista de produtos do estoque (ou você não tem permissão de dar saída no estoque). Sem ela o corte não pode ser confirmado.</p></section>';
    const linhas = grupos.map(g => {
      const escolhido = escolhas[g.chave] !== undefined ? Number(escolhas[g.chave]) : sugerirProduto(g.perfil, produtos);
      const opcoes = '<option value="">— escolha o produto —</option>' + produtos.map(p =>
        `<option value="${esc(p.codigo)}"${escolhido === p.codigo ? ' selected' : ''}>${esc(p.nome)} (estoque: ${esc(p.qtdEstoque)}${p.unidade ? ' ' + esc(p.unidade) : ''})</option>`).join('');
      return `<div class="baixa-linha"><b>${esc(g.perfil)}</b> <span class="chip">${esc(semAcab(g.acabamento))}</span> <span class="chip">${esc(semCor(g.cor))}</span>` +
        `<span>${esc(g.varas)} vara${g.varas === 1 ? '' : 's'} nova${g.varas === 1 ? '' : 's'}</span>` +
        `<select class="baixa-produto" data-chave="${esc(g.chave)}" aria-label="Produto do estoque para ${esc(g.perfil)}">${opcoes}</select></div>`;
    });
    return cabecalho + linhas.join('') + '</section>';
  }
  // selecoes: [{ chave, produtoCodigo: texto do select }]
  const corpoBaixas = selecoes => selecoes.map(s => ({ chave: s.chave, produtoCodigo: Number(s.produtoCodigo) }));
  // mesmas regras do servidor: um produto por grupo com vara nova, sem repetir produto
  function validarBaixasForm(grupos, selecoes) {
    const erros = [], escolhidos = [];
    for (const g of grupos) {
      const s = selecoes.find(x => x.chave === g.chave);
      const n = s ? Number(s.produtoCodigo) : NaN;
      if (!Number.isInteger(n) || n <= 0) erros.push(`Escolha o produto do estoque para ${g.perfil} (${semAcab(g.acabamento)} / ${semCor(g.cor)}).`);
      else escolhidos.push(n);
    }
    if (!erros.length && new Set(escolhidos).size !== escolhidos.length) erros.push('O mesmo produto do estoque foi escolhido para mais de um grupo. Escolha um produto por grupo.');
    return erros;
  }

  // ---------- corpos de envio e validação ----------
  const corpoSalvar = p => ({ impressao: p.impressao, retalhosUsados: p.retalhosUsados });
  const inteiroMm = v => /^\d+$/.test(txt(v)) ? Number(txt(v)) : NaN;
  function corpoConferencia(linhas, naoUsados, baixas) {
    return { sobras: linhas.map(l => l.destino === 'guardar' ? { grupo: l.grupo, barra: l.barra, destino: 'guardar', medidaReal: inteiroMm(l.medida) } : { grupo: l.grupo, barra: l.barra, destino: 'descartar' }),
      retalhosNaoUsados: naoUsados, ...(Array.isArray(baixas) ? { baixas } : {}) };
  }
  // mesmas regras do servidor: guardar exige medida inteira > 0 e não maior que a sobra calculada
  function validarConferenciaForm(linhas, plano) {
    const erros = [];
    for (const l of linhas) {
      if (l.destino !== 'guardar') continue;
      const b = ((plano.grupos || []).find(g => g.chave === l.grupo) || { barras: [] }).barras[l.barra];
      const n = inteiroMm(l.medida);
      if (!b || !(n > 0)) erros.push('Informe a medida real da sobra como número inteiro de milímetros, maior que zero.');
      else if (n > b.sobra) erros.push(`A sobra real (${n} mm) não pode ser maior que a calculada (${b.sobra} mm).`);
    }
    return erros;
  }

  // ---------- retalhos e parâmetros ----------
  function htmlRetalhos(lista, podeParametros, podePlanejar = false) {
    if (!lista.length) return '<p class="vazio" role="status">Nenhum retalho nesta situação.</p>';
    const linhas = lista.map(r => `<tr><td>${esc(r.perfil)}</td><td>${esc(semAcab(r.acabamento))}</td><td>${esc(semCor(r.cor))}</td><td class="num">${esc(mm(r.comprimento))}</td>` +
      `<td>${esc(r.situacao)}${r.planoReserva ? ` (plano ${esc(r.planoReserva)})` : ''}</td><td>${r.planoOrigem ? `plano ${esc(r.planoOrigem)}` : 'manual'}</td>` +
      `<td>${podePlanejar && r.situacao === 'reservado' && r.planoReserva ? `<button type="button" class="btn btn-secondary" data-acao="cancelar-plano" data-plano="${esc(r.planoReserva)}">Cancelar plano ${esc(r.planoReserva)}</button>` : ''}${podeParametros && r.situacao === 'disponivel' ? `<button type="button" class="btn btn-secondary" data-acao="editar" data-id="${esc(r.id)}">Ajustar</button> <button type="button" class="btn btn-secondary" data-acao="descartar" data-id="${esc(r.id)}">Descartar</button>` : ''}</td></tr>`);
    return '<table><thead><tr><th>Perfil</th><th>Acabamento</th><th>Cor</th><th>Comprimento</th><th>Situação</th><th>Origem</th><th>Ações</th></tr></thead><tbody>' + linhas.join('') + '</tbody></table>';
  }
  function htmlConfig(c) {
    const p = c.padrao;
    const exc = c.excecoes.length ? '<table><thead><tr><th>Perfil</th><th>Vara</th><th>Serra</th><th>Sobra mínima</th></tr></thead><tbody>' +
      c.excecoes.map(e => `<tr><td>${esc(e.perfil)}</td><td>${esc(e.comprimentoVara === null ? 'padrão' : mm(e.comprimentoVara))}</td><td>${esc(e.serra === null ? 'padrão' : mm(e.serra))}</td><td>${esc(e.sobraMinima === null ? 'padrão' : mm(e.sobraMinima))}</td></tr>`).join('') + '</tbody></table>'
      : '<p class="vazio">Nenhuma exceção por perfil: todos usam o padrão.</p>';
    return `<dl class="resumo"><div><dt>Vara (padrão)</dt><dd>${esc(mm(p.comprimentoVara))}</dd></div><div><dt>Serra</dt><dd>${esc(mm(p.serra))}</dd></div><div><dt>Sobra mínima</dt><dd>${esc(mm(p.sobraMinima))}</dd></div></dl>${exc}`;
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { numero: null, previa: null, salvo: null, modo: null, cortadas: new Set(), conferindo: false, ocupado: false, retalhos: [], seq: 0, produtos: null };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const pode = p => !!(win.Acesso && win.Acesso.pode(p));
    const ABERTO = s => s === 'gerado' || s === 'desatualizado';

    // ---- baixa de peças "local": o clique só mexe na tela e no localStorage; o servidor recebe tudo junto (lote) ----
    // pendentes: chave da peça -> { grupo, barra, peca, cortada } ainda não confirmado pelo servidor (guardado por plano)
    const ESPERA_ENVIO_MS = 3000, ESPERA_REENVIO_MS = 15000;
    const sync = { plano: null, pendentes: new Map(), timer: null, enviando: null, erro: false };
    const chaveArmazem = id => 'corte_marcas_' + id;
    function gravarPendentes() {
      try {
        if (!sync.plano) return;
        if (sync.pendentes.size) win.localStorage.setItem(chaveArmazem(sync.plano), JSON.stringify([...sync.pendentes.values()]));
        else win.localStorage.removeItem(chaveArmazem(sync.plano));
      } catch { /* armazenamento bloqueado: segue só em memória */ }
    }
    function lerPendentes(id) {
      try {
        const lista = JSON.parse(win.localStorage.getItem(chaveArmazem(id)) || '[]');
        return Array.isArray(lista) ? lista.filter(m => m && typeof m.grupo === 'string' && Number.isInteger(m.barra) && Number.isInteger(m.peca) && typeof m.cortada === 'boolean') : [];
      } catch { return []; }
    }
    function mostrarSync() {
      const el = $('sync-estado');
      if (!el) return;
      const n = sync.pendentes.size, s = n === 1 ? '' : 's';
      el.hidden = !(sync.plano && (n || sync.erro || sync.enviando));
      el.className = 'sync ' + (sync.erro ? 'erro' : n ? 'pendente' : 'ok');
      el.textContent = sync.erro ? `Sem conexão: ${n} baixa${s} guardada${s} neste aparelho` : n ? `${n} baixa${s} a enviar` : 'Baixas salvas';
    }
    function agendarEnvio(ms) {
      if (sync.timer) win.clearTimeout(sync.timer);
      sync.timer = sync.pendentes.size ? win.setTimeout(() => { sync.timer = null; enviarPendentes(); }, ms) : null;
    }
    async function enviarPendentes() {
      if (sync.timer) { win.clearTimeout(sync.timer); sync.timer = null; }
      if (sync.enviando) return sync.enviando;
      if (!sync.plano || !sync.pendentes.size) { mostrarSync(); return; }
      const plano = sync.plano, lote = [...sync.pendentes.entries()];
      sync.enviando = (async () => {
        try {
          await chamar(`/corte/plano/${plano}/pecas`, { metodo: 'PUT', corpo: { marcas: lote.map(([, m]) => m) } });
          sync.erro = false;
          // só tira do pendente o que não mudou durante o envio
          if (sync.plano === plano) for (const [k, m] of lote) { const atual = sync.pendentes.get(k); if (atual && atual.cortada === m.cortada) sync.pendentes.delete(k); }
          gravarPendentes();
        } catch (err) {
          if (err.status === 400 || err.status === 404 || err.status === 409) {
            // o plano mudou (cancelado, conferido, refeito): as baixas guardadas não valem mais
            sync.pendentes.clear(); gravarPendentes(); sync.erro = false; sync.enviando = null; mostrarSync();
            toast('O plano mudou no servidor; recarregando.', 'erro');
            await carregarPlano(estado.numero, { semEnviar: true });
            return;
          }
          sync.erro = true;
        }
        sync.enviando = null; mostrarSync();
        if (sync.pendentes.size) agendarEnvio(sync.erro ? ESPERA_REENVIO_MS : ESPERA_ENVIO_MS);
      })();
      mostrarSync();
      return sync.enviando;
    }
    // abre um plano: baixas guardadas neste aparelho e ainda não enviadas valem por cima do que veio do servidor
    function adotarPlano(id, cortadasServidor) {
      sync.plano = id; sync.pendentes = new Map(); sync.erro = false;
      const cortadas = new Set(cortadasServidor.map(c => chaveCortada(c.grupo, c.barra, c.peca)));
      if (id) for (const m of lerPendentes(id)) {
        const k = chaveCortada(m.grupo, m.barra, m.peca);
        sync.pendentes.set(k, m);
        if (m.cortada) cortadas.add(k); else cortadas.delete(k);
      }
      agendarEnvio(ESPERA_ENVIO_MS); mostrarSync();
      return cortadas;
    }
    win.addEventListener('pagehide', () => { enviarPendentes(); });
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') enviarPendentes(); });
    win.addEventListener('online', () => { if (sync.pendentes.size) enviarPendentes(); });

    function mensagem(id, texto, tipo) { $(id).innerHTML = `<p class="${tipo === 'erro' ? 'erro-estado' : 'vazio'}" role="${tipo === 'erro' ? 'alert' : 'status'}">${esc(texto)}</p>`; }
    function aba(nome) {
      for (const b of doc.querySelectorAll('[data-aba]')) { const ativa = b.dataset.aba === nome; b.setAttribute('aria-selected', String(ativa)); b.classList.toggle('ativa', ativa); }
      for (const n of ['plano', 'retalhos', 'config']) $('painel-' + n).hidden = n !== nome;
      if (nome === 'retalhos') carregarRetalhos();
      if (nome === 'config') carregarConfig();
    }

    // ---- plano ----
    function desenharPlano() {
      const { previa, salvo, modo } = estado;
      const fonte = modo === 'salvo' ? salvo : previa;
      $('plano-titulo').textContent = `Pedido nº ${previa.pedido.numero} — ${previa.pedido.cliente}`;
      $('btn-excluir-dados').hidden = !(pode('corte.planejar') && previa.qtdPlanosGravados > 0);
      if (previa.vazio) { mensagem('plano-area', previa.mensagem); ['btn-salvar', 'btn-refazer', 'btn-conferir', 'btn-confirmar', 'btn-cancelar-plano'].forEach(id => { $(id).hidden = true; }); $('plano-status').textContent = ''; return; }
      const situacao = modo === 'salvo' ? salvo.situacao : null;
      $('plano-status').textContent = textoStatusPlano({ modo, salvo, total: contarPecas(fonte.plano), cortadas: estado.cortadas.size, planoSalvoConferido: !!(previa.planoSalvo && previa.planoSalvo.situacao === 'conferido') });
      const editavel = modo === 'salvo' && ABERTO(situacao) && pode('corte.planejar');
      const opcoes = { cortadas: estado.cortadas, clicavel: editavel && !estado.conferindo, conferindo: editavel && estado.conferindo };
      $('plano-area').innerHTML = htmlResumo(fonte.plano.resumo) + htmlPendencias(fonte.pendencias) + htmlErros(fonte.plano.erros) +
        (fonte.plano.grupos.length ? fonte.plano.grupos.map((g, i) => htmlGrupo(g, opcoes, i)).join('') : '<p class="vazio">Nenhuma peça para cortar (veja as pendências).</p>') +
        (opcoes.conferindo ? htmlBaixaEstoque(gruposComVarasNovas(fonte.plano), estado.produtos) : '');
      $('btn-salvar').hidden = !(modo === 'previa' && pode('corte.planejar') && previa.qtdPecas > 0 && !(previa.planoSalvo && previa.planoSalvo.situacao === 'conferido'));
      $('btn-refazer').hidden = !(modo === 'salvo' && editavel && !estado.conferindo);
      $('btn-conferir').hidden = !(editavel && !estado.conferindo);
      $('btn-confirmar').hidden = !(editavel && estado.conferindo);
      $('btn-cancelar-plano').hidden = !editavel;
    }
    async function carregarPlano(numero, { semEnviar = false } = {}) {
      if (!semEnviar) await enviarPendentes();
      const seq = ++estado.seq;
      estado.numero = numero; estado.conferindo = false; estado.cortadas = new Set();
      mensagem('plano-area', 'Carregando…'); $('plano-titulo').textContent = ''; $('btn-excluir-dados').hidden = true;
      try {
        const previa = await chamar('/corte/pedido/' + encodeURIComponent(numero));
        let salvo = null;
        if (previa.planoSalvo && previa.planoSalvo.situacao !== 'cancelado') salvo = await chamar('/corte/plano/' + encodeURIComponent(previa.planoSalvo.id));
        if (seq !== estado.seq) return;
        estado.previa = previa; estado.salvo = salvo; estado.modo = salvo ? 'salvo' : 'previa';
        estado.cortadas = adotarPlano(salvo ? salvo.id : null, (salvo && salvo.cortadas) || []);
        desenharPlano();
      } catch (err) {
        if (seq !== estado.seq) return;
        mensagem('plano-area', err.status === 403 ? 'Você não tem permissão para ver o plano de corte.' : err.status === 404 ? 'Pedido não encontrado.' : 'Não foi possível carregar: ' + err.message, 'erro');
        ['btn-salvar', 'btn-refazer', 'btn-conferir', 'btn-confirmar', 'btn-cancelar-plano'].forEach(id => { $(id).hidden = true; });
      }
    }
    async function acao(botao, fazer, okMsg) {
      if (estado.ocupado) return;
      estado.ocupado = true; botao.disabled = true;
      try { await enviarPendentes(); await fazer(); if (okMsg) toast(okMsg, 'ok'); await carregarPlano(estado.numero); }
      catch (err) { toast(err.message, 'erro'); if (err.status === 409) await carregarPlano(estado.numero); }
      finally { estado.ocupado = false; botao.disabled = false; }
    }
    function linhasConferencia() {
      return [...doc.querySelectorAll('.conf-linha')].map(el => {
        const destino = el.querySelector('.conf-destino'), medida = el.querySelector('.conf-medida');
        return { grupo: el.dataset.grupo, barra: Number(el.dataset.barra), destino: destino ? destino.value : 'descartar', medida: medida ? medida.value : '' };
      });
    }
    async function confirmar() {
      const naoUsados = [...doc.querySelectorAll('.conf-naousado:checked')].map(c => Number(c.dataset.id));
      // retalho informado como não usado não tem sobra a conferir
      const idDaBarra = l => { const g = estado.salvo.plano.grupos.find(x => x.chave === l.grupo); const b = g && g.barras[l.barra]; return b && b.tipo === 'retalho' ? b.retalhoId : null; };
      const linhas = linhasConferencia().filter(l => !naoUsados.includes(idDaBarra(l)));
      const erros = validarConferenciaForm(linhas, estado.salvo.plano);
      if (erros.length) { toast(erros[0], 'erro'); return; }
      // baixa no estoque: um produto por grupo que usa vara nova (o servidor confere de novo)
      const grupos = gruposComVarasNovas(estado.salvo.plano);
      const selecoes = [...doc.querySelectorAll('.baixa-produto')].map(el => ({ chave: el.dataset.chave, produtoCodigo: el.value }));
      if (grupos.length) {
        if (!pode('estoque.movimentar')) { toast('Este plano usa varas novas: dar baixa no estoque exige a permissão de dar saída no estoque.', 'erro'); return; }
        const errosBaixa = validarBaixasForm(grupos, selecoes);
        if (errosBaixa.length) { toast(errosBaixa[0], 'erro'); return; }
      }
      const nomeProduto = s => { const p = (estado.produtos || []).find(x => String(x.codigo) === String(s.produtoCodigo)); return p ? p.nome : s.produtoCodigo; };
      const resumoBaixa = grupos.map(g => `${g.varas} × ${nomeProduto(selecoes.find(x => x.chave === g.chave))}`).join(', ');
      if (!win.confirm('Confirmar o corte? Os retalhos usados saem do estoque de retalhos e as sobras conferidas entram como retalhos.' +
        (grupos.length ? `\n\nBaixa no estoque das varas novas: ${resumoBaixa}.` : '') +
        '\n\nIsto não pode ser desfeito por aqui (a saída de estoque só se desfaz pelo estorno em Movimentação de estoque).')) return;
      await acao($('btn-confirmar'), () => chamar(`/corte/plano/${estado.salvo.id}/confirmar`, { metodo: 'POST', corpo: corpoConferencia(linhas, naoUsados, grupos.length ? corpoBaixas(selecoes) : []) }), 'Corte confirmado.');
    }
    // clique na peça: atualiza a tela e o localStorage na hora; o envio ao servidor é adiado e feito em lote
    function marcarPeca(botao) {
      const { grupo, barra, peca } = botao.dataset;
      const chave = chaveCortada(grupo, Number(barra), Number(peca)), feita = !estado.cortadas.has(chave);
      if (feita) estado.cortadas.add(chave); else estado.cortadas.delete(chave);
      sync.pendentes.set(chave, { grupo, barra: Number(barra), peca: Number(peca), cortada: feita });
      gravarPendentes(); agendarEnvio(ESPERA_ENVIO_MS);
      desenharPlano(); mostrarSync();
    }

    // ---- retalhos ----
    async function carregarRetalhos() {
      mensagem('retalhos-lista', 'Carregando…');
      try {
        const f = $('filtro-retalhos').value;
        const d = await chamar('/corte/retalhos' + (f ? '?situacao=' + encodeURIComponent(f) : ''));
        estado.retalhos = d.retalhos;
        $('retalhos-lista').innerHTML = htmlRetalhos(d.retalhos, pode('corte.parametros'), pode('corte.planejar'));
      } catch (err) { mensagem('retalhos-lista', err.status === 403 ? 'Você não tem permissão para ver os retalhos.' : 'Não foi possível carregar: ' + err.message, 'erro'); }
    }
    function limparFormRetalho() { for (const id of ['r-id', 'r-perfil', 'r-acabamento', 'r-cor', 'r-comprimento']) $(id).value = ''; $('btn-retalho').querySelector('span').textContent = 'Cadastrar retalho'; }
    async function salvarRetalho(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const id = $('r-id').value;
      const corpo = { perfil: $('r-perfil').value, acabamento: $('r-acabamento').value, cor: $('r-cor').value, comprimento: $('r-comprimento').value };
      estado.ocupado = true; $('btn-retalho').disabled = true; $('erro-retalho').textContent = '';
      try {
        await chamar(id ? '/corte/retalhos/' + encodeURIComponent(id) : '/corte/retalhos', { metodo: id ? 'PUT' : 'POST', corpo });
        toast(id ? 'Retalho ajustado.' : 'Retalho cadastrado.', 'ok'); limparFormRetalho(); await carregarRetalhos();
      } catch (err) { $('erro-retalho').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-retalho').disabled = false; }
    }
    async function cliqueRetalho(ev) {
      const b = ev.target.closest('[data-acao]');
      if (!b) return;
      if (b.dataset.acao === 'cancelar-plano') {
        if (!win.confirm(`Cancelar o plano nº ${b.dataset.plano}? Os retalhos reservados por ele voltam a ficar disponíveis.`)) return;
        try { await chamar(`/corte/plano/${encodeURIComponent(b.dataset.plano)}/cancelar`, { metodo: 'POST' }); toast('Plano cancelado.', 'ok'); await carregarRetalhos(); }
        catch (err) { toast(err.message, 'erro'); }
        return;
      }
      const r = estado.retalhos.find(x => String(x.id) === b.dataset.id);
      if (!r) return;
      if (b.dataset.acao === 'editar') {
        $('r-id').value = r.id; $('r-perfil').value = r.perfil; $('r-acabamento').value = r.acabamento; $('r-cor').value = r.cor; $('r-comprimento').value = r.comprimento;
        $('btn-retalho').querySelector('span').textContent = 'Salvar ajuste'; $('r-perfil').focus(); return;
      }
      if (!win.confirm(`Descartar o retalho de ${mm(r.comprimento)} (${r.perfil})?`)) return;
      try { await chamar(`/corte/retalhos/${encodeURIComponent(r.id)}/descartar`, { metodo: 'POST' }); toast('Retalho descartado.', 'ok'); await carregarRetalhos(); }
      catch (err) { toast(err.message, 'erro'); }
    }

    // ---- parâmetros ----
    async function carregarConfig() {
      mensagem('config-info', 'Carregando…');
      try { $('config-info').innerHTML = htmlConfig(await chamar('/corte/config')); }
      catch (err) { mensagem('config-info', err.status === 403 ? 'Você não tem permissão para ver os parâmetros.' : 'Não foi possível carregar: ' + err.message, 'erro'); }
    }
    async function salvarConfig(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const corpo = { perfil: $('c-perfil').value, comprimentoVara: $('c-vara').value, serra: $('c-serra').value, sobraMinima: $('c-sobra').value };
      estado.ocupado = true; $('btn-config').disabled = true; $('erro-config').textContent = '';
      try { await chamar('/corte/config', { metodo: 'PUT', corpo }); toast('Parâmetros gravados.', 'ok'); await carregarConfig(); }
      catch (err) { $('erro-config').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-config').disabled = false; }
    }

    for (const b of doc.querySelectorAll('[data-aba]')) b.addEventListener('click', () => aba(b.dataset.aba));
    $('form-pedido').addEventListener('submit', ev => { ev.preventDefault(); const n = txt($('numero').value); if (/^\d+$/.test(n)) carregarPlano(n); else toast('Informe o número do pedido.', 'erro'); });
    $('btn-salvar').addEventListener('click', () => acao($('btn-salvar'), () => chamar(`/corte/pedido/${estado.numero}/salvar`, { metodo: 'POST', corpo: corpoSalvar(estado.previa) }), 'Plano salvo e retalhos reservados.'));
    $('btn-refazer').addEventListener('click', () => { estado.modo = 'previa'; estado.conferindo = false; desenharPlano(); });
    $('btn-excluir-dados').addEventListener('click', () => {
      const previa = estado.previa;
      if (!previa) return;
      if (previa.qtdConferidos > 0 && !pode('corte.parametros')) { toast('Este pedido tem plano já conferido: só quem tem a permissão de parâmetros do corte pode excluí-lo.', 'erro'); return; }
      if (!win.confirm(textoConfirmarExclusao(previa))) return;
      acao($('btn-excluir-dados'), () => chamar('/corte/pedido/' + encodeURIComponent(estado.numero), { metodo: 'DELETE', corpo: previa.qtdConferidos > 0 ? { incluirConferidos: true } : {} }), 'Dados do plano excluídos.');
    });
    // ao conferir, carrega os produtos do estoque (uma vez) para a baixa das varas novas
    async function carregarProdutosEstoque() {
      if (estado.produtos || !pode('estoque.movimentar')) return;
      try { estado.produtos = (await chamar('/corte/estoque/produtos')).produtos; } catch { estado.produtos = null; }
    }
    $('btn-conferir').addEventListener('click', async () => {
      if (gruposComVarasNovas(estado.salvo && estado.salvo.plano).length) await carregarProdutosEstoque();
      estado.conferindo = true; desenharPlano();
    });
    $('btn-confirmar').addEventListener('click', confirmar);
    $('btn-cancelar-plano').addEventListener('click', () => {
      if (win.confirm('Cancelar este plano? Os retalhos reservados voltam a ficar disponíveis.')) acao($('btn-cancelar-plano'), () => chamar(`/corte/plano/${estado.salvo.id}/cancelar`, { metodo: 'POST' }), 'Plano cancelado.');
    });
    $('plano-area').addEventListener('click', ev => { const b = ev.target.closest('button.peca'); if (b && !b.disabled) marcarPeca(b); });
    $('filtro-retalhos').addEventListener('change', carregarRetalhos);
    $('retalhos-lista').addEventListener('click', cliqueRetalho);
    $('form-retalho').addEventListener('submit', salvarRetalho);
    $('btn-retalho-limpar').addEventListener('click', limparFormRetalho);
    $('form-config').addEventListener('submit', salvarConfig);
    $('form-retalho').hidden = !pode('corte.parametros');   // a segurança de verdade é no servidor (corte.parametros)
    $('form-config').hidden = !pode('corte.parametros');
    aba('plano');
    const n = new win.URLSearchParams(win.location.search).get('numero');
    if (n && /^\d+$/.test(n)) { $('numero').value = n; carregarPlano(n); } else mensagem('plano-area', 'Informe o número de um pedido para ver ou gerar o plano de corte.');
  }

  return { mm, pctTxt, larguraPct, rotuloOrigem, rotuloSituacao, chaveCortada, estiloGrupo, contarPecas, textoStatusPlano, textoConfirmarExclusao, htmlBarra, htmlGrupo, htmlResumo, htmlPendencias, htmlErros,
    corpoSalvar, corpoConferencia, validarConferenciaForm, gruposComVarasNovas, sugerirProduto, htmlBaixaEstoque, corpoBaixas, validarBaixasForm, htmlRetalhos, htmlConfig, iniciar };
});
