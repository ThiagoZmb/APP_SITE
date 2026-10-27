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
   ) ${OPCOES}`,
  // Central de Gestão (entrega 1): metas por mês e orçamento por categoria. Valores em DECIMAL(14,2).
  // classificacao_id é referência lógica a fluxo_de_caixa_classificacao.id (tabela do VB: sem chave estrangeira).
  `CREATE TABLE IF NOT EXISTS \`web_gestao_metas\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     periodo CHAR(7) NOT NULL,
     tipo ENUM('faturamento','despesa') NOT NULL,
     valor DECIMAL(14,2) NOT NULL,
     origem ENUM('web','vb') NOT NULL DEFAULT 'web',
     criado_por VARCHAR(100) NULL,
     criado_em DATETIME NULL,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(100) NULL,
     UNIQUE KEY uq_meta (periodo, tipo)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_gestao_orcamento\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     periodo CHAR(7) NOT NULL,
     classificacao_id INT NOT NULL,
     nivel TINYINT NOT NULL DEFAULT 1,
     valor DECIMAL(14,2) NOT NULL,
     limiar_atencao DECIMAL(6,2) NULL,
     limiar_alerta DECIMAL(6,2) NULL,
     criado_por VARCHAR(100) NULL,
     criado_em DATETIME NULL,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(100) NULL,
     UNIQUE KEY uq_orcamento (periodo, classificacao_id)
   ) ${OPCOES}`,
  // Plano de corte: medidas em mm inteiros. perfil '' = padrão (UNIQUE não aceita vários NULL); campos NULL herdam o padrão.
  // `pedido` é referência lógica a ped_orc.NUMERO (tabela do VB: sem chave estrangeira).
  `CREATE TABLE IF NOT EXISTS \`web_corte_config\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     perfil VARCHAR(190) NOT NULL DEFAULT '',
     comprimento_vara INT NULL,
     serra INT NULL,
     sobra_minima INT NULL,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(100) NULL,
     UNIQUE KEY uq_corte_config (perfil)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_retalhos\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     perfil VARCHAR(190) NOT NULL,
     acabamento VARCHAR(190) NOT NULL,
     cor VARCHAR(190) NOT NULL,
     comprimento INT NOT NULL,
     situacao ENUM('disponivel','reservado','usado','descartado') NOT NULL DEFAULT 'disponivel',
     plano_origem INT NULL,
     plano_reserva INT NULL,
     criado_por VARCHAR(100) NULL,
     criado_em DATETIME NULL,
     atualizado_em DATETIME NULL,
     KEY ix_retalho_grupo (situacao, perfil, acabamento, cor)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_corte_planos\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     pedido INT NOT NULL,
     situacao ENUM('gerado','conferido','desatualizado','cancelado') NOT NULL DEFAULT 'gerado',
     impressao_pecas CHAR(64) NOT NULL,
     parametros LONGTEXT NULL,
     resultado LONGTEXT NOT NULL,
     progresso LONGTEXT NULL,
     criado_por VARCHAR(100) NULL,
     criado_em DATETIME NULL,
     conferido_por VARCHAR(100) NULL,
     conferido_em DATETIME NULL,
     excluido_em DATETIME NULL,
     KEY ix_plano_pedido (pedido, situacao)
   ) ${OPCOES}`,
  // formação de preços — parte A: configuração por material de venda (cadastro_de_produtos.CODIGO)
  `CREATE TABLE IF NOT EXISTS \`web_custo_material\` (
     material_codigo INT NOT NULL PRIMARY KEY,
     unidade_venda VARCHAR(4) NULL,
     sem_compra TINYINT(1) NOT NULL DEFAULT 0,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(190) NULL
   ) ${OPCOES}`,
  // ligações confirmadas material de venda ↔ item de estoque; fator = unidades de venda em 1 unidade de compra
  `CREATE TABLE IF NOT EXISTS \`web_custo_ligacoes\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     material_codigo INT NOT NULL,
     estoque_codigo INT NOT NULL,
     fator DECIMAL(14,6) NOT NULL,
     confirmado_em DATETIME NULL,
     confirmado_por VARCHAR(190) NULL,
     componente_id INT NULL,
     quantidade DECIMAL(14,4) NULL,
     UNIQUE KEY uk_material_estoque (material_codigo, estoque_codigo)
   ) ${OPCOES}`,
  // composição: material de venda = Σ quantidade × componente (quantidade na unidade de venda); ligação sem componente = componente principal (1)
  // participacao_pct: forma antiga (100% = 1); fica só para a conversão das instalações anteriores
  `CREATE TABLE IF NOT EXISTS \`web_custo_componentes\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     material_codigo INT NOT NULL,
     nome VARCHAR(60) NULL,
     participacao_pct DECIMAL(9,3) NOT NULL DEFAULT 100,
     quantidade DECIMAL(14,4) NULL,
     custo_informado DECIMAL(14,4) NULL,
     informado_em DATETIME NULL,
     informado_por VARCHAR(190) NULL,
     ordem INT NOT NULL DEFAULT 0,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(190) NULL,
     KEY idx_material (material_codigo)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_custo_parametros\` (
     chave VARCHAR(64) NOT NULL PRIMARY KEY,
     valor VARCHAR(190) NOT NULL
   ) ${OPCOES}`,
  // formação do VALOR_FIXO: encargos extras sobre a venda, margens por classe/material e histórico das gravações
  `CREATE TABLE IF NOT EXISTS \`web_preco_encargos\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     nome VARCHAR(60) NOT NULL,
     pct DECIMAL(6,3) NOT NULL,
     ativo TINYINT(1) NOT NULL DEFAULT 1,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(190) NULL
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_preco_margens\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     escopo ENUM('classe','material') NOT NULL,
     chave VARCHAR(190) NOT NULL,
     margem_pct DECIMAL(6,3) NOT NULL,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(190) NULL,
     UNIQUE KEY uk_escopo_chave (escopo, chave)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_preco_historico\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     lote CHAR(36) NOT NULL,
     material_codigo INT NOT NULL,
     valor_anterior DOUBLE NULL,
     valor_novo DOUBLE NOT NULL,
     custo DOUBLE NULL,
     memoria JSON NULL,
     gravado_em DATETIME NOT NULL,
     gravado_por VARCHAR(190) NOT NULL,
     desfeito_em DATETIME NULL,
     desfeito_por VARCHAR(190) NULL,
     KEY idx_material (material_codigo, id)
   ) ${OPCOES}`,
  // prazo de reposição por item (análises do estoque); sem linha = 15 dias
  `CREATE TABLE IF NOT EXISTS \`web_estoque_reposicao\` (
     produto_codigo INT NOT NULL PRIMARY KEY,
     prazo_dias INT NOT NULL,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(190) NULL
   ) ${OPCOES}`,
  // módulo Entregas: cabeçalho, histórico (eventos) e comprovantes (foto/assinatura)
  `CREATE TABLE IF NOT EXISTS \`web_entregas\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     numero INT NOT NULL,
     status VARCHAR(20) NOT NULL,
     tipo VARCHAR(20) NULL,
     data_agendada DATE NULL,
     motorista_codigo INT NULL,
     endereco_rua VARCHAR(190) NULL,
     endereco_numero VARCHAR(30) NULL,
     endereco_bairro VARCHAR(120) NULL,
     endereco_cidade VARCHAR(120) NULL,
     endereco_uf CHAR(2) NULL,
     endereco_cep VARCHAR(12) NULL,
     endereco_ref VARCHAR(190) NULL,
     contato_local VARCHAR(190) NULL,
     transportadora VARCHAR(190) NULL,
     rastreio VARCHAR(120) NULL,
     previsao DATE NULL,
     observacao VARCHAR(500) NULL,
     criado_em DATETIME NOT NULL,
     atualizado_em DATETIME NOT NULL,
     UNIQUE KEY uk_numero (numero)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_entrega_eventos\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     entrega_id INT NOT NULL,
     quando DATETIME NOT NULL,
     usuario VARCHAR(190) NOT NULL,
     tipo VARCHAR(30) NOT NULL,
     motivo VARCHAR(500) NULL,
     entregue_a VARCHAR(190) NULL,
     detalhe JSON NULL,
     KEY idx_entrega (entrega_id, id)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_entrega_anexos\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     entrega_id INT NOT NULL,
     evento_id INT NULL,
     tipo VARCHAR(20) NOT NULL,
     mime VARCHAR(60) NOT NULL,
     dados MEDIUMBLOB NOT NULL,
     criado_por VARCHAR(190) NOT NULL,
     criado_em DATETIME NOT NULL,
     KEY idx_entrega (entrega_id)
   ) ${OPCOES}`,
  // desenho da porta capturado na configuração (PNG), mostrado na coluna Imagem do PDF; o carimbo diz se ainda vale para o documento
  `CREATE TABLE IF NOT EXISTS \`web_item_desenhos\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     tipo VARCHAR(20) NOT NULL,
     numero INT NOT NULL,
     item INT NOT NULL,
     png MEDIUMBLOB NOT NULL,
     carimbo CHAR(64) NOT NULL,
     criado_em DATETIME NOT NULL,
     UNIQUE KEY uq_doc_item (tipo, numero, item)
   ) ${OPCOES}`
];

async function instalarTabelas(pool) {
  for (const sql of TABELAS) await pool.execute(sql);
  // instalações anteriores à composição: acrescenta a coluna na tabela da web (nunca em tabela do VB)
  const [[c] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_custo_ligacoes' AND COLUMN_NAME = 'componente_id'");
  if (!Number(c?.n)) await pool.execute('ALTER TABLE web_custo_ligacoes ADD COLUMN componente_id INT NULL');
  // composição passou de participação % para quantidade: acrescenta a coluna e converte o que já existe (100% → 1)
  const [[q] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_custo_componentes' AND COLUMN_NAME = 'quantidade'");
  if (!Number(q?.n)) {
    await pool.execute('ALTER TABLE web_custo_componentes ADD COLUMN quantidade DECIMAL(14,4) NULL');
    await pool.execute('UPDATE web_custo_componentes SET quantidade = participacao_pct / 100 WHERE quantidade IS NULL');
  }
  // custo informado (componente ou produto sem estoque)
  const [[ci] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_custo_componentes' AND COLUMN_NAME = 'custo_informado'");
  if (!Number(ci?.n)) await pool.execute('ALTER TABLE web_custo_componentes ADD COLUMN custo_informado DECIMAL(14,4) NULL, ADD COLUMN informado_em DATETIME NULL, ADD COLUMN informado_por VARCHAR(190) NULL');
  // quantidade por item dentro do componente (os itens se somam); a qtd que estava no componente passa para os itens dele, uma vez
  const [[ql] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_custo_ligacoes' AND COLUMN_NAME = 'quantidade'");
  if (!Number(ql?.n)) {
    await pool.execute('ALTER TABLE web_custo_ligacoes ADD COLUMN quantidade DECIMAL(14,4) NULL');
    await pool.execute('UPDATE web_custo_ligacoes l JOIN web_custo_componentes c ON c.id = l.componente_id SET l.quantidade = c.quantidade WHERE c.quantidade IS NOT NULL AND c.quantidade <> 1');
    await pool.execute('UPDATE web_custo_componentes SET quantidade = 1 WHERE quantidade IS NOT NULL AND quantidade <> 1');
  }
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

// Entregas: ver e programar para Administrador e Interno completo; baixar (motorista) ninguém recebe aqui
const PERMISSOES_ENTREGAS = ['entregas.ver', 'entregas.programar'];
async function acrescentarPermissoesEntregas(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_entregas' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of PERMISSOES_ENTREGAS) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_entregas', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// "Salvar orçamento" para todo perfil que já monta orçamento; "Salvar como pedido" só para o Administrador
async function acrescentarPermissoesPedOrc(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_ped_orc' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [montam] = await conn.execute("SELECT DISTINCT perfil_id FROM web_perfil_permissoes WHERE permissao = 'orcamentos.criar' ORDER BY perfil_id");
    for (const p of montam) await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.perfil_id, 'orcamentos.salvar']);
    const [admin] = await conn.execute("SELECT id FROM web_perfis WHERE nome = 'Administrador' ORDER BY id");
    for (const p of admin) await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, 'pedidos.criar']);
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_ped_orc', '', JSON.stringify({ salvar: montam.map(p => p.perfil_id), pedido: admin.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// "Ver custos e preços" e "Editar ligações de custo" para o Administrador (os demais perfis o Thiago libera)
// passo único: dá permissões novas de preço só ao Administrador (marcador em web_auditoria)
async function darAoAdministrador(pool, marcador, permissoes) {
  const [feito] = await pool.execute(`SELECT id FROM web_auditoria WHERE acao = '${marcador}' LIMIT 1`);
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [admin] = await conn.execute("SELECT id FROM web_perfis WHERE nome = 'Administrador' ORDER BY id");
    for (const p of admin) for (const permissao of permissoes)
      await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', marcador, '', JSON.stringify({ perfis: admin.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const acrescentarPermissoesPrecos = pool => darAoAdministrador(pool, 'permissoes_precos', ['precos.ver', 'precos.editar']);
const acrescentarPermissoesPrecosGravar = pool => darAoAdministrador(pool, 'permissoes_precos_gravar', ['precos.gravar']);

const acrescentarPermissoesCancelarExcluir = pool => darAoAdministrador(pool, 'permissoes_cancelar_excluir', ['pedidos.cancelar', 'pedidos.excluir']);

// Mudar a situação do pedido pela tela de pedidos: só o Administrador recebe (como cancelar/excluir)
const acrescentarPermissoesSituacao = pool => darAoAdministrador(pool, 'permissoes_situacao', ['pedidos.situacao']);

// Cadastros: fornecedores para Administrador e Interno completo; funcionários (dados pessoais e salários) só para o Administrador
const PERMISSOES_CADASTROS = { 'Administrador': ['fornecedores.ver', 'fornecedores.editar', 'funcionarios.ver', 'funcionarios.editar'], 'Interno completo': ['fornecedores.ver', 'fornecedores.editar'] };
async function acrescentarPermissoesCadastros(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_cadastros' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of PERMISSOES_CADASTROS[p.nome] || []) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_cadastros', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Tintas: ver e editar para Administrador e Interno completo
async function acrescentarPermissoesTintas(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_tintas' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of ['tintas.ver', 'tintas.editar']) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_tintas', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Central de Gestão: ver e editar só para o Administrador (os demais perfis o Thiago libera)
const acrescentarPermissoesGestao = pool => darAoAdministrador(pool, 'permissoes_gestao', ['gestao.ver', 'gestao.editar']);

// Plano de corte: ver e planejar para Administrador e Interno completo; parâmetros e retalhos manuais só para o Administrador
const PERMISSOES_CORTE = { 'Administrador': ['corte.ver', 'corte.planejar', 'corte.parametros'], 'Interno completo': ['corte.ver', 'corte.planejar'] };
async function acrescentarPermissoesCorte(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_corte' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of PERMISSOES_CORTE[p.nome] || []) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_corte', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { instalarTabelas, acrescentarPermissoesCorte, acrescentarPermissoesGestao, acrescentarPermissoesTintas, acrescentarPermissoesSituacao, acrescentarPermissoesCadastros, migrarAcessos, garantirAdministrador, acrescentarPermissoesEstoque, acrescentarPermissoesEntregas, acrescentarPermissoesPedOrc, acrescentarPermissoesPrecos, acrescentarPermissoesPrecosGravar, acrescentarPermissoesCancelarExcluir };
