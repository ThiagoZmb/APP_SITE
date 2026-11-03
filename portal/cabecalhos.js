// Cabeçalhos de segurança das páginas e da API do portal (só caminhos /portal e /portal/...):
// sem cache, sem referrer, CSP estrita (nada de script/estilo inline, nenhuma origem externa).
const CSP_PORTAL = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'";

function cabecalhosPortal(req, res, next) {
  if (req.path === '/portal' || req.path.startsWith('/portal/')) {
    res.setHeader('Content-Security-Policy', CSP_PORTAL);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  next();
}

module.exports = { cabecalhosPortal, CSP_PORTAL };
