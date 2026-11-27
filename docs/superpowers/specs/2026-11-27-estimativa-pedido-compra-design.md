# Estimativa de valor no pedido a fornecedor (desenho curto, aprovado)

**Intenção:** ver, ao montar o pedido, quanto ele deve custar.

**Objetivos**
- Por item: último preço de compra (com a data) e estimativa = unidades (quantidade × un. por caixa) × último preço.
- Total do pedido; "parcial: N itens sem preço" quando faltar preço. Recalcula ao digitar.
- Aparece no pedido novo, no rascunho e no detalhe do pedido salvo, sempre com o preço de hoje.

**Não objetivos:** gravar preço no banco; somar IPI ou frete; preço no PDF.

**Restrições**
- Só com `administrativo.ver` (custo de compra), na rota e na tela. Sem ela, o servidor não envia o dinheiro.
- Preço ausente é "—", nunca zero.
- Total sempre visível (fora do olho dos resumos).
- O PDF do fornecedor continua sem preços.
- Atualizar a regra "sem dinheiro" em `docs/regras/pedidos-compra.md` e o resumo no `CLAUDE.md`.

**Abordagens**
- Última compra em `entrada_estoque` (escolhida): mais próxima do preço atual. Mesmo fornecedor primeiro; senão, a compra mais recente de qualquer um. Ligação por `NOME_PRODUTO`.
- Valor do cadastro (`estoque.VALOR`): mais simples, pode estar desatualizado.
- Média da tela de Custos: descartada, está em unidade de venda.

**A critério de quem implementa:** forma da consulta (uma só, em lote), nomes dos campos (cobertos por `redeDeValores`), layout das colunas seguindo `DESIGN.md`.
