// Tratador global de erros do Express (4 argumentos): a resposta nunca leva
// stack, mensagem de banco nem texto interno; só o código do erro vai ao log do servidor.
function tratadorDeErros(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requisição inválida.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição grande demais.' });
  console.error('Erro não tratado:', req.method, req.path, (err && err.code) || 'sem código');
  return res.status(500).json({ error: 'Erro de servidor' });
}

module.exports = { tratadorDeErros };
