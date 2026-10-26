// ============================================================
// POPPLER: localiza os programas e os executa SEM shell (execFile), com timeout e sem rede.
// Nada que vem do PDF é interpretado como comando: o PDF só entra como argumento de caminho.
// Ordem de busca: env POPPLER_BIN → PATH → padrão do winget (Windows).
// ============================================================
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { lerVersaoPoppler } from './pdf.mjs';

const EXE = process.platform === 'win32' ? '.exe' : '';
export const PROGRAMAS = ['pdftoppm', 'pdfinfo', 'pdffonts', 'pdftotext', 'pdfimages'];
export const TIMEOUT_PADRAO_MS = 60_000;

export const MENSAGEM_INSTALACAO = [
  'Poppler não encontrado. Instale e tente de novo:',
  '  Windows: winget install oschwartz10612.Poppler   (depois abra um novo terminal)',
  '  Linux:   apt install poppler-utils   |   macOS: brew install poppler',
  'Ou aponte a pasta dos executáveis com a variável de ambiente POPPLER_BIN (pasta que contém pdftoppm).',
].join('\n');

// Promise → { stdout, stderr }; rejeita com Error que carrega stderr. Nunca usa shell.
export function executar(programa, args, { timeout = TIMEOUT_PADRAO_MS, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    execFile(programa, args, { timeout, encoding, windowsHide: true, maxBuffer: 256 * 1024 * 1024, shell: false }, (erro, stdout, stderr) => {
      if (erro) {
        const e = new Error(`${programa} falhou: ${erro.killed ? `tempo esgotado (${timeout} ms)` : String(stderr || erro.message).trim().split('\n')[0]}`);
        e.codigo = erro.code;
        e.stderr = String(stderr ?? '');
        reject(e);
      } else resolve({ stdout, stderr });
    });
  });
}

// Confirma que a pasta tem os 5 programas e que pdftoppm é do poppler (Xpdf e outros são recusados)
async function verificarPasta(pasta) {
  if (!pasta || !PROGRAMAS.every(p => existsSync(join(pasta, p + EXE)))) return null;
  try {
    const { stdout, stderr } = await executar(join(pasta, `pdftoppm${EXE}`), ['-v'], { timeout: 10_000 });
    const versao = lerVersaoPoppler(`${stdout}\n${stderr}`);
    return versao ? { versao, pasta } : null;
  } catch (e) {
    // pdftoppm -v sai com código != 0 em algumas builds, mas imprime a versão no stderr
    const versao = lerVersaoPoppler(e.stderr ?? '');
    return versao ? { versao, pasta } : null;
  }
}

function pastasDoPath(path) {
  return String(path ?? '').split(delimiter).filter(Boolean);
}

// Procura em %LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_*\poppler-*\Library\bin (versão mais nova primeiro)
export function pastasWinget(localAppData) {
  if (!localAppData) return [];
  const base = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  const ler = d => { try { return readdirSync(d); } catch { return []; } };
  const porVersaoDesc = (a, b) => b.localeCompare(a, undefined, { numeric: true });
  return ler(base).filter(n => n.startsWith('oschwartz10612.Poppler_')).sort(porVersaoDesc)
    .flatMap(pkg => ler(join(base, pkg)).filter(n => n.startsWith('poppler-')).sort(porVersaoDesc)
      .map(v => join(base, pkg, v, 'Library', 'bin')));
}

// → { versao, pasta } | null. Com POPPLER_BIN definido ele é a única fonte (configuração explícita errada não é "consertada" em silêncio).
export async function localizarPoppler(env = process.env) {
  if (env.POPPLER_BIN) return verificarPasta(env.POPPLER_BIN);
  for (const pasta of pastasDoPath(env.PATH ?? env.Path)) {
    const r = await verificarPasta(pasta);
    if (r) return r;
  }
  for (const pasta of pastasWinget(env.LOCALAPPDATA)) {
    const r = await verificarPasta(pasta);
    if (r) return r;
  }
  return null;
}

// Fábrica dos executores: { pdftoppm(args), pdfinfo(args)... } → { stdout, stderr }
export function criarPoppler({ pasta, versao }) {
  const api = { versao, pasta };
  for (const p of PROGRAMAS) api[p] = (args, opcoes) => executar(join(pasta, p + EXE), args, opcoes);
  return api;
}
