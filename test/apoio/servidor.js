// Sobe um app Express numa porta livre para testes HTTP com fetch.
function subir(app) {
  return new Promise(resolve => {
    const srv = app.listen(0, () => {
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        fechar: () => new Promise(ok => srv.close(() => ok()))
      });
    });
  });
}

module.exports = { subir };
