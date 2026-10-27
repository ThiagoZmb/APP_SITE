# Desenho da porta na coluna Imagem do PDF — design

## Objetivo
Os PDFs de Pedido, Orçamento e Guia de Produção passam a mostrar, na coluna **Imagem** de cada item de porta, o desenho gerado na tela na hora da configuração (o mesmo que o vendedor aprovou). Hoje a coluna sai vazia, como no VB (`Modulo_Pedido_Orçamento.vb`, `table.AddCell("") ' coluna Imagem`); este é um recurso novo da web.

## Por que capturar na tela e guardar
O desenho é feito no navegador (`desenharVisualizacao` em `orcamentos.html`, canvas `#cv-visualizacao`) e depende de ~20 campos do formulário e do estado em tela (sistema de correr, acessórios, folhas, posições do puxador). Refazê-lo no servidor exigiria separá-lo do formulário e remontar a configuração a partir de várias tabelas. Capturar o PNG ao adicionar/atualizar o item é pouco código e idêntico ao aprovado na tela.

## Restrições do código atual
- `express.json` global aceita no máximo **100 kb**: as imagens **não** vão no corpo de `POST /ped_orc/salvar`; sobem depois, uma a uma, em binário (padrão de `PUT /produtos/imagem/:codigo` e dos anexos de entrega).
- `POST /ped_orc/salvar` regrava tudo e **renumera** os itens (ITEM = posição na lista). Itens sem alteração chegam como cópia (`ehCopia`, `origem.item`, `origem.estado`) e a tela não reenvia o conteúdo deles.
- Tabelas do VB não são alteradas; o novo fica em tabela `web_*`.

## 1. Captura (`orcamentos.html`)
- Ao **Adicionar item** / **Atualizar item** das frentes com desenho (Porta de giro, Porta basculante, Porta de Correr, Frente de gaveta), a tela redesenha o item num canvas **fora da tela**, em modo **limpo** (perfil, vidro, divisores e puxador; **sem cotas em texto e sem "fantasmas"/zonas de clique**), de tamanho fixo proporcional à porta (caixa máxima 300×500 px, sem DPR), e guarda o PNG (Blob) em `item.desenho`. O Blob fica só em memória (não entra no rascunho do `localStorage`).
- `desenharVisualizacao` ganha um modo de saída (`{ alvo, limpo }`) sem mudar nada do comportamento na tela atual (`cv._cotas`, `cv._zonas`, altura do canvas e `modo-pux` continuam iguais; testes existentes que leem esses campos continuam válidos).
- Serralheria, Avulso e itens vindos da leitura de PDF não têm desenho: célula vazia.
- Se o PNG passar de 150 kb, a tela reduz a escala até caber.

## 2. Armazenamento (`seguranca/instalacao.js` + `rotas/ped_orc.js`)
- Tabela `web_item_desenhos`: `id` AUTO_INCREMENT, `tipo` VARCHAR(20), `numero` VARCHAR(20) (como `ped_orc.NUMERO`), `item` INT, `png` MEDIUMBLOB, `carimbo` CHAR(64), `criado_em` DATETIME; UNIQUE (`tipo`, `numero`, `item`).
- **Carimbo** = SHA-256 do conteúdo dos itens do documento (função pura `carimboItens` em `calculo/leitura_vb.js`): linhas de `ped_orc_itens_v4` e `furacao_pedidos_orcamentos` completas, e de `ped_orc_lista_itens` só as colunas `ITEM`, `QTD`, `TIPO_PRODUTO`. **Não** inclui o cabeçalho (situação, datas, observação) nem valores em dinheiro. Independe da ordem das linhas. Recebe linhas cruas (`SELECT *`) para que o salvar, o upload e o PDF cheguem ao mesmo resultado.
- `PUT /ped_orc/:tipo/:numero/desenho/:item` (corpo `image/png`, `express.raw` limite 150 kb; permissões `orcamentos.criar` + `orcamentos.salvar`; mesma regra de estados do cliente do documento): confere assinatura PNG pelos bytes, que o documento e o item existem, calcula o carimbo das linhas atuais e faz upsert. Erros: 400 imagem inválida, 404 documento/item inexistente (resposta uniforme), 403 sem permissão ou fora dos estados.
- `POST /ped_orc/salvar`, na mesma transação: apaga as imagens do (tipo, número) junto das demais tabelas de itens; para cada **item copiado**, copia a imagem do item de origem (`origem.item`, do documento de origem, lida **antes** de apagar) para a nova posição, mas só se o carimbo guardado dela ainda bate com o do documento de origem; grava com o carimbo do documento recém-gravado.
- Exclusão de pedido/orçamento pela web apaga as imagens do número na mesma transação (o NUMERO é reaproveitado).
- Itens novos ou editados: a tela envia os PNGs **depois** de o salvar responder `ok` e **antes** de reabrir o documento (a reabertura reconstrói `itens`). Falha de envio não desfaz o salvar: aviso "Salvo, mas N desenho(s) não foram enviados; abra o item e salve de novo".

## 3. PDF (`pdf/ped_orc.js`, `index.js` `/dados_pdf`)
- `/dados_pdf` lê `web_item_desenhos` do (tipo, número), calcula o carimbo das linhas que já lê e só usa as imagens cujo carimbo bate; qualquer erro na leitura das imagens (tabela ausente, etc.) é ignorado e a célula fica vazia.
- `desenharPedOrc` recebe `dados.desenhos` (mapa item → Buffer PNG). Na linha do item, a célula Imagem usa `{ imagem, maxAltura: 170 }`: a imagem cabe **inteira** (contain) na largura da célula e em no máximo 170 pt de altura, centralizada. A célula já tem alinhamento central/vertical do meio.
- Largura da coluna: **mantém os pesos do VB** (Imagem = 7 de 53 ≈ 76 pt, imagem ≈ 72 pt de largura). Alargar a coluna fica como ajuste posterior, para não quebrar a fidelidade ao VB (teste `colunasPdf`).
- Vale para Pedido, Orçamento e Guia de Produção (com e sem `valores.ver`). Dado técnico: sem dinheiro.
- Fora do escopo: PDF de Vidros, desenhos em pedidos/orçamentos já existentes (ficam vazios até o item ser reaberto e salvo de novo), serralheria, e exibir os desenhos no VB.

## 4. Testes
- `calculo`: `carimboItens` (independe da ordem; muda com medida/puxador/furo/QTD; **não** muda com situação, datas, observação ou valores).
- Rota `PUT`: PNG válido, não-PNG 400, grande demais, permissão, estados, documento/item inexistente, upsert.
- Salvar: apaga e regrava; copia imagem de item sem alteração com carimbo válido; não copia com carimbo divergente; exclusão apaga.
- PDF: com imagem (célula preenchida, imagem contida em 170 pt), sem imagem, carimbo divergente (vazio), erro ao ler imagens (vazio); mesma regra na Guia de Produção.
- Tela: parte pura do modo limpo e da redução de escala; a captura real num navegador é validada à mão (não há navegador nos testes).

## Riscos e pendências
- Mexer em `desenharVisualizacao` é a parte mais delicada (função longa, acoplada ao formulário); o modo limpo precisa de verificação visual no navegador.
- Imagens guardadas no MySQL (MEDIUMBLOB, ≤150 kb por item): volume cresce com o número de pedidos; avaliar limpeza de números órfãos (exclusões feitas pelo VB não passam pela web).
- O carimbo é conservador: qualquer mudança do VB nos itens esconde as imagens do documento até novo salvamento pela web.

## Também atualizar
- `CLAUDE.md` (regras e testes do recurso).
