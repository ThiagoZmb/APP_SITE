// ==========================================================================
// Etapas de produção por pedido ("sub-situação"): funções puras, testáveis sem banco.
// Seis etapas fixas, nesta ordem. Estado por etapa: pendente | ok | na. Origem: manual | corte (marcada pela confirmação do corte real).
// Etapa sem linha gravada: pendente se o grupo (perfil/vidro) se aplica ao pedido; N/A automático se o pedido não tem peças nem pendências do grupo.
// Regras completas: docs/regras/etapas-producao.md
// ==========================================================================
const { classificarSituacao, emAberto } = require('./calendario');

const ETAPAS = [
  { codigo: 'perfil_cortado', nome: 'Perfil cortado', permissao: 'etapas.corte_perfil', grupo: 'perfil', curto: 'Perfil cort.' },
  { codigo: 'vidro_cortado', nome: 'Vidro cortado', permissao: 'etapas.corte_vidro', grupo: 'vidro', curto: 'Vidro cort.' },
  { codigo: 'perfil_pintado', nome: 'Perfil pintado', permissao: 'etapas.pintura_perfil', grupo: 'perfil', curto: 'Perfil pint.' },
  { codigo: 'vidro_pintado', nome: 'Vidro pintado', permissao: 'etapas.pintura_vidro', grupo: 'vidro', curto: 'Vidro pint.' },
  { codigo: 'portas_montadas', nome: 'Portas montadas', permissao: 'etapas.montagem', grupo: null, curto: 'Montadas' },
  { codigo: 'finalizado', nome: 'Pedido finalizado', permissao: 'etapas.finalizar', grupo: null, curto: 'Finalizado' }
];
const ESTADOS = ['pendente', 'ok', 'na'];
const FINAL = 'finalizado';
const GERIR = 'etapas.gerir';
const FILTROS = ['producao', 'abertos'];
const MAX_OBSERVACAO = 500;
// etapas que o corte real marca sozinho (grupo -> etapa)
const ETAPA_DO_CORTE = { perfil: 'perfil_cortado', vidro: 'vidro_cortado' };

const etapaPorCodigo = c => ETAPAS.find(e => e.codigo === c) || null;
const nomeDa = c => (etapaPorCodigo(c) || {}).nome || c;
const concluida = estado => estado === 'ok' || estado === 'na';

// { perfil: { qtdPecas, qtdPendencias }, vidro: {...} } -> { perfil: bool, vidro: bool }
// Aplicável = o pedido tem peças OU pendências do grupo (pendência de medida/ligação é trabalho que existe e não foi resolvido).
function aplicabilidade(grupos = {}) {
  const tem = g => !!g && (Number(g.qtdPecas) || 0) + (Number(g.qtdPendencias) || 0) > 0;
  return { perfil: tem(grupos.perfil), vidro: tem(grupos.vidro) };
}

// linha gravada (web_producao_etapas) ou undefined -> estado efetivo mostrado na tela
function estadoEfetivo(linha, aplicavel) {
  if (linha) {
    return { estado: linha.estado, origem: linha.origem || 'manual', usuario: String(linha.usuario || ''), quando: linha.quando ? String(linha.quando).slice(0, 19) : null,
      observacao: linha.observacao ?? null, automatico: linha.origem === 'corte' };
  }
  return aplicavel ? { estado: 'pendente', origem: null, usuario: '', quando: null, observacao: null, automatico: false }
    : { estado: 'na', origem: 'auto', usuario: '', quando: null, observacao: null, automatico: true };
}

// linhas do pedido + aplicabilidade -> as 6 etapas na ordem fixa
function montarEtapas(linhas = [], aplic = { perfil: true, vidro: true }) {
  const por = new Map((linhas || []).map(l => [l.etapa, l]));
  return ETAPAS.map(e => ({ codigo: e.codigo, ...estadoEfetivo(por.get(e.codigo), e.grupo ? !!aplic[e.grupo] : true) }));
}

const progresso = etapas => ({ qtdConcluidas: etapas.filter(e => concluida(e.estado)).length, qtdEtapas: ETAPAS.length });
const pendentesAntesDeFinalizar = etapas => etapas.filter(e => e.codigo !== FINAL && !concluida(e.estado)).map(e => e.codigo);

const podeAlterar = (permissoes, codigo) => {
  const e = etapaPorCodigo(codigo);
  return !!e && (permissoes.has(GERIR) || permissoes.has(e.permissao));
};
const etapasQuePode = permissoes => ETAPAS.filter(e => podeAlterar(permissoes, e.codigo)).map(e => e.codigo);

// Decide se a mudança pedida vale. Não olha a situação do pedido (isso é da rota, com a linha travada).
// -> { ok:false, status, erro, pendentes? } | { ok:true, mudou, forcado? }
function validarMudanca({ etapas, etapa, estado, permissoes, forcar = false }) {
  const e = etapaPorCodigo(etapa);
  if (!e) return { ok: false, status: 400, erro: 'Etapa inválida.' };
  if (!ESTADOS.includes(estado)) return { ok: false, status: 400, erro: 'Estado inválido. Use ok, pendente ou na.' };
  if (!podeAlterar(permissoes, etapa)) return { ok: false, status: 403, erro: `Sem permissão para a etapa "${e.nome}".` };
  if (etapa === FINAL && estado === 'na') return { ok: false, status: 400, erro: 'A etapa "Pedido finalizado" não aceita N/A.' };
  const atual = etapas.find(x => x.codigo === etapa);
  const final = etapas.find(x => x.codigo === FINAL);
  if (etapa !== FINAL && estado === 'pendente' && final && final.estado === 'ok' && atual && atual.estado !== 'pendente') {
    return { ok: false, status: 409, erro: `O pedido já está finalizado. Desfaça primeiro a etapa "Pedido finalizado" para voltar "${e.nome}" a pendente.` };
  }
  if (atual && atual.estado === estado) return { ok: true, mudou: false };
  if (etapa === FINAL && estado === 'ok') {
    const pendentes = pendentesAntesDeFinalizar(etapas);
    if (pendentes.length) {
      if (forcar) {
        if (!permissoes.has(GERIR)) return { ok: false, status: 403, erro: 'Forçar o finalizado com etapas pendentes exige a permissão de gerir as etapas.' };
        return { ok: true, mudou: true, forcado: true };
      }
      return { ok: false, status: 409, pendentes, erro: `Faltam etapas antes de finalizar: ${pendentes.map(nomeDa).join(', ')}.` };
    }
  }
  return { ok: true, mudou: true };
}

// corpo do PUT -> { ok, dados } | { ok:false, erro }
function validarCorpo(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, erro: 'Corpo inválido.' };
  if (b.observacao !== undefined && b.observacao !== null && typeof b.observacao !== 'string') return { ok: false, erro: 'Observação inválida.' };
  const observacao = typeof b.observacao === 'string' && b.observacao.trim() ? b.observacao.trim() : null;
  if (observacao && observacao.length > MAX_OBSERVACAO) return { ok: false, erro: `A observação passa de ${MAX_OBSERVACAO} caracteres.` };
  const dataPronto = b.dataPronto === undefined || b.dataPronto === null ? 'manter' : b.dataPronto;
  if (!['manter', 'hoje'].includes(dataPronto)) return { ok: false, erro: 'Data de pronto: use manter ou hoje.' };
  return { ok: true, dados: { estado: b.estado, forcar: b.forcar === true, observacao, dataPronto, voltarParaProducao: b.voltarParaProducao === true } };
}

// Corte completo = plano conferido (não cancelado nem excluído) cuja impressão das peças é a do pedido de agora,
// sem pendência de medida/ligação no pedido e com TODAS as peças do plano marcadas como cortadas.
function corteCompleto({ qtdPecas, qtdPendencias, plano }) {
  if (!plano || plano.situacao !== 'conferido' || !plano.impressaoConfere) return false;
  if (!(qtdPecas > 0) || qtdPendencias > 0) return false;
  return plano.qtdPecasPlano > 0 && plano.qtdCortadas >= plano.qtdPecasPlano;
}

// linha atual da etapa de corte + corte completo? -> 'ok' | 'pendente' | null (nada a fazer)
// Marca sobre ausente/pendente; desmarca só OK de origem corte (OK manual e N/A nunca mudam aqui).
function decidirAutomatico(linha, completo) {
  if (completo) return !linha || linha.estado === 'pendente' ? 'ok' : null;
  return linha && linha.estado === 'ok' && linha.origem === 'corte' ? 'pendente' : null;
}

// peças do plano salvo (resultado.plano) e marcas válidas do progresso; `onde` = 'barras' (perfis) | 'chapas' (vidros)
function contarPecasPlano(plano, onde) {
  let n = 0;
  for (const g of (plano && plano.grupos) || []) for (const b of g[onde] || []) n += Array.isArray(b.pecas) ? b.pecas.length : 0;
  return n;
}
function contarCortadas(plano, onde, progresso) {
  if (!Array.isArray(progresso)) return 0;
  const campo = onde === 'barras' ? 'barra' : 'chapa';
  const vistos = new Set();
  for (const m of progresso) {
    const g = ((plano && plano.grupos) || []).find(x => x.chave === (m && m.grupo));
    const b = g && Number.isInteger(m[campo]) ? (g[onde] || [])[m[campo]] : null;
    if (!b || !Number.isInteger(m.peca) || m.peca < 0 || m.peca >= (b.pecas || []).length) continue;
    vistos.add(`${m.grupo}#${m[campo]}#${m.peca}`);
  }
  return vistos.size;
}

// fila: 'producao' (padrão) = só em produção; 'abertos' = em produção, pronto e situação desconhecida (como o calendário)
function validarFiltro(v) {
  if (v === undefined || v === null || v === '') return 'producao';
  return FILTROS.includes(v) ? v : null;
}
function filtrarFila(pedidos, filtro = 'producao') {
  return (pedidos || []).filter(p => (filtro === 'abertos' ? emAberto(p.situacao) : classificarSituacao(p.situacao) === 'producao'));
}
// por data de pronto (mais antiga primeiro: os atrasados ficam no topo), sem data por último; empate pelo número
function ordenarFila(pedidos) {
  return [...pedidos].sort((a, b) => {
    const da = a.prontoEm || '9999-99-99', db = b.prontoEm || '9999-99-99';
    return da < db ? -1 : da > db ? 1 : Number(a.numero) - Number(b.numero);
  });
}

module.exports = { ETAPAS, ESTADOS, FINAL, GERIR, FILTROS, MAX_OBSERVACAO, ETAPA_DO_CORTE, etapaPorCodigo, nomeDa, concluida, aplicabilidade, estadoEfetivo, montarEtapas, progresso,
  pendentesAntesDeFinalizar, podeAlterar, etapasQuePode, validarMudanca, validarCorpo, corteCompleto, decidirAutomatico, contarPecasPlano, contarCortadas, validarFiltro, filtrarFila, ordenarFila };
