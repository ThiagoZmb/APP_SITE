// Etapas de produção: registro das rotas (registro.verificar), autenticação, instalação das tabelas e permissões por perfil, ligações no código.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, registro } = require('../index.js');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { instalarTabelas, acrescentarPermissoesEtapas } = require('../seguranca/instalacao');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('rotas das etapas registradas pelo registro (verificar passa) e nenhuma é pública', () => {
  assert.doesNotThrow(() => registro.verificar());
  const aut = registro.rotasAutenticadas().map(r => `${r.metodo.toUpperCase()} ${r.caminho}`);
  for (const r of ['GET /etapas/fila', 'PUT /etapas/pedido/:numero/:etapa', 'GET /etapas/pedido/:numero/historico']) assert.ok(aut.includes(r), r);
  assert.ok(!registro.rotasPublicas().some(r => r.caminho.startsWith('/etapas')));
  assert.match(ler('rotas/etapas_producao.js'), /const VER = \['etapas\.ver'\];/);
  assert.equal((ler('rotas/etapas_producao.js').match(/rota\('(get|put)', '\/etapas[^']*', VER,/g) || []).length, 3);
});

test('sem token: 401 nas três rotas', async t => {
  const s = await subir(app); t.after(s.fechar);
  for (const [m, c] of [['GET', '/etapas/fila'], ['PUT', '/etapas/pedido/1/perfil_cortado'], ['GET', '/etapas/pedido/1/historico']]) {
    assert.equal((await fetch(s.url + c, { method: m })).status, 401, `${m} ${c}`);
  }
});

test('instalação: web_producao_etapas (UNIQUE numero+etapa, estados e origens) e eventos, sem FK para o VB', async () => {
  const pool = criarPoolFalso([]);
  await instalarTabelas(pool);
  const sql = nome => pool.chamadas.find(c => new RegExp('`' + nome + '`').test(c.sql)).sql;
  const et = sql('web_producao_etapas'), ev = sql('web_producao_etapas_eventos');
  assert.ok(et.includes('UNIQUE KEY uq_producao_etapa (numero, etapa)'));
  assert.ok(et.includes("ENUM('pendente','ok','na')") && et.includes("ENUM('manual','corte')"));
  assert.ok(ev.includes('estado_antes VARCHAR(10) NULL') && ev.includes("ENUM('manual','corte','sistema')"));
  assert.doesNotMatch(et + ev, /FOREIGN KEY|REFERENCES/);
  // nenhuma instrução da instalação altera tabela do VB por causa das etapas
  assert.ok(!pool.chamadas.some(c => /ALTER TABLE (ped_orc|perfis|vidros)/.test(c.sql)));
});

test('permissões padrão: Administrador recebe todas; Interno completo ver + 5 etapas (sem finalizar nem gerir); uma vez só', async () => {
  const poolEtapas = ({ jaFeito = false } = {}) => criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_etapas'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id, nome FROM web_perfis WHERE nome IN/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
  const p = poolEtapas();
  assert.deepEqual(await acrescentarPermissoesEtapas(p), { feito: true });
  const dadas = p.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params);
  assert.deepEqual(dadas.filter(([id]) => id === 1).map(([, c]) => c), ['etapas.ver', 'etapas.corte_perfil', 'etapas.corte_vidro', 'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem', 'etapas.finalizar', 'etapas.gerir']);
  assert.deepEqual(dadas.filter(([id]) => id === 2).map(([, c]) => c), ['etapas.ver', 'etapas.corte_perfil', 'etapas.corte_vidro', 'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem']);
  assert.ok(p.chamadas.some(c => c.sql === 'COMMIT'));
  assert.deepEqual(await acrescentarPermissoesEtapas(poolEtapas({ jaFeito: true })), { feito: false });
  assert.match(ler('index.js'), /acrescentarPermissoesEtapas\(pool\)/);
  assert.match(ler('index.js'), /registrarEtapasProducao\(\{ rota: registro\.rota, pool \}\)/);
});

test('ligações: corte e vidros reavaliam a etapa depois do commit; ped_orc usa a mesma função de situação no menu e nas etapas', () => {
  for (const f of ['rotas/corte.js', 'rotas/corte_vidros.js']) {
    const s = ler(f);
    assert.equal((s.match(/if \(r\) await etapaAposCorte\(pool,/g) || []).length, 3, `${f}: confirmar, excluir dados e cancelar plano`);
    // a chamada vem DEPOIS do emTransacao (nunca dentro da transação do corte)
    const i = s.indexOf("'POST /corte"), j = s.indexOf('etapaAposCorte(pool, pedido');
    assert.ok(i > 0 && j > i);
  }
  const p = ler('rotas/ped_orc.js');
  assert.match(p, /aplicarSituacaoPedido\(conn, req, alvo, linhas\.cab, \{ nova, manterData, usarDataPronto, escolhida \}\)/);
  assert.match(p, /await desmarcarEtapasDoCorte\(conn, alvo\.numero/);
  assert.match(p, /await apagarEtapasDoPedido\(conn, alvo\.numero/);
  const e = ler('rotas/etapas_producao.js');
  assert.match(e, /aplicarSituacaoPedido\(conn, req, alvo, cab, \{ nova: 'Pronto', origem: 'etapas_producao' \}\)/);
  assert.doesNotMatch(e, /UPDATE ped_orc/, 'a rota das etapas não grava ped_orc por conta própria');
});
