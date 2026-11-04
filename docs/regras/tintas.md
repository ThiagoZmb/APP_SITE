# Tintas (tabela do VB `tintas`)

_Movido do CLAUDE.md sem alteração; o CLAUDE.md guarda só o resumo._

### Tintas (tabela do VB `tintas`)
- **Colunas** (`COD, RAZAO_FABRICANTE, CLASSE, VALOR, PORCENTAGEM, REF_FABRICANTE, COR_ELEGANCE, TIPO, CONJUNTO, COR, RENDIMENTO`). Regras tiradas de `frm_Cadastro_Tintas.vb`; a web não cria nem altera a tabela. Código novo = `MAX(COD)+1` (gravado explicitamente, como o VB); se o formulário do VB estiver aberto com o mesmo código, o VB faz UPDATE e sobrescreve a tinta criada pela web. **RENDIMENTO é texto no VB e grava com vírgula** (`"0,5"`): a web lê aceitando vírgula e grava com vírgula (esquema real conferido: `COD` int PK sem auto-incremento, textos varchar(190), `VALOR` double, `PORCENTAGEM` int — por isso a web só aceita % inteira —, collation utf8mb4_unicode_ci, sem FK, só índice em `RAZAO_FABRICANTE`).
- **Obrigatórios**: fabricante (precisa existir em `cadastro_fornecedores`), classe, tipo, conjunto (listas fixas do VB em `calculo/tintas.js`), valor e % da mistura (0 a 100). Cor obrigatória, exceto na classe Tinta, que sem cor grava `FF000000` (o VB grava preto). Cor = ARGB de 8 dígitos hexadecimais maiúsculos (`Hex(c.ToArgb)` do VB); a tela converte de/para `#rrggbb`.
- **Referência do fabricante** não repete (409, sem diferenciar caixa nem espaços das pontas): outras telas do VB buscam a tinta por ela.
- **Valor** é dinheiro: sem `valores.ver` a rota não devolve e, ao salvar, mantém o valor gravado (cadastro novo entra com 0). Vírgula ou ponto decimal; `1.234,56` é recusado.
- **Exclusão** permitida (como no VB) com `tintas.editar`, auditada (`tinta_excluida`). Auditoria guarda só nomes de campos. Permissões `tintas.ver`/`tintas.editar` (Administrador e Interno completo).
- **Fora do escopo**: `frm_Calculo_Tintas` e `frm_Centro_Custo` (cálculo de tinta e centro de custo) ainda não existem na web.
- **Testes**: `test/tintas_calculo.test.js`, `test/tintas_rotas.test.js` (banco falso `test/apoio/bancoTintas.js`), `test/tintas_tela.test.js`.
