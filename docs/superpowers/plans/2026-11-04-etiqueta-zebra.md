# Etiquetas de pedido/produção na Zebra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Imprimir, a partir de um Pedido, uma etiqueta ZPL de 100 × 60 mm por item na Zebra USB do PC da empresa.

**Architecture:** Função pura monta o ZPL; rota do servidor (`GET /etiquetas/pedido/:numero`) lê o pedido e devolve `{ zpl, total }`; o serviço local (porta 3917) recebe `POST /etiqueta` e envia o ZPL RAW ao spooler do Windows por PowerShell (`winspool.drv`). A tela chama as duas em sequência pelo menu do botão direito.

**Tech Stack:** Node.js + Express 4, mysql2, `node:test`, PowerShell (só no serviço local), HTML/JS puro.

**Spec:** `docs/superpowers/specs/2026-11-04-etiqueta-zebra-design.md`

## Global Constraints

- Etiqueta 100 × 60 mm a 203 dpi: `^PW800`, `^LL480`, `^CI28` (UTF-8).
- Uma etiqueta (`^XA…^XZ`) por linha de `ped_orc_lista_itens`; só `Pedido`, nunca Orçamento.
- Nenhum campo de dinheiro na etiqueta ou na resposta. Contagens não podem usar nomes de dinheiro (`seguranca/valores.js`): a resposta usa `quantidade`, nunca `total`.
- Texto vindo do banco perde `^`, `~`, `\` e caracteres de controle antes de entrar no ZPL. Medida ausente = "—", nunca estimada.
- Rota criada só por `registro.rota` com permissão `pedidos.pdf` (sem permissão nova); respeita `foraDosEstados`.
- Impressora vem só de `local/zebra.config.json` ou da primeira impressora com "zebra"/"zdesigner" no nome; nunca do corpo da requisição. ZPL: máximo 1 MB, começa em `^XA`, termina em `^XZ`.
- Sem dependências npm novas. Testes sem MySQL e sem impressora; o envio ao spooler é módulo injetável.
- Português nos comentários e mensagens, como no resto do repositório.

## Review Focus

- Pedido sem itens → 404 com mensagem, nunca ZPL vazio.
- Cliente/descrição com `^`, `~`, `\`, acento ou aspas → ZPL sem comando injetado, acentos preservados.
- Descrição enorme → truncada, a etiqueta não estoura.
- Item sem linha em `ped_orc_itens_v4` (serralheria/avulso) → medidas "—".
- Nenhuma impressora encontrada ou PowerShell falhando → erro 500 legível com a lista de impressoras, sem derrubar o serviço.
- Origem estranha no `POST /etiqueta` → 403; corpo que não é ZPL → 400.

**Ponto a confirmar com o dono:** "data de entrega" na etiqueta usa `ped_orc.DATA_PRONTO` (previsão, a mesma data que o PDF já mostra). `DATA_ENTREGA` só é preenchida ao entregar. Rótulo na etiqueta: "Entrega".

## Estrutura de arquivos

- Create `calculo/etiqueta_zpl.js` — ZPL puro. Test `test/etiqueta_zpl.test.js`.
- Create `rotas/etiquetas.js` — rota; Modify `index.js` (require + registro junto das linhas 1776-1777). Test `test/etiquetas_rotas.test.js`.
- Create `local/zebra.js` — serviço da impressora; Modify `local/salvador_pdf.js` (carregar, rota, `/ping`); Create `local/zebra.config.exemplo.json`; Modify `local/instalar_salvador_pdf.bat` (copiar arquivos novos). Test `test/zebra_local.test.js`.
- Create `etiqueta_zebra.js` — front compartilhado; Modify `inicio_menu.js`, `painel_inicial.html`, `inicio.html` (script + item de menu). Test `test/etiqueta_tela.test.js`.
- Modify `CLAUDE.md`, `docs/regras/servico-local.md`; Create `docs/regras/etiqueta-zebra.md`.

---

### Task 1: ZPL puro (`calculo/etiqueta_zpl.js`)

**Files:**
- Create: `calculo/etiqueta_zpl.js`
- Test: `test/etiqueta_zpl.test.js`

**Interfaces:**
- Produces: `sanearZpl(texto: any): string`, `medidasDoItem(v4: object[]): string`, `montarEtiquetas({ numero: string|number, cliente: string, dataEntrega: string, itens: Array<{ ITEM, QTD, descricao: string, v4: object[] }> }): { zpl: string, quantidade: number }`. `descricao` já vem montada pela rota (ver Task 2); aqui só é saneada e truncada.

- [ ] **Step 1: Escrever os testes que falham** em `test/etiqueta_zpl.test.js`:
  - `sanearZpl('A^B~C\\D\n')` → `'ABCD '` (remove `^ ~ \`, controle vira espaço) e `sanearZpl(null)` → `''`.
  - `medidasDoItem([{ALTURA:'2100',LARGURA:'900'},{ALTURA:'2100',LARGURA:'800'}])` → `'2100x900 | 2100x800'`; `medidasDoItem([])` → `'—'`; linha sem ALTURA/LARGURA vira `'—'`.
  - `montarEtiquetas` com 3 itens: `quantidade === 3`; o ZPL contém exatamente 3 `^XA` e 3 `^XZ`, cada bloco contém `^PW800`, `^LL480`, `^CI28`, `^BC` (Code 128) com o número do pedido e o texto `Item 2/3`.
  - Cliente `'Ação ^XZ~DG'` → ZPL contém `Ação ` e **não** contém `^XZ~DG` nem `~DG`; um 4º `^XZ` nunca aparece.
  - Descrição de 5000 caracteres → cada bloco com tamanho < 2000 caracteres (truncada).
  - Nenhum bloco contém `R$`.

- [ ] **Step 2: Rodar e ver falhar**: `node --test test/etiqueta_zpl.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** as três funções em `calculo/etiqueta_zpl.js` (CommonJS, `module.exports`). Layout fixo em dots, campos nesta ordem: cliente (`^A0N`, fonte grande, `^FB` 1 linha), "Pedido nº X" e "Item i/N  Qtd Q", descrição (`^FB` com no máximo 5 linhas, truncada a ~300 caracteres com `…`), "Medidas: <medidasDoItem>", "Entrega: <dataEntrega>" (vazia → "—"), `^BCN` Code 128 com o número. Todo texto passa por `sanearZpl`; o número do pedido só aceita dígitos.

- [ ] **Step 4: Rodar e ver passar**: `node --test test/etiqueta_zpl.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add calculo/etiqueta_zpl.js test/etiqueta_zpl.test.js && git commit -m "feat(etiqueta): ZPL puro da etiqueta de pedido 100x60"`

---

### Task 2: Rota `GET /etiquetas/pedido/:numero`

**Files:**
- Create: `rotas/etiquetas.js`
- Modify: `index.js` (require junto da linha 54 e `registrarEtiquetas({ rota: registro.rota, pool, foraDosEstados });` junto da linha 1777)
- Modify: `pdf/ped_orc.js:507` (nada a exportar além do que já existe: usa `descricaoItem`, `textoVB`, `dataVB`)
- Test: `test/etiquetas_rotas.test.js`

**Interfaces:**
- Consumes: `montarEtiquetas` (Task 1); `descricaoItem(tipoProduto, grupos)`, `textoVB`, `dataVB` de `pdf/ped_orc.js`.
- Produces: `registrarEtiquetas({ rota, pool, foraDosEstados })`; resposta `200 { zpl: string, quantidade: number }`.

- [ ] **Step 1: Escrever os testes que falham** em `test/etiquetas_rotas.test.js`, seguindo `test/pesos_rotas.test.js` (mock de `acesso.carregar` como `prepararPesos`, `chamar`, banco simulado de `test/apoio/bancoPedOrc.js`; se o banco falso não cobrir `ped_orc`/`ped_orc_lista_itens`/`ped_orc_itens_v4`/`cadastro_clientes`, estender o falso com essas leituras):
  - Pedido com 2 itens → 200, `quantidade === 2`, `zpl` com 2 `^XA`.
  - Usuário sem `pedidos.pdf` → 403.
  - Número inexistente → 404 com `error`; pedido sem itens → 404 (mensagem diferente de "não encontrado").
  - Usuário com estados restritos e cliente de outro estado → recusado como em `/dados_pdf`.
  - A resposta serializada não contém nenhum nome de campo que case com `REGEX_VALOR` (`seguranca/valores.js`) nem `R$`.
  - `GET /etiquetas/pedido/abc` (não numérico) → 400.

- [ ] **Step 2: Rodar e ver falhar**: `node --test test/etiquetas_rotas.test.js` → FAIL.

- [ ] **Step 3: Implementar** `registrarEtiquetas` em `rotas/etiquetas.js`: `rota('get', '/etiquetas/pedido/:numero', ['pedidos.pdf'], …)`; consultas só de leitura, só `TIPO = 'Pedido'` (`ped_orc` para RAZAO_SOCIAL e DATA_PRONTO, `ped_orc_lista_itens`, `ped_orc_itens_v4` agrupado por `ITEM_PEDIDO` como em `pdf/ped_orc.js:446`); a descrição de cada item vem de `descricaoItem` (junte os `texto` das linhas); erro 500 genérico com `console.error` do `err.message`, como em `rotas/pesos.js`.

- [ ] **Step 4: Rodar e ver passar**: `node --test test/etiquetas_rotas.test.js` e `node --test test/seguranca_registro.test.js` (a lista fixa de rotas públicas não pode mudar) → PASS.

- [ ] **Step 5: Commit** — `git add rotas/etiquetas.js index.js test/etiquetas_rotas.test.js && git commit -m "feat(etiqueta): rota GET /etiquetas/pedido/:numero"`

---

### Task 3: Serviço local da Zebra (`local/zebra.js`)

**Files:**
- Create: `local/zebra.js`, `local/zebra.config.exemplo.json` (`{ "impressora": "ZDesigner ZD220" }`)
- Modify: `local/salvador_pdf.js` (carregar como `sefaz`, tratar `POST /etiqueta`, `/ping` com `zebra`; incluir `Content-Type` nos cabeçalhos CORS já existentes), `local/instalar_salvador_pdf.bat` (copiar `zebra.js` e o exemplo; reiniciar como já faz)
- Test: `test/zebra_local.test.js`

**Interfaces:**
- Produces: `criarZebra({ raiz: string, enviar?: (impressora: string, zpl: string) => Promise<void>, listar?: () => Promise<string[]> }): { tratar(req, res, url, ctx): Promise<void>, validarZpl(zpl: any): { ok: boolean, motivo?: string }, escolherImpressora(nomes: string[], config: object): string|null }`. `enviar` e `listar` padrão chamam o PowerShell (`winspool.drv` RAW; `Get-Printer`). Resposta de `POST /etiqueta`: `200 { ok: true, impressora }`, `400` ZPL inválido, `500 { error, impressoras }` sem impressora ou falha de envio.

- [ ] **Step 1: Escrever os testes que falham** em `test/zebra_local.test.js` (padrão de `test/salvador_pdf.test.js`: servidor em porta livre; `enviar`/`listar` falsos injetados, nunca PowerShell):
  - `validarZpl`: aceita `'^XA…^XZ'`; recusa texto sem `^XA`, sem `^XZ`, não-string e > 1 MB.
  - `escolherImpressora(['HP LaserJet','ZDesigner ZD220'], {})` → `'ZDesigner ZD220'`; com `{ impressora: 'HP LaserJet' }` → `'HP LaserJet'`; sem Zebra e sem config → `null`.
  - `POST /etiqueta` válido chama `enviar` uma vez com a impressora escolhida e o ZPL → 200.
  - Corpo com campo `impressora` é ignorado (o `enviar` recebe a impressora do config/detecção, não a do corpo).
  - ZPL inválido → 400 e `enviar` não é chamado; nenhuma impressora → 500 com `impressoras` listadas; `enviar` rejeitando → 500 com mensagem, serviço continua respondendo `/ping`.
  - Origem `https://site-estranho.com` → 403; `/ping` informa `zebra: true`.

- [ ] **Step 2: Rodar e ver falhar**: `node --test test/zebra_local.test.js` → FAIL.

- [ ] **Step 3: Implementar** `criarZebra` em `local/zebra.js` (sem dependências; lê `zebra.config.json` ao lado do arquivo, ausente = `{}`; corpo JSON limitado a 1 MB como `lerCorpo`). O envio padrão passa o ZPL ao PowerShell por stdin (não por argumento de linha de comando, para não haver injeção de shell) e usa `Add-Type` com `OpenPrinter/StartDocPrinter(datatype "RAW")/WritePrinter/EndDocPrinter`. Em `salvador_pdf.js`, `try { zebra = require('./zebra').criarZebra({ raiz: RAIZ }) } catch { zebra = null }`; `POST /etiqueta` responde 503 com mensagem se faltar o módulo.

- [ ] **Step 4: Rodar e ver passar**: `node --test test/zebra_local.test.js test/salvador_pdf.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add local test/zebra_local.test.js && git commit -m "feat(etiqueta): serviço local envia ZPL RAW à Zebra"`

---

### Task 4: Tela (`etiqueta_zebra.js` + menus)

**Files:**
- Create: `etiqueta_zebra.js`
- Modify: `inicio_menu.js` (item após "Imprimir vidros", linha 73), `painel_inicial.html` (mesmo item no menu de contexto e `<script src="etiqueta_zebra.js">`), `inicio.html` (`<script src>`)
- Test: `test/etiqueta_tela.test.js`

**Interfaces:**
- Consumes: `GET /etiquetas/pedido/:numero` (Task 2); `POST http://127.0.0.1:3917/etiqueta` e `GET /ping` (Task 3).
- Produces: `window.EtiquetaZebra.imprimir(numero: string, { apiBase: string, loginUrl: string, token: () => string }): Promise<void>`.

- [ ] **Step 1: Escrever os testes que falham** em `test/etiqueta_tela.test.js`, no estilo de `test/painel_menu_contexto.test.js` (lê o HTML/JS como texto e executa o módulo com `fetch`/`alert`/`location`/`localStorage` falsos):
  - `inicio_menu.js` e `painel_inicial.html` têm o item "Imprimir etiquetas (Zebra)" protegido por `pedidos.pdf` e chamando `EtiquetaZebra.imprimir`.
  - `inicio.html` e `painel_inicial.html` carregam `etiqueta_zebra.js` e já liberam `http://127.0.0.1:3917` no `connect-src`.
  - `imprimir`: `/ping` sem resposta → `alert` com "Serviço local não encontrado neste PC" e **nenhuma** chamada ao servidor da API; resposta 401 do servidor → limpa `auth` e redireciona para `loginUrl`; 404 → `alert` com a mensagem do servidor; sucesso → `POST /etiqueta` com `{ zpl }` e `alert` de confirmação com a quantidade.

- [ ] **Step 2: Rodar e ver falhar**: `node --test test/etiqueta_tela.test.js` → FAIL.

- [ ] **Step 3: Implementar** `etiqueta_zebra.js` (IIFE `'use strict'`, expõe `window.EtiquetaZebra`, sem script nem estilo inline, mesmo estilo de `inicio_menu.js`); acrescentar o item de menu nas duas telas e os `<script src>`.

- [ ] **Step 4: Rodar e ver passar**: `node --test test/etiqueta_tela.test.js test/painel_menu_contexto.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add etiqueta_zebra.js inicio_menu.js inicio.html painel_inicial.html test/etiqueta_tela.test.js && git commit -m "feat(etiqueta): item Imprimir etiquetas (Zebra) no menu do pedido"`

---

### Task 5: Documentação e verificação final

**Files:**
- Create: `docs/regras/etiqueta-zebra.md` (regras da spec: saneamento, medida "—", sem dinheiro, impressora só do config, DATA_PRONTO, reinstalar o serviço, driver RAW)
- Modify: `CLAUDE.md` (linha em "Funcionalidades", pastas `rotas/`, `calculo/`, `local/`, e seção em 5 com ponteiro `docs/regras/etiqueta-zebra.md`), `docs/regras/servico-local.md` (`POST /etiqueta`, `zebra.js`, `zebra.config.json`, instalador)

- [ ] **Step 1: Escrever a documentação** acima, sem valores de senha ou token.
- [ ] **Step 2: Rodar a suíte inteira**: `npm test` → todos os testes passam (informe qualquer falha com a saída; não declare sucesso sem rodar).
- [ ] **Step 3: Commit** — `git add CLAUDE.md docs && git commit -m "docs(etiqueta): regras e serviço local da impressão Zebra"`

**Validação manual no PC da empresa (não automatizável):** reinstalar o serviço local, criar `local/zebra.config.json` se o nome da impressora não tiver "zebra"/"zdesigner", imprimir um Pedido real de 2 itens e conferir o tamanho, os acentos, a leitura do código de barras e a data.
