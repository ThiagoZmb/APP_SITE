import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { caminho } from './apoio.mjs';

// Parser mínimo de frontmatter: linhas "chave: valor" entre as duas primeiras linhas "---"
function lerSkill(texto) {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  assert.equal(linhas[0], '---', 'SKILL.md deve começar com ---');
  const fim = linhas.indexOf('---', 1);
  assert.ok(fim > 0, 'frontmatter sem --- de fechamento');
  const campos = {};
  for (const l of linhas.slice(1, fim)) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(l);
    if (m) campos[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2').trim();
  }
  return { campos, corpo: linhas.slice(fim + 1) };
}

const skill = lerSkill(readFileSync(caminho('SKILL.md'), 'utf8'));

test('SKILL.md: name igual ao nome da pasta', () => {
  assert.equal(skill.campos.name, basename(resolve(caminho('.'))));
  assert.equal(skill.campos.name, 'engenharia-projetos-tecnicos');
});

test('SKILL.md: description não vazia e com menos de 1024 caracteres', () => {
  const d = skill.campos.description;
  assert.ok(d && d.length > 0);
  assert.ok(d.length < 1024, `description tem ${d.length} caracteres`);
});

test('SKILL.md: corpo com menos de 500 linhas', () => {
  assert.ok(skill.corpo.length < 500, `corpo tem ${skill.corpo.length} linhas`);
});

test('SKILL.md: references citados existem', () => {
  const texto = skill.corpo.join('\n');
  const refs = [...texto.matchAll(/references\/([\w-]+\.md)/g)].map(m => m[1]);
  const implementados = ['validacao.md', 'cotas-e-unidades.md', 'esquadrias-aluminio.md', 'regras-fabricacao.md', 'leitura-pdf.md'];
  for (const r of implementados) assert.ok(refs.includes(r), `SKILL.md deve citar references/${r}`);
  for (const r of refs) {
    if (implementados.includes(r)) assert.ok(readFileSync(caminho('references', r), 'utf8').length > 0, r);
  }
});

test('SKILL.md: cita os CLIs, o mapa de domínio e marca o que ainda não existe', () => {
  const texto = skill.corpo.join('\n');
  for (const arquivo of ['scripts/extrair-texto.mjs', 'scripts/confirmar-valores.mjs', 'scripts/montar-itens.mjs', 'config/regras-por-dominio/portas-aluminio.json', 'schemas/itens-tela.schema.json']) {
    assert.ok(texto.includes(arquivo), arquivo);
    assert.ok(readFileSync(caminho(arquivo), 'utf8').length > 0, arquivo);
  }
  assert.ok(!texto.includes('aguarda poppler'), 'a extração de PDF já existe');
  assert.ok(texto.includes('**NÃO implementado** (Fase 2'));
});
