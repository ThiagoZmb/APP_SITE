// Limite GLOBAL de contas de senha (bcrypt) em andamento ao mesmo tempo.
// O bcrypt gasta CPU em rota pública (login): sem limite, muitos IPs, cada um dentro do seu limite
// de falhas, ocupariam a única instância e deixariam o sistema todo lento. Aqui no máximo `maxEmAndamento`
// rodam juntos; os demais esperam numa fila curta; fila cheia = 503 na hora (o resto do sistema segue respondendo).
// Contador só em memória (uma instância do Render).
const bcrypt = require('bcryptjs');
const { ErroUsuario } = require('../rotas/transacao');

class ErroOcupado extends ErroUsuario {
  constructor() { super(503, 'Servidor ocupado. Tente novamente em instantes.'); this.codigo = 'bcrypt_ocupado'; }
}

function criarLimiteBcrypt({ maxEmAndamento = 2, maxFila = 20 } = {}) {
  let ativos = 0;
  const fila = [];

  // a vaga passa direto para o próximo da fila (ativos continua contando)
  function liberar() {
    const proximo = fila.shift();
    if (proximo) proximo();
    else ativos--;
  }

  async function executar(trabalho) {
    if (ativos >= maxEmAndamento) {
      if (fila.length >= maxFila) throw new ErroOcupado();
      await new Promise(ok => fila.push(ok));
    } else {
      ativos++;
    }
    try { return await trabalho(); } finally { liberar(); }
  }

  return { executar, estado: () => ({ ativos, fila: fila.length }) };
}

const limite = criarLimiteBcrypt();
const bcryptLimitado = {
  compare: (senha, hash) => limite.executar(() => bcrypt.compare(senha, hash)),
  hash: (senha, custo) => limite.executar(() => bcrypt.hash(senha, custo))
};

// resposta padrão quando o limitador recusa (nada é gravado nem contado como falha de login)
function responderOcupado(res, formato = 'error') {
  res.set('Retry-After', '5');
  const msg = 'Servidor ocupado. Tente novamente em instantes.';
  return res.status(503).json(formato === 'login' ? { success: false, message: msg } : { error: msg });
}

module.exports = { criarLimiteBcrypt, ErroOcupado, bcryptLimitado, responderOcupado };
