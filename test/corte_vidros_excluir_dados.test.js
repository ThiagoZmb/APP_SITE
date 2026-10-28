// Excluir os dados de plano de corte de vidros de um pedido (DELETE /corte_vidros/pedido/:numero).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoVidros, prepararVidros, corpoConfirmacao } = require('./apoio/bancoVidros');
const { REGEX_VALOR } = require('../seguranca/valores');

const ESC = { 'Extra Clear 4mm|': 11 };
const prever = async (chamar, n = 100) => (await chamar(`/corte_vidros/pedido/${n}?escolhas=` + encodeURIComponent(JSON.stringify(ESC)))).json();
const salvar = async (chamar, n = 100) => {
  const p = await prever(chamar, n);
  return (await chamar(`/corte_vidros/pedido/${n}/salvar`, 'POST', { impressao: p.impressao, retalhosUsados: p.retalhosUsados, escolhas: ESC })).json();
};
const excluir = (chamar, n = 100, corpo) => chamar(`/corte_vidros/pedido/${n}`, 'DELETE', corpo);
const baixas = [{ chave: 'Extra Clear 4mm|', produtoCodigo: 11 }];

// pedido N: 1 peça Extra Clear 4mm (1000x500)
function cenario(b = bancoVidros(), n = 100) {
  b.semear.pedido({ NUMERO: n });
  b.semear.item({ NUMERO: n, ITEM_PEDIDO: 1, REVESTIMENTO: 'Extra Clear 4mm' });
  b.semear.vidro({ NUMERO: n, ITEM: 1, QTD: 1, MODELO: 'Extra Clear 4mm', TAMANHO: '1000 x 500' });
  return b;
}
const retalhoExtra = b => b.semear.retalho({ produto_codigo: 11, produto_nome: 'Vidro Extra Clear 4mm - 2400mm', altura: 1500, largura: 1000 });

test('excluir dados do pedido: apaga plano gerado, solta os retalhos reservados e audita só nomes e quantidades', async t => {
  const b = cenario(); const ret = retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'reservado');
  const r = await excluir(chamar);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.qtdPlanos, j.qtdConferidos, j.qtdRetalhosLiberados], [1, 0, 1]);
  assert.equal(b.estado.planos.length, 0);
  const x = b.estado.retalhos.find(y => y.id === ret.id);
  assert.deepEqual([x.situacao, x.plano_reserva], ['disponivel', null]);
  const a = b.estado.auditoria.find(y => y.acao === 'corte_vidros_dados_pedido_excluidos');
  assert.deepEqual([a.detalhe.pedido, a.detalhe.planos], [100, [id]]);
  const nomes = new Set(); for (const k of Object.keys(a.detalhe)) nomes.add(k); for (const k of Object.keys(j)) nomes.add(k);
  assert.deepEqual([...nomes].filter(k => REGEX_VALOR.test(k)), []);
  const p = await prever(chamar);
  assert.deepEqual([p.planoSalvo, p.qtdPlanosGravados], [null, 0]);
});

test('excluir dados: também apaga planos cancelados e não mexe nos planos de outro pedido', async t => {
  const b = cenario(); cenario(b, 101);
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id: antigo } = await salvar(chamar);
  await chamar(`/corte_vidros/plano/${antigo}/cancelar`, 'POST');
  await salvar(chamar);
  const { id: outro } = await salvar(chamar, 101);
  const r = await excluir(chamar);
  assert.equal((await r.json()).qtdPlanos, 2);
  assert.deepEqual(b.estado.planos.map(p => p.id), [outro]);
});

test('excluir dados de pedido sem nenhum plano: 404 (e id inválido 404), sem auditar', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { banco: b });
  assert.equal((await excluir(chamar)).status, 404);
  assert.equal((await excluir(chamar, 'abc')).status, 404);
  assert.deepEqual(b.estado.auditoria, []);
});

test('excluir dados de pedido que já não existe (apagado no VB): funciona, é a saída para plano órfão', async t => {
  const b = cenario(); const ret = retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  await salvar(chamar);
  b.estado.pedidos.length = 0;
  assert.equal((await excluir(chamar)).status, 200);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'disponivel');
});

test('plano conferido: exige confirmação reforçada (409) e corte.parametros (403); o material físico permanece', async t => {
  const b = cenario(); retalhoExtra(b);
  const { chamar } = await prepararVidros(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal((await chamar(`/corte_vidros/plano/${id}/confirmar`, 'POST', await corpoConfirmacao(chamar, id, { baixas }))).status, 200);
  const antes = b.estado.retalhos.map(r => ({ ...r }));
  const sem = await excluir(chamar);
  assert.equal(sem.status, 409);
  assert.equal((await sem.json()).exigeConfirmacaoConferido, true);
  assert.equal(b.estado.planos.length, 1);
  const ok = await excluir(chamar, 100, { incluirConferidos: true });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).qtdConferidos, 1);
  assert.equal(b.estado.planos.length, 0);
  // retalho usado continua usado, sobra guardada continua disponível; só perdem a ligação com o plano apagado
  assert.equal(b.estado.retalhos.length, antes.length);
  assert.deepEqual(b.estado.retalhos.map(r => r.situacao), antes.map(r => r.situacao));
  assert.ok(b.estado.retalhos.every(r => r.plano_origem == null && r.plano_reserva == null));
});

test('plano conferido: quem só planeja (sem corte.parametros) recebe 403 e nada é apagado', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { perfil: 'Planeja', banco: b });
  const { id } = await salvar(chamar);
  assert.equal((await chamar(`/corte_vidros/plano/${id}/confirmar`, 'POST', await corpoConfirmacao(chamar, id, { baixas }))).status, 200);
  assert.equal((await excluir(chamar, 100, { incluirConferidos: true })).status, 403);
  assert.equal(b.estado.planos.length, 1);
});

test('quem só planeja consegue excluir plano que não está conferido', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { perfil: 'Planeja', banco: b });
  await salvar(chamar);
  assert.equal((await excluir(chamar)).status, 200);
  assert.equal(b.estado.planos.length, 0);
});

test('excluir dados: sem corte.planejar dá 403', async t => {
  const b = cenario();
  const { chamar } = await prepararVidros(t, { perfil: 'Só ver corte', banco: b });
  assert.equal((await excluir(chamar)).status, 403);
});
