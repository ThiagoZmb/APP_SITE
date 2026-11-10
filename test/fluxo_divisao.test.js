// Tela do recebimento dividido: contas puras (fluxo_divisao.js) e ligação no financeiro.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../fluxo_divisao.js');
const { SITUACOES_ENTRADA } = require('../calculo/fluxo_varios');

const fmt = v => 'R$ ' + v.toFixed(2).replace('.', ',');
const L = (valor, situacao = 'Recebido') => ({ valor, situacao });

test('as situações da tela são as mesmas que o servidor aceita', () => {
  assert.deepEqual([...D.SITUACOES_ENTRADA].sort(), [...SITUACOES_ENTRADA].sort());
});

test('soma: A Receber entra na soma, mas não no que já foi recebido agora', () => {
  assert.deepEqual(D.somar([L(500), L(300.1), L(200, 'A Receber')]), { soma: 1000.1, recebidoAgora: 800.1 });
});

test('avaliar sem pedido: só a soma, sem aviso', () => {
  assert.deepEqual(D.avaliar([L(500), L(500)], null), { soma: 1000, recebidoAgora: 0 + 1000, cobreTotal: false, diferente: false });
});

test('avaliar com pedido: metade já recebida + metade agora cobre o total (quitar vem marcado)', () => {
  const resumo = { numero: 23376, total: 1000, recebido: 500, falta: 500 };
  const av = D.avaliar([L(300), L(200)], resumo);
  assert.equal(av.recebido, 1000);
  assert.equal(av.falta, 0);
  assert.equal(av.cobreTotal, true);
  assert.equal(av.diferente, false);
});

test('avaliar: soma diferente do que falta vira aviso, e não cobre o total', () => {
  const resumo = { numero: 5, total: 1000, recebido: 0, falta: 1000 };
  const av = D.avaliar([L(500), L(300)], resumo);
  assert.equal(av.cobreTotal, false);
  assert.equal(av.falta, 200);
  assert.equal(av.diferente, true);
  const t = D.textoResumo(av, resumo, fmt);
  assert.equal(t.aviso, true);
  assert.match(t.texto, /Pedido 5: total R\$ 1000,00 · já recebido R\$ 0,00 · com este lançamento R\$ 800,00 · falta R\$ 200,00/);
  assert.match(t.texto, /Atenção: a soma \(R\$ 800,00\) é diferente do que faltava receber \(R\$ 1000,00\)/);
});

test('linha "A Receber" não quita o pedido, mesmo somando o total', () => {
  const resumo = { numero: 5, total: 1000, recebido: 0, falta: 1000 };
  assert.equal(D.avaliar([L(500), L(500, 'A Receber')], resumo).cobreTotal, false);
});

test('texto do botão de salvar', () => {
  assert.equal(D.rotuloSalvar(1), '💾 Salvar');
  assert.equal(D.rotuloSalvar(3), '💾 Salvar 3 recebimentos');
});

test('financeiro.html: carrega fluxo_divisao.js antes do script principal e liga os pontos da gaveta', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'financeiro.html'), 'utf8');
  const tag = h.indexOf('src="fluxo_divisao.js');
  assert.ok(tag > 0 && tag < h.indexOf("const SITUACOES = {"), 'o arquivo carrega antes do script principal');
  for (const id of ['bloco-divisao', 'div-linhas', 'div-add', 'div-resumo', 'div-quitar-rotulo', 'div-quitar']) assert.match(h, new RegExp(`id="${id}"`), id);
  assert.match(h, /FluxoDivisao\.iniciar\(/);
  assert.match(h, /api\('\/fluxo\/salvar_varios'/);
  assert.match(h, /Divisao\.ativo\(\)/);
  assert.match(h, /Divisao\.reiniciar\(\)/);
  assert.match(h, /Divisao\.atualizarVisibilidade\(\)/);
});

test('fluxo_divisao.js: valores do banco só entram por escapeHtml/valor e nunca por innerHTML cru', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'fluxo_divisao.js'), 'utf8');
  const usos = s.split('\n').filter(l => /\$\{/.test(l) && /value="/.test(l));
  assert.ok(usos.length > 0);
  for (const l of usos) assert.match(l, /escapeHtml\(/, l.trim());
});
