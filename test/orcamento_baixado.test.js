// Situação "Baixado" do orçamento: rota, permissão orcamentos.situacao, migração e menu do botão direito.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { acrescentarPermissoesOrcSituacao } = require('../seguranca/instalacao');
const { CODIGOS, PERFIS_INICIAIS } = require('../seguranca/permissoes');

function comOrcamento(banco, numero, extra = {}, razao = 'CLIENTE TESTE') {
  banco.pedOrc.push({ id: numero, TIPO: 'Orçamento', NUMERO: numero, RAZAO_SOCIAL: razao, SITUACAO: 'Aguardando resposta', TOTAL: 100, ...extra });
}
const URL = n => `/ped_orc/orcamentos/${n}/situacao`;

test('Baixado: grava o texto exato, só no Orçamento (pedido de mesmo número intacto), auditado sem valores', async t => {
  const banco = bancoPedOrc(); comOrcamento(banco, 6);
  banco.pedOrc.push({ id: 60, TIPO: 'Pedido', NUMERO: 6, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Em Produção', TOTAL: 100 });
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar(URL(6), 'POST', { situacao: 'Baixado' });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(banco.pedOrc.find(p => p.TIPO === 'Orçamento').SITUACAO, 'Baixado');
  assert.equal(banco.pedOrc.find(p => p.TIPO === 'Pedido').SITUACAO, 'Em Produção');
  assert.equal(banco.auditoria.length, 1);
  assert.equal(banco.auditoria[0].acao, 'orcamento_situacao');
  assert.ok(!/total/i.test(JSON.stringify(banco.auditoria[0])), "sem total na auditoria"); assert.deepEqual(JSON.parse(banco.auditoria[0].detalhe).para, "Baixado");
  assert.equal((await chamar(URL(6), 'POST', { situacao: 'Baixado' })).status, 409);
  assert.equal((await chamar(URL(99), 'POST', { situacao: 'Baixado' })).status, 404);
});

test('Baixado: pedido não passa pela rota de orçamento nem pela de pedido', async t => {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ id: 60, TIPO: 'Pedido', NUMERO: 7, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Em Produção', TOTAL: 100 });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar(URL(7), 'POST', { situacao: 'Baixado' })).status, 404);
  assert.equal((await chamar('/ped_orc/Pedido/7/situacao', 'POST', { situacao: 'Baixado' })).status, 400);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Em Produção');
});

test('Representante (perfil inicial): marca Baixado, mas não Fechado/Aguardando, nem edita, cancela ou exclui', async t => {
  const banco = bancoPedOrc(); comOrcamento(banco, 8);
  const { chamar } = await prepararPedOrc(t, { banco, perfil: 'Representante', estados: [] });
  assert.equal((await chamar(URL(8), 'POST', { situacao: 'Fechado' })).status, 403);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Aguardando resposta');
  assert.equal((await chamar(URL(8), 'POST', { situacao: 'Baixado' })).status, 200);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Baixado');
  assert.equal((await chamar(URL(8), 'POST', { situacao: 'Aguardando resposta' })).status, 403);
  assert.equal((await chamar('/ped_orc/Orçamento/8', 'DELETE')).status, 403);
  assert.equal((await chamar('/ped_orc/Orçamento/8/cancelar', 'POST')).status, 403);
});

test('sem orcamentos.situacao nem orcamentos.salvar: 403 (ex.: Estoquista); Vendedor (tem salvar) também pode', async t => {
  let banco = bancoPedOrc(); comOrcamento(banco, 9);
  let c = await prepararPedOrc(t, { banco, perfil: 'Estoquista' });
  assert.equal((await c.chamar(URL(9), 'POST', { situacao: 'Baixado' })).status, 403);
  assert.equal(banco.pedOrc[0].SITUACAO, 'Aguardando resposta');
  banco = bancoPedOrc(); comOrcamento(banco, 9);
  c = await prepararPedOrc(t, { banco, perfil: 'Vendedor' });
  assert.equal((await c.chamar(URL(9), 'POST', { situacao: 'Baixado' })).status, 200);
});

test('Representante com estados restritos: só orçamento de cliente do seu estado', async t => {
  const banco = bancoPedOrc(); comOrcamento(banco, 10); comOrcamento(banco, 11, {}, 'LOJA PAULISTA');   // CLIENTE TESTE = RJ; LOJA PAULISTA = SP
  const { chamar } = await prepararPedOrc(t, { banco, perfil: 'Representante', estados: ['SP'] });
  assert.equal((await chamar(URL(10), 'POST', { situacao: 'Baixado' })).status, 403);
  assert.equal(banco.pedOrc.find(p => p.NUMERO === 10).SITUACAO, 'Aguardando resposta');
  assert.equal(banco.auditoria.length, 0);
  assert.equal((await chamar(URL(11), 'POST', { situacao: 'Baixado' })).status, 200);
  assert.equal(banco.pedOrc.find(p => p.NUMERO === 11).SITUACAO, 'Baixado');
});

test('permissão: catálogo, perfis iniciais (Representante só ganha esta) e migração idempotente', async () => {
  assert.ok(CODIGOS.has('orcamentos.situacao'));
  const perm = n => PERFIS_INICIAIS.find(p => p.nome === n).permissoes;
  assert.ok(perm('Representante').includes('orcamentos.situacao'));
  for (const c of ['orcamentos.criar', 'orcamentos.salvar', 'pedidos.criar', 'pedidos.situacao', 'pedidos.cancelar', 'pedidos.excluir']) assert.ok(!perm('Representante').includes(c), c);
  assert.ok(perm('Administrador').includes('orcamentos.situacao') && perm('Interno completo').includes('orcamentos.situacao'));
  let feito = false;
  const pool = criarPoolFalso([
    [/SELECT id FROM web_auditoria WHERE acao = 'permissoes_orc_situacao'/, () => feito ? [{ id: 1 }] : []],
    [/SELECT id, nome FROM web_perfis/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }, { id: 4, nome: 'Representante' }]],
    [/INSERT INTO web_auditoria/, () => { feito = true; return { affectedRows: 1 }; }]
  ]);
  assert.deepEqual(await acrescentarPermissoesOrcSituacao(pool), { feito: true });
  const sel = pool.chamadas.find(c => /SELECT id, nome FROM web_perfis/.test(c.sql)).sql;
  assert.ok(sel.includes("'Representante'") && !sel.includes("'Vendedor'"));
  const ins = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql));
  assert.deepEqual(ins.map(c => c.params.join(':')).sort(), ['1:orcamentos.situacao', '2:orcamentos.situacao', '4:orcamentos.situacao']);
  assert.ok(!pool.chamadas.some(c => /DELETE/.test(c.sql)), 'não tira nada de ninguém');
  const antes = pool.chamadas.length;
  assert.deepEqual(await acrescentarPermissoesOrcSituacao(pool), { feito: false });
  assert.equal(pool.chamadas.slice(antes).filter(c => /INSERT/.test(c.sql)).length, 0);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), /acrescentarPermissoesOrcSituacao\(pool\)/);
});

// executa o itensDoMenu real do painel_inicial.html com permissões simuladas
const h = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8');
function menu(permissoes, x) {
  const ini = h.indexOf('function itensDoMenu(x)'), fim = h.indexOf('let menuCtx = null');
  const ctx = {
    Acesso: { pode: p => String(p).split(/\s+/).every(c => permissoes.has(c)) },
    tipoLista: 'Orçamento', SITUACAO_NOME: {}, ROT_ENTREGA: {}, norm: s => String(s ?? '').toLowerCase(), urlPdf: () => 'u', API_BASE: 'https://api',
    abrirPdfAutenticado() {}, imprimirPdf() {}, mudarSituacao() {}, mudarSituacaoOrcamento() {}, acaoNoDocumento() {}, voltarParaEstaPagina: () => 'x', location: {}
  };
  vm.createContext(ctx);
  vm.runInContext(h.slice(ini, fim) + '\nthis.itensDoMenu = itensDoMenu;', ctx);
  return Array.from(ctx.itensDoMenu(x)).filter(i => i.rotulo);
}

test('menu: Representante vê PDF, Imprimir e "Marcar como Baixado", nada mais', () => {
  const r = menu(new Set(['pedidos.pdf', 'orcamentos.situacao']), { numero: 2, s: 'outro', situacao: 'Aguardando resposta' });
  assert.deepEqual(r.map(i => i.rotulo), ['Abrir PDF', 'Imprimir orçamento', 'Marcar como Baixado']);
  const baixado = menu(new Set(['pedidos.pdf', 'orcamentos.situacao']), { numero: 2, s: 'baixado', situacao: 'Baixado' }).find(i => i.rotulo === 'Marcar como Baixado');
  assert.equal(baixado.desativado, true);
});

test('menu: quem tem orcamentos.salvar vê Fechado, Aguardando e Baixado; sem nenhuma das duas, nada de situação', () => {
  const r = menu(new Set(['pedidos.pdf', 'orcamentos.salvar']), { numero: 2, s: 'outro', situacao: '' }).map(i => i.rotulo);
  assert.deepEqual(r.slice(2), ['Fechado', 'Aguardando resposta', 'Marcar como Baixado']);
  assert.ok(!menu(new Set(['pedidos.pdf']), { numero: 2, s: 'outro' }).some(i => /Baixado|Fechado/.test(i.rotulo)));
});

test('lista: selo "baixado" e confirmação ao mudar a situação', () => {
  assert.match(h, /n === 'baixado' \? 'baixado'/);
  assert.match(h, /\.st\.baixado \{/);
  assert.match(h, /mudarSituacaoOrcamento\(numero, 'Baixado'\)/);
  assert.match(h, /if \(!confirm\(`Mudar a situação do orçamento/);
});
