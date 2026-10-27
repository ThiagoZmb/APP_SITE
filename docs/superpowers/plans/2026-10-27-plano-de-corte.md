# Plano de corte de perfis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar, a partir de um Pedido, o plano de corte dos perfis (porta, puxador, divisor) em varas e retalhos, com conferência do corte real e controle de retalhos.

**Architecture:** Duas funções puras em `calculo/` (montar peças do pedido; otimizar em varas/retalhos), rotas em `rotas/corte.js` com tabelas `web_corte_*`/`web_retalhos`, e uma tela `corte.html`. Segue o módulo Gestão (o mais recente) e o Tintas como modelo de rotas, permissões, instalação e testes.

**Tech Stack:** Node.js + Express, mysql2, `node:test` com banco falso, HTML/CSS/JS puro com CSP.

**Spec:** `docs/superpowers/specs/2026-10-27-plano-de-corte-design.md`

## Global Constraints

- Medidas em **mm inteiros**; nenhum ponto flutuante nas contas de corte. Aproveitamento em % com 1 casa, calculado de inteiros.
- Padrões: vara **6000 mm**, serra **3 mm**, sobra mínima **500 mm**, com exceção por perfil (`web_corte_config`).
- Encaixe como no VB (n peças usam n−1 serras; o corte final sai da sobra). Peça só entra em retalho/vara do **mesmo perfil + acabamento + cor**.
- Só tabelas `web_*` novas, criadas por `seguranca/instalacao.js`; **nunca** alterar tabelas do VB. Sem FK para tabelas do VB.
- Só **Pedido** (a tabela `perfis` não existe para orçamento). Serralheria fora.
- Toda rota por `registro.rota(...)` (`seguranca/rotas.js`); permissões `corte.ver`, `corte.planejar`, `corte.parametros` em `seguranca/permissoes.js`. Administrador e Interno completo recebem ver+planejar; só Administrador recebe parametros. Contagens com nomes `qtd*`.
- Escritas em transação (`emTransacao`, `rotas/transacao.js`) e auditadas em `web_auditoria` (só nomes de campo e medidas).
- Dado ausente vira pendência, nunca estimativa. Mesmo pedido gera sempre o mesmo plano.
- Testes `node:test` sem MySQL; `process.env.JWT_SECRET='teste'`, `NODE_ENV='test'`. `npm test` inteiro deve continuar verde.

## Review Focus

1. Pedido antigo sem linhas em `perfis`: resposta com estado vazio explicado, nunca 500.
2. Peça com tamanho nulo, 0 ou negativo, ou item sem acabamento/cor: vira pendência e fica fora do plano.
3. Dois planos disputando o mesmo retalho: o segundo salvar responde 409 e não reserva nada.
4. Confirmar o mesmo plano duas vezes: segunda chamada recusada, sem duplicar retalhos.
5. Medida real de sobra maior que a calculada, ou ≤ 0: recusada na conferência.

---

## File Structure

- Create `calculo/corte_pecas.js` — lista de peças e pendências a partir das linhas do pedido; impressão digital.
- Create `calculo/corte_otimizacao.js` — parâmetros por perfil e otimização.
- Create `calculo/corte_validacao.js` — validação de config, retalho, marcação e conferência.
- Create `rotas/corte.js` — todas as rotas `/corte/*`.
- Create `corte.html`, `corte.js` — tela (plano, conferência, retalhos, parâmetros).
- Create `test/apoio/bancoCorte.js`; `test/corte_pecas.test.js`, `test/corte_otimizacao.test.js`, `test/corte_rotas.test.js`, `test/corte_tela.test.js`.
- Modify `seguranca/instalacao.js`, `seguranca/permissoes.js`, `index.js`, `layout.js`, `painel_inicial.html`, `rotas/ped_orc.js` (liberar reservas), `test/instalacao.test.js`, `test/permissoes.test.js`, `CLAUDE.md`.

---

### Task 1: Peças do pedido

**Files:** Create `calculo/corte_pecas.js`; Test `test/corte_pecas.test.js`

**Interfaces:**
- Produces: `montarPecas({ perfis, itens }) -> { pecas: Peca[], pendencias: Pendencia[] }` onde `Peca = { perfil, acabamento, cor, tamanho, item, origem }` (`origem` ∈ `'porta-altura' | 'porta-largura' | 'puxador' | 'divisor'`, `tamanho` inteiro) e `Pendencia = { item, perfil, motivo }`.
- Produces: `chaveGrupo(p) -> string` (`perfil|acabamento|cor`) e `impressaoPecas(pecas) -> string` (SHA-256 hex da lista ordenada de forma estável).

- [ ] **Step 1: Fechar os 3 pontos em aberto do spec §3.** Ler `rotas/ped_orc.js:281-300` e `calculo/engenharia.js:122-134` e decidir, por escrito num comentário no topo de `corte_pecas.js`: (a) `TAM_PUXADOR` é o comprimento de uma peça de puxador; (b) se `QTD_PUXADOR` é por porta; (c) que `perfis.QTD_ALTURA/LARGURA` são por porta e a quantidade total é `QTD_PORTAS × QTD_x`. Se o código contradisser, ajustar o spec e este plano antes de seguir.
- [ ] **Step 2: Escrever os testes que falham** (`corte_pecas.test.js`): porta com 2 alturas e 2 larguras, `QTD_PORTAS=3` gera 6+6 peças com tamanhos certos; puxador gera `QTD_PUXADOR × QTD_PORTAS` peças com `origem 'puxador'`; divisor (`QTD_HORIZONTAL`/`QTD_VERTICAL` × `TAM_DIV_*`) gera peças `'divisor'` com o acabamento/cor do divisor; acabamento e cor vêm de `itens` pelo par `NUMERO+ITEM`; tamanho 0/negativo/nulo → pendência com `motivo` e peça ausente; item sem acabamento ou cor → pendência; `impressaoPecas` igual para a mesma lista em ordem diferente e diferente se um tamanho muda.
- [ ] **Step 3: Rodar** `node --test test/corte_pecas.test.js` — esperado: FAIL (módulo inexistente).
- [ ] **Step 4: Implementar** `montarPecas`, `chaveGrupo`, `impressaoPecas` em `calculo/corte_pecas.js` (sem acesso a banco).
- [ ] **Step 5: Rodar o teste** — esperado: PASS.
- [ ] **Step 6: Commit** `feat(corte): montar peças de perfil do pedido`.

### Task 2: Otimização em varas e retalhos

**Files:** Create `calculo/corte_otimizacao.js`; Test `test/corte_otimizacao.test.js`

**Interfaces:**
- Consumes: `Peca`, `chaveGrupo` (Task 1).
- Produces: `resolverParametros(linhasConfig, perfil) -> { comprimentoVara, serra, sobraMinima }` (linha do perfil, senão a de `perfil = null`, senão 6000/3/500).
- Produces: `otimizar({ pecas, retalhos, parametrosDe }) -> { grupos, erros, resumo }`. `retalhos: { id, perfil, acabamento, cor, comprimento }[]`; `parametrosDe: perfil => parametros`. `Grupo = { chave, perfil, acabamento, cor, barras: Barra[] }`; `Barra = { tipo: 'vara'|'retalho', retalhoId: number|null, comprimento, pecas: { tamanho, item, origem }[], sobra, destinoSobra: 'guardar'|'descartar' }`; `erros: { peca, motivo }[]`; `resumo = { qtdVarasNovas, qtdRetalhosUsados, aproveitamentoPct, sobraSomaMm }`.

- [ ] **Step 1: Escrever os testes que falham:** peça igual à vara (6000) cabe sozinha; peça + serra acima do comprimento vai para `erros` e as demais continuam; retalho do mesmo grupo é usado antes de abrir vara nova; retalho de outra cor/acabamento nunca é usado; sobra ≥ `sobraMinima` → `'guardar'`, menor → `'descartar'`; sobra considera `serra × nº de peças`; `sobraMinima` diferente por perfil; mesmo input duas vezes → saída idêntica (deep equal); em um conjunto de 30 peças aleatórias fixas (semente fixa) `qtdVarasNovas` ≤ a de uma implementação FFD do VB escrita no próprio teste; `aproveitamentoPct` = soma dos tamanhos ÷ soma dos comprimentos usados, 1 casa.
- [ ] **Step 2: Rodar** `node --test test/corte_otimizacao.test.js` — esperado: FAIL.
- [ ] **Step 3: Implementar** em `calculo/corte_otimizacao.js`. Por grupo: ordenar peças de forma estável; rodar First-Fit Decreasing, Best-Fit Decreasing e a variante com retalhos em ordem crescente; para grupos com ≤ 12 peças, busca exata com limite de nós. Escolher por (menos varas novas, maior aproveitamento, menos sobras pequenas, ordem estável).
- [ ] **Step 4: Rodar o teste** — esperado: PASS.
- [ ] **Step 5: Commit** `feat(corte): otimização de varas e retalhos`.

### Task 3: Tabelas, permissões e validação

**Files:** Modify `seguranca/instalacao.js`, `seguranca/permissoes.js`, `index.js`; Create `calculo/corte_validacao.js`; Test `test/instalacao.test.js`, `test/permissoes.test.js`, `test/corte_validacao.test.js`

**Interfaces:**
- Produces: tabelas `web_corte_config`, `web_retalhos`, `web_corte_planos` (colunas do spec §6; mm `INT`; `resultado`/`parametros` `JSON`; `situacao` do plano ∈ gerado/conferido/desatualizado/cancelado; do retalho ∈ disponivel/reservado/usado/descartado; `UNIQUE(perfil)` em config); linha padrão 6000/3/500 com `perfil` nulo.
- Produces: `acrescentarPermissoesCorte(pool)` no padrão de `acrescentarPermissoesGestao`, chamada na subida do `index.js`.
- Produces: `validarConfig(corpo)`, `validarRetalho(corpo)`, `validarConferencia(corpo, plano) -> { ok, erros } | dados normalizados` (Review Focus 5: sobra real > calculada ou ≤ 0 é recusada), todas puras, em `calculo/corte_validacao.js`.

- [ ] **Step 1: Testes que falham:** contagem do catálogo de permissões e de tabelas web_ sobe (ajustar os testes existentes na mesma conta), Interno completo recebe `corte.ver`/`corte.planejar` e **não** `corte.parametros`; `acrescentarPermissoesCorte` é idempotente (marcador em `web_auditoria`); validação rejeita comprimento/serra/sobra ≤ 0 ou não inteiros, retalho sem perfil/acabamento/cor, conferência com sobra maior que a calculada.
- [ ] **Step 2: Rodar** `node --test test/instalacao.test.js test/permissoes.test.js test/corte_validacao.test.js` — esperado: FAIL.
- [ ] **Step 3: Implementar** as três tabelas em `seguranca/instalacao.js` (mesmo estilo das `web_gestao_*`), as permissões, a função de migração e as validações.
- [ ] **Step 4: Rodar os mesmos testes** — esperado: PASS.
- [ ] **Step 5: Commit** `feat(corte): tabelas, permissões e validação`.

### Task 4: Rotas de parâmetros e retalhos

**Files:** Create `rotas/corte.js` (parte 1), `test/apoio/bancoCorte.js`; Modify `index.js`; Test `test/corte_rotas.test.js`

**Interfaces:**
- Consumes: Task 3.
- Produces: `GET /corte/config` e `GET /corte/retalhos?situacao=` (`corte.ver`); `PUT /corte/config` e `POST /corte/retalhos`, `PUT /corte/retalhos/:id`, `POST /corte/retalhos/:id/descartar` (`corte.parametros`), todas as escritas com `emTransacao` e auditoria.

- [ ] **Step 1: Testes que falham** no `corte_rotas.test.js` com o banco falso: sem `corte.ver` → 403; `PUT /corte/config` sem `corte.parametros` → 403; config por perfil substitui o padrão; retalho manual válido grava como `disponivel`; retalho `reservado` não pode ser editado nem descartado (409); auditoria gravada; `registro.verificar()` passa.
- [ ] **Step 2: Rodar** `node --test test/corte_rotas.test.js` — esperado: FAIL.
- [ ] **Step 3: Implementar** rotas e o banco falso (regras `[RegExp, resposta]` como em `bancoGestao.js`); registrar em `index.js` como os outros módulos.
- [ ] **Step 4: Rodar** o teste — esperado: PASS.
- [ ] **Step 5: Commit** `feat(corte): rotas de parâmetros e retalhos`.

### Task 5: Rotas do plano (gerar, salvar, conferir, confirmar)

**Files:** Modify `rotas/corte.js`, `rotas/ped_orc.js`, `test/apoio/bancoCorte.js`; Test `test/corte_rotas.test.js`

**Interfaces:**
- Consumes: `montarPecas`, `impressaoPecas`, `otimizar`, `resolverParametros`, `validarConferencia`.
- Produces: `GET /corte/pedido/:numero` (pré-visualização, não grava; devolve `{ pecas, pendencias, plano, resumo, planoSalvo }`), `POST /corte/pedido/:numero/salvar` (grava plano e reserva retalhos), `GET /corte/plano/:id` (marca `desatualizado` se a impressão mudou), `PUT /corte/plano/:id/pecas` (marcar cortadas), `POST /corte/plano/:id/confirmar`, `POST /corte/plano/:id/cancelar` (`corte.planejar`).

- [ ] **Step 1: Testes que falham:** pedido sem linhas em `perfis` → 200 com estado vazio e mensagem (Review Focus 1); pedido inexistente → 404; pré-visualização não escreve nada; salvar reserva os retalhos usados; segundo salvar disputando o mesmo retalho → 409 sem reservar (Focus 3); plano cuja impressão mudou lê-se como `desatualizado`; confirmar: usados→`usado`, reservados não usados→`disponivel`, sobra ≥ mínimo→novo retalho com a medida conferida, menor→descartada, plano→`conferido`, tudo na mesma transação; confirmar de novo → 409 sem duplicar (Focus 4); cancelar libera as reservas; sem `corte.planejar` → 403.
- [ ] **Step 2: Rodar** — esperado: FAIL.
- [ ] **Step 3: Implementar** as rotas. Liberar reservas dos planos do pedido na mesma transação das rotas de `rotas/ped_orc.js` que excluem o pedido (`DELETE /ped_orc/Pedido/:numero`, junto da exclusão de `perfis`) e que o cancelam (localizar com `grep -n "Cancelado" rotas/ped_orc.js index.js`); conferir que os testes existentes de exclusão seguem verdes.
- [ ] **Step 4: Rodar** `node --test test/corte_rotas.test.js test/ped_orc*.test.js` — esperado: PASS.
- [ ] **Step 5: Commit** `feat(corte): rotas do plano e reservas de retalho`.

### Task 6: Tela

**Files:** Create `corte.html`, `corte.js`, `test/corte_tela.test.js`; Modify `layout.js`, `painel_inicial.html`

**Interfaces:**
- Consumes: rotas das Tasks 4–5. Menu lateral com `['corte.ver']`; item "Plano de corte" no menu do botão direito dos pedidos (só Pedido, com `corte.ver`), abrindo `corte.html?numero=`.

- [ ] **Step 1: Teste que falha** (padrão `gestao_tela.test.js`): todos os `id` usados por `corte.js` existem em `corte.html`; CSP presente; item no `layout.js`; item no menu do pedido.
- [ ] **Step 2: Rodar** — esperado: FAIL.
- [ ] **Step 3: Implementar** a tela como no spec §9 (resumo, pendências, faixa por grupo com varas em escala, retalho em cor distinta, risco também em texto, marcar peça cortada, modo conferência, abas Retalhos e Parâmetros, estados de carregamento/erro/vazio); formulários de escrita só com `corte.planejar`/`corte.parametros` (a segurança real é no servidor).
- [ ] **Step 4: Rodar** o teste — esperado: PASS. Validar a tela à mão no navegador (sem teste automático).
- [ ] **Step 5: Commit** `feat(corte): tela do plano de corte`.

### Task 7: Documentação e verificação final

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1:** Acrescentar seção "Plano de corte" na seção 5 do `CLAUDE.md` (tabelas, permissões, fórmulas, limitações do spec §12) e a linha do módulo nas listas de funcionalidades e pastas.
- [ ] **Step 2:** Rodar `npm test` — esperado: 0 falhas; anotar a contagem real.
- [ ] **Step 3:** Conferir `registro.verificar()` (teste de rotas) e que `git status` só traz os arquivos listados.
- [ ] **Step 4: Commit** `docs(corte): CLAUDE.md`.
