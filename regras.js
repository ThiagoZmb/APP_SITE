// ==========================================================================
// regras.html — Livro de regras (SÓ LEITURA). Rota: GET /regras/livro (administrativo.ver).
// Funções puras testadas no Node (test/regras_pagina.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.LivroRegras = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? null : raiz.EntregasComum;

  const NIVEIS = {
    bloqueia: { texto: 'Bloqueia', classe: 'perigo' },
    confirma: { texto: 'Pergunta', classe: 'aviso' },
    avisa: { texto: 'Avisa', classe: 'info' }
  };
  const ESCOPOS = { item: 'Item', documento: 'Documento' };

  const rotuloNivel = n => NIVEIS[n] ? { ...NIVEIS[n] } : { texto: String(n ?? ''), classe: 'neutro' };
  const rotuloEscopo = e => ESCOPOS[e] || String(e ?? '');
  const linhasDaTabela = regras => (Array.isArray(regras) ? regras : []).map(r => ({
    codigo: String(r.codigo ?? ''), nivel: rotuloNivel(r.nivel), escopo: rotuloEscopo(r.escopo), titulo: String(r.titulo ?? '')
  }));
  const ok = n => Number.isFinite(n) && n >= 0;
  // os limites vêm do servidor (fonte única); aqui só viram frases legíveis
  function textosLimites(l) {
    const t = [];
    if (!l || typeof l !== 'object') return t;
    if (ok(l.portaMedidaAlertaMm)) t.push(`Porta com menos de ${l.portaMedidaAlertaMm} mm gera aviso`);
    if (ok(l.puxadorEmbutidoMinMm)) t.push(`Puxador embutido: mínimo de ${l.puxadorEmbutidoMinMm} mm`);
    if (ok(l.puxadorEmbutidoMaxMm)) t.push(`Puxador embutido: máximo de ${l.puxadorEmbutidoMaxMm} mm`);
    return t;
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const { esc } = C;
    const { chamar } = C.criarApi(win);

    function mensagemDeErro(err) {
      if (err && err.status === 403) return 'Você não tem permissão para ver o livro de regras.';
      if (err && err.message === C.SEM_CONEXAO) return C.SEM_CONEXAO;
      return (err && err.message) || 'Não foi possível carregar o livro de regras.';
    }
    function desenhar(d) {
      const linhas = linhasDaTabela(d && d.regras);
      $('regras-corpo').innerHTML = linhas.length
        ? '<table><thead><tr><th>Código</th><th>Nível</th><th>Onde vale</th><th>Regra</th></tr></thead><tbody>' +
          linhas.map(l => `<tr><td><code>${esc(l.codigo)}</code></td><td><span class="selo ${esc(l.nivel.classe)}">${esc(l.nivel.texto)}</span></td>` +
            `<td>${esc(l.escopo)}</td><td>${esc(l.titulo)}</td></tr>`).join('') + '</tbody></table>'
        : '<p class="vazio">Nenhuma regra cadastrada.</p>';
      const lim = textosLimites(d && d.limites);
      $('limites').innerHTML = lim.length ? '<ul>' + lim.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="cinza">Sem limites informados.</p>';
    }
    async function carregar() {
      try { desenhar(await chamar('/regras/livro')); }
      catch (err) {
        $('regras-corpo').innerHTML = '<p class="vazio erro-msg" role="alert"></p>';
        $('regras-corpo').firstChild.textContent = mensagemDeErro(err);
        $('limites').innerHTML = '';
      }
    }
    carregar();
  }

  return { NIVEIS, rotuloNivel, rotuloEscopo, linhasDaTabela, textosLimites, iniciar };
});
