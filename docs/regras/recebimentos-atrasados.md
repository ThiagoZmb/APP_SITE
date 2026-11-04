# Recebimentos atrasados automáticos

_Movido do CLAUDE.md sem alteração; o CLAUDE.md guarda só o resumo._

### Recebimentos atrasados automáticos
- `rotas/recebimentos_atrasados.js`: um único `UPDATE fluxo_de_caixa SET SITUACAO = 'Atrasado'` (em transação) para **entradas** (cliente preenchido e fornecedor vazio, como a Gestão) com `SITUACAO = 'A Receber'` e `DATA` < hoje (Brasília). **É escrita em tabela do VB.** Saídas, A Pagar, Recebido, Pago, Protestado etc. nunca mudam; é idempotente.
- Dispara na subida do servidor (nunca em `NODE_ENV=test`) e no login de funcionário bem-sucedido, sem `await`, no máximo 1x por hora por processo (memória); falha só vai ao log e não afeta o login. Grava `web_auditoria` `recebimentos_atrasados_marcados` só com a contagem, e só quando > 0. Testes: `test/recebimentos_atrasados.test.js`.
