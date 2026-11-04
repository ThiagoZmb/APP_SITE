// Pool falso das rotas de financeiro do portal (etapa 3b). Reconhece SÓ as duas consultas de fluxo_de_caixa
// (títulos e resumo) e o INSERT de auditoria (web_portal_auditoria).
// O filtro de empresa é decidido PELO TEXTO do SQL: só se aplica se o SQL contém "c.CODIGO = ?".
// Tirar esse filtro da consulta de produção faz o pool devolver lançamentos de todas as empresas.
//
// lancamentos: { ID, RAZAO_SOCIAL, RAZAO_FABRICANTE, DATA ('YYYY-MM-DD'|null), PEDIDO, NOTA_FISCAL, SITUACAO, VALOR (number|null), OBSERVACAO_GERAL }
// clientes: { CODIGO, RAZAO_SOCIAL }
// Como o banco real, VALOR sai como string com 2 casas; e só as colunas selecionadas saem (o resto nunca sai do "banco").
const SITUACOES_ABERTAS = ['a receber', 'atrasado', 'protestado'];
// Como o MySQL: comparação sem distinção de caixa e sem espaços nas pontas.
const norm = s => String(s ?? '').trim().toLowerCase();

function criarPoolFinanceiro({ lancamentos = [], clientes = [] } = {}) {
  const chamadas = [];
  const auditoria = [];

  function filtrar(sql, params) {
    let i = 0;
    const comparaHoje = /f\.DATA < \?/.test(sql);
    const hoje = comparaHoje ? params[i++] : null;
    const filtraEmpresa = /c\.CODIGO = \?/.test(sql);
    const empresa = filtraEmpresa ? params[i++] : null;
    const filtraCorte = /f\.DATA >= \?/.test(sql);
    const corte = filtraCorte ? params[i++] : null;
    const soFornecedorVazio = /COALESCE\(f\.RAZAO_FABRICANTE, ''\) = ''/.test(sql);
    const naoNulos = /f\.DATA IS NOT NULL/.test(sql) && /f\.VALOR IS NOT NULL/.test(sql);
    const abertos = /f\.SITUACAO IN \('A Receber','Atrasado','Protestado'\)/.test(sql);
    const recebido = /f\.SITUACAO = 'Recebido'/.test(sql);

    const linhas = lancamentos.filter(l => {
      const cli = clientes.find(c => c.RAZAO_SOCIAL === l.RAZAO_SOCIAL); // JOIN por razão social
      if (!cli) return false;
      if (filtraEmpresa && cli.CODIGO !== empresa) return false;
      if (soFornecedorVazio && (l.RAZAO_FABRICANTE ?? '') !== '') return false;
      if (naoNulos && (l.DATA == null || l.VALOR == null)) return false;
      if (abertos && !SITUACOES_ABERTAS.includes(norm(l.SITUACAO))) return false;
      if (recebido && norm(l.SITUACAO) !== 'recebido') return false;
      if (filtraCorte && !(l.DATA >= corte)) return false;
      return true;
    });
    return { linhas, hoje };
  }

  async function execute(sql, params = []) {
    chamadas.push({ sql, params });
    if (/^INSERT INTO web_portal_auditoria/.test(sql)) {
      const [quando, evento, usuario_id, cliente_codigo, ip, detalhe] = params;
      auditoria.push({ quando, evento, usuario_id, cliente_codigo, ip, detalhe });
      return [{ affectedRows: 1 }, []];
    }
    if (!/FROM fluxo_de_caixa f\b/.test(sql)) return [[], []];
    const { linhas, hoje } = filtrar(sql, params);

    if (/SUM\(/.test(sql)) {
      let aReceber = 0; let emAtraso = 0;
      for (const l of linhas) {
        aReceber += l.VALOR;
        if (norm(l.SITUACAO) === 'atrasado' || norm(l.SITUACAO) === 'protestado' || l.DATA < hoje) emAtraso += l.VALOR;
      }
      return [[{ A_RECEBER: aReceber.toFixed(2), EM_ATRASO: emAtraso.toFixed(2) }], []];
    }

    let ordenadas = [...linhas];
    if (/ORDER BY f\.DATA ASC, f\.ID ASC/.test(sql)) ordenadas.sort((a, b) => (a.DATA < b.DATA ? -1 : a.DATA > b.DATA ? 1 : a.ID - b.ID));
    else if (/ORDER BY f\.DATA DESC, f\.ID DESC/.test(sql)) ordenadas.sort((a, b) => (a.DATA < b.DATA ? 1 : a.DATA > b.DATA ? -1 : b.ID - a.ID));
    const lim = /LIMIT (\d+)/.exec(sql);
    const off = /OFFSET (\d+)/.exec(sql);
    const de = off ? Number(off[1]) : 0;
    if (lim) ordenadas = ordenadas.slice(de, de + Number(lim[1]));

    return [ordenadas.map(l => ({
      DATA: l.DATA, PEDIDO: l.PEDIDO ?? null, NOTA_FISCAL: l.NOTA_FISCAL ?? null, SITUACAO: l.SITUACAO,
      VALOR: l.VALOR == null ? null : Number(l.VALOR).toFixed(2)
    })), []];
  }
  return { execute, query: execute, chamadas, auditoria };
}

module.exports = { criarPoolFinanceiro };
