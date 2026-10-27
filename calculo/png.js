// Validação do PNG enviado como desenho da porta (função pura).
// O pdfkit decodifica o PNG de forma assíncrona (zlib) e uma exceção nesse callback derruba o processo; por isso o servidor só
// guarda PNG que descomprime direito, com o tamanho esperado, e com dimensões razoáveis (a tela gera no máximo 300×500).
const zlib = require('node:zlib');

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const AMOSTRAS = { 0: 1, 2: 3, 4: 2, 6: 4 };   // bytes por pixel com 8 bits por canal (tipo 3, paleta, não é gerado pela tela)
const MAX_LARGURA = 600, MAX_ALTURA = 1000, MAX_BLOCOS = 200;

function validarPng(png) {
  const falha = erro => ({ ok: false, erro });
  if (!Buffer.isBuffer(png) || png.length < ASSINATURA.length + 12 || !png.subarray(0, 8).equals(ASSINATURA)) return falha('não é PNG');
  let pos = 8, largura = 0, altura = 0, amostras = 0, viuIend = false;
  const idat = [];
  for (let n = 0; pos < png.length && !viuIend; n++) {
    if (n > MAX_BLOCOS || pos + 12 > png.length) return falha('arquivo truncado');
    const tam = png.readUInt32BE(pos), tipo = png.toString('latin1', pos + 4, pos + 8);
    const fim = pos + 8 + tam + 4;
    if (tam > png.length || fim > png.length) return falha('arquivo truncado');
    const dados = png.subarray(pos + 8, pos + 8 + tam);
    if ((zlib.crc32(png.subarray(pos + 4, pos + 8 + tam)) >>> 0) !== png.readUInt32BE(pos + 8 + tam)) return falha('CRC inválido em ' + tipo);
    if (n === 0) {
      if (tipo !== 'IHDR' || tam !== 13) return falha('IHDR ausente');
      largura = dados.readUInt32BE(0); altura = dados.readUInt32BE(4);
      if (!(largura >= 1 && altura >= 1 && largura <= MAX_LARGURA && altura <= MAX_ALTURA)) return falha('dimensões fora do limite');
      amostras = AMOSTRAS[dados[9]];
      if (!amostras || dados[8] !== 8 || dados[10] !== 0 || dados[11] !== 0 || dados[12] !== 0) return falha('formato de PNG não aceito');
    } else if (tipo === 'IDAT') idat.push(dados);
    else if (tipo === 'IEND') viuIend = true;
    pos = fim;
  }
  if (!viuIend || !idat.length) return falha('PNG incompleto');
  const esperado = altura * (1 + largura * amostras);
  let bruto;
  try { bruto = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: esperado + 1 }); } catch { return falha('dados da imagem corrompidos'); }
  if (bruto.length !== esperado) return falha('tamanho dos dados diferente do declarado');
  const linha = 1 + largura * amostras;
  for (let y = 0; y < altura; y++) if (bruto[y * linha] > 4) return falha('filtro de linha inválido');
  return { ok: true, largura, altura };
}

module.exports = { validarPng, MAX_LARGURA, MAX_ALTURA };
