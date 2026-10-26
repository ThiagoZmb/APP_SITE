// ==========================================================================
// Helpers compartilhados das telas do módulo Entregas (entregas.html = equipe, minhas_entregas.html = motorista).
// Funções puras (testadas no Node) e, para o navegador, a chamada à API autenticada, o toast e a redução de foto.
// Dado vindo da API só entra na tela por esc() ou textContent. Nenhum valor em dinheiro passa por aqui.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.EntregasComum = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API_BASE = 'https://elegance-backend-hrho.onrender.com';
  const LOGIN_URL = 'https://thiagozmb.github.io/APP_SITE/login.html';
  const LIMITE_IMAGEM = 1000 * 1000; // o servidor aceita até 1 MiB; ficamos abaixo
  const SEM_CONEXAO = 'Sem conexão. Tente de novo.';

  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const txt = v => String(v ?? '').trim();

  function dataValida(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  const dataBR = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const dataHoraBR = q => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(q ?? ''));
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : dataBR(q);
  };

  // maior lado limitado a `max`, sem ampliar
  function escalaImagem(w, h, max) {
    const f = Math.min(1, max / Math.max(w, h));
    return { largura: Math.round(w * f), altura: Math.round(h * f) };
  }

  // ============ NAVEGADOR ============
  // Chamada à API com Authorization; 401 -> login; erro da API vira Error(mensagem) com .status; rede fora -> mensagem em português.
  function criarApi(win) {
    function getAuth() {
      try {
        const a = JSON.parse(win.localStorage.getItem('auth') || 'null');
        if (!a || !a.token || !a.user) return null;
        if (Date.now() > (a.exp || 0)) { win.localStorage.removeItem('auth'); return null; }
        return a;
      } catch { return null; }
    }
    async function chamar(caminho, { metodo = 'GET', corpo, binario, mime, blob } = {}) {
      const auth = getAuth();
      const headers = { Authorization: 'Bearer ' + (auth ? auth.token : '') };
      let body;
      if (binario) { body = binario; headers['Content-Type'] = mime; } else if (corpo !== undefined) { body = JSON.stringify(corpo); headers['Content-Type'] = 'application/json'; }
      let res;
      try { res = await win.fetch(API_BASE + caminho, { method: metodo, headers, body }); } catch { throw new Error(SEM_CONEXAO); }
      if (res.status === 401) { win.localStorage.removeItem('auth'); win.location.href = LOGIN_URL; throw new Error('Sessão expirada'); }
      if (blob && res.ok) return res.blob();
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(dados.error || `Erro HTTP ${res.status}`); e.status = res.status; throw e; }
      return dados;
    }
    return { getAuth, chamar };
  }

  function criarToast(doc, win) {
    return function toast(msg, tipo = 'info') {
      const t = doc.createElement('div');
      t.className = `toast ${tipo}`;
      t.textContent = msg;
      doc.getElementById('toasts').appendChild(t);
      win.setTimeout(() => t.remove(), 5000);
    };
  }

  function carregarImagem(win, arquivo) {
    return new Promise((ok, falha) => {
      const url = win.URL.createObjectURL(arquivo);
      const img = new win.Image();
      img.onload = () => { win.URL.revokeObjectURL(url); ok(img); };
      img.onerror = () => { win.URL.revokeObjectURL(url); falha(new Error('Não foi possível ler a imagem.')); };
      img.src = url;
    });
  }
  // foto reduzida por canvas para JPEG <= 1 MB (1600/1200/900/600 px, qualidade .85/.7/.55)
  async function reduzirImagem(win, arquivo) {
    if (!/^image\//.test(arquivo.type || '')) throw new Error('Escolha uma imagem (foto).');
    const img = await carregarImagem(win, arquivo);
    for (const max of [1600, 1200, 900, 600]) {
      const { largura, altura } = escalaImagem(img.naturalWidth, img.naturalHeight, max);
      const c = win.document.createElement('canvas');
      c.width = largura; c.height = altura;
      c.getContext('2d').drawImage(img, 0, 0, largura, altura);
      for (const q of [0.85, 0.7, 0.55]) {
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
        if (blob && blob.size <= LIMITE_IMAGEM) return blob;
      }
    }
    throw new Error('A foto continua grande demais. Tente outra.');
  }

  return { API_BASE, LOGIN_URL, LIMITE_IMAGEM, SEM_CONEXAO, esc, txt, dataValida, dataBR, dataHoraBR, escalaImagem, criarApi, criarToast, reduzirImagem };
});
