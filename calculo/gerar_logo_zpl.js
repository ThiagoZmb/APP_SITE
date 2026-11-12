// Gera calculo/etiqueta_logo.js (logo da etiqueta em bitmap 1-bit para ^GFA) a partir de imagens/logo_elegance.png.
// Uso (so quando o logo mudar): node calculo/gerar_logo_zpl.js
// Deterministico: sem rede e sem dependencia; usa so zlib do Node. Aceita PNG RGB/RGBA/cinza de 8 bits, sem entrelacamento.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LARGURA_DOTS = 224; // 28 mm a 203 dpi (8 dots/mm); multiplo de 8
const CORTE_ESCURO = 0.30; // fracao minima de "tinta" no bloco para virar ponto preto (preserva o filete fino)

function decodificarPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Nao e PNG.');
  let pos = 8, w = 0, h = 0, canais = 0; const idat = [];
  while (pos < buf.length) {
    const tam = buf.readUInt32BE(pos), tipo = buf.toString('latin1', pos + 4, pos + 8), dados = buf.subarray(pos + 8, pos + 8 + tam);
    if (tipo === 'IHDR') {
      w = dados.readUInt32BE(0); h = dados.readUInt32BE(4);
      const prof = dados[8], cor = dados[9], entrelaca = dados[12];
      if (prof !== 8 || entrelaca !== 0 || ![0, 2, 6].includes(cor)) throw new Error('PNG nao suportado (8 bits, sem entrelacamento, cinza/RGB/RGBA).');
      canais = { 0: 1, 2: 3, 6: 4 }[cor];
    } else if (tipo === 'IDAT') idat.push(dados);
    else if (tipo === 'IEND') break;
    pos += 12 + tam;
  }
  const cru = zlib.inflateSync(Buffer.concat(idat));
  const linha = w * canais, px = Buffer.alloc(h * linha);
  for (let y = 0; y < h; y++) {
    const f = cru[y * (linha + 1)], ini = y * (linha + 1) + 1;
    for (let i = 0; i < linha; i++) {
      const x = cru[ini + i];
      const a = i >= canais ? px[y * linha + i - canais] : 0;
      const b = y > 0 ? px[(y - 1) * linha + i] : 0;
      const c = i >= canais && y > 0 ? px[(y - 1) * linha + i - canais] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error('Filtro PNG invalido.');
      px[y * linha + i] = v & 255;
    }
  }
  // tinta 0..1 por pixel (luminancia invertida; alfa transparente = sem tinta)
  const tinta = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * canais;
    const lum = canais === 1 ? px[o] : 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
    const alfa = canais === 4 ? px[o + 3] / 255 : 1;
    tinta[i] = (1 - lum / 255) * alfa;
  }
  return { w, h, tinta };
}

function gerar() {
  const { w, h, tinta } = decodificarPng(fs.readFileSync(path.join(__dirname, '..', 'imagens', 'logo_elegance.png')));
  const largura = LARGURA_DOTS, altura = Math.round(h * largura / w), bytesPorLinha = largura / 8;
  const escala = w / largura;
  let hex = '';
  for (let y = 0; y < altura; y++) {
    for (let bx = 0; bx < bytesPorLinha; bx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit;
        const x0 = x * escala, x1 = (x + 1) * escala, y0 = y * escala, y1 = (y + 1) * escala;
        let soma = 0, area = 0;
        for (let yy = Math.floor(y0); yy < Math.min(h, Math.ceil(y1)); yy++) {
          const hy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (let xx = Math.floor(x0); xx < Math.min(w, Math.ceil(x1)); xx++) {
            const hx = Math.min(xx + 1, x1) - Math.max(xx, x0), a = hx * hy;
            soma += tinta[yy * w + xx] * a; area += a;
          }
        }
        if (area > 0 && soma / area >= CORTE_ESCURO) byte |= 0x80 >> bit;
      }
      hex += byte.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  const saida = '// GERADO por calculo/gerar_logo_zpl.js a partir de imagens/logo_elegance.png. Nao edite a mao.\n' +
    `// Bitmap 1-bit ${largura} x ${altura} dots (28 mm a 203 dpi) para ^GFA; bit 1 = ponto preto.\n` +
    `module.exports = { largura: ${largura}, altura: ${altura}, bytesPorLinha: ${bytesPorLinha}, hex: '${hex}' };\n`;
  fs.writeFileSync(path.join(__dirname, 'etiqueta_logo.js'), saida);
  return { largura, altura, hex };
}

if (require.main === module) {
  const { largura, altura, hex } = gerar();
  console.log(`Logo ${largura}x${altura} dots, ${hex.length / 2} bytes.`);
}

module.exports = { decodificarPng, gerar };
