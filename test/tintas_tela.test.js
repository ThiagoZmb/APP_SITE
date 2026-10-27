// Tela de tintas: lógica pura e conferência do HTML/layout estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../tintas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('tintas: cor ARGB do banco <-> #rrggbb do seletor de cor', () => {
  assert.equal(T.corParaInput('FF1A2B3C'), '#1a2b3c');
  assert.equal(T.corParaInput('0'), '#000000');
  assert.equal(T.corParaInput(''), '#000000');
  assert.equal(T.corParaInput('<script>'), '#000000');
  assert.equal(T.inputParaCor('#1a2b3c'), 'FF1A2B3C');
  assert.equal(T.inputParaCor(T.corParaInput('FF1A2B3C')), 'FF1A2B3C');
});

test('tintas: validarForm (valor só validado para quem tem valores.ver)', () => {
  const ok = { fabricante: 'Sayerlack', classe: 'Verniz', tipo: 'Verniz Fosco', conjunto: 'Conjunto Vidro', porcentagem: '50', valor: '12,5' };
  assert.deepEqual(T.validarForm(ok, { comValores: true }), []);
  assert.deepEqual(T.validarForm({ ...ok, valor: '' }), []);
  assert.ok(T.validarForm({ ...ok, valor: '' }, { comValores: true }).join().includes('valor'));
  const vazio = T.validarForm({}).join(' ');
  for (const r of ['fabricante', 'classe', 'tipo', 'conjunto', '% da mistura']) assert.ok(vazio.includes(r), r);
  assert.ok(T.validarForm({ ...ok, porcentagem: '101' }).join().includes('% da mistura'));
  assert.ok(T.validarForm({ ...ok, valor: '1.234,56' }, { comValores: true }).join().includes('valor'));
});

test('tintas: corpoSalvar corta espaços, omite valor sem valores.ver e codigo quando novo', () => {
  const f = { fabricante: ' Sayerlack ', classe: 'Verniz', valor: '12,5', extra: 'não vai', cor: 'FF000000' };
  const b = T.corpoSalvar(f, 5, { comValores: true });
  assert.equal(b.fabricante, 'Sayerlack');
  assert.equal(b.valor, '12,5');
  assert.equal(b.codigo, 5);
  assert.equal('extra' in b, false);
  assert.equal('valor' in T.corpoSalvar(f, null), false);
  assert.equal('codigo' in T.corpoSalvar(f, null), false);
  assert.deepEqual(T.CAMPOS, ['fabricante', 'classe', 'tipo', 'conjunto', 'valor', 'porcentagem', 'refFabricante', 'corElegance', 'cor', 'rendimento']);
});

test('página: scripts, botões, permissão de editar, sem handlers inline', () => {
  const h = ler('tintas.html');
  assert.match(h, /Content-Security-Policy/);
  assert.match(h, /name="viewport"/);
  assert.ok(h.includes('<script src="layout.js'));
  assert.ok(h.includes('<script src="entregas_comum.js'));
  assert.ok(h.includes('<script src="tintas.js'));
  for (const id of ['btn-novo', 'btn-salvar', 'btn-excluir', 't-cor', 'filtro-classe', 'busca']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('data-perm="tintas.editar"'));
  assert.ok(h.includes('data-valor'));
  assert.doesNotMatch(h, /\son(click|change|submit|error)=/);
});

test('layout.js: Tintas no menu (subitem do Estoque) e em PAGINAS com tintas.ver', () => {
  const l = ler('layout.js');
  assert.match(l, /href: 'tintas\.html', texto: 'Tintas'/);
  assert.match(l, /'tintas\.html': \['tintas\.ver'\]/);
  assert.ok(l.indexOf("href: 'tintas.html'") > l.indexOf("href: 'estoque.html'") && l.indexOf("href: 'tintas.html'") < l.indexOf("href: 'produtos.html'"));
  assert.match(l, /'minhas_entregas\.html': \['entregas\.baixar'\]\s*\/\/ por último/);
});

test('tintas: corValida (cor antiga fora do formato conta como não escolhida), paraTela com vírgula e milhar recusado', () => {
  assert.equal(T.corValida('FF1A2B3C'), true);
  assert.equal(T.corValida('0'), false);
  assert.equal(T.corValida(''), false);
  assert.equal(T.paraTela(12.5), '12,5');
  assert.equal(T.paraTela(0), '0');
  assert.ok(T.validarForm({ fabricante: 'a', classe: 'b', tipo: 'c', conjunto: 'd', porcentagem: '1.500' }).join().includes('% da mistura'));
});

test('tintas: % da mistura inteira na tela também', () => {
  const ok = { fabricante: 'a', classe: 'b', tipo: 'c', conjunto: 'd' };
  assert.ok(T.validarForm({ ...ok, porcentagem: '12,5' }).join().includes('% da mistura'));
  assert.deepEqual(T.validarForm({ ...ok, porcentagem: '12' }), []);
});
