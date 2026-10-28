// Excluir os dados de plano de corte de um pedido (DELETE /corte/pedido/:numero) e o contador da pré-visualização.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoCorte, prepararCorte, corpoConfirmacao } = require('./apoio/bancoCorte');

// pedido 100: 2 portas de P100 Anodizado/Natural → 4 peças de 2100 e 4 de 900
function cenario(b = bancoCorte()) { b.semear.pedido(); b.semear.perfil(); b.semear.item(); return b; }
const prever = async (chamar, n = 100) => (await chamar(`/corte/pedido/${n}`)).json();
const salvar = async (chamar, n = 100) => {
  const p = await prever(chamar, n);
  return (await chamar(`/corte/pedido/${n}/salvar`, 'POST', { impressao: p.impressao, retalhosUsados: p.retalhosUsados })).json();
};
const excluir = (chamar, n = 100, corpo) => chamar(`/corte/pedido/${n}`, 'DELETE', corpo);

test('pré-visualização informa quantos planos o pedido tem gravados (e quantos conferidos)', async t => {
  const b = cenario(); b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  let j = await prever(chamar);
  assert.deepEqual([j.qtdPlanosGravados, j.qtdConferidos], [0, 0]);
  const { id } = await salvar(chamar);
  await chamar(`/corte/plano/${id}/confirmar`, 'POST', await corpoConfirmacao(chamar, id));
  j = await prever(chamar);
  assert.deepEqual([j.qtdPlanosGravados, j.qtdConferidos], [1, 1]);
});

test('excluir dados do pedido: apaga plano gerado, solta os retalhos reservados e audita', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'reservado');
  const r = await excluir(chamar);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.qtdPlanos, j.qtdConferidos, j.qtdRetalhosLiberados], [1, 0, 1]);
  assert.equal(b.estado.planos.length, 0);
  const x = b.estado.retalhos.find(y => y.id === ret.id);
  assert.deepEqual([x.situacao, x.plano_reserva], ['disponivel', null]);
  const a = b.estado.auditoria.find(y => y.acao === 'corte_dados_pedido_excluidos');
  assert.deepEqual([a.detalhe.pedido, a.detalhe.planos], [100, [id]]);
  const p = await prever(chamar);
  assert.deepEqual([p.planoSalvo, p.qtdPlanosGravados], [null, 0]);
});

test('excluir dados: também apaga planos cancelados e não mexe nos planos de outro pedido', async t => {
  const b = cenario(); b.semear.pedido({ NUMERO: 101 }); b.semear.perfil({ NUMERO: 101 }); b.semear.item({ NUMERO: 101 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id: antigo } = await salvar(chamar);
  await chamar(`/corte/plano/${antigo}/cancelar`, 'POST');
  await salvar(chamar);
  const { id: outro } = await salvar(chamar, 101);
  const r = await excluir(chamar);
  assert.equal((await r.json()).qtdPlanos, 2);
  assert.deepEqual(b.estado.planos.map(p => p.id), [outro]);
});

test('excluir dados de pedido sem nenhum plano: 404', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { banco: b });
  assert.equal((await excluir(chamar)).status, 404);
  assert.equal((await excluir(chamar, 'abc')).status, 404);
  assert.deepEqual(b.estado.auditoria, []);
});

test('excluir dados de pedido que já não existe (apagado no VB): funciona, é a saída para plano órfão', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  await salvar(chamar);
  b.estado.pedidos.length = 0;   // o pedido sumiu do banco
  assert.equal((await excluir(chamar)).status, 200);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'disponivel');
});

test('plano conferido: exige confirmação reforçada e permissão de parâmetros; retalhos do estoque permanecem', async t => {
  const b = cenario(); b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal((await chamar(`/corte/plano/${id}/confirmar`, 'POST', await corpoConfirmacao(chamar, id))).status, 200);
  const antes = b.estado.retalhos.map(r => ({ ...r }));
  const sem = await excluir(chamar);                                   // sem a confirmação reforçada
  assert.equal(sem.status, 409);
  assert.equal((await sem.json()).exigeConfirmacaoConferido, true);
  assert.equal(b.estado.planos.length, 1);
  const ok = await excluir(chamar, 100, { incluirConferidos: true });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).qtdConferidos, 1);
  assert.equal(b.estado.planos.length, 0);
  // o material físico não volta: retalho usado continua usado, sobras guardadas continuam disponíveis; só perdem a ligação com o plano
  assert.equal(b.estado.retalhos.length, antes.length);
  assert.deepEqual(b.estado.retalhos.map(r => r.situacao), antes.map(r => r.situacao));
  assert.ok(b.estado.retalhos.every(r => r.plano_origem == null && r.plano_reserva == null));
});

test('plano conferido: quem só planeja (sem corte.parametros) recebe 403 e nada é apagado', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { perfil: 'Planeja', banco: b });
  const { id } = await salvar(chamar);
  await chamar(`/corte/plano/${id}/confirmar`, 'POST', await corpoConfirmacao(chamar, id));
  assert.equal((await excluir(chamar, 100, { incluirConferidos: true })).status, 403);
  assert.equal(b.estado.planos.length, 1);
});

test('quem só planeja consegue excluir plano que não está conferido', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { perfil: 'Planeja', banco: b });
  await salvar(chamar);
  assert.equal((await excluir(chamar)).status, 200);
  assert.equal(b.estado.planos.length, 0);
});

test('excluir dados: sem corte.planejar dá 403', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { perfil: 'Só ver corte', banco: b });
  assert.equal((await excluir(chamar)).status, 403);
});
