process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');

test('rar nao esta rastreado e o gitignore recusa *.rar', () => {
  const rastreados = execFileSync('git', ['ls-files'], { cwd: raiz, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  assert.deepEqual(rastreados.filter(l => l.toLowerCase().endsWith('.rar')), []);
  const linhas = fs.readFileSync(path.join(raiz, '.gitignore'), 'utf8').split(/\r?\n/).map(l => l.trim());
  assert.ok(linhas.includes('*.rar'));
});
