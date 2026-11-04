// Modal "Alteração de valores": composição sequencial gravada como um % único sobre a base (compatível com o VB).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../alteracao_valor.js');
const { fatorHistorico } = require('../calculo/precos');

const arred2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
// o que o servidor/VB fazem ao ler a string gravada
const lido = (base, h) => arred2(base * fatorHistorico(h));

test('valor final 300 sobre 247,17 e depois +10% = 330,00 (não 324,72)', () => {
  const a = A.compor({ base: 247.17, historico: '', operacao: '', alvo: 300 });
  assert.equal(a.valor, 300);
  assert.match(a.historico, /^\+21\.\d+$/);
  assert.equal(lido(247.17, a.historico), 300);
  const b = A.compor({ base: 247.17, historico: a.historico, operacao: '+10' });
  assert.equal(b.atual, 300);
  assert.equal(b.valor, 330);
  assert.equal(lido(247.17, b.historico), 330);
  assert.equal(b.historico.includes(';'), false, 'um único percentual');
});

test('cadeia de operações: x -> +10 -> -5 -> +7 compõe sobre o valor atual', () => {
  let h = '';
  let esperado = 247.17;
  for (const op of ['+10', '-5', '+7', '+0.5']) {
    const r = A.compor({ base: 247.17, historico: h, operacao: op });
    esperado = arred2(esperado * (1 + parseFloat(op) / 100));
    assert.equal(r.valor, esperado);
    assert.equal(lido(247.17, r.historico), esperado);
    h = r.historico;
  }
});

test('sem operação nem alvo mantém a string gravada como está', () => {
  const r = A.compor({ base: 100, historico: '+100;+10', operacao: '' });
  assert.equal(r.historico, '+100;+10');
  assert.equal(r.valor, 210);
});

test('histórico antigo com várias partes (soma sobre a base) vira ponto de partida e colapsa', () => {
  const r = A.compor({ base: 100, historico: '+100;+10', operacao: '+10' });
  assert.equal(r.valor, 231);
  assert.equal(r.historico, '+131');
  assert.equal(lido(100, r.historico), 231);
});

test('desconto e volta ao valor original', () => {
  const r = A.compor({ base: 80, historico: '', operacao: '-25' });
  assert.equal(r.valor, 60);
  assert.equal(r.historico, '-25');
  const v = A.compor({ base: 80, historico: '', alvo: 80 });
  assert.equal(v.historico, '');
  assert.equal(v.valor, 80);
});

test('valor final exato mesmo com base grande e centavos (varredura)', () => {
  for (const base of [0.37, 12.5, 247.17, 1999.99, 100000.01, 987654.32]) {
    for (const alvo of [0.01, base * 0.5, base, base * 1.2137, base * 3.333, 5000.55]) {
      const r = A.compor({ base, historico: '', alvo });
      assert.equal(lido(base, r.historico), arred2(alvo), `${base} -> ${alvo}`);
      assert.equal(r.valor, arred2(alvo));
    }
  }
});

test('orcamentos.html usa AlteracaoValor.compor e carrega o script', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.ok(h.includes('src="alteracao_valor.js'));
  assert.ok(h.includes('AlteracaoValor.compor'));
  assert.ok(!h.includes('historicoExibicao'));
});
