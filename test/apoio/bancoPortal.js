// Banco falso do portal do cliente (tabelas web_portal_* e cadastro_clientes em memória).
// Reconhece só o SQL de portal/sessoes.js, portal/acesso.js e portal/auditoria.js; SQL sem regra
// devolve [] (como poolFalso.js). Os parâmetros de data chegam como Date (como em seguranca/sessoes.js).
// ATENÇÃO: as regras reconhecem o SQL só pelo prefixo e aplicam a própria lógica (revogada, expiração, inatividade);
// por isso quem testa o SQL de verdade confere texto e parâmetros em `pool.chamadas` (veja test/portal_sessoes.test.js).
// A comparação de nomes/maiúsculas do MySQL (collation) NÃO é simulada: strings comparam por igualdade exata.
// A Tarefa 6 acrescentou as regras do bloco "rotas da equipe" (convites, empresas, web_auditoria); as da Tarefa 5 não mudaram.
const { criarPoolFalso } = require('./poolFalso');

function criarBancoPortal(inicial = {}) {
  const dados = {
    sessoes: [],       // { id, usuario_id, criado_em, expira_em, ultimo_uso_em, ip, revogada }
    usuarios: [],      // { id, email, cliente_codigo, papel, situacao }
    empresas: [],      // { cliente_codigo, situacao }
    permissoes: [],    // { usuario_id, permissao }
    clientes: [],      // { CODIGO, RAZAO_SOCIAL }
    auditoria: [],     // { quando, evento, usuario_id, cliente_codigo, ip, detalhe }
    convites: [],      // { id, token_hash, usuario_id, expira_em, usado_em, criado_por, criado_em }
    recuperacao: [],   // { usuario_id, codigo_hash }
    auditoriaEquipe: [], // web_auditoria: { quem, acao, alvo, detalhe }
    ...inicial
  };
  const t = d => new Date(d).getTime();
  const sit = codigo => (dados.empresas.find(e => e.cliente_codigo === codigo) || {}).situacao;
  const contar = nome => dados.clientes.filter(c => c.RAZAO_SOCIAL === nome).length;
  let proximoUsuario = 100;
  let proximoConvite = 1;

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
    // ---- Tarefa 6: rotas da equipe (/admin/portal/*) ----
    // lista de clientes: params [like] + [codigo] quando há busca (o LIKE é simulado como "contém", sem collation)
    [/^SELECT c\.CODIGO, c\.RAZAO_SOCIAL, c\.CNPJ_CPF/, (sql, params) => {
      let lista = dados.clientes;
      if (params.length) {
        const termo = params[0].replace(/^%|%$/g, '').replace(/\\([\\%_])/g, '$1').toLowerCase();
        lista = lista.filter(c => String(c.RAZAO_SOCIAL).toLowerCase().includes(termo) || c.CODIGO === params[1]);
      }
      const m = /LIMIT (\d+)/.exec(sql);
      return [...lista].sort((a, b) => String(a.RAZAO_SOCIAL).localeCompare(String(b.RAZAO_SOCIAL))).slice(0, Number(m[1])).map(c => ({
        CODIGO: c.CODIGO, RAZAO_SOCIAL: c.RAZAO_SOCIAL, CNPJ_CPF: c.CNPJ_CPF ?? '', situacao_portal: sit(c.CODIGO) ?? null, qtd_nome: contar(c.RAZAO_SOCIAL)
      }));
    }],
    [/^SELECT e\.cliente_codigo, c\.RAZAO_SOCIAL, e\.situacao/, () => dados.empresas.map(e => ({
      cliente_codigo: e.cliente_codigo, RAZAO_SOCIAL: (dados.clientes.find(c => c.CODIGO === e.cliente_codigo) || {}).RAZAO_SOCIAL ?? null,
      situacao: e.situacao, qtd_usuarios: dados.usuarios.filter(u => u.cliente_codigo === e.cliente_codigo).length
    }))],
    [/^SELECT situacao FROM web_portal_empresas WHERE cliente_codigo = \?/, (sql, [codigo]) => sit(codigo) ? [{ situacao: sit(codigo) }] : []],
    [/^SELECT id, email, papel, situacao FROM web_portal_usuarios WHERE cliente_codigo = \?/, (sql, [codigo]) =>
      dados.usuarios.filter(u => u.cliente_codigo === codigo).map(u => ({ id: u.id, email: u.email, papel: u.papel, situacao: u.situacao }))],
    [/^INSERT INTO web_portal_empresas/, (sql, [codigo, quem, quando]) => {
      dados.empresas.push({ cliente_codigo: codigo, situacao: 'ativa', liberado_por: quem, liberado_em: quando });
      return { affectedRows: 1 };
    }],
    [/^UPDATE web_portal_empresas SET situacao = 'suspensa'/, (sql, [quando, codigo]) => {
      const e = dados.empresas.find(x => x.cliente_codigo === codigo);
      if (e) { e.situacao = 'suspensa'; e.suspenso_em = quando; }
      return { affectedRows: e ? 1 : 0 };
    }],
    [/^UPDATE web_portal_empresas SET situacao = 'ativa'/, (sql, [codigo]) => {
      const e = dados.empresas.find(x => x.cliente_codigo === codigo);
      if (e) { e.situacao = 'ativa'; e.suspenso_em = null; }
      return { affectedRows: e ? 1 : 0 };
    }],
    [/^SELECT id FROM web_portal_usuarios WHERE email = \?/, (sql, [email]) => dados.usuarios.filter(u => u.email === email).map(u => ({ id: u.id }))],
    [/^SELECT id, email, cliente_codigo, situacao FROM web_portal_usuarios WHERE id = \?/, (sql, [id]) =>
      dados.usuarios.filter(u => u.id === id).map(u => ({ id: u.id, email: u.email, cliente_codigo: u.cliente_codigo, situacao: u.situacao }))],
    [/^INSERT INTO web_portal_usuarios/, (sql, [email, codigo, quando, quem]) => {
      const id = proximoUsuario++;
      dados.usuarios.push({ id, email, cliente_codigo: codigo, papel: 'admin_geral', situacao: 'convidado', senha_hash: null,
        totp_segredo_cifrado: null, totp_ativo: 0, totp_ultimo_passo: 0, criado_em: quando, criado_por: quem });
      return { insertId: id, affectedRows: 1 };
    }],
    [/^UPDATE web_portal_usuarios SET totp_segredo_cifrado = NULL/, (sql, [id]) => {
      const u = dados.usuarios.find(x => x.id === id);
      if (u) Object.assign(u, { totp_segredo_cifrado: null, totp_ativo: 0, totp_ultimo_passo: 0, senha_hash: null, situacao: 'convidado' });
      return { affectedRows: u ? 1 : 0 };
    }],
    [/^DELETE FROM web_portal_recuperacao WHERE usuario_id = \?/, (sql, [id]) => {
      dados.recuperacao = dados.recuperacao.filter(r => r.usuario_id !== id);
      return { affectedRows: 1 };
    }],
    [/^INSERT INTO web_portal_convites/, (sql, [token_hash, usuario_id, expira_em, criado_por, criado_em]) => {
      const id = proximoConvite++;
      dados.convites.push({ id, token_hash, usuario_id, expira_em, usado_em: null, criado_por, criado_em });
      return { insertId: id, affectedRows: 1 };
    }],
    [/^UPDATE web_portal_convites SET usado_em = \? WHERE usuario_id = \? AND usado_em IS NULL/, (sql, [quando, uid]) => {
      dados.convites.filter(c => c.usuario_id === uid && c.usado_em == null).forEach(c => { c.usado_em = quando; });
      return { affectedRows: 1 };
    }],
    [/^INSERT INTO web_auditoria/, (sql, [quem, acao, alvo, detalhe]) => {
      dados.auditoriaEquipe.push({ quem, acao, alvo, detalhe });
      return { affectedRows: 1 };
    }],
    [/^INSERT INTO web_portal_auditoria/, (sql, [quando, evento, usuario_id, cliente_codigo, ip, detalhe]) => {
      dados.auditoria.push({ quando, evento, usuario_id, cliente_codigo, ip, detalhe });
      return { affectedRows: 1 };
    }]
  ];

  const pool = criarPoolFalso(regras);
  return { pool, dados, regras };
}

module.exports = { criarBancoPortal };
