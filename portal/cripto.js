// ==========================================================================
// Cifra para segredos guardados no banco (ex.: segredo TOTP): AES-256-GCM.
// Formato `v1:<iv>:<tag>:<cifrado>`, cada parte em base64; IV novo a cada vez.
// Os erros nunca carregam o texto cifrado nem o decifrado.
// ==========================================================================
const crypto = require('node:crypto');

function criarCripto(chaveBase64) {
  const chave = Buffer.from(typeof chaveBase64 === 'string' ? chaveBase64 : '', 'base64');
  if (chave.length !== 32) throw new Error('A chave de cifra precisa ter exatamente 32 bytes (base64).');

  function cifrar(texto) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', chave, iv);
    const cifrado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
  }

  function decifrar(blob) {
    const partes = typeof blob === 'string' ? blob.split(':') : [];
    if (partes.length !== 4 || partes[0] !== 'v1') throw new Error('Formato de dado cifrado inválido.');
    const iv = Buffer.from(partes[1], 'base64');
    const tag = Buffer.from(partes[2], 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Formato de dado cifrado inválido.');
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', chave, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(Buffer.from(partes[3], 'base64')), d.final()]).toString('utf8');
    } catch {
      throw new Error('Não foi possível decifrar o dado.');
    }
  }

  return { cifrar, decifrar };
}

module.exports = { criarCripto };
