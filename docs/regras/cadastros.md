# Cadastros (fornecedores e funcionários)

_Movido do CLAUDE.md sem alteração; o CLAUDE.md guarda só o resumo._

### Cadastros (fornecedores e funcionários)
- **Tabelas do VB** (`cadastro_fornecedores`: COD, RAZAO_FABRICANTE, ..., CLASSE, CF_CV; `funcionarios`: CODIGO, NOME, CPF, CARGO, SALARIO_BASE, ..., SENHA, NIVEL, ADMISSAO, DEMISSAO). Códigos novos são AUTO_INCREMENT (o VB manda NULL/0). Regras tiradas de `frm_Cadastro_Fornecedores.vb` e `frm_Funcionários.vb`.
- **Fornecedor**: classe obrigatória (Matéria prima, Insumos, Serviços, Geral); situação Ativo/Inativo; a razão social não muda depois de criada (estoque, compras e `fluxo_de_caixa.RAZAO_FABRICANTE` usam o nome como chave) e não pode repetir; o registro `.` do VB não aparece; sem exclusão (inativar). Permissões `fornecedores.ver`/`fornecedores.editar` (Administrador e Interno completo).
- **Funcionário**: dados pessoais com `funcionarios.ver`/`funcionarios.editar` (**só Administrador** na migração); salário e encargos (SALARIO_BASE, FGTS, férias, 13º, almoço, transporte, plano, seguro, outros) só com `valores.ver` — sem ela a rota não devolve e, ao salvar, mantém o que está gravado (`preservarValores`). **SENHA, NIVEL e DARF do VB nunca saem nem são alterados pela web** (novo funcionário entra com SENHA vazia; NIVEL = cargo, como o VB). Como o VB, DEMISSAO sempre grava uma data (hoje se vazia); a tela só mostra para quem está Demitido. A auditoria (`funcionario_criado/alterado`) guarda só os nomes dos campos alterados, nunca CPF nem valores. Sem exclusão (Inativo/Demitido).
- **Testes**: `test/cadastros_calculo.test.js`, `test/cadastros_rotas.test.js` (banco falso `test/apoio/bancoCadastros.js`), `test/cadastros_tela.test.js`.
