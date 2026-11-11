// Dependências do perfil: GET/PUT /produtos/:codigo/permitidos (rotas/produtos_dependencias.js), permissão produtos.dependencias e auditoria.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { acrescentarPermissoesProdutosDependencias } = require('../seguranca/instalacao');
const { CODIGOS, PERFIS_INICIAIS } = require('../seguranca/permissoes');
aceitarSidDeTeste(sessoes);

const PERFIS = { Editor: ['produtos.dependencias', 'produtos.ver'], 'Só produtos': ['produtos.ver', 'produtos.editar'] };
const PRODUTOS = { 13: { CODIGO: 13, MODELO: '1036' }, 14: { CODIGO: 14, MODELO: 'P-14' } };
const TABELAS = {
  perfis_permitidos: 'TIPO_PRODUTO', acabamentos_permitidos: 'ACABAMENTO', puxadores_permitidos: 'PUXADOR_PERMITIDO',
  revestimentos_permitidos: 'REVESTIMENTO_PERMITIDO', divisores_permitidos: 'DIVISOR'
};

async function preparar(t, perfil = 'Editor', { falharEm } = {}) {
  const dados = {
    perfis_permitidos: [['1036', 'Porta de Giro'], ['1036', 'Porta de Correr'], ['P-14', 'Janela']],
    acabamentos_permitidos: [['1036', 'Anodizado'], ['P-14', 'Anodizado']],
    puxadores_permitidos: [['1036', 'PX1'], ['P-14', 'PX1']],
    revestimentos_permitidos: [['1036', 'ACM']],
    divisores_permitidos: [['1036', 'DV1']]
  };
  const inicial = JSON.parse(JSON.stringify(dados));
  const auditoria = [];
  const regras = [
    [/INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { auditoria.push({ quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    [/^SELECT CODIGO, MODELO FROM cadastro_de_produtos WHERE CODIGO = \?/, (sql, [c]) => (PRODUTOS[c] ? [PRODUTOS[c]] : [])],
    [/^SELECT DISTINCT TIPO_PRODUTO AS v FROM perfis_permitidos/, () => [{ v: 'Janela' }, { v: 'Porta de Correr' }, { v: 'Porta de Giro' }]],
    [/^SELECT ACABAMENTO AS v FROM acabamentos ORDER/, () => [{ v: 'Anodizado' }, { v: 'Branco' }, { v: 'Preto' }]],
    [/^SELECT DISTINCT p\.PUXADOR_PERMITIDO AS v/, () => [{ v: 'PX1' }, { v: 'PX2' }]],
    [/^SELECT DISTINCT p\.REVESTIMENTO_PERMITIDO AS v/, () => [{ v: 'ACM' }, { v: 'Vidro' }]],
    [/^SELECT DISTINCT p\.DIVISOR AS v/, () => [{ v: 'DV1' }, { v: 'DV2' }]],
    [/^SELECT (\w+) AS v FROM (\w+_permitidos) WHERE MODELO = \?/, (sql, [m]) => {
      const tab = /FROM (\w+_permitidos)/.exec(sql)[1];
      return dados[tab].filter(l => l[0] === m).map(l => ({ v: l[1] })).sort((a, b) => a.v.localeCompare(b.v));
    }],
    [/^DELETE FROM (\w+_permitidos) WHERE MODELO = \?/, (sql, [m]) => {
      const tab = /FROM (\w+)/.exec(sql)[1];
      dados[tab] = dados[tab].filter(l => l[0] !== m); return { affectedRows: 1 };
    }],
    [/^INSERT INTO (\w+_permitidos)/, (sql, [m, v]) => {
      const tab = /INTO (\w+)/.exec(sql)[1];
      if (falharEm === v) throw new Error('falha simulada');
      dados[tab].push([m, v]); return { affectedRows: 1 };
    }]
  ];
  const f = criarPoolFalso(regras);
  // rollback de verdade no banco falso: restaura o estado da última BEGIN
  let foto = null;
  const gc = f.getConnection;
  f.getConnection = async () => {
    const c = await gc();
    const bt = c.beginTransaction, rb = c.rollback;
    c.beginTransaction = async () => { foto = JSON.parse(JSON.stringify(dados)); return bt(); };
    c.rollback = async () => { if (foto) for (const k of Object.keys(dados)) dados[k] = foto[k]; return rb(); };
    return c;
  };
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Caio', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados: [], ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const cab = { Authorization: 'Bearer ' + jwt.sign({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' }) };
  return {
    dados, inicial, auditoria, pool: f,
    get: c => fetch(s.url + c, { headers: cab }),
    put: (c, corpo) => fetch(s.url + c, { method: 'PUT', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  };
}

test('GET: 403 sem permissão, 404 perfil inexistente, 400 código ruim', async t => {
  const so = await preparar(t, 'Só produtos');
  assert.equal((await so.get('/produtos/13/permitidos')).status, 403);
  assert.equal((await so.put('/produtos/13/permitidos', { puxadores: ['PX1'] })).status, 403);
  const m = await preparar(t);
  assert.equal((await m.get('/produtos/99/permitidos')).status, 404);
  assert.equal((await m.get('/produtos/abc/permitidos')).status, 400);
});

test('GET: devolve as 5 listas do MODELO e as opções', async t => {
  const m = await preparar(t);
  const r = await m.get('/produtos/13/permitidos');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.modelo, '1036');
  assert.deepEqual(j.permitidos.tiposProduto, ['Porta de Correr', 'Porta de Giro']);
  assert.deepEqual(j.permitidos.acabamentos, ['Anodizado']);
  assert.deepEqual(j.permitidos.divisores, ['DV1']);
  assert.deepEqual(j.opcoes.acabamentos, ['Anodizado', 'Branco', 'Preto']);
  assert.deepEqual(j.opcoes.puxadores, ['PX1', 'PX2']);
  assert.deepEqual(j.opcoes.tiposProduto, ['Janela', 'Porta de Correr', 'Porta de Giro']);
});

test('PUT: 404 perfil inexistente; 400 valor inválido (lista os inválidos) sem gravar nada', async t => {
  const m = await preparar(t);
  assert.equal((await m.put('/produtos/99/permitidos', { puxadores: ['PX1'] })).status, 404);
  const r = await m.put('/produtos/13/permitidos', { puxadores: ['PX2', 'NAO-EXISTE'], acabamentos: ['Rosa'] });
  assert.equal(r.status, 400);
  assert.deepEqual((await r.json()).invalidos, { puxadores: ['NAO-EXISTE'], acabamentos: ['Rosa'] });
  assert.deepEqual(m.dados, m.inicial);
  assert.equal(m.auditoria.length, 0);
  assert.equal((await m.put('/produtos/13/permitidos', {})).status, 400);
  assert.equal((await m.put('/produtos/13/permitidos', { puxadores: 'PX1' })).status, 400);
});

test('PUT: esvaziar sem confirmarVazio = 400; com confirmarVazio esvazia só aquele grupo do MODELO', async t => {
  const m = await preparar(t);
  const r = await m.put('/produtos/13/permitidos', { divisores: [] });
  assert.equal(r.status, 400);
  assert.deepEqual((await r.json()).gruposVazios, ['divisores']);
  assert.deepEqual(m.dados, m.inicial);
  const ok = await m.put('/produtos/13/permitidos', { divisores: [], confirmarVazio: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(m.dados.divisores_permitidos, []);
  assert.deepEqual(m.dados.puxadores_permitidos, m.inicial.puxadores_permitidos);
});

test('PUT: grava só os grupos enviados e só o MODELO; P-14 intacto; auditoria com antes/depois e quem', async t => {
  const m = await preparar(t);
  const r = await m.put('/produtos/13/permitidos', { puxadores: [' PX1 ', 'px2', 'PX2'], tiposProduto: ['Janela'] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.alterados.sort(), ['puxadores', 'tiposProduto']);
  assert.deepEqual(j.permitidos.puxadores, ['PX1', 'PX2']);
  assert.deepEqual(j.permitidos.acabamentos, ['Anodizado']);
  const so = (tab, mod) => m.dados[tab].filter(l => l[0] === mod).map(l => l[1]).sort();
  assert.deepEqual(so('puxadores_permitidos', '1036'), ['PX1', 'PX2']);
  assert.deepEqual(so('perfis_permitidos', '1036'), ['Janela']);
  assert.deepEqual(m.dados.acabamentos_permitidos, m.inicial.acabamentos_permitidos); // grupo não enviado
  assert.deepEqual(m.dados.revestimentos_permitidos, m.inicial.revestimentos_permitidos);
  assert.deepEqual(so('puxadores_permitidos', 'P-14'), ['PX1']);
  assert.deepEqual(so('perfis_permitidos', 'P-14'), ['Janela']);
  assert.equal(m.auditoria.length, 1);
  const a = m.auditoria[0];
  assert.equal(a.acao, 'produto_dependencias_gravadas'); assert.equal(a.quem, 'Caio'); assert.equal(a.alvo, '13');
  assert.deepEqual(a.detalhe.grupos.puxadores, { antes: ['PX1'], depois: ['PX1', 'PX2'] });
  assert.deepEqual(a.detalhe.grupos.tiposProduto.antes, ['Porta de Correr', 'Porta de Giro']);
  assert.ok(m.pool.chamadas.some(c => /FOR UPDATE/.test(c.sql)));
  assert.ok(!m.pool.chamadas.some(c => /modelos_permitidos_serralheria/.test(c.sql)));
});

test('PUT: sem mudança não grava nada nem audita', async t => {
  const m = await preparar(t);
  const r = await m.put('/produtos/13/permitidos', { puxadores: ['PX1'] });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).alterados, []);
  assert.ok(!m.pool.chamadas.some(c => /^(DELETE|INSERT INTO \w+_permitidos)/.test(c.sql)));
  assert.equal(m.auditoria.length, 0);
});

test('PUT: falha no meio dá rollback e 500, sem estado parcial nem auditoria', async t => {
  const m = await preparar(t, 'Editor', { falharEm: 'Branco' });
  const r = await m.put('/produtos/13/permitidos', { puxadores: ['PX2'], acabamentos: ['Anodizado', 'Branco'] });
  assert.equal(r.status, 500);
  assert.deepEqual(m.dados, m.inicial);
  assert.equal(m.auditoria.length, 0);
  assert.ok(m.pool.chamadas.some(c => c.sql === 'ROLLBACK'));
});

test('permissão: catálogo tem produtos.dependencias, só o Administrador a recebe (perfil e migração única)', async () => {
  assert.ok(CODIGOS.has('produtos.dependencias'));
  const tem = n => PERFIS_INICIAIS.find(p => p.nome === n).permissoes.includes('produtos.dependencias');
  assert.ok(tem('Administrador'));
  for (const n of ['Interno completo', 'Vendedor', 'Estoquista', 'Representante', 'Operador']) assert.ok(!tem(n), n);
  const ins = [], aud = [];
  const f = criarPoolFalso([
    [/^SELECT id FROM web_auditoria/, () => (aud.length ? [{ id: 1 }] : [])],
    [/^SELECT id, nome FROM web_perfis/, () => [{ id: 1, nome: 'Administrador' }]],
    [/^INSERT IGNORE INTO web_perfil_permissoes/, (sql, p) => { ins.push(p); return { affectedRows: 1 }; }],
    [/^INSERT INTO web_auditoria/, (sql, p) => { aud.push(p); return { affectedRows: 1 }; }]
  ]);
  assert.equal((await acrescentarPermissoesProdutosDependencias(f)).feito, true);
  assert.deepEqual(ins, [[1, 'produtos.dependencias']]);
  assert.equal((await acrescentarPermissoesProdutosDependencias(f)).feito, false);
});
