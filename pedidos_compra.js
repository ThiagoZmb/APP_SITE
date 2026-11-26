// ==========================================================================
// pedidos_compra.html — pedidos a fornecedor: sugestão do que comprar, montagem, PDF e acompanhamento.
// Rotas: /pedidos_compra (rotas/pedidos_compra.js). Sem preços. Regras: docs/regras/pedidos-compra.md
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
  // sugestão (em unidades) → o que vai no campo "Pedir" (caixas, quando há mais de 1 por caixa)
  const caixasDe = (unidades, porCaixa) => (unidades ? String(Math.ceil(unidades / (porCaixa || 1))) : '');

  // o pedido fala a língua do fornecedor; sem descrição cadastrada, vale o nome da casa
  const descricao = i => i.nomeFornecedor || i.produto;
  const codigo = i => i.codFornecedor || '—';

  function itensParaEnviar(linhas) {
    const itens = [];
    for (const l of linhas) {
      if (!l.marcado) continue;
      if (!totalUnidades(l.quantidade, l.porCaixa)) return { erro: `Informe a quantidade (inteira, maior que zero) de "${descricao(l)}".` };
      itens.push({ produtoCodigo: l.codigo, quantidade: inteiro(l.quantidade), porCaixa: porCaixaDe(l.porCaixa) });
    }
    return itens.length ? { itens } : { erro: 'Marque pelo menos um item e informe a quantidade.' };
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const podeCriar = () => !!(win.Acesso && win.Acesso.pode('compras.criar'));
    // pedido aberto: numero null = novo; chave identifica o pedido novo para o duplo clique não gravar dois
    const estado = { numero: null, chave: '', situacao: 'rascunho', fornecedor: '', linhas: [], ocupado: false, seq: 0, buscaSeq: 0, temporizador: null, alterado: false };
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
      Object.assign(estado, { numero: p.numero, situacao: p.situacao, fornecedor: p.fornecedor, alterado: false });
      if (p.situacao === 'rascunho' && podeCriar()) {
        estado.linhas = p.itens.map(i => ({ codigo: i.codigo, produto: i.produto, codFornecedor: i.codFornecedor, nomeFornecedor: i.nomeFornecedor, unidade: i.unidade, qtd: null, minimo: null, diasCobertura: null, aCaminho: null, aviso: '',
          marcado: true, porCaixa: String(i.porCaixa), quantidade: String(i.qtd / i.porCaixa) }));
        $('observacao').value = p.observacao;
        $('titulo-form').textContent = `Pedido nº ${p.numero} (rascunho)`;
        if (!(await preencherFornecedores(p.fornecedor))) return;
        desenharLinhas();
        botoesForm();
        mostrar('form');
      } else desenharDetalhe(p);
    }

    // ---------- pedido enviado, fechado (ou rascunho para quem só vê) ----------
    function desenharDetalhe(p) {
      $('titulo-detalhe').textContent = `Pedido nº ${p.numero}`;
      $('resumo-detalhe').innerHTML = `${selo(p.situacao)} <span>${esc(p.fornecedor)} · criado ${esc(data(p.criadoEm))}${p.enviadoEm ? ' · enviado ' + esc(data(p.enviadoEm)) : ''}</span>`;
      $('tb-detalhe').innerHTML = p.itens.map(i => `<tr><td>${esc(codigo(i))}</td><td>${esc(descricao(i))}</td><td class="num">${esc(textoTotal(i.qtd / i.porCaixa, i.porCaixa, i.unidade))}</td>` +
        `<td class="num">${esc(i.chegou)}</td><td class="num">${i.falta ? esc(i.falta) : '✔'}</td></tr>`).join('');
      $('obs-detalhe').textContent = p.observacao ? 'Observação: ' + p.observacao : '';
      const chegou = p.itens.some(i => i.chegou > 0);
      $('btn-cancelar').hidden = !(p.situacao === 'enviado' && !chegou);
      $('btn-encerrar').hidden = !['enviado', 'parcial'].includes(p.situacao);
      mostrar('detalhe');
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
      Object.assign(estado, { numero: null, chave: novaChave(), situacao: 'rascunho', fornecedor: '', linhas: [], alterado: false, seq: estado.seq + 1 });
      $('observacao').value = '';
      $('titulo-form').textContent = 'Novo pedido';
      $('busca-item').value = '';
      $('achados').innerHTML = '';
      desenharLinhas();
      botoesForm();
      mostrar('form');
      await preencherFornecedores('');
    }

    async function trocarFornecedor() {
      const novo = $('fornecedor').value;
      if (estado.linhas.length && (estado.alterado || estado.numero) && !win.confirm('Trocar de fornecedor descarta os itens da lista. Continuar?')) { $('fornecedor').value = estado.fornecedor; return; }
      estado.fornecedor = novo;
      estado.linhas = [];
      estado.alterado = false;
      const seq = ++estado.seq;
      $('achados').innerHTML = '';
      desenharLinhas(novo ? 'Buscando o que pedir…' : undefined);
      if (!novo) return;
      try {
        const d = await chamar('/pedidos_compra/sugestao?fornecedor=' + encodeURIComponent(novo));
        if (seq !== estado.seq) return;
        // itens que a pessoa acrescentou enquanto a sugestão carregava ficam
        const jaTem = new Set(estado.linhas.map(l => l.codigo));
        estado.linhas = [...d.itens.filter(i => !jaTem.has(i.codigo)).map(i => ({ ...i, porCaixa: String(i.porCaixa), quantidade: caixasDe(i.sugerido, i.porCaixa) })), ...estado.linhas];
        desenharLinhas('Nenhum item precisa ser pedido a este fornecedor. Use "Adicionar item" se quiser.');
      } catch (err) {
        if (seq !== estado.seq) return;
        toast(err.message, 'erro');
        desenharLinhas('Não foi possível buscar a sugestão.');
      }
    }

    const ouTraco = v => (v === null || v === undefined ? '—' : esc(v));
    function desenharLinhas(vazio) {
      $('tb-itens').innerHTML = estado.linhas.length ? estado.linhas.map((l, k) =>
        `<tr data-k="${k}"><td><input type="checkbox" class="l-marca" aria-label="Incluir ${esc(descricao(l))}"${l.marcado ? ' checked' : ''}></td><td>${esc(codigo(l))}</td>` +
        `<td>${esc(descricao(l))}${l.aviso ? `<small class="aviso-item">${esc(l.aviso)}</small>` : ''}</td>` +
        `<td class="num">${ouTraco(l.qtd)}</td><td class="num">${l.minimo ? esc(l.minimo) : '—'}</td>` +
        `<td class="num">${l.diasCobertura === null || l.diasCobertura === undefined ? '—' : esc(l.diasCobertura) + ' dias'}</td><td class="num">${ouTraco(l.aCaminho)}</td>` +
        `<td class="num"><input class="curto l-caixa" inputmode="numeric" aria-label="Unidades por caixa" value="${esc(l.porCaixa)}"></td>` +
        `<td class="num"><input class="curto l-qtd" inputmode="numeric" aria-label="Quantidade a pedir" value="${esc(l.quantidade)}"></td>` +
        `<td class="l-total">${esc(textoTotal(l.quantidade, l.porCaixa, l.unidade))}</td></tr>`).join('')
        : `<tr><td colspan="10" class="vazio">${esc(vazio || 'Escolha o fornecedor para ver o que pedir.')}</td></tr>`;
    }

    function digitou(e) {
      const tr = e.target.closest('tr[data-k]');
      if (!tr) return;
      const l = estado.linhas[Number(tr.dataset.k)];
      const marca = tr.querySelector('.l-marca');
      if (e.target === marca) l.marcado = marca.checked;
      else {
        if (e.target.classList.contains('l-qtd')) { l.quantidade = e.target.value; marca.checked = l.marcado = txt(l.quantidade) !== ''; }
        if (e.target.classList.contains('l-caixa')) l.porCaixa = e.target.value;
        tr.querySelector('.l-total').textContent = textoTotal(l.quantidade, l.porCaixa, l.unidade);
      }
      estado.alterado = true;
    }

    async function buscarItem() {
      const busca = txt($('busca-item').value);
      const seq = ++estado.buscaSeq;
      if (!busca) { $('achados').innerHTML = ''; return; }
      let lista;
      try { lista = await chamar(`/pedidos_compra/produtos?busca=${encodeURIComponent(busca)}&fornecedor=${encodeURIComponent(estado.fornecedor)}`); }
      catch (err) { return toast(err.message, 'erro'); }
      if (seq !== estado.buscaSeq) return;
      estado.achados = lista;
      $('achados').innerHTML = lista.length
        ? lista.map((p, k) => `<button type="button" class="btn btn-secondary btn-mini" data-k="${k}">${esc(codigo(p))} · ${esc(descricao(p))}</button>`).join('')
        : '<span class="dica">Nenhum item ativo encontrado.</span>';
    }

    function adicionar(e) {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      const p = estado.achados[Number(b.dataset.k)];
      const ja = estado.linhas.find(l => l.codigo === p.codigo);
      if (ja) ja.marcado = true;
      else estado.linhas.push({ codigo: p.codigo, produto: p.produto, codFornecedor: p.codFornecedor, nomeFornecedor: p.nomeFornecedor, unidade: p.unidade, qtd: p.qtd, minimo: null, diasCobertura: null, aCaminho: null, aviso: '',
        marcado: true, porCaixa: String(p.porCaixa), quantidade: '' });
      estado.alterado = true;
      $('achados').innerHTML = '';
      $('busca-item').value = '';
      desenharLinhas();
      $('tb-itens').querySelector(`tr[data-k="${estado.linhas.findIndex(l => l.codigo === p.codigo)}"] .l-qtd`).focus();
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
    $('busca-item').addEventListener('input', () => { win.clearTimeout(estado.temporizador); estado.temporizador = win.setTimeout(buscarItem, 300); });
    $('achados').addEventListener('click', adicionar);
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

  return { ROTULOS, totalUnidades, textoTotal, caixasDe, itensParaEnviar, iniciar };
});
