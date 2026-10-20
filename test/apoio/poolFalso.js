// Pool MySQL falso para os testes: cada regra é [RegExp, linhas | (sql, params) => linhas].
// SQL sem regra devolve []. Toda chamada fica em `chamadas` (BEGIN/COMMIT/ROLLBACK inclusive).
function criarPoolFalso(regras = []) {
  const chamadas = [];
  async function execute(sql, params = []) {
    chamadas.push({ sql, params });
    for (const [re, resp] of regras) {
      if (re.test(sql)) {
        const linhas = typeof resp === 'function' ? await resp(sql, params) : resp;
        return [linhas, []];
      }
    }
    return [[], []];
  }
  const marcar = sql => async () => { chamadas.push({ sql, params: [] }); };
  async function getConnection() {
    return {
      execute, query: execute,
      beginTransaction: marcar('BEGIN'), commit: marcar('COMMIT'), rollback: marcar('ROLLBACK'),
      release() {}
    };
  }
  return { execute, query: execute, getConnection, chamadas, regras };
}

module.exports = { criarPoolFalso };
