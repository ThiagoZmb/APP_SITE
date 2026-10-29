// ==========================================================================
// corte_vidros.html — Plano de corte de vidros de um Pedido (chapas, retalhos, conferência do corte real, baixa de chapas no estoque) e parâmetros.
// Rotas: GET /corte_vidros/pedido/:n?escolhas=, POST /corte_vidros/pedido/:n/salvar, DELETE /corte_vidros/pedido/:n, GET /corte_vidros/plano/:id,
//        PUT /corte_vidros/plano/:id/pecas, POST /corte_vidros/plano/:id/confirmar|cancelar, GET /corte_vidros/estoque/produtos,
//        GET/PUT /corte_vidros/config, GET/POST/PUT /corte_vidros/retalhos, POST /corte_vidros/retalhos/:id/descartar.
// Funções puras testadas no Node (test/corte_vidros_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou value/textContent. Quem decide o acesso é o servidor.
// Medidas em mm inteiros. Na chapa, x corre na largura e y na altura; cada peça é desenhada em % da chapa (sem biblioteca de gráficos).
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.CorteVidros = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt } = C;

  // ---------- lista de pedidos para escolher ----------
  const semAcento = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function filtrarPedidos(lista, busca) {
    const q = semAcento(txt(busca)); const todos = Array.isArray(lista) ? lista : [];
    if (!q) return todos;
    return todos.filter(p => String(p.numero).includes(q) || semAcento(p.cliente).includes(q));
  }
  function htmlListaPedidos(lista, busca) {
    const achados = filtrarPedidos(lista, busca).slice(0, 200);
    if (!achados.length) return '<p class="vazio">Nenhum pedido encontrado.</p>';
    return '<ul>' + achados.map(p => `<li><button type="button" data-numero="${esc(p.numero)}"><span class="p-num">${esc(p.numero)}</span><span class="p-cli">${esc(p.cliente)}</span><span class="p-meta">${esc(p.data)}${p.situacao ? ' · ' + esc(p.situacao) : ''}</span></button></li>`).join('') + '</ul>';
  }

  // ---------- formatação ----------
  const mm = n => (n === null || n === undefined || !Number.isFinite(Number(n))) ? '—' : Number(n).toLocaleString('pt-BR') + ' mm';
  const num = n => Number(n).toLocaleString('pt-BR');
  const medida = (altura, largura) => `${num(altura)} × ${num(largura)} mm`;
  const pctTxt = n => (n === null || n === undefined || !Number.isFinite(Number(n))) ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  const pct = (parte, total) => (!(total > 0) || !(parte > 0)) ? 0 : Math.min(100, Math.round(parte / total * 10000) / 100);
  const SITUACOES = { gerado: 'Gerado (aguardando corte)', conferido: 'Conferido (corte confirmado)', cancelado: 'Cancelado',
    desatualizado: 'Desatualizado: o pedido mudou depois do plano — refaça o plano' };
  const rotuloSituacao = s => SITUACOES[s] || String(s ?? '');
  const semCor = v => txt(v) || '(sem cor)';
  const rotuloGrupo = g => txt(g.modelo) + (txt(g.cor) ? ' / ' + txt(g.cor) : '');
  const MATIZES = [212, 275, 24, 336, 190, 252, 8, 300];
  const estiloGrupo = i => { const h = MATIZES[((i % MATIZES.length) + MATIZES.length) % MATIZES.length]; return `--g-solido:hsl(${h} 55% 30%);--g-fundo:hsl(${h} 60% 95%);--g-peca:hsl(${h} 70% 83%);--g-borda:hsl(${h} 50% 42%)`; };
  const contarPecas = plano => ((plano && plano.grupos) || []).reduce((s, g) => s + g.chapas.reduce((t, c) => t + c.pecas.length, 0), 0);
  const chaveCortada = (grupo, chapa, peca) => `${grupo}\u0001${chapa}\u0001${peca}`;
  // aproveitamento geral = área das peças / área das chapas (e retalhos) usadas
  function aproveitamentoGeral(plano) {
    let pecas = 0, total = 0;
    for (const g of (plano && plano.grupos) || []) for (const c of g.chapas) { total += c.altura * c.largura; for (const p of c.pecas) pecas += p.altura * p.largura; }
    return total > 0 ? Math.round(pecas * 1000 / total) / 10 : null;
  }

  // ---------- chapas desenhadas em escala ----------
  const ALTURA_PX = 380;   // altura em pixels da chapa inteira do grupo; retalhos e outras chapas seguem a mesma escala
  // `conferindo` mostra, abaixo da chapa, uma linha por sobra (medida real e destino)
  function htmlConferencia(chave, c, i) {
    const linhas = (c.sobras || []).map((s, k) => `<div class="conf-linha" data-grupo="${esc(chave)}" data-chapa="${i}" data-sobra="${k}"><b>Sobra S${k + 1}</b> <span class="cinza">calculada ${esc(medida(s.altura, s.largura))}</span>` +
      `<label>Altura real (mm) <input class="conf-altura" inputmode="numeric" value="${esc(s.altura)}" aria-label="Altura real da sobra S${k + 1}"></label>` +
      `<label>Largura real (mm) <input class="conf-largura" inputmode="numeric" value="${esc(s.largura)}" aria-label="Largura real da sobra S${k + 1}"></label>` +
      `<label>Destino <select class="conf-destino"><option value="guardar" selected>Guardar como retalho</option><option value="descartar">Descartar</option></select></label></div>`).join('');
    const naoUsado = c.tipo === 'retalho' ? `<label class="nao-usado"><input type="checkbox" class="conf-naousado" data-id="${esc(c.retalhoId)}"> Este retalho não foi usado</label>` : '';
    return linhas || naoUsado ? `<div class="conf-bloco">${naoUsado}${linhas}</div>` : '';
  }
  // opcoes: { cortadas: Set, clicavel: bool, conferindo: bool }
  function htmlChapa(g, c, i, opcoes = {}) {
    const cortadas = opcoes.cortadas || new Set();
    const retalho = c.tipo === 'retalho';
    const titulo = retalho ? `Retalho nº ${esc(c.retalhoId)} · ${esc(medida(c.altura, c.largura))}` : `Chapa nova · ${esc(medida(c.altura, c.largura))}`;
    const referencia = (g.chapa && g.chapa.altura > 0) ? g.chapa.altura : c.altura;
    const alturaPx = Math.max(60, Math.round(ALTURA_PX * c.altura / referencia));
    const pecas = (c.pecas || []).map((p, k) => {
      const feita = cortadas.has(chaveCortada(g.chave, i, k));
      const giro = p.girada ? ' · girada (rodada 90°)' : '';
      return `<button type="button" class="peca-v${feita ? ' cortada' : ''}" style="left:${pct(p.x, c.largura)}%;top:${pct(p.y, c.altura)}%;width:${pct(p.largura, c.largura)}%;height:${pct(p.altura, c.altura)}%" aria-pressed="${feita}"` +
        `${opcoes.clicavel ? '' : ' disabled'} data-grupo="${esc(g.chave)}" data-chapa="${i}" data-peca="${k}" title="Item ${esc(p.item)} · ${esc(medida(p.altura, p.largura))}${giro}">` +
        `<span class="peca-n">${feita ? '✓ ' : ''}${esc(p.item)}${p.girada ? ' <i class="giro" aria-hidden="true">↻</i>' : ''}</span><small>${esc(p.altura)}×${esc(p.largura)}</small></button>`;
    }).join('');
    const sobras = (c.sobras || []).map((s, k) => `<div class="sobra-vidro" style="left:${pct(s.x, c.largura)}%;top:${pct(s.y, c.altura)}%;width:${pct(s.largura, c.largura)}%;height:${pct(s.altura, c.altura)}%" title="Sobra S${k + 1}: ${esc(medida(s.altura, s.largura))}">S${k + 1}</div>`).join('');
    const cortes = (c.pecas || []).map((p, k) => `<li>Item ${esc(p.item)} (medição ${esc(p.medicao)}): ${esc(medida(p.altura, p.largura))}${p.girada ? ' — girada' : ''}</li>`).join('');
    const feitas = (c.pecas || []).filter((p, k) => cortadas.has(chaveCortada(g.chave, i, k))).length;
    const completa = (c.pecas || []).length > 0 && feitas === c.pecas.length;
    return `<div class="chapa${retalho ? ' retalho' : ''}${completa ? ' completa' : ''}" role="group" aria-label="${titulo}"><div class="chapa-titulo"><b>${titulo}</b>` +
      `${completa ? '<span class="selo-completa">✓ Completa</span>' : ''}<span class="cinza">aproveitamento ${esc(pctTxt(c.aproveitamentoPct))}</span></div>` +
      `<div class="chapa-caixa" style="aspect-ratio:${esc(c.largura)} / ${esc(c.altura)};height:${alturaPx}px">${pecas}${sobras}</div>` +
      `<details class="lista-cortes"><summary>Lista de cortes (${(c.pecas || []).length})</summary><ul>${cortes}</ul></details>` +
      `${opcoes.conferindo ? htmlConferencia(g.chave, c, i) : ''}</div>`;
  }
  function htmlGrupo(g, opcoes = {}, indice = 0) {
    const cortadas = opcoes.cortadas || new Set();
    const total = g.chapas.reduce((s, c) => s + c.pecas.length, 0);
    const feitas = g.chapas.reduce((s, c, i) => s + c.pecas.filter((p, k) => cortadas.has(chaveCortada(g.chave, i, k))).length, 0);
    const produto = g.aguardandoProduto ? '<span class="chip">produto não escolhido</span>' : `<span class="chip">${esc(g.produtoNome ?? ('produto ' + g.produtoCodigo))}${g.chapa ? ' · ' + esc(medida(g.chapa.altura, g.chapa.largura)) : ''}</span>`;
    return `<section class="grupo" style="${estiloGrupo(indice)}"><h3><span class="nome-modelo">${esc(g.modelo)}</span> <span class="chip">${esc(semCor(g.cor))}</span> ${produto}` +
      `<span class="progresso-grupo">${feitas} de ${total} peças cortadas</span></h3>` +
      (g.chapas.length ? g.chapas.map((c, i) => htmlChapa(g, c, i, opcoes)).join('') : '<p class="vazio">Sem chapas neste grupo.</p>') + '</section>';
  }
  function textoConfirmarExclusao(previa) {
    const n = previa.qtdPlanosGravados, base = `Excluir TODOS os dados de plano de corte de vidros do pedido nº ${previa.pedido.numero} (${n} plano${n === 1 ? '' : 's'})?\n\nOs retalhos reservados por esses planos voltam a ficar disponíveis. Isto não pode ser desfeito.`;
    if (!(previa.qtdConferidos > 0)) return base;
    return base + `\n\nATENÇÃO: ${previa.qtdConferidos} plano${previa.qtdConferidos === 1 ? ' JÁ CONFERIDO' : 's JÁ CONFERIDOS'} (corte real confirmado) serão apagados do histórico. ` +
      'Os retalhos que esses cortes usaram ou criaram continuam no estoque de retalhos e a baixa de chapas já feita no estoque não é desfeita: o material físico não volta.';
  }
  function textoStatusPlano({ modo, salvo, total = 0, cortadas = 0, planoSalvoConferido = false }) {
    if (modo !== 'salvo') return planoSalvoConferido ? 'Este pedido já tem um plano conferido; abaixo está só uma simulação.'
      : 'Pré-visualização: nada foi gravado nem reservado. Salve o plano para marcar as peças cortadas e reservar os retalhos.';
    const aberto = salvo.situacao === 'gerado' || salvo.situacao === 'desatualizado';
    return `Plano nº ${salvo.id}: ${rotuloSituacao(salvo.situacao)}. ${cortadas} de ${total} peças cortadas.` + (aberto ? ' Clique numa peça para dar baixa quando ela for cortada (clique de novo para desfazer). As baixas ficam salvas neste aparelho na hora e são enviadas ao servidor em lote.' : '');
  }
  function htmlResumo(r) {
    const cel = (t, v) => `<div><dt>${esc(t)}</dt><dd>${esc(v)}</dd></div>`;
    return '<dl class="resumo">' + cel('Chapas novas', r.qtdChapasNovas) + cel('Retalhos usados', r.qtdRetalhosUsados) + cel('Aproveitamento', pctTxt(r.aproveitamentoPct)) + '</dl>';
  }
  const htmlPendencias = lista => !lista || !lista.length ? '' :
    `<div class="aviso-pendencia" role="alert"><b>Pendências — estas peças ficaram fora do plano:</b><ul>${lista.map(p => `<li>Item ${esc(p.item)}${p.modelo ? ' — ' + esc(p.modelo) : ''}: ${esc(p.motivo)}</li>`).join('')}</ul></div>`;

  // Salvar fica bloqueado enquanto um grupo não tem produto escolhido ou tem erro; os motivos aparecem na tela
  function motivosBloqueio(plano) {
    const motivos = [];
    for (const g of (plano && plano.grupos) || []) {
      if (g.aguardandoProduto) motivos.push(`${rotuloGrupo(g)}: escolha o produto (vidro) do estoque para este grupo.`);
      for (const e of g.erros || []) motivos.push(`${rotuloGrupo(g)}: ${e}`);
    }
    return motivos;
  }
  const htmlBloqueios = motivos => !motivos || !motivos.length ? '' :
    `<div class="aviso-pendencia" role="alert"><b>O plano não pode ser salvo ainda:</b><ul>${motivos.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;

  // ---------- escolha do produto (chapa) de cada grupo ----------
  // grupos: previa.grupos [{ chave, modelo, cor, qtdPecas, candidatos, preSelecionado }]; escolhas: { chave: codigo } já feitas; todos: lista completa de vidros (opcional)
  function htmlSeletorProdutos(grupos, escolhas = {}, todos = null) {
    if (!grupos || !grupos.length) return '';
    const linhas = grupos.map(g => {
      const lista = g.candidatos.length ? g.candidatos : (todos || []);
      const escolhido = escolhas[g.chave] !== undefined ? Number(escolhas[g.chave]) : (g.preSelecionado ?? null);
      const opcoes = '<option value="">— escolha o produto —</option>' + lista.map(p =>
        `<option value="${esc(p.codigo)}"${escolhido === p.codigo ? ' selected' : ''}>${esc(p.nome)} (${esc(medida(p.altura, p.largura))})${Number.isFinite(Number(p.qtdEstoque)) ? ' — ' + esc(chapasTxt(p.qtdEstoque)) + ' no estoque' : ''}</option>`).join('');
      const aviso = g.candidatos.length ? '' : `<p class="erro-form" role="status">Nenhum vidro do estoque tem o nome «Vidro ${esc(g.modelo)}»${todos && todos.length ? '; escolha na lista completa.' : '. Ajuste o cadastro no estoque.'}</p>`;
      return `<div class="escolha-linha"><div><b>${esc(g.modelo)}</b> <span class="chip">${esc(semCor(g.cor))}</span> <span class="cinza">${esc(g.qtdPecas)} peça${g.qtdPecas === 1 ? '' : 's'}</span></div>` +
        `<select class="escolha-produto" data-chave="${esc(g.chave)}" aria-label="Produto (chapa) para ${esc(g.modelo)} ${esc(semCor(g.cor))}">${opcoes}</select>${aviso}</div>`;
    });
    return '<section class="escolhas"><h3>Chapa de cada vidro</h3><p class="cinza">O produto escolhido define o tamanho da chapa. Mudar a escolha recalcula o plano.</p>' + linhas.join('') + '</section>';
  }
  // escolha do usuário manda; sem escolha vale o pré-selecionado pelo nome (se houver)
  function escolhasEfetivas(grupos, escolhas = {}) {
    const saida = {};
    for (const g of grupos || []) {
      const v = escolhas[g.chave] !== undefined ? escolhas[g.chave] : g.preSelecionado;
      if (v !== null && v !== undefined && v !== '') saida[g.chave] = Number(v);
    }
    return saida;
  }
  const queryEscolhas = escolhas => Object.keys(escolhas || {}).length ? '?escolhas=' + encodeURIComponent(JSON.stringify(escolhas)) : '';

  // ---------- baixa de chapas no estoque ----------
  // um item por GRUPO que tem chapa nova (retalho não está no estoque); o produto é o que definiu a chapa no plano
  const gruposComChapasNovas = plano => ((plano && plano.grupos) || [])
    .map(g => ({ chave: g.chave, modelo: g.modelo, cor: g.cor, produtoCodigo: g.produtoCodigo, produtoNome: g.produtoNome, chapas: g.chapas.filter(c => c.tipo === 'chapa').length }))
    .filter(g => g.chapas > 0);
  const corpoBaixas = grupos => grupos.map(g => ({ chave: g.chave, produtoCodigo: Number(g.produtoCodigo) }));
  // para mostrar: uma linha por produto com a soma de chapas (o corpo enviado continua por grupo)
  function produtosDaBaixa(grupos) {
    const mapa = new Map();
    for (const g of grupos) {
      if (!mapa.has(g.produtoCodigo)) mapa.set(g.produtoCodigo, { produtoCodigo: g.produtoCodigo, produtoNome: g.produtoNome, chapas: 0 });
      mapa.get(g.produtoCodigo).chapas += g.chapas;
    }
    return [...mapa.values()];
  }
  function htmlBaixaEstoque(grupos) {
    if (!grupos.length) return '';
    const linhas = produtosDaBaixa(grupos).map(p => `<div class="baixa-linha"><b>${esc(p.produtoNome ?? ('Produto ' + p.produtoCodigo))}</b> <span>${esc(p.chapas)} chapa${p.chapas === 1 ? '' : 's'} nova${p.chapas === 1 ? '' : 's'}</span></div>`);
    return '<section class="baixa-estoque"><h3>Baixa no estoque</h3><p class="cinza">As chapas novas usadas saem do estoque ao confirmar, com o produto com que o plano foi gerado. Retalhos não entram.</p>' + linhas.join('') + '</section>';
  }
  function validarBaixas(grupos) {
    const erros = [];
    for (const g of grupos) if (!Number.isInteger(Number(g.produtoCodigo)) || !(Number(g.produtoCodigo) > 0)) erros.push(`Escolha o produto do estoque para ${rotuloGrupo(g)} (refaça o plano).`);
    return erros;
  }

  // ---------- avisos antes de confirmar e saldo de chapas ----------
  const AVISO_RETALHO_NAO_USADO = 'As peças planejadas em retalho marcado como não usado NÃO terão baixa no estoque. Se você cortou essas peças de uma chapa nova, cancele, refaça o plano ou lance a saída de estoque manualmente.';
  const AVISO_DESATUALIZADO = 'O pedido mudou depois que este plano foi gerado. A baixa será feita pelo plano salvo.';
  // ids dos retalhos marcados como "não usado" que têm peças planejadas (essas peças não entram em nenhuma baixa de estoque)
  function retalhosNaoUsadosComPecas(plano, naoUsados) {
    const marcados = new Set((naoUsados || []).map(Number));
    const ids = [];
    for (const g of (plano && plano.grupos) || []) for (const c of g.chapas || []) if (c.tipo === 'retalho' && marcados.has(Number(c.retalhoId)) && (c.pecas || []).length) ids.push(Number(c.retalhoId));
    return ids;
  }
  function textoAvisosConfirmacao({ retalhosComPecas = [], situacao = '' }) {
    const avisos = [];
    if (retalhosComPecas.length) avisos.push(AVISO_RETALHO_NAO_USADO);
    if (situacao === 'desatualizado') avisos.push(AVISO_DESATUALIZADO);
    return avisos.join('\n\n');
  }
  // chapas NOVAS planejadas por produto (grupos diferentes podem usar o mesmo produto) contra o saldo do estoque
  function avisosSaldo(plano, candidatos) {
    const saldo = new Map((candidatos || []).filter(c => c && Number.isFinite(Number(c.qtdEstoque))).map(c => [Number(c.codigo), c]));
    const soma = new Map();
    for (const g of (plano && plano.grupos) || []) {
      const n = (g.chapas || []).filter(c => c.tipo === 'chapa').length;
      if (n && g.produtoCodigo) soma.set(Number(g.produtoCodigo), (soma.get(Number(g.produtoCodigo)) || 0) + n);
    }
    const avisos = [];
    for (const [codigo, necessarias] of soma) {
      const c = saldo.get(codigo);
      if (c && necessarias > Number(c.qtdEstoque)) avisos.push({ produtoCodigo: codigo, produtoNome: c.nome, necessarias, saldo: Number(c.qtdEstoque) });
    }
    return avisos;
  }
  const chapasTxt = n => `${num(n)} chapa${Number(n) === 1 ? '' : 's'}`;
  const htmlAvisosSaldo = avisos => !avisos || !avisos.length ? '' :
    `<div class="aviso-pendencia" role="status"><b>Estoque insuficiente (aviso, não bloqueia):</b><ul>${avisos.map(a => `<li>${esc(a.produtoNome ?? ('Produto ' + a.produtoCodigo))}: o plano usa ${esc(chapasTxt(a.necessarias))} novas e há ${esc(num(a.saldo))} no estoque.</li>`).join('')}</ul></div>`;

  // ---------- corpos de envio e validação ----------
  const corpoSalvar = (p, escolhas) => ({ impressao: p.impressao, retalhosUsados: p.retalhosUsados, escolhas: escolhas || {} });
  const inteiroMm = v => /^\d+$/.test(txt(v)) ? Number(txt(v)) : NaN;
  function corpoConferencia(linhas, naoUsados, baixas) {
    return { sobras: linhas.map(l => l.destino === 'guardar'
        ? { grupo: l.grupo, chapa: l.chapa, sobra: l.sobra, destino: 'guardar', altura: inteiroMm(l.altura), largura: inteiroMm(l.largura) }
        : { grupo: l.grupo, chapa: l.chapa, sobra: l.sobra, destino: 'descartar' }),
      retalhosNaoUsados: naoUsados, ...(Array.isArray(baixas) ? { baixas } : {}) };
  }
  // mesmas regras do servidor: guardar exige altura e largura inteiras > 0, não maiores que a sobra calculada e ambas >= sobra mínima
  function validarConferenciaForm(linhas, plano, sobraMinima) {
    const erros = [];
    for (const l of linhas) {
      if (l.destino !== 'guardar') continue;
      const g = (plano.grupos || []).find(x => x.chave === l.grupo);
      const calc = g && g.chapas[l.chapa] ? (g.chapas[l.chapa].sobras || [])[l.sobra] : null;
      const a = inteiroMm(l.altura), w = inteiroMm(l.largura);
      if (!calc || !(a > 0) || !(w > 0)) erros.push('Informe a altura e a largura reais da sobra como números inteiros de milímetros, maiores que zero.');
      else if (a > calc.altura || w > calc.largura) erros.push(`A sobra real (${a} × ${w} mm) não pode ser maior que a calculada (${calc.altura} × ${calc.largura} mm).`);
      else if (sobraMinima > 0 && (a < sobraMinima || w < sobraMinima)) erros.push(`A sobra real (${a} × ${w} mm) está abaixo da mínima (${sobraMinima} mm em cada lado): descarte-a.`);
    }
    return erros;
  }

  // ---------- retalhos e parâmetros ----------
  function htmlRetalhos(lista, podeParametros, podePlanejar = false) {
    if (!lista.length) return '<p class="vazio" role="status">Nenhum retalho nesta situação.</p>';
    const linhas = lista.map(r => `<tr><td>${esc(r.produtoNome ?? ('Produto ' + r.produtoCodigo))}</td><td class="num">${esc(medida(r.altura, r.largura))}</td>` +
      `<td>${esc(r.situacao)}${r.planoReserva ? ` (plano ${esc(r.planoReserva)})` : ''}</td><td>${r.planoOrigem ? `plano ${esc(r.planoOrigem)}` : 'manual'}</td>` +
      `<td>${podePlanejar && r.situacao === 'reservado' && r.planoReserva ? `<button type="button" class="btn btn-secondary" data-acao="cancelar-plano" data-plano="${esc(r.planoReserva)}">Cancelar plano ${esc(r.planoReserva)}</button>` : ''}${podeParametros && r.situacao === 'disponivel' ? `<button type="button" class="btn btn-secondary" data-acao="editar" data-id="${esc(r.id)}">Ajustar</button> <button type="button" class="btn btn-secondary" data-acao="descartar" data-id="${esc(r.id)}">Descartar</button>` : ''}</td></tr>`);
    return '<table><thead><tr><th>Vidro</th><th>Altura × largura</th><th>Situação</th><th>Origem</th><th>Ações</th></tr></thead><tbody>' + linhas.join('') + '</tbody></table>';
  }
  const htmlConfig = c => `<dl class="resumo"><div><dt>Serra</dt><dd>${esc(mm(c.padrao.serra))}</dd></div><div><dt>Sobra mínima (cada lado)</dt><dd>${esc(mm(c.padrao.sobraMinima))}</dd></div></dl>`;

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { numero: null, previa: null, salvo: null, modo: null, cortadas: new Set(), conferindo: false, ocupado: false, retalhos: [], seq: 0,
      escolhas: {}, produtos: null, sobraMinima: 0 };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const pode = p => !!(win.Acesso && win.Acesso.pode(p));
    const ABERTO = s => s === 'gerado' || s === 'desatualizado';
    const BOTOES = ['btn-salvar', 'btn-refazer', 'btn-conferir', 'btn-confirmar', 'btn-cancelar-plano'];

    // ---- baixa de peças "local": o clique só mexe na tela e no localStorage; o servidor recebe tudo junto (lote) ----
    const ESPERA_ENVIO_MS = 3000, ESPERA_REENVIO_MS = 15000;
    const sync = { plano: null, pendentes: new Map(), timer: null, enviando: null, erro: false };
    const chaveArmazem = id => 'corte_vidros_marcas_' + id;
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
        return Array.isArray(lista) ? lista.filter(m => m && typeof m.grupo === 'string' && Number.isInteger(m.chapa) && Number.isInteger(m.peca) && typeof m.cortada === 'boolean') : [];
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
          await chamar(`/corte_vidros/plano/${plano}/pecas`, { metodo: 'PUT', corpo: { marcas: lote.map(([, m]) => m) } });
          sync.erro = false;
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
      const cortadas = new Set(cortadasServidor.map(c => chaveCortada(c.grupo, c.chapa, c.peca)));
      if (id) for (const m of lerPendentes(id)) {
        const k = chaveCortada(m.grupo, m.chapa, m.peca);
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
      const situacao = modo === 'salvo' ? salvo.situacao : null;
      $('plano-status').textContent = textoStatusPlano({ modo, salvo, total: contarPecas(fonte.plano), cortadas: estado.cortadas.size, planoSalvoConferido: !!(previa.planoSalvo && previa.planoSalvo.situacao === 'conferido') });
      const editavel = modo === 'salvo' && ABERTO(situacao) && pode('corte.planejar');
      const opcoes = { cortadas: estado.cortadas, clicavel: editavel && !estado.conferindo, conferindo: editavel && estado.conferindo };
      const motivos = modo === 'previa' ? motivosBloqueio(fonte.plano) : [];
      const resumo = { ...fonte.plano.resumo, aproveitamentoPct: aproveitamentoGeral(fonte.plano) };
      $('plano-area').innerHTML = (modo === 'previa' ? htmlSeletorProdutos(previa.grupos, estado.escolhas, estado.produtos) : '') +
        htmlResumo(resumo) + htmlPendencias(fonte.pendencias) + htmlBloqueios(motivos) +
        (modo === 'previa' ? htmlAvisosSaldo(avisosSaldo(fonte.plano, (estado.produtos || []).concat(previa.grupos.flatMap(g => g.candidatos)))) : '') +
        (fonte.plano.grupos.length ? fonte.plano.grupos.map((g, i) => htmlGrupo(g, opcoes, i)).join('') : '<p class="vazio">Nenhuma peça para cortar (veja as pendências).</p>') +
        (opcoes.conferindo ? htmlBaixaEstoque(gruposComChapasNovas(fonte.plano)) : '');
      $('btn-salvar').hidden = !(modo === 'previa' && pode('corte.planejar') && previa.qtdPecas > 0 && !motivos.length && !(previa.planoSalvo && previa.planoSalvo.situacao === 'conferido'));
      $('btn-refazer').hidden = !(modo === 'salvo' && editavel && !estado.conferindo);
      $('btn-conferir').hidden = !(editavel && !estado.conferindo);
      $('btn-confirmar').hidden = !(editavel && estado.conferindo);
      $('btn-cancelar-plano').hidden = !editavel;
    }
    // pré-visualização com as escolhas atuais do usuário; só os grupos sem candidato pelo nome precisam da lista completa de vidros
    async function completarProdutos(previa) {
      if (previa.grupos.some(g => !g.candidatos.length) && !estado.produtos && pode('estoque.movimentar')) {
        try { estado.produtos = (await chamar('/corte_vidros/estoque/produtos')).produtos; } catch { /* sem a lista completa: o aviso do grupo explica */ }
      }
    }
    async function lerPrevia(numero) {
      const previa = await chamar('/corte_vidros/pedido/' + encodeURIComponent(numero) + queryEscolhas(estado.escolhas));
      await completarProdutos(previa);
      return previa;
    }
    async function carregarPlano(numero, { semEnviar = false, manterEscolhas = false } = {}) {
      if (!semEnviar) await enviarPendentes();
      const seq = ++estado.seq;
      if (!manterEscolhas) estado.escolhas = {};
      estado.numero = numero; estado.conferindo = false; estado.cortadas = new Set();
      mensagem('plano-area', 'Carregando…'); $('plano-titulo').textContent = ''; $('btn-excluir-dados').hidden = true;
      try {
        let salvo = null;
        const primeira = await chamar('/corte_vidros/pedido/' + encodeURIComponent(numero) + queryEscolhas(estado.escolhas));
        if (primeira.planoSalvo && primeira.planoSalvo.situacao !== 'cancelado') salvo = await chamar('/corte_vidros/plano/' + encodeURIComponent(primeira.planoSalvo.id));
        if (seq !== estado.seq) return;
        // as escolhas de um plano salvo valem como ponto de partida para "Refazer"
        if (salvo && !manterEscolhas) estado.escolhas = { ...(salvo.escolhas || {}) };
        const previa = salvo && Object.keys(estado.escolhas).length ? await chamar('/corte_vidros/pedido/' + encodeURIComponent(numero) + queryEscolhas(estado.escolhas)) : primeira;
        if (seq !== estado.seq) return;
        estado.previa = previa; estado.salvo = salvo; estado.modo = salvo ? 'salvo' : 'previa';
        estado.cortadas = adotarPlano(salvo ? salvo.id : null, (salvo && salvo.cortadas) || []);
        await completarProdutos(previa);
        if (seq !== estado.seq) return;
        desenharPlano();
      } catch (err) {
        if (seq !== estado.seq) return;
        mensagem('plano-area', err.status === 403 ? 'Você não tem permissão para ver o plano de corte.' : err.status === 404 ? err.message : 'Não foi possível carregar: ' + err.message, 'erro');
        BOTOES.forEach(id => { $(id).hidden = true; });
      }
    }
    // mudou a escolha de produto: recalcula só a pré-visualização
    async function recalcular() {
      const seq = ++estado.seq;
      try {
        const previa = await lerPrevia(estado.numero);
        if (seq !== estado.seq) return;
        estado.previa = previa; estado.modo = 'previa'; estado.conferindo = false;
        desenharPlano();
      } catch (err) { if (seq === estado.seq) toast('Não foi possível recalcular: ' + err.message, 'erro'); }
    }
    async function acao(botao, fazer, okMsg) {
      if (estado.ocupado) return;
      estado.ocupado = true; botao.disabled = true;
      try { await enviarPendentes(); await fazer(); if (okMsg) toast(okMsg, 'ok'); await carregarPlano(estado.numero); }
      catch (err) { toast(err.message, 'erro'); if (err.status === 409) await carregarPlano(estado.numero, { manterEscolhas: true }); }
      finally { estado.ocupado = false; botao.disabled = false; }
    }
    function linhasConferencia() {
      return [...doc.querySelectorAll('.conf-linha')].map(el => {
        const destino = el.querySelector('.conf-destino'), altura = el.querySelector('.conf-altura'), largura = el.querySelector('.conf-largura');
        return { grupo: el.dataset.grupo, chapa: Number(el.dataset.chapa), sobra: Number(el.dataset.sobra), destino: destino ? destino.value : 'descartar', altura: altura ? altura.value : '', largura: largura ? largura.value : '' };
      });
    }
    async function confirmar() {
      const naoUsados = [...doc.querySelectorAll('.conf-naousado:checked')].map(c => Number(c.dataset.id));
      // retalho informado como não usado não tem sobra a conferir
      const idDaChapa = l => { const g = estado.salvo.plano.grupos.find(x => x.chave === l.grupo); const c = g && g.chapas[l.chapa]; return c && c.tipo === 'retalho' ? c.retalhoId : null; };
      const linhas = linhasConferencia().filter(l => !naoUsados.includes(idDaChapa(l)));
      const erros = validarConferenciaForm(linhas, estado.salvo.plano, estado.sobraMinima);
      if (erros.length) { toast(erros[0], 'erro'); return; }
      // baixa no estoque: um item por grupo que usa chapa nova; o produto é o do plano (o servidor confere de novo)
      const grupos = gruposComChapasNovas(estado.salvo.plano);
      if (grupos.length) {
        if (!pode('estoque.movimentar')) { toast('Este plano usa chapas novas: dar baixa no estoque exige a permissão de dar saída no estoque.', 'erro'); return; }
        const errosBaixa = validarBaixas(grupos);
        if (errosBaixa.length) { toast(errosBaixa[0], 'erro'); return; }
      }
      const avisos = textoAvisosConfirmacao({ retalhosComPecas: retalhosNaoUsadosComPecas(estado.salvo.plano, naoUsados), situacao: estado.salvo.situacao });
      if (avisos && !win.confirm('ATENÇÃO\n\n' + avisos + '\n\nDeseja continuar mesmo assim?')) return;
      const resumoBaixa = produtosDaBaixa(grupos).map(p => `${p.chapas} × ${p.produtoNome ?? p.produtoCodigo}`).join(', ');
      if (!win.confirm('Confirmar o corte? Os retalhos usados saem do estoque de retalhos e as sobras guardadas entram como retalhos. Sobra que não for listada como guardada é descartada.' +
        (grupos.length ? `\n\nBaixa no estoque das chapas novas: ${resumoBaixa}.` : '') +
        '\n\nIsto não pode ser desfeito por aqui (a saída de estoque só se desfaz pelo estorno em Movimentação de estoque).')) return;
      await acao($('btn-confirmar'), () => chamar(`/corte_vidros/plano/${estado.salvo.id}/confirmar`, { metodo: 'POST', corpo: corpoConferencia(linhas, naoUsados, corpoBaixas(grupos)) }), 'Corte confirmado.');
    }
    // clique na peça: atualiza a tela e o localStorage na hora; o envio ao servidor é adiado e feito em lote
    function marcarPeca(botao) {
      const { grupo, chapa, peca } = botao.dataset;
      const chave = chaveCortada(grupo, Number(chapa), Number(peca)), feita = !estado.cortadas.has(chave);
      if (feita) estado.cortadas.add(chave); else estado.cortadas.delete(chave);
      sync.pendentes.set(chave, { grupo, chapa: Number(chapa), peca: Number(peca), cortada: feita });
      gravarPendentes(); agendarEnvio(ESPERA_ENVIO_MS);
      desenharPlano(); mostrarSync();
    }

    // ---- retalhos ----
    async function carregarProdutosRetalho() {
      const sel = $('r-produto');
      try {
        if (!estado.produtos) estado.produtos = (await chamar('/corte_vidros/estoque/produtos')).produtos;
        sel.innerHTML = '<option value="">— escolha o vidro —</option>' + estado.produtos.map(p => `<option value="${esc(p.codigo)}">${esc(p.nome)} (${esc(medida(p.altura, p.largura))})</option>`).join('');
      } catch { sel.innerHTML = '<option value="">Lista de vidros indisponível</option>'; }
    }
    async function carregarRetalhos() {
      mensagem('retalhos-lista', 'Carregando…');
      try {
        const f = $('filtro-retalhos').value;
        const d = await chamar('/corte_vidros/retalhos' + (f ? '?situacao=' + encodeURIComponent(f) : ''));
        estado.retalhos = d.retalhos;
        $('retalhos-lista').innerHTML = htmlRetalhos(d.retalhos, pode('corte.parametros'), pode('corte.planejar'));
        if (pode('corte.parametros') && !$('r-produto').options.length) await carregarProdutosRetalho();
      } catch (err) { mensagem('retalhos-lista', err.status === 403 ? 'Você não tem permissão para ver os retalhos.' : 'Não foi possível carregar: ' + err.message, 'erro'); }
    }
    function limparFormRetalho() { $('r-id').value = ''; $('r-produto').value = ''; $('r-altura').value = ''; $('r-largura').value = ''; $('btn-retalho').querySelector('span').textContent = 'Cadastrar retalho'; }
    async function salvarRetalho(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const id = $('r-id').value;
      const corpo = { produtoCodigo: $('r-produto').value, altura: $('r-altura').value, largura: $('r-largura').value };
      estado.ocupado = true; $('btn-retalho').disabled = true; $('erro-retalho').textContent = '';
      try {
        await chamar(id ? '/corte_vidros/retalhos/' + encodeURIComponent(id) : '/corte_vidros/retalhos', { metodo: id ? 'PUT' : 'POST', corpo });
        toast(id ? 'Retalho ajustado.' : 'Retalho cadastrado.', 'ok'); limparFormRetalho(); await carregarRetalhos();
      } catch (err) { $('erro-retalho').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-retalho').disabled = false; }
    }
    async function cliqueRetalho(ev) {
      const b = ev.target.closest('[data-acao]');
      if (!b) return;
      if (b.dataset.acao === 'cancelar-plano') {
        if (!win.confirm(`Cancelar o plano nº ${b.dataset.plano}? Os retalhos reservados por ele voltam a ficar disponíveis.`)) return;
        try { await chamar(`/corte_vidros/plano/${encodeURIComponent(b.dataset.plano)}/cancelar`, { metodo: 'POST' }); toast('Plano cancelado.', 'ok'); await carregarRetalhos(); }
        catch (err) { toast(err.message, 'erro'); }
        return;
      }
      const r = estado.retalhos.find(x => String(x.id) === b.dataset.id);
      if (!r) return;
      if (b.dataset.acao === 'editar') {
        $('r-id').value = r.id; $('r-produto').value = String(r.produtoCodigo); $('r-altura').value = r.altura; $('r-largura').value = r.largura;
        $('btn-retalho').querySelector('span').textContent = 'Salvar ajuste'; $('r-produto').focus(); return;
      }
      if (!win.confirm(`Descartar o retalho de ${medida(r.altura, r.largura)} (${r.produtoNome})?`)) return;
      try { await chamar(`/corte_vidros/retalhos/${encodeURIComponent(r.id)}/descartar`, { metodo: 'POST' }); toast('Retalho descartado.', 'ok'); await carregarRetalhos(); }
      catch (err) { toast(err.message, 'erro'); }
    }

    // ---- parâmetros ----
    async function carregarConfig() {
      mensagem('config-info', 'Carregando…');
      try {
        const c = await chamar('/corte_vidros/config');
        estado.sobraMinima = c.padrao.sobraMinima;
        $('config-info').innerHTML = htmlConfig(c);
      } catch (err) { mensagem('config-info', err.status === 403 ? 'Você não tem permissão para ver os parâmetros.' : 'Não foi possível carregar: ' + err.message, 'erro'); }
    }
    async function salvarConfig(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const corpo = { serra: $('c-serra').value, sobraMinima: $('c-sobra').value };
      estado.ocupado = true; $('btn-config').disabled = true; $('erro-config').textContent = '';
      try { await chamar('/corte_vidros/config', { metodo: 'PUT', corpo }); toast('Parâmetros gravados.', 'ok'); await carregarConfig(); }
      catch (err) { $('erro-config').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-config').disabled = false; }
    }

    for (const b of doc.querySelectorAll('[data-aba]')) b.addEventListener('click', () => aba(b.dataset.aba));
    $('form-pedido').addEventListener('submit', ev => { ev.preventDefault(); const n = txt($('numero').value); if (/^\d+$/.test(n)) carregarPlano(n); else toast('Informe o número do pedido.', 'erro'); });
    // "Abrir" mostra a lista de pedidos (GET /corte/pedidos); escolher um preenche o número e abre o plano. O campo continua digitável (Enter abre direto).
    const lista = { pedidos: null };
    const desenharLista = () => { $('lista-pedidos-itens').innerHTML = htmlListaPedidos(lista.pedidos, $('busca-lista').value); };
    const fecharLista = () => { $('lista-pedidos').hidden = true; $('btn-abrir').setAttribute('aria-expanded', 'false'); };
    $('btn-abrir').addEventListener('click', async () => {
      if (!$('lista-pedidos').hidden) { fecharLista(); return; }
      $('lista-pedidos').hidden = false; $('btn-abrir').setAttribute('aria-expanded', 'true');
      $('busca-lista').value = txt($('numero').value);
      if (!lista.pedidos) {
        $('lista-pedidos-itens').innerHTML = '<p class="vazio">Carregando…</p>';
        try { lista.pedidos = (await chamar('/corte/pedidos')).pedidos; }
        catch (err) { $('lista-pedidos-itens').innerHTML = '<p class="erro-estado" role="alert">' + esc(err.status === 403 ? 'Você não tem permissão para ver os pedidos.' : 'Não foi possível carregar a lista: ' + err.message) + '</p>'; return; }
      }
      desenharLista(); $('busca-lista').focus();
    });
    $('busca-lista').addEventListener('input', desenharLista);
    $('lista-pedidos-itens').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-numero]'); if (!b) return;
      $('numero').value = b.dataset.numero; fecharLista(); carregarPlano(b.dataset.numero);
    });
    $('btn-salvar').addEventListener('click', () => acao($('btn-salvar'), () =>
      chamar(`/corte_vidros/pedido/${encodeURIComponent(estado.numero)}/salvar`, { metodo: 'POST', corpo: corpoSalvar(estado.previa, escolhasEfetivas(estado.previa.grupos, estado.escolhas)) }), 'Plano salvo e retalhos reservados.'));
    // Refazer: volta à pré-visualização (já calculada com as escolhas do plano salvo); o plano salvo só é substituído ao salvar de novo
    $('btn-refazer').addEventListener('click', () => { estado.modo = 'previa'; estado.conferindo = false; desenharPlano(); });
    $('btn-excluir-dados').addEventListener('click', () => {
      const previa = estado.previa;
      if (!previa) return;
      if (previa.qtdConferidos > 0 && !pode('corte.parametros')) { toast('Este pedido tem plano já conferido: só quem tem a permissão de parâmetros do corte pode excluí-lo.', 'erro'); return; }
      if (!win.confirm(textoConfirmarExclusao(previa))) return;
      acao($('btn-excluir-dados'), () => chamar('/corte_vidros/pedido/' + encodeURIComponent(estado.numero), { metodo: 'DELETE', corpo: previa.qtdConferidos > 0 ? { incluirConferidos: true } : {} }), 'Dados do plano excluídos.');
    });
    $('btn-conferir').addEventListener('click', async () => {
      // a sobra mínima do servidor entra na conferência (só guardar exige os dois lados acima dela)
      try { const c = await chamar('/corte_vidros/config'); estado.sobraMinima = c.padrao.sobraMinima; } catch { /* o servidor confere de novo */ }
      estado.conferindo = true; desenharPlano();
    });
    $('btn-confirmar').addEventListener('click', confirmar);
    $('btn-cancelar-plano').addEventListener('click', () => {
      if (win.confirm('Cancelar este plano? Os retalhos reservados voltam a ficar disponíveis.')) acao($('btn-cancelar-plano'), () => chamar(`/corte_vidros/plano/${estado.salvo.id}/cancelar`, { metodo: 'POST' }), 'Plano cancelado.');
    });
    $('plano-area').addEventListener('click', ev => { const b = ev.target.closest('button.peca-v'); if (b && !b.disabled) marcarPeca(b); });
    $('plano-area').addEventListener('change', ev => {
      const s = ev.target.closest('select.escolha-produto');
      if (!s) return;
      if (s.value === '') delete estado.escolhas[s.dataset.chave]; else estado.escolhas[s.dataset.chave] = Number(s.value);
      recalcular();
    });
    $('filtro-retalhos').addEventListener('change', carregarRetalhos);
    $('retalhos-lista').addEventListener('click', cliqueRetalho);
    $('form-retalho').addEventListener('submit', salvarRetalho);
    $('btn-retalho-limpar').addEventListener('click', limparFormRetalho);
    $('form-config').addEventListener('submit', salvarConfig);
    $('form-retalho').hidden = !pode('corte.parametros');   // a segurança de verdade é no servidor (corte.parametros)
    $('form-config').hidden = !pode('corte.parametros');
    aba('plano');
    const n = new win.URLSearchParams(win.location.search).get('numero');
    if (n && /^\d+$/.test(n)) { $('numero').value = n; carregarPlano(n); } else mensagem('plano-area', 'Informe o número de um pedido para ver ou gerar o plano de corte de vidros.');
  }

  return { filtrarPedidos, htmlListaPedidos, mm, medida, pctTxt, pct, rotuloSituacao, chaveCortada, estiloGrupo, contarPecas, aproveitamentoGeral, textoStatusPlano, textoConfirmarExclusao,
    htmlChapa, htmlGrupo, htmlResumo, htmlPendencias, motivosBloqueio, htmlBloqueios, htmlSeletorProdutos, escolhasEfetivas, queryEscolhas,
    retalhosNaoUsadosComPecas, textoAvisosConfirmacao, avisosSaldo, htmlAvisosSaldo,
    gruposComChapasNovas, produtosDaBaixa, htmlBaixaEstoque, corpoBaixas, validarBaixas, corpoSalvar, corpoConferencia, validarConferenciaForm,
    htmlRetalhos, htmlConfig, iniciar };
});
