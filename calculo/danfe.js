// Nota fiscal em PDF (DANFE) pelo pedido: funções puras (testáveis sem banco).
// O nome do arquivo é a chave de acesso de 44 dígitos: 1-2 UF, 3-6 AAMM, 7-20 CNPJ do emitente, 21-22 modelo, 23-25 série,
// 26-34 número da NF, 35 tpEmis, 36-43 cNF, 44 DV (módulo 11). NUNCA se confia no nome sem conferir a chave inteira.
const { chaveValida } = require('./notas_fiscais');

const MAX_PDF = 2 * 1024 * 1024; // 2 MB por DANFE
const MAX_DIGITOS_NF = 9;

// separa a chave em campos; `valida` = 44 dígitos com DV certo (os demais campos só vêm preenchidos se a chave for válida)
function lerChave(chave) {
  const s = String(chave ?? '').trim();
  if (!chaveValida(s)) return { valida: false };
  return { valida: true, chave: s, uf: s.slice(0, 2), aamm: s.slice(2, 6), cnpj: s.slice(6, 20), modelo: s.slice(20, 22),
    serie: Number(s.slice(22, 25)), numeroNf: Number(s.slice(25, 34)), dv: Number(s[43]) };
}

// "35260608951388...pdf" (com ou sem caminho/extensão .pdf em qualquer caixa) -> chave válida, senão ''
function chaveDoNomeDoArquivo(nome) {
  const base = String(nome ?? '').split(/[\\/]/).pop().trim();
  const m = /^(\d{44})\.pdf$/i.exec(base);
  return m && chaveValida(m[1]) ? m[1] : '';
}

// Números de NF de um texto do financeiro ("8862/8887", "8862, 8887", "000123", "NF 55; 7"): divide por "/", vírgula, ";" e espaço,
// ignora tokens que não sejam só dígitos, tira zeros à esquerda (000123 = 123), descarta 0 e mais de 9 dígitos; sem repetição.
function numerosDeNotaFiscal(texto) {
  const saida = [];
  for (const token of String(texto ?? '').split(/[\/,;\s]+/)) {
    if (!/^\d+$/.test(token)) continue;
    const limpo = token.replace(/^0+/, '');
    if (!limpo || limpo.length > MAX_DIGITOS_NF) continue;
    const n = Number(limpo);
    if (!saida.includes(n)) saida.push(n);
  }
  return saida;
}

// confere o PDF pelos bytes (assinatura %PDF- e tamanho 1 byte a 2 MB), nunca pelo tipo declarado
function validarPdf(corpo) {
  if (!Buffer.isBuffer(corpo) || !corpo.length) return { ok: false, motivo: 'Envie o arquivo PDF da nota.' };
  if (corpo.length > MAX_PDF) return { ok: false, motivo: 'PDF muito grande (máximo 2 MB).' };
  if (corpo.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, motivo: 'O arquivo não é um PDF.' };
  return { ok: true };
}

module.exports = { MAX_PDF, lerChave, chaveDoNomeDoArquivo, numerosDeNotaFiscal, validarPdf };
