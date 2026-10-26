// ============================================================
// PDF (funções PURAS, sem poppler): classificação de página, cálculo de recorte,
// leitura da saída de pdfinfo/pdfimages e validação de argumentos.
// Nada aqui executa programa nem acessa disco: tudo é testável sem poppler.
// ============================================================

// ---------- regras de classificação (documentadas em references/leitura-pdf.md) ----------
// Página "tem texto" quando tem pelo menos TEXTO_MINIMO caracteres que não são espaço.
// Abaixo disso (ex.: só o número da página) conta como sem texto.
export const TEXTO_MINIMO = 20;
// Imagem "grande" = uma única imagem cobre pelo menos esta fração da área da página.
export const COBERTURA_IMAGEM_GRANDE = 0.5;

export const CLASSIFICACOES = ['texto_vetorial', 'vetorial_sem_texto', 'escaneado', 'misto'];

// texto + imagem grande → misto | texto → texto_vetorial | sem texto + imagem grande → escaneado | resto → vetorial_sem_texto
export function classificarPagina({ caracteres, coberturaImagem }) {
  const temTexto = caracteres >= TEXTO_MINIMO;
  const imagemGrande = coberturaImagem >= COBERTURA_IMAGEM_GRANDE;
  if (temTexto && imagemGrande) return 'misto';
  if (temTexto) return 'texto_vetorial';
  if (imagemGrande) return 'escaneado';
  return 'vetorial_sem_texto';
}

export const contarCaracteres = texto => String(texto ?? '').replace(/\s+/g, '').length;

// ---------- leitura da saída dos programas do poppler ----------
// pdfinfo -f 1 -l N → { paginas, tamanhos: Map(numero → { larguraPt, alturaPt, rotacao }) }
// larguraPt/alturaPt são da página SEM girar (como no arquivo); a rotação vem à parte.
export function lerPdfinfo(texto) {
  const t = String(texto);
  const total = /^Pages:\s+(\d+)/m.exec(t);
  const tamanhos = new Map();
  for (const m of t.matchAll(/^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/gm)) {
    tamanhos.set(Number(m[1]), { larguraPt: Number(m[2]), alturaPt: Number(m[3]), rotacao: 0 });
  }
  for (const m of t.matchAll(/^Page\s+(\d+)\s+rot:\s+(-?\d+)/gm)) {
    const p = tamanhos.get(Number(m[1]));
    if (p) p.rotacao = ((Number(m[2]) % 360) + 360) % 360;
  }
  return { paginas: total ? Number(total[1]) : 0, tamanhos };
}

// pdfimages -list → Map(pagina → [{ larguraPx, alturaPx, ppiX, ppiY }]); só imagens reais (ignora máscaras)
export function lerPdfimagesLista(texto) {
  const porPagina = new Map();
  for (const linha of String(texto).split(/\r?\n/)) {
    const c = linha.trim().split(/\s+/);
    if (c.length < 15 || !/^\d+$/.test(c[0]) || !['image', 'stencil'].includes(c[2])) continue;
    const [pagina, larguraPx, alturaPx] = [Number(c[0]), Number(c[3]), Number(c[4])];
    const ppiX = Number(c[12]), ppiY = Number(c[13]);
    if (![larguraPx, alturaPx, ppiX, ppiY].every(Number.isFinite) || ppiX <= 0 || ppiY <= 0) continue;
    if (!porPagina.has(pagina)) porPagina.set(pagina, []);
    porPagina.get(pagina).push({ larguraPx, alturaPx, ppiX, ppiY });
  }
  return porPagina;
}

// Maior fração da página coberta por UMA imagem (0..1). Área exibida = px / ppi * 72 pt.
export function coberturaImagem(imagens, larguraPt, alturaPt) {
  const areaPagina = larguraPt * alturaPt;
  if (!(areaPagina > 0)) return 0;
  const maior = Math.max(0, ...(imagens ?? []).map(i => (i.larguraPx / i.ppiX * 72) * (i.alturaPx / i.ppiY * 72)));
  return Math.min(1, maior / areaPagina);
}

// pdffonts -f N -l N → nº de fontes (descarta as 2 linhas de cabeçalho)
export function contarFontes(texto) {
  const linhas = String(texto).split(/\r?\n/).filter(l => l.trim());
  return Math.max(0, linhas.length - 2);
}

// Texto de `pdftoppm -v` → versão, ou null se não for poppler (Xpdf e outros não passam)
export function lerVersaoPoppler(texto) {
  const t = String(texto);
  if (!/poppler/i.test(t)) return null;
  const m = /version\s+([\d.]+)/i.exec(t);
  return m ? m[1] : null;
}

// ---------- validação dos argumentos ----------
export const DPI_MIN = 30;
export const DPI_MAX = 400;

export function validarDpi(valor, nome = '--dpi') {
  const n = Number(valor);
  if (!/^\d+(\.\d+)?$/.test(String(valor)) || !(n >= DPI_MIN && n <= DPI_MAX)) {
    throw new Error(`${nome} deve ser um número entre ${DPI_MIN} e ${DPI_MAX} (recebido "${valor}")`);
  }
  return n;
}

// "4,11" ou "2-5,9" → [2,3,4,5,9] (ordenado, sem repetição); valida contra o total de páginas
export function lerListaPaginas(texto, total) {
  const paginas = new Set();
  for (const parte of String(texto).split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(parte.trim());
    if (!m) throw new Error(`lista de páginas inválida: "${texto}" (use por exemplo 4,11 ou 2-5)`);
    const [ini, fim] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (fim < ini) throw new Error(`intervalo de páginas invertido: "${parte}"`);
    if (fim - ini > 10000) throw new Error(`intervalo grande demais: "${parte}"`);
    for (let p = ini; p <= fim; p++) paginas.add(p);
  }
  for (const p of paginas) {
    if (p < 1 || p > total) throw new Error(`página ${p} não existe (o PDF tem ${total} página(s))`);
  }
  return [...paginas].sort((a, b) => a - b);
}

const EPS = 1e-9;

// "PAG:x,y,w,h" (frações 0..1 da página JÁ GIRADA, como aparece na imagem renderizada)
export function lerRecorte(texto, total) {
  const m = /^(\d+):(\d*\.?\d+),(\d*\.?\d+),(\d*\.?\d+),(\d*\.?\d+)$/.exec(String(texto).trim());
  if (!m) throw new Error(`recorte inválido: "${texto}" (use PAG:x,y,w,h com frações 0..1, ex.: 4:0.1,0.2,0.5,0.3)`);
  const pagina = Number(m[1]);
  if (pagina < 1 || pagina > total) throw new Error(`recorte: página ${pagina} não existe (o PDF tem ${total} página(s))`);
  const [x, y, w, h] = m.slice(2).map(Number);
  if (x > 1 || y > 1) throw new Error(`recorte: x e y devem estar entre 0 e 1 (recebido ${x},${y})`);
  if (!(w > 0) || !(h > 0)) throw new Error('recorte: w e h devem ser maiores que 0');
  if (x + w > 1 + EPS || y + h > 1 + EPS) throw new Error(`recorte: x+w e y+h não podem passar de 1 (recebido x+w=${+(x + w).toFixed(6)}, y+h=${+(y + h).toFixed(6)})`);
  return { pagina, x, y, w, h };
}

// ---------- cálculo do recorte em pixels ----------
const girada = rotacao => rotacao === 90 || rotacao === 270;

// Tamanho em pixels da página renderizada (já girada). O poppler arredonda para cima.
export function tamanhoRenderizado({ larguraPt, alturaPt, rotacao }, dpi) {
  const [wPt, hPt] = girada(rotacao) ? [alturaPt, larguraPt] : [larguraPt, alturaPt];
  return { largura: Math.ceil(wPt * dpi / 72 - EPS), altura: Math.ceil(hPt * dpi / 72 - EPS) };
}

// Fração (da página girada) → caixa em pixels da imagem renderizada em `dpi` (para pdftoppm -x -y -W -H).
// Nunca devolve caixa fora da imagem nem com tamanho 0.
export function calcularRecorte(pagina, dpi, { x, y, w, h }) {
  const { largura, altura } = tamanhoRenderizado(pagina, dpi);
  const px = Math.min(largura - 1, Math.max(0, Math.round(x * largura)));
  const py = Math.min(altura - 1, Math.max(0, Math.round(y * altura)));
  const pw = Math.max(1, Math.min(largura - px, Math.round(w * largura)));
  const ph = Math.max(1, Math.min(altura - py, Math.round(h * altura)));
  return { x: px, y: py, largura: pw, altura: ph, imagem: { largura, altura } };
}

// ---------- nomes de arquivo ----------
export const nn = n => String(n).padStart(2, '0');
const fr = n => String(+Number(n).toFixed(4));
export const nomePagina = n => `pagina-${nn(n)}.png`;
export const nomeTexto = n => `pagina-${nn(n)}.txt`;
export const nomeRecorte = ({ pagina, x, y, w, h }) => `recorte-${nn(pagina)}-${fr(x)}-${fr(y)}-${fr(w)}-${fr(h)}.png`;

// ---------- PNG ----------
// Largura e altura do cabeçalho IHDR; null se não for PNG
export function lerDimensoesPng(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}
