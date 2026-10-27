# Cadastro de tintas (web) — design

## Objetivo
Levar para a web o `frm_Cadastro_Tintas` do VB, lendo e gravando a mesma tabela `tintas`. Mesmo padrão de fornecedores/funcionários. Fora do escopo: `frm_Calculo_Tintas` e `frm_Centro_Custo`.

## Tabela do VB `tintas`
Colunas: `COD`, `RAZAO_FABRICANTE`, `CLASSE`, `VALOR`, `PORCENTAGEM`, `REF_FABRICANTE`, `COR_ELEGANCE`, `TIPO`, `CONJUNTO`, `COR`, `RENDIMENTO`. A web não cria nem altera a tabela. O esquema real (tipos de `PORCENTAGEM`, `RENDIMENTO`, `COR`) não foi visto: gravar como o VB grava e conferir no primeiro teste com banco real.

## 1. Regras (`calculo/tintas.js`, funções puras)
- Obrigatórios: fabricante, classe, tipo, conjunto, valor, % da mistura.
- % da mistura entre 0 e 100.
- Cor obrigatória, exceto quando a classe é Tinta.
- Valor, % e rendimento aceitam vírgula decimal; rendimento vazio vale 0.
- Listas fixas (as do VB, no mesmo lugar) devolvidas à tela:
  - Classe: Tinta, Catalisador, Aderente, Verniz, Diluente, Retardador.
  - Tipo: as 19 opções do `cmb_Tipo`.
  - Conjunto: as 9 opções do `cmb_Conjunto`.
- Cor gravada em hexadecimal ARGB (`Hex(c.ToArgb)` do VB), ex.: `FF1A2B3C`; a tela converte de/para `#RRGGBB`.

## 2. Rotas (`rotas/tintas.js`, via `registro.rota`)
- `GET /tintas?busca=&classe=`: lista; busca por `REF_FABRICANTE` ou `COR_ELEGANCE`.
- `GET /tintas/:codigo`: registro completo.
- `POST /tintas/salvar`: sem `codigo` cria, com `codigo` atualiza; em transação (`rotas/transacao.js`); código novo = MAX+1 com `FOR UPDATE`.
- `DELETE /tintas/:codigo`: exclui, audita `tinta_excluida`.
- `REF_FABRICANTE` não pode repetir (409): outras telas do VB buscam a tinta por referência.
- Fabricante precisa existir em `cadastro_fornecedores` (o registro `.` não conta).
- Auditoria (`tinta_criada/alterada/excluida`): só nomes dos campos alterados, nunca valores.
- Permissões novas em `seguranca/permissoes.js`: `tintas.ver`, `tintas.editar` (Administrador e Interno completo na migração).
- `VALOR` é dinheiro: sem `valores.ver` a rota não devolve e, ao salvar, mantém o valor gravado (`preservarValores`). Nomes de campo na resposta respeitam a `redeDeValores`; contagens usam `qtd*`.

## 3. Tela (`tintas.html` + `tintas.js`)
- Lista com busca e filtro de classe; bolinha da cor em cada linha.
- Formulário no estilo de fornecedores, com `<input type="color">`. A barra de mistura do VB é só visual e não entra.
- Item "Tintas" no menu (`layout.js`), sob Estoque, junto de "Custos e preços".
- CSP em cada página, como nas demais.

## 4. Testes (`node:test`, sem MySQL)
- `test/tintas_calculo.test.js`: validação, vírgula decimal, conversão de cor.
- `test/tintas_rotas.test.js` com banco falso (`test/apoio/bancoTintas.js`): criar, atualizar, excluir, referência duplicada, fabricante inexistente, sem `valores.ver`.
- `test/tintas_tela.test.js` no padrão das telas existentes.
- O app deve subir com `registro.verificar()`.

## Também atualizar
- `CLAUDE.md`: seção "Cadastros" (tintas), lista de pastas e testes.
