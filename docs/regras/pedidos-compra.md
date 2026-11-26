# Pedidos a fornecedor

Aba "Pedidos a fornecedor" do Estoque (`pedidos_compra.html/.js`). Desenho aprovado: `docs/superpowers/specs/2026-11-26-pedidos-compra-design.md`.

## Arquivos
- `calculo/pedidos_compra.js` — regras puras (sugestão, caixas, baixa, situações, validação).
- `rotas/pedidos_compra.js` — rotas `/pedidos_compra*`.
- `rotas/pedidos_compra_banco.js` — SQL usado também pela entrada de estoque e por `GET /estoque`.
- `pdf/pedido_compra.js` — PDF A4, sem preços.
- Tabelas: `web_pedidos_compra`, `web_pedidos_compra_itens`, `web_pedidos_compra_baixas`.

## Regras
- **Permissões:** `compras.ver` (ver, sugestão, PDF) e `compras.criar` (gravar), sempre com `estoque.ver`. Não são administrativas: quem monta o pedido vê os dias de cobertura. Migração `permissoes_compras`: quem tem `estoque.editar` ganha as duas.
- **Sem dinheiro.** Nomes de campo JSON não podem casar com `REGEX_VALOR` (use `chegou`, `falta`).
- **Sugestão** (só itens ativos do fornecedor do cadastro do item): mínimo > 0 e estoque ≤ mínimo; ou alerta `comprar` das análises (janela 90 dias); ou zerado com saída nos últimos 12 meses. Quantidade = maior entre `mínimo − estoque` e `consumo/dia × (prazo + 30) − estoque` (consumo só com 30 dias de histórico), menos o a caminho, em caixas inteiras. Item em rascunho ou marcado `Aguardando` sem pedido na web aparece desmarcado, com aviso.
- **Caixas:** o pedido guarda unidades do estoque e `por_caixa`. Valor inicial: último pedido não cancelado do fornecedor; senão o `fator` inteiro > 1 de `web_estoque_ligacoes`; senão 1.
- **Situações:** `rascunho` → `enviado` → `parcial` ("Chegou em parte") → `recebido`; `encerrado` (de enviado ou parcial) e `cancelado` (só enviado sem nada chegado). Só o rascunho é editado ou excluído.
- **Chegada:** `POST /estoque/entrada` abate, na mesma transação, os pedidos `enviado`/`parcial` do mesmo fornecedor criados até a data da nota, do mais antigo ao mais novo; o excedente é ignorado. Desfazer a entrada apaga o que a nota abateu e recalcula (encerrado e cancelado não mudam). Quem dá entrada não precisa de `compras.*`. Nota lançada antes de marcar o pedido como enviado não é abatida: use "Encerrar".
- **`estoque.AGUARDANDO`** (tabela antiga, única escrita fora de `web_*`): `'Aguardando'` enquanto houver material a caminho, `''` quando deixa de haver.
- **Travas:** sempre as linhas de `estoque` antes das do pedido; leituras que decidem gravação usam `FOR UPDATE`.

## Fora do escopo
E-mail pelo sistema, preços, cotação, importar os pedidos antigos do VB.
