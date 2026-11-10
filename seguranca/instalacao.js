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
  `CREATE TABLE IF NOT EXISTS \`web_sessoes\` (
     id CHAR(32) NOT NULL PRIMARY KEY,
     usuario_codigo INT NOT NULL,
     criado_em DATETIME NOT NULL,
     expira_em DATETIME NOT NULL,
     ip VARCHAR(45) NULL,
     revogada TINYINT NOT NULL DEFAULT 0,
     KEY idx_sessao_usuario (usuario_codigo)
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
  // Plano de corte de vidros: medidas em mm inteiros; `pedido` é referência lógica a ped_orc.NUMERO (tabela do VB: sem chave estrangeira).
  // web_vidro_config tem linha única (id = 1); campos NULL herdam o padrão do código.
  `CREATE TABLE IF NOT EXISTS \`web_vidro_config\` (
     id INT NOT NULL PRIMARY KEY,
     serra INT NULL,
     sobra_minima INT NULL,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(100) NULL
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_vidro_retalhos\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     produto_codigo INT NOT NULL,
     produto_nome VARCHAR(190) NOT NULL,
     altura INT NOT NULL,
     largura INT NOT NULL,
     situacao ENUM('disponivel','reservado','usado','descartado') NOT NULL DEFAULT 'disponivel',
     plano_origem INT NULL,
     plano_reserva INT NULL,
     criado_por VARCHAR(100) NULL,
     criado_em DATETIME NULL,
     atualizado_em DATETIME NULL,
     KEY ix_vretalho (situacao, produto_codigo)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_vidro_planos\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     pedido INT NOT NULL,
     situacao ENUM('gerado','conferido','cancelado') NOT NULL DEFAULT 'gerado',
     impressao_pecas CHAR(64) NOT NULL,
     parametros LONGTEXT NULL,
     resultado LONGTEXT NOT NULL,
     progresso LONGTEXT NULL,
     criado_por VARCHAR(100) NULL,
     criado_em DATETIME NULL,
     conferido_por VARCHAR(100) NULL,
     conferido_em DATETIME NULL,
     excluido_em DATETIME NULL,
     KEY ix_vplano_pedido (pedido, situacao)
   ) ${OPCOES}`,
  // notas fiscais só de cabeçalho (sem itens); contraparte = cadastro_fornecedores.COD (entrada) ou cadastro_clientes.CODIGO (saída), sem FK
  `CREATE TABLE IF NOT EXISTS \`web_notas_fiscais\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     tipo ENUM('entrada','saida') NOT NULL,
     numero VARCHAR(20) NOT NULL,
     serie VARCHAR(5) NOT NULL DEFAULT '1',
     chave CHAR(44) NULL,
     chave_original CHAR(44) NULL,
     data_emissao DATE NOT NULL,
     contraparte_codigo INT NOT NULL,
     contraparte_nome VARCHAR(190) NOT NULL,
     valor_total DECIMAL(14,2) NOT NULL,
     observacao VARCHAR(500) NULL,
     situacao ENUM('ativa','cancelada') NOT NULL DEFAULT 'ativa',
     motivo_cancelamento VARCHAR(300) NULL,
     criado_por VARCHAR(100) NULL,
     criado_em DATETIME NULL,
     alterado_por VARCHAR(100) NULL,
     alterado_em DATETIME NULL,
     UNIQUE KEY ux_nota_numero (tipo, serie, numero, contraparte_codigo),
     UNIQUE KEY ux_nota_chave (chave),
     KEY ix_nota_data (tipo, data_emissao)
   ) ${OPCOES}`,
  // DANFE (nota fiscal em PDF) enviado pela tela "Enviar arquivos": a chave de acesso (44 dígitos, nome do arquivo) é única; sem FK.
  // cnpj_emitente/modelo/serie/numero_nf/data_emissao_aamm vêm da própria chave (conferida no envio). O vínculo manual (pedido x chave) vence a ligação automática pelo financeiro.
  `CREATE TABLE IF NOT EXISTS \`web_danfe\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     chave CHAR(44) NOT NULL,
     numero_nf INT NOT NULL,
     serie INT NOT NULL,
     modelo CHAR(2) NOT NULL,
     cnpj_emitente CHAR(14) NOT NULL,
     data_emissao_aamm CHAR(4) NOT NULL,
     pdf MEDIUMBLOB NOT NULL,
     tamanho INT NOT NULL,
     sha256 CHAR(64) NOT NULL,
     enviado_por VARCHAR(100) NULL,
     enviado_em DATETIME NULL,
     UNIQUE KEY ux_danfe_chave (chave),
     KEY ix_danfe_numero (numero_nf)
   ) ${OPCOES}`,
  // Checklist de produção em PDF: um único documento vigente (id fixo 1), enviado pela tela e aberto de qualquer lugar pelo Pedido.
  `CREATE TABLE IF NOT EXISTS \`web_checklist\` (
     id INT NOT NULL PRIMARY KEY,
     nome_arquivo VARCHAR(150) NOT NULL,
     conteudo LONGBLOB NOT NULL,
     tamanho INT NOT NULL,
     enviado_por VARCHAR(100) NULL,
     enviado_em DATETIME NULL
   ) ${OPCOES}`,
  // Biblioteca de seções de perfis para o 3D do orçamento: uma linha por perfil (codigo = cadastro_de_produtos.CODIGO). `secao` = JSON do esquema versão 2 (calculo/perfil_secoes.js)
  `CREATE TABLE IF NOT EXISTS \`web_perfil_secoes\` (
     codigo INT NOT NULL PRIMARY KEY,
     modelo VARCHAR(100) NOT NULL,
     secao LONGTEXT NOT NULL,
     versao_esquema INT NOT NULL,
     atualizado_em DATETIME NULL,
     atualizado_por VARCHAR(100) NULL,
     KEY ix_perfil_secoes_modelo (modelo)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_danfe_vinculos\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     chave CHAR(44) NOT NULL,
     pedido_numero INT NOT NULL,
     criado_por VARCHAR(100) NULL,
     criado_em DATETIME NULL,
     UNIQUE KEY ux_danfe_vinculo (chave, pedido_numero),
     KEY ix_danfe_vinculo_pedido (pedido_numero)
   ) ${OPCOES}`,
  // peso por produto (o banco do VB não tem peso): produto = nome usado no VB (MODELO, PERFIL, PUXADOR, REVESTIMENTO), sem FK
  // unidade_peso: kg_m (kg por metro), kg_m2_mm (kg por m² por mm de espessura), kg_un (kg por unidade)
  `CREATE TABLE IF NOT EXISTS \`web_pesos\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     tipo ENUM('perfil','puxador','vidro','acessorio') NOT NULL,
     produto VARCHAR(190) NOT NULL,
     unidade_peso ENUM('kg_m','kg_m2_mm','kg_un') NOT NULL,
     valor DECIMAL(12,4) NOT NULL,
     origem VARCHAR(30) NOT NULL DEFAULT 'manual',
     confianca VARCHAR(10) NULL,
     atualizado_por VARCHAR(100) NULL,
     atualizado_em DATETIME NULL,
     UNIQUE KEY ux_peso_produto (tipo, produto)
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
  // módulo Entregas: cabeçalho, histórico (eventos) e comprovantes (foto/assinatura).
  // Várias entregas por pedido: `sequencia` (1, 2, ...) por número; a chave única é (numero, sequencia); a varredura grava 1.
  // `hash_itens` = impressão digital dos itens do pedido no momento da divisão (só a divisão, etapa 4, grava).
  `CREATE TABLE IF NOT EXISTS \`web_entregas\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     numero INT NOT NULL,
     sequencia INT NOT NULL DEFAULT 1,
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
     hash_itens VARCHAR(64) NULL,
     criado_em DATETIME NOT NULL,
     atualizado_em DATETIME NOT NULL,
     UNIQUE KEY uk_numero_seq (numero, sequencia)
   ) ${OPCOES}`,
  // itens e quantidades de cada entrega (cópia: editar o pedido apaga e regrava os itens com nova numeração).
  // Sem linha para a entrega = a entrega leva o pedido inteiro (caso de todas as entregas anteriores à divisão).
  `CREATE TABLE IF NOT EXISTS \`web_entrega_itens\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     entrega_id INT NOT NULL,
     numero_item INT NOT NULL,
     item_pedido INT NULL,
     descricao VARCHAR(300) NOT NULL,
     quantidade DECIMAL(14,4) NOT NULL,
     unidade VARCHAR(20) NULL,
     criado_em DATETIME NOT NULL,
     KEY idx_entrega (entrega_id)
   ) ${OPCOES}`,
  // sobra do pedido dividido que a equipe ENCERROU ("Encerrar saldo", com motivo): conta como coberta na regra da última baixa.
  // Uma linha por item, com a quantidade encerrada e o hash_itens do pedido naquele momento. Só da web; apagada com o pedido.
  `CREATE TABLE IF NOT EXISTS \`web_entrega_sobras_encerradas\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     numero INT NOT NULL,
     numero_item INT NOT NULL,
     descricao VARCHAR(300) NOT NULL,
     quantidade DECIMAL(14,4) NOT NULL,
     hash_itens VARCHAR(64) NULL,
     motivo VARCHAR(500) NOT NULL,
     usuario VARCHAR(190) NOT NULL,
     criado_em DATETIME NOT NULL,
     KEY idx_numero (numero)
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
   ) ${OPCOES}`,
  // portal do cliente (identidade externa; sem FK, cliente_codigo = cadastro_clientes.CODIGO só por referência lógica)
  `CREATE TABLE IF NOT EXISTS \`web_portal_empresas\` (
     cliente_codigo INT NOT NULL PRIMARY KEY,
     situacao ENUM('ativa','suspensa') NOT NULL DEFAULT 'ativa',
     liberado_por VARCHAR(100) NOT NULL,
     liberado_em DATETIME NOT NULL,
     suspenso_em DATETIME NULL
   ) ${OPCOES}`,
  // e-mail em utf8mb4_bin: comparação exata (o código normaliza para minúsculas antes de gravar)
  `CREATE TABLE IF NOT EXISTS \`web_portal_usuarios\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     email VARCHAR(190) COLLATE utf8mb4_bin NOT NULL,
     cliente_codigo INT NOT NULL,
     papel ENUM('admin_geral','usuario') NOT NULL,
     situacao ENUM('convidado','ativo','inativo') NOT NULL DEFAULT 'convidado',
     senha_hash VARCHAR(100) NULL,
     totp_segredo_cifrado VARCHAR(400) NULL,
     totp_ativo TINYINT NOT NULL DEFAULT 0,
     totp_ultimo_passo BIGINT NOT NULL DEFAULT 0,
     senha_alterada_em DATETIME NULL,
     termo_versao VARCHAR(30) NULL,
     termo_aceito_em DATETIME NULL,
     criado_em DATETIME NOT NULL,
     criado_por VARCHAR(100) NOT NULL,
     UNIQUE KEY ux_portal_usuario_email (email),
     KEY idx_portal_usuario_empresa (cliente_codigo)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_portal_permissoes\` (
     usuario_id INT NOT NULL,
     permissao VARCHAR(60) NOT NULL,
     PRIMARY KEY (usuario_id, permissao)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_portal_convites\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     token_hash CHAR(64) NOT NULL,
     usuario_id INT NOT NULL,
     expira_em DATETIME NOT NULL,
     usado_em DATETIME NULL,
     criado_por VARCHAR(100) NOT NULL,
     criado_em DATETIME NOT NULL,
     UNIQUE KEY ux_portal_convite_token (token_hash),
     KEY idx_portal_convite_usuario (usuario_id)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_portal_recuperacao\` (
     usuario_id INT NOT NULL,
     codigo_hash CHAR(64) NOT NULL,
     usado_em DATETIME NULL,
     PRIMARY KEY (usuario_id, codigo_hash)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_portal_sessoes\` (
     id CHAR(64) NOT NULL PRIMARY KEY,
     usuario_id INT NOT NULL,
     criado_em DATETIME NOT NULL,
     expira_em DATETIME NOT NULL,
     ultimo_uso_em DATETIME NOT NULL,
     ip VARCHAR(45) NULL,
     revogada TINYINT NOT NULL DEFAULT 0,
     KEY idx_portal_sessao_usuario (usuario_id)
   ) ${OPCOES}`,
  `CREATE TABLE IF NOT EXISTS \`web_portal_auditoria\` (
     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     quando DATETIME NOT NULL,
     evento VARCHAR(40) NOT NULL,
     usuario_id INT NULL,
     cliente_codigo INT NULL,
     ip VARCHAR(45) NULL,
     detalhe TEXT NULL,
     KEY idx_portal_audit_evento (evento),
     KEY idx_portal_audit_quando (quando)
   ) ${OPCOES}`,
  // etapas de produção por pedido (sub-situação): uma linha por pedido e etapa; ausente = pendente ou N/A automático (calculo/etapas_producao.js).
  // numero = ped_orc.NUMERO (TIPO Pedido) só por referência lógica, sem FK; origem corte = marcada pela confirmação do corte real.
  `CREATE TABLE IF NOT EXISTS \`web_producao_etapas\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     numero INT NOT NULL,
     etapa VARCHAR(30) NOT NULL,
     estado ENUM('pendente','ok','na') NOT NULL DEFAULT 'pendente',
     origem ENUM('manual','corte') NOT NULL DEFAULT 'manual',
     usuario VARCHAR(190) NOT NULL DEFAULT '',
     quando DATETIME NOT NULL,
     observacao VARCHAR(500) NULL,
     UNIQUE KEY uq_producao_etapa (numero, etapa)
   ) ${OPCOES}`,
  // histórico de cada mudança de etapa (manual, pelo corte ou pelo sistema ao cancelar o pedido)
  `CREATE TABLE IF NOT EXISTS \`web_producao_etapas_eventos\` (
     id INT AUTO_INCREMENT PRIMARY KEY,
     numero INT NOT NULL,
     etapa VARCHAR(30) NOT NULL,
     estado_antes VARCHAR(10) NULL,
     estado_depois VARCHAR(10) NOT NULL,
     origem ENUM('manual','corte','sistema') NOT NULL,
     usuario VARCHAR(190) NOT NULL,
     quando DATETIME NOT NULL,
     observacao VARCHAR(500) NULL,
     detalhe TEXT NULL,
     KEY idx_producao_evento (numero, etapa)
   ) ${OPCOES}`
];

async function instalarTabelas(pool) {
  for (const sql of TABELAS) await pool.execute(sql);
  // web_pesos criada antes de origem/confianca (de onde veio o peso): acrescenta as colunas na tabela da web (nunca em tabela do VB)
  const [[po] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_pesos' AND COLUMN_NAME = 'origem'");
  if (!Number(po?.n)) await pool.execute("ALTER TABLE web_pesos ADD COLUMN origem VARCHAR(30) NOT NULL DEFAULT 'manual' AFTER valor");
  const [[pc] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_pesos' AND COLUMN_NAME = 'confianca'");
  if (!Number(pc?.n)) await pool.execute('ALTER TABLE web_pesos ADD COLUMN confianca VARCHAR(10) NULL AFTER origem');
  // notas fiscais criadas antes da coluna chave_original (liberada ao cancelar): acrescenta na tabela da web
  const [[nf] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_notas_fiscais' AND COLUMN_NAME = 'chave_original'");
  if (!Number(nf?.n)) await pool.execute('ALTER TABLE web_notas_fiscais ADD COLUMN chave_original CHAR(44) NULL AFTER chave');
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
  // revisão da semente que gerou a linha (biblioteca de seções de perfis): NULL = linha não veio de semente ou veio antes da coluna
  const [[sr] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_perfil_secoes' AND COLUMN_NAME = 'semente_rev'");
  if (!Number(sr?.n)) await pool.execute('ALTER TABLE web_perfil_secoes ADD COLUMN semente_rev INT NULL');
  await migrarEntregasVarias(pool);
}

// Várias entregas por pedido (etapa 2): web_entregas criada antes de `sequencia`/`hash_itens` e com UNIQUE(numero).
// Idempotente e reexecutável: cada passo confere o information_schema antes; nada é apagado (as entregas existentes ficam sequencia = 1).
// A troca da chave única é UM ALTER (DROP + ADD juntos): nunca há janela sem unicidade por número.
async function migrarEntregasVarias(pool) {
  const [[sq] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_entregas' AND COLUMN_NAME = 'sequencia'");
  if (!Number(sq?.n)) await pool.execute('ALTER TABLE web_entregas ADD COLUMN sequencia INT NOT NULL DEFAULT 1 AFTER numero');
  const [[hi] = []] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_entregas' AND COLUMN_NAME = 'hash_itens'");
  if (!Number(hi?.n)) await pool.execute('ALTER TABLE web_entregas ADD COLUMN hash_itens VARCHAR(64) NULL AFTER observacao');
  const [indices] = await pool.execute(
    "SELECT DISTINCT INDEX_NAME AS nome FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_entregas' AND INDEX_NAME IN ('uk_numero', 'uk_numero_seq')");
  const nomes = new Set((indices || []).map(i => i.nome ?? i.INDEX_NAME));
  const passos = [];
  if (nomes.has('uk_numero')) passos.push('DROP INDEX uk_numero');
  if (!nomes.has('uk_numero_seq')) passos.push('ADD UNIQUE KEY uk_numero_seq (numero, sequencia)');
  if (passos.length) await pool.execute(`ALTER TABLE web_entregas ${passos.join(', ')}`);
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

// Notas fiscais: ver e editar para Administrador e Interno completo
async function acrescentarPermissoesNotas(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_notas' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of ['notas.ver', 'notas.editar']) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_notas', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Notas de compra pela SEFAZ (serviço local do PC): ver e importar para Administrador e Interno completo
async function acrescentarPermissoesComprasNfe(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_compras_nfe' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of ['compras_nfe.ver', 'compras_nfe.importar']) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_compras_nfe', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Peso das portas: ver e editar para Administrador e Interno completo
async function acrescentarPermissoesPesos(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_pesos' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of ['pesos.ver', 'pesos.editar']) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_pesos', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// DANFE: ver para Administrador e Interno completo; enviar e vincular só para o Administrador (um marcador só, roda uma vez)
async function acrescentarPermissoesDanfe(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_danfe' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      const lista = p.nome === 'Administrador' ? ['danfe.ver', 'danfe.enviar', 'danfe.vincular'] : ['danfe.ver'];
      for (const permissao of lista) await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_danfe', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
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

// Portal do cliente: gerenciar (liberar empresas, convidar, suspender, reiniciar o 2º fator) só para o Administrador
const acrescentarPermissoesPortal = pool => darAoAdministrador(pool, 'permissoes_portal', ['portal.gerir']);

// Indicadores de Pedidos e Orçamentos (Operação agora / Resultado do período): só o Administrador na migração
const acrescentarPermissoesIndicadores = pool => darAoAdministrador(pool, 'permissoes_indicadores', ['indicadores.ver']);

// Divisão administrativo × operador (2026-11-10): a permissão-chave `administrativo.ver` passa a mandar nas permissões administrativas
// (seguranca/permissoes.js). Para NINGUÉM perder a gestão que já usa: recebem a chave o Administrador, o Interno completo, qualquer outro perfil
// que já tenha financeiro.ver, gestao.ver ou precos.ver e quem tem uma exceção "liberar" dessas três. Vendedor e Representante NÃO recebem
// (ficam "só valores"). Cria o perfil Operador se ele não existir. Roda uma única vez; a auditoria guarda quem recebeu a chave.
const PERMISSOES_QUE_PEDEM_A_CHAVE = ['financeiro.ver', 'gestao.ver', 'precos.ver'];
async function acrescentarPermissoesAdministrativo(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_administrativo' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const marcas = PERMISSOES_QUE_PEDEM_A_CHAVE.map(() => '?').join(', ');
    const [perfis] = await conn.execute(
      `SELECT DISTINCT p.id FROM web_perfis p LEFT JOIN web_perfil_permissoes pp ON pp.perfil_id = p.id
       WHERE p.nome IN ('Administrador', 'Interno completo') OR pp.permissao IN (${marcas}) ORDER BY p.id`, PERMISSOES_QUE_PEDEM_A_CHAVE);
    for (const p of perfis) await conn.execute("INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, 'administrativo.ver')", [p.id]);
    const [usuarios] = await conn.execute(
      `SELECT DISTINCT usuario_codigo FROM web_usuario_excecoes WHERE tipo = 'liberar' AND permissao IN (${marcas}) ORDER BY usuario_codigo`, PERMISSOES_QUE_PEDEM_A_CHAVE);
    for (const u of usuarios) await conn.execute("INSERT IGNORE INTO web_usuario_excecoes (usuario_codigo, permissao, tipo) VALUES (?, 'administrativo.ver', 'liberar')", [u.usuario_codigo]);
    const [jaTem] = await conn.execute("SELECT id FROM web_perfis WHERE nome = 'Operador' LIMIT 1");
    let operadorCriado = false;
    if (!jaTem.length) {
      const modelo = PERFIS_INICIAIS.find(p => p.nome === 'Operador');
      const [r] = await conn.execute('INSERT INTO web_perfis (nome, descricao, ativo, criado_em) VALUES (?, ?, 1, NOW())', [modelo.nome, modelo.descricao]);
      for (const permissao of modelo.permissoes) await conn.execute('INSERT INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [r.insertId, permissao]);
      operadorCriado = true;
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_administrativo', '', JSON.stringify({ perfisComChave: perfis.map(p => p.id), usuariosComChave: usuarios.map(u => u.usuario_codigo), operadorCriado })]);
    await conn.commit();
    return { feito: true, perfis: perfis.length, usuarios: usuarios.length, operadorCriado };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

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

// Desenho dos perfis (3D): perfis.desenho (editar a seção) para Administrador e Interno completo; uma vez só (auditoria permissoes_perfis_desenho)
async function acrescentarPermissoesPerfisDesenho(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_perfis_desenho' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, 'perfis.desenho']);
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_perfis_desenho', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Semeadura da biblioteca de seções (calculo/perfil_secoes_biblioteca.js), a CADA subida, uma transação por seção:
//  (a) sem linha do código: insere (atualizado_por = 'semente', semente_rev = rev) -- EXCETO se o dono apagou pela tela
//      (auditoria semente_perfil_secoes_removida, ou, para o 1036 semeado na versão antiga, a auditoria legada semente_perfil_secoes com alvo = código);
//  (b) linha de semente (atualizado_por = 'semente') com semente_rev < rev da biblioteca (NULL = 0): atualiza (assim uma semente errada se corrige subindo a rev);
//  (c) linha editada por pessoa (atualizado_por diferente de 'semente'): NUNCA sobrescreve.
// Migração do 1036 antigo: a versão anterior gravava atualizado_por = 'sistema' e nenhuma rev. 'sistema' só existe nessa linha de semente (a tela grava o nome
// da pessoa), então 'sistema' sem rev conta como semente de rev 0 e é regravada (mesmo conteúdo) já como 'semente'. Se uma pessoa tivesse editado, a linha teria o nome dela.
// Devolve { feito, inseridas[], atualizadas[] } (feito = mexeu em alguma linha).
async function semearPerfilSecoes(pool) {
  const { SECOES } = require('../calculo/perfil_secoes_biblioteca');
  const inseridas = [], atualizadas = [];
  const SQL_INS = 'INSERT INTO web_perfil_secoes (codigo, modelo, secao, versao_esquema, atualizado_em, atualizado_por, semente_rev) VALUES (?, ?, ?, ?, NOW(), ?, ?)';
  const SQL_AUD = 'INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)';
  for (const item of SECOES) {
    const secao = { ...item.secao, codigo: item.codigo, modelo: item.modelo };
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [existe] = await conn.execute('SELECT codigo, atualizado_por, semente_rev FROM web_perfil_secoes WHERE codigo = ? FOR UPDATE', [item.codigo]);
      if (!existe.length) {
        const [apagada] = await conn.execute(
          "SELECT id FROM web_auditoria WHERE alvo = ? AND acao IN ('semente_perfil_secoes_removida', 'semente_perfil_secoes') LIMIT 1", [String(item.codigo)]);
        if (!apagada.length) {
          await conn.execute(SQL_INS, [item.codigo, item.modelo, JSON.stringify(secao), secao.versao, 'semente', item.rev]);
          await conn.execute(SQL_AUD, ['sistema', 'semente_perfil_secoes_inserida', String(item.codigo), JSON.stringify({ codigo: item.codigo, rev: item.rev })]);
          inseridas.push(item.codigo);
        }
      } else {
        const l = existe[0];
        const porSemente = l.atualizado_por === 'semente' || l.atualizado_por === 'sistema';
        const revAtual = l.semente_rev == null ? 0 : Number(l.semente_rev);
        if (porSemente && revAtual < item.rev) {
          await conn.execute('UPDATE web_perfil_secoes SET modelo = ?, secao = ?, versao_esquema = ?, atualizado_em = NOW(), atualizado_por = ?, semente_rev = ? WHERE codigo = ?',
            [item.modelo, JSON.stringify(secao), secao.versao, 'semente', item.rev, item.codigo]);
          await conn.execute(SQL_AUD, ['sistema', 'semente_perfil_secoes_atualizada', String(item.codigo), JSON.stringify({ codigo: item.codigo, de: revAtual, para: item.rev })]);
          atualizadas.push(item.codigo);
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
  return { feito: inseridas.length + atualizadas.length > 0, inseridas, atualizadas };
}

// Checklist de produção: pedidos.checklist para Administrador, Interno completo e, como no VB, Auxiliar de escritório e Auxiliar financeiro (se existirem como perfil);
// checklist.enviar (trocar o PDF) só para Administrador e Interno completo
async function acrescentarPermissoesChecklist(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_checklist' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo', 'Auxiliar de escritório', 'Auxiliar financeiro') ORDER BY id");
    for (const p of perfis) {
      await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, 'pedidos.checklist']);
      if (p.nome === 'Administrador' || p.nome === 'Interno completo') await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, 'checklist.enviar']);
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_checklist', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Modo atendimento: Interno completo e Vendedor passam a iniciar nele (o usuário desliga na tela); o Administrador não
async function acrescentarPermissoesAtendimento(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_atendimento' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Interno completo', 'Vendedor') ORDER BY id");
    for (const p of perfis) await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, 'atendimento.modo']);
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_atendimento', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Situação "Baixado" do orçamento: Administrador, Interno completo e Representante (só acrescenta; ninguém perde nada)
async function acrescentarPermissoesOrcSituacao(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_orc_situacao' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo', 'Representante') ORDER BY id");
    for (const p of perfis) await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, 'orcamentos.situacao']);
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_orc_situacao', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Etapas de produção: Administrador recebe todas; Interno completo recebe ver e as 5 etapas de chão de fábrica (não finalizar nem gerir:
// finalizar grava SITUACAO = Pronto, como pedidos.situacao, que na migração é só do Administrador). Uma vez só (auditoria permissoes_etapas).
const PERMISSOES_ETAPAS = { 'Administrador': ['etapas.ver', 'etapas.corte_perfil', 'etapas.corte_vidro', 'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem', 'etapas.finalizar', 'etapas.gerir'],
  'Interno completo': ['etapas.ver', 'etapas.corte_perfil', 'etapas.corte_vidro', 'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem'] };
async function acrescentarPermissoesEtapas(pool) {
  const [feito] = await pool.execute("SELECT id FROM web_auditoria WHERE acao = 'permissoes_etapas' LIMIT 1");
  if (feito.length) return { feito: false };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [perfis] = await conn.execute("SELECT id, nome FROM web_perfis WHERE nome IN ('Administrador', 'Interno completo') ORDER BY id");
    for (const p of perfis) {
      for (const permissao of PERMISSOES_ETAPAS[p.nome] || []) {
        await conn.execute('INSERT IGNORE INTO web_perfil_permissoes (perfil_id, permissao) VALUES (?, ?)', [p.id, permissao]);
      }
    }
    await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
      ['sistema', 'permissoes_etapas', '', JSON.stringify({ perfis: perfis.map(p => p.id) })]);
    await conn.commit();
    return { feito: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { acrescentarPermissoesAdministrativo, acrescentarPermissoesIndicadores, acrescentarPermissoesEtapas, acrescentarPermissoesPerfisDesenho, semearPerfilSecoes, acrescentarPermissoesChecklist, acrescentarPermissoesPortal, acrescentarPermissoesOrcSituacao, instalarTabelas, acrescentarPermissoesNotas, acrescentarPermissoesComprasNfe,acrescentarPermissoesPesos, acrescentarPermissoesDanfe, acrescentarPermissoesAtendimento, acrescentarPermissoesCorte, acrescentarPermissoesGestao, acrescentarPermissoesTintas, acrescentarPermissoesSituacao, acrescentarPermissoesCadastros, migrarAcessos, garantirAdministrador, acrescentarPermissoesEstoque, acrescentarPermissoesEntregas, acrescentarPermissoesPedOrc, acrescentarPermissoesPrecos, acrescentarPermissoesPrecosGravar, acrescentarPermissoesCancelarExcluir };
