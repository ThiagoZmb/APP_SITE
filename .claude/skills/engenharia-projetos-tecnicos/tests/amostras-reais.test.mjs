// Golden de amostras REAIS (dados de cliente: ficam FORA do git, em <repo>/amostras_pdf/golden/ ou em ENG_GOLDEN_DIR).
// Cada par: <nome>.projeto.json (aprovado pelo usuário) + <nome>.itens.esperado.json.
// O teste valida o projeto, roda montar-itens e compara o resultado EXATAMENTE com o esperado.
// Sem a pasta (ou sem pares) o teste é pulado; veja "Golden de amostras reais" no README.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validarProjeto } from '../scripts/lib/validacao.mjs';
import { caminho, rodarScript } from './apoio.mjs';

const PASTA = process.env.ENG_GOLDEN_DIR || caminho('../../../amostras_pdf/golden');
const SUFIXO_PROJETO = '.projeto.json';
const SUFIXO_ESPERADO = '.itens.esperado.json';

const arquivos = existsSync(PASTA) ? readdirSync(PASTA) : [];
const nomes = suf => arquivos.filter(a => a.endsWith(suf)).map(a => a.slice(0, -suf.length));
const projetos = nomes(SUFIXO_PROJETO);
const esperados = nomes(SUFIXO_ESPERADO);

test('golden de amostras reais: montar-itens bate exatamente com o esperado aprovado', async t => {
  if (projetos.length === 0 && esperados.length === 0) return t.skip('sem golden de amostras reais nesta máquina');

  const orfaos = [...projetos.filter(n => !esperados.includes(n)).map(n => `${n}${SUFIXO_PROJETO} sem ${n}${SUFIXO_ESPERADO}`),
    ...esperados.filter(n => !projetos.includes(n)).map(n => `${n}${SUFIXO_ESPERADO} sem ${n}${SUFIXO_PROJETO}`)];
  assert.deepEqual(orfaos, [], 'cada golden precisa do par projeto + itens esperados');

  for (const nome of projetos) {
    await t.test(nome, () => {
      const arqProjeto = join(PASTA, nome + SUFIXO_PROJETO);
      const validacao = validarProjeto(JSON.parse(readFileSync(arqProjeto, 'utf8')));
      assert.deepEqual(validacao.erros, [], 'o projeto aprovado deve ser válido');
      const r = rodarScript('scripts/montar-itens.mjs', [arqProjeto]);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), JSON.parse(readFileSync(join(PASTA, nome + SUFIXO_ESPERADO), 'utf8')));
    });
  }
});
