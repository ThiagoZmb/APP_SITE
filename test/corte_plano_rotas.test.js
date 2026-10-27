// Rotas do plano de corte de um pedido (banco simulado em test/apoio/bancoCorte.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoCorte, prepararCorte } = require('./apoio/bancoCorte');
const { REGEX_VALOR } = require('../seguranca/valores');

const nomesDeCampo = dados => {
  const nomes = new Set();
  const varrer = d => { if (Array.isArray(d)) d.forEach(varrer); else if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) { nomes.add(k); varrer(v); } };
  varrer(dados);
  return [...nomes];
};

// pedido 100: 2 portas de P100 Anodizado/Natural → 4 peças de 2100 e 4 de 900
function cenario(b = bancoCorte()) { b.semear.pedido(); b.semear.perfil(); b.semear.item(); return b; }
const prever = async (chamar, n = 100) => (await chamar(`/corte/pedido/${n}`)).json();
const corpoSalvar = p => ({ impressao: p.impressao, retalhosUsados: p.retalhosUsados });
const barrasDe = j => j.plano.grupos.flatMap(g => g.barras);
const escritas = banco => banco.f.chamadas.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql) && !/web_auditoria/.test(c.sql));
const salvar = async (chamar, n = 100) => (await chamar(`/corte/pedido/${n}/salvar`, 'POST', corpoSalvar(await prever(chamar, n)))).json();

test('pré-visualização: pedido sem perfis tem estado vazio explicado; pedido inexistente dá 404; nada é gravado', async t => {
  const b = bancoCorte(); b.semear.pedido({ NUMERO: 100 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const r = await chamar('/corte/pedido/100');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.vazio, true);
  assert.match(j.mensagem, /perfis/i);
  assert.deepEqual(j.plano.grupos, []);
  assert.equal((await chamar('/corte/pedido/999')).status, 404);
  assert.equal((await chamar('/corte/pedido/abc')).status, 404);
  assert.deepEqual(escritas(b), []);
});

test('pré-visualização: calcula peças e plano, usa retalho compatível e não escreve nada', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  b.semear.retalho({ comprimento: 3000, cor: 'Preto' });   // outra cor: nunca entra
  const { chamar } = await prepararCorte(t, { banco: b });
  const j = await prever(chamar);
  assert.equal(j.vazio, false);
  assert.equal(j.qtdPecas, 8);
  assert.deepEqual(j.pendencias, []);
  assert.deepEqual(j.retalhosUsados, [ret.id]);
  assert.equal(j.plano.resumo.qtdRetalhosUsados, 1);
  assert.equal(j.planoSalvo, null);
  assert.match(j.impressao, /^[0-9a-f]{64}$/);
  assert.equal(barrasDe(j).flatMap(x => x.pecas).length, 8);
  assert.deepEqual(escritas(b), []);
});

test('pré-visualização: dado ausente aparece como pendência e fica fora do plano', async t => {
  const b = cenario(); b.estado.itens[0].COR_PERFIL = null;
  const { chamar } = await prepararCorte(t, { banco: b });
  const j = await prever(chamar);
  assert.equal(j.qtdPecas, 0);
  assert.equal(j.pendencias.length, 1);
});

test('salvar: grava o plano e reserva os retalhos usados, com auditoria', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const r = await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(await prever(chamar)));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(b.estado.planos.length, 1);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'reservado');
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).plano_reserva, j.id);
  assert.ok(b.estado.auditoria.some(a => a.acao === 'corte_plano_salvo'));
  assert.equal((await prever(chamar)).planoSalvo.id, j.id);
});

test('salvar com pedido alterado desde a pré-visualização: 409 e nada gravado', async t => {
  const b = cenario(); b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const previa = await prever(chamar);
  b.estado.perfis[0].TAM_ALTURA = 2000;
  const r = await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(previa));
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /recalcul/i);
  assert.equal(b.estado.planos.length, 0);
  assert.equal(b.estado.retalhos[0].situacao, 'disponivel');
});

test('dois planos disputando o mesmo retalho: o segundo salvar dá 409 e não reserva nada', async t => {
  const b = cenario(); b.semear.pedido({ NUMERO: 101 }); b.semear.perfil({ NUMERO: 101 }); b.semear.item({ NUMERO: 101 });
  const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const previa100 = await prever(chamar, 100), previa101 = await prever(chamar, 101);
  assert.deepEqual(previa101.retalhosUsados, [ret.id]);
  assert.equal((await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(previa100))).status, 200);
  const r = await chamar('/corte/pedido/101/salvar', 'POST', corpoSalvar(previa101));
  assert.equal(r.status, 409);
  assert.equal(b.estado.planos.length, 1);
  assert.equal(b.estado.retalhos[0].plano_reserva, b.estado.planos[0].id);
});

test('salvar de novo substitui o plano gerado e move a reserva; plano conferido não é substituído', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const primeiro = await salvar(chamar), segundo = await salvar(chamar);
  assert.notEqual(primeiro.id, segundo.id);
  assert.equal(b.estado.planos.find(p => p.id === primeiro.id).situacao, 'cancelado');
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).plano_reserva, segundo.id);
  assert.equal((await chamar(`/corte/plano/${segundo.id}/confirmar`, 'POST', {})).status, 200);
  const r = await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(await prever(chamar)));
  assert.equal(r.status, 409);
});

test('salvar sem peças para planejar: 409', async t => {
  const b = cenario(); b.estado.itens[0].COR_PERFIL = '';
  const { chamar } = await prepararCorte(t, { banco: b });
  assert.equal((await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(await prever(chamar)))).status, 409);
  assert.equal(b.estado.planos.length, 0);
});

test('pedido cancelado não recebe plano salvo', async t => {
  const b = cenario(); b.estado.pedidos[0].SITUACAO = 'Cancelado';
  const { chamar } = await prepararCorte(t, { banco: b });
  assert.equal((await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(await prever(chamar)))).status, 409);
});

test('ler o plano: "desatualizado" quando o pedido mudou; marcar peça cortada guarda o progresso', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  let j = await (await chamar(`/corte/plano/${id}`)).json();
  assert.equal(j.situacao, 'gerado');
  assert.deepEqual(j.cortadas, []);
  const grupo = j.plano.grupos[0].chave;
  assert.equal((await chamar(`/corte/plano/${id}/pecas`, 'PUT', { grupo, barra: 0, peca: 0, cortada: true })).status, 200);
  assert.equal((await chamar(`/corte/plano/${id}/pecas`, 'PUT', { grupo, barra: 0, peca: 0, cortada: true })).status, 200);   // idempotente
  j = await (await chamar(`/corte/plano/${id}`)).json();
  assert.deepEqual(j.cortadas, [{ grupo, barra: 0, peca: 0 }]);
  assert.equal((await chamar(`/corte/plano/${id}/pecas`, 'PUT', { grupo, barra: 99, peca: 0, cortada: true })).status, 400);
  assert.equal((await chamar(`/corte/plano/${id}/pecas`, 'PUT', { grupo, barra: 0, peca: 0, cortada: false })).status, 200);
  assert.deepEqual((await (await chamar(`/corte/plano/${id}`)).json()).cortadas, []);
  b.estado.perfis[0].TAM_LARGURA = 800;
  j = await (await chamar(`/corte/plano/${id}`)).json();
  assert.equal(j.situacao, 'desatualizado');
  assert.equal((await chamar('/corte/plano/999')).status, 404);
});

test('confirmar: retalho usado vira usado, sobras que merecem viram retalhos novos, plano conferido, auditoria', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const previa = await prever(chamar);
  const guardar = barrasDe(previa).filter(x => x.destinoSobra === 'guardar');
  const { id } = await (await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(previa))).json();
  const r = await chamar(`/corte/plano/${id}/confirmar`, 'POST', {});
  assert.equal(r.status, 200);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'usado');
  const novos = b.estado.retalhos.filter(x => x.plano_origem === id);
  assert.equal(novos.length, guardar.length);
  assert.ok(novos.every(x => x.situacao === 'disponivel' && x.perfil === 'P100' && x.acabamento === 'Anodizado' && x.cor === 'Natural'));
  assert.deepEqual(novos.map(x => x.comprimento).sort((a, c) => a - c), guardar.map(x => x.sobra).sort((a, c) => a - c));
  assert.equal(b.estado.planos[0].situacao, 'conferido');
  assert.ok(b.estado.auditoria.some(a => a.acao === 'corte_plano_conferido'));
});

test('confirmar duas vezes: a segunda é recusada (409) e não duplica retalhos', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal((await chamar(`/corte/plano/${id}/confirmar`, 'POST', {})).status, 200);
  const antes = b.estado.retalhos.length;
  assert.equal((await chamar(`/corte/plano/${id}/confirmar`, 'POST', {})).status, 409);
  assert.equal(b.estado.retalhos.length, antes);
});

test('confirmar com medida real maior que a calculada, ou abaixo da sobra mínima: 400 e nada muda', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const previa = await prever(chamar);
  const { id } = await (await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(previa))).json();
  const grupo = previa.plano.grupos[0].chave;
  const idx = previa.plano.grupos[0].barras.findIndex(x => x.destinoSobra === 'guardar');
  const sobra = previa.plano.grupos[0].barras[idx].sobra;
  let r = await chamar(`/corte/plano/${id}/confirmar`, 'POST', { sobras: [{ grupo, barra: idx, destino: 'guardar', medidaReal: sobra + 1 }] });
  assert.equal(r.status, 400);
  r = await chamar(`/corte/plano/${id}/confirmar`, 'POST', { sobras: [{ grupo, barra: idx, destino: 'guardar', medidaReal: 499 }] });   // sobra mínima padrão = 500
  assert.equal(r.status, 400);
  assert.equal(b.estado.planos[0].situacao, 'gerado');
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'reservado');
  assert.equal(b.estado.retalhos.length, 1);
});

test('confirmar: retalho informado como não usado volta a ficar disponível', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal((await chamar(`/corte/plano/${id}/confirmar`, 'POST', { retalhosNaoUsados: [999] })).status, 400);   // não pertence ao plano
  assert.equal((await chamar(`/corte/plano/${id}/confirmar`, 'POST', { retalhosNaoUsados: [ret.id] })).status, 200);
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'disponivel');
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).plano_reserva, null);
});

test('cancelar o plano libera as reservas; cancelar de novo ou plano inexistente', async t => {
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal((await chamar(`/corte/plano/${id}/cancelar`, 'POST')).status, 200);
  assert.equal(b.estado.planos[0].situacao, 'cancelado');
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'disponivel');
  assert.equal((await chamar(`/corte/plano/${id}/cancelar`, 'POST')).status, 409);
  assert.equal((await chamar('/corte/plano/999/cancelar', 'POST')).status, 404);
});

test('sem corte.planejar: salvar, marcar, confirmar e cancelar dão 403; ver continua permitido', async t => {
  const b = cenario();
  const { chamar } = await prepararCorte(t, { perfil: 'Só ver corte', banco: b });
  assert.equal((await chamar('/corte/pedido/100')).status, 200);
  for (const [caminho, metodo] of [['/corte/pedido/100/salvar', 'POST'], ['/corte/plano/1/pecas', 'PUT'], ['/corte/plano/1/confirmar', 'POST'], ['/corte/plano/1/cancelar', 'POST']]) {
    assert.equal((await chamar(caminho, metodo, {})).status, 403, caminho);
  }
  assert.deepEqual(escritas(b), []);
});

test('liberarPlanosDoPedido (cancelar/excluir pedido): cancela planos gerados e libera as reservas', async t => {
  const { liberarPlanosDoPedido } = require('../rotas/corte');
  const b = cenario(); const ret = b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  const conn = await b.f.getConnection();
  assert.equal(await liberarPlanosDoPedido(conn, 100, 'Caio'), 1);
  assert.equal(b.estado.planos.find(p => p.id === id).situacao, 'cancelado');
  assert.equal(b.estado.retalhos.find(x => x.id === ret.id).situacao, 'disponivel');
  assert.equal(await liberarPlanosDoPedido(conn, 100, 'Caio'), 0);
});

test('nomes de campo das respostas do plano não casam com REGEX_VALOR', async t => {
  const b = cenario(); b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const previa = await prever(chamar);
  const { id } = await (await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(previa))).json();
  const nomes = [...nomesDeCampo(previa), ...nomesDeCampo(await (await chamar(`/corte/plano/${id}`)).json())];
  assert.ok(nomes.length > 20);
  assert.deepEqual(nomes.filter(k => REGEX_VALOR.test(k)), []);
});

// ---- revisão final (I2): o número do pedido excluído é reaproveitado (MAX+1) ----
test('excluir o pedido solta o plano conferido (histórico preservado); cancelar o pedido não', async t => {
  const { liberarPlanosDoPedido } = require('../rotas/corte');
  const b = cenario(); b.semear.retalho({ comprimento: 2200 });
  const { chamar } = await prepararCorte(t, { banco: b });
  const { id } = await salvar(chamar);
  assert.equal((await chamar(`/corte/plano/${id}/confirmar`, 'POST', {})).status, 200);
  const conn = await b.f.getConnection();
  await liberarPlanosDoPedido(conn, 100, 'Caio');                          // cancelar o pedido: o plano conferido continua ligado
  assert.equal((await prever(chamar)).planoSalvo.id, id);
  await liberarPlanosDoPedido(conn, 100, 'Caio', { excluindo: true });     // excluir o pedido: o número fica livre para o próximo
  assert.equal((await prever(chamar)).planoSalvo, null);
  assert.equal((await chamar('/corte/pedido/100/salvar', 'POST', corpoSalvar(await prever(chamar)))).status, 200);
  assert.ok(b.estado.planos.find(p => p.id === id).excluido_em);           // o registro antigo continua no banco
});
