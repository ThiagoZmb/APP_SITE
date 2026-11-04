# Renomear cliente e nomes duplicados

_Movido do CLAUDE.md sem alteração; o CLAUDE.md guarda só o resumo._

### Renomear cliente e nomes duplicados
- `ped_orc` e `fluxo_de_caixa` só guardam a razão social, então a ligação cliente-pedido/caixa é **por nome** (`JOIN_CLIENTE`). `POST /clientes/salvar` que **muda** a razão social (igualdade estrita após trim, contra o nome gravado) de um cadastro com pedido ou lançamento no nome antigo responde `409 { codigo: 'renomear_confirmar' }` e não grava, salvo `confirmarRenomear: true` no corpo (só o booleano; `'true'`/`1` não valem). Sem histórico renomeia direto; cadastro novo nunca pergunta. A tela pede confirmação e reenvia. Auditoria `cliente_renomeado` (alvo = código, detalhe nulo; nunca os nomes). Os pedidos antigos continuam no nome antigo.
- `GET /clientes/nomes_duplicados` (`clientes.editar`): `{ duplicados: [{ razaoSocial, qtdCadastros, codigos }] }` por `GROUP BY RAZAO_SOCIAL HAVING COUNT(*) > 1` (mesma comparação do banco). Com estados restritos só aparecem grupos com 2+ cadastros nos estados do usuário, com apenas esses códigos. **A etapa 2 (portal da empresa) só libera uma empresa que não esteja neste relatório.** Testes: `test/seguranca_clientes_nome.test.js`.
