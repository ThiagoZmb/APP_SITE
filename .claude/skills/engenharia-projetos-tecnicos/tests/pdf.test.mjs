// Funções puras de scripts/lib/pdf.mjs e da busca do poppler: não precisam de poppler instalado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  calcularRecorte, classificarPagina, contarCaracteres, contarFontes, coberturaImagem, lerDimensoesPng, lerListaPaginas,
  lerPdfimagesLista, lerPdfinfo, lerRecorte, lerVersaoPoppler, nomePagina, nomeRecorte, nomeTexto, tamanhoRenderizado, validarDpi,
  TEXTO_MINIMO,
} from '../scripts/lib/pdf.mjs';
import { pastasWinget } from '../scripts/lib/poppler.mjs';

// ---------- classificação ----------
test('classificação: texto suficiente sem imagem grande → texto_vetorial', () => {
  assert.equal(classificarPagina({ caracteres: 500, coberturaImagem: 0 }), 'texto_vetorial');
  assert.equal(classificarPagina({ caracteres: 500, coberturaImagem: 0.1 }), 'texto_vetorial', 'imagem pequena (logo) não muda');
});

test('classificação: sem texto e sem imagem grande → vetorial_sem_texto (caso real: texto em curvas)', () => {
  assert.equal(classificarPagina({ caracteres: 0, coberturaImagem: 0 }), 'vetorial_sem_texto');
  assert.equal(classificarPagina({ caracteres: 0, coberturaImagem: 0.02 }), 'vetorial_sem_texto');
});

test('classificação: sem texto e imagem cobrindo a página → escaneado', () => {
  assert.equal(classificarPagina({ caracteres: 0, coberturaImagem: 0.95 }), 'escaneado');
});

test('classificação: texto + imagem grande → misto', () => {
  assert.equal(classificarPagina({ caracteres: 300, coberturaImagem: 0.8 }), 'misto');
});

test('classificação: limites (texto mínimo e 50% da área)', () => {
  assert.equal(classificarPagina({ caracteres: TEXTO_MINIMO - 1, coberturaImagem: 0 }), 'vetorial_sem_texto', 'só o número da página não é texto');
  assert.equal(classificarPagina({ caracteres: TEXTO_MINIMO, coberturaImagem: 0 }), 'texto_vetorial');
  assert.equal(classificarPagina({ caracteres: 0, coberturaImagem: 0.5 }), 'escaneado');
  assert.equal(classificarPagina({ caracteres: 0, coberturaImagem: 0.4999 }), 'vetorial_sem_texto');
});

test('contarCaracteres ignora espaços e quebras de linha', () => {
  assert.equal(contarCaracteres(' a b\n\tc  '), 3);
  assert.equal(contarCaracteres(null), 0);
});

test('cobertura da imagem: área exibida = px / ppi * 72 pt, contra a área da página', () => {
  // imagem de 1200x1200 px a 144 ppi = 600x600 pt; página 600x800 → 75%
  assert.equal(coberturaImagem([{ larguraPx: 1200, alturaPx: 1200, ppiX: 144, ppiY: 144 }], 600, 800), 0.75);
  assert.equal(coberturaImagem([], 600, 800), 0);
  assert.equal(coberturaImagem([{ larguraPx: 9000, alturaPx: 9000, ppiX: 72, ppiY: 72 }], 600, 800), 1, 'limitada a 1');
  assert.equal(coberturaImagem([{ larguraPx: 10, alturaPx: 10, ppiX: 72, ppiY: 72 }], 0, 0), 0);
});

// ---------- leitura da saída do poppler ----------
test('lerPdfinfo: total, tamanho e rotação por página (rotação normalizada)', () => {
  const saida = ['Pages:           2', 'Page    1 size:  842 x 1191 pts (A3)', 'Page    1 rot:   270', 'Page    2 size:  595.28 x 841.89 pts (A4)', 'Page    2 rot:   0'].join('\n');
  const r = lerPdfinfo(saida);
  assert.equal(r.paginas, 2);
  assert.deepEqual(r.tamanhos.get(1), { larguraPt: 842, alturaPt: 1191, rotacao: 270 });
  assert.deepEqual(r.tamanhos.get(2), { larguraPt: 595.28, alturaPt: 841.89, rotacao: 0 });
  assert.equal(lerPdfinfo('Page    1 size: 10 x 10 pts\nPage    1 rot:   -90').tamanhos.get(1).rotacao, 270);
  assert.equal(lerPdfinfo('lixo').paginas, 0);
});

test('lerPdfimagesLista: só imagens reais, agrupadas por página (máscaras ignoradas)', () => {
  const saida = [
    'page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio',
    '--------------------------------------------------------------------------------------------',
    '   1     0 image     166   568  rgb     3   8  image  no        13  0   600   600 1323B 0.5%',
    '   1     1 smask     166   568  gray    1   8  image  no        14  0   600   600 7128B 2.5%',
    '   3     2 image    2480  3508  gray    1   8  image  no        15  0   300   300  100K 1.0%',
  ].join('\n');
  const m = lerPdfimagesLista(saida);
  assert.equal(m.get(1).length, 1);
  assert.deepEqual(m.get(3), [{ larguraPx: 2480, alturaPx: 3508, ppiX: 300, ppiY: 300 }]);
  assert.equal(m.get(2), undefined);
});

test('contarFontes descarta o cabeçalho; lerVersaoPoppler recusa Xpdf', () => {
  assert.equal(contarFontes('name type\n---- ----\n'), 0);
  assert.equal(contarFontes('name type\n---- ----\nHelvetica Type 1 \nArial TrueType\n'), 2);
  assert.equal(lerVersaoPoppler('pdftoppm version 25.07.0\nCopyright 2005-2025 The Poppler Developers - http://poppler.freedesktop.org'), '25.07.0');
  assert.equal(lerVersaoPoppler('pdftoppm version 4.05 [www.xpdfreader.com]\nCopyright 1996-2024 Glyph & Cog, LLC'), null);
});

// ---------- validação de argumentos ----------
test('validarDpi: aceita 30 a 400, recusa fora da faixa e lixo', () => {
  assert.equal(validarDpi('60'), 60);
  assert.equal(validarDpi('30'), 30);
  assert.equal(validarDpi('400'), 400);
  for (const ruim of ['29', '401', '0', 'abc', '-60', '', '60dpi']) assert.throws(() => validarDpi(ruim), /entre 30 e 400/, ruim);
});

test('lerListaPaginas: lista e intervalos, ordenados e sem repetição; página inexistente é erro', () => {
  assert.deepEqual(lerListaPaginas('4,11', 12), [4, 11]);
  assert.deepEqual(lerListaPaginas('9, 2-4,3', 12), [2, 3, 4, 9]);
  assert.throws(() => lerListaPaginas('13', 12), /página 13 não existe/);
  assert.throws(() => lerListaPaginas('0', 12), /não existe/);
  assert.throws(() => lerListaPaginas('4;5', 12), /inválida/);
  assert.throws(() => lerListaPaginas('5-3', 12), /invertido/);
  assert.throws(() => lerListaPaginas('', 12), /inválida/);
});

test('lerRecorte: PAG:x,y,w,h em frações 0..1', () => {
  assert.deepEqual(lerRecorte('4:0.1,0.2,0.5,0.3', 12), { pagina: 4, x: 0.1, y: 0.2, w: 0.5, h: 0.3 });
  assert.deepEqual(lerRecorte('1:0,0,1,1', 1), { pagina: 1, x: 0, y: 0, w: 1, h: 1 });
  assert.throws(() => lerRecorte('4:0.6,0,0.5,0.5', 12), /x\+w/);
  assert.throws(() => lerRecorte('4:0,0.6,0.5,0.5', 12), /y\+h/);
  assert.throws(() => lerRecorte('4:0,0,0,0.5', 12), /maiores que 0/);
  assert.throws(() => lerRecorte('4:1.5,0,0.1,0.1', 12), /entre 0 e 1/);
  assert.throws(() => lerRecorte('4:-0.1,0,0.5,0.5', 12), /inválido/);
  assert.throws(() => lerRecorte('99:0,0,0.5,0.5', 12), /página 99 não existe/);
  assert.throws(() => lerRecorte('4:0.1,0.2,0.5', 12), /inválido/);
  assert.throws(() => lerRecorte('4:0,1,0.5,0.5', 12), /y\+h/, 'y=1 sobra altura zero para h');
});

// ---------- cálculo do recorte (rotação troca largura/altura) ----------
test('tamanhoRenderizado: rotação 90/270 troca largura e altura; 0/180 mantém; arredonda para cima como o poppler', () => {
  assert.deepEqual(tamanhoRenderizado({ larguraPt: 600, alturaPt: 800, rotacao: 0 }, 72), { largura: 600, altura: 800 });
  assert.deepEqual(tamanhoRenderizado({ larguraPt: 600, alturaPt: 800, rotacao: 180 }, 72), { largura: 600, altura: 800 });
  assert.deepEqual(tamanhoRenderizado({ larguraPt: 600, alturaPt: 800, rotacao: 270 }, 72), { largura: 800, altura: 600 });
  assert.deepEqual(tamanhoRenderizado({ larguraPt: 600, alturaPt: 800, rotacao: 90 }, 72), { largura: 800, altura: 600 });
  // amostra real medida: A3 842x1191 pt, rot 270, 30 dpi → 497x351 (conferido com pdftoppm)
  assert.deepEqual(tamanhoRenderizado({ larguraPt: 842, alturaPt: 1191, rotacao: 270 }, 30), { largura: 497, altura: 351 });
});

test('calcularRecorte: fração da página JÁ GIRADA → pixels da imagem renderizada', () => {
  const pagina = { larguraPt: 600, alturaPt: 800, rotacao: 270 }; // exibida 800 x 600 pt
  const c = calcularRecorte(pagina, 72, { x: 0.5, y: 0.25, w: 0.5, h: 0.5 });
  assert.deepEqual(c, { x: 400, y: 150, largura: 400, altura: 300, imagem: { largura: 800, altura: 600 } });
  // sem rotação a mesma fração dá outro resultado (prova de que a rotação é considerada)
  const c0 = calcularRecorte({ ...pagina, rotacao: 0 }, 72, { x: 0.5, y: 0.25, w: 0.5, h: 0.5 });
  assert.deepEqual(c0, { x: 300, y: 200, largura: 300, altura: 400, imagem: { largura: 600, altura: 800 } });
  // dpi maior escala as caixas
  assert.equal(calcularRecorte(pagina, 144, { x: 0.5, y: 0.25, w: 0.5, h: 0.5 }).largura, 800);
});

test('calcularRecorte: nunca sai da imagem nem devolve tamanho zero', () => {
  const pagina = { larguraPt: 842, alturaPt: 1191, rotacao: 270 };
  const total = calcularRecorte(pagina, 50, { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual([total.x, total.y, total.largura, total.altura], [0, 0, total.imagem.largura, total.imagem.altura]);
  const borda = calcularRecorte(pagina, 50, { x: 0.999, y: 0.999, w: 0.001, h: 0.001 });
  assert.ok(borda.largura >= 1 && borda.altura >= 1);
  assert.ok(borda.x + borda.largura <= borda.imagem.largura && borda.y + borda.altura <= borda.imagem.altura);
});

// ---------- nomes e PNG ----------
test('nomes de arquivo', () => {
  assert.equal(nomePagina(4), 'pagina-04.png');
  assert.equal(nomePagina(11), 'pagina-11.png');
  assert.equal(nomeTexto(3), 'pagina-03.txt');
  assert.equal(nomeRecorte({ pagina: 4, x: 0.1, y: 0.2, w: 0.5, h: 0.3 }), 'recorte-04-0.1-0.2-0.5-0.3.png');
});

test('lerDimensoesPng: lê IHDR e recusa outros formatos', () => {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(497, 16);
  png.writeUInt32BE(351, 20);
  assert.deepEqual(lerDimensoesPng(png), { largura: 497, altura: 351 });
  assert.equal(lerDimensoesPng(Buffer.from('não é png, só texto aleatório aqui')), null);
  assert.equal(lerDimensoesPng(Buffer.alloc(4)), null);
});

// ---------- busca do poppler no winget ----------
test('pastasWinget: acha oschwartz10612.Poppler_*\\poppler-*\\Library\\bin, mais novo primeiro; sem pasta → vazio', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'skill-'));
  try {
    const pacote = join(raiz, 'Microsoft', 'WinGet', 'Packages', 'oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe');
    mkdirSync(join(pacote, 'poppler-24.08.0', 'Library', 'bin'), { recursive: true });
    mkdirSync(join(pacote, 'poppler-25.07.0', 'Library', 'bin'), { recursive: true });
    mkdirSync(join(raiz, 'Microsoft', 'WinGet', 'Packages', 'outro.Pacote_x'), { recursive: true });
    const r = pastasWinget(raiz);
    assert.equal(r.length, 2);
    assert.ok(r[0].includes('poppler-25.07.0') && r[0].endsWith(join('Library', 'bin')));
    assert.deepEqual(pastasWinget(join(raiz, 'nao-existe')), []);
    assert.deepEqual(pastasWinget(undefined), []);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});
