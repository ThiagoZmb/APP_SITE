// ==========================================================================
// "Checklist de entrega" (CHECKLIST EXTERNO – ENTREGAS) na tela de Entregas (entregas.html) e no cartão do motorista.
// O PDF é gerado SÓ no servidor (pdfkit): aqui só se abre a janela de campos, salva a edição e abre o PDF numa aba.
// Rotas: GET /entregas/:id/checklist (campos), PUT/DELETE /entregas/:id/checklist (edição, entregas.programar),
// GET /entregas/:id/checklist.pdf, GET /entregas/checklist/branco.pdf, GET /minhas_entregas/:id/checklist.pdf (motorista).
// Dado da API só entra na tela por .value/.textContent. Nada de dinheiro.
// EntregaChecklist.abrirPdf(win, cfg, caminho, aba?)  ·  EntregaChecklist.iniciarJanela(win, cfg) -> { abrir(id, gatilho), abrirBranco() }
// cfg = { apiBase, loginUrl, token: () => string, chamar, toast, podeEditar: () => boolean }
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.EntregaChecklist = lib;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';

  // espelho de calculo/entrega_checklist.js (CAMPOS); um teste confere que as duas listas são iguais
  const CAMPOS = [
    { chave: 'dataEntrega', rotulo: 'Data de entrega', max: 10, data: true },
    { chave: 'pedido', rotulo: 'Pedido', max: 40 },
    { chave: 'cliente', rotulo: 'Cliente', max: 190 },
    { chave: 'clienteFinal', rotulo: 'Cliente final', max: 190 },
    { chave: 'endereco', rotulo: 'Endereço', max: 400, multilinha: true },
    { chave: 'observacoes', rotulo: 'Observações de entrega', max: 500, multilinha: true },
    { chave: 'contato', rotulo: 'Contato no local', max: 190 },
    { chave: 'motorista', rotulo: 'Motorista', max: 120 }
  ];
  const norm = v => String(v ?? '').replace(/\r\n?/g, '\n').trim();

  // sem endereço não há checklist de entrega (decisão do dono, 2026-11-12); a folha em branco é livre
  const MSG_SEM_ENDERECO = 'Informe o endereço da entrega para gerar o checklist.';
  const temEndereco = f => !!norm(f && f.endereco);
  const avisoSemEndereco = podeEditar => (podeEditar ? MSG_SEM_ENDERECO + ' Ao preencher, ele fica salvo para esta entrega e o PDF é gerado.'
    : MSG_SEM_ENDERECO + ' Peça a quem programa as entregas para informar o endereço.');

  // valores que a janela mostra: o salvo (se houver) por cima do automático; só os campos editáveis
  function valoresIniciais(resp) {
    const r = {};
    for (const c of CAMPOS) {
      const salvo = resp && resp.salvo && Object.prototype.hasOwnProperty.call(resp.salvo, c.chave) ? resp.salvo[c.chave] : undefined;
      r[c.chave] = norm(salvo !== undefined ? salvo : resp && resp.automatico ? resp.automatico[c.chave] : '');
    }
    return r;
  }
  const iguais = (a, b) => CAMPOS.every(c => norm(a && a[c.chave]) === norm(b && b[c.chave]));
  function dataOk(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  // mesmas regras do servidor (o servidor continua decidindo)
  function validar(f) {
    for (const c of CAMPOS) {
      const v = norm(f && f[c.chave]);
      if (v.length > c.max) return `"${c.rotulo}" passa de ${c.max} caracteres.`;
      if (c.data && v && !dataOk(v)) return 'Data de entrega inválida.';
    }
    return '';
  }
  const corpoSalvar = f => Object.fromEntries(CAMPOS.map(c => [c.chave, norm(f && f[c.chave])]));
  const textoOrigem = resp => (resp && resp.salvo
    ? `Editado por ${resp.salvoPor || '—'}${resp.salvoEm ? ' em ' + resp.salvoEm : ''}. "Voltar ao automático" descarta a edição.`
    : 'Preenchido com os dados da entrega. O que você mudar fica salvo para esta entrega.');
  function textoInfo(resp) {
    const p = [];
    if (resp && resp.entregaRotulo) p.push(resp.entregaRotulo);
    if (resp && resp.qtdItensEsperada) p.push(`Itens esperados: ${String(resp.qtdItensEsperada).replace('.', ',')}`);
    return p.join(' · ');
  }

  // Abre um PDF autenticado numa aba. A aba deve ser aberta JÁ no clique (senão o navegador bloqueia o pop-up): passe-a em `aba`.
  async function abrirPdf(win, cfg, caminho, aba) {
    const janela = aba || win.open('', '_blank');
    const fechar = () => { try { if (janela) janela.close(); } catch { /* já fechada */ } };
    let r;
    try { r = await win.fetch(cfg.apiBase + caminho, { headers: { Authorization: 'Bearer ' + cfg.token() } }); }
    catch { fechar(); win.alert('Sem conexão com o servidor. Confira a internet e tente de novo.'); return false; }
    if (r.status === 401) { try { win.localStorage.removeItem('auth'); } catch { /* sem storage */ } fechar(); win.location.href = cfg.loginUrl; return false; }
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).error || ''; } catch { /* sem corpo JSON */ }
      fechar();
      win.alert(r.status === 422 ? (msg || MSG_SEM_ENDERECO) : r.status === 403 ? 'Acesso restrito.' : r.status === 404 ? (msg || 'Entrega não encontrada.') : 'Não foi possível gerar o checklist: ' + (msg || `erro ${r.status} no servidor.`));
      return false;
    }
    const link = win.URL.createObjectURL(await r.blob());
    if (janela) janela.location.href = link; else win.location.href = link;
    win.setTimeout(() => win.URL.revokeObjectURL(link), 5 * 60 * 1000);
    return true;
  }

  // Janela "Checklist da entrega" (marcação estática em entregas.html, ids ck-*)
  function iniciarJanela(win, cfg) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const est = { id: null, resp: null, inicial: null, gatilho: null, ocupado: false };
    const campo = c => $('ck-' + c.chave);
    const ler = () => Object.fromEntries(CAMPOS.map(c => [c.chave, campo(c).value]));
    const preencher = v => CAMPOS.forEach(c => { campo(c).value = v[c.chave] || ''; });
    const editar = () => !!(cfg.podeEditar && cfg.podeEditar());

    // "Gerar PDF" só com endereço; o aviso diz o porquê
    function atualizarGerar() {
      const ok = !!norm(campo(CAMPOS[4]).value);
      $('ck-gerar').disabled = est.ocupado || !ok;
      $('ck-aviso-endereco').textContent = ok ? '' : avisoSemEndereco(editar());
      $('ck-aviso-endereco').hidden = ok;
    }
    function mostrarResp(resp) {
      est.resp = resp;
      est.inicial = valoresIniciais(resp);
      preencher(est.inicial);
      $('ck-origem').textContent = textoOrigem(resp);
      const info = textoInfo(resp);
      $('ck-info').textContent = info;
      $('ck-info').hidden = !info;
      $('ck-automatico').hidden = !(resp && resp.salvo) || !editar();
      atualizarGerar();
    }
    function fechar() {
      $('ck-janela').hidden = true;
      doc.body.classList.remove('ck-aberta');
      doc.removeEventListener('keydown', teclado, true);
      if (est.gatilho && est.gatilho.focus) est.gatilho.focus();
      est.id = null; est.resp = null;
    }
    // Esc fecha; Tab fica dentro da janela
    function teclado(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); fechar(); return; }
      if (ev.key !== 'Tab') return;
      const foco = [...$('ck-form').querySelectorAll('input, textarea, button')].filter(x => !x.disabled && !x.hidden && x.offsetParent !== null);
      if (!foco.length) return;
      const prim = foco[0], ult = foco[foco.length - 1];
      if (ev.shiftKey && doc.activeElement === prim) { ev.preventDefault(); ult.focus(); }
      else if (!ev.shiftKey && doc.activeElement === ult) { ev.preventDefault(); prim.focus(); }
    }
    async function abrir(id, gatilho) {
      est.gatilho = gatilho || doc.activeElement;
      $('erro-ck').textContent = '';
      let resp;
      try { resp = await cfg.chamar(`/entregas/${encodeURIComponent(id)}/checklist`); }
      catch (err) { cfg.toast(err.message, 'erro'); return; }
      est.id = id;
      const pode = editar();
      CAMPOS.forEach(c => { campo(c).readOnly = !pode; });
      $('ck-somente-leitura').hidden = pode;
      $('ck-titulo').textContent = `Checklist da entrega · Pedido ${resp && resp.automatico ? resp.automatico.pedido : ''}`;
      mostrarResp(resp);
      $('ck-janela').hidden = false;
      doc.body.classList.add('ck-aberta');
      doc.addEventListener('keydown', teclado, true);
      const primeiro = campo(CAMPOS[0]);
      if (primeiro) primeiro.focus();
    }
    // "Gerar PDF": a aba abre já (clique); se algo mudou e o usuário pode editar, salva antes; depois o PDF vai para a aba
    async function gerar(ev) {
      if (ev) ev.preventDefault();
      if (est.ocupado || est.id === null) return;
      const f = ler();
      const erro = validar(f);
      $('erro-ck').textContent = erro;
      if (erro) return;
      if (!temEndereco(f)) { $('erro-ck').textContent = MSG_SEM_ENDERECO; atualizarGerar(); return; }
      const aba = win.open('', '_blank');
      est.ocupado = true;
      $('ck-gerar').disabled = true;
      try {
        if (editar() && !iguais(f, est.inicial)) {
          let r;
          try { r = await cfg.chamar(`/entregas/${encodeURIComponent(est.id)}/checklist`, { metodo: 'PUT', corpo: corpoSalvar(f) }); }
          catch (err) { try { if (aba) aba.close(); } catch { /* já fechada */ } $('erro-ck').textContent = err.message; return; }
          mostrarResp({ ...est.resp, salvo: r.salvo, salvoPor: r.salvoPor, salvoEm: r.salvoEm });
        }
        await abrirPdf(win, cfg, `/entregas/${encodeURIComponent(est.id)}/checklist.pdf`, aba);
      } finally {
        est.ocupado = false;
        atualizarGerar();
      }
    }
    async function voltarAoAutomatico() {
      if (est.ocupado || est.id === null || !(est.resp && est.resp.salvo)) return;
      if (!win.confirm('Descartar o que foi editado neste checklist e voltar aos dados da entrega?')) return;
      est.ocupado = true;
      try {
        await cfg.chamar(`/entregas/${encodeURIComponent(est.id)}/checklist`, { metodo: 'DELETE' });
        mostrarResp({ ...est.resp, salvo: null, salvoPor: '', salvoEm: '' });
        cfg.toast('Checklist de volta aos dados automáticos da entrega.', 'ok');
      } catch (err) { $('erro-ck').textContent = err.message; }
      finally { est.ocupado = false; }
    }
    const abrirBranco = () => abrirPdf(win, cfg, '/entregas/checklist/branco.pdf');

    $('ck-form').addEventListener('submit', gerar);
    campo(CAMPOS[4]).addEventListener('input', atualizarGerar);
    $('ck-branco').addEventListener('click', abrirBranco);
    $('ck-automatico').addEventListener('click', voltarAoAutomatico);
    $('ck-fechar').addEventListener('click', fechar);
    $('ck-cancelar').addEventListener('click', fechar);
    $('ck-janela').addEventListener('mousedown', ev => { if (ev.target === $('ck-janela')) fechar(); });
    return { abrir, abrirBranco, fechar };
  }

  return { CAMPOS, MSG_SEM_ENDERECO, temEndereco, avisoSemEndereco, valoresIniciais, iguais, validar, corpoSalvar, textoOrigem, textoInfo, abrirPdf, iniciarJanela };
});
