// ==========================================================================
// Desenho da porta na tela de orçamentos: funções puras (testadas no Node, test/desenhos_tela.test.js).
// A captura do canvas e o envio ficam em orcamentos.html; aqui só o que não depende do navegador.
// O PNG sobe separado do salvar (o corpo do salvar é limitado a 100 kb): PUT /ped_orc/:tipo/:numero/desenho/:item.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Desenhos = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FRENTES_COM_DESENHO = ['Porta de giro', 'Porta basculante', 'Porta de Correr', 'Frente de gaveta'];
  // itens abertos que o servidor copia (a imagem vai junto); só item novo ou editado envia desenho
  const ESTADOS_COPIA = ['intacto', 'so_pct', 'travado'];

  // escala (w × h) para caber em maxW × maxH mantendo a proporção; inteiros >= 1
  function caixaDoDesenho(w, h, { maxW = 300, maxH = 500 } = {}) {
    const esc = Math.min(maxW / w, maxH / h);
    return { w: Math.max(1, Math.round(w * esc)), h: Math.max(1, Math.round(h * esc)) };
  }

  // gerar(escala) -> Promise<Blob|null>; tenta a escala 1 e reduz (× passo) até o PNG caber no limite. null se não couber ou der erro.
  async function reduzirAteCaber(gerar, limiteBytes, { passo = 0.8, minimo = 0.4 } = {}) {
    try {
      for (let escala = 1; escala >= minimo - 1e-9; escala *= passo) {
        const b = await gerar(escala);
        if (!b) return null;
        if (b.size <= limiteBytes) return b;
      }
    } catch { /* sem canvas/PNG: o item segue sem desenho */ }
    return null;
  }

  // envia o desenho de cada item novo/editado (posição = índice + 1, como o servidor numera). Nunca lança.
  // chamar(caminho, { metodo, corpo, tipoConteudo }) é injetada (fetch com o token na tela)
  async function enviarDesenhos(chamar, tipo, numero, itens) {
    let enviados = 0, falhas = 0, bytes = 0;
    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      if (!it || !it.desenho || typeof it.desenho.size !== 'number') continue;
      if (it.origem && ESTADOS_COPIA.includes(it.origem.estado)) continue;
      try {
        await chamar(`/ped_orc/${encodeURIComponent(tipo)}/${encodeURIComponent(numero)}/desenho/${i + 1}`, { metodo: 'PUT', corpo: it.desenho, tipoConteudo: 'image/png' });
        enviados++; bytes += it.desenho.size;
      } catch { falhas++; }
    }
    return { enviados, falhas, bytes };
  }

  // "7,4 kb" (1 kb = 1024 bytes, vírgula decimal)
  function formatarKb(bytes) { return (Math.round(bytes / 102.4) / 10).toFixed(1).replace('.', ',') + ' kb'; }
  // "2 desenho(s), 14,8 kb." ou '' quando nada foi enviado
  function resumoEnvio(r) { return r && r.enviados > 0 ? `${r.enviados} desenho(s), ${formatarKb(r.bytes || 0)}.` : ''; }

  return { FRENTES_COM_DESENHO, caixaDoDesenho, reduzirAteCaber, enviarDesenhos, formatarKb, resumoEnvio };
});
