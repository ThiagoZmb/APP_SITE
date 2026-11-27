// Rotas de EPI (rotas/epis.js) com banco simulado (test/apoio/bancoEpis.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararEpis, bancoEpis } = require('./apoio/bancoEpis');
const { hojeLocal } = require('../rotas/transacao');
const { PERFIS_INICIAIS, CATALOGO } = require('../seguranca/permissoes');
const { registro } = require('../index.js');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { instalarTabelas, acrescentarPermissoesEpi } = require('../seguranca/instalacao');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
let n = 0;
const chave = () => `chave-teste-${++n}`;
const dias = d => { const x = new Date(hojeLocal() + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

// banco com 2 EPIs: Luva (10 em estoque) e Óculos (1 em estoque)
function bancoPronto() {
  const banco = bancoEpis();
  const luva = banco.semear.epi(), oculos = banco.semear.epi({ nome: 'Óculos', ca: '999', minimo: 0 });
  banco.semear.entrada(luva.id, 10); banco.semear.entrada(oculos.id, 1);
  return banco;
}
const corpoEntrega = (x = {}) => ({ funcionarioCodigo: 1, itens: [{ epiId: 1, quantidade: 3 }], chave: chave(), ...x });
const lista = async chamar => (await (await chamar('/epis/entregas')).json()).entregas;
const estoque = async chamar => (await (await chamar('/epis')).json()).epis;

test('permissões: todas as rotas de EPI passam pelo registro e cada ação exige a sua', async t => {
  assert.equal(registro.rotasAutenticadas().filter(r => r.caminho === '/epis' || r.caminho.startsWith('/epis/')).length, 12);
  assert.ok(!registro.rotasPublicas().some(r => r.caminho.startsWith('/epis')));
  const { chamar, enviarFoto, atual, banco } = await prepararEpis(t, { perfil: 'Sem acesso', banco: bancoPronto() });
  const leituras = ['/epis', '/epis/funcionarios', '/epis/resumo', '/epis/entregas', '/epis/entregas/1/foto/1'];
  const gestao = [['/epis', 'POST'], ['/epis/1', 'PUT'], ['/epis/1/entrada', 'POST'], ['/epis/entregas/1/cancelar', 'POST'], ['/epis/entregas/1/foto/1', 'DELETE']];
  for (const c of leituras) assert.equal((await chamar(c)).status, 403, c);
  for (const [c, m] of [...gestao, ['/epis/entregas', 'POST']]) assert.equal((await chamar(c, m, {})).status, 403, m + ' ' + c);
  assert.equal((await enviarFoto(`/epis/entregas/1/foto?chave=${chave()}`, JPEG)).status, 403);

  atual.perfil = 'Só ver';
  assert.equal((await chamar('/epis')).status, 200);
  assert.equal((await chamar('/epis/entregas')).status, 200);
  assert.equal((await chamar('/epis/funcionarios')).status, 403);
  assert.equal((await chamar('/epis/resumo')).status, 403);
  assert.equal((await chamar('/epis/entregas', 'POST', corpoEntrega())).status, 403);
  assert.equal((await enviarFoto(`/epis/entregas/1/foto?chave=${chave()}`, JPEG)).status, 403);

  atual.perfil = 'Almoxarife';
  for (const [c, m] of gestao) assert.equal((await chamar(c, m, {})).status, 403, m + ' ' + c);
  assert.equal((await chamar('/epis/resumo')).status, 403);

  atual.perfil = 'Registrar sem ver'; // sem epi.ver nada abre (as fotos só saem para quem tem epi.ver)
  assert.equal((await chamar('/epis/entregas')).status, 403);
  assert.equal((await chamar('/epis/entregas/1/foto/1')).status, 403);
  assert.equal((await chamar('/epis/entregas', 'POST', corpoEntrega())).status, 403);

  atual.perfil = 'Administrativo';
  assert.equal((await chamar('/epis/resumo')).status, 200);
  assert.equal(banco.entregas.length, 0);
});

test('funcionários para registrar: só código e nome dos ativos (SITUACAO Ativo); a tabela do VB só é lida', async t => {
  const { chamar, banco } = await prepararEpis(t, { perfil: 'Almoxarife', banco: bancoPronto() });
  const j = await (await chamar('/epis/funcionarios')).json();
  assert.deepEqual(j, { funcionarios: [{ codigo: 1, nome: 'Ana Lima' }, { codigo: 3, nome: 'Caio Souza' }] });
  await chamar('/epis/entregas', 'POST', corpoEntrega());
  const doVb = banco.chamadas.filter(c => /\bfuncionarios\b/.test(c.sql.replace(/web_\w+/g, '')));
  assert.ok(doVb.length >= 2);
  assert.ok(doVb.every(c => /^SELECT CODIGO, NOME FROM funcionarios/.test(c.sql)));
  assert.ok(!banco.chamadas.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql) && !/^(INSERT INTO|UPDATE) web_/.test(c.sql)));
});

test('catálogo: cria (com estoque inicial), recusa nome repetido e C.A. inválido, edita e desativa; auditado', async t => {
  const { chamar, banco } = await prepararEpis(t);
  const r = await chamar('/epis', 'POST', { nome: 'Capacete', ca: '555', minimo: 1, estoqueInicial: 4 });
  assert.equal(r.status, 201);
  const { epiId } = await r.json();
  assert.equal((await chamar('/epis', 'POST', { nome: 'capacete', ca: '1' })).status, 409);
  assert.equal((await chamar('/epis', 'POST', { nome: 'Bota', ca: 'abc' })).status, 400);
  assert.equal((await chamar('/epis', 'POST', { nome: 'Bota', ca: '1', estoqueInicial: 1.5 })).status, 400);
  assert.equal(banco.epis.length, 1);
  assert.equal((await estoque(chamar))[0].qtdEstoque, 4);

  assert.equal((await chamar(`/epis/${epiId}`, 'PUT', { nome: 'Capacete branco', ca: '556', minimo: 5, ativo: false })).status, 200);
  const e = (await estoque(chamar))[0];
  assert.deepEqual([e.nome, e.ca, e.minimo, e.ativo, e.qtdEstoque], ['Capacete branco', '556', 5, false, 4]);
  assert.equal((await chamar('/epis/999', 'PUT', { nome: 'x', ca: '1' })).status, 404);
  assert.equal((await chamar(`/epis/${epiId}/entrada`, 'POST', { quantidade: 1, chave: chave() })).status, 409); // inativo
  assert.deepEqual(banco.auditoria.map(a => a.acao), ['epi_criado', 'epi_alterado']);
});

test('entrada: soma ao estoque, é idempotente pela chave e só aceita inteiro', async t => {
  const { chamar, banco } = await prepararEpis(t, { banco: bancoPronto() });
  const k = chave();
  assert.equal((await chamar('/epis/1/entrada', 'POST', { quantidade: 5, chave: k })).status, 201);
  const repetida = await chamar('/epis/1/entrada', 'POST', { quantidade: 5, chave: k });
  assert.equal(repetida.status, 200);
  assert.equal((await repetida.json()).repetido, true);
  assert.equal((await chamar('/epis/2/entrada', 'POST', { quantidade: 5, chave: k })).status, 409); // chave de outro EPI
  for (const q of [0, -2, 1.5, 'x']) assert.equal((await chamar('/epis/1/entrada', 'POST', { quantidade: q, chave: chave() })).status, 400);
  assert.equal((await chamar('/epis/1/entrada', 'POST', { quantidade: 1 })).status, 400);
  assert.equal((await chamar('/epis/999/entrada', 'POST', { quantidade: 1, chave: chave() })).status, 404);
  assert.equal((await estoque(chamar)).find(e => e.id === 1).qtdEstoque, 15);
  assert.equal(banco.auditoria.filter(a => a.acao === 'epi_entrada').length, 1);
});

test('entrega: vários EPIs, copia funcionário/EPI/C.A., baixa o estoque, data hoje por padrão e passada aceita', async t => {
  const { chamar, banco } = await prepararEpis(t, { banco: bancoPronto() });
  const r = await chamar('/epis/entregas', 'POST', corpoEntrega({ observacao: 'troca', itens: [{ epiId: 2, quantidade: 1 }, { epiId: 1, quantidade: 3 }] }));
  assert.equal(r.status, 201);
  assert.equal((await chamar('/epis/entregas', 'POST', corpoEntrega({ data: dias(-40), itens: [{ epiId: 1, quantidade: 1 }] }))).status, 201);
  // mudar o cadastro depois não altera o histórico
  await chamar('/epis/1', 'PUT', { nome: 'Outro nome', ca: '1', minimo: 0 });
  banco.funcionarios[0].NOME = 'Ana Casada';
  const [hoje, antiga] = await lista(chamar);
  assert.deepEqual([hoje.funcionarioNome, hoje.data, hoje.observacao, hoje.cancelada, hoje.fotos], ['Ana Lima', hojeLocal(), 'troca', null, []]);
  assert.deepEqual(hoje.itens.map(i => [i.nome, i.ca, i.quantidade]), [['Óculos', '999', 1], ['Luva nitrílica', '12345', 3]]);
  assert.equal(antiga.data, dias(-40));
  const e = await estoque(chamar);
  assert.deepEqual(e.map(x => x.qtdEstoque).sort(), [0, 6]);
  assert.equal(e.find(x => x.id === 1).duraDias, 60); // 6 em estoque, 3 nos últimos 30 dias (a entrega de 40 dias atrás não conta)
  assert.equal(banco.auditoria.filter(a => a.acao === 'epi_entrega').length, 2);
});

test('entrega: recusa futura, sem estoque (nada gravado), EPI inativo/inexistente e funcionário fora de atividade', async t => {
  const { chamar, banco } = await prepararEpis(t, { banco: bancoPronto() });
  const futura = await chamar('/epis/entregas', 'POST', corpoEntrega({ data: dias(1) }));
  assert.equal(futura.status, 400);
  const sem = await chamar('/epis/entregas', 'POST', corpoEntrega({ itens: [{ epiId: 1, quantidade: 1 }, { epiId: 2, quantidade: 2 }] }));
  assert.equal(sem.status, 409);
  assert.match((await sem.json()).error, /Estoque insuficiente.*Óculos.*1/);
  assert.equal((await chamar('/epis/entregas', 'POST', corpoEntrega({ funcionarioCodigo: 2 }))).status, 400);
  assert.equal((await chamar('/epis/entregas', 'POST', corpoEntrega({ itens: [{ epiId: 99, quantidade: 1 }] }))).status, 400);
  banco.epis[0].ativo = 0;
  assert.equal((await chamar('/epis/entregas', 'POST', corpoEntrega())).status, 409);
  assert.equal(banco.entregas.length, 0);
  assert.equal(banco.itens.length, 0);
  assert.equal(banco.auditoria.length, 0);
});

test('entrega: reenvio com a mesma chave não duplica (mesmo sem estoque para uma segunda)', async t => {
  const { chamar, banco } = await prepararEpis(t, { banco: bancoPronto() });
  const corpo = corpoEntrega({ itens: [{ epiId: 2, quantidade: 1 }] });
  const a = await (await chamar('/epis/entregas', 'POST', corpo)).json();
  const b = await chamar('/epis/entregas', 'POST', corpo);
  assert.equal(b.status, 200);
  assert.deepEqual(await b.json(), { entregaId: a.entregaId, repetido: true });
  assert.equal(banco.entregas.length, 1);
  assert.equal(banco.itens.length, 1);
});

test('entrega: duas ao mesmo tempo não deixam o estoque negativo; os EPIs são travados em ordem antes de qualquer leitura', async t => {
  const { chamar, banco } = await prepararEpis(t, { banco: bancoPronto() });
  const [a, b] = await Promise.all([1, 3].map(func => chamar('/epis/entregas', 'POST',
    corpoEntrega({ funcionarioCodigo: func, itens: [{ epiId: 1, quantidade: 6 }, { epiId: 2, quantidade: 1 }] }))));
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(banco.entregas.length, 1);
  assert.deepEqual((await estoque(chamar)).map(e => e.qtdEstoque).sort(), [0, 4]);
  banco.chamadas.length = 0;
  await chamar('/epis/entregas', 'POST', corpoEntrega({ itens: [{ epiId: 2, quantidade: 1 }, { epiId: 1, quantidade: 1 }] }));
  const i = banco.chamadas.findIndex(c => c.sql === 'BEGIN');
  assert.match(banco.chamadas[i + 1].sql, /FROM web_epis WHERE id IN \(\?, \?\) ORDER BY id FOR UPDATE/);
  assert.deepEqual(banco.chamadas[i + 1].params, [1, 2]);
});

test('entrega: falha no meio desfaz tudo (rollback)', async t => {
  const { chamar, banco } = await prepararEpis(t, { banco: bancoPronto() });
  banco.falhas.add(/^INSERT INTO web_auditoria/);
  assert.equal((await chamar('/epis/entregas', 'POST', corpoEntrega())).status, 500);
  assert.equal(banco.entregas.length, 0);
  assert.equal(banco.itens.length, 0);
});

test('cancelar: exige motivo, devolve ao estoque, continua no histórico com as fotos e não reabre nem recebe foto', async t => {
  const { chamar, enviarFoto, banco } = await prepararEpis(t, { banco: bancoPronto() });
  const { entregaId } = await (await chamar('/epis/entregas', 'POST', corpoEntrega())).json();
  assert.equal((await enviarFoto(`/epis/entregas/${entregaId}/foto?chave=${chave()}`, JPEG)).status, 201);
  assert.equal((await chamar(`/epis/entregas/${entregaId}/cancelar`, 'POST', { motivo: '  ' })).status, 400);
  assert.equal((await chamar(`/epis/entregas/${entregaId}/cancelar`, 'POST', { motivo: 'lancei errado' })).status, 200);
  assert.equal((await chamar(`/epis/entregas/${entregaId}/cancelar`, 'POST', { motivo: 'de novo' })).status, 409);
  assert.equal((await chamar('/epis/entregas/99/cancelar', 'POST', { motivo: 'x' })).status, 404);
  assert.equal((await enviarFoto(`/epis/entregas/${entregaId}/foto?chave=${chave()}`, JPEG)).status, 409);
  const [e] = await lista(chamar);
  assert.equal(e.cancelada.motivo, 'lancei errado');
  assert.equal(e.fotos.length, 1);
  assert.equal((await chamar(`/epis/entregas/${entregaId}/foto/${e.fotos[0].id}`)).status, 200);
  assert.equal((await estoque(chamar)).find(x => x.id === 1).qtdEstoque, 10);
  assert.equal(banco.entregas.length, 1);
  assert.ok(!banco.chamadas.some(c => /^DELETE/.test(c.sql)), 'nada é apagado');
});

test('foto: JPEG/PNG pelos bytes até 1 MB, até 6 visíveis, idempotente pela chave', async t => {
  const { chamar, enviarFoto, banco } = await prepararEpis(t, { banco: bancoPronto() });
  const { entregaId } = await (await chamar('/epis/entregas', 'POST', corpoEntrega())).json();
  const url = k => `/epis/entregas/${entregaId}/foto?chave=${k}`;
  assert.equal((await enviarFoto(url(chave()), Buffer.from('<html>'), 'image/jpeg')).status, 400);
  assert.equal((await enviarFoto(url(chave()), PNG, 'image/jpeg')).status, 400); // tipo não confere
  assert.equal((await enviarFoto(url(chave()), Buffer.from('GIF89a'), 'image/gif')).status, 400);
  assert.equal((await enviarFoto(url(chave()), Buffer.concat([JPEG, Buffer.alloc(1048576)]))).status, 413);
  assert.equal((await enviarFoto(`/epis/entregas/${entregaId}/foto`, JPEG)).status, 400); // sem chave
  assert.equal((await enviarFoto(`/epis/entregas/99/foto?chave=${chave()}`, JPEG)).status, 404);
  assert.equal(banco.fotos.length, 0);

  // foto maior que o limite do corpo JSON (100 kb) passa: o parser global não atrapalha o envio binário
  const grande = Buffer.concat([JPEG, Buffer.alloc(500000)]);
  const k = chave();
  const a = await enviarFoto(url(k), grande);
  assert.equal(a.status, 201);
  const rep = await enviarFoto(url(k), grande);
  assert.equal(rep.status, 200);
  assert.equal((await rep.json()).fotoId, (await a.json()).fotoId);
  assert.equal(banco.fotos.length, 1);
  assert.equal(banco.fotos[0].dados.length, grande.length);
  for (let i = 0; i < 5; i++) assert.equal((await enviarFoto(url(chave()), PNG, 'image/png')).status, 201);
  assert.equal((await enviarFoto(url(chave()), JPEG)).status, 409);
  assert.equal(banco.fotos.length, 6);
  assert.equal(banco.auditoria.filter(x => x.acao === 'epi_foto').length, 6);
});

test('foto: abre com os cabeçalhos certos; remover só oculta, é auditado e libera a vaga', async t => {
  const { chamar, enviarFoto, atual, banco } = await prepararEpis(t, { banco: bancoPronto() });
  const { entregaId } = await (await chamar('/epis/entregas', 'POST', corpoEntrega())).json();
  const { fotoId } = await (await enviarFoto(`/epis/entregas/${entregaId}/foto?chave=${chave()}`, JPEG)).json();
  const caminho = `/epis/entregas/${entregaId}/foto/${fotoId}`;
  atual.perfil = 'Só ver';
  const img = await chamar(caminho);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal(img.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), JPEG);
  assert.equal((await chamar(`/epis/entregas/99/foto/${fotoId}`)).status, 404);
  assert.equal((await chamar(caminho, 'DELETE')).status, 403);
  atual.perfil = 'Gestor';
  assert.equal((await chamar(caminho, 'DELETE')).status, 200);
  assert.equal((await chamar(caminho, 'DELETE')).status, 404);
  assert.equal((await chamar(caminho)).status, 404);
  assert.deepEqual((await lista(chamar))[0].fotos, []);
  assert.equal(banco.fotos.length, 1, 'o arquivo continua no banco');
  assert.ok(banco.fotos[0].removida_em);
  assert.equal(banco.auditoria.at(-1).acao, 'epi_foto_removida');
});

test('resumo: indicadores sem canceladas; quem não tem valores.ver recebe os mesmos campos (nenhum é apagado)', async t => {
  const { chamar, atual } = await prepararEpis(t, { banco: bancoPronto() });
  await chamar('/epis/entregas', 'POST', corpoEntrega());
  const { entregaId } = await (await chamar('/epis/entregas', 'POST', corpoEntrega({ itens: [{ epiId: 2, quantidade: 1 }] }))).json();
  await chamar(`/epis/entregas/${entregaId}/cancelar`, 'POST', { motivo: 'x' });
  atual.perfil = 'Só resumo sem valores';
  const r = await (await chamar('/epis/resumo')).json();
  assert.equal(r.qtdUnidades, 3);
  assert.equal(r.qtdUltimos30, 3);
  assert.equal(r.qtdFuncionarios, 2);
  assert.equal(r.porMes.length, 6);
  assert.deepEqual(r.porFuncionario, [{ nome: 'Ana Lima', qtd: 3 }]);
  assert.deepEqual(r.porEpi, [{ nome: 'Luva nitrílica', qtd: 3 }]);
  assert.deepEqual(r.estoque.map(e => e.qtd).sort(), [1, 7]);
  const e = (await estoque(chamar))[0];
  assert.deepEqual(Object.keys(e).sort(), ['ativo', 'baixo', 'ca', 'duraDias', 'id', 'minimo', 'nome', 'qtdEstoque']);
});

test('instalação: cinco tabelas web_epi*, chaves únicas e nada no cadastro de funcionários', async () => {
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const sql = pool.chamadas.map(c => c.sql).filter(s => /web_epi/.test(s));
  assert.deepEqual(sql.map(s => /`(web_epi\w*)`/.exec(s)[1]).sort(), ['web_epi_entradas', 'web_epi_entrega_itens', 'web_epi_entregas', 'web_epi_fotos', 'web_epis']);
  const de = nome => sql.find(s => s.includes('`' + nome + '`'));
  assert.match(de('web_epi_entregas'), /UNIQUE KEY[^(]*\(chave\)/);
  assert.match(de('web_epi_entradas'), /UNIQUE KEY[^(]*\(chave\)/);
  assert.match(de('web_epi_fotos'), /UNIQUE KEY[^(]*\(entrega_id, chave\)/);
  assert.match(de('web_epi_fotos'), /MEDIUMBLOB/);
  assert.ok(!pool.chamadas.some(c => /\bfuncionarios\b/.test(c.sql)));
});

test('permissões: só o Administrador começa com epi.*; a migração roda uma vez', async () => {
  const codigos = ['epi.ver', 'epi.registrar', 'epi.gerir'];
  for (const c of codigos) assert.ok(CATALOGO.find(p => p.codigo === c)?.descricao.length >= 15, c);
  for (const p of PERFIS_INICIAIS) assert.equal(p.permissoes.some(c => c.startsWith('epi.')), p.nome === 'Administrador', p.nome);
  const pool = criarPoolFalso([[/SELECT id FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]]]);
  assert.deepEqual(await acrescentarPermissoesEpi(pool), { feito: true });
  assert.deepEqual(pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params), codigos.map(c => [1, c]));
  const feito = criarPoolFalso([[/acao = 'permissoes_epi'/, [{ id: 1 }]]]);
  assert.deepEqual(await acrescentarPermissoesEpi(feito), { feito: false });
  assert.ok(!feito.chamadas.some(c => /INSERT/.test(c.sql)));
});
