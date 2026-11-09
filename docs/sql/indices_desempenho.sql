-- ============================================================================
-- Índices de desempenho — PROPOSTA (nada aqui foi executado; só o dono roda, no MySQL Workbench).
-- Banco: thia1272_db_elegance (MySQL 5.7.44). Diagnóstico feito em 2026-11-09 só com SELECT/EXPLAIN.
--
-- POR QUE: as 6 tabelas de itens de pedido do VB (ped_orc_lista_itens, ped_orc_itens_v4, ped_orc_serralheria,
-- ped_orc_complementos, furacao_pedidos_orcamentos e, em parte, ped_orc) não têm índice por número do pedido.
-- Toda consulta "itens do pedido 23401" lê a tabela inteira (EXPLAIN: type=ALL, rows = a tabela toda).
-- A tabela nova ped_orc_serralheria_complementos já tem idx_numero_tipo (NUMERO, TIPO): é o mesmo padrão.
--
-- MEDIDO ANTES (do PC do dono, RTT de 26 ms até o banco; "acima do RTT" = trabalho do servidor + transferência):
--   itens do pedido (lista_itens)        ALL 22.813 linhas  +7 ms
--   itens_v4 / serralheria               ALL 10.8 mil linhas +5 ms / +7 ms
--   etapas: lista_itens IN (6 pedidos)   ALL 22.813 linhas  +10 ms
--   entregas: subselect qtd_itens        ALL 22.813 x 14 vezes  +103 ms   <- o pior caso encontrado
--   ped_orc por SITUACAO                 ALL 10.8 mil       +7 ms ; fluxo_de_caixa por DATA  ALL 8.2 mil  +3 ms
--
-- SEGURANÇA: índice novo não muda dados nem o que o VB lê/grava; o VB continua igual. Em InnoDB 5.7,
-- ADD INDEX com ALGORITHM=INPLACE, LOCK=NONE roda sem travar escrita (tabelas de até 23 mil linhas: segundos).
-- Faça fora do horário de uso mesmo assim. Cada ALTER é independente: se um falhar, os outros seguem.
-- ESPAÇO: todos juntos ocupam menos de 3 MB.
-- ============================================================================

USE thia1272_db_elegance;

-- ---- 1) Itens do pedido: lookup por (NUMERO, TIPO) — o padrão de idx_numero_tipo da tabela serralheria_complementos ----
ALTER TABLE ped_orc_lista_itens          ADD INDEX ix_pedido (NUMERO, TIPO, ITEM),              ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE ped_orc_itens_v4             ADD INDEX ix_pedido (NUMERO, TIPO, ITEM_PEDIDO, ITEM), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE ped_orc_serralheria          ADD INDEX ix_pedido (NUMERO, TIPO, ITEM_PEDIDO),       ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE ped_orc_complementos         ADD INDEX ix_pedido (NUMERO, TIPO, ITEM_PEDIDO),       ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE furacao_pedidos_orcamentos   ADD INDEX ix_pedido (NUMERO, TIPO, ITEM),              ALGORITHM=INPLACE, LOCK=NONE;
-- (ped_orc_itens, a versão antiga de itens_v4, não é lida por nenhuma consulta da web: fica de fora.)

-- ---- 2) Lista/fila de pedidos (ped_orc): filtro por tipo+situação e calendário por data de pronto ----
-- Ganho pequeno hoje (10 mil linhas, ~6 ms), mas cresce com o histórico. SITUACAO é varchar(190): índice por prefixo.
ALTER TABLE ped_orc ADD INDEX ix_tipo_situacao (TIPO, SITUACAO(30), NUMERO), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE ped_orc ADD INDEX ix_tipo_pronto   (TIPO, DATA_PRONTO),          ALGORITHM=INPLACE, LOCK=NONE;

-- ---- 3) Fluxo de caixa: filtros por mês (DATA) e por situação (A Receber / Atrasado), inclusive o marcador de atrasados ----
ALTER TABLE fluxo_de_caixa ADD INDEX ix_data          (DATA),                ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE fluxo_de_caixa ADD INDEX ix_situacao_data (SITUACAO(30), DATA),  ALGORITHM=INPLACE, LOCK=NONE;

-- ============================================================================
-- CONFERIR (cada linha deve mostrar key = o índice novo, e rows pequeno em vez de 10.000+):
-- ============================================================================
-- EXPLAIN SELECT * FROM ped_orc_lista_itens WHERE NUMERO = 23401 AND TIPO = 'Pedido' ORDER BY CAST(ITEM AS UNSIGNED);
-- EXPLAIN SELECT * FROM ped_orc_itens_v4    WHERE NUMERO = 23401 AND TIPO = 'Pedido';
-- EXPLAIN SELECT * FROM ped_orc_serralheria WHERE NUMERO = 23401 AND TIPO = 'Pedido';
-- EXPLAIN SELECT e.id, (SELECT COUNT(*) FROM ped_orc_lista_itens i WHERE i.TIPO='Pedido' AND i.NUMERO=e.numero) FROM web_entregas e;
-- EXPLAIN SELECT NUMERO, SITUACAO FROM ped_orc WHERE TIPO='Pedido' AND SITUACAO IN ('Em Produção','Pronto') ORDER BY NUMERO DESC;
-- EXPLAIN SELECT * FROM fluxo_de_caixa WHERE DATA >= '2026-11-01' AND DATA < '2026-12-01';
-- EXPLAIN SELECT COUNT(*) FROM fluxo_de_caixa WHERE SITUACAO = 'A Receber' AND DATA < CURDATE();

-- ============================================================================
-- DESFAZER (se algo estranho aparecer; o VB não depende de nenhum destes índices):
-- ============================================================================
-- ALTER TABLE ped_orc_lista_itens        DROP INDEX ix_pedido;
-- ALTER TABLE ped_orc_itens_v4           DROP INDEX ix_pedido;
-- ALTER TABLE ped_orc_serralheria        DROP INDEX ix_pedido;
-- ALTER TABLE ped_orc_complementos       DROP INDEX ix_pedido;
-- ALTER TABLE furacao_pedidos_orcamentos DROP INDEX ix_pedido;
-- ALTER TABLE ped_orc        DROP INDEX ix_tipo_situacao, DROP INDEX ix_tipo_pronto;
-- ALTER TABLE fluxo_de_caixa DROP INDEX ix_data, DROP INDEX ix_situacao_data;
