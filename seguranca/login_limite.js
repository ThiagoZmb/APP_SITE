// Limite de falhas de login POR CONTA (além do limite por IP do index.js): o atacante
// que troca de IP não consegue tentar senhas sem fim em um mesmo usuário.
// Contador só em memória: vale para uma instância (o Render roda uma). Reiniciar zera.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Hash de um valor aleatório gerado na subida: usuário inexistente gasta o mesmo tempo
// de bcrypt que usuário existente com senha errada (não revela quais contas existem).
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);

const MAX_CHAVES = 10000; // teto de contas guardadas (nomes inventados não enchem a memória)

function criarLimiteLogin({ maxFalhas = 5, janelaMs = 15 * 60 * 1000, agora = Date.now } = {}) {
  const falhas = new Map(); // chave -> { qtd, desde }
  const vivo = (f, t) => f && t - f.desde < janelaMs;

  function podar(t) {
    for (const [k, f] of falhas) if (!vivo(f, t)) falhas.delete(k);
  }

  return {
    bloqueado(chave) {
      const t = agora();
      const f = falhas.get(chave);
      if (!vivo(f, t)) { falhas.delete(chave); return { bloqueado: false, segundos: 0 }; }
      if (f.qtd < maxFalhas) return { bloqueado: false, segundos: 0 };
      return { bloqueado: true, segundos: Math.max(1, Math.ceil((f.desde + janelaMs - t) / 1000)) };
    },
    falhou(chave) {
      const t = agora();
      if (falhas.size >= MAX_CHAVES) podar(t);
      const f = falhas.get(chave);
      if (vivo(f, t)) f.qtd += 1;
      else if (falhas.size < MAX_CHAVES) falhas.set(chave, { qtd: 1, desde: t });
    },
    limpar(chave) { falhas.delete(chave); }
  };
}

module.exports = { criarLimiteLogin, HASH_FALSO };
