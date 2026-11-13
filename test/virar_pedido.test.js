// Transformar ORÇAMENTO em PEDIDO: POST /ped_orc/orcamentos/:numero/virar_pedido + janela (virar_pedido.js) + ligações nas telas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const OrcamentoPedido = require('../calculo/orcamento_pedido');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const URL = n => `/ped_orc/orcamentos/${n}/virar_pedido`;
const item = () => ({ frente: 'Porta de giro', qtd: 2, altura: 2234, largura: 545, profundidade: 0, soldas: 0, obs: '',
  furos: { lista: [100, 700], lados: ['Esquerdo', 'Esquerdo'] },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: 'Inox Escovado', puxador: 'Puxador X', tipoPuxador: 'Sobreposto', acabPux: 'Anodizado', corPux: 'Inox Escovado',
    tamanhoPux: '150', posicao: 'Lateral Direita Centro', posicoesFolhas: ['Lateral Direita Centro', 'Lateral Direita Centro'], revestimento: 'Vidro V', corRevest: '', divisor: '', divH: 0, divV: 0 },
  acessorios: [], historico: '', valorTela: 1000 });
const corpoOrc = { modo: 'novo', tipo: 'Orçamento', clienteCodigo: 7, clienteFinal: 'Fulano', obsGeral: 'Obs geral', descontoPct: 5, dataEntrega: '2026-11-20', itens: [item()] };

async function comOrcamento(t, opcoes = {}) {
  const ctx = await prepararPedOrc(t, opcoes);
  const r = await ctx.chamar('/ped_orc/salvar', 'POST', corpoOrc);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return { ...ctx, numeroOrc: (await r.json()).numero };
}

test('cria o pedido com Financeiro "A Receber" e Produção "Em Produção" por padrão; o orçamento não muda; audita nos dois documentos', async t => {
  const { banco, chamar, numeroOrc } = await comOrcamento(t);
  const orcAntes = JSON.stringify(banco.pedOrc.find(p => p.TIPO === 'Orçamento'));
  const itensOrcAntes = JSON.stringify([banco.listaItens, banco.itensV4].map(l => l.filter(x => x.TIPO === 'Orçamento')));
  const r = await chamar(URL(numeroOrc), 'POST', { dataPronto: '2026-12-01' });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.ok, true); assert.equal(j.tipo, 'Pedido'); assert.equal(j.numero, 1);
  const ped = banco.pedOrc.find(p => p.TIPO === 'Pedido');
  assert.equal(ped.SITUACAO, 'Em Produção'); assert.equal(ped.FINANCEIRO, 'A Receber'); assert.equal(ped.DATA_PRONTO, '2026-12-01');
  assert.equal(ped.RAZAO_SOCIAL, 'CLIENTE TESTE'); assert.equal(ped.CLIENTE_FINAL, 'Fulano'); assert.equal(ped.OBS_GERAL, 'Obs geral'); assert.equal(ped.DESCONTO, 5);
  // mesmos itens e valor do orçamento (valor da tela = valor gravado), e o pedido ganha os vidros/perfis da produção
  const orc = banco.pedOrc.find(p => p.TIPO === 'Orçamento');
  assert.equal(ped.TOTAL, orc.TOTAL); assert.equal(ped.SUB_TOTAL, orc.SUB_TOTAL);
  assert.equal(banco.listaItens.filter(x => x.TIPO === 'Pedido').length, 1);
  assert.equal(banco.listaItens.find(x => x.TIPO === 'Pedido').UNITARIO, 1000);
  assert.ok(banco.vidros.length >= 1 && banco.perfis.length >= 1, 'vidros e perfis só existem no pedido');
  assert.equal(JSON.stringify(banco.pedOrc.find(p => p.TIPO === 'Orçamento')), orcAntes, 'orçamento intacto');
  assert.equal(JSON.stringify([banco.listaItens, banco.itensV4].map(l => l.filter(x => x.TIPO === 'Orçamento'))), itensOrcAntes);
  const aud = banco.auditoria.filter(a => a.acao === 'orcamento_virou_pedido');
  assert.equal(aud.length, 2);
  assert.deepEqual(aud.map(a => a.alvo).sort(), ['Orçamento 1', 'Pedido 1']);
  assert.deepEqual(JSON.parse(aud.find(a => a.alvo === 'Pedido 1').detalhe), { orcamento: 1, cliente: 'CLIENTE TESTE', dataPronto: '2026-12-01', financeiro: 'A Receber', situacao: 'Em Produção' });
  assert.equal(JSON.parse(aud.find(a => a.alvo === 'Orçamento 1').detalhe).pedido, 1);
});

test('financeiro escolhido vale (caixa e espaços não contam); o pedido novo segue a numeração dos pedidos', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ id: 1, TIPO: 'Pedido', NUMERO: 40, RAZAO_SOCIAL: 'OUTRO', SITUACAO: 'Pronto', FINANCEIRO: 'Recebido', DATA_PRONTO: '2026-10-01' });
  const { chamar, numeroOrc } = await comOrcamento(t, { banco });
  const r = await chamar(URL(numeroOrc), 'POST', { dataPronto: '2026-12-01', financeiro: 'sem custo', situacao: 'em produção' });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.numero, 41);
  const ped = banco.pedOrc.find(p => p.TIPO === 'Pedido' && p.NUMERO === 41);
  assert.equal(ped.FINANCEIRO, 'Sem custo'); assert.equal(ped.SITUACAO, 'Em Produção');
});

test('valida a data de pronto, o financeiro e a produção: 400 e nada é gravado', async t => {
  const { banco, chamar, numeroOrc } = await comOrcamento(t);
  const base = { dataPronto: '2026-12-01' };
  for (const corpo of [{}, { dataPronto: '' }, { dataPronto: '01/12/2026' }, { dataPronto: '2026-02-30' }, { dataPronto: 20261201 },
    { ...base, financeiro: 'Pago' }, { ...base, situacao: 'Cancelado' }, { ...base, situacao: 'Entregue' }, { ...base, financeiro: 7 }]) {
    const r = await chamar(URL(numeroOrc), 'POST', corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
  }
  assert.equal(banco.pedOrc.filter(p => p.TIPO === 'Pedido').length, 0);
  assert.equal(banco.auditoria.filter(a => a.acao === 'orcamento_virou_pedido').length, 0);
});

test('número inválido 400; orçamento inexistente 404; só orçamento (um Pedido com esse número não serve)', async t => {
  const { banco, chamar } = await comOrcamento(t);
  assert.equal((await chamar(URL('x'), 'POST', { dataPronto: '2026-12-01' })).status, 400);
  assert.equal((await chamar(URL(0), 'POST', { dataPronto: '2026-12-01' })).status, 400);
  assert.equal((await chamar(URL(99), 'POST', { dataPronto: '2026-12-01' })).status, 404);
  assert.equal(banco.pedOrc.filter(p => p.TIPO === 'Pedido').length, 0);
});

test('orçamento já transformado: 409 com aviso até confirmarDuplicado; confirmado cria outro pedido', async t => {
  const { banco, chamar, numeroOrc } = await comOrcamento(t);
  assert.equal((await chamar(URL(numeroOrc), 'POST', { dataPronto: '2026-12-01' })).status, 200);
  const r = await chamar(URL(numeroOrc), 'POST', { dataPronto: '2026-12-01' });
  const j = await r.json();
  assert.equal(r.status, 409); assert.equal(j.aviso, 'ja_convertido'); assert.equal(j.pedido, 1);
  assert.equal(banco.pedOrc.filter(p => p.TIPO === 'Pedido').length, 1);
  const r2 = await chamar(URL(numeroOrc), 'POST', { dataPronto: '2026-12-01', confirmarDuplicado: true });
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).numero, 2);
});

test('item que só o VB edita (🔒) impede a transformação, sem gravar nada', async t => {
  const { banco, chamar, numeroOrc } = await comOrcamento(t);
  banco.listaItens.find(l => l.TIPO === 'Orçamento').TIPO_PRODUTO = 'Tipo desconhecido do VB';
  const r = await chamar(URL(numeroOrc), 'POST', { dataPronto: '2026-12-01' });
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /só o VB edita/);
  assert.equal(banco.pedOrc.filter(p => p.TIPO === 'Pedido').length, 0);
});

test('permissões: exige orcamentos.criar, orcamentos.salvar, pedidos.criar e valores.ver', async t => {
  for (const perfil of ['Interno completo', 'Estoquista', 'Monta sem valores', 'Monta sem salvar', 'Representante']) {
    const banco = bancoPedOrc();
    banco.pedOrc.push({ id: 1, TIPO: 'Orçamento', NUMERO: 3, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Aguardando resposta', DATA_PRONTO: '2026-11-20' });
    const { chamar } = await prepararPedOrc(t, { banco, perfil, estados: [] });
    assert.equal((await chamar(URL(3), 'POST', { dataPronto: '2026-12-01' })).status, 403, perfil);
    assert.equal(banco.pedOrc.filter(p => p.TIPO === 'Pedido').length, 0, perfil);
  }
});

test('usuário com estados restritos: só orçamento de cliente do seu estado', async t => {
  const banco = bancoPedOrc();
  const ctx = await comOrcamento(t, { banco, perfil: 'Administrador' });   // cliente do RJ, gravado por quem não tem restrição
  const c = await prepararPedOrc(t, { banco, perfil: 'Representante SP' });
  const r = await c.chamar(URL(ctx.numeroOrc), 'POST', { dataPronto: '2026-12-01' });
  assert.equal(r.status, 403);
  assert.equal(banco.pedOrc.filter(p => p.TIPO === 'Pedido').length, 0);
});

test('pedido criado por aqui reabre normalmente e o salvar da tela continua igual (refatoração do POST /ped_orc/salvar)', async t => {
  const { chamar, numeroOrc } = await comOrcamento(t);
  const j = await (await chamar(URL(numeroOrc), 'POST', { dataPronto: '2026-12-01' })).json();
  const aberto = await (await chamar(`/ped_orc/Pedido/${j.numero}`)).json();
  assert.equal(aberto.cabecalho.tipo, 'Pedido'); assert.equal(aberto.cabecalho.financeiro, 'A Receber'); assert.equal(aberto.cabecalho.situacao, 'Em Produção');
  assert.equal(aberto.cabecalho.dataEntrega, '2026-12-01'); assert.equal(aberto.itens.length, 1); assert.equal(aberto.itens[0].travado, undefined);
  const novo = await chamar('/ped_orc/salvar', 'POST', { ...corpoOrc, tipo: 'Pedido', situacao: 'Em Produção', financeiro: 'A Receber' });
  assert.equal(novo.status, 200);
  assert.equal((await chamar('/ped_orc/salvar', 'POST', { ...corpoOrc, tipo: 'Pedido', situacao: '', financeiro: 'A Receber' })).status, 400);
});

test('funções puras: validarPedido (padrões e canônico) e montarCorpo (cliente, itens, travado)', () => {
  const deps = { canonico: (l, v) => l.find(x => x.toLowerCase() === String(v).trim().toLowerCase()), SITUACOES: ['Em Produção'], FINANCEIROS: ['Recebido', 'A Receber'],
    validarData: v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null) };
  assert.deepEqual(OrcamentoPedido.validarPedido({ dataPronto: '2026-12-01' }, deps), { ok: true, valores: { dataPronto: '2026-12-01', financeiro: 'A Receber', situacao: 'Em Produção' } });
  assert.equal(OrcamentoPedido.validarPedido({ dataPronto: '2026-12-01', financeiro: 'recebido' }, deps).valores.financeiro, 'Recebido');
  assert.equal(OrcamentoPedido.validarPedido({}, deps).ok, false);
  assert.equal(OrcamentoPedido.validarPedido({ dataPronto: '2026-12-01', financeiro: 'x' }, deps).ok, false);
  const cab = { clienteFinal: 'F', obsGeral: 'O', descontoPct: 3 }, v = { dataPronto: '2026-12-01', financeiro: 'A Receber', situacao: 'Em Produção' };
  const it = { frente: 'Avulso', qtd: 1, valor: 10, detalhes: {} };
  const ok = OrcamentoPedido.montarCorpo({ cabecalho: cab, itens: [it], clienteCodigo: 7, ...v });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.corpo.modo, ok.corpo.tipo, ok.corpo.dataEntrega, ok.corpo.financeiro, ok.corpo.situacao, ok.corpo.descontoPct], ['novo', 'Pedido', '2026-12-01', 'A Receber', 'Em Produção', 3]);
  assert.equal(ok.corpo.itens[0].valorTela, 10); assert.equal(ok.corpo.itens[0].origem, undefined, 'não é cópia do orçamento');
  assert.equal(OrcamentoPedido.montarCorpo({ cabecalho: cab, itens: [it], clienteCodigo: null, ...v }).ok, false);
  assert.equal(OrcamentoPedido.montarCorpo({ cabecalho: cab, itens: [], clienteCodigo: 7, ...v }).ok, false);
  assert.match(OrcamentoPedido.montarCorpo({ cabecalho: cab, itens: [{ travado: true, motivo: 'x', frente: 'Y' }], clienteCodigo: 7, ...v }).erro, /só o VB edita/);
  const serr = OrcamentoPedido.itemParaGravar({ frente: 'Serralheria', qtd: 1, valor: 5, pecas: [{}], complementos: [{ id: 1, qtd: 2, extra: 'x' }], qtdAltura: 1, qtdLargura: 1, qtdProfundidade: 1 });
  assert.deepEqual(serr.complementos, [{ id: 1, qtd: 2 }]);
});

test('janela: sem erro de sintaxe, padrões Financeiro "A Receber" / Produção "Em Produção", data sugerida e conversão de data', () => {
  const src = ler('virar_pedido.js');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'virar_pedido.js' }));
  const janela = { addEventListener() {}, document: {}, location: {} };
  vm.runInNewContext(src, { window: janela, document: {}, location: {}, localStorage: {}, alert() {}, confirm() {}, fetch() {}, encodeURIComponent });
  const V = janela.VirarPedido;
  assert.deepEqual({ ...V.PADRAO }, { financeiro: 'A Receber', situacao: 'Em Produção' });
  assert.ok(V.FINANCEIROS.includes('A Receber') && V.SITUACOES.includes('Em Produção'));
  assert.equal(V.paraISO('05/12/2026'), '2026-12-05'); assert.equal(V.paraISO('2026-12-05 10:00'), '2026-12-05'); assert.equal(V.paraISO('x'), '');
  assert.equal(V.dataSugerida('01/12/2026', '2026-11-13'), '2026-12-01');
  assert.equal(V.dataSugerida('01/11/2026', '2026-11-13'), '', 'data já passada: a pessoa escolhe');
  assert.match(src, /Editar pedido/); assert.match(src, /Enviar do jeito que está/);
  assert.ok(!/style|#[0-9a-fA-F]{3,6}\b|rgba?\(|innerHTML/.test(src), 'sem estilo nem cor solta no JS (classes dp-*/vp-* em tema.css)');
  assert.ok(/\.vp-caixa/.test(ler('tema.css')));
});

test('telas: item do menu de Orçamentos atrás das permissões e botão em orcamentos.html; script carregado', () => {
  assert.match(ler('painel_inicial.html'), /if \(!ehPedido\) add\('orcamentos\.criar orcamentos\.salvar pedidos\.criar valores\.ver', '[^']+', 'Transformar em pedido'/);
  assert.ok(ler('painel_inicial.html').includes('<script src="virar_pedido.js'));
  const o = ler('orcamentos.html');
  assert.ok(o.includes('<script src="virar_pedido.js'));
  assert.match(o, /id="btn-virar-pedido" data-perm="pedidos\.criar"/);
  assert.match(o, /\$s\('btn-virar-pedido'\)\.style\.display = podeVirarPedido \? '' : 'none';/);
  assert.match(o, /getElementById\('btn-virar-pedido'\)\.addEventListener\('click', transformarEmPedido\)/);
});

test('lista Pedidos e Orçamentos: "Enviar do jeito que está" cria direto, avisa com o nº do pedido e recarrega a lista; sem permissão o item aparece desativado', () => {
  const p = ler('painel_inicial.html');
  assert.match(p, /aoEnviar: n => \{ alert\(`Pedido nº \$\{n\} criado a partir do orçamento nº \$\{numero\}\.`\); carregar\(\); \}/);
  assert.match(p, /Transformar em pedido \(sem permissão\)[^\n]*desativado: true/);
  assert.ok(ler('virar_pedido.js').includes("aoEnviar(d.numero)"));
});

test('histórico do pedido mostra "Criado a partir do orçamento nº N" sem dinheiro', () => {
  const H = require('../calculo/historico_pedido');
  assert.ok(H.ACOES_HISTORICO.includes('orcamento_virou_pedido'));
  const r = H.montarHistorico([{ quando: '2026-11-13 10:00:00', quem: 'Ana', acao: 'orcamento_virou_pedido', detalhe: JSON.stringify({ orcamento: 21440, cliente: 'X', financeiro: 'A Receber' }) }]);
  assert.equal(r[0].resumo, 'Criado a partir do orçamento nº 21440');
});
