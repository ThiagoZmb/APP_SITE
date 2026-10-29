// Rotas do plano de corte (banco simulado em test/apoio/bancoCorte.js).
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

// ---------- parâmetros e retalhos ----------
test('permissões: sem corte.ver dá 403 nas leituras; sem corte.parametros dá 403 nas escritas de parâmetros e retalhos', async t => {
  for (const perfil of ['Sem acesso', 'Só planejar', 'Só parâmetros']) {
    const { chamar } = await prepararCorte(t, { perfil });
    assert.equal((await chamar('/corte/config')).status, 403, perfil);
    assert.equal((await chamar('/corte/retalhos')).status, 403, perfil);
  }
  const { chamar, banco } = await prepararCorte(t, { perfil: 'Planeja' });
  assert.equal((await chamar('/corte/config')).status, 200);
  assert.equal((await chamar('/corte/config', 'PUT', { comprimentoVara: 6000, serra: 3, sobraMinima: 500 })).status, 403);
  assert.equal((await chamar('/corte/retalhos', 'POST', { perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 1000 })).status, 403);
  banco.semear.retalho();
  assert.equal((await chamar('/corte/retalhos/1', 'PUT', { perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 1000 })).status, 403);
  assert.equal((await chamar('/corte/retalhos/1/descartar', 'POST')).status, 403);
  assert.equal(banco.estado.config.length, 0);
});

test('config: sem linhas devolve o padrão 6000/3/500; o padrão gravado substitui e não duplica', async t => {
  const { chamar, banco } = await prepararCorte(t);
  let j = await (await chamar('/corte/config')).json();
  assert.deepEqual(j.padrao, { comprimentoVara: 6000, serra: 3, sobraMinima: 500 });
  assert.deepEqual(j.excecoes, []);
  const r = await chamar('/corte/config', 'PUT', { comprimentoVara: 6200, serra: 4, sobraMinima: 400 });
  assert.equal(r.status, 200);
  await chamar('/corte/config', 'PUT', { comprimentoVara: 6100, serra: 4, sobraMinima: 400 });
  assert.equal(banco.estado.config.length, 1);
  j = await (await chamar('/corte/config')).json();
  assert.deepEqual(j.padrao, { comprimentoVara: 6100, serra: 4, sobraMinima: 400 });
  assert.equal(banco.estado.auditoria.filter(a => a.acao === 'corte_config_alterada').length, 2);
});

test('config: exceção por perfil herda os campos em branco e aparece na lista de exceções', async t => {
  const { chamar } = await prepararCorte(t);
  await chamar('/corte/config', 'PUT', { comprimentoVara: 6000, serra: 3, sobraMinima: 500 });
  assert.equal((await chamar('/corte/config', 'PUT', { perfil: 'P7', comprimentoVara: 3000 })).status, 200);
  const j = await (await chamar('/corte/config')).json();
  assert.deepEqual(j.excecoes, [{ perfil: 'P7', comprimentoVara: 3000, serra: null, sobraMinima: null }]);
  assert.equal(j.padrao.comprimentoVara, 6000);
});

test('config inválida: 400 com mensagem e nada gravado', async t => {
  const { chamar, banco } = await prepararCorte(t);
  for (const ruim of [{ comprimentoVara: 0, serra: 3, sobraMinima: 500 }, { comprimentoVara: 6000, serra: -1, sobraMinima: 500 }, { comprimentoVara: 'x', serra: 3, sobraMinima: 500 }, { perfil: 'P7' }]) {
    const r = await chamar('/corte/config', 'PUT', ruim);
    assert.equal(r.status, 400, JSON.stringify(ruim));
    assert.ok((await r.json()).error);
  }
  assert.equal(banco.estado.config.length, 0);
  assert.equal(banco.estado.auditoria.length, 0);
});

test('retalho manual válido entra disponível, é auditado e aparece na lista (com filtro por situação)', async t => {
  const { chamar, banco } = await prepararCorte(t);
  const r = await chamar('/corte/retalhos', 'POST', { perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural', comprimento: 1850 });
  assert.equal(r.status, 200);
  const criado = await r.json();
  assert.equal(criado.situacao, 'disponivel');
  assert.equal(banco.estado.retalhos[0].criado_por, 'Caio');
  assert.deepEqual(banco.estado.auditoria.find(a => a.acao === 'corte_retalho_criado').detalhe.campos, ['perfil', 'acabamento', 'cor', 'comprimento']);
  banco.semear.retalho({ situacao: 'usado', comprimento: 700 });
  assert.equal((await (await chamar('/corte/retalhos')).json()).retalhos.length, 2);
  const so = (await (await chamar('/corte/retalhos?situacao=disponivel')).json()).retalhos;
  assert.deepEqual(so.map(x => x.comprimento), [1850]);
  assert.equal((await chamar('/corte/retalhos?situacao=qualquer')).status, 400);
});

test('retalho inválido: 400 e nada gravado', async t => {
  const { chamar, banco } = await prepararCorte(t);
  assert.equal((await chamar('/corte/retalhos', 'POST', { perfil: '', acabamento: 'A', cor: 'C', comprimento: 1000 })).status, 400);
  assert.equal((await chamar('/corte/retalhos', 'POST', { perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 0 })).status, 400);
  assert.equal(banco.estado.retalhos.length, 0);
});

test('retalho disponível pode ser editado e descartado; reservado, usado ou descartado não (409); inexistente 404', async t => {
  const { chamar, banco } = await prepararCorte(t);
  const livre = banco.semear.retalho({ comprimento: 1500 });
  const r = await chamar(`/corte/retalhos/${livre.id}`, 'PUT', { perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural', comprimento: 1400 });
  assert.equal(r.status, 200);
  assert.equal(banco.estado.retalhos.find(x => x.id === livre.id).comprimento, 1400);
  assert.equal((await chamar(`/corte/retalhos/${livre.id}/descartar`, 'POST')).status, 200);
  assert.equal(banco.estado.retalhos.find(x => x.id === livre.id).situacao, 'descartado');
  for (const situacao of ['reservado', 'usado', 'descartado']) {
    const x = banco.semear.retalho({ situacao });
    assert.equal((await chamar(`/corte/retalhos/${x.id}`, 'PUT', { perfil: 'P100', acabamento: 'A', cor: 'C', comprimento: 100 })).status, 409, situacao);
    assert.equal((await chamar(`/corte/retalhos/${x.id}/descartar`, 'POST')).status, 409, situacao);
  }
  assert.equal((await chamar('/corte/retalhos/999', 'PUT', { perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 100 })).status, 404);
  assert.equal((await chamar('/corte/retalhos/999/descartar', 'POST')).status, 404);
});

test('nomes de campo das respostas não casam com REGEX_VALOR (usuário sem valores.ver não perde dados)', async t => {
  const { chamar, banco } = await prepararCorte(t);
  banco.semear.retalho();
  const nomes = [...nomesDeCampo(await (await chamar('/corte/config')).json()), ...nomesDeCampo(await (await chamar('/corte/retalhos')).json())];
  assert.ok(nomes.length > 5);
  assert.deepEqual(nomes.filter(k => REGEX_VALOR.test(k)), []);
});

test('app sobe com as rotas do plano de corte registradas (registro.verificar)', () => {
  const { registro } = require('../index.js');
  assert.doesNotThrow(() => registro.verificar());
});

test('GET /corte/pedidos: exige corte.ver, lista só pedidos não cancelados e sem campos de dinheiro', async t => {
  const sem = await prepararCorte(t, { perfil: 'Sem acesso' });
  assert.equal((await sem.chamar('/corte/pedidos')).status, 403);
  const { chamar, banco } = await prepararCorte(t, { perfil: 'Planeja' });
  banco.estado.pedidos.push({ NUMERO: 10, RAZAO_SOCIAL: 'A', SITUACAO: 'Em Produção' }, { NUMERO: 11, RAZAO_SOCIAL: 'B', SITUACAO: 'Cancelado' }, { NUMERO: 12, RAZAO_SOCIAL: 'C', SITUACAO: 'Pronto' });
  const r = await chamar('/corte/pedidos');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.pedidos.map(p => p.numero), [12, 10]);
  for (const n of nomesDeCampo(j)) assert.doesNotMatch(n, REGEX_VALOR, n);
});
