// Validação do PNG enviado como desenho: o pdfkit decodifica o PNG de forma assíncrona e uma exceção ali derruba o processo,
// então o servidor só aceita PNG que descomprime direito e tem tamanho razoável.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { validarPng } = require('../calculo/png');
const { pngSolido, pngComIdatCorrompido } = require('./apoio/png');

test('validarPng: aceita PNG de tons de cinza, RGB e RGBA (o do canvas) com o tamanho que a tela gera', () => {
  for (const tipo of [0, 2, 6]) {
    const r = validarPng(pngSolido(214, 500, 90, tipo));
    assert.equal(r.ok, true, 'tipo ' + tipo + ': ' + r.erro);
    assert.deepEqual([r.largura, r.altura], [214, 500]);
  }
});

test('validarPng: recusa IDAT corrompido (assinatura e IHDR válidos), bytes soltos e arquivo truncado', () => {
  assert.equal(validarPng(pngComIdatCorrompido(100, 200, 6)).ok, false);
  assert.equal(validarPng(Buffer.from('<html>oi</html>')).ok, false);
  assert.equal(validarPng(Buffer.alloc(0)).ok, false);
  const bom = pngSolido(50, 50);
  assert.equal(validarPng(bom.subarray(0, bom.length - 20)).ok, false);       // sem IEND
  assert.equal(validarPng(bom.subarray(0, 40)).ok, false);                    // corta no meio
});

test('validarPng: recusa dimensões enormes ou zero antes de decodificar nada', () => {
  const ihdrGrande = pngSolido(10, 10);
  ihdrGrande.writeUInt32BE(60000, 16); ihdrGrande.writeUInt32BE(60000, 20);   // IHDR declara 60000×60000 (CRC vira inválido também)
  assert.equal(validarPng(ihdrGrande).ok, false);
  assert.equal(validarPng(pngSolido(601, 100)).ok, false);
  assert.equal(validarPng(pngSolido(100, 1001)).ok, false);
});

test('validarPng: recusa CRC errado, bit depth diferente de 8, entrelaçado e filtro de linha inválido', () => {
  const crcRuim = pngSolido(20, 20);
  crcRuim[crcRuim.length - 20] ^= 0xff;                                       // mexe no meio do IDAT
  assert.equal(validarPng(crcRuim).ok, false);
  const entrelacado = pngSolido(20, 20);
  entrelacado[28] = 1;                                                        // byte de entrelaçamento do IHDR
  assert.equal(validarPng(entrelacado).ok, false);
  // filtro de linha 9 (inexistente), com CRC refeito para o resto continuar válido
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 0;
  const bloco = (t, d) => { const tam = Buffer.alloc(4); tam.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t), d])) >>> 0); return Buffer.concat([tam, Buffer.from(t), d, c]); };
  const bruto = Buffer.concat(Array.from({ length: 4 }, () => Buffer.concat([Buffer.from([9]), Buffer.alloc(4)])));
  const ruim = Buffer.concat([pngSolido(1, 1).subarray(0, 8), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(bruto)), bloco('IEND', Buffer.alloc(0))]);
  assert.equal(validarPng(ruim).ok, false);
});
