// "Imprimir checklist" do menu do botão direito do Pedido (igual ao VB: um PDF fixo de checklist de produção, sem depender do pedido).
// O PDF vigente fica no banco da web (tabela web_checklist, enviado pela tela "Enviar arquivos", aba Checklist) e vem de GET /checklist/pdf
// com o token: funciona de qualquer lugar, inclusive no celular, sem o serviço local do PC.
// ChecklistPedido.abrir({ apiBase, loginUrl, token: () => string })
(function () {
  'use strict';
  const SEM_ARQUIVO = 'O checklist ainda não foi enviado. Peça a quem tem permissão para enviá-lo.';

  async function abrir(cfg) {
    // a aba é aberta já no clique (senão o navegador bloqueia o pop-up) e recebe o PDF depois
    const aba = window.open('', '_blank');
    const fechar = () => { try { if (aba) aba.close(); } catch { /* aba já fechada */ } };
    try {
      let r;
      try { r = await fetch(cfg.apiBase + '/checklist/pdf', { headers: { Authorization: 'Bearer ' + cfg.token() } }); }
      catch { fechar(); alert('Sem conexão com o servidor. Confira a internet e tente de novo.'); return; }
      if (r.status === 401) { try { localStorage.removeItem('auth'); } catch { /* sem storage */ } fechar(); window.location.href = cfg.loginUrl; return; }
      if (!r.ok) {
        let msg = ''; try { msg = (await r.json()).error || ''; } catch { /* sem corpo JSON */ }
        fechar(); alert(r.status === 404 ? SEM_ARQUIVO : r.status === 403 ? 'Acesso restrito.' : 'Não foi possível abrir o checklist: ' + (msg || `erro ${r.status} no servidor.`));
        return;
      }
      const link = URL.createObjectURL(await r.blob());
      if (aba) aba.location.href = link; else window.open(link, '_blank');
      setTimeout(() => URL.revokeObjectURL(link), 5 * 60 * 1000);
    } catch (err) { fechar(); alert('Não foi possível abrir o checklist: ' + err.message); }
  }

  window.ChecklistPedido = { abrir, SEM_ARQUIVO };
})();
