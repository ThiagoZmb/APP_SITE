// ==========================================================================
// "Abrir nota fiscal (DANFE)" no menu do botão direito dos PEDIDOS (painel_inicial.html e inicio.html via inicio_menu.js).
// GET /danfe/pedido/:n -> 1 nota abre direto; várias abrem uma janelinha para escolher; nenhuma avisa (e oferece "Vincular nota…" a quem tem danfe.vincular).
// O PDF vem de GET /danfe/:chave/pdf com o token (fetch + blob, como abrirPdfAutenticado). Dado da API só entra na tela por textContent.
// DanfePedido.abrir(numero, { apiBase, loginUrl, token: () => string, pode: codigo => boolean })
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.DanfePedido = lib;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';

  const dataBR = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const rotuloNota = n => `NF ${n.numeroNf}${n.serie && n.serie !== 1 ? ` (série ${n.serie})` : ''}${n.enviadoEm ? ' · enviada em ' + dataBR(n.enviadoEm) : ''}${n.origem === 'manual' ? ' · vínculo manual' : ''}`;
  // texto de quando não há nota para abrir (o financeiro pode citar números de NF sem PDF enviado)
  function textoSemNota(resposta) {
    const faltam = (resposta && resposta.semArquivo) || [];
    const base = 'Nenhuma nota fiscal ligada a este pedido.';
    return faltam.length ? `${base} O financeiro cita a NF ${faltam.join(', ')}, mas o PDF ainda não foi enviado.` : base;
  }

  async function abrir(numero, cfg) {
    const doc = raiz.document;
    const enc = encodeURIComponent;
    const aba = raiz.open('', '_blank'); // abre já, no clique, para o bloqueador de pop-up não barrar
    const escreverAba = t => { if (aba && aba.document && aba.document.body) { aba.document.body.textContent = ''; const p = aba.document.createElement('p'); p.style.cssText = 'font:15px sans-serif;padding:24px;color:#444'; p.textContent = t; aba.document.body.appendChild(p); } };
    const fecharAba = () => { try { if (aba) aba.close(); } catch { /* aba já fechada */ } };
    escreverAba('Procurando a nota fiscal…');

    async function buscar(caminho, tipoBlob) {
      const r = await raiz.fetch(cfg.apiBase + caminho, { headers: { Authorization: 'Bearer ' + cfg.token() } });
      if (r.status === 401) { raiz.localStorage.removeItem('auth'); raiz.location.href = cfg.loginUrl; throw new Error('Sessão expirada'); }
      if (!r.ok) {
        let msg = ''; try { msg = (await r.json()).error || ''; } catch { /* sem corpo JSON */ }
        throw new Error(r.status === 403 ? 'Acesso restrito.' : msg || `Erro ${r.status} no servidor.`);
      }
      return tipoBlob ? r.blob() : r.json();
    }
    async function abrirPdf(chave, janela) {
      const blob = await buscar(`/danfe/${enc(chave)}/pdf`, true);
      const link = raiz.URL.createObjectURL(blob);
      if (janela) janela.location.href = link; else raiz.location.href = link;
      raiz.setTimeout(() => raiz.URL.revokeObjectURL(link), 120000);
    }

    // janelinha: título, texto e botões (rótulos sempre por textContent)
    function janelinha(titulo, texto, botoes) {
      const fundo = doc.createElement('div');
      fundo.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
      const caixa = doc.createElement('div');
      caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-label', titulo);
      caixa.style.cssText = 'background:#fff;border-radius:14px;padding:20px;max-width:440px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.25);font:14px "Segoe UI",sans-serif;color:#2c3e50';
      const h = doc.createElement('h3'); h.textContent = titulo; h.style.cssText = 'font-size:17px;margin-bottom:8px';
      caixa.appendChild(h);
      if (texto) { const p = doc.createElement('p'); p.textContent = texto; p.style.cssText = 'margin-bottom:12px;line-height:1.4'; caixa.appendChild(p); }
      const fechar = () => { fundo.remove(); doc.removeEventListener('keydown', aoTeclar, true); };
      function aoTeclar(e) { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } }
      for (const b of botoes) {
        const el = doc.createElement('button'); el.type = 'button'; el.textContent = b.rotulo;
        el.style.cssText = 'display:block;width:100%;text-align:left;margin-top:8px;padding:11px 12px;border:1px solid #e9ecef;border-radius:10px;background:' + (b.principal ? '#8B0000;color:#fff' : '#f8f9fa;color:#2c3e50') + ';font:inherit;cursor:pointer;min-height:44px';
        el.addEventListener('click', () => { fechar(); b.fn(); });
        caixa.appendChild(el);
      }
      fundo.appendChild(caixa);
      fundo.addEventListener('mousedown', e => { if (e.target === fundo) fechar(); });
      doc.addEventListener('keydown', aoTeclar, true);
      doc.body.appendChild(fundo);
      const primeiro = caixa.querySelector('button'); if (primeiro) primeiro.focus();
    }

    try {
      const d = await buscar(`/danfe/pedido/${enc(numero)}`, false);
      const notas = Array.isArray(d.notas) ? d.notas : [];
      if (notas.length === 1) { await abrirPdf(notas[0].chave, aba); return; }
      fecharAba();
      if (notas.length > 1) {
        janelinha(`Pedido nº ${numero}: escolha a nota`, 'Este pedido tem mais de uma nota fiscal.',
          notas.map(n => ({ rotulo: rotuloNota(n), fn: () => { const j = raiz.open('', '_blank'); abrirPdf(n.chave, j).catch(e => { if (j) j.close(); raiz.alert('Não foi possível abrir a nota: ' + e.message); }); } })));
        return;
      }
      const botoes = [];
      if (cfg.pode && cfg.pode('danfe.vincular')) botoes.push({ rotulo: 'Vincular nota…', principal: true, fn: () => { raiz.location.href = `danfe_envio.html?aba=vincular&pedido=${enc(numero)}`; } });
      botoes.push({ rotulo: 'Fechar', fn: () => {} });
      janelinha(`Pedido nº ${numero}`, textoSemNota(d), botoes);
    } catch (err) {
      fecharAba();
      raiz.alert('Não foi possível abrir a nota fiscal: ' + err.message);
    }
  }

  return { abrir, rotuloNota, textoSemNota };
});
