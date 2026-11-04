# Portal do cliente, etapa 3a: pedidos e status. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente logado no portal vê a lista e a ficha dos pedidos da própria empresa, só com status (sem valores nem itens).

**Architecture:** duas rotas `GET` criadas por `registro.portal(..., ['pedidos.ver'])`, com SQL próprio e lista fechada de colunas; a empresa vem de `req.portal.empresaCodigo` e liga `ped_orc` a `cadastro_clientes` por `c.CODIGO = ?` numa única consulta. Uma função pura projeta a linha do banco nas 6 chaves do cliente e traduz os status em rótulos fechados. A tela é HTML/JS puro dentro de `portal/public/`.

**Tech Stack:** Node.js, Express 4, mysql2 (pool injetado), `node:test`, HTML/JS puro com CSP sem inline.

**Spec:** `docs/superpowers/specs/2026-11-04-portal-etapa3a-pedidos-design.md` (contexto: `docs/regras/portal-identidade.md`).

## Global Constraints

- Rotas do portal só por `registro.portal(metodo, caminho, ['pedidos.ver'], handler)`; nunca `registro.rota`. Empresa só de `req.portal.empresaCodigo`; nenhum parâmetro da requisição escolhe empresa ou nome.
- Só `p.TIPO = 'Pedido'`. Colunas **nunca** selecionadas: `TOTAL`, `OBS_GERAL`, `CLIENTE_FINAL`, `FINANCEIRO`, comissão, itens, motivos/observações de ocorrência, motorista, anexos.
- Chaves da resposta, exatamente: `numero`, `data`, `situacao`, `dataEntrega`, `entrega`, `dataAgendada` (nenhuma casa com `REGEX_VALOR` de `seguranca/valores.js`).
- Detalhe: pedido de outra empresa, inexistente ou número mal formado = o **mesmo 404** (mesmo status e corpo). Lista: `NUMERO` decrescente, 50 por página, `pagina` inteiro estrito ≥ 1 (senão 400).
- Erro de banco: 500 genérico `{ error: 'Erro de servidor' }`, log só com `err.code`.
- Front: sem script nem estilo inline, texto por `textContent`, chamadas por `window.PortalApi.chamar`; 401 volta para `/portal/login.html`.
- Testes de segurança desta base já tiveram teste vazio: todo teste de isolamento exige contagem > 0 e vem com prova de mutação. Escrever arquivos só com Write/Edit, nunca heredoc de shell. Commits na main, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Empresa com **duas** linhas de pedido de numeração parecida (`12` e `120`): o detalhe de `12` não devolve `120` (teste na Tarefa 2).
- Pedido com `en.status` nulo (nunca teve entrega) e pedido Pronto sem entrega: `entrega` e `dataAgendada` são `null`, não "undefined" nem texto (Tarefas 1 e 2).
- `DATA_ENTREGA` preenchida em pedido ainda Em Produção (dado sujo do VB): não vaza, `dataEntrega` é `null` (Tarefa 1).
- `pagina=0`, `pagina=-1`, `pagina=1.5`, `pagina=abc`, `pagina=1&pagina=2` (array): 400, nunca consulta com `OFFSET` negativo/NaN (Tarefa 2).
- Sessão de funcionário (JWT) e usuário sem `pedidos.ver` não entram (Tarefa 2).

---

### Task 1: Projeção e validação puras

**Files:**
- Create: `calculo/portal_pedidos.js`
- Test: `test/portal_pedidos_calculo.test.js`

**Interfaces:**
- Produces:
  - `projetarPedido(linha) -> { numero:number, data:string, situacao:string, dataEntrega:string|null, entrega:string|null, dataAgendada:string|null }`. `linha` tem as chaves do banco `NUMERO, DATA, SITUACAO, DATA_ENTREGA, ENTREGA_STATUS, DATA_AGENDADA` (nomes exatos que a rota usará nos `AS`). Não repassa nenhuma outra chave.
  - `paginaValida(texto) -> number|null` (inteiro estrito ≥ 1 vindo de string; `undefined` = 1; qualquer outra coisa, inclusive array, = `null`).
  - `numeroValido(texto) -> number|null` (inteiro estrito > 0 só com dígitos, até 9 dígitos; senão `null`).
  - `TAMANHO_PAGINA = 50`.

- [ ] **Step 1: Write the failing test** em `test/portal_pedidos_calculo.test.js` (cabeçalho com `process.env.JWT_SECRET='teste'` e `NODE_ENV='test'` como os demais testes). Casos, com os valores da spec seção 5:
  - rótulo de situação: `'Em Produção'`→`'Em produção'`, `'Pronto'`, `'Entregue'`, `'Retirado'`, `'Cancelado'` mantêm o texto; `'Qualquer'`/`null`→`'Em andamento'`.
  - rótulo de entrega: `a_programar`→`'Aguardando agendamento'`, `agendada`→`'Entrega agendada'`, `em_rota`→`'Saiu para entrega'`, `ocorrencia`→`'Entrega a reprogramar'`, `entregue`→`'Entregue'`, `retirado`→`'Retirado'`, `enviada`→`'Enviada'`, `cancelada`→`'Cancelada'`; `null` e `'xyz'`→`null`.
  - `dataEntrega` só com situação Entregue/Retirado (Em Produção com `DATA_ENTREGA` preenchida → `null`); `dataAgendada` só com entrega `agendada` ou `em_rota`.
  - `Object.keys(projetarPedido({...linha com TOTAL, OBS_GERAL, CLIENTE_FINAL, FINANCEIRO, MOTIVO...})).sort()` é exatamente `['data','dataEntrega','dataAgendada','entrega','numero','situacao']`.
  - `paginaValida`: `undefined`→1, `'3'`→3, `'0'`, `'-1'`, `'1.5'`, `'abc'`, `''`, `['1','2']`→`null`. `numeroValido`: `'12'`→12, `'12abc'`, `'0'`, `'-3'`, `'1e3'`, `'1234567890'`, `undefined`→`null`.

- [ ] **Step 2: Run** `node --test test/portal_pedidos_calculo.test.js`. Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement** `calculo/portal_pedidos.js` com os mapas como `Object.freeze` e `projetarPedido` montando o objeto de saída **chave a chave** (nunca `{...linha}`).

- [ ] **Step 4: Run** o mesmo comando. Expected: PASS.

- [ ] **Step 5: Commit** `feat(portal): projeção e validação puras dos pedidos do cliente` (arquivos: os dois acima).

### Task 2: Rotas, isolamento e registro

**Files:**
- Create: `rotas/portal_pedidos.js`, `test/apoio/poolPedidosPortal.js`
- Test: `test/portal_pedidos_rotas.test.js`
- Modify: `index.js` (require junto da linha 32 e registro depois da linha 1763)

**Interfaces:**
- Consumes: Tarefa 1 (`projetarPedido`, `paginaValida`, `numeroValido`, `TAMANHO_PAGINA`); `registro.portal` (padrão de `rotas/portal_auth.js:293`); `req.portal.empresaCodigo`.
- Produces: `registrarPortalPedidos({ portal, pool }) -> void`. Rotas `GET /portal/api/pedidos` → `200 { pedidos: Pedido[], pagina: number, temMais: boolean }` e `GET /portal/api/pedidos/:numero` → `200 { pedido: Pedido }`. `poolPedidosPortal.criarPoolPedidos({ pedidos, clientes, entregas }) -> pool` com `execute(sql, params)` e `chamadas[]`.

Detalhes que a consulta fixa (spec seção 4): `SELECT` só com as 6 colunas com `AS NUMERO/DATA/SITUACAO/DATA_ENTREGA/ENTREGA_STATUS/DATA_AGENDADA` (`DATE_FORMAT(...,'%Y-%m-%d')` nas datas), `FROM ped_orc p JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL LEFT JOIN web_entregas en ON en.numero = p.NUMERO`, `WHERE c.CODIGO = ? AND p.TIPO = 'Pedido'`; lista com `ORDER BY p.NUMERO DESC LIMIT 51 OFFSET ?` (parâmetros numéricos já validados; usar `pool.query`/`execute` conforme o padrão das outras rotas com LIMIT), detalhe com `AND p.NUMERO = ? LIMIT 1`. 404 do detalhe: `{ error: 'Pedido não encontrado.' }`.

- [ ] **Step 1: Write the failing tests** em `test/portal_pedidos_rotas.test.js`, montando o app como `test/portal_auth_rotas.test.js:36-90` (registro real, `criarBancoPortal` para a sessão, `registrarPortalPedidos({ portal: registro.portal, pool: poolPedidos })`), com sessões abertas por `sessoes` e cookie `__Host-portal`. Dados: empresas 40 (ACME) e 41 (BETA), pedidos de ACME `12`, `120` (Entregue, `DATA_ENTREGA` preenchida, entrega `entregue`), `13` (Em Produção, sem entrega), `14` (Pronto, entrega `agendada` com data), um orçamento de ACME `15` (`TIPO='Orçamento'`), pedido `99` de BETA; todos com `TOTAL`, `OBS_GERAL`, `CLIENTE_FINAL` preenchidos. Testes:
  1. lista de ACME devolve exatamente `[120, 14, 13, 12]` (contagem 4), nenhum de BETA, nenhum orçamento; cada item tem exatamente as 6 chaves e o corpo serializado não contém `TOTAL`, `OBS_GERAL`, nem os textos dos dados sujos.
  2. detalhe `12` devolve só o `12` (não o `120`); detalhe `99` (de BETA), `404` inexistente e `12abc` têm **status e corpo idênticos** (`deepEqual`).
  3. `pagina`: 51 pedidos → página 1 com 50 e `temMais: true`, página 2 com 1 e `temMais: false`; `pagina=0|-1|1.5|abc` e `pagina=1&pagina=2` → 400 e `pool.chamadas` sem nova consulta.
  4. SQL fixo: o texto da consulta contém `c.CODIGO = ?`, `p.TIPO = 'Pedido'` e **não** casa `/TOTAL|OBS_GERAL|CLIENTE_FINAL|FINANCEIRO|MOTIVO/i`; o primeiro parâmetro é `req.portal.empresaCodigo` da sessão (40), mesmo com `?empresa=41`, `?cliente=BETA LTDA` ou cabeçalho tentando trocar.
  5. **Prova de mutação**: um teste que roda o mesmo cenário contra uma cópia do módulo cuja consulta tenha `c.CODIGO = ?` trocado por `1 = 1` (carregar o arquivo, substituir a string em memória e avaliar via `Module._compile` ou, mais simples, injetar no pool falso uma variante que ignora o filtro) e **espera** que o teste de isolamento então falhe, provando que o pool falso aplica o filtro de verdade; documentar no comentário como a mutação é feita.
  6. sem cookie → 401; JWT de funcionário no cookie → 401; usuário sem `pedidos.ver` (permissão removida do `permissoes` da sessão de teste) → 403; empresa suspensa → 401.
  7. `registro.rotasPortal()` contém `get /portal/api/pedidos` e `get /portal/api/pedidos/:numero`; `registro.verificar()` não lança.

- [ ] **Step 2: Run** `node --test test/portal_pedidos_rotas.test.js`. Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement** `test/apoio/poolPedidosPortal.js` (pool falso que reconhece só a consulta de pedidos, aplica `CODIGO = params[0]`, `TIPO='Pedido'`, `NUMERO`, ordem, `LIMIT/OFFSET`, e junta `entregas` por número; guarda `chamadas`) e `rotas/portal_pedidos.js` conforme a seção de detalhes acima, com `falhaInterna` no padrão de `rotas/portal_auth.js` (log só `err.code`).

- [ ] **Step 4: Registrar em `index.js`:** `const { registrarPortalPedidos } = require('./rotas/portal_pedidos');` e, logo após `registrarPortalAuth(...)`, `registrarPortalPedidos({ portal: registro.portal, pool });`.

- [ ] **Step 5: Run** `node --test test/portal_pedidos_rotas.test.js` e depois `npm test`. Expected: tudo PASS (inclusive `test/seguranca_registro.test.js` e `test/seguranca_barreira.test.js`; se algum enumerar `rotasPortal()` do app inteiro, atualizar a lista esperada para incluir as duas rotas novas).

- [ ] **Step 6: Commit** `feat(portal): rotas de pedidos e status do cliente` (rotas, apoio, teste, index.js).

### Task 3: Tela do cliente e documentação

**Files:**
- Create: `portal/public/pedidos.html`, `portal/public/pedidos.js`
- Modify: `portal/public/inicio.html` (trocar a frase "O conteúdo do portal chega na próxima etapa." por link `<a href="pedidos.html">Meus pedidos</a>`), `portal/public/inicio.js` (comentário "provisório até a etapa 3"), `portal/public/portal.css` (só se a tabela precisar de estilo), `test/portal_paginas.test.js:19-20` (acrescentar `'pedidos.html'` em `HTMLS` e `'pedidos.js'` em `JSS`), `docs/regras/portal-identidade.md`, `CLAUDE.md` (resumo do portal e seção 5)
- Test: `test/portal_pedidos_tela.test.js`

**Interfaces:**
- Consumes: `window.PortalApi.chamar(caminho) -> Promise<{status, dados}>` (`portal/public/portal.js`); resposta da Tarefa 2.

- [ ] **Step 1: Write the failing test** `test/portal_pedidos_tela.test.js`, no estilo de `test/portal_paginas.test.js`: `pedidos.html` e `pedidos.js` existem; HTML sem `<script>` inline, sem `style=` e sem `on...=`; o JS não contém `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval` nem `document.write`; usa `textContent`; chama `/portal/api/pedidos` e trata 401 com `/portal/login.html`; `inicio.html` tem link para `pedidos.html` e já não diz "próxima etapa".

- [ ] **Step 2: Run** `node --test test/portal_pedidos_tela.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement** `pedidos.html` (tabela com cabeçalho Número, Data, Situação, Entrega, Previsão/Data; botões Anterior/Próxima; `<p id="erro" class="erro" role="alert">`; voltar ao início) e `pedidos.js` (IIFE como `inicio.js`: carrega a página pelo `chamar`, monta linhas com `createElement` + `textContent`, mostra "—" para `null`, formata `YYYY-MM-DD` como `DD/MM/AAAA` sem `Date` (fuso), desabilita Anterior na página 1 e Próxima sem `temMais`, mensagem "Nenhum pedido encontrado." se vazio).

- [ ] **Step 4: Run** `npm test`. Expected: PASS, incluindo os testes de páginas e de CSP existentes.

- [ ] **Step 5: Documentar:** acrescentar a `docs/regras/portal-identidade.md` a seção "Etapa 3a: pedidos e status" (rotas, isolamento por `c.CODIGO = ?`, lista fechada, rótulos, 404 uniforme, o que não foi testado em MySQL real/navegador) e atualizar no `CLAUDE.md` a linha do Portal do cliente (cliente agora vê pedidos e status; PDFs e financeiro ainda não).

- [ ] **Step 6: Commit** `feat(portal): tela Meus pedidos e documentação da etapa 3a`.

---

## Self-review (feito)

- **Cobertura da spec:** seção 3 (rotas, paginação, número estrito) → Tarefas 1 e 2; seção 4 (isolamento, 404 uniforme) → Tarefa 2 testes 2, 4 e 5; seção 5 (campos, rótulos, datas condicionais) → Tarefas 1 e 2; seção 6 (arquivos) → todas; seção 7 (erros 400/401/403/404/500) → Tarefa 2 (500 coberto pelo `falhaInterna`; incluir no teste 3 ou 6 um pool que lança `{code:'X'}` e confira corpo genérico e log sem texto de dados); seção 8 → Tarefas 1 a 3; seção 10 (não testável) → documentado na Tarefa 3, passo 5.
- **Consistência de nomes:** `projetarPedido`, `paginaValida`, `numeroValido`, `TAMANHO_PAGINA`, `registrarPortalPedidos`, colunas `AS NUMERO/DATA/SITUACAO/DATA_ENTREGA/ENTREGA_STATUS/DATA_AGENDADA` usados igual nas três tarefas.
- **Risco aberto:** a consulta (JOIN por razão social, `DATE_FORMAT`, `LIMIT/OFFSET` com placeholders) só roda contra banco falso; conferir no MySQL de teste do roteiro da seção 12 de `docs/portal_configuracao.md` antes do deploy.
