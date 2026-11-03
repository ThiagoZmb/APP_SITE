const fs = require('fs');

// TLS opcional na conexão com o MySQL. Padrão DESLIGADO (undefined = mysql2 não usa TLS):
// só liga com DB_SSL=1 exatamente. Ligado, SEMPRE confere o certificado do servidor
// (rejectUnauthorized nunca é false aqui). DB_SSL_CA (caminho de um .pem) é opcional e só vale com DB_SSL=1.
function opcoesSsl(env = process.env, lerArquivo = fs.readFileSync) {
  if (env.DB_SSL !== '1') return undefined;
  const opcoes = { rejectUnauthorized: true };
  const caminho = env.DB_SSL_CA;
  if (caminho) {
    let conteudo;
    try {
      conteudo = lerArquivo(caminho, 'utf8');
    } catch (e) {
      conteudo = '';
    }
    // mensagem sem o caminho nem o erro original
    if (typeof conteudo !== 'string' || !conteudo.trim()) {
      throw new Error('Não consegui ler o certificado do banco (DB_SSL_CA).');
    }
    opcoes.ca = conteudo;
  }
  return opcoes;
}

module.exports = { opcoesSsl };
