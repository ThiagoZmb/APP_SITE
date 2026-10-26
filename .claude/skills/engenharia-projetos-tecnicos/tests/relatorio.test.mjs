import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gerarRelatorio } from '../scripts/lib/relatorio.mjs';
import { caminho, lerFixture, normalizar } from './apoio.mjs';

const doc = () => lerFixture('projeto-valido-completo.json');

test('relatório bate byte a byte com o golden file', () => {
  const esperado = normalizar(readFileSync(caminho('tests/golden/relatorio-exemplo.md'), 'utf8'));
  assert.equal(normalizar(gerarRelatorio(doc())), esperado);
});

test('relatório é determinístico (ordem das chaves do JSON não importa)', () => {
  const d = doc();
  const dims = d.itens[0].dimensoes;
  d.itens[0].dimensoes = Object.fromEntries(Object.entries(dims).reverse());
  assert.equal(gerarRelatorio(d), gerarRelatorio(doc()));
});

test('inferido só aparece marcado "INFERIDO — conferir", nunca em Confirmado', () => {
  const md = gerarRelatorio(doc());
  const confirmado = md.split('## Inferido')[0];
  assert.ok(!confirmado.includes('P1.largura'));
  assert.ok(!confirmado.includes('P1.area'));
  const linhas = md.split('\n').filter(l => l.includes('P1.largura]') || l.includes('P1.area]'));
  assert.ok(linhas.length >= 2);
  assert.ok(linhas.every(l => l.startsWith('- INFERIDO — conferir:')));
  assert.match(md, /confiança 0,7/);
  assert.match(md, /projeto-sintetico\.pdf, p\. 2, trecho "largura lida/);
});

test('conflitante lista candidatos sem escolher; seções vazias têm texto próprio', () => {
  const md = gerarRelatorio(doc());
  assert.match(md, /Candidatos de P1\.vao: 2100 mm \(p\. 2\); 2110 mm \(p\. 4\) — nenhum foi escolhido/);
  const d = doc();
  d.pendencias = []; d.alertasSeguranca = [];
  d.itens[0].dimensoes = {};
  d.cotas = []; d.contagens = [];
  const vazio = gerarRelatorio(d);
  assert.match(vazio, /Nenhuma pendência\./);
  assert.match(vazio, /Nenhum alerta\./);
  assert.match(vazio, /Nenhum valor inferido\./);
});

test('pendências mostram a página e o resumo conta por estado', () => {
  const md = gerarRelatorio(doc());
  assert.match(md, /\[divergencia\].*\(páginas 3, 5\)/);
  assert.match(md, /- confirmado: 12\n- inferido: 2\n- ausente: 1\n- conflitante: 1\n/);
  assert.match(md, /Alertas de segurança: 1/);
});
