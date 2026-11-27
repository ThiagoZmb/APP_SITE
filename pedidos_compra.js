// ==========================================================================
// pedidos_compra.html — pedidos a fornecedor: sugestão do que comprar, montagem, PDF e acompanhamento.
// Rotas: /pedidos_compra (rotas/pedidos_compra.js). Regras: docs/regras/pedidos-compra.md
// Preço só como estimativa (último preço de compra) para quem tem administrativo.ver; o PDF não tem preços.
// Funções puras testadas no Node (test/pedidos_compra_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou value/textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.PedidosCompra = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt, dataBR } = C;

  const ROTULOS = { rascunho: 'Rascunho', enviado: 'Enviado', parcial: 'Chegou em parte', recebido: 'Recebido', encerrado: 'Encerrado', cancelado: 'Cancelado' };

  const inteiro = v => (/^\d+$/.test(txt(v)) && Number(txt(v)) > 0 ? Number(txt(v)) : null);
  const porCaixaDe = v => (txt(v) === '' ? 1 : inteiro(v));
  function totalUnidades(quantidade, porCaixa) {
    const q = inteiro(quantidade), c = porCaixaDe(porCaixa);
    return q && c ? q * c : null;
  }
  function textoTotal(quantidade, porCaixa, unidade) {
    const total = totalUnidades(quantidade, porCaixa);
    if (!total) return '';
    const un = txt(unidade) ? ' ' + txt(unidade) : '';
    const c = porCaixaDe(porCaixa);
    if (c === 1) return `${total}${un}`;
    const q = inteiro(quantidade);
    return `${q} ${q === 1 ? 'caixa' : 'caixas'} × ${c} = ${total}${un}`;
  }
  // ---- estimativa (último preço de compra): sem preço ou sem quantidade é null, nunca zero ----
  const estimativa = (unidades, preco) => (unidades > 0 && preco > 0 ? unidades * preco : null);
  const dinheiro = (v, casas = 2) => (v === null || v === undefined ? '—'
    : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas }));
  const diaMes = d => `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}`;
  // valores = a estimativa de cada item da lista (null quando falta preço ou quantidade)
  function textoEstimativaPedido(valores) {
    const com = valores.filter(v => v !== null), sem = valores.length - com.length;
    if (!com.length) return 'Estimativa do pedido: —';
    const total = dinheiro(com.reduce((s, v) => s + v, 0));
    return `Estimativa do pedido: ${total}${sem ? ` (parcial: ${sem} ${sem === 1 ? 'item' : 'itens'} sem preço)` : ''}`;
  }

  // sugestão (em unidades) → o que vai no campo "Pedir" (caixas, quando há mais de 1 por caixa)
  const caixasDe = (unidades, porCaixa) => (unidades ? String(Math.ceil(unidades / (porCaixa || 1))) : '');

  // o pedido fala a língua do fornecedor; sem descrição cadastrada, vale o nome da casa
  const descricao = i => i.nomeFornecedor || i.produto;
  const codigo = i => i.codFornecedor || '—';

  // coluna "A chegar" da combo: pedidos daqui; senão a marca antiga do cadastro
  function textoChegar({ aCaminho, pedidos = [], aguardando }) {
    if (aCaminho) return `${aCaminho}${pedidos.length ? ` (${pedidos.length > 1 ? 'pedidos' : 'pedido'} ${pedidos.join(', ')})` : ''}`;
    return aguardando ? 'Aguardando (sem pedido aqui)' : '—';
  }

  // Opções da combo "Adicionar item": os itens do fornecedor que ainda não estão na lista, os que faltam primeiro.
  // O texto leva o nome da casa e o do fornecedor (digitar um trecho de qualquer um filtra a lista).
  function opcoesCombo(produtos, sugestao, usados, numeroAberto) {
    const info = new Map(sugestao.map(i => [i.codigo, i]));
    const proprio = numeroAberto ? `em rascunho nº ${numeroAberto}` : '';   // o rascunho aberto não avisa sobre si mesmo
    const nomes = i => `${i.produto} | ${i.nomeFornecedor || '—'}`;
    const vezes = new Map();
    for (const p of produtos) vezes.set(nomes(p), (vezes.get(nomes(p)) || 0) + 1);
    const ja = new Set(usados);
    return produtos.filter(p => !ja.has(p.codigo)).map(p => {
      const s = info.get(p.codigo);
      const aviso = s && s.aviso !== proprio ? s.aviso : '';
      const sugerido = !!s && s.sugerido !== null && !aviso;
      const nota = !s ? '' : sugerido ? `sugerido: ${s.sugerido}${p.unidade ? ' ' + p.unidade : ''}` : aviso.startsWith('em rascunho') ? aviso : aviso || s.aCaminho ? '' : 'no mínimo';
      const repetido = vezes.get(nomes(p)) > 1 ? ` (cód. ${p.codigo})` : '';
      const base = nomes(p) + repetido;
      return { codigo: p.codigo, estoque: `${p.qtd}${p.unidade ? ' ' + p.unidade : ''}`, chegar: textoChegar(p), nome: p.produto + repetido, fornecedor: p.nomeFornecedor || '—', nota, texto: nota ? `${base}  [${nota}]` : base, sugerido };
    }).sort((a, b) => b.sugerido - a.sugerido);
  }

  function itensParaEnviar(linhas) {
    const itens = [];
    for (const l of linhas) {
      if (!l.marcado) continue;
      if (!totalUnidades(l.quantidade, l.porCaixa)) return { erro: `Informe a quantidade (inteira, maior que zero) de "${descricao(l)}".` };
      itens.push({ produtoCodigo: l.codigo, quantidade: inteiro(l.quantidade), porCaixa: porCaixaDe(l.porCaixa) });
    }
    return itens.length ? { itens } : { erro: 'Adicione pelo menos um item e informe a quantidade.' };
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const podeCriar = () => !!(win.Acesso && win.Acesso.pode('compras.criar'));
    const verCusto = () => !!(win.Acesso && win.Acesso.pode('administrativo.ver'));
    // pedido aberto: numero null = novo; chave identifica o pedido novo para o duplo clique não gravar dois
    const estado = { numero: null, chave: '', situacao: 'rascunho', fornecedor: '', linhas: [], produtos: [], sugestao: [], combo: [], visiveis: [], marcado: -1, ocupado: false, seq: 0, alterado: false, precos: new Map(), itensDetalhe: [] };
    const novaChave = () => (win.crypto?.randomUUID ? win.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const data = v => (v ? dataBR(String(v).slice(0, 10)) : '—');
    const selo = s => win.Situacoes.selo('compra', s, ROTULOS[s] || s);

    function mostrar(vista) {
      for (const v of ['lista', 'form', 'detalhe']) $('v-' + v).hidden = v !== vista;
    }

    // uma gravação por vez; o erro aparece e a tela continua como estava
    async function ocupado(fn) {
      if (estado.ocupado) return;
      estado.ocupado = true;
      try { await fn(); }
      catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }

    // ---------- lista ----------
    async function abrirLista() {
      estado.seq++;
      mostrar('lista');
      let lista;
      try { lista = await chamar('/pedidos_compra'); }
      catch (err) { toast(err.message, 'erro'); $('tb-lista').innerHTML = '<tr><td colspan="6" class="vazio">Não foi possível carregar.</td></tr>'; return; }
      $('tb-lista').innerHTML = lista.length
        ? lista.map(p => `<tr data-numero="${esc(p.numero)}" tabindex="0"><td><b>${esc(p.numero)}</b></td><td>${esc(p.fornecedor)}</td><td>${esc(data(p.criadoEm))}</td>` +
          `<td>${esc(data(p.enviadoEm))}</td><td>${selo(p.situacao)}</td><td class="num">${esc(p.qtdItens)}</td></tr>`).join('')
        : '<tr><td colspan="6" class="vazio">Nenhum pedido ainda.</td></tr>';
    }

    async function abrirPedido(numero) {
      const seq = ++estado.seq;   // vale o último pedido clicado
      let p;
      try { p = await chamar('/pedidos_compra/' + numero); }
      catch (err) { return toast(err.message, 'erro'); }
      if (seq !== estado.seq) return;
      Object.assign(estado, { numero: p.numero, situacao: p.situacao, fornecedor: p.fornecedor, alterado: false, precos: new Map() });
      if (p.situacao === 'rascunho' && podeCriar()) {
        estado.linhas = p.itens.map(i => ({ codigo: i.codigo, produto: i.produto, codFornecedor: i.codFornecedor, nomeFornecedor: i.nomeFornecedor, unidade: i.unidade, qtd: null, minimo: null, diasCobertura: null, aCaminho: null, aviso: '',
          marcado: true, porCaixa: String(i.porCaixa), quantidade: String(i.qtd / i.porCaixa) }));
        $('observacao').value = p.observacao;
        $('titulo-form').textContent = `Pedido nº ${p.numero} (rascunho)`;
        if (!(await preencherFornecedores(p.fornecedor))) return;
        desenharLinhas();
        botoesForm();
        mostrar('form');
        await carregarItens(p.fornecedor);
      } else desenharDetalhe(p);
    }

    // ---------- pedido enviado, fechado (ou rascunho para quem só vê) ----------
    function desenharDetalhe(p) {
      $('titulo-detalhe').textContent = `Pedido nº ${p.numero}`;
      $('resumo-detalhe').innerHTML = `${selo(p.situacao)} <span>${esc(p.fornecedor)} · criado ${esc(data(p.criadoEm))}${p.enviadoEm ? ' · enviado ' + esc(data(p.enviadoEm)) : ''}</span>`;
      estado.itensDetalhe = p.itens;
      desenharItensDetalhe();
      $('obs-detalhe').textContent = p.observacao ? 'Observação: ' + p.observacao : '';
      const chegou = p.itens.some(i => i.chegou > 0);
      $('btn-cancelar').hidden = !(p.situacao === 'enviado' && !chegou);
      $('btn-encerrar').hidden = !['enviado', 'parcial'].includes(p.situacao);
      mostrar('detalhe');
      carregarPrecos(p.fornecedor);
    }

    function desenharItensDetalhe() {
      $('tb-detalhe').innerHTML = estado.itensDetalhe.map(i => `<tr><td>${esc(codigo(i))}</td><td>${esc(descricao(i))}</td><td class="num">${esc(textoTotal(i.qtd / i.porCaixa, i.porCaixa, i.unidade))}</td>` +
        `<td class="num">${esc(i.chegou)}</td><td class="num">${i.falta ? esc(i.falta) : '✔'}</td>` +
        (verCusto() ? `<td class="num preco">${celulaPreco(i.codigo)}</td><td class="num preco">${esc(dinheiro(estimativa(i.qtd, precoDe(i.codigo))))}</td>` : '') + '</tr>').join('');
      $('total-detalhe').textContent = textoEstimativaPedido(estado.itensDetalhe.map(i => estimativa(i.qtd, precoDe(i.codigo))));
    }

    // ---------- estimativa (último preço de compra) ----------
    const precoDe = codigoItem => estado.precos.get(codigoItem)?.precoUnitario;
    function celulaPreco(codigoItem) {
      const p = estado.precos.get(codigoItem);
      return p ? `${esc(dinheiro(p.precoUnitario, 4))}<small>${esc(diaMes(p.data))}</small>` : '—';
    }
    const estimativaLinha = l => estimativa(totalUnidades(l.quantidade, l.porCaixa), precoDe(l.codigo));
    function totalForm() { $('total-form').textContent = textoEstimativaPedido(estado.linhas.map(estimativaLinha)); }

    // sem a permissão nem chama a rota; a resposta de um fornecedor ou pedido anterior é descartada (estado.seq)
    async function carregarPrecos(fornecedor) {
      const seq = estado.seq;
      if (!verCusto() || !fornecedor) return;
      let r;
      try { r = await chamar('/pedidos_compra/ultimos_precos?fornecedor=' + encodeURIComponent(fornecedor)); }
      catch (err) { if (seq === estado.seq) toast('Não foi possível buscar os últimos preços: ' + err.message, 'erro'); return; }
      if (seq !== estado.seq) return;
      estado.precos = new Map((r?.precos || []).map(p => [p.codigo, p]));
      if ($('v-detalhe').hidden === false) return desenharItensDetalhe();
      // no formulário só as células de preço mudam: o que está sendo digitado fica como está
      for (const tr of $('tb-itens').querySelectorAll('tr[data-k]')) {
        const l = estado.linhas[Number(tr.dataset.k)];
        tr.querySelector('.l-preco').innerHTML = celulaPreco(l.codigo);
        tr.querySelector('.l-estimativa').textContent = dinheiro(estimativaLinha(l));
      }
      totalForm();
    }

    async function mudarSituacao(acao, pergunta) {
      if (!win.confirm(pergunta)) return;
      await ocupado(async () => {
        await chamar(`/pedidos_compra/${estado.numero}/situacao`, { metodo: 'POST', corpo: { acao } });
        await abrirPedido(estado.numero);
      });
    }

    // ---------- formulário ----------
    async function preencherFornecedores(selecionado) {
      const sel = $('fornecedor'), seq = estado.seq;
      sel.innerHTML = '<option value="">Carregando…</option>';
      let lista = [];
      try { lista = await chamar('/pedidos_compra/fornecedores'); }
      catch (err) { toast(err.message, 'erro'); }
      if (seq !== estado.seq) return false;
      sel.innerHTML = '<option value="">Escolha o fornecedor</option>' + lista.map(f =>
        `<option value="${esc(f.fornecedor)}">${esc(f.fornecedor)}${f.qtdSugeridos ? ` (${esc(f.qtdSugeridos)} sugeridos)` : ''}</option>`).join('');
      if (selecionado && !lista.some(f => f.fornecedor === selecionado)) sel.add(new win.Option(selecionado, selecionado));
      sel.value = selecionado || '';
      return true;
    }

    async function novoPedido() {
      Object.assign(estado, { numero: null, chave: novaChave(), situacao: 'rascunho', fornecedor: '', linhas: [], alterado: false, precos: new Map(), seq: estado.seq + 1 });
      $('observacao').value = '';
      $('titulo-form').textContent = 'Novo pedido';
      limparCombo();
      desenharLinhas();
      botoesForm();
      mostrar('form');
      await preencherFornecedores('');
    }

    function limparCombo() {
      Object.assign(estado, { produtos: [], sugestao: [], combo: [] });
      $('busca-item').value = '';
      $('busca-item').disabled = true;
      $('busca-item').placeholder = 'Escolha o fornecedor primeiro';
      fecharLista();
    }

    // lista própria (a do navegador não deixa mudar a largura): nome da casa | nome do fornecedor | aviso
    const listaAberta = () => !$('combo-lista').hidden;
    function fecharLista() {
      $('combo-lista').hidden = true;
      $('combo-lista').innerHTML = '';
      estado.marcado = -1;
      $('busca-item').setAttribute('aria-expanded', 'false');
    }
    function abrirCombo() {
      if ($('busca-item').disabled) return;
      const filtro = txt($('busca-item').value).toLowerCase();
      estado.visiveis = estado.combo.filter(o => o.texto.toLowerCase().includes(filtro));
      if (estado.marcado >= estado.visiveis.length) estado.marcado = estado.visiveis.length - 1;
      $('combo-lista').innerHTML = estado.visiveis.length ? '<li class="c-titulo" aria-hidden="true"><span>Seu nome</span><span>Nome do fornecedor</span><span>Estoque</span><span>A chegar</span><span></span></li>' + estado.visiveis.map((o, k) =>
        `<li role="option" data-i="${k}" aria-selected="${k === estado.marcado}"${k === estado.marcado ? ' class="ativo"' : ''}>` +
        `<span class="c-nome">${esc(o.nome)}</span><span class="c-forn">${esc(o.fornecedor)}</span><span class="c-qtd" data-rot="Estoque">${esc(o.estoque)}</span><span class="c-chegar" data-rot="A chegar">${esc(o.chegar)}</span><span class="c-nota">${esc(o.nota)}</span></li>`).join('')
        : '<li class="c-vazio">Nenhum item deste fornecedor com esse texto (ou ele já está na lista).</li>';
      $('combo-lista').hidden = false;
      $('busca-item').setAttribute('aria-expanded', 'true');
    }
    function desenharCombo() {
      estado.combo = opcoesCombo(estado.produtos, estado.sugestao, estado.linhas.map(l => l.codigo), estado.numero);
      if (listaAberta()) abrirCombo();
    }

    function teclaNaCombo(e) {
      if (e.key === 'Escape' || e.key === 'Tab') return fecharLista();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!listaAberta()) abrirCombo();
        estado.marcado = Math.max(0, Math.min(estado.visiveis.length - 1, estado.marcado + (e.key === 'ArrowDown' ? 1 : -1)));
        abrirCombo();
        $('combo-lista').querySelector('.ativo')?.scrollIntoView?.({ block: 'nearest' });
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!listaAberta()) return abrirCombo();
        const opcao = estado.visiveis[estado.marcado] || (estado.visiveis.length === 1 ? estado.visiveis[0] : null);
        if (opcao) escolher(opcao);
      }
    }

    // todos os itens do fornecedor + o que está faltando (só para avisar na combo)
    async function carregarItens(fornecedor) {
      const seq = estado.seq;
      limparCombo();
      if (!fornecedor) return;
      carregarPrecos(fornecedor);   // em paralelo; a falha dos preços não impede montar o pedido
      $('busca-item').placeholder = 'Carregando itens…';
      const q = '?fornecedor=' + encodeURIComponent(fornecedor);
      const [produtos, sugestao] = await Promise.allSettled([chamar('/pedidos_compra/produtos' + q), chamar('/pedidos_compra/sugestao' + q)]);
      if (seq !== estado.seq) return;
      const falhou = [produtos, sugestao].find(r => r.status === 'rejected');
      if (falhou) toast(falhou.reason.message, 'erro');
      estado.produtos = produtos.value || [];
      estado.sugestao = sugestao.value?.itens || [];
      $('busca-item').disabled = !estado.produtos.length;
      $('busca-item').placeholder = estado.produtos.length ? 'Abra a lista ou digite parte do nome' : 'Nenhum item ativo deste fornecedor';
      desenharCombo();
    }

    async function trocarFornecedor() {
      const novo = $('fornecedor').value;
      if (estado.linhas.length && (estado.alterado || estado.numero) && !win.confirm('Trocar de fornecedor descarta os itens da lista. Continuar?')) { $('fornecedor').value = estado.fornecedor; return; }
      estado.fornecedor = novo;
      estado.linhas = [];
      estado.precos = new Map();
      estado.alterado = false;
      estado.seq++;
      desenharLinhas();
      await carregarItens(novo);
    }

    const ouTraco = v => (v === null || v === undefined ? '—' : esc(v));
    function desenharLinhas() {
      $('tb-itens').innerHTML = estado.linhas.length ? estado.linhas.map((l, k) =>
        `<tr data-k="${k}"><td>${esc(codigo(l))}</td>` +
        `<td>${esc(descricao(l))}${l.aviso ? `<small class="aviso-item">${esc(l.aviso)}</small>` : ''}</td>` +
        `<td class="num">${ouTraco(l.qtd)}</td><td class="num">${l.minimo ? esc(l.minimo) : '—'}</td>` +
        `<td class="num">${l.diasCobertura === null || l.diasCobertura === undefined ? '—' : esc(l.diasCobertura) + ' dias'}</td><td class="num">${ouTraco(l.aCaminho)}</td>` +
        `<td class="num"><input class="curto l-caixa" inputmode="numeric" aria-label="Unidades por caixa" value="${esc(l.porCaixa)}"></td>` +
        `<td class="num"><input class="curto l-qtd" inputmode="numeric" aria-label="Quantidade a pedir" value="${esc(l.quantidade)}"></td>` +
        `<td class="l-total">${esc(textoTotal(l.quantidade, l.porCaixa, l.unidade))}</td>` +
        (verCusto() ? `<td class="num preco l-preco">${celulaPreco(l.codigo)}</td><td class="num preco l-estimativa">${esc(dinheiro(estimativaLinha(l)))}</td>` : '') +
        `<td><button type="button" class="btn btn-secondary btn-mini l-tirar" aria-label="Tirar ${esc(descricao(l))}">✕</button></td></tr>`).join('')
        : `<tr><td colspan="${verCusto() ? 12 : 10}" class="vazio">Escolha os itens em "Adicionar item".</td></tr>`;
      totalForm();
    }

    function digitou(e) {
      const tr = e.target.closest('tr[data-k]');
      if (!tr) return;
      const l = estado.linhas[Number(tr.dataset.k)];
      if (e.target.classList.contains('l-qtd')) l.quantidade = e.target.value;
      if (e.target.classList.contains('l-caixa')) l.porCaixa = e.target.value;
      tr.querySelector('.l-total').textContent = textoTotal(l.quantidade, l.porCaixa, l.unidade);
      if (verCusto()) tr.querySelector('.l-estimativa').textContent = dinheiro(estimativaLinha(l));
      totalForm();
      estado.alterado = true;
    }

    function tirar(e) {
      const b = e.target.closest('.l-tirar');
      if (!b) return;
      estado.linhas.splice(Number(b.closest('tr[data-k]').dataset.k), 1);
      estado.alterado = true;
      desenharLinhas();
      desenharCombo();
    }

    // escolheu na combo: entra na lista, já com a quantidade sugerida
    function escolher(opcao) {
      const p = estado.produtos.find(x => x.codigo === opcao.codigo);
      const s = estado.sugestao.find(x => x.codigo === opcao.codigo);
      const linha = { codigo: p.codigo, produto: p.produto, codFornecedor: p.codFornecedor, nomeFornecedor: p.nomeFornecedor, unidade: p.unidade, qtd: p.qtd,
        minimo: s?.minimo ?? null, diasCobertura: s?.diasCobertura ?? null, aCaminho: s?.aCaminho ?? null,
        aviso: s && s.aviso !== `em rascunho nº ${estado.numero}` ? s.aviso : '', marcado: true, porCaixa: String(p.porCaixa),
        quantidade: opcao.sugerido ? caixasDe(s.sugerido, p.porCaixa) : '' };
      estado.linhas.push(linha);
      estado.alterado = true;
      $('busca-item').value = '';
      fecharLista();
      desenharLinhas();
      desenharCombo();
      if (!linha.quantidade) $('tb-itens').querySelector(`tr[data-k="${estado.linhas.length - 1}"] .l-qtd`)?.focus();
    }

    function botoesForm() { $('btn-excluir').hidden = !estado.numero; }

    // grava o rascunho; devolve false se faltar algo (o erro do servidor sobe para quem chamou)
    async function salvar() {
      if (!estado.fornecedor) { toast('Escolha um fornecedor.', 'erro'); return false; }
      const r = itensParaEnviar(estado.linhas);
      if (r.erro) { toast(r.erro, 'erro'); return false; }
      const corpo = { fornecedor: estado.fornecedor, observacao: $('observacao').value, itens: r.itens };
      if (estado.numero) await chamar('/pedidos_compra/' + estado.numero, { metodo: 'PUT', corpo });
      else {
        try { estado.numero = (await chamar('/pedidos_compra', { metodo: 'POST', corpo: { ...corpo, chave: estado.chave } })).numero; }
        catch (err) {
          if (err.status === 409) { await abrirLista(); }   // a resposta anterior se perdeu: o pedido está na lista
          throw err;
        }
      }
      estado.alterado = false;
      $('titulo-form').textContent = `Pedido nº ${estado.numero} (rascunho)`;
      botoesForm();
      return true;
    }

    async function baixarPdf(numero) {
      const blob = await chamar(`/pedidos_compra/${numero}/pdf`, { blob: true });
      const url = win.URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = `Pedido_compra_${numero}.pdf`;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 60000);
    }

    async function enviar() {
      await chamar(`/pedidos_compra/${estado.numero}/situacao`, { metodo: 'POST', corpo: { acao: 'enviar' } });
      toast(`Pedido nº ${estado.numero} marcado como enviado.`, 'ok');
      await abrirPedido(estado.numero);
    }

    // ---------- ligações ----------
    $('btn-novo').addEventListener('click', novoPedido);
    for (const id of ['btn-voltar', 'btn-voltar-detalhe']) {
      $(id).addEventListener('click', () => {
        if (id === 'btn-voltar' && estado.alterado && !win.confirm('Sair sem salvar o que foi digitado?')) return;
        estado.alterado = false;
        abrirLista();
      });
    }
    $('tb-lista').addEventListener('click', e => { const tr = e.target.closest('tr[data-numero]'); if (tr) abrirPedido(Number(tr.dataset.numero)); });
    $('tb-lista').addEventListener('keydown', e => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-numero]'); if (tr) abrirPedido(Number(tr.dataset.numero)); } });
    $('fornecedor').addEventListener('change', trocarFornecedor);
    $('tb-itens').addEventListener('input', digitou);
    $('observacao').addEventListener('input', () => { estado.alterado = true; });
    $('tb-itens').addEventListener('click', tirar);
    $('busca-item').addEventListener('click', abrirCombo);
    $('busca-item').addEventListener('input', () => { estado.marcado = -1; abrirCombo(); });
    $('busca-item').addEventListener('keydown', teclaNaCombo);
    $('combo-lista').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) escolher(estado.visiveis[Number(li.dataset.i)]); });
    doc.addEventListener('click', e => { if (!e.target.closest?.('.combo')) fecharLista(); });
    $('btn-salvar').addEventListener('click', () => ocupado(async () => { if (await salvar()) toast('Rascunho salvo.', 'ok'); }));
    $('btn-pdf').addEventListener('click', () => ocupado(async () => {
      if (podeCriar()) { if (!(await salvar())) return; }
      await baixarPdf(estado.numero);
      if (podeCriar() && win.confirm('PDF baixado. Marcar o pedido como enviado?\n(Enviado, os itens não podem mais ser alterados.)')) await enviar();
    }));
    $('btn-pdf-detalhe').addEventListener('click', () => ocupado(() => baixarPdf(estado.numero)));
    $('btn-enviar').addEventListener('click', () => ocupado(async () => {
      if (!(await salvar())) return;
      if (win.confirm('Marcar como enviado? Os itens não poderão mais ser alterados.')) await enviar();
    }));
    $('btn-excluir').addEventListener('click', () => {
      if (!win.confirm(`Excluir o rascunho nº ${estado.numero}?`)) return;
      ocupado(async () => { await chamar('/pedidos_compra/' + estado.numero, { metodo: 'DELETE' }); estado.alterado = false; await abrirLista(); });
    });
    $('btn-cancelar').addEventListener('click', () => mudarSituacao('cancelar', 'Cancelar o pedido? Use quando ele não vale mais. Não dá para desfazer.'));
    $('btn-encerrar').addEventListener('click', () => mudarSituacao('encerrar', 'Encerrar o pedido sem o restante? O que falta deixa de contar como a caminho. Não dá para desfazer.'));
    win.addEventListener('beforeunload', e => { if (estado.alterado) e.preventDefault(); });

    abrirLista();
  }

  return { ROTULOS, estimativa, dinheiro, diaMes, textoEstimativaPedido, totalUnidades, textoTotal, caixasDe, itensParaEnviar, textoChegar, opcoesCombo, iniciar };
});
