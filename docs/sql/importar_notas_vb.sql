-- ============================================================================
-- Copia as notas do VB (nf_entrada e nf_saida) para a tela nova (web_notas_fiscais).
-- Para o MySQL Workbench. Rode UM BLOCO POR VEZ (selecione o bloco e use Ctrl+Shift+Enter).
-- Não altera nf_entrada nem nf_saida. Pode ser rodado de novo sem duplicar (a trava é o índice
-- ux_nota_numero: tipo + série + número + código do fornecedor/cliente).
-- ============================================================================

-- ============ BLOCO 0: garante que a tabela nova existe (igual à que o servidor cria) ============
CREATE TABLE IF NOT EXISTS `web_notas_fiscais` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============ BLOCO 1: SIMULAÇÃO (só olha, não grava) — quantas notas existem e quantas têm problema ============
SELECT 'nf_entrada (total no VB)' AS item, COUNT(*) AS qtd FROM nf_entrada
UNION ALL SELECT 'nf_saida (total no VB)', COUNT(*) FROM nf_saida
UNION ALL SELECT 'nf_entrada que NÃO podem entrar (problema)', COUNT(*) FROM nf_entrada n
  WHERE NOT COALESCE(TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^[0-9A-Za-z]{1,20}$' AND NOT TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^0+$'
        AND DATE(n.DATA) >= '1900-01-01' AND COALESCE(n.VALOR_TOTAL, 0) BETWEEN 0 AND 999999999999.99, 0)
UNION ALL SELECT 'nf_saida que NÃO podem entrar (problema)', COUNT(*) FROM nf_saida n
  WHERE NOT COALESCE(TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^[0-9A-Za-z]{1,20}$' AND NOT TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^0+$'
        AND DATE(n.DATA) >= '1900-01-01' AND COALESCE(n.VALOR, 0) BETWEEN 0 AND 999999999999.99, 0)
UNION ALL SELECT 'já existem na tela nova', COUNT(*) FROM web_notas_fiscais;


-- ============ BLOCO 2: lista das notas COM problema (não serão copiadas) — corrija no VB se quiser que entrem ============
SELECT 'entrada' AS tipo, n.NUMERO, n.DATA, n.VALOR_TOTAL AS valor, n.RAZAO_FABRICANTE AS nome FROM nf_entrada n
  WHERE NOT COALESCE(TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^[0-9A-Za-z]{1,20}$' AND NOT TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^0+$'
        AND DATE(n.DATA) >= '1900-01-01' AND COALESCE(n.VALOR_TOTAL, 0) BETWEEN 0 AND 999999999999.99, 0)
UNION ALL
SELECT 'saida', n.NUMERO, n.DATA, n.VALOR, n.RAZAO_SOCIAL FROM nf_saida n
  WHERE NOT COALESCE(TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^[0-9A-Za-z]{1,20}$' AND NOT TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^0+$'
        AND DATE(n.DATA) >= '1900-01-01' AND COALESCE(n.VALOR, 0) BETWEEN 0 AND 999999999999.99, 0);


-- ============ BLOCO 3: A CÓPIA. Selecione desde START TRANSACTION até o SELECT final e rode ============
-- Se o resultado do SELECT final estiver certo, rode COMMIT; (BLOCO 4). Se não, rode ROLLBACK; e nada fica gravado.
START TRANSACTION;

INSERT IGNORE INTO web_notas_fiscais
  (tipo, numero, serie, data_emissao, contraparte_codigo, contraparte_nome, valor_total, observacao, situacao, criado_por, criado_em)
SELECT 'entrada', x.numero, '1', x.data_emissao, COALESCE(f.codigo, 0),
       LEFT(COALESCE(f.nome, NULLIF(x.nome, ''), '(sem nome)'), 190),
       x.valor, NULL, 'ativa', 'importação do VB', NOW()
FROM (
  SELECT CASE WHEN TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^[0-9]+$' THEN TRIM(LEADING '0' FROM TRIM(CAST(n.NUMERO AS CHAR))) ELSE UPPER(TRIM(CAST(n.NUMERO AS CHAR))) END AS numero,
         DATE(n.DATA) AS data_emissao,
         TRIM(n.RAZAO_FABRICANTE) AS nome,
         ROUND(COALESCE(n.VALOR_TOTAL, 0), 2) AS valor
  FROM nf_entrada n
  WHERE TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^[0-9A-Za-z]{1,20}$' AND NOT TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^0+$'
    AND DATE(n.DATA) >= '1900-01-01'
    AND COALESCE(n.VALOR_TOTAL, 0) BETWEEN 0 AND 999999999999.99
) x
LEFT JOIN (
  SELECT MIN(COD) AS codigo, MIN(TRIM(RAZAO_FABRICANTE)) AS nome
  FROM cadastro_fornecedores WHERE TRIM(RAZAO_FABRICANTE) <> '.' GROUP BY TRIM(RAZAO_FABRICANTE)
) f ON f.nome = x.nome
WHERE x.numero <> '';

INSERT IGNORE INTO web_notas_fiscais
  (tipo, numero, serie, data_emissao, contraparte_codigo, contraparte_nome, valor_total, observacao, situacao, criado_por, criado_em)
SELECT 'saida', x.numero, '1', x.data_emissao, COALESCE(c.codigo, 0),
       LEFT(COALESCE(c.nome, NULLIF(x.nome, ''), '(sem nome)'), 190),
       x.valor, NULL, 'ativa', 'importação do VB', NOW()
FROM (
  SELECT CASE WHEN TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^[0-9]+$' THEN TRIM(LEADING '0' FROM TRIM(CAST(n.NUMERO AS CHAR))) ELSE UPPER(TRIM(CAST(n.NUMERO AS CHAR))) END AS numero,
         DATE(n.DATA) AS data_emissao,
         TRIM(n.RAZAO_SOCIAL) AS nome,
         ROUND(COALESCE(n.VALOR, 0), 2) AS valor
  FROM nf_saida n
  WHERE TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^[0-9A-Za-z]{1,20}$' AND NOT TRIM(CAST(n.NUMERO AS CHAR)) REGEXP '^0+$'
    AND DATE(n.DATA) >= '1900-01-01'
    AND COALESCE(n.VALOR, 0) BETWEEN 0 AND 999999999999.99
) x
LEFT JOIN (
  SELECT MIN(CODIGO) AS codigo, MIN(TRIM(RAZAO_SOCIAL)) AS nome
  FROM cadastro_clientes GROUP BY TRIM(RAZAO_SOCIAL)
) c ON c.nome = x.nome
WHERE x.numero <> '';

-- conferência: quantas notas ficaram na tela nova (sem_cadastro = fornecedor/cliente não achado no cadastro)
SELECT tipo, COUNT(*) AS qtd, SUM(contraparte_codigo = 0) AS sem_cadastro, SUM(valor_total = 0) AS valor_zero
FROM web_notas_fiscais GROUP BY tipo;


-- ============ BLOCO 4: confirmar ou desfazer (rode UM dos dois) ============
COMMIT;
-- ROLLBACK;


-- ============ BLOCO 5 (opcional): notas copiadas cujo fornecedor/cliente não foi achado no cadastro ============
SELECT tipo, numero, contraparte_nome FROM web_notas_fiscais WHERE contraparte_codigo = 0 ORDER BY tipo, contraparte_nome, numero;


-- ============ BLOCO 6 (só para quem já rodou a versão antiga do bloco 3): limpa o texto "Importada do VB" das observações ============
-- Só mexe nas notas copiadas pelo script (criado_por = 'importação do VB') cuja observação ainda tem exatamente esse texto.
UPDATE web_notas_fiscais SET observacao = NULL
WHERE observacao = 'Importada do VB' AND criado_por = 'importação do VB';
