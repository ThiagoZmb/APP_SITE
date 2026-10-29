// Tela de pesos: lógica pura e conferência do HTML/layout estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../pesos.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const F = { tipo: 'perfil', produto: '3345', unidadePeso: 'kg_m', kgPorUnidade: '0,412', origem: 'pesado' };
const ESTIMADO = { id: 1, tipo: 'perfil', produto: '3345', unidadePeso: 'kg_m', kgPorUnidade: 0.412, origem: 'estimado_desenho', confianca: 'alta' };

test('pesos: seloOrigem — estimado ganha selo com a confiança; os demais pelo nome', () => {
  assert.deepEqual(P.seloOrigem('estimado_desenho', 'media'), { texto: 'estimado (média)', classe: 'estimado' });
  assert.equal(P.seloOrigem('estimado_desenho', '').texto, 'estimado');
  assert.equal(P.seloOrigem('pesado').texto, 'pesado');
  assert.equal(P.seloOrigem('fornecedor').texto, 'fornecedor');
  assert.equal(P.seloOrigem('manual').texto, 'manual');
  assert.equal(P.seloOrigem(undefined).texto, 'manual');
});

test('pesos: validarForm e número com vírgula (milhar ambíguo recusado)', () => {
  assert.deepEqual(P.validarForm(F), []);
  assert.deepEqual(P.validarForm({ ...F, kgPorUnidade: '1.5' }), []);
  for (const v of ['', '0', '-1', 'abc', '1.500']) assert.ok(P.validarForm({ ...F, kgPorUnidade: v }).join().includes('peso'), v);
  const vazio = P.validarForm({}).join(' ');
  for (const r of ['tipo', 'produto', 'unidade', 'peso']) assert.ok(vazio.includes(r), r);
  assert.equal(P.paraTela(0.412), '0,412');
  assert.equal(P.rotuloUnidade('kg_m2_mm'), 'kg/m²/mm');
});

test('pesos: valor novo num registro estimado vira pesado/fornecedor/manual conforme o seletor; sem mexer continua estimado', () => {
  assert.deepEqual(P.origemParaSalvar({ ...F, kgPorUnidade: '0,5' }, ESTIMADO), { origem: 'pesado', confianca: '' });
  assert.deepEqual(P.origemParaSalvar({ ...F, kgPorUnidade: '0,5', origem: 'fornecedor' }, ESTIMADO), { origem: 'fornecedor', confianca: '' });
  assert.deepEqual(P.origemParaSalvar({ ...F, kgPorUnidade: '0,5', origem: 'manual' }, ESTIMADO), { origem: 'manual', confianca: '' });
  assert.deepEqual(P.origemParaSalvar({ ...F, origem: 'manual' }, ESTIMADO), { origem: 'estimado_desenho', confianca: 'alta' });   // valor igual (0,412)
  assert.deepEqual(P.origemParaSalvar({ ...F, origem: 'xyz', kgPorUnidade: '1' }, null), { origem: 'pesado', confianca: '' });
});

test('pesos: corpoSalvar corta espaços e leva origem/confiança; só os campos da API', () => {
  const b = P.corpoSalvar({ ...F, produto: ' 3345 ', extra: 'não vai' }, null);
  assert.deepEqual(b, { tipo: 'perfil', produto: '3345', unidadePeso: 'kg_m', kgPorUnidade: '0,412', origem: 'pesado', confianca: '' });
});

test('página: scripts, botões, permissão de editar, CSP e sem handlers inline', () => {
  const h = ler('pesos.html');
  assert.match(h, /Content-Security-Policy/);
  assert.match(h, /name="viewport"/);
  assert.ok(h.includes('<script src="layout.js'));
  assert.ok(h.includes('<script src="entregas_comum.js'));
  assert.ok(h.includes('<script src="pesos.js'));
  for (const id of ['btn-novo', 'btn-salvar', 'btn-excluir', 'p-tipo', 'p-produto', 'p-unidade', 'p-valor', 'p-origem', 'filtro-tipo', 'busca']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('data-perm="pesos.editar"'));
  assert.ok(!h.includes('data-valor'), 'peso não é dinheiro');
  assert.doesNotMatch(h, /\son(click|change|submit|error)=/);
  const csp = h.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(csp, ler('tintas.html').match(/Content-Security-Policy" content="([^"]+)"/)[1]);
});

test('layout.js: Pesos no menu (subitem de Produtos, logo depois dele) e em PAGINAS com pesos.ver', () => {
  const l = ler('layout.js');
  assert.match(l, /href: 'pesos\.html', texto: 'Pesos'/);
  assert.match(l, /'pesos\.html': \['pesos\.ver'\]/);
  assert.ok(l.indexOf("href: 'pesos.html'") > l.indexOf("href: 'produtos.html'") && l.indexOf("href: 'pesos.html'") < l.indexOf("href: 'fornecedores.html'"));
  assert.match(l, /href: 'pesos\.html'.*sub: true/);
  assert.match(l, /'minhas_entregas\.html': \['entregas\.baixar'\]\s*\/\/ por último/);
});
