'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../calculo/regras_item');

const porta = (det, extra) => ({ frente: 'Porta de giro', altura: 2100, largura: 900, detalhes: det || {}, ...extra });
const cods = (item) => R.avaliar(item).map(r => r.codigo);
const achar = (item, cod) => R.avaliar(item).find(r => r.codigo === cod);

test('LIMITES e NIVEIS congelados', () => {
  assert.deepStrictEqual({ ...R.LIMITES }, { portaMedidaAlertaMm: 300, puxadorEmbutidoMinMm: 50, puxadorEmbutidoMaxMm: 400 });
  assert.ok(Object.isFrozen(R.LIMITES));
  assert.deepStrictEqual({ ...R.NIVEIS }, { BLOQUEIA: 'bloqueia', CONFIRMA: 'confirma', AVISA: 'avisa' });
  assert.ok(Object.isFrozen(R.REGRAS));
});

test('ehPorta', () => {
  assert.strictEqual(R.ehPorta({ frente: 'porta de giro' }), true);
  assert.strictEqual(R.ehPorta({ frente: 'Porta de Correr' }), true);
  assert.strictEqual(R.ehPorta({ frente: 'Serralheria' }), false);
  assert.strictEqual(R.ehPorta({ frente: 'Avulso' }), false);
  assert.strictEqual(R.ehPorta({}), false);
  assert.strictEqual(R.ehPorta(undefined), false);
});

test('acabamento_perfil', () => {
  const r = achar(porta({ perfil: 'P1', acabamento: '' }), 'acabamento_perfil');
  assert.strictEqual(r.nivel, 'bloqueia');
  assert.ok(r.mensagem);
  assert.strictEqual(achar(porta({ perfil: 'P1', acabamento: 'Anodizado' }), 'acabamento_perfil'), undefined);
  assert.strictEqual(achar(porta({ acabamento: '' }), 'acabamento_perfil'), undefined);
  assert.strictEqual(achar(porta({ perfil: 'P1' }, { frente: 'Serralheria' }), 'acabamento_perfil'), undefined);
});

test('acabamento_puxador', () => {
  assert.strictEqual(achar(porta({ puxador: 'X', acabPux: '' }), 'acabamento_puxador').nivel, 'bloqueia');
  assert.strictEqual(achar(porta({ acabPux: '' }), 'acabamento_puxador'), undefined);
  assert.strictEqual(achar(porta({ puxador: 'X', acabPux: 'Anodizado' }), 'acabamento_puxador'), undefined);
});

test('cor_obrigatoria', () => {
  assert.strictEqual(achar(porta({ acabamento: 'Pintura Metálica' }), 'cor_obrigatoria').nivel, 'bloqueia');
  assert.strictEqual(achar(porta({ acabamento: 'Pintura Sólida', cor: 'Preto' }), 'cor_obrigatoria'), undefined);
  assert.strictEqual(achar(porta({ acabamento: 'Anodizado' }), 'cor_obrigatoria'), undefined);
  assert.strictEqual(achar(porta({ acabPux: 'Pintura Metálica', corPux: '' }), 'cor_obrigatoria').nivel, 'bloqueia');
  assert.strictEqual(achar(porta({ acabPux: 'Pintura Metálica', corPux: 'Prata' }), 'cor_obrigatoria'), undefined);
});

test('sem_revestimento', () => {
  const r = achar(porta({ revestimento: '' }), 'sem_revestimento');
  assert.strictEqual(r.nivel, 'confirma');
  assert.strictEqual(r.mensagem, 'Sem revestimento escolhido. Inserir na lista mesmo assim?');
  assert.strictEqual(achar(porta({ revestimento: 'ACM' }), 'sem_revestimento'), undefined);
});

test('porta_medida_pequena', () => {
  assert.strictEqual(achar(porta({}, { altura: 299 }), 'porta_medida_pequena').nivel, 'avisa');
  assert.strictEqual(achar(porta({}, { largura: 250 }), 'porta_medida_pequena').nivel, 'avisa');
  assert.strictEqual(achar(porta({}, { altura: 300, largura: 300 }), 'porta_medida_pequena'), undefined);
  assert.strictEqual(achar(porta({}, { altura: 0 }), 'porta_medida_pequena'), undefined);
  assert.strictEqual(achar(porta({}, { altura: '' }), 'porta_medida_pequena'), undefined);
});

test('avaliarDocumento itens_minimo', () => {
  const r = R.avaliarDocumento({ itens: [] });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].codigo, 'itens_minimo');
  assert.strictEqual(r[0].nivel, 'bloqueia');
  assert.strictEqual(r[0].mensagem, 'Favor inserir pelomenos 1 item no pedido!');
  assert.deepStrictEqual(R.avaliarDocumento({ itens: [{}] }), []);
});

test('avaliar nao traz regras de documento; livro sem verifica', () => {
  assert.ok(!cods(porta({})).includes('itens_minimo'));
  const l = R.livro();
  assert.strictEqual(l.length, R.REGRAS.length);
  for (const x of l) {
    assert.strictEqual(x.verifica, undefined);
    assert.ok(x.codigo && x.nivel && x.escopo && x.titulo);
  }
});
