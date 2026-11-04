// Marca como 'Atrasado' os recebimentos vencidos do fluxo_de_caixa (tabela do VB): ENTRADA (cliente preenchido e
// fornecedor vazio, o mesmo critério de rotas/gestao.js) com SITUACAO 'A Receber' e DATA anterior a hoje (Brasília).
// Saídas, A Pagar, Recebido, Pago, Protestado e demais situações nunca são tocados. A comparação da situação é a do
// MySQL (collation ci: sem diferenciar caixa nem acento). Idempotente: depois de marcar, nada mais casa com o filtro.
const { emTransacao, hojeLocal } = require('./transacao');

const ACAO = 'recebimentos_atrasados_marcados';
const INTERVALO_MS = 60 * 60 * 1000;

const SQL_MARCAR = `UPDATE fluxo_de_caixa SET SITUACAO = 'Atrasado'
  WHERE SITUACAO = 'A Receber' AND DATA < ?
    AND COALESCE(RAZAO_SOCIAL, '') <> '' AND COALESCE(RAZAO_FABRICANTE, '') = ''`;

// res de mentira: emTransacao só o usa para responder erro HTTP; aqui não há resposta.
const SEM_RESPOSTA = { headersSent: true, status() { return this; }, json() {} };

// Um único UPDATE em transação (sem laço por linha); auditoria só com a contagem, e só quando > 0.
// Devolve { marcados } ou null se falhou (o erro vai ao log pelo emTransacao).
async function marcarRecebimentosAtrasados(pool, { hoje = hojeLocal() } = {}) {
  const r = await emTransacao(pool, SEM_RESPOSTA, 'marcar recebimentos atrasados', async conn => {
    const [r] = await conn.execute(SQL_MARCAR, [hoje]);
    const marcados = Number(r?.affectedRows) || 0;
    if (marcados > 0) {
      await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
        ['(sistema)', ACAO, '', JSON.stringify({ qtd: marcados })]);
    }
    return { marcados };
  });
  return r || null;
}

// Disparo com no máximo 1 execução por hora por processo (memória). Nunca lança nem atrasa quem chama:
// quem usa não deve dar await. Falha libera nova tentativa na próxima chamada.
function criarDisparador(pool, { agora = Date.now, hoje } = {}) {
  let ultimo = null, rodando = false;
  return async function disparar() {
    try {
      const t = agora();
      if (rodando || (ultimo !== null && t - ultimo < INTERVALO_MS)) return null;
      rodando = true;
      try {
        const r = await marcarRecebimentosAtrasados(pool, hoje ? { hoje: hoje() } : undefined);
        if (r) ultimo = t;
        return r;
      } finally { rodando = false; }
    } catch (err) {
      console.error('Erro ao marcar recebimentos atrasados:', err?.code || 'sem código');
      return null;
    }
  };
}

module.exports = { marcarRecebimentosAtrasados, criarDisparador, SQL_MARCAR, ACAO, INTERVALO_MS };
