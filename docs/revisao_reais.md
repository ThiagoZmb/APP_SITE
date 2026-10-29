# Revisão: "R$" em todo valor em dinheiro exibido

Regra: valor em dinheiro exibido ao usuário sai como `R$ 1.234,56` (prefixo, milhar com ponto, vírgula decimal).
Revisão feita em todos os `*.html` e `*.js` da raiz (busca por `toLocaleString`, `toFixed`, `Intl`, `replace('.', ',')`, campos de valor em templates, tooltips e eixos de gráficos).

## Corrigido

| Arquivo | Antes | Depois |
|---|---|---|
| `notas_fiscais.js` | coluna Valor da lista: `1.234,56` (sem R$) | `moeda()` local (Intl BRL): `R$ 1.234,56`; `moeda` exportado para teste |
| `tintas.js` | coluna Valor da lista: `1.234,56` (sem R$) | idem |

## Já estava correto (conferido, sem alteração)

Todos usam helper próprio com `Intl` `currency: 'BRL'` (ou prefixo `'R$ '`), inclusive tooltips, eixos e rótulos de gráficos:
`financeiro.html`, `clientes.html`, `cliente_analise.html` (`moedaK` compacto: "R$ 1,5 mil"), `estoque.html`, `inicio.html` (`moedaCurta`), `produtos.html`, `movimentacao_estoque.html`, `painel_inicial.html`, `custos.html` + `custos_precos.js` (usam o `moeda` da página), `gestao.js`, `orcamentos.html` (`formatCurrency`, incluindo diferença do valor alterado e totais), `ranking.js` (recebe `formatar: moeda` de cada tela).
Textos de ajuda de `custos_precos.js` já escrevem "R$ 90", "R$ 125,00" etc.

## Deliberadamente não alterado

- **Campos de digitação** (`<input>`): `funcionarios.html` (rótulos já dizem "(R$)", `type=number`), `gestao.html` (rótulos "(R$)"), campos `.moeda` de estoque/produtos/financeiro (já mostram `R$ 0,00`), `orcamentos.html` `toFixed(2)` que preenche inputs (`f-total-item`, `avl-unit`, `f-valor`): são valor de edição, não exibição.
- **`painel_inicial.html:667`** (`textoBusca`): texto escondido usado só para pesquisar pelo valor no formato da tela; não é exibido.
- **Não são dinheiro**: quantidades, kg (`peso_tela.js`, `pesos.js`), mm (`corte*.js`), %, pesos, números de pedido/código, datas, tamanhos de arquivo (`desenhos.js`, `leitura_pdf.js`).
- **`leitura_pdf.js` / `orcamentos.html` (conferência de PDF)**: `valor` ali é o valor lido de uma cota (medida), não dinheiro.
- **`entregas*.js`, `minhas_entregas.js`, `fornecedores.js`, `usuarios.html`, `graficos_pedidos.html`, `importar_itens.js`**: não exibem dinheiro (entregas e fornecedores nem recebem esses campos).
- **PDF (`pdf/`), rotas e servidor**: fora do escopo (o PDF já usa `R$` via `moedaBR`; mensagens do servidor já usam `R$`).
- **`layout.js`**: não tocado.
- Helper compartilhado: o projeto já repete um `moeda` por página (sem build/módulo comum); mantive o padrão em vez de mexer em `layout.js`. Os dois novos (`notas_fiscais.js`, `tintas.js`) seguem o mesmo `Intl` BRL.

Teste: `test/reais_formato.test.js`.
