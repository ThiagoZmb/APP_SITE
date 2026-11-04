// Pool falso das rotas de documentos do portal (etapa 3c). Reconhece SÓ: a consulta de posse do pedido, o cabeçalho e o corpo
// do PDF do pedido, os vínculos e o financeiro do DANFE, a consulta que traz o PDF da nota e o INSERT de auditoria.
// O filtro de empresa é decidido PELO TEXTO do SQL: só se aplica se o SQL contém "c.CODIGO = ?".
// Tirar esse filtro da consulta de produção faz o pool devolver pedidos de todas as empresas (prova de mutação).
//
// pedidos:  { NUMERO, TIPO, RAZAO_SOCIAL, CLIENTE_FINAL, DATA, DATA_PRONTO, OBS_GERAL, SUB_TOTAL, TOTAL, DESCONTO }
// clientes: { CODIGO, RAZAO_SOCIAL }
// danfe:    { chave, numero_nf, serie, modelo, cnpj_emitente, enviado_em, pdf }
// vinculos: { id, chave, pedido_numero }      fluxo: { PEDIDO, NOTA_FISCAL }
// corpo: { itens, v4, serr, comps, compSerr, furos } = linhas por tabela (todas com NUMERO e TIPO)
function criarPoolDocumentos({ pedidos = [], clientes = [], danfe = [], vinculos = [], fluxo = [], corpo = {} } = {}) {
  const chamadas = [];
  const auditoria = [];

  const doPedido = (linhas, params) => (linhas || []).filter(l => l.NUMERO === params[0] && l.TIPO === params[1]);

  async function execute(sql, params = []) {
    chamadas.push({ sql, params });
    if (/^INSERT INTO web_portal_auditoria/.test(sql)) {
      const [quando, evento, usuario_id, cliente_codigo, ip, detalhe] = params;
      auditoria.push({ quando, evento, usuario_id, cliente_codigo, ip, detalhe });
      return [{ affectedRows: 1 }, []];
    }
    // posse do pedido
    if (/FROM ped_orc p\b/.test(sql)) {
      let i = 0;
      const filtraEmpresa = /c\.CODIGO = \?/.test(sql);
      const empresa = filtraEmpresa ? params[i++] : null;
      const filtraTipo = /p\.TIPO = 'Pedido'/.test(sql);
      const filtraNumero = /p\.NUMERO = \?/.test(sql);
      const numero = filtraNumero ? params[i++] : null;
      const linhas = pedidos.filter(p => {
        const cli = clientes.find(c => c.RAZAO_SOCIAL === p.RAZAO_SOCIAL);
        if (!cli) return false;
        if (filtraEmpresa && cli.CODIGO !== empresa) return false;
        if (filtraTipo && p.TIPO !== 'Pedido') return false;
        if (filtraNumero && p.NUMERO !== numero) return false;
        return true;
      });
      return [linhas.slice(0, 1).map(p => ({ NUMERO: p.NUMERO, RAZAO_SOCIAL: p.RAZAO_SOCIAL })), []];
    }
    // cabeçalho do PDF
    if (/FROM ped_orc WHERE NUMERO = \? AND TIPO = \?/.test(sql)) {
      return [doPedido(pedidos, params).map(p => ({
        RAZAO_SOCIAL: p.RAZAO_SOCIAL, CLIENTE_FINAL: p.CLIENTE_FINAL, DATA: p.DATA, DATA_PRONTO: p.DATA_PRONTO,
        OBS_GERAL: p.OBS_GERAL, SUB_TOTAL: p.SUB_TOTAL, TOTAL: p.TOTAL, DESCONTO: p.DESCONTO
      })), []];
    }
    // corpo do PDF (cada tabela devolve cópias, como o banco)
    const copia = linhas => linhas.map(l => ({ ...l }));
    if (/FROM ped_orc_lista_itens/.test(sql)) return [copia(doPedido(corpo.itens, params)), []];
    if (/FROM ped_orc_itens_v4/.test(sql)) return [copia(doPedido(corpo.v4, params)), []];
    if (/FROM ped_orc_serralheria_complementos/.test(sql)) return [copia(doPedido(corpo.compSerr, params)), []];
    if (/FROM ped_orc_serralheria/.test(sql)) return [copia(doPedido(corpo.serr, params)), []];
    if (/FROM ped_orc_complementos/.test(sql)) return [copia(doPedido(corpo.comps, params)), []];
    if (/FROM furacao_pedidos_orcamentos/.test(sql)) return [copia(doPedido(corpo.furos, params)), []];
    if (/FROM web_item_desenhos/.test(sql)) return [(corpo.desenhos || []).filter(d => d.tipo === params[0] && d.numero === params[1]), []];

    // DANFE: vínculos manuais, CNPJ da empresa, financeiro e o PDF da nota
    if (/FROM web_danfe_vinculos v JOIN web_danfe d/.test(sql)) {
      return [vinculos.filter(v => v.pedido_numero === params[0]).map(v => danfe.find(d => d.chave === v.chave))
        .filter(Boolean).map(d => ({ chave: d.chave, numero_nf: d.numero_nf, serie: d.serie, enviado_em: d.enviado_em })), []];
    }
    if (/^SELECT cnpj_emitente, COUNT/.test(sql)) {
      const cont = {};
      for (const d of danfe) cont[d.cnpj_emitente] = (cont[d.cnpj_emitente] || 0) + 1;
      const melhor = Object.entries(cont).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      return [melhor ? [{ cnpj_emitente: melhor[0], qtd: melhor[1] }] : [], []];
    }
    if (/FROM fluxo_de_caixa WHERE TRIM\(PEDIDO\) = \?/.test(sql)) {
      return [fluxo.filter(f => String(f.PEDIDO).trim() === params[0] && f.NOTA_FISCAL).map(f => ({ NOTA_FISCAL: f.NOTA_FISCAL })), []];
    }
    if (/^SELECT chave, numero_nf, serie, enviado_em FROM web_danfe WHERE modelo = \?/.test(sql)) {
      const [modelo, cnpj, ...numeros] = params;
      return [danfe.filter(d => d.modelo === modelo && d.cnpj_emitente === cnpj && numeros.includes(d.numero_nf))
        .map(d => ({ chave: d.chave, numero_nf: d.numero_nf, serie: d.serie, enviado_em: d.enviado_em })), []];
    }
    if (/^SELECT numero_nf, pdf FROM web_danfe WHERE chave = \?/.test(sql)) {
      return [danfe.filter(d => d.chave === params[0]).map(d => ({ numero_nf: d.numero_nf, pdf: d.pdf })), []];
    }
    return [[], []];
  }
  return { execute, query: execute, chamadas, auditoria };
}

module.exports = { criarPoolDocumentos };
