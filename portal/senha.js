// ==========================================================================
// Regras de senha do portal do cliente (função pura).
// 12 a 72 BYTES em UTF-8 (o limite do bcrypt é em bytes, não em caracteres).
// ==========================================================================
const MINIMO = 12;
const MAXIMO_BYTES = 72;
// parte local do e-mail com menos que isto não entra na regra (recusaria por acaso)
const MINIMO_PARTE_LOCAL = 4;

// Senhas comuns recusadas (comparação sem diferenciar caixa).
const SENHAS_FRACAS = [
  '123456789012', '111111111111', '000000000000', '123456123456', '1234567890ab',
  'senhasenha12', 'senha1234567', 'senha@123456', 'mudar1234567', 'password1234',
  'passwordpassword', 'qwertyuiop12', 'qwertyuiop123', 'qwerty123456', 'abcdefghijkl',
  'elegance2026', 'elegance2025', 'elegance1234', 'elegancealuminio', 'eleganceesquadrias',
];

function validarSenha(senha, { email } = {}) {
  if (typeof senha !== 'string') return { ok: false, motivo: 'Informe a senha.' };
  if ([...senha].length < MINIMO) return { ok: false, motivo: `A senha precisa ter pelo menos ${MINIMO} caracteres.` };
  if (Buffer.byteLength(senha, 'utf8') > MAXIMO_BYTES) {
    return { ok: false, motivo: `A senha é longa demais: o limite é ${MAXIMO_BYTES} bytes (letras acentuadas contam mais de um).` };
  }
  if (new Set(senha).size === 1) return { ok: false, motivo: 'A senha não pode ser um único caractere repetido.' };

  const baixa = senha.toLowerCase();
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (mail) {
    const local = mail.split('@')[0];
    if (mail.includes(baixa) || (local.length >= MINIMO_PARTE_LOCAL && baixa.includes(local))) {
      return { ok: false, motivo: 'A senha não pode conter o seu e-mail.' };
    }
  }
  if (SENHAS_FRACAS.includes(baixa)) return { ok: false, motivo: 'Essa senha é muito comum. Escolha outra.' };
  return { ok: true };
}

module.exports = { validarSenha, SENHAS_FRACAS, MINIMO, MAXIMO_BYTES };
