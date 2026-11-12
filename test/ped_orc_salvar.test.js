const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const { hojeLocal } = require('../rotas/estoque_movimentos');

// Perfil P 100/m (VALOR_FIXO) (desc. vidro 20) · Vidro V 200/m² · Fechadura 30 · cliente sem desconto
// folha 2000×500: perfil 5 m = 500 + vidro 1,98×0,48 = 0,9504 m² × 200 = 190,08 → 690,08
// 2 folhas = 1380,16 + Fechadura 30 = 1410,16 → unitário 705,08
const giro = (mudar = {}) => ({ frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, profundidade: 0, soldas: 0, obs: '',
  furos: { lista: [100, 900], lados: ['Esquerdo', 'Esquerdo'] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: 'Vidro V', corRevest: 'Incolor',
    divisor: '', divH: 0, divV: 0, posicoesFolhas: ['', ''] },
  acessorios: [{ nome: 'Fechadura', qtd: 1, origem: 'MANUAL' }], historico: '', valorTela: 705.08, ...mudar });
const corpo = (mudar = {}) => ({ modo: 'novo', tipo: 'Orçamento', clienteCodigo: 7, clienteFinal: 'Fulano', obsGeral: 'Entregar à tarde',
  descontoPct: 0, totalTela: 1410.16, itens: [giro()], ...mudar });
const pedido = (mudar = {}) => corpo({ tipo: 'Pedido', dataEntrega: '2026-11-05', situacao: 'Em Produção', financeiro: 'A Receber', ...mudar });
const salvar = (chamar, c) => chamar('/ped_orc/salvar', 'POST', c);

test('orçamento novo: cabeçalho, lista, itens_v4, furos e complementos; sem vidros/perfis', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ TIPO: 'Orçamento', NUMERO: 10 }, { TIPO: 'Pedido', NUMERO: 50 });
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await salvar(chamar, corpo({ itens: [giro({ historico: '+10', valorTela: 775.59 })] }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, tipo: 'Orçamento', numero: 11 });
  const cab = banco.pedOrc.find(p => p.NUMERO === 11);
  assert.equal(cab.RAZAO_SOCIAL, 'CLIENTE TESTE');
  assert.equal(cab.CLIENTE_FINAL, 'Fulano');
  assert.equal(cab.SITUACAO, 'Aguardando resposta');
  assert.equal(cab.REPRESENTANTE, 'JOÃO REP');
  assert.equal(cab.DATA_ENTREGA, null);
  assert.equal(cab.DATA_PRONTO, hojeLocal());
  assert.match(cab.DATA, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.deepEqual([cab.SUB_TOTAL, cab.DESCONTO, cab.TOTAL], [1551.18, 0, 1551.18]);
  assert.equal(banco.listaItens.length, 1);
  const l = banco.listaItens[0];
  assert.deepEqual([l.TIPO, l.NUMERO, l.ITEM, l.TIPO_PRODUTO, l.PRODUTO, l.QTD, l.UNITARIO, l.TOTAL, l.PORCENTAGEM],
    ['Orçamento', 11, 1, 'Porta de giro', 'Porta de giro', 2, 775.59, 1551.18, '+10']);
  assert.equal(banco.itensV4.length, 1);
  const v = banco.itensV4[0];
  assert.deepEqual([v.ITEM_PEDIDO, v.ITEM, v.PORTA, v.QTD, v.ALTURA, v.LARGURA, v.PERFIL, v.REVESTIMENTO, v.UNITARIO, v.TOTAL],
    [1, 1, 'Folha 1', 2, 2000, 500, 'Perfil P', 'Vidro V', 775.59, 1551.18]);
  assert.deepEqual(banco.furacao.map(f => [f.NUMERO, f.TIPO, f.ITEM, f.FURO, f.LADO, f.TAMANHO]),
    [[11, 'Orçamento', 1, 1, 'Esquerdo', 100], [11, 'Orçamento', 1, 2, 'Esquerdo', 900]]);
  assert.deepEqual(banco.complementos.map(c => [c.ITEM_PEDIDO, c.ITEM, c.QTD, c.COMPLEMENTO, c.TAMANHO, c.UNITARIO]), [[1, 1, 1, 'Fechadura', 0, 30]]);
  assert.equal(banco.vidros.length, 0);
  assert.equal(banco.perfis.length, 0);
});

test('pedido grava vidros e perfis', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, pedido());
  assert.deepEqual(await r.json(), { ok: true, tipo: 'Pedido', numero: 1 });
  const cab = banco.pedOrc[0];
  assert.deepEqual([cab.SITUACAO, cab.FINANCEIRO, cab.DATA_PRONTO], ['Em Produção', 'A Receber', '2026-11-05']);
  assert.deepEqual(banco.vidros.map(x => [x.MEDICAO, x.ITEM, x.NUMERO, x.QTD, x.MODELO, x.COR_REVESTIMENTO, x.TAMANHO, x.M2]),
    [['Vão', 1, 1, 2, 'Vidro V', 'Incolor', '1960x460', 0.9]]);
  assert.deepEqual(banco.perfis.map(x => [x.ITEM, x.DATA, x.NUMERO, x.QTD_PORTAS, x.PERFIL, x.QTD_ALTURA, x.TAM_ALTURA, x.QTD_LARGURA, x.TAM_LARGURA, x.QTD_PUXADOR]),
    [[1, hojeLocal(), 1, 2, 'Perfil P', 2, 2000, 2, 500, 0]]);
});

test('permissões: Vendedor não salva pedido; sem valores ou sem salvar não grava', async t => {
  for (const [perfil, c] of [['Vendedor', pedido()], ['Monta sem valores', corpo()], ['Monta sem salvar', corpo()]]) {
    const { banco, chamar } = await prepararPedOrc(t, { perfil });
    assert.equal((await salvar(chamar, c)).status, 403, perfil);
    assert.equal(banco.pedOrc.length, 0);
  }
});

test('validações com as mensagens do VB', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const casos = [
    [corpo({ itens: [] }), 'Favor inserir pelomenos 1 item no pedido!'],
    [corpo({ clienteCodigo: '' }), 'Favor selecionar um cliente!'],
    [corpo({ tipo: 'Outro' }), "Favor escolher entre 'Pedido' ou 'Orçamento' !"],
    [pedido({ dataEntrega: '' }), 'Favor inserir a data de entrega!'],
    [pedido({ situacao: 'Qualquer' }), 'Favor escolher uma situação do pedido!'],
    [pedido({ financeiro: '' }), 'Favor escolher a situação financeira do pedido!']
  ];
  for (const [c, msg] of casos) {
    const r = await salvar(chamar, c);
    assert.equal(r.status, 400, msg);
    assert.equal((await r.json()).error, msg);
  }
  assert.equal(banco.pedOrc.length, 0);
});

// decisão do dono (2026-11-11): grava o da tela, mas AVISA na resposta e registra na auditoria (nunca bloqueia nem troca o valor)
test('preço diferente do que o servidor calcularia: grava o da tela e avisa (precoDivergente + auditoria)', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro(), giro({ valorTela: 705.10 })] }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  const calculado = banco.listaItens[0].UNITARIO; // item 1 veio com o preço certo: sem aviso
  assert.deepEqual(j.avisos, { precoDivergente: [{ item: 2, valorTela: 705.10, valorCalculado: calculado, diferenca: Math.round((705.10 - calculado) * 100) / 100 }] });
  assert.equal(banco.listaItens[1].UNITARIO, 705.10);
  assert.equal(banco.pedOrc.length, 1);
  const aud = banco.auditoria.filter(a => a.acao === 'preco_divergente');
  assert.equal(aud.length, 1);
  assert.equal(JSON.parse(aud[0].detalhe).itens[0].item, 2);
});

test('diferença de até 1 centavo não avisa; a % da lista entra na comparação', async t => {
  const { chamar, banco } = await prepararPedOrc(t);
  const r0 = await (await salvar(chamar, corpo({ itens: [giro()] }))).json();
  assert.equal(r0.avisos, undefined);
  const base = banco.listaItens[0].UNITARIO;
  const { chamar: c2 } = await prepararPedOrc(t);
  const r1 = await (await salvar(c2, corpo({ itens: [giro({ valorTela: Math.round((base + 0.01) * 100) / 100 })] }))).json();
  assert.equal(r1.avisos, undefined); // 1 centavo: tolerado
  const { chamar: c3 } = await prepararPedOrc(t);
  const r2 = await (await salvar(c3, corpo({ itens: [giro({ historico: '+10', valorTela: Math.round(base * 1.1 * 100) / 100 })] }))).json();
  assert.equal(r2.avisos, undefined); // valor com +10% da lista = calculado × 1,1: não diverge
  const { chamar: c4 } = await prepararPedOrc(t);
  const r3 = await (await salvar(c4, corpo({ itens: [giro({ historico: '+10', valorTela: base })] }))).json();
  assert.equal(r3.avisos.precoDivergente[0].item, 1); // sem a % aplicada: diverge
});

test('posição de puxador não reconhecida: salva mesmo assim (sem bloquear)', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const item = giro({ qtd: 1, acessorios: [], furos: { lista: [], lados: [] }, valorTela: 710.08,
    detalhes: { ...giro().detalhes, puxador: 'Puxador X', tipoPuxador: 'Sobreposto', posicoesFolhas: ['XYZ'] } });
  const r = await salvar(chamar, corpo({ itens: [item] }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(banco.pedOrc.length, 1);
});

test('número tomado pelo VB no mesmo instante: usa o seguinte; 3 vezes seguidas → 409', async t => {
  const banco = bancoPedOrc();
  banco.dupNoCabecalho.vezes = 1;
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.deepEqual(await (await salvar(chamar, corpo())).json(), { ok: true, tipo: 'Orçamento', numero: 2 });
  banco.dupNoCabecalho.vezes = 3;
  const r = await salvar(chamar, corpo());
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'Não foi possível reservar um número. Tente de novo.');
});

test('falha no meio: nada fica gravado', async t => {
  const banco = bancoPedOrc();
  banco.falhas.ped_orc_complementos = 1;
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await salvar(chamar, corpo())).status, 500);
  assert.deepEqual([banco.pedOrc.length, banco.listaItens.length, banco.itensV4.length, banco.furacao.length], [0, 0, 0, 0]);
});

test('atualizar orçamento: troca os itens daquele número/tipo e não toca vidros/perfis', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ TIPO: 'Orçamento', NUMERO: 10, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Aguardando resposta' });
  banco.listaItens.push({ TIPO: 'Orçamento', NUMERO: 10, ITEM: 1, PRODUTO: 'antigo' }, { TIPO: 'Pedido', NUMERO: 10, ITEM: 1, PRODUTO: 'do pedido' });
  banco.vidros.push({ NUMERO: 10, MODELO: 'do pedido 10' });
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await salvar(chamar, corpo({ modo: 'atualizar', numero: 10 }));
  assert.deepEqual(await r.json(), { ok: true, tipo: 'Orçamento', numero: 10 });
  assert.equal(banco.pedOrc.length, 1);
  assert.equal(banco.pedOrc[0].CLIENTE_FINAL, 'Fulano');
  assert.deepEqual(banco.listaItens.map(l => [l.TIPO, l.PRODUTO]), [['Pedido', 'do pedido'], ['Orçamento', 'Porta de giro']]);
  assert.deepEqual(banco.vidros, [{ NUMERO: 10, MODELO: 'do pedido 10' }]);
});

test('atualizar pedido: regrava vidros e perfis do número', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ TIPO: 'Pedido', NUMERO: 10, RAZAO_SOCIAL: 'CLIENTE TESTE' });
  banco.vidros.push({ NUMERO: 10, MODELO: 'velho' });
  banco.perfis.push({ NUMERO: 10, PERFIL: 'velho' });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await salvar(chamar, pedido({ modo: 'atualizar', numero: 10 }))).status, 200);
  assert.deepEqual(banco.vidros.map(v => v.MODELO), ['Vidro V']);
  assert.deepEqual(banco.perfis.map(v => v.PERFIL), ['Perfil P']);
});

test('atualizar número inexistente: 404 sugerindo número novo', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ modo: 'atualizar', numero: 99 }));
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'Orçamento nº 99 não encontrado. Salve com novo número.');
  assert.equal(banco.pedOrc.length, 0);
});

// correr S1 (desconto 40), vão 2100×1600, 2 folhas, transpasse 50 → folhas 2060×825
// perfil 2×(2060+825) = 5,77 m × 100 = 577 por folha × 2 = 1154 + Trilho 2 × 40/m × 1,6 m + Roldana 4×15 = 1342
const correr = (mudar = {}) => ({ frente: 'Porta de Correr', qtd: 2, altura: 2100, largura: 1600, obs: '', furos: { lista: [], lados: [] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Preto', puxador: '', revestimento: '', sistema: 'S1', transpasse: '50', desempenador: false, posicoesFolhas: ['', ''] },
  acessorios: [], historico: '', valorTela: 671, ...mudar });

test('porta de correr com sistema: vão e porta gravados, itens do sistema nos complementos', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  assert.equal((await salvar(chamar, corpo({ itens: [correr()] }))).status, 200);
  const l = banco.listaItens[0];
  assert.deepEqual([l.PRODUTO, l.QTD, l.UNITARIO, l.TOTAL], ['Porta de correr', 1, 1342, 1342]);
  const v = banco.itensV4[0];
  assert.deepEqual([v.QTD, v.ALTURA, v.LARGURA, v.ALTURA_VAO, v.LARGURA_VAO], [2, 2060, 825, 2100, 1600]);
  assert.deepEqual([l.TIPO_PRODUTO, v.TIPO_PRODUTO], ['Porta de correr', 'Porta de correr']); // frm_Pedido.vb:336 compara com c minúsculo
  assert.deepEqual(banco.complementos.map(c => [c.ITEM, c.QTD, c.COMPLEMENTO, c.TAMANHO, c.UNITARIO]),
    [[1, 2, 'Trilho Sup', 1600, 40], [2, 4, 'Roldana', 0, 15]]);
});

test('porta de correr sem sistema: só portas, vão em branco', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  // 2×(2100+1600) = 7,4 m × 100 = 740 por folha
  const item = correr({ valorTela: 740, detalhes: { ...correr().detalhes, sistema: 'Sem sistema' } });
  assert.equal((await salvar(chamar, corpo({ itens: [item] }))).status, 200);
  const v = banco.itensV4[0];
  assert.deepEqual([v.ALTURA, v.LARGURA, v.ALTURA_VAO, v.LARGURA_VAO], [2100, 1600, null, null]);
  assert.equal(banco.complementos.length, 0);
});

test('acessório manual fora da lista de permitidos não trava mais o salvamento', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro({ acessorios: [{ nome: 'Roldana', qtd: 1, origem: 'MANUAL' }] })] }));
  assert.equal(r.status, 200);
  assert.equal(banco.pedOrc.length, 1);
});

test('o valor da tela é gravado como está, sem recalcular (só avisa a divergência)', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro({ valorTela: 12345.67 })] }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.avisos.precoDivergente[0].valorTela, 12345.67);
  assert.equal(banco.listaItens[0].UNITARIO, 12345.67);
});

test('erro REAL do banco ao ler o cadastro: 503 claro e nada gravado (nunca preço com taxa 0)', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const { pool } = require('../index.js');
  const orig = pool.execute;
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (/FROM acabamentos/.test(sql)) throw Object.assign(new Error('perdeu a conexão'), { code: 'PROTOCOL_CONNECTION_LOST' });
    return orig.call(pool, sql, params);
  });
  const r = await salvar(chamar, corpo({ itens: [giro({ detalhes: { ...giro().detalhes, acabamento: 'Anodizado' } })] }));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).codigo, 'erro_cadastro');
  assert.equal(banco.pedOrc.length, 0);
});

test('serralheria e avulso', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  // serralheria: (1 + 0,5) m × 30 = 45 · avulso: perfil 3 m × 100 = 300
  const serr = { frente: 'Serralheria', qtd: 1, altura: 1000, largura: 500, profundidade: 0, soldas: 0, obs: 'soldar bem', furos: { lista: [], lados: [] },
    detalhes: { produto: 'Grade', material: 'Metalon 20', acabSerr: '', corSerr: '' }, acessorios: [], historico: '', valorTela: 45 };
  const av = { frente: 'Avulso', qtd: 2, altura: 3000, largura: 0, obs: '', furos: { lista: [], lados: [] },
    detalhes: { categoria: 'Perfil', avProduto: 'Perfil P', avAcab: '', avCor: '' }, acessorios: [], historico: '', valorTela: 300 };
  assert.equal((await salvar(chamar, corpo({ itens: [serr, av] }))).status, 200);
  assert.deepEqual(banco.listaItens.map(l => [l.ITEM, l.TIPO_PRODUTO, l.PRODUTO, l.QTD, l.TOTAL]), [[1, 'Metalons', 'Grade', 1, 45], [2, 'Perfil', '', 2, 600]]);
  const s = banco.serralheria[0];
  assert.deepEqual([s.ITEM_PEDIDO, s.ITEM, s.QTD_ITENS, s.PRODUTO, s.MATERIAL, s.ALTURA, s.LARGURA, s.PROFUNDIDADE, s.UNITARIO, s.TOTAL, s.OBS],
    [1, 1, 1, 'Grade', 'Metalon 20', 1000, 500, 0, 45, 45, 'soldar bem']);
  assert.equal(banco.itensV4.length, 1);
  const v = banco.itensV4[0];
  assert.deepEqual([v.ITEM_PEDIDO, v.TIPO_PRODUTO, v.PORTA, v.QTD, v.ALTURA, v.PERFIL, v.REVESTIMENTO, v.UNITARIO, v.TOTAL], [2, 'Perfil', 1, 2, 3000, 'Perfil P', null, 300, 600]);
});

test('quantidade absurda no item é recusada (não monta milhões de folhas)', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, corpo({ itens: [giro({ qtd: 1e8 })] }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'Item 1: quantidade inválida (1 a 500).');
  assert.equal(banco.pedOrc.length, 0);
});

test('item sem detalhes (ex.: item 🔒 enviado ao virar pedido): a mensagem diz qual item e o campo', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, pedido({ itens: [giro(), { frente: 'Porta de giro', qtd: 1, altura: 0, largura: 0, obs: '' }] }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^Item 2: faltam os dados do item \(campo 'detalhes'\)/);
  assert.equal(banco.pedOrc.length, 0);
});

test('cor do revestimento vazia não reprova o item', async t => {
  const { chamar } = await prepararPedOrc(t);
  const r = await salvar(chamar, pedido({ itens: [giro({ detalhes: { ...giro().detalhes, corRevest: '' } })] }));
  assert.equal(r.status, 200);
});

// Regressão (pedido 23376): o banco/VB guarda "A receber" (r minúsculo) e a tela mostrava isso ao abrir; o servidor comparava
// com maiúsculas/minúsculas exatas e recusava o Salvar com "Favor escolher a situação financeira do pedido!".
test('situação e financeiro: aceita caixa/espaços diferentes e grava o valor canônico', async t => {
  for (const [fin, sit] of [['A receber', 'Em Produção'], [' a receber ', 'Em produção'], ['RECEBIDO', 'entregue']]) {
    const { banco, chamar } = await prepararPedOrc(t);
    const r = await salvar(chamar, pedido({ financeiro: fin, situacao: sit }));
    assert.equal(r.status, 200, `${fin} / ${sit}`);
    const cab = banco.pedOrc[0];
    assert.ok(['Recebido', 'A Receber'].includes(cab.FINANCEIRO), cab.FINANCEIRO);
    assert.ok(['Em Produção', 'Entregue'].includes(cab.SITUACAO), cab.SITUACAO);
  }
  const { chamar } = await prepararPedOrc(t);
  assert.equal((await salvar(chamar, pedido({ financeiro: 'Qualquer' }))).status, 400);
});

test('orcamentos.html: abrir documento escolhe a opção sem diferenciar caixa e sincroniza o alternador Pedido/Orçamento', () => {
  const h = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'orcamentos.html'), 'utf8');
  const esc = /function escolherOpcao[\s\S]*?\n        }/.exec(h)[0];
  assert.match(esc, /toLowerCase\(\)/);
  const abrir = /async function abrirDocumento[\s\S]*?return true;/.exec(h)[0];
  assert.match(abrir, /sincronizarTipoToggle\(\)/);
});

// QTD editada de linha do sistema (decisão do dono, 2026-11-12): vale a enviada (inteiro 1 a 9999), acima ou abaixo da tabela
// (tabela: Trilho Sup 2, Roldana 4); inválida = tabela; preço unitário e tamanho continuam os do cadastro
test('porta de correr: QTD editada de acessório do sistema é gravada; inválida volta à tabela', async t => {
  const sis = (trilho, roldana) => [{ nome: 'Trilho Sup', qtd: trilho, origem: 'SISTEMA DE CORRER' }, { nome: 'Roldana', qtd: roldana, origem: 'SISTEMA DE CORRER' }];
  const gravado = async acessorios => {
    const { banco, chamar } = await prepararPedOrc(t);
    assert.equal((await salvar(chamar, corpo({ itens: [correr({ acessorios })] }))).status, 200);
    return banco.complementos.map(c => [c.COMPLEMENTO, c.QTD, c.TAMANHO, c.UNITARIO]);
  };
  assert.deepEqual(await gravado(sis(2, 4)), [['Trilho Sup', 2, 1600, 40], ['Roldana', 4, 0, 15]]);
  assert.deepEqual(await gravado(sis(3, 6)), [['Trilho Sup', 3, 1600, 40], ['Roldana', 6, 0, 15]]);
  assert.deepEqual(await gravado(sis(1, 1)), [['Trilho Sup', 1, 1600, 40], ['Roldana', 1, 0, 15]]);
  assert.deepEqual(await gravado(sis(0, 2.5)), [['Trilho Sup', 2, 1600, 40], ['Roldana', 4, 0, 15]]);
});
