// ==========================================================================
// Instalação na subida do backend: cria as tabelas web_* (nunca mexe nas
// tabelas do VB) e, uma única vez, dá a cada usuário existente um perfil.
// ==========================================================================
const { PERFIS_INICIAIS } = require('./permissoes');

const OPCOES = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const TABELAS = [
  `CREATE TABLE IF NOT EXISTS \`web_perfis\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     nome VARCHAR(60) NOT NULL UNIQUE,
     descricao VARCHAR(255) NULL,
     ativo TINYINT NOT NULL DEFAULT 1,
     criado_em DATETIME NULL
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_perfil_permissoes\` (
     perfil_id INT NOT NULL,
     permissao VARCHAR(60) NOT NULL,
     PRIMARY KEY (perfil_id, permissao)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_usuario_acesso\` (
     usuario_codigo INT NOT NULL PRIMARY KEY,
     perfil_id INT NULL,
     estados VARCHAR(120) NULL,
     ativo TINYINT NOT NULL DEFAULT 1,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(100) NULL
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_usuario_excecoes\` (
     usuario_codigo INT NOT NULL,
     permissao VARCHAR(60) NOT NULL,
     tipo ENUM('liberar','bloquear') NOT NULL,
     PRIMARY KEY (usuario_codigo, permissao)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_auditoria\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     quando DATETIME NOT NULL,
     quem VARCHAR(100) NOT NULL,
     acao VARCHAR(60) NOT NULL,
     alvo VARCHAR(100) NULL,
     detalhe TEXT NULL,
     KEY idx_acao (acao)
   ) ${OPCOES}`,
  // ----- movimentação de estoque (as tabelas do VB continuam as mesmas) -----
  `CREATE TABLE IF NOT EXISTS \`web_estoque_ligacoes\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     fornecedor VARCHAR(190) NOT NULL,
     cod_fabricante VARCHAR(60) NOT NULL,
     nome_fabricante VARCHAR(190) NULL,
     produto_codigo INT NOT NULL,
     fator DECIMAL(12,4) NOT NULL DEFAULT 1,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(190) NULL,
     UNIQUE KEY uq_ligacao (fornecedor, cod_fabricante)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_estoque_lancamentos\` (
     chave VARCHAR(64) NOT NULL PRIMARY KEY,
     tipo VARCHAR(20) NOT NULL,
     quando DATETIME NOT NULL,
     quem VARCHAR(190) NOT NULL,
     referencia VARCHAR(190) NULL
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_estoque_estornos\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     quando DATETIME NOT NULL,
     quem VARCHAR(190) NOT NULL,
     tipo VARCHAR(20) NOT NULL,
     referencia VARCHAR(255) NOT NULL,
     motivo VARCHAR(500) NOT NULL,
     dados LONGTEXT NULL,
     KEY idx_quando (quando)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_estoque_ajustes\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     quando DATETIME NOT NULL,
     quem VARCHAR(190) NOT NULL,
     produto_codigo INT NOT NULL,
     nome_produto VARCHAR(190) NOT NULL,
     qtd_antes DOUBLE NOT NULL,
     qtd_depois DOUBLE NOT NULL,
     motivo VARCHAR(500) NOT NULL,
     KEY idx_quando (quando)
   ) ${OPCOES}`
];

async function instalarTabelas(pool) {
  for (const sql of TABELAS) await pool.execute(sql);
}

// usuário designado vira Administrador; cargo com "representante" vira Representante (RJ); demais, Interno completo
const mesmoNome = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

function perfilInicial(u, adminInicial) {
  if (String(adminInicial || '').trim() && mesmoNome(u.NOME, adminInicial)) return { perfil: 'Administrador', estados: null };
  if (/representante/i.test(String(u.CARGO || ''))) return { perfil: 'Representante', estados: 'RJ' };
  return { perfil: 'Interno completo', estados: null };
}

async function migrarAcessos(pool, { adminInicial = '' } = {}) {
  const [feita] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'migracao_inicial' LIMIT 1");
  if (feita.length) return { jaFeita: true, criados: 0 };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM web_perfis');
    if (Number(n) === 0) {
      for (const p of PERFIS_INICIAIS) {
        const [r] = await conn.execute(
          'INSERT INTO web_perfis (nome, descricao, ativo, criado_em) VALUES (?, ?, 1, NOW())', [p.nome, p.descricao]);
        for (const permissao of p.permissoes) {
          await conn.execute('INSERT INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [r.insertId, permissao]);
        }
      }
    }
    const [perfis] = await conn.execute('SELECT id, nome FROM web_perfis');
    const idDoPerfil = Object.fromEntries(perfis.map(p => [p.nome, p.id]));

    const [usuarios] = await conn.execute(
      `SELECT u.CODIGO, u.NOME, u.CARGO FROM cliente_usuarios u
       LEFT JOIN web_usuario_acesso a ON a.usuario_codigo = u.CODIGO
       WHERE a.usuario_codigo IS NULL ORDER BY u.CODIGO`);
    const contagem = {};
    for (const u of usuarios) {
      const { perfil, estados } = perfilInicial(u, adminInicial);
      await conn.execute(
        `INSERT INTO web_usuario_acesso (usuario_codigo, perfil_id, estados, ativo, atualizado_em, atualizado_por)
         VALUES (?, ?, ?, 1, NOW(), 'sistema')`, [u.CODIGO, idDoPerfil[perfil] ?? null, estados]);
      contagem[perfil] = (contagem[perfil] || 0) + 1;
    }
    await conn.execute(
      'INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'migracao_inicial', '', JSON.stringify({ usuarios: usuarios.length, porPerfil: contagem, adminInicial })]);
    await conn.commit();
    return { jaFeita: false, criados: usuarios.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// A cada subida: se não existir nenhum administrador ativo, o usuário de WEB_ADMIN_INICIAL vira
// Administrador (e fica registrado na auditoria). Evita que um deploy sem a variável, ou um erro de
// digitação no nome, deixe o sistema sem ninguém para gerenciá-lo.
async function garantirAdministrador(pool, { adminInicial = '' } = {}) {
  const { adminsAtivos } = require('../rotas/admin');
  if ((await adminsAtivos(pool)).size > 0) return { concedido: false, usuario: null };
  const nome = String(adminInicial || '').trim();
  const [usuarios] = nome
    ? await pool.execute('SELECT CODIGO, NOME FROM cliente_usuarios WHERE UPPER(TRIM(NOME)) = UPPER(?) LIMIT 1', [nome])
    : [[]];
  const [perfis] = await pool.execute("SELECT id FROM web_perfis WHERE nome = 'Administrador' LIMIT 1");
  if (!usuarios.length || !perfis.length) {
    console.error('[permissões] ATENÇÃO: NENHUM administrador ativo. Defina WEB_ADMIN_INICIAL no Render com o nome de login '
      + 'exato de um usuário e reinicie o serviço.' + (nome ? ` (o valor atual "${nome}" não corresponde a nenhum usuário)` : ''));
    return { concedido: false, usuario: null };
  }
  const u = usuarios[0];
  await pool.execute(
    `INSERT INTO web_usuario_acesso (usuario_codigo, perfil_id, estados, ativo, atualizado_em, atualizado_por)
     VALUES (?, ?, NULL, 1, NOW(), 'sistema')
     ON DUPLICATE KEY UPDATE perfil_id = VALUES(perfil_id), ativo = 1, atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)`,
    [u.CODIGO, perfis[0].id]);
  await pool.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
    ['sistema', 'admin_restaurado', u.NOME, JSON.stringify({ motivo: 'nenhum administrador ativo na subida' })]);
  console.log(`[permissões] nenhum administrador ativo: ${u.NOME} recebeu o perfil Administrador.`);
  return { concedido: true, usuario: u.NOME };
}

// Passo único: as permissões novas do estoque entram nos perfis que já tinham "tudo".
// O Estoquista não recebe (o administrador libera em Usuários, se quiser).
const PERMISSOES_ESTOQUE = ['estoque.desfazer', 'estoque.ajustar'];
async function acrescentarPermissoesEstoque(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_estoque' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of PERMISSOES_ESTOQUE) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_estoque', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { instalarTabelas, migrarAcessos, garantirAdministrador, acrescentarPermissoesEstoque };
