// Limite de falhas de login POR CONTA (além do limite por IP do index.js): o atacante
// que troca de IP não consegue tentar senhas sem fim em um mesmo usuário.
// Contador só em memória: vale para uma instância (o Render roda uma). Reiniciar zera.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Hash de um valor aleatório gerado na subida: usuário inexistente gasta o mesmo tempo
// de bcrypt que usuário existente com senha errada (não revela quais contas existem).
// Custo do bcrypt: o mesmo dos hashes reais (senhas gravadas com 12), senão o tempo revela quem existe.
const CUSTO_BCRYPT = 12;
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), CUSTO_BCRYPT);

const MAX_INEXISTENTES = 10000; // teto só dos nomes que não existem; o mais antigo sai quando enche

// Chaves: 'c:CODIGO' = conta real (sem teto nem expulsão: limitada pelo número de usuários);
// 'n:nome' = nome inexistente (com teto; nomes falsos nunca expulsam a contagem de conta real).
function criarLimiteLogin({ maxFalhas = 5, janelaMs = 15 * 60 * 1000, agora = Date.now, maxInexistentes = MAX_INEXISTENTES } = {}) {
  const contas = new Map();       // chave -> { qtd, desde }
  const inexistentes = new Map();
  const mapaDe = chave => (String(chave).startsWith('n:') ? inexistentes : contas);
  const vivo = (f, t) => f && t - f.desde < janelaMs;

  return {
    bloqueado(chave) {
      const t = agora();
      const m = mapaDe(chave);
      const f = m.get(chave);
      if (!vivo(f, t)) { m.delete(chave); return { bloqueado: false, segundos: 0 }; }
      if (f.qtd < maxFalhas) return { bloqueado: false, segundos: 0 };
      return { bloqueado: true, segundos: Math.max(1, Math.ceil((f.desde + janelaMs - t) / 1000)) };
    },
    falhou(chave) {
      const t = agora();
      const m = mapaDe(chave);
      const f = m.get(chave);
      if (vivo(f, t)) { f.qtd += 1; return; }
      m.delete(chave);
      if (m === inexistentes) {
        for (const [k, v] of m) if (!vivo(v, t)) m.delete(k);
        while (m.size >= maxInexistentes) m.delete(m.keys().next().value); // descarta o mais antigo
      }
      m.set(chave, { qtd: 1, desde: t });
    },
    limpar(chave) { mapaDe(chave).delete(chave); }
  };
}

module.exports = { criarLimiteLogin, HASH_FALSO, CUSTO_BCRYPT };
