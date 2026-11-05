// Etapas de produção: rotas /etapas/* (rotas/etapas_producao.js) com banco falso (test/apoio/bancoEtapas.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEtapas, bancoEtapas } = require('./apoio/bancoEtapas');
const { hojeLocal } = require('../rotas/transacao');
const { REGEX_VALOR } = require('../seguranca/valores');

const PUT = (n, etapa) => `/etapas/pedido/${n}/${etapa}`;
const okEm = (banco, etapas, numero = 100) => { for (const etapa of etapas) banco.semear.etapa({ numero, etapa, estado: 'ok' }); };
const cincoAnteriores = ['perfil_cortado', 'vidro_cortado', 'perfil_pintado', 'vidro_pintado', 'portas_montadas'];
const linhaDe = (banco, etapa, numero = 100) => banco.estado.etapas.find(e => e.numero === numero && e.etapa === etapa);
const camposDe = o => { const s = new Set(); (function anda(x) { if (Array.isArray(x)) x.forEach(anda); else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { s.add(k); anda(v); } })(o); return [...s]; };

// ---------- fila ----------
test('fila: só pedidos em produção, com as 6 etapas, progresso e N/A automático; sem dinheiro', async t => {
  const banco = bancoEtapas();
  banco.semear.completo({ NUMERO: 100, DATA_PRONTO: '2020-01-10' });                         // atrasado
  banco.semear.pedido({ NUMERO: 101, DATA_PRONTO: '2099-01-01' }); banco.semear.perfil({ NUMERO: 101 }); banco.semear.item({ NUMERO: 101 });   // só perfil: vidro N/A
  banco.semear.pedido({ NUMERO: 102, SITUACAO: 'Pronto' });
  banco.semear.pedido({ NUMERO: 103, SITUACAO: 'Entregue' });
  banco.semear.pedido({ NUMERO: 104, SITUACAO: 'Cancelado' });
  banco.semear.pedido({ NUMERO: 105, TIPO: 'Orçamento', SITUACAO: 'Em Produção' });
  okEm(banco, ['perfil_cortado', 'portas_montadas'], 100);
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Cortador' });
  const r = await chamar('/etapas/fila');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.filtro, 'producao');
  assert.deepEqual(d.pedidos.map(p => p.numero), [100, 101], 'Pronto, Entregue, Cancelado e orçamento ficam fora; atrasado primeiro');
  const [p100, p101] = d.pedidos;
  assert.equal(p100.atrasado, true); assert.equal(p101.atrasado, false);
  assert.equal(p100.cliente, 'Cliente X'); assert.equal(p100.clienteFinal, 'Final Y'); assert.equal(p100.prontoEm, '2020-01-10');
  assert.deepEqual(p100.etapas.map(e => e.estado), ['ok', 'pendente', 'pendente', 'pendente', 'ok', 'pendente']);
  assert.deepEqual([p100.qtdConcluidas, p100.qtdEtapas], [2, 6]);
  assert.deepEqual(p101.etapas.map(e => e.estado), ['pendente', 'na', 'pendente', 'na', 'pendente', 'pendente']);
  assert.equal(p101.etapas[1].automatico, true);
  assert.deepEqual(d.podeMarcar, ['perfil_cortado']);
  assert.deepEqual(d.etapas.map(e => e.codigo), ['perfil_cortado', 'vidro_cortado', 'perfil_pintado', 'vidro_pintado', 'portas_montadas', 'finalizado']);
  assert.ok(d.versao && typeof d.versao === 'string');
  for (const c of camposDe(d)) assert.doesNotMatch(c, REGEX_VALOR, `campo ${c} parece dinheiro`);
  assert.ok(!JSON.stringify(d).includes('999'), 'o TOTAL do pedido nunca sai');
});

test('fila: "abertos" inclui Pronto; versão igual responde { inalterado }; filtro inválido 400', async t => {
  const banco = bancoEtapas();
  banco.semear.completo({ NUMERO: 100 }); banco.semear.pedido({ NUMERO: 102, SITUACAO: 'Pronto', DATA_PRONTO: '2099-01-01' });
  const { chamar } = await prepararEtapas(t, { banco });
  const d = await (await chamar('/etapas/fila?situacao=abertos')).json();
  assert.deepEqual(d.pedidos.map(p => p.numero), [102, 100]);
  const de = await (await chamar(`/etapas/fila?situacao=abertos&versao=${d.versao}`)).json();
  assert.deepEqual(de, { inalterado: true, versao: d.versao });
  banco.semear.etapa({ numero: 100, etapa: 'perfil_pintado' });
  const mudou = await (await chamar(`/etapas/fila?situacao=abertos&versao=${d.versao}`)).json();
  assert.ok(Array.isArray(mudou.pedidos) && mudou.versao !== d.versao);
  assert.equal((await chamar('/etapas/fila?situacao=todos')).status, 400);
});

test('fila: estados do usuário filtram pelo cliente (INNER JOIN só com restrição); sem etapas.ver = 403', async t => {
  const banco = bancoEtapas();
  banco.semear.completo({ NUMERO: 100, RAZAO_SOCIAL: 'Cliente RJ' }); banco.semear.completo({ NUMERO: 101, RAZAO_SOCIAL: 'Cliente SP' });
  banco.semear.cliente({ RAZAO_SOCIAL: 'Cliente RJ', ESTADO: 'RJ' }); banco.semear.cliente({ RAZAO_SOCIAL: 'Cliente SP', ESTADO: 'SP' });
  let c = await prepararEtapas(t, { banco, estados: ['RJ'] });
  assert.deepEqual((await (await c.chamar('/etapas/fila')).json()).pedidos.map(p => p.numero), [100]);
  const consultas = banco.f.chamadas.filter(x => /FROM ped_orc p/.test(x.sql));
  assert.match(consultas[consultas.length - 1].sql, /INNER JOIN cadastro_clientes/);
  c = await prepararEtapas(t, { banco, perfil: 'Sem etapas' });
  assert.equal((await c.chamar('/etapas/fila')).status, 403);
});

test('fila: sem N+1 (uma consulta por tabela, qualquer que seja o número de pedidos)', async t => {
  const banco = bancoEtapas();
  for (let n = 100; n < 130; n++) banco.semear.completo({ NUMERO: n });
  const { chamar } = await prepararEtapas(t, { banco });
  const antes = banco.f.chamadas.length;
  assert.equal((await (await chamar('/etapas/fila')).json()).pedidos.length, 30);
  const feitas = banco.f.chamadas.slice(antes).map(c => c.sql);
  for (const re of [/FROM ped_orc p/, /FROM web_producao_etapas WHERE numero IN/, /FROM perfis WHERE NUMERO IN/, /FROM ped_orc_itens_v4 WHERE/, /FROM vidros WHERE NUMERO IN/,
    /FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN/, /FROM ped_orc_serralheria WHERE TIPO = 'Pedido' AND NUMERO IN/]) {
    assert.equal(feitas.filter(s => re.test(s)).length, 1, String(re));
  }
});

// ---------- serralheria ----------
test('fila: pedido só de serralheria = Perfil cortado, Perfil pintado e Finalizado pendentes; Vidro cortado/pintado e Portas montadas N/A (1/6 → 3/6)', async t => {
  const banco = bancoEtapas();
  banco.semear.soSerralheria({ NUMERO: 23378 });
  banco.semear.pedido({ NUMERO: 300 }); banco.semear.listaItem({ NUMERO: 300, ITEM: 1, TIPO_PRODUTO: 'Metalons' });   // só o sinal da lista (sem ped_orc_serralheria)
  banco.semear.pedido({ NUMERO: 301 }); banco.semear.listaItem({ NUMERO: 301, ITEM: 2, TIPO_PRODUTO: 'Estrutura' }); banco.semear.serralheria({ NUMERO: 301, ITEM_PEDIDO: 2 });   // só o sinal da tabela
  const { chamar } = await prepararEtapas(t, { banco });
  const d = await (await chamar('/etapas/fila')).json();
  for (const p of d.pedidos) {
    assert.deepEqual(p.etapas.map(e => e.estado), ['pendente', 'na', 'pendente', 'na', 'na', 'pendente'], String(p.numero));
    assert.equal(p.qtdConcluidas, 3);
  }
  assert.equal(d.pedidos.length, 3);
});

test('fila: pedido misto (porta com vidro + serralheria) = todas as etapas aplicáveis; só porta = como antes; sem itens = Portas montadas pendente', async t => {
  const banco = bancoEtapas();
  banco.semear.completo({ NUMERO: 100 }); banco.semear.listaItem({ NUMERO: 100, ITEM: 1 }); banco.semear.listaItem({ NUMERO: 100, ITEM: 2, TIPO_PRODUTO: 'Metalons' }); banco.semear.serralheria({ NUMERO: 100, ITEM_PEDIDO: 2 });
  banco.semear.pedido({ NUMERO: 101 }); banco.semear.perfil({ NUMERO: 101 }); banco.semear.item({ NUMERO: 101 }); banco.semear.listaItem({ NUMERO: 101 });   // porta sem vidro
  banco.semear.pedido({ NUMERO: 102 });   // sem itens
  const { chamar } = await prepararEtapas(t, { banco });
  const d = await (await chamar('/etapas/fila')).json();
  const de = n => d.pedidos.find(p => p.numero === n).etapas.map(e => e.estado);
  assert.deepEqual(de(100), ['pendente', 'pendente', 'pendente', 'pendente', 'pendente', 'pendente']);
  assert.deepEqual(de(101), ['pendente', 'na', 'pendente', 'na', 'pendente', 'pendente']);
  assert.deepEqual(de(102), ['na', 'na', 'na', 'na', 'pendente', 'pendente']);
});

test('serralheria: finalizar exige só Perfil cortado e Perfil pintado (o resto é N/A) e marca Pronto', async t => {
  const banco = bancoEtapas(); banco.semear.soSerralheria();
  okEm(banco, ['perfil_cortado']);
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  const r = await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' });
  assert.equal(r.status, 409);
  assert.deepEqual((await r.json()).pendentes, ['perfil_pintado']);
  okEm(banco, ['perfil_pintado']);
  assert.equal((await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' })).status, 200);
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Pronto');
});

// ---------- marcar / permissões ----------
test('marcar OK com a permissão da etapa: grava estado, origem manual, quem e o evento; idempotente', async t => {
  const banco = bancoEtapas(); banco.semear.completo();
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Cortador' });
  const r = await chamar(PUT(100, 'perfil_cortado'), 'PUT', { estado: 'ok', observacao: 'serra 2' });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const d = await r.json();
  assert.equal(d.mudou, true); assert.equal(d.situacaoMudou, false); assert.equal(d.qtdConcluidas, 1);
  assert.equal(d.etapas[0].estado, 'ok'); assert.equal(d.etapas[0].usuario, 'Bia');
  const l = linhaDe(banco, 'perfil_cortado');
  assert.deepEqual([l.estado, l.origem, l.usuario, l.observacao], ['ok', 'manual', 'Bia', 'serra 2']);
  assert.equal(banco.estado.eventos.length, 1);
  assert.deepEqual([banco.estado.eventos[0].estado_antes, banco.estado.eventos[0].estado_depois, banco.estado.eventos[0].origem], ['pendente', 'ok', 'manual']);
  // de novo: nada muda
  const de = await (await chamar(PUT(100, 'perfil_cortado'), 'PUT', { estado: 'ok' })).json();
  assert.equal(de.mudou, false);
  assert.equal(banco.estado.eventos.length, 1);
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Em Produção', 'etapa comum nunca mexe na situação');
});

test('permissão por etapa: outra etapa 403, sem etapas.ver 403; etapas.gerir mexe em todas', async t => {
  const banco = bancoEtapas(); banco.semear.completo();
  let c = await prepararEtapas(t, { banco, perfil: 'Cortador' });
  assert.equal((await c.chamar(PUT(100, 'vidro_pintado'), 'PUT', { estado: 'ok' })).status, 403);
  assert.equal((await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' })).status, 403);
  c = await prepararEtapas(t, { banco, perfil: 'Sem etapas' });
  assert.equal((await c.chamar(PUT(100, 'perfil_cortado'), 'PUT', { estado: 'ok' })).status, 403);
  c = await prepararEtapas(t, { banco, perfil: 'Pintor de vidro' });
  assert.equal((await c.chamar(PUT(100, 'vidro_pintado'), 'PUT', { estado: 'na' })).status, 200);
  assert.equal(banco.estado.etapas.length, 1);
  c = await prepararEtapas(t, { banco, perfil: 'Gerente sem situação' });
  for (const etapa of ['perfil_cortado', 'vidro_cortado', 'perfil_pintado', 'portas_montadas']) assert.equal((await c.chamar(PUT(100, etapa), 'PUT', { estado: 'ok' })).status, 200, etapa);
});

test('validação: pedido, etapa, estado e corpo inválidos = 400 sem gravar; inexistente 404; cancelado/entregue 409; fora dos estados 403', async t => {
  const banco = bancoEtapas(); banco.semear.completo();
  banco.semear.pedido({ NUMERO: 200, SITUACAO: 'Cancelado' }); banco.semear.pedido({ NUMERO: 201, SITUACAO: 'Entregue' });
  let c = await prepararEtapas(t, { banco });
  assert.equal((await c.chamar(PUT('abc', 'perfil_cortado'), 'PUT', { estado: 'ok' })).status, 400);
  assert.equal((await c.chamar(PUT(100, 'lixar'), 'PUT', { estado: 'ok' })).status, 400);
  assert.equal((await c.chamar(PUT(100, 'perfil_cortado'), 'PUT', { estado: 'feito' })).status, 400);
  assert.equal((await c.chamar(PUT(100, 'perfil_cortado'), 'PUT', { estado: 'ok', observacao: 'x'.repeat(501) })).status, 400);
  assert.equal((await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok', dataPronto: 'amanha' })).status, 400);
  assert.equal((await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'na' })).status, 400);
  assert.equal((await c.chamar(PUT(999, 'perfil_cortado'), 'PUT', { estado: 'ok' })).status, 404);
  assert.equal((await c.chamar(PUT(200, 'perfil_cortado'), 'PUT', { estado: 'ok' })).status, 409);
  assert.equal((await c.chamar(PUT(201, 'perfil_cortado'), 'PUT', { estado: 'ok' })).status, 409);
  assert.equal(banco.estado.etapas.length, 0);
  banco.semear.cliente({ RAZAO_SOCIAL: 'Cliente X', ESTADO: 'SP' });
  c = await prepararEtapas(t, { banco, estados: ['RJ'] });
  assert.equal((await c.chamar(PUT(100, 'perfil_cortado'), 'PUT', { estado: 'ok' })).status, 403);
  assert.equal(banco.estado.etapas.length, 0);
});

test('com o finalizado OK, uma etapa anterior não volta a pendente (409)', async t => {
  const banco = bancoEtapas(); banco.semear.completo({ SITUACAO: 'Pronto' });
  okEm(banco, [...cincoAnteriores, 'finalizado']);
  const { chamar } = await prepararEtapas(t, { banco });
  const r = await chamar(PUT(100, 'portas_montadas'), 'PUT', { estado: 'pendente' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Desfaça primeiro/);
});

// ---------- finalizado ----------
test('finalizar exige as anteriores OK/N/A (409 com a lista); N/A automático não trava', async t => {
  const banco = bancoEtapas();
  banco.semear.pedido(); banco.semear.perfil(); banco.semear.item();   // só perfil: vidro_cortado e vidro_pintado nascem N/A
  okEm(banco, ['perfil_cortado', 'perfil_pintado']);
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  const r = await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' });
  assert.equal(r.status, 409);
  assert.deepEqual((await r.json()).pendentes, ['portas_montadas']);
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Em Produção');
  okEm(banco, ['portas_montadas']);
  const ok = await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' });
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Pronto');
});

test('finalizar grava SITUACAO = Pronto pela regra do menu (DATA_ENTREGA limpa, DATA_PRONTO mantida), audita e dispara a fila de Entregas', async t => {
  const banco = bancoEtapas(); banco.semear.completo({ DATA_PRONTO: '2026-10-20', DATA_ENTREGA: '2026-10-01' });
  okEm(banco, cincoAnteriores);
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  const r = await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const d = await r.json();
  assert.equal(d.situacao, 'Pronto'); assert.equal(d.situacaoMudou, true); assert.equal(d.qtdConcluidas, 6); assert.equal(d.dataPronto, '2026-10-20');
  const p = banco.estado.pedidos[0];
  assert.deepEqual([p.SITUACAO, p.DATA_PRONTO, p.DATA_ENTREGA], ['Pronto', '2026-10-20', null]);
  const aud = banco.estado.auditoria.find(a => a.acao === 'pedido_situacao');
  assert.deepEqual(aud.detalhe, { cliente: 'Cliente X', de: 'Em Produção', para: 'Pronto', origem: 'etapas_producao' });
  assert.equal(aud.alvo, 'Pedido 100');
  assert.ok(!banco.estado.auditoria.some(a => a.acao === 'data_pronto_alterada'));
  assert.deepEqual(banco.estado.entregas.map(e => [e.numero, e.status]), [[100, 'a_programar']], 'sincronizarFila rodou depois do commit');
  // idempotente: de novo não muda nada nem audita de novo
  const de = await (await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' })).json();
  assert.equal(de.mudou, false);
  assert.equal(banco.estado.auditoria.filter(a => a.acao === 'pedido_situacao').length, 1);
});

test('finalizar com dataPronto = hoje grava DATA_PRONTO de hoje (auditada como data_pronto_alterada)', async t => {
  const banco = bancoEtapas(); banco.semear.completo({ DATA_PRONTO: '2026-10-20' });
  okEm(banco, cincoAnteriores);
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  assert.equal((await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok', dataPronto: 'hoje' })).status, 200);
  assert.equal(banco.estado.pedidos[0].DATA_PRONTO, hojeLocal());
  const aud = banco.estado.auditoria.find(a => a.acao === 'data_pronto_alterada');
  assert.deepEqual(aud.detalhe, { cliente: 'Cliente X', de: '2026-10-20', para: hojeLocal(), origem: 'etapas_producao' });
});

test('pedido já Pronto: finalizar só marca a etapa (situação e auditoria intactas)', async t => {
  const banco = bancoEtapas(); banco.semear.completo({ SITUACAO: 'Pronto' });
  okEm(banco, cincoAnteriores);
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  const d = await (await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok', dataPronto: 'hoje' })).json();
  assert.equal(d.situacaoMudou, false);
  assert.equal(linhaDe(banco, 'finalizado').estado, 'ok');
  assert.ok(!banco.estado.auditoria.some(a => a.acao === 'pedido_situacao' || a.acao === 'data_pronto_alterada'));
  assert.equal(banco.estado.pedidos[0].DATA_PRONTO, '2099-12-01');
});

test('finalizado já OK com o pedido de volta em produção: OK de novo marca Pronto outra vez', async t => {
  const banco = bancoEtapas(); banco.semear.completo();
  okEm(banco, [...cincoAnteriores, 'finalizado']);
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  const d = await (await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' })).json();
  assert.equal(d.mudou, true); assert.equal(d.situacaoMudou, true);
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Pronto');
  assert.equal(banco.estado.eventos.length, 0, 'a etapa já estava OK: nenhum evento novo');
});

test('forçar o finalizado: só com etapas.gerir (403 para etapas.finalizar); fica registrado no evento', async t => {
  const banco = bancoEtapas(); banco.semear.completo();
  let c = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  assert.equal((await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok', forcar: true })).status, 403);
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Em Produção');
  c = await prepararEtapas(t, { banco, perfil: 'Gerente sem situação' });
  const r = await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok', forcar: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).forcado, true);
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Pronto');
  const ev = banco.estado.eventos.find(e => e.etapa === 'finalizado');
  assert.deepEqual(JSON.parse(ev.detalhe).pendentes, cincoAnteriores);
  assert.equal(JSON.parse(ev.detalhe).forcado, true);
});

test('desfazer o finalizado: por padrão a situação continua Pronto; voltarParaProducao exige pedidos.situacao e entrega não agendada', async t => {
  const banco = bancoEtapas(); banco.semear.completo({ SITUACAO: 'Pronto' });
  okEm(banco, [...cincoAnteriores, 'finalizado']);
  let c = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  assert.equal((await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'pendente', voltarParaProducao: true })).status, 403);
  assert.equal(linhaDe(banco, 'finalizado').estado, 'ok', 'nada gravado');
  const d = await (await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'pendente' })).json();
  assert.equal(d.mudou, true); assert.equal(d.situacaoMudou, false);
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Pronto');
  // voltar para Em Produção com entrega agendada: recusado
  banco.estado.entregas.push({ id: 9, numero: 100, status: 'agendada' });
  c = await prepararEtapas(t, { banco, perfil: 'Finalizador com situação' });
  const r = await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'pendente', voltarParaProducao: true });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /entrega/);
  banco.estado.entregas[0].status = 'a_programar';
  const ok = await (await c.chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'pendente', voltarParaProducao: true })).json();
  assert.equal(ok.situacaoMudou, true); assert.equal(ok.situacao, 'Em Produção');
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Em Produção');
  assert.deepEqual(banco.estado.auditoria.filter(a => a.acao === 'pedido_situacao').map(a => [a.detalhe.de, a.detalhe.para]), [['Pronto', 'Em Produção']]);
});

test('falha no meio da transação desfaz tudo (situação e etapa)', async t => {
  const banco = bancoEtapas(); banco.semear.completo();
  okEm(banco, cincoAnteriores);
  banco.regras.unshift([/^INSERT INTO web_producao_etapas_eventos/, () => { throw new Error('disco cheio'); }]);
  const { chamar } = await prepararEtapas(t, { banco, perfil: 'Finalizador' });
  assert.equal((await chamar(PUT(100, 'finalizado'), 'PUT', { estado: 'ok' })).status, 500);
  assert.equal(banco.estado.pedidos[0].SITUACAO, 'Em Produção');
  assert.equal(linhaDe(banco, 'finalizado'), undefined);
  assert.equal(banco.estado.entregas.length, 0);
});

// ---------- histórico ----------
test('histórico: eventos do pedido (filtro por etapa), mais novo primeiro; etapa inválida 400; pedido inexistente 404', async t => {
  const banco = bancoEtapas(); banco.semear.completo();
  const { chamar } = await prepararEtapas(t, { banco });
  await chamar(PUT(100, 'perfil_cortado'), 'PUT', { estado: 'ok' });
  await chamar(PUT(100, 'perfil_cortado'), 'PUT', { estado: 'pendente' });
  await chamar(PUT(100, 'portas_montadas'), 'PUT', { estado: 'na', observacao: 'sem porta' });
  const d = await (await chamar('/etapas/pedido/100/historico?etapa=perfil_cortado')).json();
  assert.deepEqual(d.eventos.map(e => [e.estadoAntes, e.estadoDepois]), [['ok', 'pendente'], ['pendente', 'ok']]);
  assert.equal(d.eventos[0].nome, 'Perfil cortado'); assert.equal(d.eventos[0].usuario, 'Bia');
  const todos = await (await chamar('/etapas/pedido/100/historico')).json();
  assert.equal(todos.eventos.length, 3); assert.equal(todos.eventos[0].observacao, 'sem porta');
  assert.equal((await chamar('/etapas/pedido/100/historico?etapa=xx')).status, 400);
  assert.equal((await chamar('/etapas/pedido/555/historico')).status, 404);
});
