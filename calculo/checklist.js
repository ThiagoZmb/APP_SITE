// Checklist de produção em PDF (um único documento vigente, guardado na tabela web_checklist): funções puras.
// Mesma conferência do DANFE: pelos bytes (assinatura %PDF- e tamanho), nunca pelo tipo declarado.
const MAX_PDF = 5 * 1024 * 1024; // 5 MB
const NOME_PADRAO = 'checklist.pdf';
const MAX_NOME = 150;

function validarPdf(corpo) {
  if (!Buffer.isBuffer(corpo) || !corpo.length) return { ok: false, motivo: 'Envie o arquivo PDF do checklist.' };
  if (corpo.length > MAX_PDF) return { ok: false, motivo: 'PDF muito grande (máximo 5 MB).' };
  if (corpo.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, motivo: 'O arquivo não é um PDF.' };
  return { ok: true };
}

// nome do arquivo para exibição: sem caminho, sem caracteres de controle, até 150 caracteres; vazio = padrão
function nomeDoArquivo(nome) {
  const base = String(nome ?? '').split(/[\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NOME);
  return base || NOME_PADRAO;
}

module.exports = { MAX_PDF, NOME_PADRAO, validarPdf, nomeDoArquivo };
