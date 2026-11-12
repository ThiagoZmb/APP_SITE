// ==========================================================================
// Mapa ÚNICO situação -> cor do sistema (padrão aprovado em docs/padrao-cores-situacoes.md, DESIGN.md "Cores das situações").
// Uma situação tem UMA cor em todas as telas. Cores possíveis: ok | info | aviso | perigo | neutro (classe .selo do tema.css,
// pares --selo-*). Nada de hsl/hex solto nas telas.
//   Situacoes.cor(grupo, valor)                 -> 'ok' | 'info' | 'aviso' | 'perigo' | 'neutro'  (desconhecido = neutro)
//   Situacoes.selo(grupo, valor, rotulo?, extra?) -> '<span class="selo ok">rótulo</span>' (texto escapado)
//   Situacoes.GRUPOS / Situacoes.normalizar(valor)
// Valor é normalizado: minúsculas, sem acento, espaços/hífens/pontos viram "_" ("Em Produção" = "em_producao").
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Situacoes = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CORES = ['ok', 'info', 'aviso', 'perigo', 'neutro'];

  const GRUPOS = {
    // ped_orc.SITUACAO (Pedido). "atrasado" é derivado (previsão vencida e ainda em produção) e prevalece.
    pedido: { em_producao: 'info', pronto: 'aviso', entregue: 'ok', retirado: 'ok', cancelado: 'neutro', atrasado: 'perigo' },
    // ped_orc.SITUACAO (Orçamento)
    orcamento: { aguardando_resposta: 'aviso', fechado: 'ok', baixado: 'neutro' },
    // ped_orc.FINANCEIRO e fluxo_de_caixa.SITUACAO (entrada e saída)
    financeiro: { recebido: 'ok', pago: 'ok', a_receber: 'aviso', a_pagar: 'aviso', faturado: 'info', atrasado: 'perigo', protestado: 'perigo', sem_custo: 'neutro' },
    // web_entregas.status (+ estados só de exibição). Tipo de entrega não tem cor.
    entrega: { a_programar: 'aviso', agendada: 'info', em_rota: 'info', enviada: 'info', ocorrencia: 'perigo', entregue: 'ok', retirado: 'ok',
      concluida: 'ok', cancelada: 'neutro', encerrada: 'neutro', suspensa: 'aviso' },
    // web_producao_etapas.estado; "ok_corte" = OK vindo do corte (mantém a distinção azul)
    etapa: { ok: 'ok', ok_corte: 'info', pendente: 'neutro', na: 'neutro' },
    // web_corte_planos / web_vidro_planos .situacao
    plano: { gerado: 'info', conferido: 'ok', desatualizado: 'aviso', cancelado: 'neutro' },
    // web_retalhos / web_vidro_retalhos .situacao
    retalho: { disponivel: 'ok', reservado: 'info', usado: 'neutro', descartado: 'neutro' },
    // web_notas_fiscais.situacao e notas de compra pela SEFAZ
    nota: { ativa: 'ok', cancelada: 'perigo', resumo: 'aviso', ciencia: 'info', completa: 'ok', importada: 'neutro' },
    // estoque: item, saldo, previsão, movimento
    estoque_item: { ativo: 'ok', inativo: 'neutro' },
    estoque_saldo: { normal: 'ok', no_minimo: 'aviso', minimo: 'aviso', em_falta: 'perigo', falta: 'perigo', inativo: 'neutro' },
    estoque_previsao: { falta: 'perigo', comprar: 'aviso', atencao: 'aviso', ok: 'ok', sem_consumo: 'neutro', poucos_dados: 'neutro' },
    estoque_movimento: { entrada: 'ok', saida: 'aviso', ajuste: 'info', estorno: 'neutro' },
    // custos dos materiais
    custo: { confiavel: 'ok', desatualizado: 'aviso', faltando: 'perigo', sem_compra: 'neutro', informado: 'info', divergente: 'aviso' },
    // cadastros e acesso (usuário, cliente, fornecedor, funcionário, portal). "Inativo" é sempre neutro.
    cadastro: { ativo: 'ok', ativa: 'ok', inativo: 'neutro', inativa: 'neutro', demitido: 'neutro', liberado: 'ok', bloqueado: 'perigo',
      convidado: 'aviso', suspensa: 'perigo', suspenso: 'perigo', nao_liberada: 'neutro', sem_acesso: 'neutro', inativo_na_web: 'neutro', inativo_no_vb: 'neutro' },
    // leitura de PDF: valor lido e item
    leitura: { confirmado: 'ok', inferido: 'aviso', ausente: 'perigo', conflitante: 'perigo', fora: 'neutro', pronto: 'ok', pendente: 'aviso', bloqueado: 'perigo' },
    // auditoria do cálculo de preço
    calculo: { pendente: 'aviso', aplicado: 'ok', simulado: 'info', descartado: 'neutro', erro: 'perigo' },
    // Central de Gestão (orçamento por categoria e alertas)
    gestao: { estourado: 'perigo', alerta: 'perigo', risco_ritmo: 'aviso', atencao: 'aviso', ok: 'ok', sem_orcamento: 'neutro', nao_calculavel: 'neutro',
      critico: 'perigo', info: 'info' }
  };

  function normalizar(valor) {
    return String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s.\-/]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  function cor(grupo, valor) {
    const g = GRUPOS[grupo];
    if (!g) return 'neutro';
    const c = g[normalizar(valor)];
    return c || 'neutro';
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // extra: classes adicionais (ex.: 'grande'); o rótulo padrão é o próprio valor
  function selo(grupo, valor, rotulo, extra) {
    const texto = rotulo === undefined || rotulo === null ? valor : rotulo;
    return `<span class="selo ${cor(grupo, valor)}${extra ? ' ' + esc(extra) : ''}">${esc(texto)}</span>`;
  }

  return { CORES, GRUPOS, normalizar, cor, selo };
});
