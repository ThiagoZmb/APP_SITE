import test from 'node:test';
import assert from 'node:assert/strict';
import { verificarSoma, verificarContagem, aplicarVerificacoes } from '../scripts/lib/cruzada.mjs';
import { validarProjeto } from '../scripts/lib/validacao.mjs';
import { docMinimo, val } from './apoio.mjs';

const o = pagina => ({ arquivo: 'a.pdf', pagina, trecho: 't' });
const cota = (total, parciais, extra = {}) => ({
  id: 'C1', descricao: 'largura',
  total: val('C1.t', total, { origem: o(3) }),
  parciais: parciais.map((v, i) => val(`C1.p${i + 1}`, v, { origem: o(4 + i) })),
  ...extra,
});
const sumida = id => val(id, null, { estado: 'ausente', confianca: 0 });

test('soma de cotas correta não gera pendência', () => {
  assert.equal(verificarSoma(cota(3000, [1000, 1000, 1000])), null);
});

test('soma divergente gera pendência "divergencia" com as páginas de origem', () => {
  const p = verificarSoma(cota(3000, [1000, 1000, 900]));
  assert.equal(p.tipo, 'divergencia');
  assert.deepEqual(p.paginas, [3, 4, 5, 6]);
  assert.deepEqual(p.refs, ['C1.t', 'C1.p1', 'C1.p2', 'C1.p3']);
  assert.match(p.mensagem, /2900/);
});

test('tolerância em mm é respeitada; padrão é comparação exata', () => {
  const c = cota(3000, [1000, 1000, 998]);
  assert.equal(verificarSoma(c).tipo, 'divergencia');
  assert.equal(verificarSoma(c, { toleranciaMm: 2 }), null);
  assert.equal(verificarSoma(c, { toleranciaMm: 1 }).tipo, 'divergencia');
});

test('ruído de ponto flutuante não vira divergência', () => {
  assert.equal(verificarSoma(cota(0.3, [0.1, 0.2])), null);
});

test('parcial ausente nunca vira 0: gera pendência de não verificação', () => {
  const c = cota(3000, [1000, 1000]);
  c.parciais.push(sumida('C1.p3'));
  const p = verificarSoma(c);
  assert.equal(p.tipo, 'ausente');
  assert.deepEqual(p.refs, ['C1.p3']);
  assert.match(p.mensagem, /não pôde ser verificado/);
});

test('total ausente ou conflitante gera pendência, não divergência', () => {
  const c = cota(3000, [1000]);
  c.total = sumida('C1.t');
  assert.equal(verificarSoma(c).tipo, 'ausente');
  c.total = val('C1.t', null, { estado: 'conflitante', confianca: 0, candidatos: [val('x', 1), val('y', 2)] });
  assert.equal(verificarSoma(c).tipo, 'conflitante');
});

test('cota sem parciais não tem o que verificar', () => {
  assert.equal(verificarSoma(cota(3000, [])), null);
});

test('contagem: igual ok, divergente gera pendência, ausente não é assumido 0', () => {
  const c = (a, b) => ({ id: 'N1', descricao: 'portas', declarado: val('N1.d', a, { unidade: 'un', origem: o(1) }), contado: val('N1.c', b, { unidade: 'un', origem: o(2) }) });
  assert.equal(verificarContagem(c(4, 4)), null);
  const p = verificarContagem(c(4, 3));
  assert.equal(p.tipo, 'divergencia');
  assert.deepEqual(p.paginas, [1, 2]);
  const aus = c(4, 0);
  aus.contado = sumida('N1.c');
  assert.equal(verificarContagem(aus).tipo, 'ausente');
});

test('aplicarVerificacoes acrescenta pendências sem mutar nem duplicar', () => {
  const doc = docMinimo(d => { d.cotas = [cota(3000, [1000, 1000, 900])]; });
  const copia = structuredClone(doc);
  const novo = aplicarVerificacoes(doc, { tolerancias: { somaCotasMm: 0 } });
  assert.deepEqual(doc, copia);
  assert.equal(novo.pendencias.length, 1);
  assert.equal(novo.pendencias[0].id, 'pend-soma-C1');
  assert.equal(aplicarVerificacoes(novo, {}).pendencias.length, 1);
  assert.equal(validarProjeto(novo).ok, true);
});

test('aplicarVerificacoes usa a tolerância da configuração', () => {
  const doc = docMinimo(d => { d.cotas = [cota(3000, [1000, 1000, 998])]; });
  assert.equal(aplicarVerificacoes(doc, { tolerancias: { somaCotasMm: 5 } }).pendencias.length, 0);
  assert.equal(aplicarVerificacoes(doc, {}).pendencias.length, 1);
});
