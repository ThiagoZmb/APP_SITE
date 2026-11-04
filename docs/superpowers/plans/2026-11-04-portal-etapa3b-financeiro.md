# Portal do cliente, etapa 3b: financeiro. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente logado no portal, com `financeiro.ver`, vê os títulos a receber e os pagos da própria empresa e um resumo (a receber, em atraso), só leitura e auditado.

**Architecture:** uma rota `GET /portal/api/financeiro` criada por `registro.portal(..., ['financeiro.ver'])`, com SQL próprio sobre `fluxo_de_caixa` ligado a `cadastro_clientes` por `c.CODIGO = ?` da sessão (mesmo desenho da 3a), mais uma consulta de resumo. Funções puras projetam o título, arredondam o dinheiro e calculam o atraso. Cada consulta bem-sucedida grava `financeiro_visto` em `web_portal_auditoria`. Tela HTML/JS puro em `portal/public/`.

**Tech Stack:** Node.js, Express 4, mysql2 (pool injetado), `node:test`, HTML/JS puro com CSP sem inline.

**Spec:** `docs/superpowers/specs/2026-11-04-portal-etapa3b-financeiro-design.md`. Referência de padrão: a 3a (`rotas/portal_pedidos.js`, `calculo/portal_pedidos.js`, `test/apoio/poolPedidosPortal.js`, `test/portal_pedidos_rotas.test.js`, `portal/public/pedidos.*`).

## Global Constraints

- Rota só por `registro.portal('get', '/portal/api/financeiro', ['financeiro.ver'], handler)`. Empresa só de `req.portal.empresaCodigo`; nenhum parâmetro, cabeçalho ou corpo escolhe empresa.
- Toda consulta (títulos e resumo) tem `c.CODIGO = ?`, `COALESCE(f.RAZAO_FABRICANTE, '') = ''` (só entradas), `f.DATA IS NOT NULL` e `f.VALOR IS NOT NULL`, e só as situações da visão. Situação fora de `A Receber`, `Atrasado`, `Protestado`, `Recebido` nunca é selecionada.
- Chaves de cada título, exatamente: `vencimento`, `pedido`, `notaFiscal`, `valor`, `situacao`. Nunca selecionados: `ID`, `OBSERVACAO_GERAL`, `RAZAO_FABRICANTE`, `RAZAO_SOCIAL`, `CREDITO`, `ped_orc.TOTAL`.
- Rótulos: `A Receber` com `DATA` ≥ hoje = "A receber"; `A Receber` com `DATA` < hoje = "Em atraso"; `Atrasado` = "Em atraso"; `Protestado` = "Protestado"; `Recebido` = "Pago". "Hoje" = `hojeLocal()` de `rotas/transacao.js` (Brasília).
- `visao` = `abertos` (padrão) ou `pagos`, qualquer outra coisa (inclusive repetida) = 400; `pagina` como na 3a (`paginaValida`, teto 100000, 50 por página, busca 51); 400 sem consultar o banco. `pagos`: só `Recebido` com `f.DATA >= ` hoje menos 12 meses.
- Resposta: `{ resumo: { aReceber, emAtraso }, titulos, visao, pagina, temMais }`; dinheiro como número com 2 casas (nunca string do banco). O resumo é sempre dos títulos em aberto.
- Auditoria: evento `financeiro_visto` por requisição 200, `detalhe` só `visao=<visao>;pagina=<n>`, nunca valores nem títulos; falha de gravação não muda a resposta.
- Erro de banco: 500 `{ error: 'Erro de servidor' }`, log só com `err.code`.
- Front: sem script nem estilo inline, texto por `textContent`, chamadas por `window.PortalApi.chamar`, 401 volta a `/portal/login.html`, falha ao trocar de aba ou página restaura o estado anterior.
- Testes de segurança desta base já tiveram teste vazio: todo teste de isolamento exige contagem > 0 e prova de mutação. Escrever arquivos só com Write/Edit, nunca heredoc de shell. Commits na main, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Cada tarefa vê o teste falhar antes de implementar.

## Review Focus

- Lançamento com `RAZAO_FABRICANTE` preenchido e `RAZAO_SOCIAL` da própria empresa: nunca na lista nem no resumo (Tarefa 2).
- Fronteira do atraso: `A Receber` com vencimento igual a hoje = "A receber", de ontem = "Em atraso", e o resumo `emAtraso` concorda com a lista (Tarefas 1 e 2).
- Lançamento com `VALOR` ou `DATA` nulos: some da lista **e** do resumo (a lista e o resumo nunca discordam) (Tarefa 2).
- Corte dos pagos: 12 meses exatos, inclusive virada de mês (`2027-03-31` menos 12 meses = `2026-03-31`; `2028-02-29` = `2027-02-28`) (Tarefa 1).
- Empresa sem nenhum lançamento: resumo `0` e `0`, lista vazia, `temMais: false`, 200 (Tarefa 2). Página além do fim: lista vazia, não erro.

---

### Task 1: Funções puras do financeiro

**Files:**
- Modify: `calculo/portal_pedidos.js` (exportar também `PAGINA_MAXIMA = 100000`), `rotas/portal_pedidos.js` (usar a constante exportada em vez da local)
- Create: `calculo/portal_financeiro.js`
- Test: `test/portal_financeiro_calculo.test.js`

**Interfaces:**
- Produces (`calculo/portal_financeiro.js`):
  - `visaoValida(valor) -> 'abertos'|'pagos'|null` (`undefined` = `'abertos'`; só essas duas strings exatas; array e demais = `null`).
  - `dinheiro(valor) -> number|null` (número ou string numérica do banco, arredondado a 2 casas; `null`, `''`, não numérico, `NaN`, `Infinity` = `null`).
  - `docesMesesAtras(hoje: 'AAAA-MM-DD') -> 'AAAA-MM-DD'` (mesmo dia 12 meses antes; se o dia não existir, o último dia do mês).
  - `projetarTitulo(linha, hoje: 'AAAA-MM-DD') -> { vencimento, pedido, notaFiscal, valor, situacao }|null`, com `linha` = `{ DATA, PEDIDO, NOTA_FISCAL, SITUACAO, VALOR }` (os `AS` que a rota usará); `null` se a situação não é uma das quatro, `DATA` não é `AAAA-MM-DD` ou `VALOR` não é dinheiro válido; `pedido` e `notaFiscal` viram `null` se vazios (`pedido` como número quando numérico).
  - `EM_ABERTO = ['A Receber', 'Atrasado', 'Protestado']`.
- Consumes: `paginaValida`, `TAMANHO_PAGINA`, `PAGINA_MAXIMA` de `calculo/portal_pedidos.js`.

- [ ] **Step 1: Write the failing test** em `test/portal_financeiro_calculo.test.js` (cabeçalho `process.env.JWT_SECRET='teste'` e `NODE_ENV='test'`):
  - `visaoValida`: `undefined`→`'abertos'`, `'abertos'`, `'pagos'`; `''`, `'Abertos'`, `'todos'`, `['abertos','pagos']`, `null`→`null`.
  - `dinheiro`: `'1234.5'`→`1234.5`, `'10.005'`→`10.01`, `0.1+0.2`→`0.3`, `'0'`→`0`, `'-5.20'`→`-5.2`; `null`, `''`, `'abc'`, `NaN`, `Infinity`→`null`.
  - `docesMesesAtras`: `'2027-03-31'`→`'2026-03-31'`, `'2028-02-29'`→`'2027-02-28'`, `'2026-11-04'`→`'2025-11-04'`, `'2026-01-01'`→`'2025-01-01'`.
  - `projetarTitulo` com `hoje='2026-11-04'`: `A Receber` em `2026-11-04`→`'A receber'`; em `2026-11-03`→`'Em atraso'`; `Atrasado`→`'Em atraso'` (mesmo com data futura); `Protestado`→`'Protestado'`; `Recebido`→`'Pago'`; `Recebido` com data futura continua `'Pago'`. Situação `'Cancelado'`, `null`, `'constructor'`→`null`. `DATA` `null`/`'04/11/2026'`→`null`; `VALOR` `null`/`'x'`→`null`. `PEDIDO` `''`/`null`→`pedido: null`, `'123'`→`123`; `NOTA_FISCAL` `''`→`null`, `'000123'`→`'000123'`.
  - **Chaves:** `Object.keys(projetarTitulo({...linha com ID, OBSERVACAO_GERAL, RAZAO_FABRICANTE, RAZAO_SOCIAL}, hoje)).sort()` é exatamente `['notaFiscal','pedido','situacao','valor','vencimento']`.
  - `PAGINA_MAXIMA` exportado de `calculo/portal_pedidos.js` vale `100000` e os testes de pedidos continuam passando.

- [ ] **Step 2: Run** `node --test test/portal_financeiro_calculo.test.js`. Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement** `calculo/portal_financeiro.js` (mapas `Object.freeze` com `hasOwnProperty`, objeto de saída montado chave a chave, nunca `{...linha}`), e exportar `PAGINA_MAXIMA` em `calculo/portal_pedidos.js`, trocando a constante local de `rotas/portal_pedidos.js` pelo import.

- [ ] **Step 4: Run** `node --test test/portal_financeiro_calculo.test.js test/portal_pedidos_calculo.test.js test/portal_pedidos_rotas.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(portal): funções puras do financeiro do cliente`.

### Task 2: Rota, isolamento, auditoria e registro

**Files:**
- Create: `rotas/portal_financeiro.js`, `test/apoio/poolFinanceiroPortal.js`
- Test: `test/portal_financeiro_rotas.test.js`
- Modify: `index.js` (require junto de `registrarPortalPedidos` e registro logo depois), `test/portal_auth_rotas.test.js` (lista exata de `rotasPortal()` do app real ganha `get /portal/api/financeiro`)

**Interfaces:**
- Consumes: Tarefa 1 (`visaoValida`, `dinheiro`, `docesMesesAtras`, `projetarTitulo`, `EM_ABERTO`); `paginaValida`, `TAMANHO_PAGINA`, `PAGINA_MAXIMA`; `hojeLocal` de `rotas/transacao.js`; `auditarPortal(pool, { evento, usuarioId, clienteCodigo, ip, detalhe })` de `portal/auditoria.js`; `req.portal` (`usuarioId`, `empresaCodigo`); `req.ip`.
- Produces: `registrarPortalFinanceiro({ portal, pool, hoje = hojeLocal }) -> void`. `criarPoolFinanceiro({ lancamentos, clientes }) -> pool` com `execute(sql, params)`, `chamadas[]` e `auditoria[]` (recebe o `INSERT INTO web_portal_auditoria` da `auditarPortal` e o guarda como `{ evento, usuario_id, cliente_codigo, ip, detalhe }`).

Detalhes que a consulta fixa (spec seção 4): títulos `SELECT DATE_FORMAT(f.DATA, '%Y-%m-%d') AS DATA, f.PEDIDO AS PEDIDO, f.NOTA_FISCAL AS NOTA_FISCAL, f.SITUACAO AS SITUACAO, f.VALOR AS VALOR FROM fluxo_de_caixa f JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = f.RAZAO_SOCIAL WHERE c.CODIGO = ? AND COALESCE(f.RAZAO_FABRICANTE, '') = '' AND f.DATA IS NOT NULL AND f.VALOR IS NOT NULL AND ...` com `f.SITUACAO IN ('A Receber','Atrasado','Protestado')` + `ORDER BY f.DATA ASC, f.ID ASC` (abertos) ou `f.SITUACAO = 'Recebido' AND f.DATA >= ?` + `ORDER BY f.DATA DESC, f.ID DESC` (pagos), `LIMIT 51 OFFSET n` interpolados (inteiros validados, padrão da 3a). Resumo: `SELECT COALESCE(SUM(f.VALOR),0) AS A_RECEBER, COALESCE(SUM(IF(f.SITUACAO IN ('Atrasado','Protestado') OR f.DATA < ?, f.VALOR, 0)),0) AS EM_ATRASO` com a mesma ligação e filtros e as três situações em aberto. O `ID` só aparece no `ORDER BY`, nunca no `SELECT`.

- [ ] **Step 1: Write the failing tests** em `test/portal_financeiro_rotas.test.js`, montando o app como `test/portal_pedidos_rotas.test.js` (registro real, `criarBancoPortal` para a sessão, `registrarPortalFinanceiro({ portal: registro.portal, pool: poolFinanceiro, hoje: () => '2026-11-04' })`). Dados: empresas 40 (ACME) e 41 (BETA); lançamentos de ACME: `A Receber` vencendo 2026-11-04 (R$ 100,00), `A Receber` de 2026-11-03 (R$ 200,50), `Atrasado` de 2026-10-01 (R$ 300,00), `Protestado` de 2026-09-01 (R$ 400,00), `Recebido` de 2026-06-10 (R$ 500,00), `Recebido` de 2025-10-01 (13 meses, fora do corte), `Cancelado` (R$ 999,00), um com `RAZAO_FABRICANTE` preenchido (R$ 888,00, `A Receber`), um com `VALOR` nulo e um com `DATA` nula; todos com `OBSERVACAO_GERAL`, `ID` e `RAZAO_FABRICANTE` preenchidos com textos sentinela; de BETA: dois lançamentos (R$ 77,00 `A Receber`, R$ 66,00 `Recebido`). Testes:
  1. `visao=abertos` de ACME: exatamente 4 títulos na ordem de vencimento (`2026-09-01`, `2026-10-01`, `2026-11-03`, `2026-11-04`) com situações "Protestado", "Em atraso", "Em atraso", "A receber"; nenhum de BETA, nenhum cancelado, nenhum com fornecedor, nulos ausentes.
  2. Resumo de ACME: `aReceber` = 1000.5 (100 + 200,50 + 300 + 400), `emAtraso` = 900.5 (200,50 + 300 + 400); igual nas duas visões; é o mesmo número que a soma dos títulos da lista `abertos`.
  3. `visao=pagos`: 1 título (`2026-06-10`, "Pago", 500), o de 13 meses ausente; o resumo continua o dos abertos.
  4. Cada título tem exatamente as 5 chaves; o corpo serializado não contém nenhum texto sentinela (`OBSERVACAO_GERAL`, fornecedor, ID) nem "999" nem "888"; contagens sempre > 0.
  5. SQL fixo: o SELECT de títulos e o de resumo contêm `c.CODIGO = ?`, `RAZAO_FABRICANTE` só dentro de `COALESCE(f.RAZAO_FABRICANTE, '') = ''`, e **não** casam `/OBSERVACAO|CREDITO|TOTAL|f\.ID\b.*AS|RAZAO_SOCIAL AS/i` na parte `SELECT`; `assert.doesNotMatch(sql, /\bOR\b/i)` nos SQL de títulos (o `OR` do resumo existe só dentro do `IF(...)`: conferir os dois separadamente); o primeiro parâmetro é 40 mesmo com `?empresa=41`, `?cliente=BETA`, `X-Empresa`, `X-Cliente`.
  6. Prova de mutação: um wrapper do pool troca `c.CODIGO = ?` por `1 = 1`; o pool falso aplica o filtro pelo texto do SQL; o teste exige que, mutado, a lista de ACME contenha o título de BETA (77) e que a asserção de isolamento rejeite; controle sem mutação passa.
  7. Empresa BETA vê só os seus (77 a receber, 66 pago). Uma empresa 42 sem lançamentos: 200 com `{ resumo: { aReceber: 0, emAtraso: 0 }, titulos: [], temMais: false }`. Página 2 além do fim: lista vazia, 200.
  8. Paginação: 51 lançamentos em aberto → página 1 com 50 e `temMais: true`, página 2 com 1; `pagina=0|-1|1.5|abc|100001`, `pagina=1&pagina=2`, `visao=todos`, `visao=abertos&visao=pagos`, `visao=` → 400 e `pool.chamadas` sem nova consulta.
  9. Auditoria: uma requisição 200 gera exatamente 1 linha `financeiro_visto` com `usuario_id`, `cliente_codigo` 40, `ip` e `detalhe` `visao=abertos;pagina=1`; o detalhe não contém valores; 400, 401 e 403 não geram linha; com o pool de auditoria lançando erro, a resposta continua 200.
  10. Permissão: sem cookie 401; JWT de funcionário no cookie 401; usuário sem `financeiro.ver` 403 e sem consulta ao banco; empresa suspensa 401.
  11. Erro de banco (`execute` lança `{ code: 'ER_X' }`): 500 `{ error: 'Erro de servidor' }` e o log só contém `ER_X`.
  12. `registro.rotasPortal()` contém `get /portal/api/financeiro` e `registro.verificar()` não lança.

- [ ] **Step 2: Run** `node --test test/portal_financeiro_rotas.test.js`. Expected: FAIL (`MODULE_NOT_FOUND` de `../rotas/portal_financeiro`).

- [ ] **Step 3: Implement** `test/apoio/poolFinanceiroPortal.js` (reconhece só as duas consultas de `fluxo_de_caixa` e o INSERT de auditoria; decide o filtro de empresa pelo texto `c.CODIGO = ?`, aplica fornecedor vazio, `IS NOT NULL`, situações, data de corte, ordem e `LIMIT/OFFSET`; devolve `VALOR` como string com 2 casas, como o banco) e `rotas/portal_financeiro.js` conforme a spec; `falhaInterna` no padrão da 3a. A auditoria usa o mesmo `pool` e roda **depois** da resposta ser montada (`await auditarPortal(...)` antes do `res.json`, sem lançar).

- [ ] **Step 4: Registrar em `index.js`:** `const { registrarPortalFinanceiro } = require('./rotas/portal_financeiro');` e `registrarPortalFinanceiro({ portal: registro.portal, pool });` logo após `registrarPortalPedidos`; atualizar a lista exata de `test/portal_auth_rotas.test.js` (a que enumera `rotasPortal()` do app real).

- [ ] **Step 5: Run** `node --test test/portal_financeiro_rotas.test.js` e depois `npm test`. Expected: tudo PASS (inclusive `test/seguranca_registro.test.js` e `test/seguranca_barreira.test.js`).

- [ ] **Step 6: Commit** `feat(portal): rota de financeiro do cliente`.

### Task 3: Tela do cliente, link condicional e documentação

**Files:**
- Create: `portal/public/financeiro.html`, `portal/public/financeiro.js`
- Modify: `portal/public/inicio.html` (link "Financeiro" oculto por padrão, `hidden`), `portal/public/inicio.js` (mostra o link só se `usuario.permissoes` contém `financeiro.ver`), `portal/public/portal.css` (só se preciso), `test/portal_paginas.test.js` (acrescentar `financeiro.html` em `HTMLS`, `financeiro.js` em `JSS` e `/portal/financeiro.html` no teste HTTP de cabeçalhos), `docs/regras/portal-identidade.md`, `CLAUDE.md`, `docs/portal_configuracao.md`
- Test: `test/portal_financeiro_tela.test.js`

**Interfaces:**
- Consumes: `window.PortalApi.chamar(caminho) -> Promise<{status, dados}>`; resposta da Tarefa 2; padrão de `portal/public/pedidos.html/.js` (DOM falso com `vm` em `test/portal_pedidos_tela.test.js`).

- [ ] **Step 1: Write the failing test** `test/portal_financeiro_tela.test.js` no estilo de `test/portal_pedidos_tela.test.js` (DOM falso): `financeiro.html` e `financeiro.js` existem; HTML sem `<script>` inline, `style=` nem `on...=`; JS sem `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `document.write`; chama `/portal/api/financeiro` com `visao` e `pagina`; resumo mostrado ("A receber", "Em atraso") por `textContent` e dinheiro formatado em reais por string (`1000.5` → `R$ 1.000,50`), sem `Intl` dependente de locale do navegador de teste; datas `DD/MM/AAAA` por string; `null` → "—"; abas "Em aberto" e "Pagos" trocam a visão e voltam à página 1; Anterior desabilitado na página 1 e Próxima sem `temMais`; lista vazia mostra "Nenhum título encontrado."; 401 → `replace('/portal/login.html')`; **falha (500 ou status 0) ao trocar de aba ou de página mantém a tabela, a aba e a página anteriores** e mostra o erro; `inicio.html` tem o link para `financeiro.html` com `hidden`, e `inicio.js` só o mostra com a permissão (testar com e sem `financeiro.ver`).

- [ ] **Step 2: Run** `node --test test/portal_financeiro_tela.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement** `financeiro.html` (resumo no topo, duas abas como botões, tabela Vencimento, Pedido, Nota fiscal, Valor, Situação, Anterior/Próxima, `<p id="erro" class="erro" role="alert">`, link de volta ao início) e `financeiro.js` (IIFE como `pedidos.js`; guardar o estado antes de cada troca e restaurá-lo no erro), e o link condicional em `inicio.html`/`inicio.js`.

- [ ] **Step 4: Run** `npm test`. Expected: PASS, incluindo os testes de página e de CSP existentes.

- [ ] **Step 5: Documentar:** seção "Etapa 3b: financeiro" em `docs/regras/portal-identidade.md` (rota, isolamento por `c.CODIGO = ?`, só entradas, filtros `IS NOT NULL`, lista fechada de campos, rótulos e regra de atraso na hora, corte de 12 meses, auditoria `financeiro_visto` na lista de eventos, o que não foi testado: MySQL real e navegador real); `CLAUDE.md` (linha do Portal do cliente: o cliente agora também vê o financeiro; só PDF/DANFE falta; seção 2 lista `rotas/portal_financeiro.js` e `calculo/portal_financeiro.js`); `docs/portal_configuracao.md` (linha 3 e seção 11 incluem Financeiro; novo passo na seção 12: rodar as duas consultas com o `CODIGO` de uma empresa real e conferir collation do JOIN `fluxo_de_caixa.RAZAO_SOCIAL` x `cadastro_clientes.RAZAO_SOCIAL`, tipos reais de `DATA`, `VALOR`, `PEDIDO` e `NOTA_FISCAL`, `DATE_FORMAT(f.DATA)` e tempo do JOIN).

- [ ] **Step 6: Commit** `feat(portal): tela Financeiro e documentação da etapa 3b`.

---

## Self-review (feito)

- **Cobertura da spec:** seção 3 (rota, `visao`, `pagina`, resposta) → Tarefas 1 e 2; seção 4 (isolamento, só entradas, 12 meses, resumo, ordem estável) → Tarefa 2 testes 1 a 6; seção 5 (campos, rótulos) → Tarefas 1 e 2; seção 6 (auditoria) → Tarefa 2 teste 9 e Tarefa 3 passo 5; seção 7 (arquivos, link condicional) → Tarefas 2 e 3; seção 8 (erros) → Tarefa 2 testes 8, 10 e 11; seção 9 (testes) → Tarefas 1 a 3; seção 11 → Tarefa 3 passo 5.
- **Decisão que a spec deixou em silêncio:** `DATA IS NOT NULL` e `VALOR IS NOT NULL` nas duas consultas, para a lista e o resumo nunca discordarem; anotada nas Global Constraints.
- **Consistência de nomes:** `visaoValida`, `dinheiro`, `docesMesesAtras`, `projetarTitulo`, `EM_ABERTO`, `PAGINA_MAXIMA`, `registrarPortalFinanceiro`, `criarPoolFinanceiro` e os `AS` `DATA/PEDIDO/NOTA_FISCAL/SITUACAO/VALOR` iguais nas três tarefas.
- **Risco aberto:** a consulta (JOIN por razão social em `fluxo_de_caixa`, `DATE_FORMAT`, tipos reais de `PEDIDO` e `VALOR`, `LIMIT/OFFSET`) só roda contra banco falso; conferir no MySQL de teste antes do deploy (passo novo da seção 12 do guia).
