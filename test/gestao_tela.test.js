// Tela da Central de Gestão: lógica pura e conferência do HTML/layout estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../gestao.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('gestão: formatação em reais e percentuais, sempre "—" para ausente (nunca NaN/0 inventado)', () => {
  assert.match(T.moeda(1234.5), /^R\$\s1\.234,50$/);
  assert.equal(T.moeda(null), '—');
  assert.equal(T.moeda(undefined), '—');
  assert.equal(T.moeda(NaN), '—');
  assert.equal(T.pct(12.5), '12,5%');
  assert.equal(T.pct(null), '—');
  assert.match(T.sinal(-10), /^-R\$\s10,00$|^−R\$|^-\s?R\$\s10,00$/);
  assert.match(T.sinal(10), /^\+R\$\s10,00$/);
  assert.equal(T.sinal(null), '—');
});

test('gestão: lerDinheiro igual ao do servidor (milhar ambíguo e negativo recusados)', () => {
  for (const [e, s] of [['1500', 1500], ['1.500,50', 1500.5], ['1500,5', 1500.5], ['1500.5', 1500.5], ['R$ 20', 20], ['0', 0]]) assert.equal(T.lerDinheiro(e), s, e);
  for (const e of ['1.500', '-1', 'abc', '', '1,234']) assert.ok(Number.isNaN(T.lerDinheiro(e)), e);
  assert.equal(T.paraCampo(1500.5), '1500,5');
});

test('gestão: meses (validação, navegação, rótulo)', () => {
  assert.equal(T.mesValido('2026-10'), true);
  assert.equal(T.mesValido('2026-13'), false);
  assert.equal(T.somarMeses('2026-12', 1), '2027-01');
  assert.equal(T.somarMeses('2026-01', -1), '2025-12');
  assert.equal(T.mesDeHoje(new Date(2026, 9, 27)), '2026-10');
  assert.equal(T.rotuloMes('2026-10'), 'outubro de 2026');
  assert.equal(T.rotuloMes('x'), '');
});

test('gestão: texto de meta explica "sem meta" e "não calculável" em vez de mostrar número', () => {
  assert.equal(T.textoComparacao({ estado: 'sem_meta', motivo: 'Nenhuma meta definida para este mês.' }).principal, 'Sem meta');
  assert.equal(T.textoComparacao({ estado: 'nao_calculavel', motivo: 'Meta igual a zero: percentual não calculável.' }).principal, 'Não calculável');
  const ok = T.textoComparacao({ estado: 'ok', percentual: 75, diferenca: -250 });
  assert.equal(ok.principal, '75% da meta');
  assert.match(ok.detalhe, /Diferença/);
  assert.match(T.textoVariacao({ absoluta: 10, percentual: null, motivo: 'x' }, 'vs. mês anterior'), /percentual não calculável/);
  assert.match(T.textoVariacao({ absoluta: null, percentual: null }, 'vs. ano'), /sem dado para comparar/);
  assert.match(T.textoVariacao({ absoluta: 50, percentual: 25 }, 'vs. mês'), /\+25%/);
});

test('gestão: risco sempre tem texto e símbolo além da cor; barra limitada a 0-100', () => {
  for (const r of Object.keys(T.RISCO)) { assert.ok(T.RISCO[r].texto && T.RISCO[r].simbolo && T.RISCO[r].classe, r); }
  assert.equal(T.riscoDe('estourado').texto, 'Estourado');
  assert.equal(T.riscoDe('inexistente').texto, 'Não calculável');
  assert.equal(T.larguraBarra(250), 100);
  assert.equal(T.larguraBarra(-5), 0);
  assert.equal(T.larguraBarra(null), 0);
  assert.equal(T.larguraBarra(42.5), 42.5);
});

test('gestão: validação e corpo dos formulários', () => {
  assert.deepEqual(T.validarMetaForm({ mes: '2026-10', tipo: 'despesa', valor: '100' }), []);
  assert.equal(T.validarMetaForm({ mes: '', tipo: 'x', valor: '1.500' }).length, 3);
  assert.deepEqual(T.corpoMeta({ mes: ' 2026-10 ', tipo: 'despesa', valor: ' 10 ', origem: 'vb' }), { mes: '2026-10', tipo: 'despesa', valor: '10', origem: 'vb' });
  assert.equal(T.corpoMeta({ mes: '2026-10', tipo: 'despesa', valor: '1', origem: 'hack' }).origem, 'web');
  assert.deepEqual(T.validarOrcamentoForm({ mes: '2026-10', classificacaoId: '2', valor: '10', limiarAtencao: '60', limiarAlerta: '80' }), []);
  assert.ok(T.validarOrcamentoForm({ mes: '2026-10', classificacaoId: '', valor: '10' }).join().includes('categoria'));
  assert.ok(T.validarOrcamentoForm({ mes: '2026-10', classificacaoId: '2', valor: '10', limiarAtencao: '90', limiarAlerta: '80' }).join().includes('menor'));
  assert.ok(T.validarOrcamentoForm({ mes: '2026-10', classificacaoId: '2', valor: '10', limiarAlerta: '150' }).join().includes('entre 1 e 100'));
  const b = T.corpoOrcamento({ mes: '2026-10', classificacaoId: '2', nivel: '2', valor: '10', limiarAtencao: '', limiarAlerta: '80' });
  assert.deepEqual(b, { mes: '2026-10', classificacaoId: 2, nivel: 2, valor: '10', limiarAlerta: '80' });
});

test('gestão: HTML dos blocos escapa texto vindo da API e rotula realizado x previsto', () => {
  const caixa = T.htmlCaixa({ realizado: { entradas: 10, saidas: 5, resultado: 5 }, previsto: { aReceber: 3, aPagar: 2 }, semLancamentos: false, fonte: '<img src=x>' });
  assert.match(caixa, /Realizado \(já aconteceu\)/);
  assert.match(caixa, /Previsto \(ainda não é caixa\)/);
  assert.match(caixa, /Previsão não é caixa/);
  assert.ok(!caixa.includes('<img'));
  const al = T.htmlAlertas([{ gravidade: 'critico', titulo: '<b>x</b>', motivo: '<script>1</script>', periodo: '2026-10', fonte: 'f' }]);
  assert.ok(!al.includes('<script>') && !al.includes('<b>x'));
  assert.match(al, /Crítico/);
  assert.match(al, /Período: 2026-10/);
  assert.match(T.htmlAlertas([]), /Nenhum alerta/);
  const cart = T.htmlCartao('Faturamento x meta', { realizado: 100, meta: null, fonte: 'ped_orc' }, { estado: 'sem_meta', motivo: 'Nenhuma meta definida para este mês.' });
  assert.match(cart, /sem meta/);
  assert.match(cart, /Sem meta/);
  assert.match(cart, /Fonte: ped_orc/);
});

test('gestão: tabela de orçamento tem rótulo de texto no risco, barra com largura e linha "Sem categoria"', () => {
  const item = { rotulo: 'Materiais <x>', orcado: 1000, realizadoPago: 1250, aPagar: 0, saldo: -250, consumidoPct: 125, projecao: 1250, dadosInsuficientes: false, risco: 'estourado', motivo: null, qtdLancamentos: 3, categoriaRemovida: false };
  const html = T.htmlOrcamento({ itens: [item, { ...item, rotulo: 'Sem orçamento', orcado: null, consumidoPct: null, saldo: null, risco: 'sem_orcamento', projecao: null }],
    semCategoria: { rotulo: 'Sem categoria', realizadoPago: 10, aPagar: 0, qtdLancamentos: 1 } });
  assert.match(html, /✖ Estourado/);
  assert.match(html, /width:100%/);          // 125% limitado
  assert.match(html, /125% consumido/);       // o excedente aparece no texto
  assert.match(html, /sem orçamento/);
  assert.match(html, /Sem categoria/);
  assert.match(html, /limitação de qualidade/);
  assert.ok(!html.includes('<x>'));
  assert.match(T.htmlOrcamento({ itens: [], semCategoria: { qtdLancamentos: 0 } }), /Nenhuma despesa/);
  const insuf = T.htmlOrcamento({ itens: [{ ...item, risco: 'ok', consumidoPct: 10, projecao: null, dadosInsuficientes: true }], semCategoria: { qtdLancamentos: 0 } });
  assert.match(insuf, /dados insuficientes/);
});

test('página: scripts, CSP, ids, formulários só com gestao.editar, sem handlers inline', () => {
  const h = ler('gestao.html');
  assert.match(h, /Content-Security-Policy/);
  assert.match(h, /name="viewport"/);
  assert.ok(h.includes('<script src="layout.js'));
  assert.ok(h.includes('<script src="entregas_comum.js'));
  assert.ok(h.includes('<script src="gestao.js'));
  assert.ok(h.includes('tema.css'));
  for (const id of ['mes', 'mes-ant', 'mes-prox', 'cartao-faturamento', 'cartao-despesa', 'caixa', 'alertas', 'orcamento', 'form-meta', 'form-orc', 'btn-vb', 'm-tipo', 'm-valor', 'o-categoria', 'o-valor', 'erro-meta', 'erro-orc', 'limitacoes']) {
    assert.ok(h.includes(`id="${id}"`), id);
  }
  assert.match(h, /id="forms" data-perm="gestao\.editar"/);
  assert.ok(h.includes('Previsão não é caixa') || T.htmlCaixa({ realizado: {}, previsto: {} }).includes('Previsão não é caixa'));
  assert.doesNotMatch(h, /\son(click|change|submit|error|load)=/);
  assert.doesNotMatch(h, /<script[^>]*src="https?:/);   // sem script de terceiros (gráficos são barras em CSS)
});

test('layout.js: Central de Gestão no menu (subitem do Financeiro) e em PAGINAS com gestao.ver + valores.ver', () => {
  const l = ler('layout.js');
  assert.match(l, /href: 'gestao\.html', texto: 'Central de Gestão'/);
  assert.match(l, /'gestao\.html': \['gestao\.ver', 'valores\.ver'\]/);
  assert.ok(l.indexOf("href: 'gestao.html'") > l.indexOf("href: 'financeiro.html'") && l.indexOf("href: 'gestao.html'") < l.indexOf("href: 'usuarios.html'"));
  assert.match(l, /'minhas_entregas\.html': \['entregas\.baixar'\]\s*\/\/ por último/);
});
