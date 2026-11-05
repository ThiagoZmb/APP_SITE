// Exame de imagem (PNG ou JPEG) antes de mandar para a API: confere a ASSINATURA do arquivo (o Content-Type não basta),
// o tamanho em bytes e as dimensões em pixels, sem biblioteca de imagem. O conteúdo nunca vai para disco nem para log.
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LIMITES = { bytes: 3 * 1024 * 1024, ladoMin: 150, ladoMax: 8000 };

function dimensoesPng(b) {
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}
function dimensoesJpeg(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null;
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// → { ok:true, tipo:'image/png'|'image/jpeg', largura, altura, bytes } | { ok:false, erro }
function examinarImagem(buf, limites = {}) {
  const lim = { ...LIMITES, ...limites };
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, erro: 'Imagem vazia.' };
  if (buf.length > lim.bytes) return { ok: false, erro: `Imagem grande demais (${(buf.length / 1024 / 1024).toFixed(1).replace('.', ',')} MB). O máximo é ${Math.round(lim.bytes / 1024 / 1024)} MB.` };
  let tipo = null, dim = null;
  if (buf.length > 8 && buf.subarray(0, 8).equals(ASSINATURA_PNG)) { tipo = 'image/png'; dim = dimensoesPng(buf); }
  else if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) { tipo = 'image/jpeg'; dim = dimensoesJpeg(buf); }
  if (!tipo) return { ok: false, erro: 'A imagem precisa ser PNG ou JPEG (arquivo de outro formato ou corrompido).' };
  if (!dim || !(dim.largura > 0) || !(dim.altura > 0)) return { ok: false, erro: 'Não foi possível ler o tamanho da imagem (arquivo corrompido).' };
  if (dim.largura < lim.ladoMin || dim.altura < lim.ladoMin) return { ok: false, erro: `Imagem pequena demais (${dim.largura} x ${dim.altura} px). Use pelo menos ${lim.ladoMin} px de cada lado; quanto maior a resolução, melhor a leitura.` };
  if (dim.largura > lim.ladoMax || dim.altura > lim.ladoMax) return { ok: false, erro: `Imagem com dimensões demais (${dim.largura} x ${dim.altura} px). Reduza para no máximo ${lim.ladoMax} px.` };
  return { ok: true, tipo, largura: dim.largura, altura: dim.altura, bytes: buf.length };
}

module.exports = { examinarImagem, LIMITES };
