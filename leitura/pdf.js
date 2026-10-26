// ==========================================================================
// Conferências do PDF enviado, sem poppler e sem gravar em disco:
//   - é PDF de verdade (assinatura %PDF- no começo do arquivo)?
//   - está protegido por senha (/Encrypt)? A API não lê PDF criptografado.
//   - quantas páginas tem (heurística: /Count da árvore /Pages, inclusive dentro de
//     object streams comprimidos; sem /Pages, conta os objetos /Type /Page).
// Nada do conteúdo é executado nem registrado em log.
// ==========================================================================
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MAX_INFLADO_POR_STREAM = 8 * 1024 * 1024;   // proteção contra "zip bomb"
const MAX_INFLADO_TOTAL = 64 * 1024 * 1024;

// %PDF- nos primeiros 1024 bytes (a especificação tolera lixo antes) seguido da versão
function ehPdf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return false;
  const i = buf.subarray(0, 1024).indexOf('%PDF-');
  return i >= 0 && /^%PDF-\d\.\d/.test(buf.subarray(i, i + 8).toString('latin1'));
}

const protegidoPorSenha = latin => /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(latin);

// maior /Count entre os dicionários /Type /Pages do texto (a raiz tem o total); 0 se não achar
function maiorCount(texto) {
  let maior = 0;
  for (const m of texto.matchAll(/\/Type\s*\/Pages(?![A-Za-z])/g)) {
    const janela = texto.slice(Math.max(0, m.index - 400), m.index + 400);
    for (const c of janela.matchAll(/\/Count\s+(\d+)/g)) maior = Math.max(maior, Number(c[1]));
  }
  return maior;
}
const objetosPagina = texto => (texto.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;

// conteúdo descomprimido dos object streams (/Type /ObjStm, FlateDecode)
function objectStreams(buf, latin) {
  const saida = [];
  let total = 0;
  for (const m of latin.matchAll(/stream\r?\n/g)) {
    if (latin.slice(m.index - 3, m.index) === 'end') continue;
    const dic = latin.slice(Math.max(0, m.index - 1000), m.index);
    const ultimo = dic.lastIndexOf(' obj');
    const cab = ultimo >= 0 ? dic.slice(ultimo) : dic;
    if (!/\/Type\s*\/ObjStm/.test(cab) || !/\/FlateDecode/.test(cab)) continue;
    const ini = m.index + m[0].length;
    const fim = latin.indexOf('endstream', ini);
    if (fim < 0) continue;
    try {
      const dados = zlib.inflateSync(buf.subarray(ini, fim), { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: MAX_INFLADO_POR_STREAM });
      total += dados.length;
      if (total > MAX_INFLADO_TOTAL) break;
      saida.push(dados.toString('latin1'));
    } catch { /* stream ilegível: ignora (a contagem é heurística) */ }
  }
  return saida;
}

// → número de páginas ou null (não foi possível contar)
function contarPaginas(buf) {
  const latin = buf.toString('latin1');
  const textos = [latin, ...objectStreams(buf, latin)];
  const count = Math.max(...textos.map(maiorCount));
  if (count > 0) return count;
  const objs = textos.reduce((s, t) => s + objetosPagina(t), 0);
  return objs > 0 ? objs : null;
}

// → { ok: true, paginas, sha256 } | { ok: false, erro }
function examinarPdf(buf, { maxPaginas }) {
  if (!ehPdf(buf)) return { ok: false, erro: 'O arquivo não é um PDF válido.' };
  const latin = buf.toString('latin1');
  if (protegidoPorSenha(latin)) return { ok: false, erro: 'O PDF está protegido por senha. Gere o PDF sem proteção e envie de novo.' };
  const paginas = contarPaginas(buf);
  if (paginas !== null && paginas > maxPaginas) {
    return { ok: false, erro: `O PDF tem ${paginas} páginas; o máximo para leitura é ${maxPaginas}. Envie só as pranchas com as portas.` };
  }
  return { ok: true, paginas, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

module.exports = { ehPdf, contarPaginas, examinarPdf, protegidoPorSenha };
