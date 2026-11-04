# Portal do cliente, etapa 3c: documentos (PDF do pedido e DANFE). Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente logado, com `documentos.ver`, abre o PDF do pedido (sem preços) e o DANFE dos pedidos da própria empresa, com isolamento por pedido, 404 uniforme, limite de abertura e auditoria.

**Architecture:** duas refatorações sem mudança de comportamento (ligação pedido-nota do DANFE e carregamento de dados do PDF viram módulos compartilhados), três rotas `registro.portal` que sempre conferem a posse do pedido por `c.CODIGO = ?` da sessão antes de gerar ou servir qualquer arquivo, e uma tela de detalhe do pedido.

**Tech Stack:** Node.js, Express 4, pdfkit (já usado), mysql2 (pool injetado), express-rate-limit, `node:test`, HTML/JS puro com CSP sem inline.

**Spec:** `docs/superpowers/specs/2026-11-04-portal-etapa3c-documentos-design.md`. Padrão de referência: 3a/3b (`rotas/portal_pedidos.js`, `rotas/portal_financeiro.js`, seus testes e pools falsos).

## Global Constraints

- Rotas só por `registro.portal('get', ..., ['documentos.ver'], ...)`; empresa só de `req.portal.empresaCodigo`; nenhum parâmetro, cabeçalho ou corpo escolhe empresa.
- A posse do pedido (`c.CODIGO = ? AND p.TIPO = 'Pedido' AND p.NUMERO = ?`) é conferida ANTES de gerar ou ler qualquer arquivo. Todo insucesso (alheio, inexistente, orçamento, número ou chave mal formados, chave fora das notas do pedido) = o mesmo 404 `{ error: 'Documento não encontrado.' }`, mesmo status, corpo e cabeçalhos.
- `GET /portal/api/pedidos/:numero/documentos` → `{ pdfPedido: true, notas: [{ chave, numeroNf, serie }] }`; nunca `origem`, `enviadoEm` nem `semArquivo`.
- PDF do pedido: `verValores: false`, `producao: false`; antes de desenhar, `SUB_TOTAL`, `TOTAL`, `DESCONTO`, `OBS_GERAL` do cabeçalho e `UNITARIO`, `VALOR_UNITARIO`, `VALOR_TOTAL`, `VALOR`, `SUB_TOTAL`, `TOTAL`, `DESCONTO` de itens e complementos vão a `null`/vazio.
- Arquivos: `application/pdf`, `Content-Disposition: inline; filename="Pedido-<n>.pdf"` ou `"NF-<numeroNf>.pdf"` (só dígitos), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`.
- Limite por usuário nas duas rotas de arquivo: 30 aberturas por 10 minutos (`express-rate-limit`, chave `req.portal.usuarioId`, em memória), 429 `{ error: 'Muitas aberturas de documento. Aguarde alguns minutos.' }`.
- Auditoria `documento_aberto` só em abertura bem-sucedida de arquivo; detalhe `tipo=pdf;pedido=<n>` ou `tipo=danfe;pedido=<n>;nf=<numeroNf>`; falha de gravação não impede a abertura; nunca a chave inteira nem valores.
- Erro de banco ou do gerador: 500 `{ error: 'Erro de servidor' }`, log só com `err.code`/mensagem fixa, nunca dado do pedido.
- Refatorações: comportamento externo idêntico; `test/danfe_*.test.js`, `test/pdf_*.test.js` e demais testes existentes continuam passando sem alterar suas expectativas.
- Front: sem script/estilo inline, texto por `textContent`, `PortalApi.chamar`, 401 volta a `/portal/login.html`.
- Testes de segurança desta base já tiveram teste vazio: contagem > 0 e prova de mutação. Escrever arquivos só com Write/Edit, nunca heredoc de shell. `git add` só dos arquivos da tarefa, pelo nome (a árvore pode ter trabalho de outra frente e há um auto-commit externo; nunca stash/add -A). Commits na main com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Cada tarefa vê o teste falhar antes de implementar (nas refatorações, o "teste" é a suíte existente verde antes e depois, mais os testes novos dos módulos extraídos).

## Review Focus

- DANFE: chave de uma nota ligada ao pedido de OUTRA empresa, chave válida porém não ligada a nenhum pedido, e chave ligada ao pedido da empresa mas pedida pelo número de outro pedido da mesma empresa: todas 404 (Tarefa 2).
- PDF: valores sentinela em `TOTAL`, `UNITARIO` e `OBS_GERAL` nunca chegam ao gerador (Tarefa 2); pedido sem itens ou desenho corrompido não derruba o servidor (500 genérico, não crash).
- O 404 de documentos é indistinguível entre alheio, inexistente, orçamento e `12abc` (Tarefa 2).
- Pedido sem nenhuma nota: `/documentos` devolve `notas: []` com 200, e a tela não mostra botão de nota (Tarefa 3).
- Refatoração: `GET /danfe/pedido/:n` e `GET /dados_pdf` respondem exatamente como antes, inclusive a checagem de estados antes de carregar o corpo (Tarefa 1).

---

### Task 1: Refatorações compartilháveis (DANFE e dados do PDF)

**Files:**
- Create: `rotas/danfe_ligacao.js`, `pdf/carregar_ped_orc.js`
- Modify: `rotas/danfe.js`, `index.js` (só a rota `GET /dados_pdf`)
- Test: `test/danfe_ligacao.test.js`, `test/pdf_carregar_ped_orc.test.js`

**Interfaces:**
- Produces:
  - `criarLigacaoDanfe({ pool }) -> { cnpjEmpresa(db), notasDoFinanceiro(db, pedido, empresa), pedidosDaNota(d, empresa), notasDoPedido(numero) -> Promise<{ notas: Array<{ chave, numeroNf, serie, origem, enviadoEm }>, semArquivo: number[] }> }` (mesma lógica e mesmas consultas de `rotas/danfe.js`; `notasDoPedido` = vínculo manual primeiro, depois as do financeiro sem repetir chave, e `semArquivo` como hoje).
  - `carregarCabecalhoPedOrc(pool, numero, tipo) -> Promise<cab|null>` (`SELECT RAZAO_SOCIAL, CLIENTE_FINAL, DATA, DATA_PRONTO, OBS_GERAL, SUB_TOTAL, TOTAL, DESCONTO FROM ped_orc WHERE NUMERO = ? AND TIPO = ?`).
  - `carregarCorpoPedOrc(pool, { numero, tipo, cab, producao }) -> Promise<{ itens, v4, serr, comps, compSerr, furos, medicao, desenhos }>` (as demais consultas de `/dados_pdf`, inclusive `medicao` só com `producao` e os `desenhos` por carimbo/`validarPng`).

- [ ] **Step 1:** Rodar `node --test test/danfe_*.test.js test/pdf_*.test.js test/etiquetas_rotas.test.js` e anotar a contagem verde (linha de base).
- [ ] **Step 2: Write the failing tests:** `test/danfe_ligacao.test.js` (com `test/apoio/bancoDanfe.js`: `notasDoPedido` devolve manual antes de financeiro sem repetir chave, marca `origem`, preenche `semArquivo` com números de NF do financeiro sem PDF, e devolve `{ notas: [], semArquivo: [] }` para pedido sem ligação) e `test/pdf_carregar_ped_orc.test.js` (cabeçalho inexistente → `null`; corpo devolve as 6 listas e `medicao` vazia sem `producao`; desenho só entra com carimbo igual e PNG válido) usando o pool falso que os testes `pdf_*` já usam. Rodar: FAIL (módulos não existem).
- [ ] **Step 3: Implement** os dois módulos movendo o código existente sem alterar comportamento; trocar `rotas/danfe.js` (rotas `GET /danfe/pedido/:numero` e `GET /danfe/:chave/pdf`) e a rota `GET /dados_pdf` de `index.js` para usá-los, mantendo a checagem de estados entre o cabeçalho e o corpo.
- [ ] **Step 4: Run** os testes novos e a linha de base do Step 1 (sem alterar nenhuma expectativa existente), depois `npm test`. Expected: PASS, mesma contagem verde mais os novos.
- [ ] **Step 5: Commit** `refactor: ligação do DANFE e dados do PDF do pedido viram módulos compartilhados`.

### Task 2: Rotas de documentos, isolamento, limite e auditoria

**Files:**
- Create: `rotas/portal_documentos.js`, `test/apoio/poolDocumentosPortal.js`
- Test: `test/portal_documentos_rotas.test.js`
- Modify: `index.js` (require e registro logo após `registrarPortalFinanceiro`), `test/portal_auth_rotas.test.js` (lista exata de `rotasPortal()` ganha as 3 rotas)

**Interfaces:**
- Consumes: Tarefa 1 (`criarLigacaoDanfe`, `carregarCabecalhoPedOrc`, `carregarCorpoPedOrc`); `numeroValido` de `calculo/portal_pedidos.js`; `lerChave` de `calculo/danfe.js`; `auditarPortal` de `portal/auditoria.js`; `pdfPedOrc.novoDocumento/desenharPedOrc/destinoPdf` de `pdf/ped_orc.js`; `req.portal` (`usuarioId`, `empresaCodigo`), `req.ip`.
- Produces: `registrarPortalDocumentos({ portal, pool, pdf = require('../pdf/ped_orc') }) -> void` (o parâmetro `pdf` permite espiar `desenharPedOrc` nos testes). `criarPoolDocumentos({ pedidos, clientes, danfe, vinculos, fluxo, ... }) -> pool` com `execute`, `chamadas[]`, `auditoria[]`.

- [ ] **Step 1: Write the failing tests** em `test/portal_documentos_rotas.test.js` (app montado como `test/portal_financeiro_rotas.test.js`; `pdf` injetado com espião que registra os argumentos de `desenharPedOrc` e chama o real). Dados: ACME (40) e BETA (41); pedidos de ACME `12` e `13`, de BETA `99`, orçamento `15` de ACME; DANFE `chaveA` ligado manualmente ao pedido 12 de ACME, `chaveF` ligado ao 13 pelo financeiro, `chaveB` ligado ao pedido 99 de BETA, `chaveSolta` sem ligação; valores sentinela em `TOTAL`, `SUB_TOTAL`, `DESCONTO`, `UNITARIO`, `OBS_GERAL`. Testes:
  1. `/documentos` do 12: `{ pdfPedido: true, notas: [{ chave: chaveA, numeroNf, serie }] }` com exatamente essas 3 chaves por nota; do 13: nota `chaveF`; contagem > 0; corpo sem `origem`, `enviadoEm`, `semArquivo` nem sentinelas.
  2. `/pdf` do 12: 200, `Content-Type: application/pdf`, corpo começa com `%PDF-`, cabeçalhos da spec (inline com `Pedido-12.pdf`, `no-store`, `nosniff`, `Content-Security-Policy: sandbox`); o espião recebeu `verValores: false`, `producao: false`, e nenhum valor sentinela nem `OBS_GERAL` em `cab`, `itens`, `v4`, `comps`, `compSerr` (busca na serialização).
  3. `/danfe/:chave` do 12 com `chaveA`: 200, `application/pdf`, `NF-<n>.pdf`, bytes iguais aos do banco falso, mesmos cabeçalhos.
  4. **404 uniforme**: pedido `99` (de BETA), `777`, orçamento `15`, `12abc` em `/documentos`, `/pdf` e `/danfe/...`; `/danfe/<chaveB>` pelo pedido 12; `/danfe/<chaveSolta>` pelo 12; `/danfe/<chaveA>` pelo pedido 13 (da mesma empresa, mas chave ligada ao 12); chave com 43 dígitos ou letras: todos com status, corpo e cabeçalhos (menos `date`) idênticos entre si e ao 404 de `/documentos`; nenhum 404 gerou auditoria nem consultou a tabela de PDF.
  5. SQL fixo e isolamento: a consulta de posse contém `c.CODIGO = ?` e `p.TIPO = 'Pedido'`, `params[0] === 40` mesmo com `?empresa=41` e `X-Empresa`; `assert.doesNotMatch(sql, /\bOR\b/i)`.
  6. **Prova de mutação** (mesmo desenho da 3a/3b): wrapper do pool troca `c.CODIGO = ?` por `1 = 1`; com isso o pedido 99 de BETA passa a abrir e a asserção de isolamento rejeita; controle sem mutação passa.
  7. Auditoria: 1 linha `documento_aberto` por abertura 200 de `/pdf` (`tipo=pdf;pedido=12`) e de `/danfe` (`tipo=danfe;pedido=12;nf=<n>`); nenhuma em `/documentos`, 404, 403, 429; detalhe sem a chave inteira; pool de auditoria lançando erro mantém o 200 e o arquivo.
  8. Limite: a 31ª abertura do mesmo usuário em 10 minutos → 429 com a mensagem da spec (usar `limite` injetável para o teste, padrão 30/10 min); outro usuário não é afetado; `/documentos` não conta.
  9. Permissão: sem cookie 401; JWT de funcionário 401; usuário sem `documentos.ver` (só `pedidos.ver`) 403 sem consulta ao banco; empresa suspensa 401.
  10. Erro: gerador que lança e `execute` que lança `{ code: 'ER_X' }` → 500 `{ error: 'Erro de servidor' }`, o processo continua respondendo, log sem dado do pedido; desenho corrompido não derruba (500 ou PDF sem a imagem, nunca crash).
  11. `registro.rotasPortal()` contém as 3 rotas; `registro.verificar()` passa.
- [ ] **Step 2: Run** `node --test test/portal_documentos_rotas.test.js`. Expected: FAIL (`MODULE_NOT_FOUND`).
- [ ] **Step 3: Implement** `test/apoio/poolDocumentosPortal.js` (reconhece só as consultas de posse, DANFE, vínculos, financeiro, corpo do PDF e o INSERT de auditoria; aplica o filtro de empresa pelo texto `c.CODIGO = ?`) e `rotas/portal_documentos.js`: helper `posse(pool, empresa, numero)`; `respostaNaoEncontrado(res)` único para todo insucesso; zerar campos de dinheiro e `OBS_GERAL` antes de `desenharPedOrc`; PDF gerado em memória (coletar o stream do `PDFDocument` em um `Buffer` e então responder, para que um erro do gerador vire 500 antes de qualquer byte); cabeçalhos da spec; auditoria com `await` antes de enviar; limitador `express-rate-limit` por usuário passado como handler extra de `portal(...)` nas duas rotas de arquivo (parâmetro `limite` com padrão `{ janelaMs: 10 * 60 * 1000, max: 30 }`).
- [ ] **Step 4:** registrar em `index.js` (`registrarPortalDocumentos({ portal: registro.portal, pool })`) e atualizar a lista exata de `test/portal_auth_rotas.test.js`.
- [ ] **Step 5: Run** `node --test test/portal_documentos_rotas.test.js`, depois `npm test`. Expected: PASS (inclusive `test/seguranca_registro.test.js` e `test/seguranca_barreira.test.js`).
- [ ] **Step 6: Commit** `feat(portal): documentos do pedido (PDF e DANFE) para o cliente`.

### Task 3: Tela do pedido, link na lista e documentação

**Files:**
- Create: `portal/public/pedido.html`, `portal/public/pedido.js`
- Modify: `portal/public/pedidos.js` (número vira link para `pedido.html?numero=N`), `test/portal_paginas.test.js` (listas `HTMLS`/`JSS` e teste HTTP de cabeçalhos), `test/portal_pedidos_tela.test.js` (ajustar à célula com link, sem afrouxar), `docs/regras/portal-identidade.md`, `CLAUDE.md`, `docs/portal_configuracao.md`
- Test: `test/portal_pedido_tela.test.js`

**Interfaces:**
- Consumes: `GET /portal/api/pedidos/:numero` (3a), `GET /portal/api/pedidos/:numero/documentos`, `/pdf`, `/danfe/:chave` (Tarefa 2), `/portal/api/eu` (`usuario.permissoes`); padrão de `portal/public/pedidos.js` e `financeiro.js`.

- [ ] **Step 1: Write the failing test** `test/portal_pedido_tela.test.js` (DOM falso com `vm`, como `portal_financeiro_tela.test.js`): `pedido.html`/`pedido.js` existem e passam as regras de página (sem inline, sem `innerHTML` etc.); `?numero=12abc` ou ausente mostra erro sem chamar a API; mostra o status do pedido (rótulos já traduzidos) por `textContent`; sem `documentos.ver` NÃO chama `/documentos` nem mostra botões; com a permissão mostra "PDF do pedido" e um botão por nota, cujos `href` são exatamente `/portal/api/pedidos/12/pdf` e `/portal/api/pedidos/12/danfe/<chave de 44 dígitos>` (chave que não casa `/^\d{44}$/` é ignorada), com `target="_blank"` e `rel="noopener"`; `notas: []` não mostra botão de nota; 401 → login; 404 do detalhe mostra "Pedido não encontrado."; falha de rede mostra erro; a lista (`pedidos.js`) renderiza o número como link `pedido.html?numero=<n>` com `n` numérico.
- [ ] **Step 2: Run** `node --test test/portal_pedido_tela.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `pedido.html` (título de 2 a 4 palavras, por exemplo "Detalhe do pedido"), `pedido.js` e o link em `pedidos.js`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (as 3 falhas conhecidas de funcionários, se ainda existirem na árvore de outra frente, não contam; confirmar que são só elas).
- [ ] **Step 5: Documentar:** seção "Etapa 3c: documentos" em `docs/regras/portal-identidade.md` (rotas, posse do pedido, 404 uniforme, PDF sem preços e sem `OBS_GERAL`, DANFE só de nota ligada ao pedido, cabeçalhos com `sandbox`, limite e auditoria `documento_aberto` na lista de eventos, refatorações, o que NÃO foi testado: MySQL real, `pdfkit` com dados reais, navegador real); `CLAUDE.md` (linha do Portal do cliente: cliente já vê pedidos, financeiro e documentos; falta só a etapa 4; seção 2 lista `rotas/portal_documentos.js`, `rotas/danfe_ligacao.js`, `pdf/carregar_ped_orc.js`, `pedido.html/.js`); `docs/portal_configuracao.md` (linha de abertura e seção 11 incluem documentos; passo novo na seção 12: abrir o PDF e o DANFE de um pedido real de empresa de teste e conferir que o PDF não tem preços nem observação geral, a ligação da nota e o tempo de geração).
- [ ] **Step 6: Commit** `feat(portal): tela do pedido com documentos e documentação da etapa 3c`.

---

## Self-review (feito)

- **Cobertura da spec:** seção 2 (rotas, limite) → Tarefa 2; 3 (isolamento, 404) → Tarefa 2 testes 4 a 6; 4 (PDF sem preços) → Tarefa 2 teste 2; 5 (cabeçalhos) → testes 2 e 3; 6 (auditoria) → teste 7; 7 (refatorações) → Tarefa 1; 8 (tela) → Tarefa 3; 9 e 11 → Tarefas 2 e 3 (docs).
- **Consistência de nomes:** `criarLigacaoDanfe`, `notasDoPedido`, `carregarCabecalhoPedOrc`, `carregarCorpoPedOrc`, `registrarPortalDocumentos`, evento `documento_aberto`, mensagem 404 única `Documento não encontrado.`.
- **Risco aberto:** consultas e geração de PDF só em banco falso; `pdfkit` com dados reais e o DANFE no navegador não foram testados.
