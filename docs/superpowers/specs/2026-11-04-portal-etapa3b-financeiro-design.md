# Portal do cliente, etapa 3b: financeiro (design)

Data: 2026-11-04. Parte da etapa 3 do spec `2026-11-03-portal-do-cliente-seguranca-design.md` (seção 7). A 3a (pedidos e status, `2026-11-04-portal-etapa3a-pedidos-design.md`) já está na main; esta etapa reaproveita o isolamento por empresa dela. Falta depois a 3c (PDF e DANFE).

## 1. Objetivo e decisões

O cliente logado no portal, com a permissão `financeiro.ver`, vê os títulos a receber e os já pagos da própria empresa, com um resumo do que está em aberto e do que está em atraso.

Decisões do dono (04/11/2026):
- **Fonte única: os lançamentos de `fluxo_de_caixa` do cliente, mais um resumo calculado só deles.** Sem crédito, sem saldo devedor, sem observação interna e sem somar pedidos em aberto à parte (a tela interna mistura `fluxo_de_caixa` e `ped_orc`, o que corre o risco de contar duas vezes).
- Só leitura. Nenhuma escrita em tabela do VB.

Decisões minhas, a confirmar na revisão (2 e 3 foram apresentadas e aprovadas pelo "continue"): (1) permissão `financeiro.ver` (o administrador geral já a tem; a etapa 4 a distribui); (2) "Em atraso" calculado na hora; (3) rótulos da seção 5.

## 2. Abordagem

Rotas dedicadas do portal, com SQL próprio e lista fechada de campos, como na 3a. Descartado reaproveitar `/clientes/financeiro/:codigo` (carrega `OBSERVACAO_GERAL`, `ID`, crédito, saldo devedor, pedidos com `TOTAL`, e filtra só por razão social).

## 3. Rota

`registro.portal('get', '/portal/api/financeiro', ['financeiro.ver'], handler)`, nas listas fixas de `registro.rotasPortal()`.

- Parâmetros: `visao` = `abertos` (padrão, se ausente) ou `pagos`; qualquer outro valor, inclusive repetido (array), = 400. `pagina` como na 3a (`paginaValida`, teto `PAGINA_MAXIMA = 100000`, 50 por página, busca 51 para `temMais`).
- Resposta: `{ resumo: { aReceber: number, emAtraso: number }, titulos: Titulo[], visao, pagina, temMais }`.
- O `resumo` vem nas duas visões (é sempre dos títulos em aberto, não da visão pedida). Valores como número com 2 casas (arredondados, nunca string do banco).

## 4. Isolamento e consulta

A empresa vem **só** de `req.portal.empresaCodigo` (sessão). Consulta de títulos:

```sql
FROM fluxo_de_caixa f
JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = f.RAZAO_SOCIAL
WHERE c.CODIGO = ?
  AND COALESCE(f.RAZAO_FABRICANTE, '') = ''
  AND f.SITUACAO IN (...)
```

- `RAZAO_FABRICANTE` vazio = **entrada** (mesmo critério de `rotas/recebimentos_atrasados.js` e `rotas/gestao.js`): lançamento com fornecedor preenchido é pagamento a fornecedor e nunca aparece, mesmo que a empresa seja também fornecedora.
- `abertos`: `f.SITUACAO IN ('A Receber','Atrasado','Protestado')`, `ORDER BY f.DATA ASC, f.ID ASC`.
- `pagos`: `f.SITUACAO = 'Recebido' AND f.DATA >= ?` (hoje em Brasília menos 12 meses, calculado em JS com `hojeLocal()`), `ORDER BY f.DATA DESC, f.ID DESC`. O mesmo corte de 12 meses da tela interna.
- Qualquer outra situação (cancelado etc.) nunca é selecionada.
- Resumo: uma consulta à parte, mesma ligação e mesmo filtro de entrada, só com as três situações em aberto:
  `SELECT COALESCE(SUM(f.VALOR),0) AS A_RECEBER, COALESCE(SUM(IF(f.SITUACAO IN ('Atrasado','Protestado') OR f.DATA < ?, f.VALOR, 0)),0) AS EM_ATRASO ...`
  O `?` do atraso é a data de hoje (Brasília). Mesma regra de atraso da projeção do título (seção 5).
- `ORDER BY` com desempate por `ID` (sem expor o `ID`) mantém a paginação estável.

## 5. Lista fechada de campos

Cada título, exatamente estas chaves: `vencimento`, `pedido`, `notaFiscal`, `valor`, `situacao`.

| chave | origem | observação |
|---|---|---|
| `vencimento` | `f.DATA` | `YYYY-MM-DD` |
| `pedido` | `f.PEDIDO` | número ou `null` se vazio |
| `notaFiscal` | `f.NOTA_FISCAL` | texto ou `null` se vazio |
| `valor` | `f.VALOR` | número, 2 casas |
| `situacao` | `f.SITUACAO` + data | rótulo abaixo |

**Nunca selecionados:** `ID`, `OBSERVACAO_GERAL`, `RAZAO_FABRICANTE`, `RAZAO_SOCIAL`, categorias, formas de pagamento, `cadastro_clientes.CREDITO`, `ped_orc.TOTAL`. As chaves `valor` e `vencimento` são do cliente sobre os próprios dados; a rede de valores (`seguranca/valores.js`) não se aplica ao portal (spec geral, seção 7), a lista fechada sim.

**Rótulos** (`calculo/portal_financeiro.js`):
- `A Receber` com `DATA` ≥ hoje → "A receber"; **`A Receber` com `DATA` < hoje → "Em atraso"** (calculado na hora: a marcação automática do VB só roda na subida e no login, no máximo 1 vez por hora, então o cliente poderia ver "A receber" para algo vencido).
- `Atrasado` → "Em atraso"; `Protestado` → "Protestado"; `Recebido` → "Pago".
- Qualquer outro valor que escape da SQL → o título é descartado pela projeção (nunca mostra texto interno).

## 6. Auditoria (LGPD, spec geral seção 9)

Cada requisição bem-sucedida grava `auditarPortal(pool, { evento: 'financeiro_visto', usuarioId, clienteCodigo, ip, detalhe })` com o detalhe só `visao=abertos|pagos` e a página. Nunca valores, títulos nem nomes. Falha de gravação não derruba a resposta (`auditarPortal` não lança). Retenção: os 12 meses que `limparPortal` já aplica a `web_portal_auditoria`. A lista de eventos documentada em `docs/regras/portal-identidade.md` ganha `financeiro_visto`.

## 7. Arquivos

- `calculo/portal_financeiro.js`: puras. `projetarTitulo(linha, hoje) -> Titulo|null`, `visaoValida(valor) -> 'abertos'|'pagos'|null`, `dinheiro(valor) -> number` (arredonda a 2 casas; aceita string do banco), reaproveita `paginaValida` e `TAMANHO_PAGINA` de `calculo/portal_pedidos.js`.
- `rotas/portal_financeiro.js`: a rota, SQL como constantes com colunas escritas à mão, `registrarPortalFinanceiro({ portal, pool, agora })`. Erro de banco: 500 `{ error: 'Erro de servidor' }`, log só com `err.code`.
- Registro em `index.js` ao lado de `registrarPortalPedidos`.
- `portal/public/financeiro.html` e `financeiro.js` (sem inline, `textContent`, `PortalApi.chamar`, 401 volta ao login, abas "Em aberto" e "Pagos", resumo no topo, paginação). Link em `inicio.html`/`inicio.js` **só se `usuario.permissoes` (de `/portal/api/eu`) contém `financeiro.ver`**. A permissão continua conferida no servidor; o link escondido é só conveniência.
- Documentação: `docs/regras/portal-identidade.md` (seção "Etapa 3b"), `CLAUDE.md` (resumo e seção 2), `docs/portal_configuracao.md` (passo no roteiro de MySQL real: collation do JOIN `fluxo_de_caixa.RAZAO_SOCIAL` x `cadastro_clientes.RAZAO_SOCIAL`, tipo real de `DATA` e de `VALOR`, tempo do JOIN).

## 8. Erros

401 e 503 pelos guardas do portal. 403 sem `financeiro.ver`. 400 `visao` ou `pagina` inválida (sem consultar o banco). 500 genérico.

## 9. Testes (node:test, banco falso)

- Duas empresas, lançamentos de cada uma: cada uma vê só os seus (abertos, pagos e resumo), contagem > 0.
- **Lançamento com `RAZAO_FABRICANTE` preenchido nunca aparece**, nem na lista nem no resumo, mesmo com `RAZAO_SOCIAL` da empresa.
- Situações fora da lista (por exemplo `Cancelado`) nunca aparecem nem entram no resumo.
- Chaves de cada título exatamente iguais à lista; SQL sem `ID`, `OBSERVACAO_GERAL`, `RAZAO_FABRICANTE` no SELECT, `CREDITO`, `TOTAL`; serialização da resposta sem os textos sentinela de campos proibidos.
- Rótulos e regra de atraso na fronteira: `A Receber` com vencimento igual a hoje = "A receber", ontem = "Em atraso"; `Atrasado` e `Protestado`; `Recebido` = "Pago".
- Resumo: `aReceber` soma as três situações em aberto, `emAtraso` soma só o vencido; confere contra os mesmos dados da lista; valor vindo como string do banco sai como número com 2 casas.
- `pagos` respeita o corte de 12 meses (um lançamento de 13 meses atrás não aparece; um de 11 aparece).
- Paginação: 50 por página, `temMais`, `pagina` e `visao` inválidas = 400 sem consulta (inclusive `visao=abertos&visao=pagos`).
- **Prova de mutação do isolamento** (mesmo desenho da 3a: pool falso decide pelo texto `c.CODIGO = ?`, teste troca por `1 = 1` e exige o vazamento) e `assert.doesNotMatch(sql, /\bOR\b/i)`.
- A empresa vem da sessão: `?empresa=`, `?cliente=` e cabeçalhos não mudam `params[0]`.
- Permissão: sem cookie 401, JWT de funcionário 401, usuário sem `financeiro.ver` 403 (e sem consulta ao banco), empresa suspensa 401.
- Auditoria: uma linha `financeiro_visto` por requisição bem-sucedida, com usuário, empresa e IP, e nenhuma em 400/403/401; falha da gravação não muda a resposta 200.
- Tela: `financeiro.html`/`.js` sem inline e sem `innerHTML`; abas trocam a visão; falha ao trocar de aba ou de página restaura o estado anterior; link no início só com a permissão.
- `registro.rotasPortal()` inclui `get /portal/api/financeiro`; `registro.verificar()` passa; lista fixa de `test/portal_auth_rotas.test.js` atualizada.

## 10. Fora do escopo

Crédito e saldo devedor; pedidos em aberto sem lançamento; boleto, segunda via e instruções de pagamento; exportação; filtro por data ou por pedido; detalhe do título; qualquer escrita; PDF e DANFE (3c); criação de usuários da empresa (etapa 4).

## 11. Não testável aqui

Consulta contra MySQL real (collation do JOIN por razão social em `fluxo_de_caixa`, tipos reais de `DATA` e `VALOR`, tempo); página no navegador real. Entra no roteiro da seção 12 de `docs/portal_configuracao.md`.
