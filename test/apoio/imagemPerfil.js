// Apoio dos testes da leitura de imagem do perfil: imagem PNG/JPEG mínima e uma "leitura" simulada do perfil 1036
// (pixels aproximados da imagem de cotas: seção à direita, ~4,55 px/mm, com ruído de +-1,5 px como um modelo de visão faria).
const zlib = require('node:zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
const bloco = (tipo, dados) => {
  const t = Buffer.from(tipo), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(dados.length); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
};
// PNG cinza válido de largura x altura (pixels brancos)
function png(largura = 1200, altura = 800) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 0;
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(largura, 255)]);
  const cru = Buffer.concat(Array.from({ length: altura }, () => linha));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(cru)), bloco('IEND', Buffer.alloc(0))]);
}
// JPEG só com os marcadores que o leitor de tamanho precisa (não decodifica)
function jpeg(largura = 1000, altura = 700) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 255, largura >> 8, largura & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), sof, Buffer.from([0xff, 0xd9])]);
}

// ---- perfil 1036 em pixels (imagem 1200 x 800; origem da seção em (600, 650); 4,55 px/mm) ----
const ESC = 4.55, OX = 600, OY = 650;
const px = (x, y) => [OX + x * ESC, OY - y * ESC];
const ruido = [[1.2, -0.8], [-1, 1.4], [0.6, 0.9], [-1.4, -1], [0.9, 1.1], [-0.7, 0.8], [1.3, -1.2], [-0.5, -0.6]];
const com = (pts, off = 0) => pts.map(([x, y], i) => { const p = px(x, y), r = ruido[(i + off) % ruido.length]; return [p[0] + r[0], p[1] + r[1]]; });
const CONTORNO_MM = [[0, 0], [18.9, 0], [18.9, 45], [6, 45], [6, 1.5], [1.5, 1.5], [1.5, 7.8], [0, 7.8]];
const OCO_MM = [[7.5, 1.5], [17.4, 1.5], [17.4, 43.5], [7.5, 43.5]];
const cota = (texto, valor, a, b) => ({ texto, valor, p1: a, p2: b, incerteza: 'alta' });
function leituraPixels1036() {
  return {
    contorno: com(CONTORNO_MM), vazados: [com(OCO_MM, 3)],
    cotas: [
      cota('18,9', 18.9, px(0, -3), px(18.9, -3)),     // largura total (linha de cota abaixo da seção)
      cota('45', 45, px(-3, 0), px(-3, 45)),            // altura total (à esquerda)
      cota('12,9', 12.9, px(6, 47), px(18.9, 47)),      // caixa oca (acima)
      cota('7,8', 7.8, px(-1.5, 0), px(-1.5, 7.8))      // pé em U
    ].map(c => ({ ...c, p1: c.p1.map(v => v + 0.4), p2: c.p2.map(v => v - 0.4) })),
    canal: (() => { const a = px(1.5, 12), b = px(6, 1.5); return { x0: a[0] + 0.8, y0: a[1], x1: b[0] - 0.8, y1: b[1] + 0.6 }; })(),
    junta: null, incertezas: [{ item: 'espessura da parede', nivel: 'media', motivo: 'a imagem não cota a parede' }],
    observacoes: 'Seção do perfil 1036 com 4 cotas.', descartadas: 0, naoEncontrada: false
  };
}
// a mesma leitura, no formato que o modelo devolve (0 a 1000 em cada eixo)
function respostaModelo1036(largura = 1200, altura = 800, extra = {}) {
  const n = ([x, y]) => [Math.round(x / largura * 10000) / 10, Math.round(y / altura * 10000) / 10];
  const l = leituraPixels1036();
  return {
    secaoEncontrada: true, contorno: l.contorno.map(n),
    vazados: l.vazados.map((v, i) => ({ descricao: i ? 'nervura' : 'oco principal', pontos: v.map(n) })),
    cotas: l.cotas.map(c => ({ texto: c.texto, valor: c.valor, p1: n(c.p1), p2: n(c.p2), incerteza: 'alta' })),
    canalVidro: (() => { const a = n([l.canal.x0, l.canal.y0]), b = n([l.canal.x1, l.canal.y1]); return { x0: a[0], y0: a[1], x1: b[0], y1: b[1] }; })(),
    junta: 'desconhecida', incertezas: l.incertezas, observacoes: l.observacoes, ...extra
  };
}

module.exports = { png, jpeg, leituraPixels1036, respostaModelo1036, CONTORNO_MM, OCO_MM };
