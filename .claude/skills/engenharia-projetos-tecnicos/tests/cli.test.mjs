import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caminho, normalizar } from './apoio.mjs';

const VALIDAR = caminho('scripts/validar-projeto.mjs');
const RELATORIO = caminho('scripts/gerar-relatorio.mjs');
const VALIDO = caminho('tests/fixtures/projeto-valido-completo.json');
const INVALIDO = caminho('tests/fixtures/projeto-invalido-sem-pendencia.json');

// Roda o CLI e devolve { status, stdout, stderr } sem lançar em saída != 0
function rodar(script, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout), stderr: String(e.stderr) };
  }
}

test('validar-projeto: válido → exit 0 e informa a divergência derivada', () => {
  const r = rodar(VALIDAR, VALIDO);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /VÁLIDO/);
});

test('validar-projeto: inválido → exit 1 com erros e caminho no stderr', () => {
  const r = rodar(VALIDAR, INVALIDO);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /itens\[0\]\.dimensoes\.espessura/);
});

test('validar-projeto: uso errado ou arquivo inexistente → exit 2; JSON quebrado → exit 1', () => {
  assert.equal(rodar(VALIDAR).status, 2);
  assert.equal(rodar(VALIDAR, '--x').status, 2);
  assert.equal(rodar(VALIDAR, join(tmpdir(), 'nao-existe-skill.json')).status, 2);
  const dir = mkdtempSync(join(tmpdir(), 'skill-'));
  try {
    const quebrado = join(dir, 'q.json');
    writeFileSync(quebrado, '{ nao e json');
    assert.equal(rodar(VALIDAR, quebrado).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gerar-relatorio: imprime o Markdown e grava com --saida', () => {
  const golden = normalizar(readFileSync(caminho('tests/golden/relatorio-exemplo.md'), 'utf8'));
  const r = rodar(RELATORIO, VALIDO);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(normalizar(r.stdout), golden);
  const dir = mkdtempSync(join(tmpdir(), 'skill-'));
  try {
    const saida = join(dir, 'r.md');
    assert.equal(rodar(RELATORIO, VALIDO, '--saida', saida).status, 0);
    assert.equal(normalizar(readFileSync(saida, 'utf8')), golden);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gerar-relatorio: inválido → exit 1 e nenhum relatório é gerado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-'));
  try {
    const saida = join(dir, 'r.md');
    const r = rodar(RELATORIO, INVALIDO, '--saida', saida);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(saida), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gerar-relatorio: uso errado → exit 2', () => {
  assert.equal(rodar(RELATORIO).status, 2);
  assert.equal(rodar(RELATORIO, VALIDO, '--saida').status, 2);
  assert.equal(rodar(RELATORIO, VALIDO, '--outra').status, 2);
});
