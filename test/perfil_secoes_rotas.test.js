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
  assert.deepEqual(estado.auditoria, [{ quem: 'Caio', acao: 'perfil_secao_removida', alvo: '13', detalhe: { codigo: 13, versao: 2 } }]);
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

function poolSemente({ marcador = false, linha = false } = {}) {
  const estado = { insercoes: [], auditoria: [] };
  const f = criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'semente_perfil_secoes'/, () => (marcador ? [{ id: 1 }] : [])],
    [/^SELECT codigo FROM web_perfil_secoes WHERE codigo = \? FOR UPDATE/, () => (linha ? [{ codigo: 13 }] : [])],
    [/^INSERT INTO web_perfil_secoes/, (sql, p) => { estado.insercoes.push(p); return { affectedRows: 1 }; }],
    [/INSERT INTO web_auditoria/, (sql, p) => { estado.auditoria.push(p); return { affectedRows: 1 }; }]
  ]);
  return { f, estado };
}

test('semente do 1036: grava o código 13 uma vez; nunca sobrescreve o que o dono editou nem ressuscita o apagado', async () => {
  // 1) tabela vazia, sem marcador: semeia
  let { f, estado } = poolSemente();
  assert.deepEqual(await semearPerfilSecoes(f), { feito: true });
  assert.equal(estado.insercoes.length, 1);
  const [codigo, modelo, secao, versao, quem] = estado.insercoes[0];
  assert.deepEqual([codigo, modelo, versao, quem.slice ? quem : ''], [13, '1036', 2, 'sistema']);
  assert.deepEqual(PS.validar(JSON.parse(secao)), []);
  assert.equal(JSON.parse(secao).cores.padrao, '#c3c8cd');
  assert.ok(estado.auditoria[0].includes('semente_perfil_secoes'));
  // 2) já existe linha (editada pelo dono): não insere, só marca
  ({ f, estado } = poolSemente({ linha: true }));
  assert.deepEqual(await semearPerfilSecoes(f), { feito: false });
  assert.equal(estado.insercoes.length, 0); assert.equal(estado.auditoria.length, 1);
  assert.ok(!f.chamadas.some(c => /UPDATE web_perfil_secoes|ON DUPLICATE/.test(c.sql)));
  // 3) já semeada antes (o dono pode ter apagado): não faz nada
  ({ f, estado } = poolSemente({ marcador: true }));
  assert.deepEqual(await semearPerfilSecoes(f), { feito: false });
  assert.equal(estado.insercoes.length, 0); assert.equal(estado.auditoria.length, 0);
  assert.equal(f.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).length, 0);
});
