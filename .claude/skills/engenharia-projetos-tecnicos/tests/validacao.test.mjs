import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { validarProjeto } from '../scripts/lib/validacao.mjs';
import { caminho, docMinimo, val, lerFixture } from './apoio.mjs';

const mensagens = r => r.erros.map(e => `${e.caminho}: ${e.mensagem}`).join('\n');
const ausente = id => val(id, null, { estado: 'ausente', confianca: 0 });
const pend = (id, tipo, refs) => ({ id, tipo, mensagem: 'm', refs });

test('documento mínimo é válido', () => {
  const r = validarProjeto(docMinimo());
  assert.equal(r.ok, true, mensagens(r));
});

test('schema: campo obrigatório ausente e propriedade extra apontam o caminho', () => {
  const doc = docMinimo(d => { delete d.dominio; d.itens[0].extra = 1; });
  const r = validarProjeto(doc);
  assert.equal(r.ok, false);
  assert.ok(r.erros.some(e => e.caminho === 'dominio' && /obrigatória/.test(e.mensagem)), mensagens(r));
  assert.ok(r.erros.some(e => e.caminho === 'itens[0].extra'), mensagens(r));
});

// Regra 1
test('regra 1: comprimento em cm é erro; mm é válido', () => {
  const r = validarProjeto(docMinimo(d => { d.itens[0].dimensoes.altura.unidade = 'cm'; }));
  assert.equal(r.ok, false);
  assert.match(mensagens(r), /itens\[0\]\.dimensoes\.altura\.unidade.*mm/);
});

test('regra 1: quantidade em mm e cota em un são erros', () => {
  assert.equal(validarProjeto(docMinimo(d => { d.itens[0].quantidade.unidade = 'mm'; })).ok, false);
  const r = validarProjeto(docMinimo(d => {
    d.cotas = [{ id: 'C', descricao: 'c', total: val('C.t', 10, { unidade: 'un' }), parciais: [] }];
  }));
  assert.match(mensagens(r), /cotas\[0\]\.total/);
});

test('regra 1: dimensão numérica sem unidade é erro', () => {
  const r = validarProjeto(docMinimo(d => { d.itens[0].dimensoes.altura.unidade = null; }));
  assert.match(mensagens(r), /sem unidade/);
});

// Regra 2
test('regra 2: confirmado por ocr/leitura_visual exige confirmacao', () => {
  for (const metodo of ['ocr', 'leitura_visual']) {
    const r = validarProjeto(docMinimo(d => { d.itens[0].dimensoes.altura.metodo = metodo; }));
    assert.equal(r.ok, false, metodo);
    assert.match(mensagens(r), /exige confirmacao humana/);
  }
  const ok = validarProjeto(docMinimo(d => {
    Object.assign(d.itens[0].dimensoes.altura, { metodo: 'ocr', confirmacao: { por: 'Ana', em: '2026-10-26' } });
  }));
  assert.equal(ok.ok, true, mensagens(ok));
});

// Regra 3
test('regra 3: ausente com valor ou confiança > 0 é erro; ausente correto exige pendência', () => {
  const comValor = validarProjeto(docMinimo(d => {
    d.itens[0].dimensoes.altura.estado = 'ausente';
    d.pendencias.push(pend('p', 'ausente', ['I1.h']));
  }));
  assert.match(mensagens(comValor), /proíbe valor/);
  assert.match(mensagens(comValor), /confianca 0/);
  const ok = validarProjeto(docMinimo(d => {
    d.itens[0].dimensoes.altura = ausente('I1.h');
    d.pendencias.push(pend('p', 'ausente', ['I1.h']));
  }));
  assert.equal(ok.ok, true, mensagens(ok));
});

// Regra 4
test('regra 4: conflitante exige valor null e 2+ candidatos diferentes', () => {
  const conf = (candidatos, valor = null) => docMinimo(d => {
    d.itens[0].dimensoes.altura = val('I1.h', valor, { estado: 'conflitante', confianca: 0, candidatos });
    d.pendencias.push(pend('p', 'conflitante', ['I1.h']));
  });
  const ok = validarProjeto(conf([val('c1', 2100), val('c2', 2110)]));
  assert.equal(ok.ok, true, mensagens(ok));
  assert.equal(validarProjeto(conf([val('c1', 2100)])).ok, false);
  assert.match(mensagens(validarProjeto(conf([val('c1', 2100), val('c2', 2100)]))), /diferentes/);
  assert.match(mensagens(validarProjeto(conf([val('c1', 2100), val('c2', 2110)], 2100))), /nunca escolha/);
});

// Regra 5
function docCalculado(estadoEntrada, estadoCalc, extraEntrada = {}) {
  return docMinimo(d => {
    const h = d.itens[0].dimensoes.altura;
    Object.assign(h, { estado: estadoEntrada, ...extraEntrada });
    d.itens[0].dimensoes.area = val('I1.a', 5, {
      unidade: 'm2', estado: estadoCalc, metodo: 'calculado', regra: 'h*l', origem: { arquivo: 'a.pdf', pagina: 1, trecho: 'r', entradas: ['I1.h'] },
      ...(estadoCalc === 'ausente' ? { valor: null, confianca: 0 } : {}),
    });
    if (estadoEntrada === 'inferido') d.pendencias.push(pend('p1', 'inferido_sem_confirmacao', ['I1.h']));
    if (estadoEntrada === 'ausente') d.pendencias.push(pend('p1', 'ausente', ['I1.h']));
    if (estadoCalc !== 'confirmado') d.pendencias.push(pend('p2', estadoCalc === 'ausente' ? 'ausente' : 'inferido_sem_confirmacao', ['I1.a']));
  });
}

test('regra 5: calculado confirmado a partir de entrada confirmada é válido', () => {
  const r = validarProjeto(docCalculado('confirmado', 'confirmado'));
  assert.equal(r.ok, true, mensagens(r));
});

test('regra 5: calculado não pode ser melhor que a entrada inferida', () => {
  const r = validarProjeto(docCalculado('inferido', 'confirmado'));
  assert.equal(r.ok, false);
  assert.match(mensagens(r), /melhor que o pior estado/);
  assert.equal(validarProjeto(docCalculado('inferido', 'inferido')).ok, true);
});

test('regra 5: entrada ausente exige calculado ausente', () => {
  const ruim = validarProjeto(docCalculado('ausente', 'inferido', { valor: null, confianca: 0 }));
  assert.match(mensagens(ruim), /deve ser "ausente"/);
  const ok = validarProjeto(docCalculado('ausente', 'ausente', { valor: null, confianca: 0 }));
  assert.equal(ok.ok, true, mensagens(ok));
});

test('regra 5: entrada inexistente e calculado sem regra/entradas são erros', () => {
  const r = validarProjeto(docMinimo(d => {
    d.itens[0].dimensoes.area = val('I1.a', 5, { unidade: 'm2', metodo: 'calculado', origem: { arquivo: 'a.pdf', pagina: 1, trecho: 'r', entradas: ['nao-existe'] }, regra: 'x' });
  }));
  assert.match(mensagens(r), /"nao-existe" não existe/);
  const semRegra = validarProjeto(docMinimo(d => { d.itens[0].dimensoes.area = val('I1.a', 5, { unidade: 'm2', metodo: 'calculado' }); }));
  assert.equal(semRegra.ok, false);
});

// Regra 6
test('regra 6: inferido sem confirmação precisa de pendência; com confirmação não', () => {
  const inferido = d => Object.assign(d.itens[0].dimensoes.altura, { estado: 'inferido', confianca: 0.6 });
  const sem = validarProjeto(docMinimo(inferido));
  assert.match(mensagens(sem), /não consta em pendencias/);
  const com = validarProjeto(docMinimo(d => { inferido(d); d.pendencias.push(pend('p', 'inferido_sem_confirmacao', ['I1.h'])); }));
  assert.equal(com.ok, true, mensagens(com));
  const confirmadoPorHumano = validarProjeto(docMinimo(d => {
    inferido(d);
    d.itens[0].dimensoes.altura.confirmacao = { por: 'Ana', em: '2026-10-26' };
  }));
  assert.equal(confirmadoPorHumano.ok, true, mensagens(confirmadoPorHumano));
});

test('regra 6: ausente e conflitante sem pendência são erros; ref inexistente também', () => {
  const sem = validarProjeto(docMinimo(d => { d.itens[0].dimensoes.altura = ausente('I1.h'); }));
  assert.match(mensagens(sem), /I1\.h/);
  const refRuim = validarProjeto(docMinimo(d => { d.pendencias.push(pend('p', 'divergencia', ['fantasma'])); }));
  assert.match(mensagens(refRuim), /pendencias\[0\]\.refs\[0\].*fantasma/);
});

// Regra 7
test('regra 7: ids repetidos (inclusive entre tipos de entidade) são erros', () => {
  const r = validarProjeto(docMinimo(d => { d.itens[0].dimensoes.largura = val('I1.h', 900); }));
  assert.match(mensagens(r), /id "I1\.h" repetido/);
  const entidade = validarProjeto(docMinimo(d => { d.itens[0].id = 'I1.h'; }));
  assert.match(mensagens(entidade), /repetido/);
});

test('fixtures: *valido* passam e *invalido* falham', () => {
  const pasta = caminho('tests/fixtures');
  const arquivos = readdirSync(pasta).filter(f => f.endsWith('.json'));
  const validos = arquivos.filter(f => f.includes('valido') && !f.includes('invalido'));
  const invalidos = arquivos.filter(f => f.includes('invalido'));
  assert.ok(validos.length >= 1 && invalidos.length >= 3);
  for (const f of validos) { const r = validarProjeto(lerFixture(f)); assert.equal(r.ok, true, `${f}\n${mensagens(r)}`); }
  for (const f of invalidos) assert.equal(validarProjeto(lerFixture(f)).ok, false, f);
});
