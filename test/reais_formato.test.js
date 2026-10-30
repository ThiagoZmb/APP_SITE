// Todo valor em dinheiro exibido deve sair como "R$ 1.234,56" (docs/revisao_reais.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../notas_fiscais.js');
const T = require('../tintas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const norm = s => s.replace(/\u00a0/g, ' ');

test('notas fiscais e tintas: moeda() devolve R$ com milhar e vírgula', () => {
  for (const m of [N.moeda, T.moeda]) {
    assert.equal(norm(m(1234.5)), 'R$ 1.234,50');
    assert.equal(norm(m('10')), 'R$ 10,00');
    assert.equal(norm(m(0)), 'R$ 0,00');
  }
});

test('notas fiscais e tintas: a coluna Valor usa moeda(), não número solto', () => {
  assert.match(ler('notas_fiscais.js'), /esc\(moeda\(n\.valorTotal\)\)/);
  assert.match(ler('tintas.js'), /esc\(moeda\(t\.valor\)\)/);
  assert.doesNotMatch(ler('notas_fiscais.js'), /valorTotal\)\.toLocaleString/);
  assert.doesNotMatch(ler('tintas.js'), /t\.valor\)\.toLocaleString/);
});

test('formatadores das telas são monetários (currency BRL ou prefixo R$)', () => {
  const telas = ['financeiro.html', 'clientes.html', 'cliente_analise.html', 'estoque.html', 'inicio.html', 'produtos.html',
    'movimentacao_estoque.html', 'painel_inicial.html', 'gestao.js'];
  for (const f of telas) {
    const linhas = ler(f).split('\n').filter(l => /^\s*const moeda\s*=/.test(l));
    assert.ok(linhas.length, `${f} deve definir moeda`);
    for (const l of linhas) assert.match(l, /currency: 'BRL'/, f);
  }
  assert.match(ler('custos.html'), /const moeda = v => v == null \? '—' : 'R\$ '/);
  assert.match(ler('orcamentos.html'), /function formatCurrency[\s\S]{0,200}currency: 'BRL'/);
});

test('início: a faixa de atalhos fica dentro de um card destacado (tom rosado, borda e sombra média), no mesmo lugar da página', () => {
  const h = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'inicio.html'), 'utf8');
  const css = h.match(/\.atalhos \{[^}]*\}/)[0];
  assert.ok(css.includes('padding: 16px') && css.includes('border-radius: 20px') && css.includes('linear-gradient(180deg, #f7eef0, #f0e4e8)') && css.includes('border: 1px solid #e3cdd3') && css.includes('box-shadow: var(--shadow-medium)'));
  assert.ok(h.indexOf('<section class="atalhos">') > h.indexOf('<!-- ===== ATALHOS =====') && h.indexOf('<section class="atalhos">') < h.indexOf('<!-- ===== INDICADORES DO MÊS ====='), 'mesma posição');
});
