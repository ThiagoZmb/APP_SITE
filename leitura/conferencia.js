// ==========================================================================
// Janela de conferência: projeto verificado + itens da tela → o que a tela mostra.
// Função pura (sem rede, sem banco). Só apresenta: as regras são da skill
// (estado de cada valor, pendências, prontoParaLancar) e não são recalculadas aqui.
// Um item só é "importável" quando a skill o liberou E não sobrou nenhum valor
// inferido ou conflitante nele: tudo que a leitura achou foi conferido por uma pessoa.
// ==========================================================================
const ROTULOS = {
  qtd: 'Quantidade', altura: 'Altura', largura: 'Largura', tipoFrente: 'Tipo de frente', perfil: 'Perfil',
  acabamentoPerfil: 'Acabamento do perfil', corPerfil: 'Cor do perfil', puxador: 'Puxador', tipoPuxador: 'Tipo do puxador',
  acabamentoPuxador: 'Acabamento do puxador', corPuxador: 'Cor do puxador', tamanhoPuxador: 'Tamanho do puxador',
  posicoesPuxador: 'Posições do puxador', revestimento: 'Revestimento', corRevestimento: 'Cor do revestimento',
  divisor: 'Divisor', divisoresHorizontais: 'Divisores horizontais', divisoresVerticais: 'Divisores verticais',
  sistema: 'Sistema de correr', transpasse: 'Transpasse', furos: 'Furos (mm)', ladosFuros: 'Lados dos furos', observacao: 'Observação',
  total: 'Total', declarado: 'Declarado na legenda', contado: 'Contado no desenho',
};
const ACOES = { inferido: ['confirmar', 'rejeitar'], ausente: ['informar'], conflitante: ['resolver'], confirmado: [] };
const BLOQUEIAM_TUDO = ['texto_suspeito', 'dominio_divergente'];

const textoValor = v => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v));

function linha(v, campo, obrigatorio) {
  const l = {
    id: v.id, campo, rotulo: ROTULOS[campo] || campo, obrigatorio: !!obrigatorio,
    estado: v.estado, valor: textoValor(v.valor), unidade: v.unidade || '', confianca: v.confianca,
    pagina: Number.isInteger(v.origem?.pagina) ? v.origem.pagina : null, trecho: v.origem?.trecho || '',
    metodo: v.metodo, acoes: ACOES[v.estado] || [],
  };
  if (v.estado === 'conflitante') l.candidatos = (v.candidatos || []).map(c => ({ id: c.id, valor: textoValor(c.valor), unidade: c.unidade || '', pagina: c.origem?.pagina ?? null, trecho: c.origem?.trecho || '' }));
  if (v.confirmacao) l.confirmacao = { por: v.confirmacao.por, em: v.confirmacao.em };
  return l;
}

const decidir = l => l.estado === 'inferido' || l.estado === 'conflitante';

// mapa: o do domínio (para saber os obrigatórios); extras: { legendas, observacoes } da leitura
function montarConferencia({ docVerificado: doc, saida, mapa, extras = {} }) {
  const obrigatorios = new Set((mapa?.campos || []).filter(c => c.obrigatorio === true).map(c => c.origem.split('.').pop()));
  const porItem = new Map(saida.itens.map(i => [i.idItem, i]));
  const docPend = saida.pendenciasDocumento || [];
  const ids = doc.itens.map(i => i.id);
  // pendência do documento: de um item (refs com o prefixo do item) ou geral (bloqueia todos)
  const doItem = p => ids.filter(id => (p.refs || []).some(r => r === id || r.startsWith(`${id}.`)));
  const gerais = docPend.filter(p => BLOQUEIAM_TUDO.includes(p.tipo) || !doItem(p).length);

  const itens = doc.itens.map(it => {
    const s = porItem.get(it.id) || {};
    const valores = [linha(it.quantidade, 'qtd', obrigatorios.has('quantidade')),
      ...Object.entries(it.dimensoes).map(([k, v]) => linha(v, k, obrigatorios.has(k))),
      ...Object.entries(it.atributos).map(([k, v]) => linha(v, k, obrigatorios.has(k)))];
    const pendDoc = docPend.filter(p => doItem(p).includes(it.id));
    const faltaDecidir = valores.filter(decidir).length;
    const bloqueios = [...gerais, ...pendDoc].map(p => p.mensagem);
    return {
      idItem: it.id, categoria: it.tipo, legenda: extras.legendas?.[it.id] || '', foraDoEscopo: s.foraDoEscopo === true,
      prontoParaLancar: s.prontoParaLancar === true, faltaDecidir,
      importavel: s.prontoParaLancar === true && s.foraDoEscopo !== true && faltaDecidir === 0 && bloqueios.length === 0,
      valores,
      pendencias: [...(s.pendencias || []).map(p => ({ tipo: p.tipo, mensagem: p.mensagem, bloqueante: p.bloqueante })),
        ...pendDoc.map(p => ({ tipo: p.tipo, mensagem: p.mensagem, bloqueante: true }))],
    };
  });
  const verificacoes = [
    ...(doc.cotas || []).map(c => ({ id: c.id, tipo: 'cota', descricao: c.descricao, valores: [linha(c.total, 'total'), ...c.parciais.map((p, i) => ({ ...linha(p, 'parcial'), rotulo: `Parcial ${i + 1}` }))] })),
    ...(doc.contagens || []).map(c => ({ id: c.id, tipo: 'contagem', descricao: c.descricao, valores: [linha(c.declarado, 'declarado'), linha(c.contado, 'contado')] })),
  ];
  return {
    arquivo: doc.documento.arquivo,
    paginas: doc.documento.paginas ?? null,
    qtdImportaveis: itens.filter(i => i.importavel).length,
    itens, verificacoes,
    pendenciasGerais: gerais.map(p => ({ tipo: p.tipo, mensagem: p.mensagem, pagina: p.pagina ?? null })),
    alertas: (doc.alertasSeguranca || []).map(a => ({ pagina: a.pagina, trecho: a.trecho, motivo: a.motivo })),
    observacoes: extras.observacoes || [],
    saida,
  };
}

module.exports = { montarConferencia, ROTULOS };
