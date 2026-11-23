# Livro de regras de orçamentos e pedidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um livro único de regras (código, nível, mensagem) aplicado ao adicionar item na tela e ao salvar no servidor, fácil de ampliar.

**Architecture:** Módulo puro `calculo/regras_item.js` com a lista `REGRAS` e `avaliar`. Rota `POST /regras/verificar_item` para a tela e `GET /regras/livro` para a página de leitura. `validar()` de `rotas/ped_orc.js` reaplica as regras a itens novos/editados (nunca a cópias). Limites em `LIMITES`, prontos para virar tabela depois.

**Tech Stack:** Node.js + Express 4, `node:test`, HTML/JS puro (sem build).

**Spec:** `docs/superpowers/specs/2026-11-23-livro-de-regras-design.md`

## Global Constraints

- Níveis: `bloqueia`, `confirma`, `avisa`. Escopos: `item`, `documento`.
- `LIMITES = { portaMedidaAlertaMm: 300, puxadorEmbutidoMinMm: 50, puxadorEmbutidoMaxMm: 400 }`.
- Frentes de porta (comparar sem diferenciar caixa, em `item.frente`): "Porta de giro", "Porta basculante", "Frente de gaveta", "Porta de Correr". "Serralheria" e "Avulso" ficam fora das regras de porta.
- Não existe "embutido total": "toda extensão" (`detalhes.todaExt`) só existe no sobreposto. Embutido = `detalhes.tipoPuxador` contendo "embutido" (sem diferenciar caixa).
- Tamanhos e quantidades: só inteiros, sem vírgula, ponto, sinal nem letra. Não vale para dinheiro (valor unitário, desconto %).
- Item `ehCopia` (`origem.estado` em `intacto`, `so_pct`, `travado`) nunca é revalidado; item `editado` ou novo é.
- Regras só leem o item; nunca alteram valor nem preço.
- Toda rota por `registro.rota(...)`; nova página com `<title>`, CSP e `tema.css` como as demais (ler `DESIGN.md`); o front não importa módulos do servidor.
- Mensagens em português; a de `itens_minimo` é exatamente 'Favor inserir pelomenos 1 item no pedido!'.
- Commits direto na `main`, mensagem terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Item de pedido antigo salvo sem mexer (todos `intacto`): não pode ser bloqueado por regra nova (teste na Task 5).
- Testes existentes que salvam item sem acabamento/revestimento/inteiros vão passar a falhar ao ligar o servidor: ajustar as fixtures, não afrouxar a regra (Task 5).
- Campo vazio nunca dispara `numero_inteiro` nem limites do puxador (Tasks 2 e 3).
- "1,5" e "1.5" e "-3" e "12a" em tamanho/quantidade bloqueiam; "0" e "1500" passam em `numero_inteiro` (Task 3).
- Itens importados por JSON/PDF não passam por `adicionarItem()`: a proteção deles é a do servidor ao salvar (Task 5; só conferir, nada a construir).

---

### Task 1: Motor de regras e regras de acabamento, cor, revestimento e medida pequena

**Files:**
- Create: `calculo/regras_item.js`
- Test: `test/regras_item.test.js`

**Interfaces:**
- Produces:
  - `LIMITES` (objeto congelado, valores acima).
  - `NIVEIS = Object.freeze({ BLOQUEIA: 'bloqueia', CONFIRMA: 'confirma', AVISA: 'avisa' })`.
  - `ehPorta(item): boolean` (por `item.frente`).
  - `REGRAS`: array congelado de `{ codigo, nivel, escopo, titulo, verifica(item) -> string|null }` (a string é a mensagem).
  - `avaliar(item): Array<{ codigo, nivel, mensagem }>` (só escopo `item`, na ordem de `REGRAS`; item `ehCopia` não chega aqui, o chamador filtra).
  - `avaliarDocumento(corpo): Array<{ codigo, nivel, mensagem }>` (só escopo `documento`).
  - `livro(): Array<{ codigo, nivel, escopo, titulo }>` (para a página).
- Consumes: `tipoCorDoAcabamento` de `calculo/cores.js` (devolve 'Sólida', 'Metálica' ou null).

- [ ] **Step 1: Escrever os testes que falham** em `test/regras_item.test.js` (helper local `porta(det, extra)` monta `{ frente: 'Porta de giro', altura: 2100, largura: 900, detalhes: det, ...extra }`). Testes e asserts:
  - `ehPorta`: "porta de giro" e "Porta de Correr" → true; "Serralheria", "Avulso", undefined → false.
  - `acabamento_perfil`: `{ perfil: 'P1', acabamento: '' }` → um resultado `bloqueia`; com acabamento → nenhum; sem perfil → nenhum; item Serralheria → nenhum.
  - `acabamento_puxador`: `{ puxador: 'X', acabPux: '' }` → `bloqueia`; sem puxador → nenhum.
  - `cor_obrigatoria`: acabamento 'Pintura Metálica' sem `cor` → `bloqueia`; 'Pintura Sólida' + `cor` → nenhum; acabamento 'Anodizado' sem cor → nenhum; mesma regra para `acabPux`/`corPux`.
  - `sem_revestimento`: `revestimento: ''` → `confirma` com mensagem 'Sem revestimento escolhido. Inserir na lista mesmo assim?'; com revestimento → nenhum.
  - `porta_medida_pequena`: `altura: 299` → `avisa`; `largura: 250` → `avisa`; `altura: 300, largura: 300` → nenhum; altura 0 ou vazia → nenhum.
  - `avaliarDocumento({ itens: [] })` → um `bloqueia` `itens_minimo` com a mensagem exata; com 1 item → `[]`.
  - `livro()` lista todas as `REGRAS` sem a função `verifica`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/regras_item.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `calculo/regras_item.js`** com as assinaturas acima. Regras desta task: `itens_minimo` (escopo documento), `acabamento_perfil`, `acabamento_puxador`, `cor_obrigatoria`, `sem_revestimento`, `porta_medida_pequena`. Ler números com um helper interno `inteiroOuNull(v)` (trim; só `^\d+$` vale; senão null). Mensagens no estilo do VB, citando o campo (ex.: 'Escolha o acabamento do perfil.').

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/regras_item.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add calculo/regras_item.js test/regras_item.test.js
git commit -m "feat: livro de regras, motor e regras de acabamento, cor, revestimento e medida"
```

### Task 2: Regras do puxador (embutido 50–400 mm, não maior que a porta)

**Files:**
- Modify: `calculo/regras_item.js`
- Test: `test/regras_item.test.js`

**Interfaces:**
- Consumes: `REGRAS`, `LIMITES`, `inteiroOuNull` da Task 1.
- Produces: regras `puxador_embutido_limites` e `puxador_maior_que_porta` (ambas `bloqueia`, escopo `item`); `dimensaoDaPortaParaPuxador(item): number|null`.

- [ ] **Step 1: Escrever os testes que falham**:
  - embutido (`tipoPuxador: 'Embutido'`): `tamanhoPux: '49'` e `'401'` → `bloqueia`; `'50'`, `'400'` → nenhum; `''` → nenhum; `'abc'` → nenhum (quem pega é `numero_inteiro`); `todaExt: true` com embutido não isenta (embutido nunca é toda extensão): `'500'` ainda bloqueia.
  - `tipoPuxador: 'Sobreposto'` com `tamanhoPux: '5000'` → só a regra de tamanho vs. porta pode disparar, a de embutido não.
  - `puxador_maior_que_porta`: `altura: 2100, largura: 900`, `tamanhoPux: '2200'` → `bloqueia`; `'2100'` → nenhum; `todaExt: true` (Sobreposto Total) → nenhum; `tamanhoPux` vazio → nenhum.
  - `dimensaoDaPortaParaPuxador`: devolve `null` se altura e largura inválidas.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/regras_item.test.js`
Expected: FAIL nos testes novos.

- [ ] **Step 3: Implementar.** Antes de escolher a dimensão, ler como o motor relaciona o puxador à porta (`calculo/precos.js` linhas 299–330, `chavePosicaoPreco` em 154, e `posicoesFolhas` em `detalhes`): se a posição indica puxador vertical use `altura`, se horizontal use `largura`; se não der para saber, use a maior das duas. Registrar a escolha em um comentário de uma linha.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/regras_item.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add calculo/regras_item.js test/regras_item.test.js
git commit -m "feat: regras do puxador no livro de regras"
```

### Task 3: Regra `numero_inteiro` (tamanhos e quantidades só inteiros)

**Files:**
- Modify: `calculo/regras_item.js`
- Test: `test/regras_item.test.js`

**Interfaces:**
- Consumes: `REGRAS` da Task 1.
- Produces: `CAMPOS_INTEIROS` (lista congelada de `{ rotulo, caminho }`) e regra `numero_inteiro` (`bloqueia`, escopo `item`, vale para TODAS as frentes, inclusive Serralheria e Avulso).

- [ ] **Step 1: Escrever os testes que falham**: para cada valor em `['1,5','1.5','-3','12a',' 7 x']` num campo qualquer (ex.: `altura`), `avaliar` devolve um `bloqueia` `numero_inteiro` citando o rótulo do campo; `'0'`, `'1500'`, `1500` (número), `''`, `null`, `undefined` não disparam. Um teste por grupo de campos: topo (`altura`, `largura`, `profundidade`, `soldas`, `qtd`, `qtdAltura`, `qtdLargura`, `qtdProfundidade`), `detalhes` (`tamanhoPux`, `divH`, `divV`, `transpasse`, `largurasFolhas[]`), `furos.lista[]`, `acessorios[].qtd` e `.tamanho`, `pecas[]` da serralheria (`altura`, `largura`, `profundidade`, `qtd`, `qtdAltura`, `qtdLargura`, `qtdProfundidade`, `soldas`) e `complementos[].qtd`. Nenhum teste inclui `valor` nem `descontoPct` (dinheiro não entra).

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/regras_item.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar** `CAMPOS_INTEIROS` e a regra: percorre os caminhos, ignora vazio/ausente, e para número (typeof number) exige `Number.isInteger`. Uma mensagem por campo inválido, citando o rótulo e dizendo "só números inteiros, sem vírgula nem ponto". Conferir em `coletarForm()` (`orcamentos.html:2538`) e `pecaParaEnvio` se há algum campo de tamanho/quantidade que esteja faltando na lista.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/regras_item.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add calculo/regras_item.js test/regras_item.test.js
git commit -m "feat: regra de numeros inteiros no livro de regras"
```

### Task 4: Rotas `POST /regras/verificar_item` e `GET /regras/livro`

**Files:**
- Create: `rotas/regras.js`
- Modify: `index.js` (require e `registrarRegras({ rota: registro.rota })` junto dos demais, perto da linha 1849)
- Test: `test/regras_rotas.test.js`; atualizar `test/seguranca_registro.test.js` e qualquer teste que liste as rotas registradas

**Interfaces:**
- Consumes: `avaliar`, `livro` da Task 1.
- Produces:
  - `registrarRegras({ rota })` exportada de `rotas/regras.js`.
  - `POST /regras/verificar_item` (permissão `orcamentos.criar`): corpo = o item; resposta `{ regras: [{ codigo, nivel, mensagem }] }`. Item `ehCopia` → `{ regras: [] }`. Corpo que não é objeto → 400.
  - `GET /regras/livro` (permissão `administrativo.ver`): `{ regras: [{ codigo, nivel, escopo, titulo }], limites: LIMITES }`.

- [ ] **Step 1: Escrever os testes que falham** seguindo `test/pesos_rotas.test.js` (servidor de teste de `test/apoio/`; criar `test/apoio/` helper só se o existente não servir): verificar_item com porta sem acabamento → 200 e uma regra `bloqueia`; corpo `null` → 400; sem a permissão → 403; `GET /regras/livro` com `administrativo.ver` → lista contém `itens_minimo` e `numero_inteiro`; sem a permissão → 403.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/regras_rotas.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar** `rotas/regras.js` no padrão de `rotas/pesos.js` (erro 500 genérico sem vazar mensagem). Registrar em `index.js`. Atualizar os testes de registro de rotas que contam rotas autenticadas.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/regras_rotas.test.js test/seguranca_registro.test.js test/seguranca_barreira.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rotas/regras.js index.js test/regras_rotas.test.js test/seguranca_registro.test.js
git commit -m "feat: rotas de consulta do livro de regras"
```

### Task 5: Servidor aplica as regras ao salvar (`validar()`)

**Files:**
- Modify: `rotas/ped_orc.js` (`validar`, linhas 151–191)
- Modify: fixtures dos testes que salvam itens (ver Step 4)
- Test: `test/ped_orc_regras.test.js`

**Interfaces:**
- Consumes: `avaliar`, `avaliarDocumento` da Task 1; `ehCopia` já existente em `rotas/ped_orc.js`.
- Produces: `validar(b)` passa a devolver, na ordem: erro de documento (`itens_minimo` mantém a posição e a mensagem de hoje), e, por item não-cópia, `Item N: <mensagem>` para o primeiro `bloqueia`; para `confirma` sem o código em `item.confirmacoes` (array de códigos), `Item N: confirmação pendente — <mensagem>`. `avisa` nunca bloqueia no servidor. Resposta continua HTTP 400 com `{ error }` como hoje.

- [ ] **Step 1: Escrever os testes que falham** (usar o banco simulado de `test/apoio/bancoPedOrc.js`, como em `test/ped_orc_web_reabrir.test.js`):
  - porta sem acabamento no `POST /ped_orc/salvar` → 400, mensagem começa com 'Item 1:' e nada é gravado.
  - porta sem revestimento sem `confirmacoes` → 400; com `confirmacoes: ['sem_revestimento']` → 200.
  - item `{ origem: { item: 1, estado: 'intacto' } }` com dados que violariam regras (sem acabamento, decimal) → 200 (não revalidado).
  - item com `origem.estado: 'editado'` violando regra → 400.
  - porta com `altura: 250` (`avisa`) → 200.
  - documento sem itens → 400 com 'Favor inserir pelomenos 1 item no pedido!'.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/ped_orc_regras.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar** o gancho em `validar()` dentro do laço que já percorre `b.itens` (depois das checagens de `detalhes` e quantidade, antes do retorno `null`). Manter a ordem atual das mensagens existentes.

- [ ] **Step 4: Rodar a suíte inteira e consertar as fixtures**

Run: `npm test`
Expected: testes antigos que salvavam itens "pelados" (sem acabamento, revestimento ou com decimais) agora falham em 400. Ajustar **as fixtures desses testes** (acrescentar acabamento/cor/`confirmacoes`/inteiros), nunca afrouxar a regra. Repetir até `npm test` passar inteiro.

- [ ] **Step 5: Commit**

```bash
git add rotas/ped_orc.js test/ped_orc_regras.test.js test/
git commit -m "feat: servidor aplica o livro de regras ao salvar orcamentos e pedidos"
```

### Task 6: Tela consulta o Livro ao adicionar item e trava a digitação

**Files:**
- Modify: `orcamentos.html` (`adicionarItem`, linha 2809; campos de tamanho e quantidade do formulário)
- Test: `test/regras_tela.test.js`

**Interfaces:**
- Consumes: `POST /regras/verificar_item` da Task 4 (corpo = `coletarForm()`; resposta `{ regras }`).
- Produces: função da tela `consultarRegras(item): Promise<{ ok: boolean, confirmacoes: string[] }>` usada por `adicionarItem()`.

- [ ] **Step 1: Escrever o teste que falha** no estilo de `test/pesos_tela.test.js` / `test/peso_tela.test.js` (lê o HTML e/ou extrai a função): confere que `adicionarItem` chama `/regras/verificar_item` depois das checagens locais e antes de `itens.push`, que qualquer regra `bloqueia` impede o push, que `confirma`/`avisa` usam `confirm` com "Corrigir"/"Continuar assim" (ou o texto equivalente) e gravam os códigos aceitos em `item.confirmacoes`, e que erro de rede/401/403 na consulta **não adiciona** e mostra o erro. Confere também que os `<input>` de tamanho e quantidade têm `inputmode="numeric"` e tratamento que remove não-dígitos.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/regras_tela.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar** `consultarRegras` (mesmo padrão de `fetch` + `getToken()` + tratamento de 401 que já existe na tela) e o gancho em `adicionarItem()`. Na edição de item, a confirmação é pedida de novo. Para os campos de tamanho/quantidade, trocar `type="number"` por `type="text" inputmode="numeric"` com filtro de dígitos no evento `input` (nunca nos campos de valor em dinheiro nem desconto).

- [ ] **Step 4: Rodar e ver passar** (e a suíte da tela de orçamentos)

Run: `node --test test/regras_tela.test.js` e depois `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orcamentos.html test/regras_tela.test.js
git commit -m "feat: tela de orcamentos consulta o livro de regras e so aceita inteiros"
```

### Task 7: Página "Livro de regras" (leitura)

**Files:**
- Create: `regras.html`, `regras.js`
- Modify: `layout.js` (menu e mapa de permissões, junto da linha 54 e 103: `'regras.html': ['administrativo.ver']`)
- Test: `test/regras_pagina.test.js`

**Interfaces:**
- Consumes: `GET /regras/livro` da Task 4.
- Produces: página com tabela (código, nível, escopo, título) e os limites, cabeçalho fixo (regra do projeto: tabela com rolagem mantém o cabeçalho visível), com o olho dos resumos não necessário (não é informação analítica).

- [ ] **Step 1: Escrever o teste que falha**: a página carrega `tema.css` por último, tem CSP, não tem script nem estilo inline, o `layout.js` mapeia `regras.html` para `administrativo.ver`, e `regras.js` chama `/regras/livro`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/regras_pagina.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar** a página seguindo `DESIGN.md` e uma página simples existente como `pesos.html`; subitem do menu em Administração/Usuários conforme couber.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/regras_pagina.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add regras.html regras.js layout.js test/regras_pagina.test.js
git commit -m "feat: pagina de leitura do livro de regras"
```

### Task 8: Documentação

**Files:**
- Create: `docs/regras/livro-de-regras.md`
- Modify: `CLAUDE.md` (resumo curto em "Funcionalidades", item na árvore de pastas e seção 5 com ponteiro, no formato das demais)

- [ ] **Step 1: Escrever `docs/regras/livro-de-regras.md`** com: níveis, tabela das regras da v1, como acrescentar regra (entrada em `REGRAS` + teste + nada mais), onde ficam os limites, o que nunca é revalidado (cópias), as decisões do dono de 2026-11-23 (sem embutido total; só inteiros) e o que ainda não foi validado na prática (tela em uso real com vendedores).
- [ ] **Step 2: Atualizar `CLAUDE.md`** com o resumo e o ponteiro "Regras completas: `docs/regras/livro-de-regras.md` (ler antes de mexer neste módulo)".
- [ ] **Step 3: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS, sem falhas.

- [ ] **Step 4: Commit**

```bash
git add docs/regras/livro-de-regras.md CLAUDE.md
git commit -m "docs: livro de regras"
```
