// Histórico do pedido (menu do botão direito → "Histórico do pedido"): transforma as linhas de web_auditoria do pedido em texto em português.
// Funções puras (sem banco). Regras:
//  - só as ações de ACOES_HISTORICO entram; qualquer outra é ignorada;
//  - NUNCA mostra dinheiro: desconto adicional vira só o fato "alterado"; aviso de preço divergente vira só o aviso (e a quantidade de itens);
//  - JSON inválido ou fora do esperado no `detalhe` nunca derruba nada: o texto sai só com o que for possível afirmar;
//  - o nome do cliente (detalhe.cliente) e qualquer outro campo não listado aqui nunca saem.
// Texto vindo do banco é cortado em 40 caracteres; a tela mostra tudo por textContent (nunca como HTML).

const ACOES_HISTORICO = ['pedido_situacao', 'pedido_situacao_entregas_abertas', 'pedido_cancelado', 'data_pronto_alterada',
  'desconto_adicional_alterado', 'preco_divergente', 'orcamento_virou_pedido'];
const LIMITE_HISTORICO = 200;

const texto = v => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 40) : '');

// 'AAAA-MM-DD' (ou 'AAAA-MM-DD hh:mm:ss') → 'dd/mm/aaaa'; outra coisa → ''
function dataBR(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// detalhe pode chegar como texto JSON, objeto ou lixo: sempre devolve um objeto simples
function lerDetalhe(detalhe) {
  let d = detalhe;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return {}; } }
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Texto do evento, ou null se a ação não faz parte do histórico. `quando` ('AAAA-MM-DD hh:mm:ss') só serve para dizer "hoje" = dia do registro.
function resumoDoEvento(acao, detalhe, quando) {
  const d = lerDetalhe(detalhe);
  const origem = d.origem === 'etapas_producao' ? ' (pela etapa "Pedido finalizado")' : '';
  switch (acao) {
    case 'pedido_situacao': {
      const de = texto(d.de), para = texto(d.para);
      let t = `Situação: ${de || 'não informada'} → ${para || 'não informada'}`;
      const entrega = para === 'Entregue' || para === 'Retirado';
      if (d.dataEscolhida === true) t += ' (data de entrega escolhida na janela)';
      else if (d.usarDataPronto === true) t += ' (data de entrega = data de pronto)';
      else if (d.manterData === true) t += ' (data de entrega mantida)';
      else if (entrega) t += dataBR(quando) ? ` (data de entrega = hoje, ${dataBR(quando)})` : ' (data de entrega = hoje)';
      return t + origem;
    }
    case 'pedido_situacao_entregas_abertas': {
      const n = Number(d.entregasAbertas) || 0, para = texto(d.para);
      const enc = Array.isArray(d.entregasEncerradas) ? d.entregasEncerradas.length : Number(d.entregasEncerradas) || 0;
      return `Confirmou marcar como ${para || 'a nova situação'} com ${plural(n, 'entrega em aberto', 'entregas em aberto')}`
        + (enc ? ` (${plural(enc, 'encerrada junto', 'encerradas junto')})` : '');
    }
    case 'pedido_cancelado': {
      const era = texto(d.situacaoAnterior);
      return era ? `Pedido cancelado (era ${era})` : 'Pedido cancelado';
    }
    case 'data_pronto_alterada': {
      const de = dataBR(d.de), para = dataBR(d.para);
      return `Data de pronto: ${de || 'sem data'} → ${para || 'sem data'}${origem}`;
    }
    case 'desconto_adicional_alterado':
      return 'Desconto adicional alterado';
    case 'preco_divergente': {
      const n = Array.isArray(d.itens) ? d.itens.length : 0;
      return n ? `Aviso de preço divergente na gravação (${plural(n, 'item', 'itens')})` : 'Aviso de preço divergente na gravação';
    }
    case 'orcamento_virou_pedido': {
      const o = Number(d.orcamento);
      return Number.isInteger(o) && o > 0 ? `Criado a partir do orçamento nº ${o}` : null;
    }
    default:
      return null;
  }
}

// Linhas de web_auditoria ({ quando, quem, acao, detalhe }) → [{ quando, quem, acao, resumo }], na ordem recebida (o servidor manda do mais novo ao mais antigo).
function montarHistorico(linhas) {
  const saida = [];
  for (const l of Array.isArray(linhas) ? linhas : []) {
    if (!l || !ACOES_HISTORICO.includes(l.acao)) continue;
    const quando = String(l.quando ?? '');
    const resumo = resumoDoEvento(l.acao, l.detalhe, quando);
    if (!resumo) continue;
    saida.push({ quando, quem: texto(l.quem) || '(desconhecido)', acao: l.acao, resumo });
    if (saida.length >= LIMITE_HISTORICO) break;
  }
  return saida;
}

module.exports = { ACOES_HISTORICO, LIMITE_HISTORICO, montarHistorico, resumoDoEvento, lerDetalhe, dataBR };
