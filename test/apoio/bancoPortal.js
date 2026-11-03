// Banco falso do portal do cliente (tabelas web_portal_* e cadastro_clientes em memória).
// Reconhece só o SQL de portal/sessoes.js, portal/acesso.js e portal/auditoria.js; SQL sem regra
// devolve [] (como poolFalso.js). Os parâmetros de data chegam como Date (como em seguranca/sessoes.js).
// ATENÇÃO: as regras reconhecem o SQL só pelo prefixo e aplicam a própria lógica (revogada, expiração, inatividade);
// por isso quem testa o SQL de verdade confere texto e parâmetros em `pool.chamadas` (veja test/portal_sessoes.test.js).
// A comparação de nomes/maiúsculas do MySQL (collation) NÃO é simulada: strings comparam por igualdade exata.
// A Tarefa 6 estende este arquivo: acrescente regras em `regras` e tabelas em `dados`, sem mudar as existentes.
const { criarPoolFalso } = require('./poolFalso');

function criarBancoPortal(inicial = {}) {
  const dados = {
    sessoes: [],       // { id, usuario_id, criado_em, expira_em, ultimo_uso_em, ip, revogada }
    usuarios: [],      // { id, email, cliente_codigo, papel, situacao }
    empresas: [],      // { cliente_codigo, situacao }
    permissoes: [],    // { usuario_id, permissao }
    clientes: [],      // { CODIGO, RAZAO_SOCIAL }
    auditoria: [],     // { quando, evento, usuario_id, cliente_codigo, ip, detalhe }
    ...inicial
  };
  const t = d => new Date(d).getTime();

  const regras = [
    [/^INSERT INTO web_portal_sessoes/, (sql, [id, usuario_id, criado_em, expira_em, ultimo_uso_em, ip]) => {
      dados.sessoes.push({ id, usuario_id, criado_em, expira_em, ultimo_uso_em, ip, revogada: 0 });
      return { affectedRows: 1 };
    }],
    // valida: id, agora (expira_em >), limite de inatividade (ultimo_uso_em >=)
    [/^SELECT usuario_id FROM web_portal_sessoes/, (sql, [id, agora, limite]) =>
      dados.sessoes.filter(s => s.id === id && !s.revogada && t(s.expira_em) > t(agora) && t(s.ultimo_uso_em) >= t(limite))
        .map(s => ({ usuario_id: s.usuario_id }))],
    // renovação: novo ultimo_uso_em, id, só se o gravado for anterior ao limite de 1 minuto
    [/^UPDATE web_portal_sessoes SET ultimo_uso_em/, (sql, [novo, id, limite]) => {
      const s = dados.sessoes.find(x => x.id === id && t(x.ultimo_uso_em) < t(limite));
      if (s) s.ultimo_uso_em = novo;
      return { affectedRows: s ? 1 : 0 };
    }],
    [/^UPDATE web_portal_sessoes SET revogada = 1 WHERE id = \?/, (sql, [id]) => {
      const s = dados.sessoes.find(x => x.id === id);
      if (s) s.revogada = 1;
      return { affectedRows: s ? 1 : 0 };
    }],
    [/^UPDATE web_portal_sessoes SET revogada = 1 WHERE usuario_id = \?/, (sql, [uid]) => {
      dados.sessoes.filter(s => s.usuario_id === uid).forEach(s => { s.revogada = 1; });
      return { affectedRows: 1 };
    }],
    [/^UPDATE web_portal_sessoes s INNER JOIN web_portal_usuarios u/, (sql, [codigo]) => {
      const ids = new Set(dados.usuarios.filter(u => u.cliente_codigo === codigo).map(u => u.id));
      dados.sessoes.filter(s => ids.has(s.usuario_id)).forEach(s => { s.revogada = 1; });
      return { affectedRows: 1 };
    }],
    [/FROM web_portal_usuarios u LEFT JOIN web_portal_empresas e/, (sql, [id]) =>
      dados.usuarios.filter(u => u.id === id).map(u => ({
        id: u.id, email: u.email, cliente_codigo: u.cliente_codigo, papel: u.papel, situacao: u.situacao,
        empresa_situacao: (dados.empresas.find(e => e.cliente_codigo === u.cliente_codigo) || {}).situacao ?? null
      }))],
    [/^SELECT permissao FROM web_portal_permissoes/, (sql, [id]) =>
      dados.permissoes.filter(p => p.usuario_id === id).map(p => ({ permissao: p.permissao }))],
    [/^SELECT RAZAO_SOCIAL FROM cadastro_clientes WHERE CODIGO/, (sql, [codigo]) =>
      dados.clientes.filter(c => c.CODIGO === codigo).map(c => ({ RAZAO_SOCIAL: c.RAZAO_SOCIAL }))],
    [/^SELECT COUNT\(\*\) AS n FROM cadastro_clientes WHERE RAZAO_SOCIAL/, (sql, [nome]) =>
      [{ n: dados.clientes.filter(c => c.RAZAO_SOCIAL === nome).length }]],
    [/^SELECT cliente_codigo FROM web_portal_empresas WHERE cliente_codigo/, (sql, [codigo]) =>
      dados.empresas.filter(e => e.cliente_codigo === codigo).map(e => ({ cliente_codigo: e.cliente_codigo }))],
    [/^INSERT INTO web_portal_auditoria/, (sql, [quando, evento, usuario_id, cliente_codigo, ip, detalhe]) => {
      dados.auditoria.push({ quando, evento, usuario_id, cliente_codigo, ip, detalhe });
      return { affectedRows: 1 };
    }]
  ];

  const pool = criarPoolFalso(regras);
  return { pool, dados, regras };
}

module.exports = { criarBancoPortal };
