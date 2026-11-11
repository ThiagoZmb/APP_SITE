// Módulo Entregas: regras de status e validação de anexo (funções puras, sem banco)
const STATUS = Object.freeze({
  A_PROGRAMAR: 'a_programar', AGENDADA: 'agendada', EM_ROTA: 'em_rota', OCORRENCIA: 'ocorrencia',
  ENTREGUE: 'entregue', RETIRADO: 'retirado', ENVIADA: 'enviada', CANCELADA: 'cancelada'
});
const TIPOS = Object.freeze({ MOTORISTA: 'motorista', RETIRADA: 'retirada', OUTRO_ESTADO: 'outro_estado' });

const MOTIVOS_OCORRENCIA = ['ausente', 'endereco_errado', 'recusa', 'parcial'];

// em_rota: só o motorista conclui (entregue/ocorrência); a equipe pode reagendar ou cancelar para não deixar a entrega presa
// ação -> { de: status de origem, tipo: tipo exigido (null = qualquer), para: status novo, evento }
const TRANSICOES = {
  agendar: { de: ['a_programar'], tipo: null, para: 'agendada', evento: 'agendada' },
  reagendar: { de: ['ocorrencia', 'agendada', 'em_rota'], tipo: null, para: 'agendada', evento: 'reagendada' },
  saiu: { de: ['agendada'], tipo: 'motorista', para: 'em_rota', evento: 'saiu' },
  entregue: { de: ['em_rota'], tipo: 'motorista', para: 'entregue', evento: 'entregue' },
  retirada: { de: ['agendada'], tipo: 'retirada', para: 'retirado', evento: 'retirada' },
  enviada: { de: ['agendada'], tipo: 'outro_estado', para: 'enviada', evento: 'enviada' },
  comprovante: { de: ['enviada'], tipo: 'outro_estado', para: 'entregue', evento: 'comprovante' },
  cancelar: { de: ['a_programar', 'agendada', 'ocorrencia', 'em_rota'], tipo: null, para: 'cancelada', evento: 'cancelada' }
};
for (const m of MOTIVOS_OCORRENCIA) {
  TRANSICOES['ocorrencia:' + m] = { de: ['em_rota'], tipo: 'motorista', para: 'ocorrencia', evento: m };
}

// próximo status e evento do histórico; null = transição inválida
function proximo(entrega, acao) {
  if (!entrega || typeof acao !== 'string' || !Object.hasOwn(TRANSICOES, acao)) return null;
  const t = TRANSICOES[acao];
  if (!t.de.includes(entrega.status)) return null;
  if (t.tipo && entrega.tipo !== t.tipo) return null;
  return { status: t.para, evento: t.evento };
}

// valor para ped_orc.SITUACAO quando a entrega chega a esse status
function pedidoPara(status) {
  if (status === 'entregue') return 'Entregue';
  if (status === 'retirado') return 'Retirado';
  return null;
}

// ---- Várias entregas por pedido (etapas 1 a 3) ----
const CONCLUIDAS = ['entregue', 'retirado'];
const concluida = s => CONCLUIDAS.includes(s);
const ativa = s => !concluida(s) && s !== 'cancelada';
const grupoPrincipal = e => (ativa(e.status) ? 0 : concluida(e.status) ? 1 : 2);

// Entrega "principal" do pedido: a que dá entregaStatus/dataAgendada nas listas (uma linha por pedido).
//  1) entre as ATIVAS (nem concluída nem cancelada): a de data agendada mais cedo (sem data por último), desempate pelo id menor;
//  2) sem ativa: a CONCLUÍDA (entregue/retirado) mais recente (maior id);
//  3) só canceladas: a cancelada mais recente.
// Com uma entrega só, é ela (o comportamento de antes). Mesma ordem do SQL de rotas/entregas_resumo.js.
function entregaPrincipal(entregas) {
  const lista = (entregas || []).filter(Boolean);
  if (!lista.length) return null;
  const data = e => (e.data_agendada ? String(e.data_agendada).slice(0, 10) : null);
  return [...lista].sort((a, b) => {
    const g = grupoPrincipal(a) - grupoPrincipal(b);
    if (g) return g;
    if (grupoPrincipal(a) !== 0) return b.id - a.id;
    const da = data(a), db = data(b);
    if (!da !== !db) return da ? -1 : 1;
    if (da && db && da !== db) return da < db ? -1 : 1;
    return a.id - b.id;
  })[0];
}

// Contagens do pedido para o selo "1 de 2 entregues": canceladas não contam.
function resumoEntregas(entregas) {
  const validas = (entregas || []).filter(e => e && e.status !== 'cancelada');
  return { qtdEntregas: validas.length, qtdEntregasConcluidas: validas.filter(e => concluida(e.status)).length };
}

// Regra da última baixa: o pedido só vira Entregue/Retirado quando TODAS as entregas não canceladas estão concluídas
// E não sobra item do pedido sem entrega. Entrega sem lista de itens (web_entrega_itens vazio) = "pedido inteiro".
// `entregas` = [{ id, status }] já com o status novo da entrega que está sendo baixada;
// `itensPorEntrega` = Map(id -> [{ numero_item, quantidade }]); `itensPedido` = [{ item, qtd }] (só lido quando todas têm lista).
// `itensEncerrados` = [{ numero_item, quantidade }] = sobra encerrada pela equipe (conta como coberta; etapa 4);
// `alterado` = os itens do pedido mudaram depois da divisão (hash_itens diferente): nunca fecha sozinho (motivo 'itens_alterados').
// Devolve { fechar, situacao: 'Entregue' | 'Retirado' | null, motivo }. Retirado só se todas as válidas foram retiradas.
function fechamentoDoPedido({ entregas = [], itensPorEntrega = new Map(), itensPedido = [], itensEncerrados = [], alterado = false } = {}) {
  const validas = entregas.filter(e => e && e.status !== 'cancelada');
  if (!validas.length) return { fechar: false, situacao: null, motivo: 'sem_entregas' };
  if (validas.some(e => !concluida(e.status))) return { fechar: false, situacao: null, motivo: 'entregas_abertas' };
  if (alterado) return { fechar: false, situacao: null, motivo: 'itens_alterados' };
  const situacao = validas.every(e => e.status === 'retirado') ? 'Retirado' : 'Entregue';
  const lista = e => itensPorEntrega.get(e.id) || [];
  if (validas.some(e => !lista(e).length)) return { fechar: true, situacao, motivo: null };
  const soma = new Map();
  const somar = i => soma.set(Number(i.numero_item), (soma.get(Number(i.numero_item)) || 0) + (Number(i.quantidade) || 0));
  for (const e of validas) lista(e).forEach(somar);
  (itensEncerrados || []).forEach(somar);
  const sobra = (itensPedido || []).some(i => (soma.get(Number(i.item)) || 0) + 1e-9 < (Number(i.qtd) || 0));
  return sobra ? { fechar: false, situacao: null, motivo: 'itens_sem_entrega' } : { fechar: true, situacao, motivo: null };
}

// ---- Divisão da entrega (etapas 4 e 5) ----
// Só estas entregas podem ser divididas: Em rota, Enviada, concluídas e canceladas não (409 na rota).
const STATUS_DIVISIVEIS = Object.freeze(['a_programar', 'agendada', 'ocorrencia']);
const TOLERANCIA = 1e-9;
const r4 = x => Math.round((Number(x) || 0) * 1e4) / 1e4; // DECIMAL(14,4)

// Impressão digital dos itens do pedido (ITEM, descrição e quantidade, em ordem de ITEM). Gravada em web_entregas.hash_itens
// na divisão; se a do pedido de agora for outra, o pedido foi editado depois da divisão (os números de ITEM podem ter mudado).
function hashItensPedido(itensPedido) {
  const base = (itensPedido || []).map(i => [Number(i.item) || 0, String(i.descricao ?? '').trim(), r4(i.qtd).toFixed(4)])
    .sort((a, b) => a[0] - b[0]);
  return require('crypto').createHash('sha256').update(JSON.stringify(base)).digest('hex');
}

// Linha de web_entrega_itens -> { item, descricao, qtd, unidade }
const doBanco = l => ({ item: Number(l.numero_item), descricao: String(l.descricao ?? ''), qtd: r4(l.quantidade), unidade: l.unidade ?? null, observacao: l.observacao ?? null });

// itens - (soma das listas em `subtrair`), sem negativos nem zeros
function descontar(itensPedido, subtrair) {
  const usado = new Map();
  for (const i of subtrair) usado.set(Number(i.numero_item), (usado.get(Number(i.numero_item)) || 0) + (Number(i.quantidade) || 0));
  return (itensPedido || []).map(i => ({ item: Number(i.item), descricao: String(i.descricao ?? ''), qtd: r4((Number(i.qtd) || 0) - (usado.get(Number(i.item)) || 0)), unidade: null }))
    .filter(i => i.qtd > TOLERANCIA);
}

// Situação da divisão de UM pedido (lida com ou sem trava). Entrada:
//   entregas = [{ id, status, hash_itens }]; itensPorEntrega = Map(id -> [{ numero_item, descricao, quantidade, unidade }]);
//   itensPedido = [{ item, descricao, qtd }] (ped_orc_lista_itens agora); encerradas = [{ numero_item, quantidade, hash_itens }].
// Devolve:
//   dividido  = alguma entrega tem lista de itens (ou já houve sobra encerrada);
//   alterado  = dividido e o hash de alguma entrega não cancelada (ou de sobra encerrada) difere do hash dos itens de agora;
//   porEntrega = Map(id -> itens efetivos): a lista da entrega; sem lista = o pedido menos as listas das OUTRAS entregas não
//                canceladas e menos o encerrado (num pedido nunca dividido, é o pedido inteiro, como antes);
//   sobra     = itens sem entrega (só em pedido dividido e quando toda entrega não cancelada tem lista): pedido - listas - encerrado.
function situacaoDivisao({ entregas = [], itensPorEntrega = new Map(), itensPedido = [], encerradas = [] } = {}) {
  const lista = e => itensPorEntrega.get(e.id) || [];
  const validas = entregas.filter(e => e && e.status !== 'cancelada');
  const dividido = entregas.some(e => lista(e).length) || encerradas.length > 0;
  const hashAtual = hashItensPedido(itensPedido);
  const hashes = [...validas.map(e => e.hash_itens), ...encerradas.map(x => x.hash_itens)].filter(Boolean);
  const alterado = dividido && hashes.some(h => h !== hashAtual);
  const porEntrega = new Map();
  for (const e of entregas) {
    if (lista(e).length) { porEntrega.set(e.id, lista(e).map(doBanco)); continue; }
    const outras = validas.filter(o => o.id !== e.id).flatMap(lista);
    porEntrega.set(e.id, descontar(itensPedido, [...outras, ...encerradas]));
  }
  const sobra = dividido && !validas.some(e => !lista(e).length) ? descontar(itensPedido, [...validas.flatMap(lista), ...encerradas]) : [];
  return { dividido, alterado, hashAtual, porEntrega, sobra };
}

// "Entrega n de N": N = entregas não canceladas do pedido; n = posição desta entre elas (por sequência, depois id).
// Entrega cancelada (ou fora da lista) devolve ordemEntrega 0. A tela só mostra o rótulo quando N > 1.
function ordemNoPedido(entregas, id) {
  const validas = (entregas || []).filter(e => e && e.status !== 'cancelada')
    .sort((a, b) => (Number(a.sequencia) || 0) - (Number(b.sequencia) || 0) || Number(a.id) - Number(b.id));
  return { ordemEntrega: validas.findIndex(e => Number(e.id) === Number(id)) + 1, qtdEntregasPedido: validas.length };
}

// Observação POR ITEM (web_entrega_itens.observacao, VARCHAR(255)): só texto; tira caracteres de controle, junta espaços e quebras de
// linha num espaço só e apara. Vazio = null (sem observação). Acima de 255 = 400 (nunca corta em silêncio).
const LIMITE_OBS_ITEM = 255;
function lerObservacaoItem(bruto, erro = msg => Object.assign(new Error(msg), { status: 400 })) {
  if (bruto === undefined || bruto === null) return null;
  if (typeof bruto !== 'string') throw erro('Observação do item inválida: use texto.');
  const t = bruto.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > LIMITE_OBS_ITEM) throw erro(`Observação do item muito longa (máximo ${LIMITE_OBS_ITEM} caracteres).`);
  return t || null;
}

// Corpo de "Separar em outra entrega": { itens: [{ numeroItem, quantidade, observacao? }], observacao? } (a observação de fora é da entrega nova).
// Quantidade: número > 0 com até 4 casas decimais (aceita texto "1.5"). Devolve { itens, observacao } ou lança Error com .status 400.
function lerSeparacao(b) {
  const erro = msg => Object.assign(new Error(msg), { status: 400 });
  const corpo = b && typeof b === 'object' ? b : {};
  const lista = corpo.itens;
  if (!Array.isArray(lista) || !lista.length || lista.length > 200) throw erro('Informe os itens a separar (de 1 a 200).');
  const vistos = new Set();
  const itens = lista.map(i => {
    const numeroItem = i?.numeroItem;
    if (!Number.isInteger(numeroItem) || numeroItem <= 0) throw erro('Item inválido.');
    if (vistos.has(numeroItem)) throw erro('Item repetido na lista.');
    vistos.add(numeroItem);
    const bruto = i?.quantidade;
    const q = typeof bruto === 'string' && /^\d+(\.\d{1,4})?$/.test(bruto.trim()) ? Number(bruto) : bruto;
    if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > 1e9) throw erro('Quantidade inválida: use um número maior que zero.');
    if (Math.abs(r4(q) - q) > TOLERANCIA) throw erro('Quantidade com casas decimais demais (máximo 4).');
    const observacao = lerObservacaoItem(i?.observacao, erro);
    return { numeroItem, quantidade: r4(q), ...(observacao ? { observacao } : {}) };
  });
  const obs = corpo.observacao === undefined || corpo.observacao === null ? '' : String(corpo.observacao).trim();
  if (obs.length > 500) throw erro('Observação muito longa (máximo 500 caracteres).');
  return { itens, observacao: obs || null };
}

// Divide os itens disponíveis da entrega de origem: `disponiveis` = [{ item, descricao, qtd, unidade }] (itens efetivos dela),
// `pedidos` = [{ numeroItem, quantidade }] (já lidos por lerSeparacao). Devolve { nova, resto } (listas de { item, descricao, qtd, unidade })
// ou { erro: { status, msg } }: item que a entrega não tem e quantidade acima da disponível = 409 (o estado mudou ou a tela está velha);
// marcar tudo = 400 (não é divisão: a origem não pode ficar sem nenhum item).
function separarItens(disponiveis, pedidos) {
  const porItem = new Map((disponiveis || []).map(d => [Number(d.item), d]));
  const nova = [];
  const tirar = new Map();
  for (const p of pedidos || []) {
    const d = porItem.get(Number(p.numeroItem));
    if (!d) return { erro: { status: 409, msg: `O item ${p.numeroItem} não está nesta entrega. Atualize a tela e tente de novo.` } };
    if (p.quantidade > d.qtd + TOLERANCIA) {
      return { erro: { status: 409, msg: `Quantidade de "${d.descricao}" maior que a disponível nesta entrega (${String(d.qtd).replace('.', ',')}).` } };
    }
    // a observação digitada vale só para a entrega NOVA; a origem mantém a que já tinha (ver `...d` em resto)
    nova.push({ item: d.item, descricao: d.descricao, qtd: r4(p.quantidade), unidade: d.unidade ?? null, observacao: p.observacao ?? null });
    tirar.set(d.item, p.quantidade);
  }
  if (!nova.length) return { erro: { status: 400, msg: 'Marque ao menos um item para separar.' } };
  const resto = (disponiveis || []).map(d => ({ ...d, qtd: r4(d.qtd - (tirar.get(Number(d.item)) || 0)) })).filter(d => d.qtd > TOLERANCIA);
  if (!resto.length) return { erro: { status: 400, msg: 'Você marcou todos os itens: isso não é divisão. Deixe ao menos um item na entrega atual.' } };
  return { nova, resto };
}

// Rótulo mostrado para entrega com status 'cancelada' (o valor gravado não muda). Só "Cancelada" quando houve cancelamento de verdade:
//  - cancelada  = o pedido está Cancelado, ou a equipe cancelou a entrega à mão (canceladaPor <> 'sistema');
//  - encerrada  = o pedido foi para Entregue/Retirado fora do sistema (a varredura só viu que saiu de Pronto);
//  - suspensa   = o pedido saiu de Pronto para outra situação (a varredura reabre se ele voltar a Pronto).
// Sem situação conhecida do pedido (excluído) mantém "cancelada". Qualquer outro status volta como veio.
function statusExibicao({ status, situacaoPedido, canceladaPor } = {}) {
  if (status !== 'cancelada') return status;
  if (canceladaPor && canceladaPor !== 'sistema') return 'cancelada';
  const s = String(situacaoPedido ?? '').trim().toLowerCase();
  if (!s || s === 'cancelado') return 'cancelada';
  if (s === 'entregue' || s === 'retirado') return 'encerrada';
  return 'suspensa';
}

// ---- Pedido concluído fora das Entregas (2026-11-11) ----
// Pedido marcado Entregue/Retirado por qualquer caminho que não a baixa (VB, menu "Mudar situação"): as entregas que ainda
// esperavam (A programar, Agendada, Ocorrência) não têm mais o que entregar e são ENCERRADAS como concluídas do mesmo tipo do
// pedido (Retirado -> 'retirado', Entregue -> 'entregue'), com evento 'encerrada' (nunca "cancelada": o pedido foi entregue).
// Em rota e Enviada NÃO são mexidas (a carga está com o motorista/transportadora): continuam visíveis como estão.
const STATUS_ENCERRAVEIS = Object.freeze(['a_programar', 'agendada', 'ocorrencia']);
const STATUS_EM_CURSO = Object.freeze(['em_rota', 'enviada']);
const EVENTO_ENCERRADA = 'encerrada';
const EVENTO_REABERTA = 'reaberta';

// 'Entregue' -> 'entregue', 'Retirado' -> 'retirado'; qualquer outra situação -> null
function statusConcluidoPara(situacaoPedido) {
  const s = String(situacaoPedido ?? '').trim();
  return s === 'Entregue' ? 'entregue' : s === 'Retirado' ? 'retirado' : null;
}

// Status da entrega principal mostrado nas listas da equipe (Pedidos, Início, Financeiro do cliente). Só corrige a janela entre a
// mudança do pedido (ex.: pelo VB) e a próxima varredura: pedido Entregue/Retirado com entrega ainda A programar/Agendada/Ocorrência
// aparece já como concluída. Em rota, Enviada, concluídas e canceladas voltam como vieram.
function statusNaLista(situacaoPedido, status) {
  const concluido = statusConcluidoPara(situacaoPedido);
  return concluido && STATUS_ENCERRAVEIS.includes(status) ? concluido : (status ?? null);
}

// Para onde volta uma entrega encerrada com o pedido quando o pedido deixa de estar Entregue/Retirado: o status que ela tinha
// (gravado no detalhe do evento 'encerrada') se ainda for um status de espera; senão (ex.: era 'cancelada' pela varredura) A programar.
function statusDeReabertura(detalhe) {
  let d = detalhe;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
  const anterior = d && typeof d === 'object' ? d.statusAnterior : null;
  return STATUS_ENCERRAVEIS.includes(anterior) ? anterior : 'a_programar';
}

// Motivo do evento 'encerrada'
const motivoEncerrada = (situacaoPedido, origem = 'fora das Entregas') => `Pedido marcado como ${situacaoPedido} ${origem}`;

const LIMITE_ANEXO = 1048576; // 1 MiB

// confere tamanho, assinatura (JPEG/PNG) e se o mime declarado bate com ela
function validarAnexo(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, motivo: 'Arquivo vazio ou inválido.' };
  if (buffer.length > LIMITE_ANEXO) return { ok: false, motivo: 'Arquivo muito grande (máximo 1 MB).' };
  let tipo = null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) tipo = 'jpeg';
  else if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) tipo = 'png';
  if (!tipo) return { ok: false, motivo: 'Formato não aceito: envie uma imagem JPEG ou PNG.' };
  if (mime !== 'image/' + tipo) return { ok: false, motivo: 'O tipo informado não confere com o conteúdo do arquivo.' };
  return { ok: true, tipo };
}

module.exports = { STATUS, TIPOS, proximo, pedidoPara, statusExibicao, validarAnexo, entregaPrincipal, resumoEntregas, fechamentoDoPedido,
  STATUS_DIVISIVEIS, hashItensPedido, situacaoDivisao, ordemNoPedido, lerSeparacao, separarItens,
  STATUS_ENCERRAVEIS, STATUS_EM_CURSO, EVENTO_ENCERRADA, EVENTO_REABERTA, statusConcluidoPara, statusNaLista, statusDeReabertura, motivoEncerrada };
