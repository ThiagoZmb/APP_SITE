// PNG sólido (cinza) de qualquer tamanho, gerado na hora, para os testes de desenho.
const zlib = require('node:zlib');

const bloco = (tipo, dados) => {
  const t = Buffer.from(tipo, 'ascii');
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, dados])) >>> 0);
  return Buffer.concat([tam, t, dados, crc]);
};

function pngSolido(largura, altura, cinza = 128) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = 0;   // 8 bits, tons de cinza
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(largura, cinza)]);
  const bruto = Buffer.concat(Array.from({ length: altura }, () => linha));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(bruto)), bloco('IEND', Buffer.alloc(0))]);
}

module.exports = { pngSolido };
