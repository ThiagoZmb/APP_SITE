// Opções de CORS do servidor (função para o middleware `cors`). As origens de sempre (GitHub Pages, localhost)
// valem em qualquer caminho FORA de /portal/; em /portal/... vale SÓ a origem do próprio portal (config.baseUrl), com o portal ativo.
// O roteamento do Express não diferencia maiúsculas, então o caminho também não.
const origemLocal = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const CAMINHO_PORTAL = /^\/portal\//i;

function criarOpcoesCors(config) {
  return (req, callback) => {
    const origin = req.headers.origin;
    // em /portal/ só vale a origem do próprio portal (GitHub Pages e localhost não): outra página não dispara login nem lê a resposta
    const emPortal = CAMINHO_PORTAL.test(req.path);
    const permitida = emPortal
      ? config.ativo && origin === config.baseUrl
      : origin === 'https://thiagozmb.github.io' || origemLocal.test(origin || '');
    if (!origin || permitida) {
      return callback(null, {
        origin: true,
        exposedHeaders: ['Content-Disposition', 'X-Pdf-Nome', 'X-Pdf-Pasta'] // a tela lê o nome/pasta do PDF para gravar o arquivo
      });
    }
    return callback(new Error('Origem não permitida pelo CORS'));
  };
}

module.exports = { criarOpcoesCors };
