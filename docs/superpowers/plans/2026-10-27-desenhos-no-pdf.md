# Desenho da porta na coluna Imagem do PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O desenho da porta gerado na configuração é guardado com o item e impresso na coluna Imagem dos PDFs de Pedido, Orçamento e Guia de Produção.

**Architecture:** A tela captura um PNG limpo ao adicionar/atualizar o item e o envia (binário, separado do salvar, por causa do limite de 100 kb do JSON). O servidor guarda em `web_item_desenhos` com um carimbo do conteúdo dos itens; itens copiados levam a imagem do item de origem dentro do salvar. O PDF só usa imagens cujo carimbo bate com o documento atual.

**Tech Stack:** Node.js + Express 4, mysql2, pdfkit, front-end HTML/JS puro, testes `node:test` com banco simulado.

**Spec:** `docs/superpowers/specs/2026-10-27-desenhos-no-pdf-design.md`

## Global Constraints

- Tabelas do VB não são alteradas; o novo fica em `web_item_desenhos` (criada em `seguranca/instalacao.js`).
- PNG de até **150 kb** (150 * 1024 bytes), assinatura PNG conferida pelos bytes (`89 50 4E 47 0D 0A 1A 0A`).
- Corpo do salvar continua ≤ 100 kb: **nenhuma imagem vai no JSON** de `POST /ped_orc/salvar`.
- Carimbo = SHA-256 hex (64 caracteres) de: linhas de `itensV4` e `furacao` completas + linhas de `lista` só com as colunas `ITEM`, `QTD`, `TIPO_PRODUTO`; **sem** cabeçalho, sem dinheiro, independente da ordem das linhas.
- PDF: imagem **contida** na largura da célula e em no máximo **170 pt** de altura; pesos das colunas do VB **inalterados** (2, 2, 7, 21, 11, 5, 5).
- Captura limpa: sem cotas em texto, sem fantasmas/zonas de clique, sem marcadores de furo; caixa máxima 300×500 px, sem DPR; só frentes Porta de giro, Porta basculante, Porta de Correr e Frente de gaveta.
- Erro ao ler imagens no PDF nunca derruba o PDF (célula vazia).
- Dado de imagem não é dinheiro; nomes de campo novos não casam com `REGEX_VALOR` (`seguranca/valores.js`).
- Commits direto na `main`; mensagem termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Arquivo que não é PNG (HTML/JPEG renomeado, corpo vazio, > 150 kb): 400 e nada gravado → Task 2.
- Item removido no meio da lista: a imagem do item 3 não pode aparecer no item 2 depois da renumeração → Task 3.
- Atualizar um documento sem mexer num item: a imagem dele continua (cópia no servidor) → Task 3.
- Documento alterado pelo VB depois do salvar (carimbo diferente): PDF sem imagem, sem erro → Task 4.
- Falha ao enviar uma imagem depois de salvar: o pedido continua salvo e o usuário é avisado → Task 5.

---

## File Structure

- Modify `calculo/leitura_vb.js` — `carimboItens`.
- Modify `seguranca/instalacao.js` — tabela `web_item_desenhos`.
- Modify `rotas/ped_orc.js` — `PUT /ped_orc/:tipo/:numero/desenho/:item`; salvar copia/apaga imagens; excluir apaga imagens.
- Modify `pdf/ped_orc.js`, `index.js` (`/dados_pdf`) — imagem na célula.
- Create `desenhos.js` (funções puras da tela, UMD), modify `orcamentos.html` — captura e envio.
- Modify `CLAUDE.md`.
- Tests: `test/carimbo.test.js`, `test/desenhos_rotas.test.js`, `test/desenhos_salvar.test.js`, `test/pdf_desenhos.test.js`, `test/desenhos_tela.test.js`; modify `test/apoio/bancoPedOrc.js`.

### Task 1: Carimbo do conteúdo dos itens

**Files:**
- Modify: `calculo/leitura_vb.js` (exportar junto de `impressaoDigital`)
- Test: `test/carimbo.test.js`

**Interfaces:**
- Produces: `carimboItens(linhas: { lista?: object[], itensV4?: object[], furacao?: object[] }) -> string` (64 hex). Linhas são as cruas do banco (`SELECT *`), como devolve `lerDocumento` em `rotas/ped_orc.js`.

- [ ] **Step 1: Write the failing tests** em `test/carimbo.test.js`:
  - mesmo conteúdo em outra ordem de linhas → mesmo carimbo;
  - muda ao alterar `ALTURA` de uma linha de `itensV4`, `QTD` de `lista`, `FURO` de `furacao`, `POSICAO_PUXADOR` de `itensV4`;
  - **não** muda ao alterar `DESCRICAO`, `UNITARIO`, `TOTAL` de `lista` nem ao passar chaves extras (`cab`, `vidros`);
  - números como `2286` e `'2286'` dão o mesmo carimbo; `id` das linhas não influencia; devolve string `/^[0-9a-f]{64}$/` também para `{}`.
- [ ] **Step 2: Run** `node --test test/carimbo.test.js` — Expected: FAIL (função não existe).
- [ ] **Step 3: Implement** `carimboItens` em `calculo/leitura_vb.js`: para `lista`, projetar só `ITEM`, `QTD`, `TIPO_PRODUTO`; descartar `id`/`ID`; cada linha vira JSON de pares chave/valor ordenados por chave com valor `null` ou `String(valor)`; ordenar as strings de cada tabela; SHA-256 de `JSON.stringify` das três tabelas (mesmo `crypto` já usado por `impressaoDigital`).
- [ ] **Step 4: Run** o teste — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pdf): carimbo do conteúdo dos itens (para validar desenhos guardados)`.

### Task 2: Tabela e rota de envio do desenho

**Files:**
- Modify: `seguranca/instalacao.js` (nova entrada em `TABELAS`, depois de `web_entrega_anexos`), `rotas/ped_orc.js`, `test/apoio/bancoPedOrc.js`
- Test: `test/desenhos_rotas.test.js`

**Interfaces:**
- Consumes: `carimboItens` (Task 1); `lerDocumento`, `validarAlvo`-style checagem de `tipo` (`TIPOS`) e de estados (`docParaAcao`, `foraDosEstados`) de `rotas/ped_orc.js`.
- Produces: tabela `web_item_desenhos (id INT AUTO_INCREMENT PK, tipo VARCHAR(20), numero INT, item INT, png MEDIUMBLOB, carimbo CHAR(64), criado_em DATETIME, UNIQUE KEY uq_doc_item (tipo, numero, item))`; `PUT /ped_orc/:tipo/:numero/desenho/:item` (`Content-Type: image/png`, permissões `['orcamentos.criar', 'orcamentos.salvar']`) → `{ ok: true }`; erros 400 (documento/item inválido ou imagem inválida), 403, 404 (documento ou item inexistente; mesma resposta para os dois).

- [ ] **Step 1: Write the failing tests** em `test/desenhos_rotas.test.js` usando o banco simulado de pedidos (`test/apoio/bancoPedOrc.js`; estender com regras que imitam o SQL novo: `INSERT INTO web_item_desenhos ... ON DUPLICATE KEY UPDATE`, `SELECT ... FROM web_item_desenhos WHERE tipo = ? AND numero = ?`, `DELETE FROM web_item_desenhos`): PNG válido (8 bytes de assinatura + dados) grava e responde `{ ok: true }` com `carimbo` igual a `carimboItens` das linhas do documento semeado; segundo envio do mesmo item substitui (upsert, 1 linha); corpo que não começa com a assinatura PNG → 400 e nada gravado; corpo vazio → 400; corpo > 150 kb → 413 ou 400 e nada gravado; item que não existe em `lista` → 404; documento inexistente → 404; `tipo` inválido → 400; usuário sem `orcamentos.salvar` → 403; usuário com estados restritos e cliente de outro estado → 403.
- [ ] **Step 2: Run** `node --test test/desenhos_rotas.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** a tabela e a rota. Rota com `express.raw({ type: 'image/png', limit: 150 * 1024 })` como no `PUT /produtos/imagem/:codigo` de `index.js`; conferir assinatura pelos bytes; ler o documento com `lerDocumento(pool, ...)`, conferir estados e existência do item; gravar com carimbo e `agoraLocal()`; erro de tamanho do `express.raw` deve virar 400/413 JSON (não página HTML). Registrar com `rota(...)` (o servidor só sobe com rotas registradas).
- [ ] **Step 4: Run** o teste, depois `npm test` — Expected: tudo passa.
- [ ] **Step 5: Commit** `feat(pdf): tabela e rota de envio do desenho do item`.

### Task 3: Salvar e excluir cuidam das imagens

**Files:**
- Modify: `rotas/ped_orc.js` (`POST /ped_orc/salvar`, `DELETE /ped_orc/:tipo/:numero`), `test/apoio/bancoPedOrc.js` se faltar regra
- Test: `test/desenhos_salvar.test.js`

**Interfaces:**
- Consumes: `carimboItens` (Task 1); tabela e rota da Task 2; `ehCopia`, `lerDocumento`, `linhasSrc`, `preparados` (`p.copia`, `p.n`, `p.origemItem`) em `rotas/ped_orc.js`.
- Produces: comportamento do salvar — ao regravar, apaga as imagens de `(tipo, numero)`; para cada item copiado cuja imagem de origem existe e cujo carimbo guardado é igual a `carimboItens(linhasSrc)`, grava a imagem na posição nova `p.n` com o carimbo de `carimboItens(await lerDocumento(conn, tipo, numero))` calculado **depois** de gravar todos os itens, na mesma transação; imagens de origem lidas **antes** de apagar. Excluir apaga as imagens do (tipo, número) na transação.

- [ ] **Step 1: Write the failing tests** em `test/desenhos_salvar.test.js` (banco simulado de pedidos, mesmo padrão de `test/ped_orc_salvar.test.js`): atualizar um documento com 2 itens copiados e imagens guardadas → depois do salvar as duas imagens existem, com o carimbo novo; **remover o item 1 e atualizar** → a imagem do antigo item 2 passa a ser do item 1 e não sobra imagem no item 2; item cujo carimbo guardado está velho (documento de origem alterado) → imagem **não** copiada; item novo (não copia) → sem imagem até o envio; salvar como `novo` a partir de um aberto (`origemDocumento`) copia as imagens para o número novo; número reaproveitado com imagens órfãs em `web_item_desenhos` → apagadas pelo salvar; `DELETE /ped_orc/Pedido/:numero` apaga as imagens.
- [ ] **Step 2: Run** `node --test test/desenhos_salvar.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** no `POST /ped_orc/salvar`: depois de `lerDocumento` da origem e da checagem de impressão digital, ler as linhas de `web_item_desenhos` da origem e `carimboItens(linhasSrc)`; junto do `DELETE` das tabelas de itens (e também no ramo `novo`, para limpar órfãs), apagar as imagens do (tipo, número); depois do loop que grava os itens, copiar as imagens elegíveis. No `DELETE /ped_orc/:tipo/:numero`, apagar as imagens na mesma transação.
- [ ] **Step 4: Run** o teste, depois `npm test` — Expected: tudo passa (os testes de salvar existentes continuam verdes).
- [ ] **Step 5: Commit** `feat(pdf): salvar copia e exclusão apaga os desenhos guardados`.

### Task 4: Imagem no PDF

**Files:**
- Modify: `pdf/ped_orc.js` (`montarCelula`, `desenharPedOrc`), `index.js` (`/dados_pdf`)
- Test: `test/pdf_desenhos.test.js`

**Interfaces:**
- Consumes: `carimboItens` (Task 1); tabela (Task 2).
- Produces: `montarCelula` aceita `cel.imagem` + `cel.maxAltura` (contain: reduz mantendo proporção até caber na largura interna e em `maxAltura`; centraliza na horizontal; `altura` da célula = altura da imagem + 2 * PAD); `desenharPedOrc(doc, dados, opcoes)` aceita `dados.desenhos: { [item: number]: Buffer }` e usa `{ imagem: doc.openImage(buffer), maxAltura: 170 }` na célula Imagem da linha do item (vazia se não houver, ou se `openImage` falhar); `/dados_pdf` lê `web_item_desenhos` do (tipo, número), calcula `carimboItens({ lista: itens, itensV4: v4, furacao: furos })` e só envia ao desenho as imagens com carimbo igual; erro na leitura → `desenhos = {}`.

- [ ] **Step 1: Write the failing tests** em `test/pdf_desenhos.test.js` (padrão de `test/pdf_ped_orc.test.js`): gerar um PNG pequeno em memória (por exemplo 40×120, com `pdfkit` não; usar um PNG fixo em base64 de poucos bytes) e verificar com `desenharPedOrc` que a linha do item 1 aceita `desenhos[1]`; PDF gerado tem marcador de imagem (`/Subtype /Image` no buffer); sem `desenhos` o PDF não tem imagem; imagem muito alta é reduzida para ≤ 170 pt (testar a função de contain exportada, ou a altura da célula); `desenhos[1]` com bytes inválidos não derruba o PDF; rota `GET /dados_pdf` com imagem de carimbo igual → PDF com imagem; carimbo diferente → sem imagem e status 200; tabela de imagens falhando (regra do banco simulado que lança) → 200 sem imagem; Guia de Produção (`producao=1`) também usa a imagem; usuário sem `valores.ver` idem.
- [ ] **Step 2: Run** `node --test test/pdf_desenhos.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `montarCelula` com `maxAltura` (a imagem do logo, sem `maxAltura`, continua como hoje); no desenho da tabela de itens, passar a imagem do item na coluna `Imagem` (hoje `{ texto: '' }`); em `/dados_pdf`, ler as imagens com `try/catch`.
- [ ] **Step 4: Run** o teste, depois `npm test` — Expected: tudo passa, incluindo `colunasPdf` (pesos do VB intactos).
- [ ] **Step 5: Commit** `feat(pdf): desenho da porta na coluna Imagem do PDF`.

### Task 5: Captura e envio na tela

**Files:**
- Create: `desenhos.js` (UMD no estilo de `fornecedores.js`: funções puras testadas no Node)
- Modify: `orcamentos.html` (`desenharVisualizacao`, `adicionarItem`, `gravar`, `<script src="desenhos.js?v=...">`)
- Test: `test/desenhos_tela.test.js`

**Interfaces:**
- Produces em `desenhos.js`: `caixaDoDesenho(larguraMm: number, alturaMm: number, { maxW = 300, maxH = 500 } = {}) -> { w: number, h: number }` (escala para caber mantendo proporção, inteiros ≥ 1); `reduzirAteCaber(gerar: (escala: number) => Promise<Blob|null>, limiteBytes: number, { passo = 0.8, minimo = 0.4 } = {}) -> Promise<Blob|null>` (tenta escala 1, depois `escala * passo` até `Blob.size <= limiteBytes`; `null` se passar do mínimo ou se `gerar` devolver `null`); `FRENTES_COM_DESENHO = ['Porta de giro', 'Porta basculante', 'Porta de Correr', 'Frente de gaveta']`; `enviarDesenhos(chamar, tipo, numero, itens) -> Promise<{ enviados: number, falhas: number }>` (para cada `itens[i]` com `desenho` Blob e que não seja cópia, envia `PUT` para `/ped_orc/{tipo}/{numero}/desenho/{i+1}`; nunca lança; conta falhas). `chamar(caminho, { metodo, corpo, tipoConteudo })` é uma função injetada.
- Em `orcamentos.html`: `desenharVisualizacao(opcoes = {})` — `{ alvo, limpo }`; sem opções, comportamento atual **inalterado**.

- [ ] **Step 1: Write the failing tests** em `test/desenhos_tela.test.js`: `caixaDoDesenho(900, 2100)` cabe em 300×500 mantendo proporção (retrato) e `caixaDoDesenho(4000, 500)` fica limitado a 300 de largura; `reduzirAteCaber` com gerador falso cujos tamanhos caem 200 kb → 120 kb → 60 kb devolve o Blob de 120 kb para limite 150 kb com 2 tentativas, devolve `null` quando nenhum tamanho serve, e devolve `null` sem lançar quando `gerar` devolve `null`; `enviarDesenhos` com `chamar` que falha no item 2 devolve `{ enviados: 1, falhas: 1 }` e não lança; itens copiados (`origem` com estado de cópia) e itens sem `desenho` são ignorados; HTML: `orcamentos.html` inclui `<script src="desenhos.js` e chama `enviarDesenhos` depois do `ok` do salvar e antes de `abrirDocumento`.
- [ ] **Step 2: Run** `node --test test/desenhos_tela.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `desenhos.js` e as alterações de `orcamentos.html`: (a) `desenharVisualizacao` aceita `{ alvo, limpo }`: com `alvo` usa esse canvas (já dimensionado por `caixaDoDesenho`), não mexe em `cv.style`, não preenche `cv._zonas`/`cv._cotas`; com `limpo` pula cotas em texto, fantasmas/zonas de clique e marcadores de furo; (b) `adicionarItem` chama a captura (canvas fora da tela via `document.createElement('canvas')`, `toBlob('image/png')`, `reduzirAteCaber` com limite 150 * 1024) para as frentes de `FRENTES_COM_DESENHO` e guarda em `item.desenho` (em edição, a captura nova substitui a anterior); (c) o `desenho` não entra no corpo do salvar nem no rascunho do `localStorage`; (d) `gravar` chama `enviarDesenhos` com `json.numero` logo após `json.ok` e antes de `abrirDocumento`, e se `falhas > 0` mostra "Salvo, mas N desenho(s) não foram enviados; abra o item e salve de novo."
- [ ] **Step 4: Run** `node --test test/desenhos_tela.test.js`, depois `npm test` — Expected: tudo passa. **Verificação manual no navegador (não há navegador nos testes):** adicionar um item de cada frente, salvar, abrir o PDF e conferir a imagem limpa; conferir que a tela de configuração continua desenhando igual (cotas, fantasmas, clique no puxador).
- [ ] **Step 5: Commit** `feat(pdf): captura do desenho ao adicionar o item e envio depois de salvar`.

### Task 6: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md` (seção 5: desenho no PDF — captura limpa, `web_item_desenhos`, carimbo, cópia no salvar, exclusão, limites, pesos das colunas inalterados, pendências: imagens órfãs de exclusões feitas pelo VB e pedidos antigos sem imagem; seção 2/pastas: `desenhos.js`; testes)

- [ ] **Step 1: Edit** `CLAUDE.md` como descrito.
- [ ] **Step 2: Run** `npm test` — Expected: tudo passa; informar o total.
- [ ] **Step 3: Commit** `docs(pdf): CLAUDE.md com o desenho da porta no PDF`.
