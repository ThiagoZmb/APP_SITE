process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { PERFIS_INICIAIS } = require('../seguranca/permissoes');
const C = require('../calculo/cores');
aceitarSidDeTeste(sessoes);

const LINHAS = [
  { NOME_COR: '1502Y50R PERFIL VIDRO', TIPO: '' },
  { NOME_COR: 'Acritop Standard', TIPO: null },
  { NOME_COR: 'AD04645Y', TIPO: '   ' },
  { NOME_COR: 'Atenas', TIPO: 'Sólida' },
  { NOME_COR: 'Atlantis', TIPO: 'SOLIDA' },
  { NOME_COR: 'África', TIPO: ' sólida ' },
  { NOME_COR: 'Ametista', TIPO: 'Metálica' },
  { NOME_COR: 'Aquamarine', TIPO: 'metalica' },
  { NOME_COR: 'Pirita', TIPO: 'METÁLICA' },
  { NOME_COR: 'Branco Fosco EL', TIPO: 'Eletrostática' },
  { NOME_COR: 'Estranha', TIPO: 'Sólida Metálica' },
  { NOME_COR: '   ', TIPO: 'Sólida' },
  { NOME_COR: 'Atenas', TIPO: 'Sólida' }
];

test('tipoCorPermitido: só Sólida e Metálica, tolerante a caixa, acento e espaços', () => {
  assert.equal(C.tipoCorPermitido('Sólida'), 'Sólida');
  assert.equal(C.tipoCorPermitido(' SOLIDA '), 'Sólida');
  assert.equal(C.tipoCorPermitido('metalica'), 'Metálica');
  assert.equal(C.tipoCorPermitido('MetÁlica'), 'Metálica');
  for (const ruim of ['', null, undefined, '  ', 'Eletrostática', 'Sólida Metálica', 'Outro']) assert.equal(C.tipoCorPermitido(ruim), null);
});

test('agruparCoresPermitidas: descarta TIPO vazio/Eletrostática/outros, nome vazio e repetidos', () => {
  const g = C.agruparCoresPermitidas(LINHAS);
  assert.deepEqual(g, { 'Sólida': ['Atenas', 'Atlantis', 'África'], 'Metálica': ['Ametista', 'Aquamarine', 'Pirita'] });
  assert.deepEqual(C.nomesCoresPermitidas(LINHAS), ['Atenas', 'Atlantis', 'África', 'Ametista', 'Aquamarine', 'Pirita']);
  assert.deepEqual(C.agruparCoresPermitidas(null), { 'Sólida': [], 'Metálica': [] });
});

test('tipoCorDoAcabamento e coresDoAcabamento: Pintura Sólida só Sólida, Pintura Metálica só Metálica', () => {
  const g = C.agruparCoresPermitidas(LINHAS);
  assert.equal(C.tipoCorDoAcabamento('Pintura Sólida Aço Carbono'), 'Sólida');
  assert.equal(C.tipoCorDoAcabamento('Pintura Aço Carbono Eletrostática Sólida'), 'Sólida');
  assert.equal(C.tipoCorDoAcabamento('Pintura Metálica Alumínio'), 'Metálica');
  assert.equal(C.tipoCorDoAcabamento('Anodizado Natural'), null);
  assert.equal(C.tipoCorDoAcabamento('Sem pintura'), null);
  assert.deepEqual(C.coresDoAcabamento(g, 'Pintura Sólida Aço Carbono'), ['Atenas', 'Atlantis', 'África']);
  assert.deepEqual(C.coresDoAcabamento(g, 'Pintura Metálica M²'), ['Ametista', 'Aquamarine', 'Pirita']);
  assert.deepEqual(C.coresDoAcabamento(g, 'Anodizado Bronze'), []);
});

const USUARIO = { nome: 'Admin', perfil: 'Administrador', permissoes: new Set(PERFIS_INICIAIS.find(p => p.nome === 'Administrador').permissoes), estados: [] };
const tk = jwt.sign({ id: 1, nome: 'Admin', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t) {
  const f = criarPoolFalso([[/FROM cores/i, LINHAS]]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: USUARIO.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id, nome: USUARIO.perfil }, estados: [], ativo: true, permissoes: USUARIO.permissoes }));
  t.mock.method(console, 'warn', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  return caminho => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + tk } });
}

test('GET /cores_por_tipo devolve só Sólida e Metálica', async t => {
  const get = await preparar(t);
  const r = await get('/cores_por_tipo');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { 'Sólida': ['Atenas', 'Atlantis', 'África'], 'Metálica': ['Ametista', 'Aquamarine', 'Pirita'] });
});

test('GET /catalogos: a lista "cores" também só traz Sólida e Metálica', async t => {
  const get = await preparar(t);
  const r = await get('/catalogos');
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).cores, ['Atenas', 'Atlantis', 'África', 'Ametista', 'Aquamarine', 'Pirita']);
});

test('orcamentos.html: Serralheria filtra a cor pelo acabamento e item antigo mantém a cor gravada', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.match(html, /getElementById\('f-acab-serr'\)\.addEventListener\('change', aoMudarAcabSerr\)/);
  assert.match(html, /function aoMudarAcabSerr\(\) \{ filtrarCores\('f-cor-serr', val\('f-acab-serr'\)\); \}/);
  assert.ok(!/popularCores\(/.test(html), 'lista de cores sem filtro não pode mais ser usada');
  assert.match(html, /selecionarComboPorTexto\('f-cor-serr', p\.corSerr\)/);
  assert.match(html, /selecionarComboPorTexto\('f-cor-serr', d\.corSerr\)/);
});
