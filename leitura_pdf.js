// ==========================================================================
// orcamentos.html — leitura de projeto técnico em PDF pelo servidor (rotas /leitura_pdf, pasta leitura/).
//
// Fluxo: escolher o PDF → enviar (POST /leitura_pdf) → acompanhar (GET /leitura_pdf/:id, polling) →
// JANELA DE CONFERÊNCIA (cada valor com estado, confiança e página; a pessoa confirma, rejeita com motivo,
// informa ou escolhe o candidato; POST /leitura_pdf/:id/confirmar) → "Importar N itens" entrega o arquivo de
// itens ao fluxo que já existe (importar_itens.js: cadastro, preço pelo /calcular_preco, resumo e confirmação).
// Aqui ficam só as funções puras e o polling (testados no Node); o desenho da janela fica em orcamentos.html.
// Tudo o que vem do PDF é DADO: a tela só usa textContent.
// Carregável pelo navegador (window.LeituraPdf) e pelo Node (require).
// ==========================================================================
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.LeituraPdf = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITES = { bytes: 25 * 1024 * 1024, motivo: 200, valor: 200 };
  const ESTADOS = { confirmado: 'Confirmado', inferido: 'Inferido — conferir', ausente: 'Não encontrado', conflitante: 'Conflitante — escolher' };
  const ETAPAS_FINAIS = ['pronto', 'erro', 'cancelada'];
  const MSG_PENDENTE = 'Valores lidos do PDF ainda não conferidos (confirme ou rejeite cada um na janela de leitura).';

  const curto = (v, n = 160) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const ehObjeto = v => !!v && typeof v === 'object' && !Array.isArray(v);

  // ---------------- arquivo ----------------
  function validarArquivo(arq) {
    if (!arq) return 'Nenhum arquivo escolhido.';
    const nome = String(arq.name || '');
    if (!/\.pdf$/i.test(nome) && arq.type !== 'application/pdf') return 'Escolha um arquivo PDF.';
    if (!(arq.size > 0)) return 'O arquivo está vazio.';
    if (arq.size > LIMITES.bytes) return `PDF grande demais (${(arq.size / 1024 / 1024).toFixed(1)} MB). O máximo é ${LIMITES.bytes / 1024 / 1024} MB.`;
    return null;
  }

  // ---------------- andamento ----------------
  function textoAndamento(t, segundos) {
    const tempo = segundos >= 0 ? ` (${Math.floor(segundos / 60)}:${String(Math.floor(segundos % 60)).padStart(2, '0')})` : '';
    if (!t) return 'Enviando…' + tempo;
    if (t.estado === 'erro') return (t.erro && t.erro.mensagem) || 'Erro na leitura.';
    if (t.estado === 'cancelada') return 'Leitura cancelada.';
    if (t.estado === 'pronto') return 'Leitura concluída.';
    return (t.etapa || 'Lendo o desenho…') + tempo;
  }

  // Consulta a tarefa até terminar. api(caminho) → JSON (lança Error com .status em erro HTTP).
  // deveParar() → true interrompe (janela fechada/cancelar). Devolve a última tarefa ou null se parou.
  async function acompanhar(id, { api, aoMudar = () => {}, deveParar = () => false, esperar = ms => new Promise(r => setTimeout(r, ms)), intervaloMs = 2500, maxMs = 20 * 60 * 1000, agora = () => Date.now() } = {}) {
    const inicio = agora();
    let falhas = 0;
    for (;;) {
      if (deveParar()) return null;
      let t;
      try {
        t = await api(`/leitura_pdf/${encodeURIComponent(id)}`);
        falhas = 0;
      } catch (e) {
        if (e && e.status === 404) throw e;                  // expirou ou o servidor reiniciou
        if (++falhas >= 4) throw e;                           // rede instável: desiste depois de algumas tentativas
        t = null;
      }
      if (deveParar()) return null;
      if (t) {
        aoMudar(t);
        if (ETAPAS_FINAIS.includes(t.estado)) return t;
      }
      if (agora() - inicio > maxMs) throw Object.assign(new Error('A leitura está demorando demais. Tente de novo mais tarde.'), { status: 0 });
      await esperar(intervaloMs);
    }
  }

  // ---------------- decisões (locais até "Aplicar") ----------------
  // decisoes = { [idValor]: { tipo: 'confirmar' } | { tipo: 'rejeitar', motivo } | { tipo: 'informar', valor }
  //                       | { tipo: 'corrigir', motivo, valor } | { tipo: 'resolver', candidato } }
  function validarDecisao(linha, d) {
    if (!linha || !d) return 'Decisão inválida.';
    const acoes = linha.acoes || [];
    const texto = (v, max) => typeof v === 'string' && v.trim() && v.trim().length <= max;
    switch (d.tipo) {
      case 'confirmar': return acoes.includes('confirmar') ? null : 'Só valor inferido pode ser confirmado.';
      case 'rejeitar': if (!acoes.includes('rejeitar')) return 'Só valor inferido pode ser rejeitado.';
        return texto(d.motivo, LIMITES.motivo) ? null : 'Escreva o motivo da rejeição.';
      case 'corrigir': if (!acoes.includes('rejeitar')) return 'Só valor inferido pode ser corrigido.';
        if (!texto(d.motivo, LIMITES.motivo)) return 'Escreva o motivo da correção.';
        return texto(d.valor, LIMITES.valor) ? null : 'Informe o valor correto.';
      case 'informar': if (!acoes.includes('informar')) return 'Só valor não encontrado pode ser informado.';
        return texto(d.valor, LIMITES.valor) ? null : 'Informe o valor.';
      case 'resolver': if (!acoes.includes('resolver')) return 'Só valor conflitante tem candidatos.';
        return (linha.candidatos || []).some(c => c.id === d.candidato) ? null : 'Escolha um dos valores lidos.';
      default: return 'Decisão inválida.';
    }
  }
  // devolve um objeto novo; decisao null desfaz
  function decidir(decisoes, id, decisao) {
    const novo = { ...decisoes };
    if (decisao) novo[id] = { ...decisao, ...(decisao.motivo !== undefined ? { motivo: String(decisao.motivo).trim() } : {}), ...(decisao.valor !== undefined ? { valor: String(decisao.valor).trim() } : {}) };
    else delete novo[id];
    return novo;
  }
  // "Confirmar todos os valores lidos deste item": só os inferidos ainda sem decisão (nunca sobrescreve)
  function confirmarTodosDoItem(decisoes, item) {
    let novo = { ...decisoes };
    for (const l of (item && item.valores) || []) if (l.estado === 'inferido' && !novo[l.id]) novo = decidir(novo, l.id, { tipo: 'confirmar' });
    return novo;
  }
  const qtdDecisoes = decisoes => Object.keys(decisoes || {}).length;

  // corpo do POST /leitura_pdf/:id/confirmar ("corrigir" = rejeitar com motivo + informar o valor certo)
  function corpoDecisoes(decisoes) {
    const corpo = { confirmar: [], rejeitar: [], informar: [], resolver: [] };
    for (const [id, d] of Object.entries(decisoes || {})) {
      if (d.tipo === 'confirmar') corpo.confirmar.push(id);
      else if (d.tipo === 'rejeitar') corpo.rejeitar.push({ id, motivo: d.motivo });
      else if (d.tipo === 'informar') corpo.informar.push({ id, valor: d.valor });
      else if (d.tipo === 'corrigir') { corpo.rejeitar.push({ id, motivo: d.motivo }); corpo.informar.push({ id, valor: d.valor }); }
      else if (d.tipo === 'resolver') corpo.resolver.push({ conflitante: id, candidato: d.candidato });
    }
    return corpo;
  }

  // ---------------- apresentação ----------------
  function descreverLinha(l) {
    const valor = l.valor !== '' ? `${l.valor}${l.unidade && l.unidade !== 'un' ? ' ' + l.unidade : ''}` : '—';
    const partes = [];
    if (l.estado !== 'ausente' && typeof l.confianca === 'number' && !l.confirmacao) partes.push(`confiança ${Math.round(l.confianca * 100)}%`);
    partes.push(l.pagina ? `pág. ${l.pagina}` : 'página não informada');
    if (l.confirmacao) partes.push(`conferido por ${curto(l.confirmacao.por, 40)}`);
    return { estado: ESTADOS[l.estado] || l.estado, valor, detalhes: partes.join(' · '), trecho: curto(l.trecho, 200) };
  }
  function textoDecisao(d, linha) {
    if (!d) return '';
    if (d.tipo === 'confirmar') return '✓ será confirmado';
    if (d.tipo === 'rejeitar') return `✗ será rejeitado: ${curto(d.motivo, 80)}`;
    if (d.tipo === 'informar') return `✎ será informado: ${curto(d.valor, 60)}`;
    if (d.tipo === 'corrigir') return `✎ será corrigido para ${curto(d.valor, 60)} (${curto(d.motivo, 60)})`;
    if (d.tipo === 'resolver') { const c = ((linha && linha.candidatos) || []).find(x => x.id === d.candidato); return `✓ vale ${c ? curto(c.valor, 40) + (c.unidade && c.unidade !== 'un' ? ' ' + c.unidade : '') : d.candidato}`; }
    return '';
  }
  function situacaoItem(item) {
    if (item.foraDoEscopo) return { classe: 'fora', texto: 'Não importado (fora do escopo atual: lance à mão)' };
    if (item.importavel) return { classe: 'ok', texto: 'Pronto para importar' };
    if (item.faltaDecidir) return { classe: 'pendente', texto: `${item.faltaDecidir} valor(es) a conferir` };
    return { classe: 'bloqueado', texto: 'Bloqueado: veja as pendências' };
  }
  // separa os valores do item: os que pedem atenção primeiro; ausentes opcionais no fim (recolhidos)
  function gruposDoItem(item) {
    const v = (item && item.valores) || [];
    return {
      principais: v.filter(l => l.estado !== 'ausente' || l.obrigatorio),
      ausentesOpcionais: v.filter(l => l.estado === 'ausente' && !l.obrigatorio),
    };
  }

  // botões do rodapé
  function resumo(conferencia, decisoes) {
    const n = (conferencia && conferencia.qtdImportaveis) || 0;
    const k = qtdDecisoes(decisoes);
    const total = ((conferencia && conferencia.itens) || []).filter(i => !i.foraDoEscopo).length;
    return {
      importaveis: n, decisoesPendentes: k, itensPortas: total,
      podeAplicar: k > 0,
      podeImportar: n > 0 && k === 0,
      textoImportar: n ? `Importar ${n} item(ns)` : 'Importar',
      dica: k ? `Há ${k} decisão(ões) não aplicada(s): clique em "Aplicar decisões".`
        : n < total ? `${total - n} item(ns) de porta ainda não podem ser importados (veja cada um).` : '',
    };
  }

  // Arquivo de itens (formato do montar-itens) para o fluxo de importação que já existe.
  // Item que a conferência não liberou (valor ainda não conferido ou bloqueio) sai com pendência bloqueante,
  // para o resumo da importação mostrar por que ficou de fora.
  function saidaParaImportar(conferencia) {
    if (!conferencia || !ehObjeto(conferencia.saida)) return null;
    const saida = JSON.parse(JSON.stringify(conferencia.saida));
    const liberados = new Set((conferencia.itens || []).filter(i => i.importavel).map(i => i.idItem));
    for (const it of saida.itens || []) {
      if (!ehObjeto(it) || it.foraDoEscopo || liberados.has(it.idItem)) continue;
      it.prontoParaLancar = false;
      it.pendencias = [...(Array.isArray(it.pendencias) ? it.pendencias : []),
        { id: `pend-${it.idItem}-conferencia-web`, tipo: 'inferido', destino: 'tipo', mensagem: MSG_PENDENTE, bloqueante: true, refs: [it.idItem] }];
    }
    return saida;
  }

  return { LIMITES, ESTADOS, validarArquivo, textoAndamento, acompanhar, validarDecisao, decidir, confirmarTodosDoItem, qtdDecisoes, corpoDecisoes, descreverLinha, textoDecisao, situacaoItem, gruposDoItem, resumo, saidaParaImportar };
});
