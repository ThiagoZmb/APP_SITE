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

// minúsculas, sem acento e só letras e dígitos: "Elegance-2026!" vira "elegance2026"
const normalizar = t => String(t).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');
const FRACAS_NORMALIZADAS = new Set(SENHAS_FRACAS.map(normalizar));

function validarSenha(senha, { email } = {}) {
  if (typeof senha !== 'string') return { ok: false, motivo: 'Informe a senha.' };
  if (senha !== senha.trim()) return { ok: false, motivo: 'A senha não pode começar nem terminar com espaço.' };
  if ([...senha].length < MINIMO) return { ok: false, motivo: `A senha precisa ter pelo menos ${MINIMO} caracteres.` };
  if (Buffer.byteLength(senha, 'utf8') > MAXIMO_BYTES) {
    return { ok: false, motivo: `A senha é longa demais: o limite é ${MAXIMO_BYTES} bytes (letras acentuadas contam mais de um).` };
  }
  if (new Set(senha).size === 1) return { ok: false, motivo: 'A senha não pode ser um único caractere repetido.' };

  const baixa = senha.toLowerCase();
  const norm = normalizar(senha);
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (mail) {
    const nMail = normalizar(mail);
    const nLocal = normalizar(mail.split('@')[0]);
    // senha só de símbolos normaliza para '' e não pode "estar contida" em tudo
    const contida = mail.includes(baixa) || (norm !== '' && nMail.includes(norm));
    if (contida || (nLocal.length >= MINIMO_PARTE_LOCAL && norm.includes(nLocal))) {
      return { ok: false, motivo: 'A senha não pode conter o seu e-mail.' };
    }
  }
  if (FRACAS_NORMALIZADAS.has(norm)) return { ok: false, motivo: 'Essa senha é muito comum. Escolha outra.' };
  return { ok: true };
}

module.exports = { validarSenha, SENHAS_FRACAS, MINIMO, MAXIMO_BYTES };
