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

test('puxador_embutido_limites', () => {
  const emb = (t, extra) => porta({ tipoPuxador: 'Embutido', tamanhoPux: t, ...extra });
  for (const t of ['49', '401']) assert.strictEqual(achar(emb(t), 'puxador_embutido_limites').nivel, 'bloqueia', t);
  for (const t of ['50', '400', '', 'abc']) assert.strictEqual(achar(emb(t), 'puxador_embutido_limites'), undefined, t);
  assert.strictEqual(achar(emb('500', { todaExt: true }), 'puxador_embutido_limites').nivel, 'bloqueia');
  assert.strictEqual(achar(porta({ tipoPuxador: 'Sobreposto', tamanhoPux: '5000' }), 'puxador_embutido_limites'), undefined);
  assert.strictEqual(achar(porta({ tipoPuxador: 'Embutido', tamanhoPux: '10' }, { frente: 'Serralheria' }), 'puxador_embutido_limites'), undefined);
});

test('puxador_maior_que_porta', () => {
  const p = (t, extra, det) => porta({ tipoPuxador: 'Sobreposto', tamanhoPux: t, ...det }, extra);
  assert.strictEqual(achar(p('2200'), 'puxador_maior_que_porta').nivel, 'bloqueia');
  assert.strictEqual(achar(p('2100'), 'puxador_maior_que_porta'), undefined);
  assert.strictEqual(achar(p('2200', {}, { todaExt: true }), 'puxador_maior_que_porta'), undefined);
  assert.strictEqual(achar(p(''), 'puxador_maior_que_porta'), undefined);
  assert.strictEqual(achar(p('1000', {}, { posicao: 'Topo' }), 'puxador_maior_que_porta').nivel, 'bloqueia');
  assert.strictEqual(achar(p('900', {}, { posicao: 'Topo' }), 'puxador_maior_que_porta'), undefined);
});

test('dimensaoDaPortaParaPuxador', () => {
  const d = R.dimensaoDaPortaParaPuxador;
  assert.strictEqual(d({ altura: 2100, largura: 900, detalhes: {} }), 2100);
  assert.strictEqual(d({ altura: 2100, largura: 900, detalhes: { posicao: 'Topo' } }), 900);
  assert.strictEqual(d({ altura: 2100, largura: 900, detalhes: { posicoesFolhas: ['Base'] } }), 900);
  assert.strictEqual(d({ altura: 2100, largura: 900, detalhes: { posicao: 'Esquerda' } }), 2100);
  assert.strictEqual(d({ altura: 'x', largura: '', detalhes: {} }), null);
  assert.strictEqual(d({ altura: 'x', largura: 800, detalhes: {} }), 800);
});

// ---- numero_inteiro (todas as frentes) ----
const RUINS = ['1,5', '1.5', '-3', '12a', ' 7 x'];
const BONS = ['0', '1500', 1500, '', null, undefined];
const inteiros = item => R.avaliar(item).filter(r => r.codigo === 'numero_inteiro');
const comCampo = (item, caminho, v) => {
  const c = JSON.parse(JSON.stringify(item));
  let o = c; const ps = caminho.split('.');
  for (const p of ps.slice(0, -1)) o = o[p];
  o[ps[ps.length - 1]] = v;
  return c;
};

function conferirCampo(base, caminho, rotulo) {
  for (const v of RUINS) {
    const r = inteiros(comCampo(base, caminho, v));
    assert.strictEqual(r.length, 1, caminho + '=' + v);
    assert.strictEqual(r[0].nivel, 'bloqueia');
    assert.ok(r[0].mensagem.includes(rotulo), r[0].mensagem);
    assert.ok(r[0].mensagem.includes('só números inteiros, sem vírgula nem ponto'));
  }
  for (const v of BONS) assert.strictEqual(inteiros(comCampo(base, caminho, v)).length, 0, caminho + '=' + String(v));
}

test('numero_inteiro: numero decimal (typeof number) dispara', () => {
  assert.strictEqual(inteiros(porta({}, { altura: 1500.5 })).length, 1);
  assert.strictEqual(inteiros(porta({}, { altura: 1500 })).length, 0);
});

test('numero_inteiro: campos do topo', () => {
  const base = { frente: 'Avulso', altura: 10, largura: 10, profundidade: 10, soldas: 1, qtd: 1, qtdAltura: 1, qtdLargura: 1, qtdProfundidade: 1, detalhes: {} };
  const rot = { altura: 'Altura', largura: 'Largura', profundidade: 'Profundidade', soldas: 'Soldas', qtd: 'Quantidade', qtdAltura: 'Qtd. de altura', qtdLargura: 'Qtd. de largura', qtdProfundidade: 'Qtd. de profundidade' };
  for (const k of Object.keys(rot)) conferirCampo(base, k, rot[k]);
});

test('numero_inteiro: detalhes', () => {
  const base = porta({ tamanhoPux: '100', divH: 0, divV: 0, transpasse: '10', largurasFolhas: [500, 500] });
  conferirCampo(base, 'detalhes.tamanhoPux', 'Tamanho do puxador');
  conferirCampo(base, 'detalhes.divH', 'Divisores horizontais');
  conferirCampo(base, 'detalhes.divV', 'Divisores verticais');
  conferirCampo(base, 'detalhes.transpasse', 'Transpasse');
  conferirCampo(base, 'detalhes.largurasFolhas.1', 'Largura da folha 2');
});

test('numero_inteiro: furos, acessorios, pecas e complementos', () => {
  conferirCampo({ ...porta({}), furos: { lista: [100, 200] } }, 'furos.lista.1', 'Furo 2');
  const ac = { ...porta({}), acessorios: [{ nome: 'x', qtd: 1, tamanho: 0 }, { nome: 'y', qtd: 2, tamanho: 3 }] };
  conferirCampo(ac, 'acessorios.1.qtd', 'Acessório 2 (quantidade)');
  conferirCampo(ac, 'acessorios.1.tamanho', 'Acessório 2 (tamanho)');
  const peca = { produto: 'p', altura: 1, largura: 1, profundidade: 1, qtd: 1, qtdAltura: 1, qtdLargura: 1, qtdProfundidade: 1, soldas: 0 };
  const serr = { frente: 'Serralheria', qtd: 1, detalhes: {}, pecas: [peca, peca] };
  const rot = { altura: 'altura', largura: 'largura', profundidade: 'profundidade', qtd: 'quantidade', qtdAltura: 'qtd. de altura', qtdLargura: 'qtd. de largura', qtdProfundidade: 'qtd. de profundidade', soldas: 'soldas' };
  for (const k of Object.keys(rot)) conferirCampo(serr, 'pecas.1.' + k, 'Peça 2 (' + rot[k] + ')');
  conferirCampo({ frente: 'Serralheria', detalhes: {}, complementos: [{ qtd: 1 }, { qtd: 2 }] }, 'complementos.1.qtd', 'Complemento 2 (quantidade)');
});

test('numero_inteiro: dinheiro nao entra e uma mensagem por campo', () => {
  assert.strictEqual(inteiros(porta({}, { valor: 10.5, descontoPct: '5,5' })).length, 0);
  assert.strictEqual(inteiros(porta({ divH: '1,5' }, { altura: '1,5' })).length, 2);
  assert.ok(R.CAMPOS_INTEIROS.length > 0 && Object.isFrozen(R.CAMPOS_INTEIROS));
});

test('numero_inteiro: negativo, -0, NaN e tipos fora do escopo', () => {
  const com = v => inteiros(porta({}, { altura: v })).length;
  assert.strictEqual(com(-3), 1);
  assert.strictEqual(com(-0), 1);
  assert.strictEqual(com(NaN), 1);
  assert.strictEqual(com(Infinity), 1);
  assert.strictEqual(com(0), 0);
  assert.strictEqual(com(1500), 0);
  assert.strictEqual(com(true), 0);
  assert.strictEqual(com({}), 0);
  assert.strictEqual(com([1]), 0);
});
