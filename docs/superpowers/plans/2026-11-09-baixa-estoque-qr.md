# Baixa de estoque por QR no celular — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quem só retira material do estoque entra pelo celular, lê o QR do item com a câmera e dá a baixa em poucos toques.

**Architecture:** Duas rotas de leitura novas (`rotas/estoque_qr.js`) sobre a tabela `estoque`; a baixa continua no `POST /estoque/saida` existente. Duas páginas novas sem build (`baixa_qr.html/.js` lê QR com jsQR; `etiquetas_qr.html/.js` desenha QR com qrcode-generator), ambas com a lógica em módulo UMD testável no Node. O destino do login muda em `layout.js` (`primeiraPaginaDe`).

**Tech Stack:** Node 18+/Express, `node:test`, HTML/JS puro, `getUserMedia`, jsQR 1.4.0 (Apache-2.0) e qrcode-generator 1.4.4 (MIT) copiados para `vendor/`.

**Spec:** `docs/superpowers/specs/2026-11-09-baixa-estoque-qr-design.md`

## Global Constraints

- Tabela do estoque = `estoque` (`CODIGO`, `NOME_PRODUTO`, `UNIDADE`, `QTD_ESTOQUE`, `SITUACAO` 'Ativo'/'Inativo', `CODIGO_BARRA` até 20 caracteres, **sem unicidade no banco**).
- Nenhuma resposta nova leva dinheiro. O campo de quantidade se chama **`qtd`**: `saldo` casa com `REGEX_VALOR` (`seguranca/valores.js`) e seria apagado de quem não tem `valores.ver`.
- Toda rota nova nasce em `registro.rota(...)` com permissões explícitas; `registro.verificar()` não pode falhar.
- Baixa só por `POST /estoque/saida` (corpo `{ chave, data: 'AAAA-MM-DD', itens: [{ produtoCodigo, qtd }] }`, `qtd` inteiro ≥ 1; `chave` ≤ 64 caracteres). Nada de fila offline.
- Páginas novas: CSP em `<meta>` como `minhas_entregas.html`, sem handler/estilo inline novo, `tema.css` por último, cores só por variáveis do tema (`DESIGN.md`).
- Dado da API entra na tela só por `textContent` ou `esc()`.
- Idioma de mensagens e comentários: português.
- Baseline de testes: 4 falhas de calendário já existiam antes (`test/calendario*.test.js`); não são desta entrega.

## Review Focus

1. QR de item **inativo ou inexistente** → "Item não encontrado", nada gravado (Task 2, Task 4).
2. **Dois itens com o mesmo `CODIGO_BARRA`** → 409 e nunca baixa o item errado (Task 2).
3. **Estoquista (sem `valores.ver`) vê a quantidade**: o campo `qtd` sobrevive à `redeDeValores` (Task 2).
4. **Toque duplo** e **reenvio depois de falha de rede** não baixam duas vezes: mesma `chave` até dar certo, 409 tratado como "já registrada" (Task 4).
5. **QR de outro sistema** (URL, texto de 500 caracteres, vazio) e **quantidade maior que o saldo** → mensagem clara, sem gravar (Task 1, Task 4).

---

### Task 1: Funções puras do código de barras

**Files:**
- Create: `calculo/estoque_qr.js`
- Test: `test/estoque_qr_calculo.test.js`

**Interfaces:**
- Produces:
  - `codigoValido(texto: unknown): string | null` — `trim`; 1 a 20 caracteres; sem caracteres de controle (`\u0000-\u001f`, `\u007f`); senão `null`.
  - `projetarItem(linha: { CODIGO, NOME_PRODUTO, UNIDADE, QTD_ESTOQUE }): { codigo: number, nome: string, unidade: string, qtd: number }`
  - `projetarEtiquetas(linhas: Array<{ CODIGO, NOME_PRODUTO, UNIDADE, CODIGO_BARRA }>): { itens: Array<{ codigo, produto, unidade, codBarras }>, semCodigo: number }` — `CODIGO_BARRA` vazio/só espaços não entra em `itens` e soma em `semCodigo`; mantém a ordem recebida.

- [ ] **Step 1: Escrever os testes que falham** (`node:test`, `node:assert/strict`): `codigoValido('7890000000011')` devolve o próprio texto; `'  123 '` → `'123'`; `''`, `'   '`, `null`, `undefined`, `'a'.repeat(21)`, `'12\n34'`, `'12\u0000'` → `null`; `'a'.repeat(20)` válido; URL `'https://x.com/a'` é texto válido (a rota é quem diz "não encontrado"). `projetarItem` converte `QTD_ESTOQUE` string `'10.000'` em `10` e devolve exatamente as 4 chaves. `projetarEtiquetas` com 3 linhas (uma sem código, uma com `'  '`) → 1 item e `semCodigo: 2`.
- [ ] **Step 2: Rodar `node --test test/estoque_qr_calculo.test.js`** — esperado: FALHA (módulo não existe).
- [ ] **Step 3: Implementar** as três funções em `calculo/estoque_qr.js` (CommonJS, `module.exports`), conforme a interface.
- [ ] **Step 4: Rodar o mesmo comando** — esperado: todos passam.
- [ ] **Step 5: Commit** — `git add calculo/estoque_qr.js test/estoque_qr_calculo.test.js` e `git commit -m "Estoque QR: funções puras do código de barras"`.

---

### Task 2: Rotas de leitura (`por_codigo` e `etiquetas`)

**Files:**
- Create: `rotas/estoque_qr.js`
- Modify: `index.js` (require junto da linha 38; registro logo depois de `registrarEstoqueMovimentos({ rota: registro.rota, pool })`, ~linha 1773)
- Modify: `test/apoio/bancoEstoque.js` (duas regras novas na lista `regras`)
- Test: `test/estoque_qr_rotas.test.js`

**Interfaces:**
- Consumes: Task 1 (`codigoValido`, `projetarItem`, `projetarEtiquetas`); `prepararEstoque(t, { perfil, banco })` de `test/apoio/bancoEstoque.js` (devolve `{ banco, chamar(caminho, metodo, corpo) }`).
- Produces: `registrarEstoqueQr({ rota, pool }): void` em `rotas/estoque_qr.js`.
  - `GET /estoque/por_codigo/:codigo`, permissões `['estoque.ver', 'estoque.movimentar']`. SQL fixo: `SELECT CODIGO, NOME_PRODUTO, UNIDADE, QTD_ESTOQUE, SITUACAO FROM estoque WHERE CODIGO_BARRA = ? LIMIT 2`. Código inválido → 400 `{ error: 'Código inválido.' }`; 0 linhas ou única linha `Inativo` → 404 `{ error: 'Item não encontrado.' }`; 2 linhas → 409 `{ error: 'Código de barras repetido no estoque: avise o administrador.' }`; senão 200 com `projetarItem`. Erro de banco → 500 `{ error: 'Erro de servidor' }` (log só `err.message`, como as rotas vizinhas).
  - `GET /estoque/etiquetas`, permissões `['estoque.ver', 'estoque.editar']`. SQL fixo: `SELECT CODIGO, NOME_PRODUTO, UNIDADE, CODIGO_BARRA FROM estoque WHERE SITUACAO = 'Ativo' ORDER BY NOME_PRODUTO ASC`; responde `projetarEtiquetas(linhas)`.

- [ ] **Step 1: Adicionar ao `bancoEstoque.js`** duas regras: uma para `/FROM estoque WHERE CODIGO_BARRA = \? LIMIT 2/` (devolve cópias dos itens cujo `CODIGO_BARRA` é `params[0]`, no máximo 2) e outra para `/FROM estoque WHERE SITUACAO = 'Ativo' ORDER BY NOME_PRODUTO/` (itens `Ativo` por `NOME_PRODUTO`).
- [ ] **Step 2: Escrever `test/estoque_qr_rotas.test.js`** (perfil `'Estoquista'` salvo indicação). Dados do banco falso: Perfil Slim `7890000000011` (10 un, Barra, Ativo), Puxador Total `7890000000028` (Inativo), Parafuso `7890000000035` (500 un, Un, Ativo).
  - `por_codigo/7890000000011` → 200 e `deepEqual` exatamente `{ codigo: 1, nome: 'Perfil Slim', unidade: 'Barra', qtd: 10 }` (prova que `qtd` sobrevive sem `valores.ver` e que não há campo de dinheiro).
  - `por_codigo/7890000000028` (inativo) e `por_codigo/9999` → 404 com a mesma mensagem.
  - Código repetido: criar `banco` com um segundo item de `CODIGO_BARRA` igual ao do Perfil Slim, passar em `prepararEstoque(t, { banco })` → 409; `banco.saidas.length === 0`.
  - `por_codigo/` + `'a'.repeat(21)` → 400; `por_codigo/%20` → 400; `por_codigo/` + `encodeURIComponent('https://x.com/a')` → 404.
  - Perfil `'Somente ver'` em `por_codigo` → 403.
  - `etiquetas` com perfil que tenha `estoque.editar` (conferir em `PERFIS_INICIAIS`, `seguranca/permissoes.js`; usar um perfil existente que o tenha): 2 itens (`Parafuso`, `Perfil Slim`, nessa ordem), `semCodigo: 0`; esvaziando `CODIGO_BARRA` do Parafuso → 1 item e `semCodigo: 1`. Com `'Estoquista'` → 403.
- [ ] **Step 3: Rodar `node --test test/estoque_qr_rotas.test.js`** — esperado: FALHA.
- [ ] **Step 4: Implementar** `rotas/estoque_qr.js` e registrar no `index.js` (`registrarEstoqueQr({ rota: registro.rota, pool })`).
- [ ] **Step 5: Rodar** `node --test test/estoque_qr_rotas.test.js test/estoque_saida.test.js test/seguranca_registro.test.js` — esperado: tudo passa (o registro de rotas continua válido).
- [ ] **Step 6: Commit** — `git add rotas/estoque_qr.js index.js test/apoio/bancoEstoque.js test/estoque_qr_rotas.test.js` e `git commit -m "Estoque QR: rotas por_codigo e etiquetas"`.

---

### Task 3: Destino do login e menu

**Files:**
- Modify: `layout.js` (`PAGINAS` ~linha 80, `MENU` ~linha 32, `primeiraPaginaDe` ~linha 131)
- Test: `test/baixa_qr_login.test.js`

**Interfaces:**
- Consumes: `Acesso.primeiraPaginaDe(acesso: { permissoes: string[] })` e `ACESSO_PAGINAS` de `layout.js`.
- Produces: `primeiraPaginaDe` devolve `'baixa_qr.html'` quando `permissoes` contém `estoque.ver` e `estoque.movimentar` **e nenhuma outra**; senão mantém o comportamento atual. `PAGINAS` ganha, logo depois de `'movimentacao_estoque.html'` (e antes de `'minhas_entregas.html'`, que continua o último): `'baixa_qr.html': ['estoque.ver', 'estoque.movimentar']` e `'etiquetas_qr.html': ['estoque.ver', 'estoque.editar']`. `MENU` ganha dois subitens do Estoque: "Baixa por QR" (`baixa_qr.html`) e "Etiquetas de QR" (`etiquetas_qr.html`), ícone `estoque`, `sub: true`.

- [ ] **Step 1: Escrever o teste** com o carregador de `layout.js` por `vm` (copiar `carregarLayout()` de `test/minhas_entregas_tela.test.js:208-217`). Asserções: `['estoque.ver','estoque.movimentar']` e a mesma lista invertida → `'baixa_qr.html'`; `['estoque.ver']` → `'estoque.html'`; `['estoque.movimentar']` sozinha → não é `'baixa_qr.html'` (cai na regra de sempre, `null`); `['estoque.ver','estoque.movimentar','pedidos.ver']` → `'painel_inicial.html'`; `['estoque.ver','estoque.movimentar','entregas.baixar']` → `'estoque.html'`; lista vazia → `null`; `Object.keys(ACESSO_PAGINAS).pop() === 'minhas_entregas.html'`; as duas páginas novas estão em `ACESSO_PAGINAS` com as permissões acima; o texto de `layout.js` contém os dois itens de `MENU`.
- [ ] **Step 2: Rodar `node --test test/baixa_qr_login.test.js`** — esperado: FALHA.
- [ ] **Step 3: Implementar** em `layout.js`: constante com as duas permissões, função `somenteBaixa(acesso)` e o desvio no início de `primeiraPaginaDe`; as entradas de `PAGINAS` e `MENU`.
- [ ] **Step 4: Rodar** `node --test test/baixa_qr_login.test.js test/minhas_entregas_tela.test.js test/login.test.js` — esperado: tudo passa.
- [ ] **Step 5: Commit** — `git add layout.js test/baixa_qr_login.test.js` e `git commit -m "Estoque QR: Estoquista entra na leitura; menu e páginas"`.

---

### Task 4: Tela de leitura e baixa

**Files:**
- Create: `baixa_qr.html`, `baixa_qr.js`, `vendor/jsQR.js`
- Test: `test/baixa_qr_tela.test.js`

**Interfaces:**
- Consumes: `GET /estoque/por_codigo/:codigo` e `POST /estoque/saida` (Task 2 / existente); `Acesso.pode` do `layout.js`.
- Produces (módulo UMD em `baixa_qr.js`, mesmo molde de `minhas_entregas.js`: `module.exports` no Node, `raiz.BaixaQr` no navegador, `iniciar(raiz)` no `DOMContentLoaded`):
  - `ajustarQtd(qtd: number, delta: number, saldo: number): number` — resultado entre 1 e `max(1, floor(saldo))`.
  - `novaChave(): string` — `'qr-' + crypto.randomUUID()` (≤ 64 caracteres).
  - `dataLocal(d: Date): string` — `AAAA-MM-DD` no fuso local.
  - `corpoDaBaixa(item: { codigo }, qtd: number, chave: string, hoje: string): { chave, data, itens: [{ produtoCodigo, qtd }] }`.
  - `mensagemDeErro(status: number, corpo: { error?: string }): string` — 404 → `'Item não encontrado.'`; 403 → `'Sem permissão para dar baixa.'`; 409 com `'Este lançamento já foi gravado.'` → `'Esta baixa já foi registrada. Confira no histórico antes de repetir.'`; demais usam `corpo.error` ou `'Erro de servidor.'`.
  - `criarFluxo({ api, hoje, chave }): { estado, lerCodigo(codigo), mudarQtd(delta), confirmar(), cancelar() }` onde `api(caminho, opcoes) → Promise<{ ok, status, corpo }>`; `estado` = `{ fase: 'lendo' | 'cartao' | 'gravando' | 'feito' | 'erro', item, qtd, chave, mensagem, depois }`.
  - `lerQr(imagem: { data, width, height }, jsQR: Function): string | null` — texto do QR ou `null`.

Regras do fluxo (decididas na spec): `lerCodigo` valida/consulta, entra em `cartao` com `qtd = 1` e **uma `chave` gerada nesse momento, reaproveitada em toda tentativa até dar certo** (falha de rede com resultado incerto + novo toque = mesma chave → 409 vira "já registrada", nunca baixa dupla); `confirmar` ignora chamadas enquanto `fase === 'gravando'`; erro mantém `cartao` com a quantidade; sucesso mostra `depois` (saldo novo) e a próxima leitura gera chave nova; `cancelar` volta a `lendo`.

- [ ] **Step 1: Copiar as bibliotecas e o molde.** Em pasta temporária (scratchpad, fora do projeto): `npm pack jsqr@1.4.0`, extrair e copiar `package/dist/jsQR.js` para `vendor/jsQR.js` (manter o cabeçalho da licença Apache-2.0). Criar `vendor/LEIA-ME.txt` com nome, versão, licença e origem. Conferir que o arquivo não está vazio.
- [ ] **Step 2: Escrever `test/baixa_qr_tela.test.js`** (molde `test/minhas_entregas_tela.test.js`): 
  - `ajustarQtd(1,-1,10)=1`, `ajustarQtd(10,1,10)=10`, `ajustarQtd(3,1,10)=4`, `ajustarQtd(1,1,0.5)=1`.
  - `novaChave()` duas vezes diferentes e `length ≤ 64`; `corpoDaBaixa({codigo:3}, 4, 'k', '2026-11-09')` é `{ chave:'k', data:'2026-11-09', itens:[{ produtoCodigo:3, qtd:4 }] }`; `dataLocal(new Date(2026, 10, 9, 23, 59))` = `'2026-11-09'`.
  - `mensagemDeErro` nos quatro casos acima.
  - `lerQr` com `jsQR` falso que devolve `{ data: 'ABC' }` → `'ABC'`; devolve `null` → `null`.
  - `criarFluxo` com `api` falso: leitura 200 abre o cartão com `qtd 1`; leitura 404 → `fase 'erro'` com `'Item não encontrado.'` e **nenhum POST**; `confirmar()` chamado **duas vezes seguidas sem esperar** → um único POST; resposta 400 de saldo → `fase 'cartao'`, `qtd` preservada e a **mesma chave** no segundo `confirmar()`; resposta 409 → mensagem de "já registrada"; sucesso → `fase 'feito'` com `depois`, e a leitura seguinte usa chave diferente; QR com texto de 500 caracteres → erro e nenhuma chamada à `api`.
  - HTML (`ler('baixa_qr.html')`): tem `<meta http-equiv="Content-Security-Policy"`; carrega `vendor/jsQR.js` antes de `baixa_qr.js` e `tema.css` por último; tem campo de digitar o código; não tem `onclick=` nem `<style>` com cor hexadecimal solta além das variáveis do tema.
- [ ] **Step 3: Rodar `node --test test/baixa_qr_tela.test.js`** — esperado: FALHA.
- [ ] **Step 4: Implementar `baixa_qr.js`** (funções acima + `iniciar`: pede a câmera traseira com `getUserMedia({ video: { facingMode: 'environment' } })`, lê quadros num `<canvas>` oculto com `requestAnimationFrame`, para ao abrir o cartão e ao `visibilitychange`/`pagehide`, desliga as faixas do vídeo; sem câmera/permissão/HTTPS mostra só o campo de digitar) e **`baixa_qr.html`** (mobile-first, molde de `minhas_entregas.html`; botões grandes, `Acesso.podePagina` + redirecionamento ao login como as demais páginas; saldo, unidade e botões − / + / "Dar baixa" / "Cancelar" no cartão; botão "Sair" e link para o sistema se a pessoa tiver outras páginas).
- [ ] **Step 5: Rodar `node --test test/baixa_qr_tela.test.js`** — esperado: tudo passa.
- [ ] **Step 6: Commit** — `git add baixa_qr.html baixa_qr.js vendor test/baixa_qr_tela.test.js` e `git commit -m "Estoque QR: tela de leitura e baixa"`.

---

### Task 5: Etiquetas de QR

**Files:**
- Create: `etiquetas_qr.html`, `etiquetas_qr.js`, `vendor/qrcode.js`
- Modify: `estoque.html` (botão/link "Etiquetas de QR" visível só com `estoque.editar`)
- Test: `test/etiquetas_qr_tela.test.js`

**Interfaces:**
- Consumes: `GET /estoque/etiquetas` (Task 2); `layout.js` (Task 3).
- Produces (UMD em `etiquetas_qr.js`): `filtrarItens(itens, busca: string): itens` (nome ou código, sem diferenciar caixa); `dividirEmFolhas(itens, porFolha = 12): itens[][]`; `textoDoQr(item): string` (= `item.codBarras`).

- [ ] **Step 1: Copiar a biblioteca**: `npm pack qrcode-generator@1.4.4` na pasta temporária, copiar `package/qrcode.js` para `vendor/qrcode.js` e acrescentar a linha no `vendor/LEIA-ME.txt` (MIT).
- [ ] **Step 2: Escrever o teste**: `filtrarItens` por parte do nome e por código; `dividirEmFolhas` de 25 itens com 12 → folhas de 12, 12 e 1; `textoDoQr` devolve exatamente o código sem espaços extras; HTML tem CSP, carrega `vendor/qrcode.js` antes do `etiquetas_qr.js`, tem regra `@media print`, e `estoque.html` contém o link para `etiquetas_qr.html` com `data-perm="estoque.editar"`.
- [ ] **Step 3: Rodar `node --test test/etiquetas_qr_tela.test.js`** — esperado: FALHA.
- [ ] **Step 4: Implementar** `etiquetas_qr.js` e `etiquetas_qr.html`: lista com caixas de seleção ("marcar todos"), aviso "N item(ns) sem código de barras: cadastre em Estoque" quando `semCodigo > 0`, botão "Imprimir" (`window.print()`) e folha em grade; o QR é desenhado com `createElementNS` de `<rect>` a partir de `isDark(r, c)` da biblioteca (sem `innerHTML`), com nome e código em texto sob cada QR; `@media print` esconde tudo que não é a folha. Acrescentar o link em `estoque.html`.
- [ ] **Step 5: Rodar** `node --test test/etiquetas_qr_tela.test.js` — esperado: passa.
- [ ] **Step 6: Commit** — `git add etiquetas_qr.html etiquetas_qr.js vendor estoque.html test/etiquetas_qr_tela.test.js` e `git commit -m "Estoque QR: página de etiquetas"`.

---

### Task 6: Documentação e verificação final

**Files:**
- Create: `docs/regras/baixa-qr.md`
- Modify: `CLAUDE.md` (lista de funcionalidades na seção 1, árvore de pastas na seção 2, novo resumo na seção 5 apontando para `docs/regras/baixa-qr.md`)

- [ ] **Step 1: Escrever `docs/regras/baixa-qr.md`**: tabela `estoque` e o código sem unicidade (409), `qtd` em vez de `saldo` (e por quê), mesma `chave` até dar certo, regra do login (`estoque.ver` + `estoque.movimentar` e nada mais), rotas e permissões, bibliotecas em `vendor/` (versão e licença) e a linha **"NÃO testado em aparelho real (Android e iPhone): câmera e leitura de QR"**.
- [ ] **Step 2: Atualizar o `CLAUDE.md`** (as três seções acima, no estilo das existentes; sem repetir o conteúdo do arquivo de regras).
- [ ] **Step 3: Rodar a suíte completa** `node --test "test/**/*.test.js"` — esperado: só as 4 falhas de calendário que já existiam; nenhuma nova.
- [ ] **Step 4: Roteiro manual no celular** (registrar o resultado no `docs/regras/baixa-qr.md`): imprimir 3 etiquetas, ler cada uma no Android e no iPhone, dar baixa de 1 e de 2 unidades, tentar baixar mais que o saldo, tocar duas vezes em "Dar baixa", ler QR de item inativo, entrar com um Estoquista (cai na leitura) e com um Administrador (cai no sistema normal).
- [ ] **Step 5: Commit** — `git add docs/regras/baixa-qr.md CLAUDE.md` e `git commit -m "Estoque QR: documentação"`.
