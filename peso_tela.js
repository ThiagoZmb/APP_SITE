// ==========================================================================
// Peso das portas na tela de orçamentos: funções puras (testadas no Node, test/peso_tela.test.js).
// O peso aparece SÓ em orcamentos.html (nunca no PDF nem na gravação). Consulta: POST /peso/itens (rotas/peso_itens.js).
// A chamada de rede, o cancelamento de resposta velha e o desenho na página ficam em orcamentos.html.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.PesoTela = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_ITENS = 100; // limite da rota
  const FRENTES_PORTA = ['Porta de giro', 'Porta basculante', 'Frente de gaveta', 'Porta de Correr'];

  // "12,35 kg" (vírgula decimal, 2 casas); null/NaN = ''
  function formatarKg(n) {
    if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
    return Number(n).toFixed(2).replace('.', ',') + ' kg';
  }

  // Só o que o peso precisa (o corpo do salvar não é reaproveitado: o peso NUNCA vai no salvar).
  // Serralheria e Avulso vão só com a frente (o servidor responde "sem cálculo de peso").
  function itemParaPeso(it) {
    if (!it) return null;
    if (!FRENTES_PORTA.includes(it.frente)) return { frente: it.frente, qtd: it.qtd };
    return { frente: it.frente, qtd: it.qtd, altura: it.altura, largura: it.largura, furos: it.furos, detalhes: it.detalhes };
  }

  // Itens da lista → corpo da consulta. Itens 🔒 (só o VB edita) não vão; `indices` guarda a posição de cada item enviado.
  function prepararConsulta(itens) {
    const lista = Array.isArray(itens) ? itens : [];
    const enviados = [], indices = [];
    lista.forEach((it, i) => { if (it && !it.travado) { enviados.push(itemParaPeso(it)); indices.push(i); } });
    return { corpo: { itens: enviados }, indices, longo: enviados.length > MAX_ITENS };
  }

  // chave de cache: o mesmo conteúdo dos itens enviados dá a mesma chave
  const chaveDe = corpo => JSON.stringify(corpo && corpo.itens || []);

  // Resposta do servidor → um resultado por item da lista da tela { kg, parcial, pendencias, motivo }.
  // Item 🔒 sai sem peso (motivo) e, se for porta, deixa o total parcial.
  function resultadosDaLista(itens, indices, resposta) {
    const saida = (itens || []).map(it => ({ kg: null, parcial: false, pendencias: null, motivo: it && it.travado ? 'item bloqueado (só o VB edita)' : '' }));
    const rs = resposta && Array.isArray(resposta.itens) ? resposta.itens : [];
    indices.forEach((pos, k) => {
      const r = rs[k];
      if (!r) return;
      saida[pos] = { kg: r.pesoKg === null || r.pesoKg === undefined ? null : Number(r.pesoKg), parcial: !!r.parcial,
        pendencias: Array.isArray(r.pendencias) ? r.pendencias : null, motivo: r.motivo || '' };
    });
    return saida;
  }

  // Total do documento a partir da resposta (+ itens 🔒 de porta = parcial). null = nada a mostrar.
  function totalDoDocumento(itens, resposta) {
    if (!resposta || resposta.pesoDocumentoKg === null || resposta.pesoDocumentoKg === undefined) return null;
    const travadoPorta = (itens || []).some(it => it && it.travado && /porta|gaveta/i.test(String(it.frente || '')));
    return { kg: Number(resposta.pesoDocumentoKg), parcial: !!resposta.parcial || travadoPorta };
  }

  // Texto do peso de um item: { texto, titulo, parcial }. Sem peso = "—".
  function rotuloItem(r) {
    if (!r || r.kg === null || r.kg === undefined) return { texto: '—', titulo: r && r.motivo ? r.motivo : '', parcial: false };
    const titulo = r.parcial
      ? 'Peso parcial. Faltam: ' + ((r.pendencias || []).map(p => `${p.produto ? p.produto + ': ' : ''}${p.motivo}`).join('; ') || 'dados do cadastro de pesos') : '';
    const base = r.parcial && !(Number(r.kg) > 0) ? 'sem peso cadastrado' : formatarKg(r.kg);
    return { texto: base + (r.parcial && Number(r.kg) > 0 ? ' parcial' : ''), titulo, parcial: !!r.parcial };
  }

  // Texto do peso total: "Peso total: 12,35 kg (parcial)" ou ''
  function rotuloTotal(t) {
    if (!t || t.kg === null || !Number.isFinite(t.kg)) return '';
    if (t.parcial && !(t.kg > 0)) return 'sem peso cadastrado';
    return formatarKg(t.kg) + (t.parcial ? ' (parcial)' : '');
  }

  // Item do formulário em montagem → item para a consulta (campos lidos da tela pelo chamador).
  // Só vale com perfil, altura e largura (mesma condição do cálculo de preço); senão null (esconde o peso).
  function itemDoFormulario(f) {
    if (!f || !FRENTES_PORTA.includes(f.frente)) return null;
    if (!f.detalhes || !f.detalhes.perfil || !(Number(f.altura) > 0) || !(Number(f.largura) > 0)) return null;
    return itemParaPeso(f);
  }

  return { MAX_ITENS, formatarKg, itemParaPeso, prepararConsulta, chaveDe, resultadosDaLista, totalDoDocumento, rotuloItem, rotuloTotal, itemDoFormulario };
});
