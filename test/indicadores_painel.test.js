// Indicadores de Pedidos e Orçamentos ("Operação agora" e "Resultado do período"): permissão indicadores.ver
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { acrescentarPermissoesIndicadores } = require('../seguranca/instalacao');
const { CATALOGO, PERFIS_INICIAIS, permissoesFinais } = require('../seguranca/permissoes');

const html = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8');

test('indicadores.ver está no catálogo (área Painéis) e só o Administrador a recebe nos perfis iniciais', () => {
  const p = CATALOGO.find(x => x.codigo === 'indicadores.ver');
  assert.ok(p);
  assert.equal(p.area, 'Painéis');
  for (const perfil of PERFIS_INICIAIS) assert.equal(perfil.permissoes.includes('indicadores.ver'), perfil.nome === 'Administrador', perfil.nome);
});

test('permissoesFinais: sem a permissão não vem; com perfil ou exceção "liberar" vem; "bloquear" tira', () => {
  assert.ok(!permissoesFinais({ permissoesPerfil: ['pedidos.ver'], ativo: true }).has('indicadores.ver'));
  assert.ok(permissoesFinais({ permissoesPerfil: ['pedidos.ver', 'indicadores.ver'], ativo: true }).has('indicadores.ver'));
  assert.ok(permissoesFinais({ permissoesPerfil: ['pedidos.ver'], excecoes: [{ permissao: 'indicadores.ver', tipo: 'liberar' }], ativo: true }).has('indicadores.ver'));
  assert.ok(!permissoesFinais({ permissoesPerfil: ['indicadores.ver'], excecoes: [{ permissao: 'indicadores.ver', tipo: 'bloquear' }], ativo: true }).has('indicadores.ver'));
});

function poolInd({ jaFeito = false } = {}) {
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_indicadores'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id FROM web_perfis WHERE nome = 'Administrador'/, [{ id: 1 }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
}

test('acrescentarPermissoesIndicadores: só o Administrador, uma vez', async () => {
  const pool = poolInd();
  assert.deepEqual(await acrescentarPermissoesIndicadores(pool), { feito: true });
  assert.deepEqual(pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params), [[1, 'indicadores.ver']]);
  assert.ok(!pool.chamadas.some(c => /Interno completo/.test(c.sql)));
  const ja = poolInd({ jaFeito: true });
  assert.deepEqual(await acrescentarPermissoesIndicadores(ja), { feito: false });
  assert.ok(!ja.chamadas.some(c => /INSERT/.test(c.sql)));
});

test('painel_inicial: os dois blocos exigem indicadores.ver (data-perm) e os números vêm do servidor, não do navegador', () => {
  assert.match(html, /data-perm="indicadores\.ver"[^>]*>\s*<div class="cab"><h3>Operação agora/);
  assert.match(html, /data-perm="indicadores\.ver">Resultado do período/);
  assert.match(html, /data-perm="indicadores\.ver" id="kpis-periodo"/);
  // sem a permissão nem se pede ao servidor
  assert.match(html, /async function carregarIndicadores\(\) \{\s*if \(!Acesso\.pode\('indicadores\.ver'\)\) return;/);
  assert.match(html, /api\('\/painel\/indicadores\?periodo='/);
  // os dois renders só recebem a resposta do servidor; as contas locais não escrevem HTML nos dois blocos
  assert.match(html, /function renderOperacao\(d\)/);
  assert.match(html, /function renderPeriodo\(d\)/);
  const calc = html.slice(html.indexOf('function calcularResumo'), html.indexOf('async function carregarIndicadores'));
  assert.ok(!/kpis-periodo|innerHTML/.test(calc));
  const calcOp = html.slice(html.indexOf('function calcularOperacao'), html.indexOf('function renderOperacao'));
  assert.ok(!/\$\('operacao'\)|innerHTML/.test(calcOp));
});
