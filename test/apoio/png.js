// PNG sólido de qualquer tamanho, gerado na hora, para os testes de desenho.
// tipoCor: 0 = tons de cinza (1 byte/pixel), 2 = RGB (3), 6 = RGBA (4, o que o canvas gera)
const zlib = require('node:zlib');

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const bloco = (tipo, dados) => {
  const t = Buffer.from(tipo, 'ascii');
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, dados])) >>> 0);
  return Buffer.concat([tam, t, dados, crc]);
};
const AMOSTRAS = { 0: 1, 2: 3, 6: 4 };

function pngSolido(largura, altura, cinza = 128, tipoCor = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = tipoCor;
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(largura * AMOSTRAS[tipoCor], cinza)]);
  const bruto = Buffer.concat(Array.from({ length: altura }, () => linha));
  return Buffer.concat([ASSINATURA, bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(bruto)), bloco('IEND', Buffer.alloc(0))]);
}

// mesmo PNG com os dados comprimidos (IDAT) corrompidos, mas com assinatura, IHDR e CRCs válidos
function pngComIdatCorrompido(largura, altura, tipoCor = 6) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = tipoCor;
  return Buffer.concat([ASSINATURA, bloco('IHDR', ihdr), bloco('IDAT', Buffer.from('isto nao e zlib de verdade')), bloco('IEND', Buffer.alloc(0))]);
}

module.exports = { pngSolido, pngComIdatCorrompido };
