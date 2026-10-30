// ==========================================================================
// danfe_envio.html — envia os PDFs das notas fiscais (DANFE) para o servidor e vincula uma nota a um pedido à mão.
// Rotas: POST /danfe/existentes, PUT /danfe/:chave (PDF cru), GET /danfe/lista, POST/DELETE /danfe/vinculo.
// O nome do arquivo (sem .pdf) precisa ser uma chave de acesso de 44 dígitos com DV módulo 11 (mesma regra de calculo/danfe.js);
// o servidor confere de novo (nunca confia no nome). Funções puras testadas no Node (test/danfe_tela.test.js).
// Dado vindo da API só entra na tela por esc() ou textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.DanfeEnvio = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, dataHoraBR } = C;

  const MAX_PDF = 2 * 1024 * 1024;
  const LOTE_EXISTENTES = 500; // o servidor aceita até 500 chaves por consulta
  const TENTATIVAS = 3;
  const MODELO_NFE = '55';

  // DV da chave de acesso: módulo 11, pesos 2..9 da direita para a esquerda nos 43 primeiros dígitos
  function chaveValida(chave) {
    const s = String(chave ?? '').trim();
    if (!/^\d{44}$/.test(s)) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11;
    return Number(s[43]) === (r < 2 ? 0 : 11 - r);
  }
  // "<chave>.pdf" (com ou sem caminho) -> chave válida, senão ''
  function chaveDoNome(nome) {
    const base = String(nome ?? '').split(/[\\/]/).pop().trim();
    const m = /^(\d{44})\.pdf$/i.exec(base);
    return m && chaveValida(m[1]) ? m[1] : '';
  }
  const numeroDaChave = chave => Number(String(chave).slice(25, 34));

  // Separa o que vai ser enviado do que é ignorado (com o motivo). `arquivos` = lista de { name, size } (File). Não lê o conteúdo.
  function classificarArquivos(arquivos) {
    const candidatas = [], ignoradas = [], vistas = new Set();
    for (const f of arquivos) {
      const nome = String(f.name || '');
      if (!/\.pdf$/i.test(nome)) { ignoradas.push({ nome, motivo: 'não é PDF' }); continue; }
      const chave = chaveDoNome(nome);
      if (!chave) { ignoradas.push({ nome, motivo: 'o nome não é uma chave de acesso válida (44 dígitos com DV certo)' }); continue; }
      if (chave.slice(20, 22) !== MODELO_NFE) { ignoradas.push({ nome, motivo: 'não é nota modelo 55' }); continue; }
      if (!(f.size > 0)) { ignoradas.push({ nome, motivo: 'arquivo vazio' }); continue; }
      if (f.size > MAX_PDF) { ignoradas.push({ nome, motivo: 'maior que 2 MB' }); continue; }
      if (vistas.has(chave)) { ignoradas.push({ nome, motivo: 'chave repetida na seleção' }); continue; }
      vistas.add(chave);
      candidatas.push({ chave, arquivo: f });
    }
    return { candidatas, ignoradas };
  }
  function lotes(lista, tamanho) {
    const saida = [];
    for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
    return saida;
  }
  // monta o relatório final a partir dos resultados de cada arquivo ({ chave, situacao: 'enviada'|'existia'|'erro', motivo? })
  function resumir({ ignoradas = [], jaExistiam = 0, resultados = [] }) {
    const enviadas = resultados.filter(r => r.situacao === 'enviada').length;
    const existiamAgora = resultados.filter(r => r.situacao === 'existia').length;
    return { enviadas, jaExistentes: jaExistiam + existiamAgora, ignoradas: ignoradas.length,
      comErro: resultados.filter(r => r.situacao === 'erro'), cnpjDiferente: resultados.filter(r => r.cnpjDiferente).length };
  }

  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const pode = c => !!(win.Acesso && win.Acesso.pode(c));
    const estado = { selecao: null, novas: [], jaExistiam: 0, ocupado: false, parar: false, lista: [] };
    const params = new win.URLSearchParams(win.location.search);

    // ---------- abas ----------
    function mostrarAba(nome) {
      for (const a of ['enviar', 'vincular']) {
        $('aba-' + a).classList.toggle('ativo', a === nome);
        $('sec-' + a).hidden = a !== nome;
      }
      if (nome === 'vincular' && !estado.lista.length) buscar();
    }
    for (const a of doc.querySelectorAll('.aba')) a.addEventListener('click', () => mostrarAba(a.dataset.aba));

    // ---------- enviar ----------
    function resumoSelecao(texto) { $('resumo-selecao').textContent = texto; }

    async function aoEscolher(ev) {
      const arquivos = Array.from(ev.target.files || []);
      ev.target.value = '';
      if (!arquivos.length) return;
      $('relatorio').hidden = true; $('barra').hidden = true; $('texto-progresso').textContent = '';
      const sel = classificarArquivos(arquivos);
      estado.selecao = sel; estado.novas = []; estado.jaExistiam = 0;
      $('btn-enviar').disabled = true;
      if (!sel.candidatas.length) {
        resumoSelecao(`${arquivos.length} arquivo(s) escolhido(s), nenhum é um DANFE válido.`);
        desenharIgnoradas(sel.ignoradas);
        return;
      }
      resumoSelecao('Conferindo quais já foram enviados…');
      try {
        const existentes = new Set();
        for (const parte of lotes(sel.candidatas.map(c => c.chave), LOTE_EXISTENTES)) {
          const d = await chamar('/danfe/existentes', { metodo: 'POST', corpo: { chaves: parte } });
          for (const c of d.existentes || []) existentes.add(c);
        }
        estado.novas = sel.candidatas.filter(c => !existentes.has(c.chave));
        estado.jaExistiam = sel.candidatas.length - estado.novas.length;
      } catch (err) { toast(err.message, 'erro'); resumoSelecao(''); return; }
      resumoSelecao(`${arquivos.length} arquivo(s): ${estado.novas.length} novo(s) para enviar, ${estado.jaExistiam} já enviado(s), ${sel.ignoradas.length} ignorado(s).`);
      desenharIgnoradas(sel.ignoradas);
      $('btn-enviar').disabled = estado.novas.length === 0;
    }
    function desenharIgnoradas(ignoradas) {
      const alvo = $('relatorio');
      if (!ignoradas.length) { alvo.hidden = true; return; }
      alvo.hidden = false;
      alvo.innerHTML = `<h3>Ignorados (${ignoradas.length})</h3><ul>` + ignoradas.slice(0, 100).map(i => `<li>${esc(i.nome)} — ${esc(i.motivo)}</li>`).join('') +
        (ignoradas.length > 100 ? `<li>… e mais ${ignoradas.length - 100}</li>` : '') + '</ul>';
    }

    // um arquivo: tenta de novo só em falha de rede (o servidor é idempotente por chave)
    async function enviarUm(item) {
      let ultimo = null;
      for (let t = 1; t <= TENTATIVAS; t++) {
        try {
          const bytes = await item.arquivo.arrayBuffer();
          const d = await chamar('/danfe/' + item.chave, { metodo: 'PUT', binario: bytes, mime: 'application/pdf' });
          return { chave: item.chave, situacao: d.ja_existia ? 'existia' : 'enviada', cnpjDiferente: !!d.cnpjDiferente };
        } catch (err) {
          ultimo = err;
          if (err.message !== C.SEM_CONEXAO || t === TENTATIVAS) break;
          await new Promise(ok => win.setTimeout(ok, 1500 * t));
        }
      }
      return { chave: item.chave, situacao: 'erro', motivo: ultimo ? ultimo.message : 'erro desconhecido' };
    }

    async function enviarTodas() {
      if (estado.ocupado || !estado.novas.length) return;
      estado.ocupado = true; estado.parar = false;
      $('btn-enviar').disabled = true; $('btn-parar').hidden = false; $('barra').hidden = false;
      const total = estado.novas.length, resultados = [];
      for (let i = 0; i < total; i++) {
        if (estado.parar) break;
        $('texto-progresso').textContent = `Enviando ${i + 1} de ${total}…`;
        $('barra-interna').style.width = Math.round((i / total) * 100) + '%';
        resultados.push(await enviarUm(estado.novas[i]));
        if (resultados[resultados.length - 1].situacao === 'erro' && /Sess[aã]o expirada/i.test(resultados[resultados.length - 1].motivo)) break;
      }
      $('barra-interna').style.width = '100%';
      $('btn-parar').hidden = true; estado.ocupado = false;
      const r = resumir({ ignoradas: estado.selecao.ignoradas, jaExistiam: estado.jaExistiam, resultados });
      const naoTentadas = total - resultados.length;
      $('texto-progresso').textContent = naoTentadas ? `Envio interrompido: ${naoTentadas} nota(s) não foram tentadas.` : 'Envio concluído.';
      desenharRelatorio(r, estado.selecao.ignoradas, naoTentadas);
      // o que deu erro volta para uma nova tentativa
      const falhas = new Set(r.comErro.map(e => e.chave));
      estado.novas = estado.novas.filter(n => falhas.has(n.chave) || resultados.every(x => x.chave !== n.chave));
      $('btn-enviar').disabled = estado.novas.length === 0;
    }
    function desenharRelatorio(r, ignoradas, naoTentadas) {
      const alvo = $('relatorio');
      alvo.hidden = false;
      alvo.innerHTML = `<h3>Resultado</h3><ul>` +
        `<li><b>${r.enviadas}</b> enviada(s)</li><li><b>${r.jaExistentes}</b> já existia(m)</li>` +
        `<li><b>${r.ignoradas}</b> ignorada(s)</li><li><b>${r.comErro.length}</b> com erro</li>` +
        (naoTentadas ? `<li><b>${naoTentadas}</b> não tentada(s) (envio parado)</li>` : '') + '</ul>' +
        (r.cnpjDiferente ? `<p class="cinza">Atenção: ${r.cnpjDiferente} nota(s) têm CNPJ do emitente diferente do mais comum; elas não se ligam sozinhas aos pedidos.</p>` : '') +
        (r.comErro.length ? '<h3>Com erro</h3><ul>' + r.comErro.slice(0, 100).map(e => `<li>NF ${esc(numeroDaChave(e.chave))} — ${esc(e.motivo)}</li>`).join('') + '</ul>' : '') +
        (ignoradas.length ? `<h3>Ignorados (${ignoradas.length})</h3><ul>` + ignoradas.slice(0, 100).map(i => `<li>${esc(i.nome)} — ${esc(i.motivo)}</li>`).join('') + '</ul>' : '');
      toast(`${r.enviadas} nota(s) enviada(s)` + (r.comErro.length ? `, ${r.comErro.length} com erro` : ''), r.comErro.length ? 'erro' : 'ok');
    }

    // ---------- vincular ----------
    async function buscar() {
      const q = $('busca').value.trim();
      try {
        const d = await chamar('/danfe/lista' + (q ? '?q=' + encodeURIComponent(q) : ''));
        estado.lista = Array.isArray(d.notas) ? d.notas : [];
        estado.limitada = !!d.limitada;
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; }
      desenharLista();
    }
    function desenharLista() {
      const alvo = $('lista');
      $('qtd').textContent = estado.lista.length ? `${estado.lista.length} nota(s)` + (estado.limitada ? ' — mostrando as mais recentes; refine a busca' : '') : '';
      if (!estado.lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma nota encontrada.</p>'; return; }
      alvo.innerHTML = '<table><thead><tr><th>NF</th><th>Enviada em</th><th>Pedidos vinculados</th><th>Vincular ao pedido</th></tr></thead><tbody>' +
        estado.lista.map(n => `<tr data-chave="${esc(n.chave)}" style="cursor:default"><td><b>${esc(n.numeroNf)}</b>/${esc(n.serie)}<div class="mono">${esc(n.chave)}</div></td>` +
          `<td>${esc(dataHoraBR(n.enviadoEm))}</td>` +
          `<td><div class="chips">${(n.pedidos || []).map(p => `<span class="chip">Pedido ${esc(p)}<button type="button" data-acao="desvincular" data-pedido="${esc(p)}" aria-label="Desvincular o pedido ${esc(p)}">×</button></span>`).join('')}</div></td>` +
          `<td><div class="linha-vinc"><input inputmode="numeric" maxlength="9" placeholder="Nº do pedido" aria-label="Número do pedido" data-campo="pedido"${params.get('pedido') ? ` value="${esc(params.get('pedido'))}"` : ''}>` +
          `<button type="button" class="btn btn-primary btn-mini" data-acao="vincular">Vincular</button></div></td></tr>`).join('') + '</tbody></table>';
    }
    async function aoClicarLista(ev) {
      const b = ev.target.closest('button[data-acao]');
      if (!b) return;
      const tr = b.closest('tr[data-chave]');
      const chave = tr.dataset.chave;
      b.disabled = true;
      try {
        if (b.dataset.acao === 'vincular') {
          const pedido = tr.querySelector('input[data-campo="pedido"]').value.trim();
          if (!/^\d{1,9}$/.test(pedido) || Number(pedido) <= 0) { toast('Informe o número do pedido.', 'erro'); return; }
          const d = await chamar('/danfe/vinculo', { metodo: 'POST', corpo: { chave, pedido: Number(pedido) } });
          toast(d.ja_existia ? 'Esta nota já estava ligada a esse pedido.' : `Nota vinculada ao pedido ${pedido}.`, 'ok');
        } else {
          const pedido = Number(b.dataset.pedido);
          if (!win.confirm(`Desvincular a nota do pedido ${pedido}? (a ligação automática pelo financeiro, se houver, continua.)`)) return;
          await chamar('/danfe/vinculo', { metodo: 'DELETE', corpo: { chave, pedido } });
          toast('Vínculo removido.', 'ok');
        }
        await buscar();
      } catch (err) { toast(err.message, 'erro'); } finally { b.disabled = false; }
    }

    // ---------- ligações ----------
    $('entrada-pasta').addEventListener('change', aoEscolher);
    $('entrada-arquivos').addEventListener('change', aoEscolher);
    $('btn-enviar').addEventListener('click', enviarTodas);
    $('btn-parar').addEventListener('click', () => { estado.parar = true; });
    $('btn-buscar').addEventListener('click', buscar);
    $('busca').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
    $('lista').addEventListener('click', aoClicarLista);
    // não deixa fechar a página no meio do envio sem avisar
    win.addEventListener('beforeunload', e => { if (estado.ocupado) { e.preventDefault(); e.returnValue = ''; } });

    const inicial = params.get('aba') === 'vincular' && pode('danfe.vincular') ? 'vincular' : pode('danfe.enviar') ? 'enviar' : 'vincular';
    mostrarAba(inicial);
  }

  return { MAX_PDF, chaveValida, chaveDoNome, numeroDaChave, classificarArquivos, lotes, resumir, iniciar };
});
