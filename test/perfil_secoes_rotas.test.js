// Biblioteca de seções de perfis: rotas /perfil_secoes (rotas/perfil_secoes.js), tabela web_perfil_secoes, semente do 1036 e permissão perfis.desenho.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { instalarTabelas, semearPerfilSecoes, acrescentarPermissoesPerfisDesenho } = require('../seguranca/instalacao');
const { CODIGOS, PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { REGEX_VALOR } = require('../seguranca/valores');
const PS = require('../calculo/perfil_secoes');
aceitarSidDeTeste(sessoes);

const PERFIS = {
  Editor: ['perfis.desenho', 'produtos.ver'],
  'Só produtos': ['produtos.ver'],
  Vendedor: ['orcamentos.criar'],
  'Sem acesso': ['pedidos.ver']
};
const PRODUTOS = { 13: { CODIGO: 13, MODELO: '1036', CLASSE: 'Perfil' }, 14: { CODIGO: 14, MODELO: 'P-14', CLASSE: 'Perfil' }, 80: { CODIGO: 80, MODELO: 'PUX', CLASSE: 'Puxador' } };
const clone = o => JSON.parse(JSON.stringify(o));
const secaoBoa = (extra = {}) => ({
  versao: 2, largura: 20, altura: 40, parede: 1.5,
  contorno: [[0, 0], [20, 0], [20, 40], [0, 40]],
  vazados: [[[2, 2], [9, 2], [9, 38], [2, 38]], [[11, 2], [18, 2], [18, 20], [11, 20]]],
  canalVidro: { x0: 1, x1: 5, y0: 1 }, junta: 'meia_esquadria',
  cores: { padrao: '#c3c8cd', porAcabamento: { 'Anodizado Fosco': '#112233' } }, estimada: [], ...extra
});
const nomesDeCampos = v => (Array.isArray(v) ? v.flatMap(nomesDeCampos) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...nomesDeCampos(x)]) : []);

async function preparar(t, perfil = 'Editor') {
  const estado = { linhas: new Map(), auditoria: [] };
  estado.linhas.set(13, { codigo: 13, modelo: '1036', secao: JSON.stringify(PS.semente1036()), versao_esquema: 2, atualizado_em: '2026-11-05 10:00:00', atualizado_por: 'sistema' });
  const f = criarPoolFalso([
    [/INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { estado.auditoria.push({ quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    [/^SELECT codigo, modelo, secao FROM web_perfil_secoes/, () => [...estado.linhas.values()].sort((a, b) => a.codigo - b.codigo)],
    [/^SELECT codigo, modelo, secao, atualizado_em, atualizado_por FROM web_perfil_secoes/, (sql, [c]) => (estado.linhas.has(c) ? [estado.linhas.get(c)] : [])],
    [/^SELECT CODIGO, MODELO, CLASSE FROM cadastro_de_produtos/, (sql, [c]) => (PRODUTOS[c] ? [PRODUTOS[c]] : [])],
    [/^INSERT INTO web_perfil_secoes/, (sql, [codigo, modelo, secao, versao_esquema, atualizado_em, atualizado_por]) => {
      assert.match(sql, /ON DUPLICATE KEY UPDATE/);
      estado.linhas.set(codigo, { codigo, modelo, secao, versao_esquema, atualizado_em, atualizado_por }); return { affectedRows: 1 };
    }],
    [/^SELECT codigo, versao_esquema FROM web_perfil_secoes WHERE codigo = \? FOR UPDATE/, (sql, [c]) => (estado.linhas.has(c) ? [estado.linhas.get(c)] : [])],
    [/^DELETE FROM web_perfil_secoes/, (sql, [c]) => { estado.linhas.delete(c); return { affectedRows: 1 }; }]
  ]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Caio', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados: [], ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const cab = { Authorization: 'Bearer ' + jwt.sign({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' }) };
  const json = { ...cab, 'Content-Type': 'application/json' };
  return {
    estado, pool: f,
    get: caminho => fetch(s.url + caminho, { headers: cab }),
    put: (caminho, corpo) => fetch(s.url + caminho, { method: 'PUT', headers: json, body: JSON.stringify(corpo) }),
    del: caminho => fetch(s.url + caminho, { method: 'DELETE', headers: cab })
  };
}

test('GET /perfil_secoes: lista a biblioteca; sem dinheiro; quem monta orçamento (Vendedor) também lê', async t => {
  const { get } = await preparar(t, 'Vendedor');
  const r = await get('/perfil_secoes');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.versaoEsquema, 2); assert.equal(j.secoes.length, 1);
  assert.equal(j.secoes[0].modelo, '1036'); assert.equal(j.secoes[0].codigo, 13); assert.equal(j.secoes[0].cores.padrao, '#c3c8cd');
  assert.deepEqual(PS.validar(j.secoes[0]), []);
  assert.ok(!nomesDeCampos(j).some(k => REGEX_VALOR.test(k)), 'seção não é dinheiro');
});

test('GET /perfil_secoes/:codigo: devolve a seção; 404 sem desenho; 400 em código ruim', async t => {
  const { get } = await preparar(t, 'Só produtos');
  let r = await get('/perfil_secoes/13');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.secao.modelo, '1036'); assert.equal(j.atualizadoPor, 'sistema'); assert.match(j.atualizadoEm, /^2026-11-05 10:00:00$/);
  assert.equal((await get('/perfil_secoes/14')).status, 404);
  assert.equal((await get('/perfil_secoes/abc')).status, 400);
  assert.equal((await get('/perfil_secoes/0')).status, 400);
});

test('permissão: sem produtos.ver/orcamentos.criar não lê; sem perfis.desenho não grava nem apaga', async t => {
  const sem = await preparar(t, 'Sem acesso');
  assert.equal((await sem.get('/perfil_secoes')).status, 403);
  assert.equal((await sem.get('/perfil_secoes/13')).status, 403);
  const so = await preparar(t, 'Só produtos');
  assert.equal((await so.put('/perfil_secoes/14', secaoBoa())).status, 403);
  assert.equal((await so.del('/perfil_secoes/13')).status, 403);
  assert.equal(so.estado.linhas.size, 1); assert.equal(so.estado.auditoria.length, 0);
});

test('PUT /perfil_secoes/:codigo: valida, grava com modelo do cadastro, audita só código e versão', async t => {
  const { estado, get, put } = await preparar(t);
  // o modelo e o código vêm da URL/cadastro, não do corpo; campos desconhecidos são descartados
  const r = await put('/perfil_secoes/14', { ...secaoBoa(), modelo: 'QUALQUER', lixo: 'x' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.secao.codigo, 14); assert.equal(j.secao.modelo, 'P-14'); assert.equal(j.secao.lixo, undefined);
  assert.equal(j.secao.vazados.length, 2);
  const gravada = estado.linhas.get(14);
  assert.equal(gravada.modelo, 'P-14'); assert.equal(gravada.versao_esquema, 2); assert.equal(gravada.atualizado_por, 'Caio');
  assert.deepEqual(PS.validar(JSON.parse(gravada.secao)), []);
  assert.deepEqual(estado.auditoria, [{ quem: 'Caio', acao: 'perfil_secao_gravada', alvo: '14', detalhe: { codigo: 14, versao: 2 } }]);
  // aparece na lista e substitui na segunda gravação
  assert.equal((await (await get('/perfil_secoes')).json()).secoes.length, 2);
  assert.equal((await put('/perfil_secoes/14', secaoBoa({ junta: 'reta' }))).status, 200);
  assert.equal(JSON.parse(estado.linhas.get(14).secao).junta, 'reta');
  assert.equal(estado.linhas.size, 2);
});

test('PUT /perfil_secoes/:codigo: recusa seção quebrada, produto que não é Perfil, inexistente e código divergente', async t => {
  const { estado, put } = await preparar(t);
  let r = await put('/perfil_secoes/14', secaoBoa({ vazados: [[[2, 2], [30, 2], [30, 38]]] }));
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /Desenho inválido/); assert.ok(j.erros.some(e => e.includes('fora do contorno')));
  r = await put('/perfil_secoes/14', secaoBoa({ cores: { padrao: 'verde' } }));
  assert.equal(r.status, 400);
  r = await put('/perfil_secoes/14', secaoBoa({ largura: 999 }));
  assert.equal(r.status, 400);
  assert.equal((await put('/perfil_secoes/14', { contorno: 'x' })).status, 400);
  assert.equal((await put('/perfil_secoes/14', [1, 2])).status, 400);
  assert.equal((await put('/perfil_secoes/14', secaoBoa({ codigo: 99 }))).status, 400);
  assert.equal((await put('/perfil_secoes/80', secaoBoa())).status, 422);    // puxador
  assert.equal((await put('/perfil_secoes/999', secaoBoa())).status, 404);   // não existe
  assert.equal((await put('/perfil_secoes/xx', secaoBoa())).status, 400);
  assert.equal(estado.linhas.size, 1); assert.equal(estado.auditoria.length, 0);
});

test('DELETE /perfil_secoes/:codigo: remove, audita; 404 se não existe', async t => {
  const { estado, del, get } = await preparar(t);
  assert.equal((await del('/perfil_secoes/14')).status, 404);
  const r = await del('/perfil_secoes/13');
  assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
  assert.equal(estado.linhas.size, 0);
  assert.deepEqual(estado.auditoria, [
    { quem: 'Caio', acao: 'perfil_secao_removida', alvo: '13', detalhe: { codigo: 13, versao: 2 } },
    { quem: 'Caio', acao: 'semente_perfil_secoes_removida', alvo: '13', detalhe: { codigo: 13 } }   // a semeadura não traz de volta
  ]);
  assert.deepEqual((await (await get('/perfil_secoes')).json()).secoes, []);
});

test('lista ignora linha com JSON quebrado sem derrubar as outras', async t => {
  const { estado, get } = await preparar(t);
  estado.linhas.set(15, { codigo: 15, modelo: 'RUIM', secao: '{nao e json', versao_esquema: 2 });
  const j = await (await get('/perfil_secoes')).json();
  assert.deepEqual(j.secoes.map(s => s.codigo), [13]);
});

test('permissões: perfis.desenho existe e é de Administrador e Interno completo; outros perfis não', () => {
  assert.ok(CODIGOS.has('perfis.desenho'));
  for (const n of ['Administrador', 'Interno completo']) assert.ok(PERFIS_INICIAIS.find(p => p.nome === n).permissoes.includes('perfis.desenho'), n);
  for (const n of ['Vendedor', 'Estoquista', 'Representante']) assert.ok(!PERFIS_INICIAIS.find(p => p.nome === n).permissoes.includes('perfis.desenho'), n);
});

test('migração de permissão: concede a Administrador e Interno completo uma vez, com auditoria', async () => {
  let feita = false;
  const f = criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_perfis_desenho'/, () => (feita ? [{ id: 1 }] : [])],
    [/SELECT id, nome FROM web_perfis/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT INTO web_auditoria/, () => { feita = true; return { affectedRows: 1 }; }]
  ]);
  assert.deepEqual(await acrescentarPermissoesPerfisDesenho(f), { feito: true });
  const ins = f.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params);
  assert.deepEqual(ins, [[1, 'perfis.desenho'], [2, 'perfis.desenho']]);
  const aud = f.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql));
  assert.ok(aud.params.includes('permissoes_perfis_desenho'));
  assert.deepEqual(f.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql), ['BEGIN', 'COMMIT']);
  assert.deepEqual(await acrescentarPermissoesPerfisDesenho(f), { feito: false });
});

test('instalarTabelas cria web_perfil_secoes com codigo como chave primária', async () => {
  const f = criarPoolFalso([]);
  await instalarTabelas(f);
  const sql = f.chamadas.find(c => /`web_perfil_secoes`/.test(c.sql)).sql;
  assert.match(sql, /codigo INT NOT NULL PRIMARY KEY/);
  for (const col of ['modelo', 'secao', 'versao_esquema', 'atualizado_em', 'atualizado_por']) assert.match(sql, new RegExp(col));
});

// Banco falso da semeadura: `linhas` = [[codigo, { atualizado_por, semente_rev }]]; `auditoria` = [{ acao, alvo }] já existentes
function poolSemente({ linhas = [], auditoria = [] } = {}) {
  const estado = { linhas: new Map(linhas), auditoria: [...auditoria], inseridas: [], atualizacoes: [] };
  const f = criarPoolFalso([
    [/^SELECT codigo, atualizado_por, semente_rev FROM web_perfil_secoes WHERE codigo = \? FOR UPDATE/, (sql, [c]) => (estado.linhas.has(c) ? [{ codigo: c, ...estado.linhas.get(c) }] : [])],
    [/^SELECT id FROM web_auditoria WHERE alvo = \?/, (sql, [alvo]) => (estado.auditoria.some(a => a.alvo === alvo && ['semente_perfil_secoes_removida', 'semente_perfil_secoes'].includes(a.acao)) ? [{ id: 1 }] : [])],
    [/^INSERT INTO web_perfil_secoes/, (sql, p) => { estado.inseridas.push(p); estado.linhas.set(p[0], { atualizado_por: p[4], semente_rev: p[5] }); return { affectedRows: 1 }; }],
    [/^UPDATE web_perfil_secoes/, (sql, p) => { estado.atualizacoes.push(p); estado.linhas.set(p[5], { atualizado_por: p[3], semente_rev: p[4] }); return { affectedRows: 1 }; }],
    [/INSERT INTO web_auditoria/, (sql, [quem, acao, alvo]) => { estado.auditoria.push({ acao, alvo }); return { affectedRows: 1 }; }]
  ]);
  return { f, estado };
}
const BIB = require('../calculo/perfil_secoes_biblioteca');

test('semeadura: tabela vazia insere toda a biblioteca como semente com a rev; segunda subida não faz nada', async () => {
  const { f, estado } = poolSemente();
  assert.deepEqual(await semearPerfilSecoes(f), { feito: true, inseridas: [13, 92], atualizadas: [] });
  assert.deepEqual(estado.inseridas.map(p => [p[0], p[1], p[3], p[4], p[5]]), [[13, '1036', 2, 'semente', 1], [92, '3345', 2, 'semente', 1]]);
  for (const p of estado.inseridas) assert.deepEqual(PS.validar(JSON.parse(p[2])), []);
  assert.deepEqual(await semearPerfilSecoes(f), { feito: false, inseridas: [], atualizadas: [] });   // idempotente
  assert.equal(estado.inseridas.length, 2); assert.equal(estado.atualizacoes.length, 0);
});

test('semeadura: só um código novo falta -> insere só ele; semente com rev menor é atualizada', async () => {
  const { f, estado } = poolSemente({ linhas: [[13, { atualizado_por: 'semente', semente_rev: 1 }]] });
  assert.deepEqual(await semearPerfilSecoes(f), { feito: true, inseridas: [92], atualizadas: [] });
  const antes = BIB.SECOES[1].rev;
  BIB.SECOES[1].rev = antes + 1;   // correção de semente: sobe a rev
  try {
    assert.deepEqual(await semearPerfilSecoes(f), { feito: true, inseridas: [], atualizadas: [92] });
    assert.deepEqual([estado.atualizacoes[0][3], estado.atualizacoes[0][4], estado.atualizacoes[0][5]], ['semente', antes + 1, 92]);
    assert.deepEqual(await semearPerfilSecoes(f), { feito: false, inseridas: [], atualizadas: [] });
  } finally { BIB.SECOES[1].rev = antes; }
});

test('semeadura: 1036 antigo (atualizado_por sistema, sem rev) vira semente de rev 1', async () => {
  const { f, estado } = poolSemente({ linhas: [[13, { atualizado_por: 'sistema', semente_rev: null }], [92, { atualizado_por: 'semente', semente_rev: 1 }]] });
  assert.deepEqual(await semearPerfilSecoes(f), { feito: true, inseridas: [], atualizadas: [13] });
  assert.equal(estado.atualizacoes[0][3], 'semente');
});

test('semeadura: linha editada por pessoa nunca é sobrescrita, mesmo com rev maior', async () => {
  const { f, estado } = poolSemente({ linhas: [[13, { atualizado_por: 'Caio', semente_rev: 0 }], [92, { atualizado_por: 'Ana', semente_rev: null }]] });
  const rev = BIB.SECOES.map(s => s.rev);
  BIB.SECOES.forEach(s => { s.rev += 5; });
  try {
    assert.deepEqual(await semearPerfilSecoes(f), { feito: false, inseridas: [], atualizadas: [] });
  } finally { BIB.SECOES.forEach((s, i) => { s.rev = rev[i]; }); }
  assert.equal(estado.inseridas.length + estado.atualizacoes.length, 0);
  assert.ok(!f.chamadas.some(c => /UPDATE web_perfil_secoes|ON DUPLICATE/.test(c.sql)));
});

test('semeadura: não ressuscita o removido (auditoria nova, ou a antiga semente_perfil_secoes do 1036)', async () => {
  const { f, estado } = poolSemente({ auditoria: [{ acao: 'semente_perfil_secoes_removida', alvo: '92' }, { acao: 'semente_perfil_secoes', alvo: '13' }] });
  assert.deepEqual(await semearPerfilSecoes(f), { feito: false, inseridas: [], atualizadas: [] });
  assert.equal(estado.inseridas.length, 0);
});

test('instalarTabelas acrescenta semente_rev em web_perfil_secoes quando falta', async () => {
  const f = criarPoolFalso([]);
  await instalarTabelas(f);
  assert.ok(f.chamadas.some(c => /ALTER TABLE web_perfil_secoes ADD COLUMN semente_rev INT NULL/.test(c.sql)));
});
