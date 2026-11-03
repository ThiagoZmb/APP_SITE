# Etiquetas de volume na Zebra ZD220 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Do menu do botão direito do Pedido, imprimir na Zebra ZD220 uma etiqueta 100 x 60 mm por unidade de cada item de porta de alumínio ou serralheria.

**Architecture:** O servidor (Render) monta as etiquetas e o ZPL por funções puras (`calculo/etiqueta.js`) e as entrega por `GET /etiquetas/pedido/:n`. A tela `etiquetas.html` mostra a prévia e manda o ZPL ao serviço local do PC da Zebra (`127.0.0.1:3917`, módulo novo `local/etiquetas.js`), que valida e o entrega ao spooler do Windows em modo RAW por PowerShell.

**Tech Stack:** Node.js + Express 4, mysql2 (banco falso nos testes), `node:test`, HTML/JS puro com CSP, PowerShell (envio RAW). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-03-etiquetas-zebra-design.md`

## Global Constraints

- Papel **100 x 60 mm**, 203 dpi: ZPL com `^PW800`, `^LL480`, `^CI28` (UTF-8). Sem preço e sem peso na etiqueta.
- Só **Pedido** (TIPO = 'Pedido') **não cancelado**; orçamento, avulso, acessórios, vidros e corte ficam fora.
- Etiquetáveis (`ped_orc_lista_itens.TIPO_PRODUTO`): `Porta de giro`, `Porta basculante`, `Frente de gaveta`, `Porta de correr`, `Metalons`. Uma etiqueta por **unidade** (`QTD`), numerada "n / N" no **pedido inteiro**.
- QR com `ELG|<pedido>|<item>|<unidade>`. Obra (`CLIENTE_FINAL`) some se vazia. Textos longos cortados com reticências.
- **Nenhum nome de campo de resposta pode casar com `REGEX_VALOR`** (`/valor|pre[cç]o|total|custo|saldo|.../i`, em `seguranca/valores.js`): usar `qtdEtiquetas`, `numeroEtiqueta`, `unidadeDoItem`, `qtdDoItem`; **nunca `total`**.
- Permissão nova `etiquetas.imprimir` (Administrador e Interno completo); rotas por `registro.rota(...)` (`rota` injetado, como `rotas/danfe.js`); estados restritos via `foraDosEstados`.
- Serviço local: só a origem do site, Host `127.0.0.1`/`localhost`, `application/json`, ZPL `^XA...^XZ`, comandos `~` recusados, máx. 200 etiquetas por chamada, impressora só por nome (`etiqueta.config.json` ou `ELEGANCE_IMPRESSORA_ETIQUETA`; sem config, procura "ZDesigner"/"ZD220"). `local/` **não pode importar** de `../calculo` (o instalador copia só a pasta `local`).
- Testes com spooler e banco **falsos**; nunca imprime de verdade. Auditoria `etiquetas_impressas` guarda só usuário, pedido e quantidade.
- Commits só quando o dono pedir; as mensagens abaixo valem para quando for.

## Review Focus

- Item com `QTD` 0, negativa, vazia ou não numérica → sem etiqueta (nunca "NaN / NaN"); `QTD` absurda (> 500) → recusa 400, nunca 5.000 etiquetas.
- Pedido sem nenhum item etiquetável (só avulso/acessório) → resposta com lista vazia e mensagem, sem erro 500.
- Cliente ou descrição com aspas, `^`, `~`, `\`, acentos ou quebra de linha → o ZPL gerado não pode ser interpretado como comando (escapar `^`, `~`, `\`, `_` e controles via `^FH\`/hex ou remoção).
- Pedido de cliente de outro estado, orçamento com o mesmo número, pedido cancelado → 403/404, sem vazar dados.
- Serviço local sem Zebra instalada, com duas Zebras, ou PowerShell falhando → mensagem clara, nunca derruba o serviço de PDF/SEFAZ.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `calculo/etiqueta.js` (novo) | Regras puras: unidades por item, numeração, textos, ZPL |
| `rotas/etiquetas.js` (novo) | `GET /etiquetas/pedido/:numero`, `POST /etiquetas/registro` |
| `local/etiquetas.js` (novo) | Serviço local: status, validação do ZPL, envio RAW ao spooler |
| `etiquetas.html`, `etiquetas.js` (novos) | Tela: prévia, imprimir todas/uma, status da impressora |
| `seguranca/permissoes.js`, `seguranca/instalacao.js`, `index.js` | Permissão `etiquetas.imprimir`, migração e registro das rotas |
| `local/salvador_pdf.js`, `local/instalar_salvador_pdf.ps1` | Carrega o módulo novo e o instala |
| `painel_inicial.html`, `inicio_menu.js`, `layout.js` | Item de menu "Imprimir etiquetas" e permissão da página |
| `CLAUDE.md`, `docs/etiquetas_zebra.md` (novo) | Regras do módulo e passo a passo da impressora |
| `test/etiqueta_calculo.test.js`, `test/etiquetas_rotas.test.js`, `test/etiqueta_local.test.js`, `test/etiquetas_tela.test.js`, `test/apoio/bancoEtiquetas.js` (novos) | Testes |

---

### Task 1: Regras puras da etiqueta e geração do ZPL

**Files:**
- Create: `calculo/etiqueta.js`
- Test: `test/etiqueta_calculo.test.js`

**Interfaces:**
- Produces:
  - `TIPOS_ETIQUETAVEIS: string[]` (os cinco do Global Constraints)
  - `MAX_QTD_ITEM = 500`
  - `etiquetasDoPedido(linhas: { cab: { NUMERO, RAZAO_SOCIAL, CLIENTE_FINAL }, lista: [{ ITEM, TIPO_PRODUTO, QTD, DESCRICAO }] }) -> { pedido: number, cliente: string, obra: string, etiquetas: Etiqueta[] }` onde `Etiqueta = { numeroEtiqueta, qtdEtiquetas, item, unidadeDoItem, qtdDoItem, tipo, descricao, qr, zpl }`; lança `Error` com `status = 400` se alguma `QTD` > `MAX_QTD_ITEM`.
  - `zplEtiqueta(dados: { pedido, cliente, obra, numeroEtiqueta, qtdEtiquetas, item, tipo, descricao, qr }) -> string` (começa em `^XA`, termina em `^XZ`).
  - `ENDERECO_FABRICA` (constante: rua, bairro/cidade, telefone, exatamente os da etiqueta atual: "Rua Joventina de Menezes, 36 · Vila Velha - ES", "(27) 3326-7213").

- [ ] **Step 1: Escrever os testes que falham** em `test/etiqueta_calculo.test.js` (nomes e asserts):
  - `'unidades: QTD 3 gera 3 etiquetas e a numeração n/N cobre o pedido inteiro'`: lista com item 1 `Porta de giro` QTD 2 e item 2 `Metalons` QTD 1 → 3 etiquetas, `numeroEtiqueta` = [1,2,3], `qtdEtiquetas` = 3 em todas, `unidadeDoItem` = [1,2,1], `qtdDoItem` = [2,2,1].
  - `'só porta e serralheria: avulso e acessório ficam de fora'`: TIPO_PRODUTO `Vidro`/`Acessório` não geram nada.
  - `'QTD inválida (0, negativa, vazia, texto) não gera etiqueta e nunca vira NaN'`.
  - `'QTD acima de 500 recusa com status 400'`.
  - `'obra vazia: a linha OBRA não aparece no ZPL'` e `'obra preenchida aparece'`.
  - `'ZPL: começa em ^XA, termina em ^XZ, tem ^PW800 ^LL480 ^CI28 e um ^BQ com o texto ELG|23397|2|3'`.
  - `'ZPL: ^ ~ \\ e quebras de linha no cliente/descrição não viram comando'` (nenhum `~` no ZPL final; `^` do texto do usuário não aparece fora de campos `^FD` escapados).
  - `'textos longos são cortados com reticências'` (cliente de 200 caracteres → campo com no máximo o limite definido; termina em `…` ou `...`).
  - `'nenhum nome de campo da saída casa com REGEX_VALOR'` (percorrer chaves, como em `test/danfe_rotas.test.js`).
- [ ] **Step 2: Rodar e ver falhar:** `node --test test/etiqueta_calculo.test.js` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar `calculo/etiqueta.js`** com as assinaturas acima. Posições do ZPL conforme o layout da Parte 1 do spec; escape de texto do usuário por `^FH` + `_XX` hexadecimal para `^ ~ \ _` e troca de controles por espaço; limite de caracteres por campo definido por constante (cliente 34, obra 34, descrição em até 2 linhas de 48). A logo é `LOGO_ZPL` (string constante, vazia por ora); sem ela, imprime "ELEGANCE" em fonte grande + "Alumínio" menor no canto superior esquerdo.
- [ ] **Step 4: Rodar e ver passar:** `node --test test/etiqueta_calculo.test.js` → todos PASS.
- [ ] **Step 5: Commit** `feat(etiquetas): regras puras e geração do ZPL da etiqueta 100x60`.

---

### Task 2: Permissão `etiquetas.imprimir` e migração

**Files:**
- Modify: `seguranca/permissoes.js` (catálogo, área "Cadastros" ou nova "Etiquetas"), `seguranca/instalacao.js` (nova `acrescentarPermissoesEtiquetas(pool)` ao lado de `acrescentarPermissoesDanfe`, linha ~826, e `module.exports`), `index.js` (import na linha 21 e chamada junto das demais, perto da linha 1786)
- Test: `test/etiquetas_instalacao.test.js`

**Interfaces:**
- Produces: `acrescentarPermissoesEtiquetas(pool) -> Promise<{ feito: boolean }>`; permissão `etiquetas.imprimir` dada a Administrador e Interno completo, marcador de auditoria `permissoes_etiquetas` (roda uma vez).

- [ ] **Step 1: Escrever o teste que falha** em `test/etiquetas_instalacao.test.js`, no estilo de `test/danfe_instalacao.test.js`: `'etiquetas.imprimir está no catálogo'`; `'migração dá a permissão ao Administrador e ao Interno completo e não ao Vendedor'`; `'roda uma vez só (segunda chamada devolve feito: false e não duplica)'`.
- [ ] **Step 2: Rodar e ver falhar:** `node --test test/etiquetas_instalacao.test.js` → FAIL.
- [ ] **Step 3: Implementar** copiando o padrão de `acrescentarPermissoesDanfe` (mesma transação e auditoria) com a lista `['etiquetas.imprimir']` para os dois perfis; adicionar a entrada em `permissoes.js` (`nome: 'Imprimir as etiquetas de volume dos pedidos'`); registrar a chamada em `index.js` com o `console.log` no padrão das outras.
- [ ] **Step 4: Rodar:** `node --test test/etiquetas_instalacao.test.js test/acesso.test.js test/admin.test.js` → PASS (a lista de permissões é conferida por outros testes).
- [ ] **Step 5: Commit** `feat(etiquetas): permissão etiquetas.imprimir`.

---

### Task 3: Rotas do servidor

**Files:**
- Create: `rotas/etiquetas.js`, `test/apoio/bancoEtiquetas.js` (banco falso no estilo de `test/apoio/bancoDanfe.js`: `ped_orc`, `ped_orc_lista_itens`, `cadastro_clientes`, `web_auditoria`)
- Modify: `index.js` (import e `registrarEtiquetas({ rota: registro.rota, pool, foraDosEstados })` junto de `registrarDanfe`, linha ~1752)
- Test: `test/etiquetas_rotas.test.js`

**Interfaces:**
- Consumes: `etiquetasDoPedido` (Task 1); permissão `etiquetas.imprimir` (Task 2); `lerDocumento` NÃO é usado (só `ped_orc` e `ped_orc_lista_itens` são lidas, para não puxar tabelas de engenharia).
- Produces:
  - `registrarEtiquetas({ rota, pool, foraDosEstados })`
  - `GET /etiquetas/pedido/:numero` → `200 { pedido, cliente, obra, situacao, etiquetas: Etiqueta[], ultimaImpressao: { quando, quem, qtdEtiquetas } | null }`
  - `POST /etiquetas/registro` corpo `{ pedido: number, qtdEtiquetas: number }` → `200 { ok: true }` e auditoria `etiquetas_impressas` (`alvo` = nº do pedido, `detalhe` = `{ qtdEtiquetas }`).

- [ ] **Step 1: Escrever os testes que falham** em `test/etiquetas_rotas.test.js`:
  - `'GET devolve as etiquetas de um pedido com porta e metalon'` (status 200; contagem e `zpl` presente).
  - `'orçamento com o mesmo número → 404'`; `'pedido inexistente → 404'`; `'pedido cancelado → 404'`.
  - `'pedido só com avulso → 200 com etiquetas vazias'`.
  - `'sem a permissão → 403'`; `'usuário com estados restritos e cliente de outro estado → 403'`.
  - `'QTD de item acima de 500 → 400 com mensagem em português'`.
  - `'POST /etiquetas/registro audita só pedido e quantidade, sem nome de cliente'`; `'quantidade inválida → 400'`.
  - `'ultimaImpressao vem da auditoria mais recente do pedido'`.
  - `'nenhum nome de campo da resposta casa com REGEX_VALOR'`.
- [ ] **Step 2: Rodar e ver falhar:** `node --test test/etiquetas_rotas.test.js` → FAIL.
- [ ] **Step 3: Implementar `rotas/etiquetas.js`** no padrão de `rotas/danfe.js` (`rota('get', ..., ['etiquetas.imprimir'], handler)`; busca do pedido por `NUMERO` + `TIPO = 'Pedido'`; recusa `SITUACAO` Cancelado sem diferenciar caixa/acento; `foraDosEstados` só quando o usuário tem estados). Erros 500 só com log, nunca com detalhe.
- [ ] **Step 4: Rodar:** `node --test test/etiquetas_rotas.test.js test/rotas_mapa.test.js` → PASS (o `registro.verificar()` confere que as rotas novas estão no registro).
- [ ] **Step 5: Commit** `feat(etiquetas): rotas de montagem e registro de impressão`.

---

### Task 4: Serviço local (validação do ZPL e envio RAW ao spooler)

**Files:**
- Create: `local/etiquetas.js`
- Modify: `local/salvador_pdf.js` (carregar o módulo como o `sefaz`, rotas `/etiqueta/*` com 503 se faltar), `local/instalar_salvador_pdf.ps1` (lista `$arquivos`, linha 9, ganha `'etiquetas.js'`; e `etiqueta.config.exemplo.json`), `local/etiqueta.config.exemplo.json` (novo, `{ "impressora": "ZDesigner ZD220-203dpi ZPL" }`)
- Test: `test/etiqueta_local.test.js`

**Interfaces:**
- Produces: `criarEtiquetas({ raiz, enviarRaw? }) -> { tratar(req, res, url, { origemPermitida }) }`, onde `enviarRaw(nomeImpressora: string, bytes: Buffer) -> Promise<void>` é injetável (nos testes é falso; o padrão usa PowerShell `Add-Type` com `winspool.drv` e `OpenPrinter/StartDocPrinter(RAW)/WritePrinter`); `listarImpressoras() -> Promise<string[]>` também injetável.
  - `validarZpl(texto: string, { maximo = 200 }) -> { ok: true, qtd: number } | { ok: false, motivo: string }`: começa em `^XA`, termina em `^XZ` (espaços e quebras nas pontas toleradas), nenhum `~` fora de campo de texto escapado (aqui: recusa qualquer `~`), no máximo 200 blocos `^XA...^XZ`, tamanho ≤ 1 MB.
  - `GET /etiqueta/status` → `200 { configurada: boolean, impressora: string, motivo?: string }` (sem config e uma só "ZDesigner"/"ZD220" achada = usa; zero/várias = `configurada: false` + motivo).
  - `POST /etiqueta/imprimir` `{ zpl }` → `200 { ok: true, qtdEtiquetas }`, `400` ZPL inválido, `503` sem impressora ou módulo, `500` mensagem genérica.

- [ ] **Step 1: Escrever os testes que falham** em `test/etiqueta_local.test.js` (sobe o serviço de teste como `test/salvador_pdf.test.js`, com `enviarRaw` e `listarImpressoras` falsos):
  - `'validarZpl aceita 1 e 200 etiquetas; recusa 201, vazio, sem ^XA, sem ^XZ e qualquer ~'`.
  - `'status: sem config e uma ZD220 achada → configurada com o nome'`; `'duas Zebras → configurada: false com motivo'`; `'nenhuma → configurada: false'`.
  - `'imprimir: ZPL válido chama enviarRaw com o nome certo e os bytes'`.
  - `'imprimir: origem de fora do site → 403'`; `'Host diferente de 127.0.0.1/localhost → 403'`; `'Content-Type diferente de JSON → 415'`.
  - `'imprimir: sem impressora → 503 "Impressora de etiquetas não encontrada neste PC"'`.
  - `'falha do spooler → 500 com mensagem genérica e o serviço continua respondendo /ping'`.
  - `'o corpo nunca escolhe a impressora nem caminho (campo "impressora" no corpo é ignorado)'`.
- [ ] **Step 2: Rodar e ver falhar:** `node --test test/etiqueta_local.test.js` → FAIL.
- [ ] **Step 3: Implementar `local/etiquetas.js`** no padrão de `local/sefaz.js` (mesmas verificações de Origin/Host/Content-Type; config em `<raiz>\Servico\etiqueta.config.json` ou `ELEGANCE_IMPRESSORA_ETIQUETA`). O envio RAW padrão roda o PowerShell com o script em argumento `-EncodedCommand` e os bytes por arquivo temporário apagado em `finally`; nada vindo da tela entra no comando.
- [ ] **Step 4: Rodar:** `node --test test/etiqueta_local.test.js test/salvador_pdf.test.js test/sefaz_endpoints.test.js` → PASS (o serviço de PDF e o da SEFAZ continuam intactos).
- [ ] **Step 5: Commit** `feat(etiquetas): serviço local com envio RAW à Zebra`.

---

### Task 5: Tela, menu, permissão da página e documentação

**Files:**
- Create: `etiquetas.html`, `etiquetas.js`, `docs/etiquetas_zebra.md`
- Modify: `painel_inicial.html` (item após "Corte de vidros"/junto de "Imprimir vidros", só `ehPedido` e não cancelado), `inicio_menu.js` (mesmo item, dentro do `if (!cancelado)` de "Corte de perfil"), `layout.js` (entrada em `PAGINAS`: `'etiquetas.html': ['etiquetas.imprimir']`), `CLAUDE.md` (seção nova "Etiquetas de volume (Zebra ZD220)" + entradas nas listas de arquivos e de funcionalidades)
- Test: `test/etiquetas_tela.test.js`

**Interfaces:**
- Consumes: `GET /etiquetas/pedido/:n` e `POST /etiquetas/registro` (Task 3); `GET /etiqueta/status` e `POST /etiqueta/imprimir` no `http://127.0.0.1:3917` (Task 4).
- Produces: `etiquetas.html?numero=<n>`; funções puras exportadas em `etiquetas.js` (padrão UMD de `danfe_envio.js`) para teste: `dividirEmLotes(etiquetas, tamanho) -> Etiqueta[][]`, `montarZpl(etiquetas) -> string` (junta os `zpl` em ordem), `mensagemStatus(status) -> string`.

- [ ] **Step 1: Escrever os testes que falham** em `test/etiquetas_tela.test.js` (no estilo de `test/danfe_tela.test.js`): `'etiquetas.html: CSP igual à das outras páginas, libera http://127.0.0.1:3917 no connect-src, sem handlers inline'`; `'montarZpl junta na ordem e dividirEmLotes respeita o tamanho'`; `'mensagemStatus cobre configurada, não configurada e serviço fora do ar'`; `'menu do botão direito (painel_inicial.html e inicio_menu.js) tem "Imprimir etiquetas" com a permissão etiquetas.imprimir, só para Pedido não cancelado'`; `'layout.js: PAGINAS tem etiquetas.html com etiquetas.imprimir'`; `'etiquetas.js compila'`.
- [ ] **Step 2: Rodar e ver falhar:** `node --test test/etiquetas_tela.test.js` → FAIL.
- [ ] **Step 3: Implementar a tela:** cabeçalho do pedido, lista de etiquetas com prévia (CSS em proporção 100:60, dados da própria etiqueta), botões "Imprimir todas" e "Imprimir só esta", status da impressora (chama `/etiqueta/status` ao abrir), "impressas em dd/mm às hh:mm" quando `ultimaImpressao`, mensagem "Este pedido não tem itens para etiquetar". Imprimir = `POST` ao serviço local em lotes de até 50 e, no fim de cada lote enviado com sucesso, `POST /etiquetas/registro`; em falha mostra quantas foram e mantém as restantes. Sem dependência de biblioteca; mensagens de erro em português sem detalhes internos. Itens de menu como os de "Abrir nota fiscal (DANFE)".
- [ ] **Step 4: Documentar:** `docs/etiquetas_zebra.md` (instalar a Zebra com o driver ZDesigner, `etiqueta.config.json` com o nome da impressora, rodar de novo o instalador, teste com o rolo 100 x 60: `^PW`, `^LL`, calibração do sensor) e a seção do `CLAUDE.md` com regras, limites e **"NÃO testado: impressão real na ZD220, acentos e QR no papel"**.
- [ ] **Step 5: Rodar tudo:** `node --test "test/**/*.test.js"` → sem falhas novas (a falha antiga de `test/estoque_analises.test.js` "janela inválida vira 90" já existia e pode continuar).
- [ ] **Step 6: Commit** `feat(etiquetas): tela de impressão, menu e documentação`.

---

## Self-Review

- **Cobertura do spec:** escopo e conteúdo (Task 1), servidor e rotas (Task 3), permissão (Task 2), serviço local com validação, descoberta da impressora e erros (Task 4), tela, menu, status, documentação e fora de escopo (Task 5). A logo bitmap fica fora por pendência do dono (`LOGO_ZPL` vazia, com texto no lugar), como o spec prevê em "Pendências".
- **Consistência de nomes:** `etiquetasDoPedido`, `zplEtiqueta`, `numeroEtiqueta`, `qtdEtiquetas`, `unidadeDoItem`, `qtdDoItem`, `acrescentarPermissoesEtiquetas`, `registrarEtiquetas`, `criarEtiquetas`, `validarZpl` iguais nas tasks que os usam.
- **Correção ao spec:** o campo `total` do spec casaria com `REGEX_VALOR`; trocado por `qtdEtiquetas` (spec atualizado).
- **Risco que nenhum teste cobre:** o envio RAW real ao spooler e a impressão na ZD220 (acentos, QR, calibração do rolo). Validar à mão no PC da fábrica seguindo `docs/etiquetas_zebra.md`.
