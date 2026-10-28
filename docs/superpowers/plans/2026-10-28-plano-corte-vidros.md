# Plano de corte de vidros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A partir de um Pedido, distribuir as peças de vidro (`vidros`) em chapas do estoque (guilhotina 2D, rotação 90°), com retalhos, marcação de peças cortadas e baixa obrigatória das chapas novas no estoque ao confirmar.

**Architecture:** Módulo paralelo ao corte de perfis (`rotas/corte.js` não é alterado): funções puras em `calculo/vidro_*.js`, rotas em `rotas/corte_vidros.js`, tabelas `web_vidro_*`, tela `corte_vidros.html/.js`. Reaproveita `rotas/transacao.js`, `rotas/estoque_saida.js` (`travarProdutos`, `conferirSaldo`, `gravarSaidas`) e o padrão de testes com banco falso. O produto de estoque escolhido por grupo define a chapa (`estoque.ALTURA` x `estoque.LARGURA`) e é o mesmo da baixa.

**Tech Stack:** Node.js + Express 4, mysql2, `node:test` + `node:assert/strict`, front-end HTML/CSS/JS puro com CSP por página.

**Spec:** `docs/superpowers/specs/2026-10-28-plano-corte-vidros-design.md` (ler junto; ele manda onde este plano for omisso).

## Global Constraints

- Medidas em **mm inteiros**; `vidros.TAMANHO` = `"altura x largura"` (ex. `2645x495`) e já é a medida final de corte (nenhuma folga a descontar). Na chapa: `altura` = `estoque.ALTURA`, `largura` = `estoque.LARGURA`; eixo x = largura, eixo y = altura.
- `estoque.QTD_ESTOQUE` dos vidros conta **chapas**: a baixa abate **1 por chapa nova** usada; retalho não baixa. Dois grupos com o mesmo produto **somam** na baixa (não se recusa).
- Produtos candidatos: `estoque.CLASSE = 'Revestimento'`, `SITUACAO = 'Ativo'`, `ALTURA > 0` e `LARGURA > 0`. Pré-seleção por nome: `"Vidro " + MODELO` (sem diferenciar caixa, acento nem espaços); só pré-seleciona se houver exatamente um candidato.
- Padrões: folga de serra **0 mm**, sobra mínima de retalho **300 mm** (os dois lados). Corte em guilhotina, rotação de 90° sempre permitida.
- Conferência de peças: linha de `vidros` só vale se existir em `ped_orc_itens_v4` (`TIPO = 'Pedido'`) linha do mesmo `ITEM_PEDIDO` com `REVESTIMENTO = MODELO` e `COR_REVESTIMENTO` igual (nulo = vazio; sem diferenciar caixa/espaços). **Quantidades não são comparadas.** Não bateu = pendência; nunca estimar.
- Só Pedido; pedido sem vidros = 404 com a mensagem exata `Este pedido não tem vidros.`
- Toda rota por `rota(...)` do registro (`registro.verificar()` impede subir se faltar). Permissões já existentes: `corte.ver`, `corte.planejar`, `corte.parametros`; confirmar plano com chapa nova exige também `estoque.ver` + `estoque.movimentar` (403 caso contrário). **Nenhuma permissão nova.**
- Nada é dinheiro: as rotas não exigem `valores.ver`; nenhum nome de campo na resposta pode casar com `REGEX_VALOR` (`seguranca/valores.js`) — use `qtd*`, `chapas`, `area*`. Teste varre os nomes.
- Tabelas só da web (`web_vidro_*`), em `seguranca/instalacao.js`, sem FK, nunca alteram tabelas do VB. Colunas no estilo do corte de perfis (`pedido`, `situacao`, `plano_origem`, `plano_reserva`), que prevalece sobre os nomes conceituais do spec.
- Mensagens ao usuário em português. Gravação em transação (`emTransacao`, `ErroUsuario`, `agoraLocal` de `rotas/transacao.js`); auditoria em `web_auditoria` só com nomes de campos/quantidades.
- Testes sem MySQL real (bancos falsos em `test/apoio/`), `process.env.JWT_SECRET='teste'`, `NODE_ENV='test'`. A tela real no navegador não é testada automaticamente.
- Trabalho direto na `main`, commits pequenos por tarefa, sem branch e sem push. Terminar cada mensagem de commit com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Fora do escopo: vários pedidos no mesmo plano, retalho em L, mais de uma chapa por grupo, etiquetas/PDF, desfazer a baixa.

## Review Focus

Entradas que o spec implica e nenhuma tarefa exercitaria sozinha (cada uma tem teste na tarefa dona):

1. `vidros` de um pedido sobrescrito por orçamento de mesmo número (modelo/cor sem correspondência nos itens do Pedido) → pendência, nenhuma peça no plano. (Tarefa 1)
2. `TAMANHO` malformado: `''`, `'abc'`, `'0x500'`, `'2645X495 '` (maiúscula/espaço, aceitar), `'2645,5x495'` (vírgula, arredondar) e `QTD` 0/fracionária/nula → pendência ou parse correto, nunca exceção. (Tarefa 1)
3. Peça maior que a chapa escolhida mesmo girada, ou produto com `ALTURA`/`LARGURA` ≤ 0 → erro explicado no grupo, sem 500 e sem as demais peças do grupo sumirem em silêncio. (Tarefas 2 e 5)
4. Saldo insuficiente na **soma** de dois grupos que usam o mesmo produto → 400 e nada muda (estoque, saídas, retalhos, plano). (Tarefa 7)
5. Entre pré-visualização e salvar/confirmar: retalho reservado por outro plano, produto escolhido desativado ou trocado, vidros do pedido alterados → 409/400, sem gravar parcial. (Tarefas 6 e 7)

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `calculo/vidro_pecas.js` (novo) | Peças e pendências a partir de `vidros` + itens do Pedido; chave de grupo; impressão digital |
| `calculo/vidro_otimizacao.js` (novo) | Encaixe 2D em guilhotina com rotação, retalhos, sobras (puro, determinístico) |
| `calculo/vidro_validacao.js` (novo) | Validação de parâmetros, retalho manual e conferência do corte |
| `seguranca/instalacao.js` (mod.) | 3 tabelas `web_vidro_*` |
| `rotas/corte_vidros.js` (novo) | Todas as rotas `/corte_vidros/*` e `liberarPlanosVidroDoPedido` |
| `rotas/ped_orc.js` (mod., 2 linhas) | Chama `liberarPlanosVidroDoPedido` ao cancelar/excluir pedido |
| `index.js` (mod.) | `registrarCorteVidros({ rota, pool })` ao lado de `registrarCorte` |
| `corte_vidros.html` / `corte_vidros.js` (novos) | Tela: plano, retalhos, parâmetros |
| `layout.js` (mod.) | Subitem de menu e permissão da página |
| `test/apoio/bancoVidros.js` (novo) | Banco falso com estado |
| `CLAUDE.md` (mod.) | Seção "Plano de corte de vidros" |

---

### Task 1: Peças de vidro e conferência com os itens do Pedido

**Files:**
- Create: `calculo/vidro_pecas.js`
- Test: `test/vidro_pecas.test.js`

**Interfaces:**
- Produces:
  - `montarPecasVidro({ vidros, itens }) -> { pecas, pendencias }`. `vidros`: linhas `{ id, MEDICAO, ITEM, QTD, MODELO, COR_REVESTIMENTO, TAMANHO }`; `itens`: linhas `{ ITEM_PEDIDO, REVESTIMENTO, COR_REVESTIMENTO }` do Pedido. Peça: `{ modelo, cor, altura, largura, item, medicao }` (uma por unidade de `QTD`). Pendência: `{ item, modelo, motivo }`.
  - `chaveGrupoVidro(peca) -> string` = `` `${modelo}|${cor}` ``.
  - `impressaoPecasVidro(pecas) -> string` (SHA-256 hex da lista ordenada `modelo|cor|altura|largura|item`).
  - `normalizar(s) -> string` (trim, espaços colapsados, minúsculas) exportada para as rotas casarem nomes.

- [ ] **Step 1: Escrever os testes que falham** em `test/vidro_pecas.test.js` (mesmo estilo de `test/corte_pecas.test.js`): 
  - `'uma linha com QTD 2 vira 2 peças altura x largura'`: `TAMANHO '2645x495'`, `QTD 2` → duas peças `{ altura: 2645, largura: 495 }`.
  - `'cor em branco é válida e agrupa com cor vazia'`; `'chave de grupo = modelo|cor'`.
  - `'modelo sem correspondência nos itens do Pedido vira pendência e não gera peça'` (Review Focus 1), e `'item que não existe nos itens do Pedido vira pendência'`.
  - `'quantidades dos itens não são comparadas'`: vidros QTD 9, item REVESTIMENTO igual com QTD 3 → 9 peças.
  - `'TAMANHO malformado'` (Review Focus 2): casos `''`, `'abc'`, `'0x500'`, `'2645x'` → pendência com motivo contendo `tamanho`; `'2645X495 '` → ok; `'2645,5x495'` → altura 2646 (arredonda); `QTD` 0, `1.5`, `null` → pendência `quantidade`.
  - `'impressão muda quando uma medida muda e não muda com a ordem das linhas'`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test test/vidro_pecas.test.js` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** as quatro funções em `calculo/vidro_pecas.js`. O `TAMANHO` é lido com regex `^\s*(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*$`, vírgula → ponto, `Math.round`; altura/largura ≤ 0 = pendência. `QTD` precisa ser inteiro > 0. A conferência é por `normalizar` em `MODELO`/`REVESTIMENTO` e `COR_REVESTIMENTO`, sempre dentro do mesmo item. Estilo e helpers (`txt`, `inteiro`) iguais aos de `calculo/corte_pecas.js`.
- [ ] **Step 4: Rodar** `node --test test/vidro_pecas.test.js` → PASS.
- [ ] **Step 5: Commit** — `git add calculo/vidro_pecas.js test/vidro_pecas.test.js && git commit -m "feat(corte-vidros): peças de vidro e conferência com os itens do pedido"`.

---

### Task 2: Otimização 2D em guilhotina

**Files:**
- Create: `calculo/vidro_otimizacao.js`
- Test: `test/vidro_otimizacao.test.js`

**Interfaces:**
- Consumes: peças de `montarPecasVidro` (Tarefa 1) e `chaveGrupoVidro`.
- Produces:
  - `PADRAO = { serra: 0, sobraMinima: 300 }`.
  - `otimizarVidros({ pecas, retalhos, chapaDe, parametros }) -> { grupos, resumo }` onde:
    - `retalhos`: `{ id, produtoCodigo, altura, largura }[]`;
    - `chapaDe(chave) -> { produtoCodigo, produtoNome, altura, largura } | null` (null = grupo "aguardando produto");
    - `parametros`: `{ serra, sobraMinima }`;
    - `grupos[]`: `{ chave, modelo, cor, produtoCodigo, produtoNome, aguardandoProduto, chapa: {altura, largura} | null, chapas: [...], erros: string[] }`;
    - `chapas[]`: `{ tipo: 'chapa'|'retalho', retalhoId?, altura, largura, pecas: [{ x, y, altura, largura, girada, item, medicao }], sobras: [{ x, y, altura, largura }], aproveitamentoPct }` (x ao longo da largura, y ao longo da altura; `altura`/`largura` da peça já na orientação colocada);
    - `resumo`: `{ qtdChapasNovas, qtdRetalhosUsados, qtdPecas, qtdPecasSemChapa }`.
  - Peças de um grupo `aguardandoProduto` ficam fora e não geram erro.

- [ ] **Step 1: Testes que falham** em `test/vidro_otimizacao.test.js`:
  - `'duas peças que cabem lado a lado usam uma chapa'` (chapa 2400x3210; duas peças 1000x1500).
  - `'gira a peça quando só assim cabe'` (peça 3000x500 em chapa altura 2400/largura 3210 → `girada: true`).
  - `'peça maior que a chapa mesmo girada gera erro no grupo e as outras peças continuam'` (Review Focus 3); `'chapa com altura ou largura <= 0 gera erro e não lança'`.
  - `'serra: duas peças que só cabem sem folga não cabem com serra 3'`.
  - `'nenhuma peça se sobrepõe nem sai da chapa'` (varre `pecas` de cada chapa, com serra, em 6 cenários fixos, incl. 40 peças pseudo-aleatórias com semente fixa).
  - `'sobras só têm lados >= sobraMinima e não cruzam peças'`.
  - `'retalho do mesmo produto é usado antes de chapa nova; retalho de outro produto nunca'`; `'retalho pequeno demais para qualquer peça fica de fora'`.
  - `'n. de chapas novas >= teto de área'` e `'<= nº de peças'` (limites de sanidade); `'resultado idêntico em duas execuções'` (determinismo).
  - `'grupo sem produto escolhido (chapaDe -> null) fica aguardandoProduto sem erro e sem chapas'`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test test/vidro_otimizacao.test.js` → FAIL.
- [ ] **Step 3: Implementar** `otimizarVidros` em `calculo/vidro_otimizacao.js`. Algoritmo (o enunciado não o determina):
  - Por grupo, gerar candidatos com **guilhotina por retângulos livres** (colocar a peça no retângulo livre de melhor encaixe por área, escolhendo a rotação que sobra menos; dividir o retângulo restante em dois por eixo de menor sobra, descontando `serra` do lado cortado) e uma variante **por faixas (shelf)**; cada um com 4 ordens de peças (área, lado maior, altura, largura, todas decrescentes).
  - Em todo candidato usa-se primeiro os retalhos (área crescente) e só então chapa nova.
  - Escolher por: menos chapas novas → menor área de chapa nova usada → menos sobras (retângulos livres) com algum lado < `sobraMinima`; empate = primeira ordem fixa (determinismo).
  - `sobras` = retângulos livres finais com os dois lados ≥ `sobraMinima`.
  - Guarda: se a melhor candidata usar mais chapas novas que a variante shelf, usar a shelf.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `git add calculo/vidro_otimizacao.js test/vidro_otimizacao.test.js && git commit -m "feat(corte-vidros): otimização 2D em guilhotina com rotação e retalhos"`.

---

### Task 3: Validação de entradas

**Files:**
- Create: `calculo/vidro_validacao.js`
- Test: `test/vidro_validacao.test.js`

**Interfaces:**
- Consumes: formato do plano de `otimizarVidros` (Tarefa 2).
- Produces (mesmo estilo de retorno `{ ok, dados } | { ok: false, erro }` de `calculo/corte_validacao.js`):
  - `LIMITE_MM` (= 20000).
  - `validarConfigVidros(corpo) -> { ok, dados: { serra, sobraMinima } }` — inteiros ≥ 0; `sobraMinima` ≥ 1; teto `LIMITE_MM`.
  - `validarRetalhoVidro(corpo) -> { ok, dados: { produtoCodigo, altura, largura } }` — `produtoCodigo` inteiro > 0; lados inteiros 1..`LIMITE_MM`.
  - `validarConferenciaVidros(corpo, plano) -> { ok, sobras: [{ grupo, chapa, sobra, destino, altura, largura }] }`: `corpo.sobras` pode ser vazio; cada item referencia `grupo` (chave), `chapa` (índice) e `sobra` (índice) existentes; `destino` ∈ `guardar|descartar`; medida real (`altura`,`largura`) ≤ calculada em cada lado e inteira > 0; duplicata = erro.

- [ ] **Step 1: Testes que falham** em `test/vidro_validacao.test.js`: config válida/negativa/decimal/acima do teto; retalho com lado 0, texto e código ausente; conferência com sobra inexistente, destino inválido, medida real maior que a calculada, duplicada, e válida.
- [ ] **Step 2: Rodar e ver falhar** — `node --test test/vidro_validacao.test.js` → FAIL.
- [ ] **Step 3: Implementar** as três funções (mensagens em português, uma por regra).
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `git add calculo/vidro_validacao.js test/vidro_validacao.test.js && git commit -m "feat(corte-vidros): validação de parâmetros, retalho e conferência"`.

---

### Task 4: Tabelas `web_vidro_*`

**Files:**
- Modify: `seguranca/instalacao.js` (lista de `CREATE TABLE`, depois de `web_corte_planos`, ~linha 152)
- Test: `test/corte_vidros_instalacao.test.js` (mesmo padrão de `test/notas_instalacao.test.js`)

**Interfaces:**
- Produces (nomes exatos usados pelas Tarefas 5–7):
  - `web_vidro_config` (`id INT PK`, `serra INT NULL`, `sobra_minima INT NULL`, `atualizado_em DATETIME`, `atualizado_por VARCHAR(100)`); linha única `id = 1`.
  - `web_vidro_retalhos` (`id` AI PK, `produto_codigo INT NOT NULL`, `produto_nome VARCHAR(190) NOT NULL`, `altura INT NOT NULL`, `largura INT NOT NULL`, `situacao ENUM('disponivel','reservado','usado','descartado') DEFAULT 'disponivel'`, `plano_origem INT NULL`, `plano_reserva INT NULL`, `criado_por`, `criado_em`, `atualizado_em`, `KEY ix_vretalho (situacao, produto_codigo)`).
  - `web_vidro_planos` (`id` AI PK, `pedido INT NOT NULL`, `situacao ENUM('gerado','conferido','cancelado') DEFAULT 'gerado'`, `impressao_pecas CHAR(64) NOT NULL`, `parametros LONGTEXT`, `resultado LONGTEXT NOT NULL`, `progresso LONGTEXT`, `criado_por`, `criado_em`, `conferido_por`, `conferido_em`, `excluido_em DATETIME NULL`, `KEY ix_vplano_pedido (pedido, situacao)`).

- [ ] **Step 1: Teste que falha**: `instalarTabelas` com pool falso emite os três `CREATE TABLE IF NOT EXISTS` e nenhum `ALTER`/`DROP` em tabela fora de `web_*` (seguir o teste de notas).
- [ ] **Step 2: Rodar e ver falhar** — `node --test test/corte_vidros_instalacao.test.js` → FAIL.
- [ ] **Step 3: Acrescentar** os três `CREATE TABLE` com `${OPCOES}` como as vizinhas, com o comentário "mm inteiros; `pedido` = referência lógica a `ped_orc.NUMERO`; sem FK".
- [ ] **Step 4: Rodar** esse teste e `npm test` → PASS (sem regressões).
- [ ] **Step 5: Commit** — `git add seguranca/instalacao.js test/corte_vidros_instalacao.test.js && git commit -m "feat(corte-vidros): tabelas web_vidro_config, web_vidro_retalhos e web_vidro_planos"`.

---

### Task 5: Banco falso, rotas de leitura (parâmetros, retalhos, produtos, pré-visualização)

**Files:**
- Create: `test/apoio/bancoVidros.js`, `rotas/corte_vidros.js`
- Modify: `index.js` (importar e chamar `registrarCorteVidros({ rota, pool })` junto de `registrarCorte`)
- Test: `test/corte_vidros_rotas.test.js`

**Interfaces:**
- Consumes: Tarefas 1–4.
- Produces:
  - `bancoVidros()` / `prepararVidros(t, { banco })` / `corpoConfirmacao(...)` em `test/apoio/bancoVidros.js`, no molde de `test/apoio/bancoCorte.js` (estado em memória, regras por regex de SQL, rollback por foto, perfis de teste `Corte`, `Planeja`, `Planeja sem estoque`, `Planeja, estoque só ver`, `Só ver corte`, `Sem acesso`; estoque semeado com `Vidro Incolor 4mm` 2400x3210 qtd 26, `Vidro Extra Clear 4mm - 2400mm`, `Vidro Extra Clear 4mm - 2540mm`, `Vidro Reflecta Fumê 4mm` e um produto Revestimento Inativo; `semear.pedido/vidro/item/retalho`).
  - `registrarCorteVidros({ rota, pool })` e, exportada, `liberarPlanosVidroDoPedido(conn, numero, quem, { excluindo })` (corpo na Tarefa 6).
  - Rotas desta tarefa (constantes `VER`, `PARAMETROS`, `PLANEJAR`, `BAIXAR_ESTOQUE` como em `rotas/corte.js`):
    - `GET /corte_vidros/config` (`VER`) → `{ padraoDeFabrica: PADRAO, padrao: { serra, sobraMinima } }`; `PUT /corte_vidros/config` (`PARAMETROS`, `validarConfigVidros`, auditoria `corte_vidros_config_alterada`).
    - `GET /corte_vidros/retalhos?situacao=`, `POST /corte_vidros/retalhos`, `PUT /corte_vidros/retalhos/:id`, `POST /corte_vidros/retalhos/:id/descartar` (mesma lógica das de perfis; `POST/PUT/descartar` exigem `PARAMETROS`; o produto do retalho manual precisa existir entre os candidatos).
    - `GET /corte_vidros/estoque/produtos` (`[...PLANEJAR, ...BAIXAR_ESTOQUE]`) → `{ produtos: [{ codigo, nome, unidade, altura, largura, qtdEstoque }] }` só candidatos; `LIMIT 3000`.
    - `GET /corte_vidros/pedido/:numero?escolhas=<JSON {chave: codigo}>` (`VER`) → pré-visualização sem gravar: `{ pedido, vazio, mensagem, qtdPecas, pendencias, grupos (resumo por chave com candidatos e preSelecionado), plano, impressao, retalhosUsados, planoSalvo, qtdPlanosGravados, qtdConferidos }`. Pedido inexistente/`abc` = 404; pedido sem linhas em `vidros` = 404 com `Este pedido não tem vidros.`; `escolhas` ilegível = 400.
  - Funções internas `lerPecasVidroDoPedido(db, numero)`, `calcularPlanoVidro(db, numero, escolhas, planoId, travar)` → `{ pecas, pendencias, plano, impressao, retalhosUsados, parametros, produtosUsados }` (usada também pelas Tarefas 6 e 7). Produto escolhido que não é candidato (inativo, fora da classe, sem medida) = grupo com erro explicado, não 500.

- [ ] **Step 1: Testes que falham** em `test/corte_vidros_rotas.test.js`: 
  - config GET/PUT (padrão 0/300, valores inválidos 400, sem permissão 403); 
  - retalhos CRUD e descartar; 
  - produtos só `Revestimento` ativos com medida; 
  - pré-visualização: pedido com 2 grupos, pré-seleção `Vidro Incolor 4mm` quando único e **sem** pré-seleção quando há dois candidatos (Extra Clear 2400/2540) e para `Pintado Sólido (...)`; grupo sem escolha = `aguardandoProduto` sem erro; escolha de produto inativo → erro do grupo; peça maior que a chapa → erro (Review Focus 3); pedido só com orçamento de mesmo número → pendências (Review Focus 1); 404 de pedido inexistente e de pedido sem vidros (mensagem exata); `escolhas` inválido → 400; **a pré-visualização não escreve nada** (`escritas(banco)` vazio); `nomesDeCampo` de toda resposta não casa `REGEX_VALOR`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test test/corte_vidros_rotas.test.js` → FAIL.
- [ ] **Step 3: Implementar** `test/apoio/bancoVidros.js` e `rotas/corte_vidros.js` (seguindo `rotas/corte.js` linha a linha para estrutura, `idDaRota`, `auditar`, tratamento de erro 500), e registrar no `index.js`. SQL das peças: `SELECT id, MEDICAO, ITEM, QTD, MODELO, COR_REVESTIMENTO, TAMANHO FROM vidros WHERE NUMERO = ? ORDER BY id` e `SELECT ITEM_PEDIDO, REVESTIMENTO, COR_REVESTIMENTO FROM ped_orc_itens_v4 WHERE NUMERO = ? AND TIPO = 'Pedido'`.
- [ ] **Step 4: Rodar** → PASS; depois `npm test` (o app precisa subir com `registro.verificar()`).
- [ ] **Step 5: Commit** — `git add rotas/corte_vidros.js index.js test/apoio/bancoVidros.js test/corte_vidros_rotas.test.js && git commit -m "feat(corte-vidros): rotas de parâmetros, retalhos, produtos e pré-visualização"`.

---

### Task 6: Salvar plano, ler plano, marcar peças, cancelar e ligação com o pedido

**Files:**
- Modify: `rotas/corte_vidros.js`, `rotas/ped_orc.js` (duas linhas, ao lado das chamadas de `liberarPlanosDoPedido`, ~589 e ~630), `test/apoio/bancoPedOrc.js` (regras SQL de `web_vidro_planos`/`web_vidro_retalhos` se o teste de cancelar/excluir quebrar sem elas)
- Test: `test/corte_vidros_plano_rotas.test.js`; estender `test/ped_orc_cancelar_excluir.test.js`

**Interfaces:**
- Consumes: `calcularPlanoVidro` (Tarefa 5).
- Produces (corpos no padrão do corte de perfis):
  - `POST /corte_vidros/pedido/:numero/salvar` (`PLANEJAR`) corpo `{ impressao, retalhosUsados, escolhas }`: recalcula com retalhos travados (`FOR UPDATE`); 409 se a impressão ou os retalhos usados diferirem, se o pedido estiver Cancelado, se já houver plano conferido, se não houver peças, se houver grupo `aguardandoProduto` ou com erro de chapa (mensagem pede para escolher o produto); reserva retalhos (409 se outro plano pegou); substitui o plano `gerado` anterior; `resultado` guarda `{ qtdPecas, pendencias, plano, escolhas }`; auditoria `corte_vidros_plano_salvo`. Resposta `{ ok, id, pedido }`.
  - `GET /corte_vidros/plano/:id` (`VER`) → `{ id, pedido, situacao (calcula 'desatualizado' pela impressão), criadoPor, criadoEm, conferidoPor, conferidoEm, qtdPecas, pendencias, plano, escolhas, cortadas }`.
  - `PUT /corte_vidros/plano/:id/pecas` (`PLANEJAR`) corpo `{ marcas: [{ grupo, chapa, peca, cortada }] }` ou uma marca só; até 500; só plano `gerado`; progresso `[{ grupo, chapa, peca }]`.
  - `POST /corte_vidros/plano/:id/cancelar` (`PLANEJAR`) → solta reservas, `situacao='cancelado'`, auditoria `corte_vidros_plano_cancelado`.
  - `liberarPlanosVidroDoPedido(conn, numero, quem = '', { excluindo = false } = {})` (mesma semântica de `liberarPlanosDoPedido`: cancela planos `gerado`, solta reservas, audita `corte_vidros_plano_cancelado_com_pedido`; com `excluindo` marca `excluido_em` nos conferidos).

- [ ] **Step 1: Testes que falham**: salvar feliz (grava plano, reserva o retalho, auditoria); salvar com `impressao` velha → 409; **retalho reservado por outro plano entre preview e salvar → 409 sem gravar nada** (Review Focus 5); **vidros do pedido alterados entre preview e salvar → 409**; produto escolhido desativado entre preview e salvar → 409/400; salvar de novo substitui o plano anterior e libera suas reservas; grupo sem produto → 409; pedido cancelado → 409; marcação em lote, marca inválida 400, plano não gerado 409; `GET plano` calcula `desatualizado`; cancelar solta reservas; cancelar/excluir **pedido** pelo `ped_orc` cancela o plano de vidros e solta retalhos na mesma transação (estender `ped_orc_cancelar_excluir.test.js`), e excluir marca o conferido com `excluido_em`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test test/corte_vidros_plano_rotas.test.js test/ped_orc_cancelar_excluir.test.js` → FAIL.
- [ ] **Step 3: Implementar** as rotas e `liberarPlanosVidroDoPedido` em `rotas/corte_vidros.js` (exportar), e chamá-la em `rotas/ped_orc.js` junto de cada `liberarPlanosDoPedido(...)` (mesmos argumentos).
- [ ] **Step 4: Rodar** os dois arquivos e `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add rotas/corte_vidros.js rotas/ped_orc.js test/apoio test/corte_vidros_plano_rotas.test.js test/ped_orc_cancelar_excluir.test.js && git commit -m "feat(corte-vidros): salvar, ler, marcar peças e cancelar plano; liga ao cancelar/excluir pedido"`.

---

### Task 7: Confirmar o corte com baixa de chapas e excluir dados

**Files:**
- Modify: `rotas/corte_vidros.js`
- Test: `test/corte_vidros_baixa_estoque.test.js`, `test/corte_vidros_excluir_dados.test.js`

**Interfaces:**
- Consumes: `travarProdutos`, `conferirSaldo`, `gravarSaidas` de `rotas/estoque_saida.js`; `validarConferenciaVidros` (Tarefa 3).
- Produces:
  - `POST /corte_vidros/plano/:id/confirmar` (`PLANEJAR`) corpo `{ sobras, retalhosNaoUsados, baixas: [{ chave, produtoCodigo }] }`. Na mesma transação: valida conferência; sobra `guardar` abaixo de `sobraMinima` (dos parâmetros gravados no plano) → 400; **baixa** (função interna `baixarChapasNovas(conn, req, plano, corpo, escolhas)`): conta chapas `tipo === 'chapa'` por grupo, exige 403 sem `BAIXAR_ESTOQUE` apenas se houver chapa nova, exige uma baixa por grupo com chapa nova, cada `produtoCodigo` **igual ao de `escolhas[chave]`** (senão 400), **soma por produto**, `travarProdutos`, `conferirSaldo(prod, somaDoProduto)`, `gravarSaidas(conn, itens, { quando: agoraLocal(), usuario })`; retalho usado → `usado`, não usado → `disponivel`; sobras `guardar` viram `web_vidro_retalhos` (`produto_codigo/nome` do grupo); plano → `conferido` (409 na segunda vez, sem baixar de novo); auditoria `corte_vidros_conferido` e `corte_vidros_baixa_estoque` (`itens: [{ produto, qtd }]`). Resposta `{ ok, id, situacao, qtdRetalhosUsados, qtdRetalhosNovos, baixas }`.
  - `DELETE /corte_vidros/pedido/:numero` (`PLANEJAR`): apaga todos os planos do pedido e solta reservas; plano conferido exige `incluirConferidos: true` (409 com `exigeConfirmacaoConferido`) e `corte.parametros` (403); auditoria `corte_vidros_dados_pedido_excluidos`.

- [ ] **Step 1: Testes que falham** (`baixa_estoque`): baixa correta (1 por chapa, `saida_estoque`, `QTD_ESTOQUE`); **dois grupos no mesmo produto somam** (ex.: Extra Clear branco e New York, 3+2 chapas → saída total 5); **saldo insuficiente na soma → 400 e nada muda** (Review Focus 4); `baixas` ausente / produto faltando / chave desconhecida ou repetida / produto diferente do da geração → 400; produto desativado entre salvar e confirmar → 400 sem gravar (Review Focus 5); plano só com retalhos confirma sem baixa e sem exigir permissões de estoque; plano com chapa nova sem `estoque.movimentar` → 403; falha depois da baixa (retalho que perdeu a reserva) → **rollback total** (estoque, saídas, retalhos, plano); confirmar 2× → 409 sem nova baixa; sobras guardadas viram retalhos do produto certo; sobra abaixo da mínima 400; auditoria com nomes/quantidades e sem nomes de campo que casem `REGEX_VALOR`. (`excluir_dados`): sem planos 404; conferido sem flag 409; sem `corte.parametros` 403; com tudo → apaga e solta reservas.
- [ ] **Step 2: Rodar e ver falhar** — `node --test test/corte_vidros_baixa_estoque.test.js test/corte_vidros_excluir_dados.test.js` → FAIL.
- [ ] **Step 3: Implementar** `confirmar`, `baixarChapasNovas` e `excluir` em `rotas/corte_vidros.js`, espelhando `confirmar`/`baixarVarasNovas`/`delete` de `rotas/corte.js` (a baixa roda antes de alterar retalhos para o rollback cobrir tudo).
- [ ] **Step 4: Rodar** os dois arquivos e `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add rotas/corte_vidros.js test/corte_vidros_baixa_estoque.test.js test/corte_vidros_excluir_dados.test.js test/apoio/bancoVidros.js && git commit -m "feat(corte-vidros): confirmar corte com baixa de chapas no estoque e excluir dados do pedido"`.

---

### Task 8: Tela, menu e permissão da página

**Files:**
- Create: `corte_vidros.html`, `corte_vidros.js`
- Modify: `layout.js` (item `{ href: 'corte_vidros.html', texto: 'Corte de vidros', icone: 'corte', sub: true }` ao lado de `corte.html`; `'corte_vidros.html': ['corte.ver']` em `PAGINAS`)
- Test: `test/corte_vidros_tela.test.js` (HTML estático, no molde de `test/corte_tela.test.js`)

**Interfaces:**
- Consumes: todas as rotas `/corte_vidros/*` (Tarefas 5–7) com os formatos descritos lá.
- Produces: página com abas Plano, Retalhos, Parâmetros. Copiar de `corte.html`/`corte.js` o cabeçalho com Content-Security-Policy, `API_BASE`, `layout.js`, tema e estilos base.
  - **Plano:** busca do Pedido; lista de pendências; por grupo, seletor de produto (candidatos de `grupos[].candidatos`, pré-selecionado) — mudar a escolha recalcula a pré-visualização (`escolhas` na query); chapas desenhadas em CSS em escala (peças numeradas por item, indicação de giro, retalho e sobras destacados); lista de cortes; clique marca a peça (estado em `localStorage` `corte_vidros_marcas_<plano>`, envio em lote após 3 s, ao sair e antes de qualquer ação do plano, nova tentativa a cada 15 s sem conexão); botões Salvar, Conferir, Cancelar, Excluir dados.
  - **Conferir:** sobras com medida real (altura/largura) e destino; bloco "Baixa no estoque" com uma linha por produto (chapas novas somadas) e validação antes de enviar; `baixas` enviadas conforme `escolhas`.
  - **Retalhos** e **Parâmetros** como nas abas do corte de perfis.

- [ ] **Step 1: Testes que falham** (`corte_vidros_tela.test.js`): o HTML traz CSP, as três abas, o seletor de produto e o bloco "Baixa no estoque"; `corte_vidros.js` chama cada rota listada e usa `escolhas`; `layout.js` contém o item de menu e a permissão `corte.ver` para a página; nenhum `innerHTML` com dado do servidor sem escape (seguir a verificação existente em `corte_tela.test.js`).
- [ ] **Step 2: Rodar e ver falhar** — `node --test test/corte_vidros_tela.test.js` → FAIL.
- [ ] **Step 3: Implementar** os dois arquivos e as duas linhas de `layout.js`, reaproveitando funções auxiliares e estilos de `corte.js`/`corte.html` por cópia adaptada (o desenho 2D em escala é novo: cada chapa = caixa com `aspect-ratio` e peças em `position:absolute` em porcentagem).
- [ ] **Step 4: Rodar** `node --test test/corte_vidros_tela.test.js` e `npm test` → PASS. **Verificação manual a pedir ao usuário** (não é automática): abrir a tela com um pedido real recente.
- [ ] **Step 5: Commit** — `git add corte_vidros.html corte_vidros.js layout.js test/corte_vidros_tela.test.js && git commit -m "feat(corte-vidros): tela do plano de corte de vidros e item de menu"`.

---

### Task 9: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md` (lista de pastas + nova seção "Plano de corte de vidros" na seção 5 + item de funcionalidades na seção 1)

- [ ] **Step 1: Escrever a seção** "Plano de corte de vidros" no `CLAUDE.md` (peças e conferência modelo+cor sem comparar quantidades e o porquê; chapa = produto do estoque; guilhotina com rotação; baixa 1 por chapa e soma por produto; retalhos por produto; pendências esperadas em pedidos antigos; tabelas, rotas, permissões, testes, limitações do spec). Atualizar a lista de pastas e a lista de funcionalidades.
- [ ] **Step 2: Rodar a suíte inteira** — `npm test` → todos passam; anotar a contagem.
- [ ] **Step 3: Verificação com dados reais, somente leitura**: com `C:\Users\Família\.claude\db_leitura.env` (usuário só `SELECT`), rodar um script de scratchpad que, para 3 pedidos recentes (23424, 23432, 23437), carrega `vidros` e itens, chama `montarPecasVidro` e `otimizarVidros` (chapa = produto Revestimento de mesmo nome) e imprime pendências, nº de chapas e aproveitamento. Conferir à mão que as pendências esperadas aparecem e nenhum pedido recente tem pendência inesperada. Não imprimir credenciais.
- [ ] **Step 4: Commit** — `git add CLAUDE.md && git commit -m "docs(corte-vidros): seção do plano de corte de vidros no CLAUDE.md"`.
