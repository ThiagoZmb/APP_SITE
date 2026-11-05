// Etapas de produção: funções puras (calculo/etapas_producao.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../calculo/etapas_producao');

const linha = (etapa, estado, extra = {}) => ({ etapa, estado, origem: 'manual', usuario: 'Ana', quando: '2026-11-05 10:00:00', observacao: null, ...extra });
const todas = (estado = 'ok') => E.ETAPAS.map(e => linha(e.codigo, estado));
const aplic = (perfil = true, vidro = true) => ({ perfil, vidro });

test('ETAPAS: seis etapas fixas, na ordem do dono, cada uma com a sua permissão', () => {
  assert.deepEqual(E.ETAPAS.map(e => e.codigo), ['perfil_cortado', 'vidro_cortado', 'perfil_pintado', 'vidro_pintado', 'portas_montadas', 'finalizado']);
  assert.deepEqual(E.ETAPAS.map(e => e.nome), ['Perfil cortado', 'Vidro cortado', 'Perfil pintado', 'Vidro pintado', 'Portas montadas', 'Pedido finalizado']);
  assert.deepEqual(E.ETAPAS.map(e => e.permissao), ['etapas.corte_perfil', 'etapas.corte_vidro', 'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem', 'etapas.finalizar']);
  assert.deepEqual(E.ETAPAS.map(e => e.grupo), ['perfil', 'vidro', 'perfil', 'vidro', 'montagem', null]);
  assert.deepEqual(E.ESTADOS, ['pendente', 'ok', 'na']);
  assert.equal(E.etapaPorCodigo('xx'), null);
  assert.equal(E.etapaPorCodigo('vidro_pintado').nome, 'Vidro pintado');
});

test('aplicabilidade: grupo sem peças NEM pendências nasce N/A; pendência de medida mantém a etapa aplicável', () => {
  assert.deepEqual(E.aplicabilidade({ perfil: { qtdPecas: 0, qtdPendencias: 0 }, vidro: { qtdPecas: 3, qtdPendencias: 0 } }), { perfil: false, vidro: true, montagem: true });
  assert.deepEqual(E.aplicabilidade({ perfil: { qtdPecas: 0, qtdPendencias: 2 }, vidro: { qtdPecas: 0, qtdPendencias: 0 } }), { perfil: true, vidro: false, montagem: true });
  assert.deepEqual(E.aplicabilidade({}), { perfil: false, vidro: false, montagem: true });
});

test('classificarItens: porta, serralheria (Metalons OU linha em ped_orc_serralheria), avulso e desconhecido, sem diferenciar caixa/acento', () => {
  const lista = [{ ITEM: 1, TIPO_PRODUTO: 'Porta de giro' }, { ITEM: 2, TIPO_PRODUTO: 'Metalons' }, { ITEM: 3, TIPO_PRODUTO: 'Estrutura' }, { ITEM: 4, TIPO_PRODUTO: 'Serviço' },
    { ITEM: 5, TIPO_PRODUTO: 'PORTA DE CORRER' }, { ITEM: 6, TIPO_PRODUTO: 'Algo do VB' }, { ITEM: 7, TIPO_PRODUTO: 'Acessorio' }];
  assert.deepEqual(E.classificarItens(lista, [3]), { qtdItens: 7, qtdPortas: 2, qtdSerralheria: 2, qtdAvulsos: 2, qtdDesconhecidos: 1 });
  assert.deepEqual(E.classificarItens([], []), { qtdItens: 0, qtdPortas: 0, qtdSerralheria: 0, qtdAvulsos: 0, qtdDesconhecidos: 0 });
});

test('aplicabilidade por tipo de pedido: só serralheria, só porta, misto e sem itens', () => {
  const sem = { qtdPecas: 0, qtdPendencias: 0 }, com = { qtdPecas: 4, qtdPendencias: 0 };
  const itens = lista => E.classificarItens(lista.map((t, i) => ({ ITEM: i + 1, TIPO_PRODUTO: t })), []);
  const etapas = a => E.montarEtapas([], a).map(e => e.estado);
  // só serralheria (o plano de corte não gera peça): perfil cortado/pintado e finalizado pendentes; vidro e portas montadas N/A
  const serr = E.aplicabilidade({ perfil: sem, vidro: sem, itens: itens(['Metalons', 'Metalons']) });
  assert.deepEqual(serr, { perfil: true, vidro: false, montagem: false });
  assert.deepEqual(etapas(serr), ['pendente', 'na', 'pendente', 'na', 'na', 'pendente']);
  // serralheria + avulso: igual (avulso não é porta)
  assert.deepEqual(E.aplicabilidade({ perfil: sem, vidro: sem, itens: itens(['Metalons', 'Serviço']) }), { perfil: true, vidro: false, montagem: false });
  // serralheria com linha solta em vidros (de outro documento): vidro continua N/A
  assert.equal(E.aplicabilidade({ perfil: sem, vidro: { qtdPecas: 0, qtdPendencias: 1 }, itens: itens(['Metalons']) }).vidro, false);
  // só porta: como antes (pelas peças), portas montadas aplicável
  assert.deepEqual(E.aplicabilidade({ perfil: com, vidro: com, itens: itens(['Porta de giro']) }), { perfil: true, vidro: true, montagem: true });
  assert.deepEqual(E.aplicabilidade({ perfil: com, vidro: sem, itens: itens(['Porta de giro']) }), { perfil: true, vidro: false, montagem: true });
  // misto: tudo o que QUALQUER item exige
  assert.deepEqual(E.aplicabilidade({ perfil: sem, vidro: com, itens: itens(['Porta de giro', 'Metalons']) }), { perfil: true, vidro: true, montagem: true });
  // item de tipo desconhecido junto da serralheria: tratado como porta possível (montagem e vidro pelas peças)
  assert.deepEqual(E.aplicabilidade({ perfil: sem, vidro: com, itens: itens(['Metalons', 'Algo do VB']) }), { perfil: true, vidro: true, montagem: true });
  // sem itens: como antes (perfil e vidro pelas peças) e portas montadas pendente
  assert.deepEqual(E.aplicabilidade({ perfil: sem, vidro: sem, itens: itens([]) }), { perfil: false, vidro: false, montagem: true });
});

test('corteAutomaticoAplica: vidro sempre; perfil só em pedido sem serralheria (o plano de corte não calcula serralheria)', () => {
  assert.equal(E.corteAutomaticoAplica('vidro', { qtdSerralheria: 3 }), true);
  assert.equal(E.corteAutomaticoAplica('perfil', { qtdSerralheria: 0 }), true);
  assert.equal(E.corteAutomaticoAplica('perfil', { qtdSerralheria: 1 }), false);
  assert.equal(E.corteAutomaticoAplica('perfil', null), true);
});

test('estadoEfetivo: linha gravada vale sempre; sem linha = pendente se aplicável, N/A automático se não', () => {
  assert.deepEqual(E.estadoEfetivo(undefined, true), { estado: 'pendente', origem: null, usuario: '', quando: null, observacao: null, automatico: false });
  assert.deepEqual(E.estadoEfetivo(undefined, false), { estado: 'na', origem: 'auto', usuario: '', quando: null, observacao: null, automatico: true });
  const l = linha('perfil_cortado', 'ok', { origem: 'corte', usuario: 'Caio' });
  assert.deepEqual(E.estadoEfetivo(l, false), { estado: 'ok', origem: 'corte', usuario: 'Caio', quando: '2026-11-05 10:00:00', observacao: null, automatico: true });
  // N/A manual gravado continua N/A mesmo se o grupo passou a ser aplicável
  assert.equal(E.estadoEfetivo(linha('vidro_cortado', 'na'), true).estado, 'na');
});

test('montarEtapas + progresso: N/A conta como concluída; ordem fixa', () => {
  const et = E.montarEtapas([linha('perfil_cortado', 'ok'), linha('portas_montadas', 'pendente')], aplic(true, false));
  assert.deepEqual(et.map(e => [e.codigo, e.estado]), [['perfil_cortado', 'ok'], ['vidro_cortado', 'na'], ['perfil_pintado', 'pendente'], ['vidro_pintado', 'na'], ['portas_montadas', 'pendente'], ['finalizado', 'pendente']]);
  assert.deepEqual(E.progresso(et), { qtdConcluidas: 3, qtdEtapas: 6 });
  assert.deepEqual(E.pendentesAntesDeFinalizar(et), ['perfil_pintado', 'portas_montadas']);
});

test('podeAlterar: permissão da etapa ou etapas.gerir; finalizado exige etapas.finalizar', () => {
  assert.equal(E.podeAlterar(new Set(['etapas.corte_perfil']), 'perfil_cortado'), true);
  assert.equal(E.podeAlterar(new Set(['etapas.corte_perfil']), 'vidro_cortado'), false);
  assert.equal(E.podeAlterar(new Set(['etapas.gerir']), 'finalizado'), true);
  assert.equal(E.podeAlterar(new Set(['pedidos.situacao']), 'finalizado'), false);
  assert.equal(E.podeAlterar(new Set(['etapas.finalizar']), 'finalizado'), true);
  assert.deepEqual(E.etapasQuePode(new Set(['etapas.montagem', 'etapas.pintura_vidro'])), ['vidro_pintado', 'portas_montadas']);
  assert.equal(E.etapasQuePode(new Set(['etapas.gerir'])).length, 6);
});

test('validarMudanca: etapa e estado inválidos; sem permissão; idempotente', () => {
  const et = E.montarEtapas([], aplic());
  const base = { etapas: et, permissoes: new Set(['etapas.corte_perfil']) };
  assert.deepEqual(E.validarMudanca({ ...base, etapa: 'pintura', estado: 'ok' }), { ok: false, status: 400, erro: 'Etapa inválida.' });
  assert.deepEqual(E.validarMudanca({ ...base, etapa: 'perfil_cortado', estado: 'feito' }), { ok: false, status: 400, erro: 'Estado inválido. Use ok, pendente ou na.' });
  assert.equal(E.validarMudanca({ ...base, etapa: 'vidro_cortado', estado: 'ok' }).status, 403);
  assert.deepEqual(E.validarMudanca({ ...base, etapa: 'perfil_cortado', estado: 'pendente' }), { ok: true, mudou: false });
  assert.deepEqual(E.validarMudanca({ ...base, etapa: 'perfil_cortado', estado: 'ok' }), { ok: true, mudou: true });
  assert.deepEqual(E.validarMudanca({ ...base, etapa: 'perfil_cortado', estado: 'na' }), { ok: true, mudou: true });
});

test('validarMudanca: finalizar exige as anteriores OK ou N/A; forçar só com etapas.gerir', () => {
  const faltando = E.montarEtapas([linha('perfil_cortado', 'ok')], aplic(true, false));
  const r = E.validarMudanca({ etapas: faltando, etapa: 'finalizado', estado: 'ok', permissoes: new Set(['etapas.finalizar']) });
  assert.equal(r.ok, false); assert.equal(r.status, 409);
  assert.deepEqual(r.pendentes, ['perfil_pintado', 'portas_montadas']);
  assert.match(r.erro, /Perfil pintado, Portas montadas/);
  assert.equal(E.validarMudanca({ etapas: faltando, etapa: 'finalizado', estado: 'ok', permissoes: new Set(['etapas.finalizar']), forcar: true }).status, 403);
  assert.deepEqual(E.validarMudanca({ etapas: faltando, etapa: 'finalizado', estado: 'ok', permissoes: new Set(['etapas.gerir']), forcar: true }), { ok: true, mudou: true, forcado: true });
  const prontas = E.montarEtapas(todas('ok').filter(l => l.etapa !== 'finalizado'), aplic());
  assert.deepEqual(E.validarMudanca({ etapas: prontas, etapa: 'finalizado', estado: 'ok', permissoes: new Set(['etapas.finalizar']) }), { ok: true, mudou: true });
  // N/A não trava o finalizado
  const comNa = E.montarEtapas([linha('perfil_cortado', 'ok'), linha('perfil_pintado', 'ok'), linha('portas_montadas', 'na')], aplic(true, false));
  assert.equal(E.validarMudanca({ etapas: comNa, etapa: 'finalizado', estado: 'ok', permissoes: new Set(['etapas.finalizar']) }).ok, true);
});

test('validarMudanca: finalizado não aceita N/A; com finalizado OK as anteriores não voltam a pendente', () => {
  const et = E.montarEtapas(todas('ok'), aplic());
  assert.deepEqual(E.validarMudanca({ etapas: et, etapa: 'finalizado', estado: 'na', permissoes: new Set(['etapas.gerir']) }), { ok: false, status: 400, erro: 'A etapa "Pedido finalizado" não aceita N/A.' });
  const r = E.validarMudanca({ etapas: et, etapa: 'portas_montadas', estado: 'pendente', permissoes: new Set(['etapas.gerir']) });
  assert.equal(r.status, 409); assert.match(r.erro, /Desfaça primeiro/);
  // N/A numa anterior com finalizado OK é permitido (continua concluída)
  assert.equal(E.validarMudanca({ etapas: et, etapa: 'portas_montadas', estado: 'na', permissoes: new Set(['etapas.montagem']) }).ok, true);
});

test('corteCompleto: plano conferido, igual ao pedido de agora, sem pendências e com todas as peças marcadas', () => {
  const ok = { qtdPecas: 4, qtdPendencias: 0, plano: { situacao: 'conferido', impressaoConfere: true, qtdPecasPlano: 4, qtdCortadas: 4 } };
  assert.equal(E.corteCompleto(ok), true);
  assert.equal(E.corteCompleto({ ...ok, qtdPendencias: 1 }), false, 'pendência de medida/ligação nunca marca');
  assert.equal(E.corteCompleto({ ...ok, qtdPecas: 0 }), false);
  assert.equal(E.corteCompleto({ ...ok, plano: null }), false);
  assert.equal(E.corteCompleto({ ...ok, plano: { ...ok.plano, situacao: 'gerado' } }), false);
  assert.equal(E.corteCompleto({ ...ok, plano: { ...ok.plano, impressaoConfere: false } }), false, 'pedido mudou depois do plano');
  assert.equal(E.corteCompleto({ ...ok, plano: { ...ok.plano, qtdCortadas: 3 } }), false, 'peça sem marcar');
});

test('decidirAutomatico: marca sobre ausente/pendente; desmarca só OK de origem corte; nunca mexe em OK manual nem em N/A', () => {
  assert.equal(E.decidirAutomatico(undefined, true), 'ok');
  assert.equal(E.decidirAutomatico(linha('x', 'pendente'), true), 'ok');
  assert.equal(E.decidirAutomatico(linha('x', 'ok', { origem: 'corte' }), true), null);
  assert.equal(E.decidirAutomatico(linha('x', 'ok'), true), null);
  assert.equal(E.decidirAutomatico(linha('x', 'na'), true), null);
  assert.equal(E.decidirAutomatico(linha('x', 'ok', { origem: 'corte' }), false), 'pendente');
  assert.equal(E.decidirAutomatico(linha('x', 'ok'), false), null, 'OK manual nunca é desmarcado');
  assert.equal(E.decidirAutomatico(undefined, false), null);
});

test('contarPecasPlano / contarCortadas: perfis (barras) e vidros (chapas); marcas repetidas ou fora do plano não contam', () => {
  const perfil = { grupos: [{ chave: 'A', barras: [{ pecas: [1, 2] }, { pecas: [3] }] }] };
  assert.equal(E.contarPecasPlano(perfil, 'barras'), 3);
  assert.equal(E.contarCortadas(perfil, 'barras', [{ grupo: 'A', barra: 0, peca: 0 }, { grupo: 'A', barra: 0, peca: 0 }, { grupo: 'A', barra: 1, peca: 0 }, { grupo: 'B', barra: 0, peca: 0 }, { grupo: 'A', barra: 1, peca: 5 }]), 2);
  const vidro = { grupos: [{ chave: 'V', chapas: [{ pecas: [1, 2] }] }] };
  assert.equal(E.contarPecasPlano(vidro, 'chapas'), 2);
  assert.equal(E.contarCortadas(vidro, 'chapas', [{ grupo: 'V', chapa: 0, peca: 1 }, { grupo: 'V', chapa: 0, peca: 0 }]), 2);
  assert.equal(E.contarPecasPlano(null, 'barras'), 0);
  assert.equal(E.contarCortadas(perfil, 'barras', 'lixo'), 0);
});

test('filtrarFila / ordenarFila: só em produção (padrão) ou todos em aberto; atrasados primeiro, sem data por último', () => {
  const ps = [
    { numero: 1, situacao: 'Em Produção', prontoEm: '2026-11-20' }, { numero: 2, situacao: 'Pronto', prontoEm: '2026-11-01' },
    { numero: 3, situacao: 'Entregue', prontoEm: '2026-10-01' }, { numero: 4, situacao: 'Cancelado', prontoEm: '2026-10-01' },
    { numero: 5, situacao: 'Em Produção', prontoEm: '' }, { numero: 6, situacao: 'EM PRODUCAO', prontoEm: '2026-10-30' }, { numero: 7, situacao: 'Aguardando', prontoEm: '2026-11-02' }
  ];
  assert.deepEqual(E.ordenarFila(E.filtrarFila(ps, 'producao')).map(p => p.numero), [6, 1, 5]);
  assert.deepEqual(E.ordenarFila(E.filtrarFila(ps, 'abertos')).map(p => p.numero), [6, 2, 7, 1, 5]);
  assert.equal(E.validarFiltro(undefined), 'producao');
  assert.equal(E.validarFiltro('abertos'), 'abertos');
  assert.equal(E.validarFiltro('todos'), null);
});

test('validarCorpo: estado, forçar, observação (até 500), dataPronto manter|hoje e voltarParaProducao', () => {
  assert.deepEqual(E.validarCorpo({ estado: 'ok' }), { ok: true, dados: { estado: 'ok', forcar: false, observacao: null, dataPronto: 'manter', voltarParaProducao: false } });
  assert.deepEqual(E.validarCorpo({ estado: 'ok', forcar: true, observacao: '  pintura ok  ', dataPronto: 'hoje' }).dados, { estado: 'ok', forcar: true, observacao: 'pintura ok', dataPronto: 'hoje', voltarParaProducao: false });
  assert.equal(E.validarCorpo({ estado: 'ok', dataPronto: 'ontem' }).ok, false);
  assert.equal(E.validarCorpo({ estado: 'ok', observacao: 'x'.repeat(501) }).ok, false);
  assert.equal(E.validarCorpo({ estado: 'ok', observacao: 12 }).ok, false);
  assert.equal(E.validarCorpo({ estado: 'ok', forcar: 'sim' }).dados.forcar, false, 'forçar só com true literal');
  assert.equal(E.validarCorpo({ estado: 'pendente', voltarParaProducao: true }).dados.voltarParaProducao, true);
  assert.equal(E.validarCorpo(null).ok, false);
});

test('nenhum campo da fila ou da etapa casa com nome de dinheiro (REGEX_VALOR)', () => {
  const { REGEX_VALOR } = require('../seguranca/valores');
  const campos = ['numero', 'cliente', 'clienteFinal', 'situacao', 'classe', 'prontoEm', 'atrasado', 'qtdConcluidas', 'qtdEtapas', 'etapas', 'codigo', 'nome', 'estado', 'origem', 'usuario', 'quando', 'observacao', 'automatico',
    'versao', 'filtro', 'hoje', 'limitado', 'podeMarcar', 'pedidos', 'qtdPedidos', 'mudou', 'forcado', 'pendentes', 'situacaoMudou', 'eventos', 'estadoAntes', 'estadoDepois', 'detalhe'];
  for (const c of campos) assert.doesNotMatch(c, REGEX_VALOR, c);
});
