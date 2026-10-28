// Tela de notas fiscais: lógica pura e conferência do HTML/layout estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../notas_fiscais.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const OK = { tipo: 'entrada', numero: '123', serie: '1', chave: '', dataEmissao: '2026-10-20', contraparteCodigo: '5', valorTotal: '10,5', observacao: '' };

test('notas tela: CAMPOS e paraTela', () => {
  assert.deepEqual(N.CAMPOS, ['tipo', 'numero', 'serie', 'chave', 'dataEmissao', 'contraparteCodigo', 'valorTotal', 'observacao']);
  assert.equal(N.paraTela(12.5), '12,5');
  assert.equal(N.paraTela(0), '0');
});

test('notas tela: validarForm criando (valor só com valores.ver)', () => {
  assert.deepEqual(N.validarForm(OK, { comValores: true }), []);
  assert.deepEqual(N.validarForm({ ...OK, valorTotal: '' }), []);
  const vazio = N.validarForm({ tipo: 'entrada' }, { comValores: true }).join(' ');
  for (const r of ['fornecedor', 'número', 'data', 'valor']) assert.ok(vazio.toLowerCase().includes(r), r);
  assert.ok(N.validarForm({ ...OK, tipo: 'saida', contraparteCodigo: '' }).join().includes('cliente'));
  assert.ok(N.validarForm({ ...OK, valorTotal: '1.234,56' }, { comValores: true }).join().includes('valor'));
  assert.ok(N.validarForm({ ...OK, chave: '123' }).join().toLowerCase().includes('chave'));
  assert.ok(N.validarForm({ ...OK, dataEmissao: '2026-02-30' }).join().includes('data'));
});

test('notas tela: validarForm editando só olha data e valor', () => {
  assert.deepEqual(N.validarForm({ dataEmissao: '2026-10-20', valorTotal: '5' }, { comValores: true, editando: true }), []);
  assert.ok(N.validarForm({ dataEmissao: '', valorTotal: '5' }, { comValores: true, editando: true }).join().includes('data'));
});

test('notas tela: corpoCriar e corpoEditar', () => {
  const b = N.corpoCriar({ ...OK, numero: ' 123 ', extra: 'x' }, { comValores: true });
  assert.equal(b.numero, '123');
  assert.equal('extra' in b, false);
  assert.equal(b.valorTotal, '10,5');
  assert.equal('valorTotal' in N.corpoCriar(OK), false);
  assert.deepEqual(Object.keys(N.corpoEditar(OK, { comValores: true })).sort(), ['dataEmissao', 'observacao', 'valorTotal']);
  assert.deepEqual(Object.keys(N.corpoEditar(OK)).sort(), ['dataEmissao', 'observacao']);
});

test('página: scripts, controles, permissão, sem handlers inline', () => {
  const h = ler('notas_fiscais.html');
  assert.match(h, /Content-Security-Policy/);
  assert.match(h, /name="viewport"/);
  for (const s of ['layout.js', 'entregas_comum.js', 'notas_fiscais.js']) assert.ok(h.includes(`<script src="${s}`), s);
  for (const id of ['aba-entrada', 'aba-saida', 'busca', 'de', 'ate', 'filtro-situacao', 'btn-novo', 'btn-salvar', 'btn-cancelar-nota', 'n-valorTotal', 'n-contraparteCodigo']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('data-perm="notas.editar"'));
  assert.ok(h.includes('data-valor'));
  assert.doesNotMatch(h, /\son(click|change|submit|error)=/);
});

test('layout.js: Notas fiscais no menu como subitem do Financeiro (logo abaixo dele) e em PAGINAS com notas.ver', () => {
  const l = ler('layout.js');
  assert.match(l, /href: 'notas_fiscais\.html', texto: 'Notas fiscais'/);
  assert.match(l, /'notas_fiscais\.html': \['notas\.ver'\]/);
  const pos = h => l.indexOf("href: '" + h + "'");
  assert.ok(pos('notas_fiscais.html') > pos('financeiro.html') && pos('notas_fiscais.html') < pos('usuarios.html'));
  assert.match(l, /href: 'notas_fiscais\.html'[^\n]*sub: true/);
  assert.ok(pos('notas_fiscais.html') > pos('funcionarios.html'), 'não pode ficar sob Fornecedores');
  assert.match(l, /'minhas_entregas\.html': \['entregas\.baixar'\]\s*\/\/ por último/);
});

test('página: aba ativa tem cor própria (entrada verde, saída azul)', () => {
  const h = ler('notas_fiscais.html');
  assert.match(h, /\.aba\.ativo\[data-tipo="entrada"\]\s*\{[^}]*background/);
  assert.match(h, /\.aba\.ativo\[data-tipo="saida"\]\s*\{[^}]*background/);
});
