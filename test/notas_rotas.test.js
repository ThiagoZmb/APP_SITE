// Rotas das notas fiscais sem itens (banco simulado em test/apoio/bancoNotas.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoNotas, prepararNotas } = require('./apoio/bancoNotas');
const { REGEX_VALOR } = require('../seguranca/valores');

const ENTRADA = { tipo: 'entrada', numero: '000123', serie: '', dataEmissao: '2026-10-20', contraparteCodigo: 1, valorTotal: '1500,50', observacao: 'compra' };
const SAIDA = { tipo: 'saida', numero: '77', serie: '1', dataEmissao: '2026-10-21', contraparteCodigo: 1, valorTotal: '900', observacao: '' };
const criar = (chamar, corpo) => chamar('/notas_fiscais', 'POST', corpo);

test('notas: cria entrada e saída (nome copiado do cadastro, auditoria sem valor nem chave)', async t => {
  const { banco, chamar } = await prepararNotas(t);
  let r = await criar(chamar, ENTRADA);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.ok, j.id], [true, 1]);
  assert.equal(banco.notas[0].contraparte_nome, 'Alumínios Brasil');
  assert.equal(banco.notas[0].numero, '123');
  assert.equal(banco.notas[0].valor_total, '1500.50');
  assert.equal(banco.auditoria[0].acao, 'nota_fiscal_criada');
  assert.ok(!/1500|compra/.test(JSON.stringify(banco.auditoria[0])));
  r = await criar(chamar, SAIDA);
  assert.equal(r.status, 200);
  assert.equal(banco.notas[1].contraparte_nome, 'Construtora Alfa');
});

test('notas: 400 para contraparte inexistente, fornecedor "." e dados inválidos', async t => {
  const banco = bancoNotas(); banco.semear.fornecedor('.');
  const { chamar } = await prepararNotas(t, { banco });
  for (const m of [{ contraparteCodigo: 99 }, { contraparteCodigo: 2 }, { tipo: 'saida', contraparteCodigo: 99 }, { numero: 'abc' }, { valorTotal: '1.234,56' }, { dataEmissao: '2026-02-30' }]) {
    assert.equal((await criar(chamar, { ...ENTRADA, ...m })).status, 400, JSON.stringify(m));
  }
  assert.equal(banco.notas.length, 0);
});

test('notas: 409 em número repetido (zeros à esquerda) e em número de nota cancelada', async t => {
  const banco = bancoNotas();
  const { chamar } = await prepararNotas(t, { banco });
  assert.equal((await criar(chamar, ENTRADA)).status, 200);
  assert.equal((await criar(chamar, { ...ENTRADA, numero: '123' })).status, 409);
  assert.equal((await criar(chamar, { ...ENTRADA, numero: '124', chave: 'x' })).status, 400);
  // outra contraparte com o mesmo número é permitido
  banco.semear.fornecedor('Vidros Sul');
  assert.equal((await criar(chamar, { ...ENTRADA, contraparteCodigo: 2 })).status, 200);
  // cancelada continua ocupando o número
  assert.equal((await chamar('/notas_fiscais/1/cancelar', 'POST', { motivo: 'erro' })).status, 200);
  assert.equal((await criar(chamar, ENTRADA)).status, 409);
});

test('notas: chave válida repetida dá 409 e ER_DUP_ENTRY do banco também', async t => {
  const banco = bancoNotas();
  const { chaveValida } = require('../calculo/notas_fiscais');
  let base = '3326102345678900019055001000001234100000123', soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const chave = base + String(soma % 11 < 2 ? 0 : 11 - (soma % 11));
  assert.ok(chaveValida(chave));
  banco.semear.nota({ numero: '900', chave });
  const { chamar } = await prepararNotas(t, { banco });
  assert.equal((await criar(chamar, { ...ENTRADA, chave })).status, 409);
  banco.estado.falharInsertDuplicado = true;
  assert.equal((await criar(chamar, ENTRADA)).status, 409);
});

test('notas: sem valores.ver criar dá 403; ler não traz valorTotal; editar preserva o valor', async t => {
  const banco = bancoNotas(); const n = banco.semear.nota({ valor_total: '500.00' });
  const { chamar } = await prepararNotas(t, { banco, perfil: 'Notas' });
  assert.equal((await criar(chamar, ENTRADA)).status, 403);
  assert.equal(banco.notas.length, 1);
  assert.ok(!('valorTotal' in (await (await chamar('/notas_fiscais/' + n.id)).json()).nota));
  assert.ok(!('valorTotal' in (await (await chamar('/notas_fiscais')).json()).notas[0]));
  const r = await chamar('/notas_fiscais/' + n.id, 'PUT', { dataEmissao: '2026-10-11', observacao: 'novo', valorTotal: '9999' });
  assert.equal(r.status, 200);
  assert.equal(banco.notas[0].valor_total, '500.00');
  assert.equal(banco.notas[0].observacao, 'novo');
});

test('notas: PUT altera só data, valor e observação; auditoria com nomes dos campos; 404; cancelada dá 409', async t => {
  const banco = bancoNotas(); const n = banco.semear.nota({});
  const { chamar } = await prepararNotas(t, { banco });
  let r = await chamar('/notas_fiscais/' + n.id, 'PUT', { numero: '999', tipo: 'saida', chave: 'x', contraparteCodigo: 2, dataEmissao: '2026-10-10', valorTotal: '750,5', observacao: '' });
  assert.equal(r.status, 200);
  assert.deepEqual([banco.notas[0].numero, banco.notas[0].tipo, banco.notas[0].contraparte_codigo], ['100', 'entrada', 1]);
  assert.equal(banco.notas[0].valor_total, '750.50');
  const a = banco.auditoria.at(-1);
  assert.equal(a.acao, 'nota_fiscal_alterada');
  assert.deepEqual(a.detalhe.campos, ['valorTotal']);
  assert.equal((await chamar('/notas_fiscais/999', 'PUT', { dataEmissao: '2026-10-10', valorTotal: '1' })).status, 404);
  assert.equal((await chamar('/notas_fiscais/' + n.id, 'PUT', { dataEmissao: 'ruim', valorTotal: '1' })).status, 400);
  await chamar(`/notas_fiscais/${n.id}/cancelar`, 'POST', { motivo: 'x' });
  assert.equal((await chamar('/notas_fiscais/' + n.id, 'PUT', { dataEmissao: '2026-10-10', valorTotal: '1' })).status, 409);
});

test('notas: cancelar exige motivo, grava, audita sem o motivo e não repete', async t => {
  const banco = bancoNotas(); const n = banco.semear.nota({});
  const { chamar } = await prepararNotas(t, { banco });
  assert.equal((await chamar(`/notas_fiscais/${n.id}/cancelar`, 'POST', { motivo: ' ' })).status, 400);
  assert.equal((await chamar(`/notas_fiscais/${n.id}/cancelar`, 'POST', { motivo: 'lançada errada' })).status, 200);
  assert.deepEqual([banco.notas[0].situacao, banco.notas[0].motivo_cancelamento], ['cancelada', 'lançada errada']);
  const a = banco.auditoria.at(-1);
  assert.equal(a.acao, 'nota_fiscal_cancelada');
  assert.ok(!JSON.stringify(a).includes('lançada errada'));
  assert.equal((await chamar(`/notas_fiscais/${n.id}/cancelar`, 'POST', { motivo: 'de novo' })).status, 409);
  assert.equal((await chamar('/notas_fiscais/999/cancelar', 'POST', { motivo: 'x' })).status, 404);
});

test('notas: lista com filtros, busca (sem curinga em %), limite e detalhe', async t => {
  const banco = bancoNotas();
  banco.semear.nota({ numero: '10', data_emissao: '2026-09-01' });
  banco.semear.nota({ numero: '20', data_emissao: '2026-10-05', tipo: 'saida', contraparte_codigo: 1, contraparte_nome: 'Construtora Alfa' });
  banco.semear.nota({ numero: '30', data_emissao: '2026-10-15', situacao: 'cancelada' });
  const { chamar } = await prepararNotas(t, { banco });
  const lista = async q => (await (await chamar('/notas_fiscais' + q)).json());
  let j = await lista('');
  assert.deepEqual(j.notas.map(n => n.numero), ['30', '20', '10']);
  assert.equal(j.qtdNotas, 3);
  assert.deepEqual((await lista('?tipo=saida')).notas.map(n => n.numero), ['20']);
  assert.deepEqual((await lista('?de=2026-10-01&ate=2026-10-10')).notas.map(n => n.numero), ['20']);
  assert.deepEqual((await lista('?situacao=cancelada')).notas.map(n => n.numero), ['30']);
  assert.deepEqual((await lista('?q=alfa')).notas.map(n => n.numero), ['20']);
  assert.deepEqual((await lista('?q=20')).notas.map(n => n.numero), ['20']);
  assert.equal((await lista('?q=%25')).notas.length, 0);
  for (let i = 0; i < 205; i++) banco.semear.nota({ numero: String(1000 + i) });
  j = await lista('');
  assert.equal(j.notas.length, 200);
  assert.equal(j.limitada, true);
  const d = await (await chamar('/notas_fiscais/1')).json();
  assert.equal(d.nota.numero, '10');
  assert.equal((await chamar('/notas_fiscais/99999')).status, 404);
});

test('notas: usuário restrito a RJ não lança, lê nem lista saída de cliente de SP', async t => {
  const banco = bancoNotas();
  const sp = banco.estado.clientes.find(c => c.ESTADO === 'SP');
  const rj = banco.estado.clientes.find(c => c.ESTADO === 'RJ');
  const nSp = banco.semear.nota({ tipo: 'saida', contraparte_codigo: sp.CODIGO, numero: '1' });
  banco.semear.nota({ tipo: 'saida', contraparte_codigo: rj.CODIGO, numero: '2' });
  const { chamar } = await prepararNotas(t, { banco, estados: ['RJ'] });
  assert.equal((await criar(chamar, { ...SAIDA, contraparteCodigo: sp.CODIGO })).status, 403);
  assert.equal((await criar(chamar, { ...SAIDA, contraparteCodigo: rj.CODIGO })).status, 200);
  assert.equal(banco.notas.filter(n => n.numero === '77').length, 1);
  assert.equal((await chamar('/notas_fiscais/' + nSp.id)).status, 403);
  assert.equal((await chamar('/notas_fiscais/' + nSp.id, 'PUT', { dataEmissao: '2026-10-10', valorTotal: '1' })).status, 403);
  assert.equal((await chamar(`/notas_fiscais/${nSp.id}/cancelar`, 'POST', { motivo: 'x' })).status, 403);
  assert.deepEqual((await (await chamar('/notas_fiscais?tipo=saida')).json()).notas.map(n => n.numero).sort(), ['2', '77']);
});

test('notas: permissões — só ver lê e não grava; sem acesso dá 403', async t => {
  const banco = bancoNotas(); const n = banco.semear.nota({});
  let { chamar } = await prepararNotas(t, { banco, perfil: 'Somente ver notas' });
  assert.equal((await chamar('/notas_fiscais')).status, 200);
  assert.equal((await criar(chamar, ENTRADA)).status, 403);
  assert.equal((await chamar('/notas_fiscais/' + n.id, 'PUT', { dataEmissao: '2026-10-10', valorTotal: '1' })).status, 403);
  assert.equal((await chamar(`/notas_fiscais/${n.id}/cancelar`, 'POST', { motivo: 'x' })).status, 403);
});

test('notas: sem acesso', async t => {
  const { chamar } = await prepararNotas(t, { perfil: 'Sem acesso' });
  assert.equal((await chamar('/notas_fiscais')).status, 403);
  assert.equal((await chamar('/notas_fiscais/1')).status, 403);
});

test('notas: nenhum campo da resposta além de valorTotal casa com REGEX_VALOR', async t => {
  const banco = bancoNotas(); banco.semear.nota({});
  const { chamar } = await prepararNotas(t, { banco });
  const chaves = new Set();
  const varrer = o => { if (Array.isArray(o)) o.forEach(varrer); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { chaves.add(k); varrer(v); } };
  varrer(await (await chamar('/notas_fiscais')).json());
  varrer(await (await chamar('/notas_fiscais/1')).json());
  assert.deepEqual([...chaves].filter(k => REGEX_VALOR.test(k)), ['valorTotal']);
});

test('notas: contrapartes — fornecedores (sem ".") na entrada, clientes dos estados do usuário na saída', async t => {
  const banco = bancoNotas(); banco.semear.fornecedor('.'); banco.semear.fornecedor('Vidros Sul');
  let { chamar } = await prepararNotas(t, { banco });
  let j = await (await chamar('/notas_fiscais/contrapartes?tipo=entrada')).json();
  assert.deepEqual(j.contrapartes.map(c => c.nome), ['Alumínios Brasil', 'Vidros Sul']);
  assert.deepEqual(Object.keys(j.contrapartes[0]).sort(), ['codigo', 'nome']);
  j = await (await chamar('/notas_fiscais/contrapartes?tipo=saida')).json();
  assert.deepEqual(j.contrapartes.map(c => c.nome), ['Construtora Alfa', 'Obras Beta']);
  assert.equal((await chamar('/notas_fiscais/contrapartes?tipo=x')).status, 400);
});

test('notas: contrapartes de saída respeitam os estados do usuário', async t => {
  const { chamar } = await prepararNotas(t, { estados: ['SP'] });
  const j = await (await chamar('/notas_fiscais/contrapartes?tipo=saida')).json();
  assert.deepEqual(j.contrapartes.map(c => c.nome), ['Obras Beta']);
});

test('notas: cancelar libera a chave para relançar a nota corrigida; a nota cancelada continua mostrando a chave', async t => {
  const base = '3326102345678900019055001000001234100000123';
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const chave = base + String(soma % 11 < 2 ? 0 : 11 - (soma % 11));
  const banco = bancoNotas(); banco.semear.fornecedor('Vidros Sul');
  const { chamar } = await prepararNotas(t, { banco });
  assert.equal((await criar(chamar, { ...ENTRADA, chave })).status, 200);
  assert.equal((await chamar('/notas_fiscais/1/cancelar', 'POST', { motivo: 'fornecedor errado' })).status, 200);
  assert.equal((await criar(chamar, { ...ENTRADA, contraparteCodigo: 2, chave })).status, 200);
  assert.equal((await (await chamar('/notas_fiscais/1')).json()).nota.chave, chave);
  assert.equal((await criar(chamar, { ...ENTRADA, numero: '555', chave })).status, 409);
});
