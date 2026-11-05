// Alterar a data de pronto (ped_orc.DATA_PRONTO) pelo menu do botão direito: POST /ped_orc/:tipo/:numero/data_pronto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');

const doc = (banco, tipo, numero, extra = {}) => banco.pedOrc.push({ id: numero + (tipo === 'Pedido' ? 100 : 0), TIPO: tipo, NUMERO: numero, RAZAO_SOCIAL: 'CLIENTE TESTE',
  SITUACAO: tipo === 'Pedido' ? 'Em Produção' : 'Aguardando resposta', TOTAL: 100, DATA: '2026-10-01 10:00:00', DATA_PRONTO: '2026-11-10', DATA_ENTREGA: null, ...extra });
const URL = (tipo, n) => `/ped_orc/${tipo}/${n}/data_pronto`;
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('pedido: grava só DATA_PRONTO (situação, entrega, total e outros documentos intactos) e audita de/para', async t => {
  const banco = bancoPedOrc(); doc(banco, 'Pedido', 5); doc(banco, 'Orçamento', 5, { DATA_PRONTO: '2026-12-01' });
  const antes = JSON.stringify(banco.pedOrc.map(p => ({ ...p, DATA_PRONTO: undefined })));
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar(URL('Pedido', 5), 'POST', { dataPronto: '2026-11-20' });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(await r.json(), { ok: true, tipo: 'Pedido', numero: 5, dataPronto: '2026-11-20' });
  assert.equal(banco.pedOrc.find(p => p.TIPO === 'Pedido').DATA_PRONTO, '2026-11-20');
  assert.equal(banco.pedOrc.find(p => p.TIPO === 'Orçamento').DATA_PRONTO, '2026-12-01');
  assert.equal(JSON.stringify(banco.pedOrc.map(p => ({ ...p, DATA_PRONTO: undefined }))), antes);
  assert.equal(banco.auditoria.length, 1);
  assert.equal(banco.auditoria[0].acao, 'data_pronto_alterada');
  assert.deepEqual(JSON.parse(banco.auditoria[0].detalhe), { cliente: 'CLIENTE TESTE', de: '2026-11-10', para: '2026-11-20' });
});

test('orçamento: Vendedor (orcamentos.salvar) altera; data no passado é aceita', async t => {
  const banco = bancoPedOrc(); doc(banco, 'Orçamento', 6);
  const { chamar } = await prepararPedOrc(t, { banco, perfil: 'Vendedor' });
  assert.equal((await chamar(URL('Orçamento', 6), 'POST', { dataPronto: '2026-01-05' })).status, 200);
  assert.equal(banco.pedOrc[0].DATA_PRONTO, '2026-01-05');
  assert.equal(banco.pedOrc[0].SITUACAO, 'Aguardando resposta');
});

test('permissão negada: pedido sem pedidos.situacao; orçamento só com orcamentos.situacao (Representante)', async t => {
  let banco = bancoPedOrc(); doc(banco, 'Pedido', 5);
  let c = await prepararPedOrc(t, { banco, perfil: 'Interno completo' });
  assert.equal((await c.chamar(URL('Pedido', 5), 'POST', { dataPronto: '2026-11-20' })).status, 403);
  assert.equal(banco.pedOrc[0].DATA_PRONTO, '2026-11-10');
  banco = bancoPedOrc(); doc(banco, 'Orçamento', 6);
  c = await prepararPedOrc(t, { banco, perfil: 'Representante', estados: [] });
  assert.equal((await c.chamar(URL('Orçamento', 6), 'POST', { dataPronto: '2026-11-20' })).status, 403);
  banco = bancoPedOrc(); doc(banco, 'Orçamento', 6);
  c = await prepararPedOrc(t, { banco, perfil: 'Estoquista' });
  assert.equal((await c.chamar(URL('Orçamento', 6), 'POST', { dataPronto: '2026-11-20' })).status, 403);
  assert.equal(banco.pedOrc[0].DATA_PRONTO, '2026-11-10');
  assert.equal(banco.auditoria.length, 0);
});

test('data inválida → 400 e nada é gravado', async t => {
  const banco = bancoPedOrc(); doc(banco, 'Pedido', 5);
  const { chamar } = await prepararPedOrc(t, { banco });
  for (const dataPronto of [undefined, null, '', '20/11/2026', '2026-02-30', '2026-13-01', '2026-11-20T10:00', 20261120, "2026-11-20'; DROP"]) {
    assert.equal((await chamar(URL('Pedido', 5), 'POST', dataPronto === undefined ? {} : { dataPronto })).status, 400, String(dataPronto));
  }
  assert.equal(banco.pedOrc[0].DATA_PRONTO, '2026-11-10');
  assert.equal(banco.auditoria.length, 0);
});

test('inexistente 404; tipo/número inválidos 400; mesma data 409; pedido cancelado 409', async t => {
  const banco = bancoPedOrc(); doc(banco, 'Pedido', 5); doc(banco, 'Pedido', 7, { SITUACAO: 'Cancelado' });
  const { chamar } = await prepararPedOrc(t, { banco });
  assert.equal((await chamar(URL('Pedido', 99), 'POST', { dataPronto: '2026-11-20' })).status, 404);
  assert.equal((await chamar(URL('Outro', 5), 'POST', { dataPronto: '2026-11-20' })).status, 400);
  assert.equal((await chamar(URL('Pedido', 'x'), 'POST', { dataPronto: '2026-11-20' })).status, 400);
  assert.equal((await chamar(URL('Pedido', 5), 'POST', { dataPronto: '2026-11-10' })).status, 409);
  assert.equal((await chamar(URL('Pedido', 7), 'POST', { dataPronto: '2026-11-20' })).status, 409);
  assert.equal(banco.pedOrc.find(p => p.NUMERO === 7).DATA_PRONTO, '2026-11-10');
  assert.equal(banco.auditoria.length, 0);
});

test('representante com estados restritos: só documento de cliente do seu estado', async t => {
  const banco = bancoPedOrc(); doc(banco, 'Pedido', 5);   // cliente do RJ
  const { chamar } = await prepararPedOrc(t, { banco, perfil: 'Representante SP' });
  assert.equal((await chamar(URL('Pedido', 5), 'POST', { dataPronto: '2026-11-20' })).status, 403);
  assert.equal(banco.pedOrc[0].DATA_PRONTO, '2026-11-10');
});

test('telas: módulo da janela sem erro de sintaxe; item do menu nas duas telas, atrás da permissão; script carregado', () => {
  assert.doesNotThrow(() => new vm.Script(ler('alterar_data_pronto.js'), { filename: 'alterar_data_pronto.js' }));
  assert.doesNotThrow(() => new vm.Script(ler('inicio_menu.js'), { filename: 'inicio_menu.js' }));
  for (const f of ['painel_inicial.html', 'inicio.html']) assert.ok(ler(f).includes('<script src="alterar_data_pronto.js'), f);
  assert.match(ler('painel_inicial.html'), /Acesso\.pode\(ehPedido \? 'pedidos\.situacao' : 'orcamentos\.salvar'\)\)[\s\S]{0,120}Alterar data de pronto/);
  assert.match(ler('inicio_menu.js'), /cfg\.pode\('pedidos\.situacao'\)\)[\s\S]{0,120}Alterar data de pronto/);
  assert.ok(!/style|#[0-9a-fA-F]{3,6}\b|rgba?\(|innerHTML/.test(ler('alterar_data_pronto.js')), 'sem estilo nem cor solta no JS (classes dp-* em tema.css)');
  assert.ok(/\.dp-caixa[^}]*var\(--white\)/.test(ler('tema.css')));
});
