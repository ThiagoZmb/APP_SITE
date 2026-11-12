// Imprime as etiquetas de um Pedido na Zebra: busca o ZPL no servidor (com o token) e o entrega ao serviço local do PC
// (127.0.0.1:3917, local/zebra.js), que o envia RAW à impressora. Sem o serviço local não há plano B pelo navegador:
// ZPL não imprime pelo diálogo comum.
// EtiquetaZebra.imprimir(numero, { apiBase, loginUrl, token })
(function () {
  'use strict';
  const LOCAL = 'http://127.0.0.1:3917';

  async function servicoLocalAtivo() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    try { return (await fetch(LOCAL + '/ping', { signal: ctl.signal })).ok; } catch { return false; } finally { clearTimeout(t); }
  }

  async function imprimir(numero, cfg) {
    try {
      if (!(await servicoLocalAtivo())) {
        alert('Serviço local não encontrado neste PC. A impressão na Zebra só funciona no computador com o serviço do Elegance instalado e em execução.');
        return;
      }
      const r = await fetch(`${cfg.apiBase}/etiquetas/pedido/${encodeURIComponent(numero)}`, { headers: { Authorization: 'Bearer ' + cfg.token() } });
      if (r.status === 401) { localStorage.removeItem('auth'); location.href = cfg.loginUrl; return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 403 ? 'Acesso restrito.' : (d.error || `Erro ${r.status} no servidor.`));
      const p = await fetch(LOCAL + '/etiqueta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zpl: d.zpl }) });
      const resp = await p.json().catch(() => ({}));
      if (!p.ok) throw new Error(resp.error || `Erro ${p.status} no serviço local.`);
      alert(`${d.quantidade} etiqueta(s) enviada(s) para ${resp.impressora}${resp.porta ? ' (porta ' + resp.porta + ')' : ''}.`);
    } catch (err) { alert('Não foi possível imprimir as etiquetas: ' + err.message); }
  }

  window.EtiquetaZebra = { imprimir };
})();
