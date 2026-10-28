# Plano de corte de vidros — desenho

Data: 2026-10-28. Estado: aprovado pelo usuário em 2026-10-28; próximo passo = plano de implementação.

## 1. Objetivo

A partir de um **Pedido**, distribuir as peças de vidro em **chapas** (corte 2D em guilhotina, com rotação de 90°), minimizando a perda, reaproveitando retalhos retangulares, deixando o cortador marcar as peças e, ao confirmar o corte conferido, dar baixa das chapas novas no estoque. É o equivalente, para vidros, do plano de corte de perfis (`CLAUDE.md`, seção "Plano de corte"). Módulo **paralelo**: não altera o corte de perfis.

## 2. Decisões do usuário

- O vidro é cortado aqui, de chapa inteira.
- Corte em guilhotina (riscos de ponta a ponta), peça pode girar 90°.
- Tamanho da chapa vem do **estoque**: o produto escolhido define a chapa (`estoque.ALTURA` x `estoque.LARGURA`, mm). Não há cadastro de tamanho por modelo.
- `TAMANHO` do vidro no VB é **altura x largura** (`2645x495`).
- `estoque.QTD_ESTOQUE` dos vidros conta **chapas** (apesar de `UNIDADE = 'M²'`); a baixa abate **1 por chapa nova usada**.
- Escopo da versão 1: plano com desenho das chapas, retalhos reaproveitáveis, marcação das peças cortadas, baixa de chapas no estoque (obrigatória ao confirmar).
- Fora do escopo: vários pedidos no mesmo plano, retalho em L (só retângulos), etiquetas/PDF do plano, desfazer a baixa (vale o estorno de saída existente), mais de uma chapa por grupo no mesmo plano.

## 3. Dados encontrados (banco real, só leitura)

- `vidros`: `id, MEDICAO, ITEM, NUMERO, QTD, MODELO, COR_REVESTIMENTO, TAMANHO ('AxL' em mm), M2`. **Sem TIPO.** A web só grava para Pedido (`rotas/ped_orc.js`), mas o VB pode gravar/apagar por número também para orçamento (mesmo problema visto em `perfis`: pedidos e orçamentos têm faixas de número que se sobrepõem).
- `estoque`: produtos de vidro têm `CLASSE = 'Revestimento'`, `UNIDADE = 'M²'`, `ALTURA` e `LARGURA` preenchidas (ex.: Vidro Incolor 4mm 2400x3210; Canelado 1900x2200), `TAMANHO` = área da chapa em m². Há modelos com dois produtos de larguras diferentes (Extra Clear 2400/2540). O nome do modelo no pedido ("Reflecta Fumê 4mm") bate com o do estoque ("Vidro Reflecta Fumê 4mm"); "Pintado Sólido (...)" não tem produto próprio.

## 3.1 Peças (`calculo/vidro_pecas.js`, pura)

- Entrada: linhas de `vidros` do pedido e linhas de `ped_orc_itens_v4` (`TIPO = 'Pedido'`).
- Cada linha vira `QTD` peças `{ modelo, cor, altura, largura, item, medicao }`; grupo = `modelo|cor` (cor em branco é válida).
- `TAMANHO` inválido, ≤ 0 ou ilegível = **pendência**; a peça fica fora do plano, nunca é estimada.
- **Conferência anti-documento-errado (regra medida em dados reais, só leitura):** cada linha de `vidros` só vale se existir, em `ped_orc_itens_v4` do **Pedido** (`TIPO = 'Pedido'`), uma linha do mesmo `ITEM_PEDIDO` com `REVESTIMENTO = MODELO` e `COR_REVESTIMENTO` igual a `COR_REVESTIMENTO` (nulo = vazio, sem diferenciar caixa nem espaços). Linha que não bate (ou item que não existe nos itens do Pedido) vira **pendência** do item e a peça fica fora do plano. **Quantidades NÃO são comparadas**: o VB grava `vidros.QTD` por peça de vidro, não por porta (ex.: 9 peças para 3 portas), e a soma das quantidades só bateu em 82% dos itens de pedidos recentes (23000+), enquanto o par modelo+cor bateu em 100%. Pedidos antigos (números abaixo de ~22000) têm bem menos itens ligáveis e muitos vão aparecer como pendência: é o esperado, sem estimar.
- Peça maior que a chapa escolhida (mesmo girada) = pendência de grupo na geração do plano.

## 3.2 Otimização (`calculo/vidro_otimizacao.js`, pura, determinística)

- Entrada: peças do grupo, chapa `{altura, largura}`, retalhos disponíveis do **mesmo produto**, parâmetros `{ serraMm, sobraMinimaMm }`.
- Guilhotina em níveis: primeiro heurística por faixas (shelf, com e sem rotação, peças em ordem decrescente), depois busca com teto de nós até um limite de peças por grupo; escolhe (menos chapas novas, menor área usada, menos sobras pequenas). Retalhos entram antes de chapa nova, em ordem crescente de área.
- A folga de serra (`serraMm`) é descontada entre cortes consecutivos; padrão 0.
- Resultado por chapa: lista de peças `{x, y, largura, altura, girada, item}` em mm, e as **sobras retangulares** geradas pela guilhotina; sobra vira retalho candidato só se os dois lados forem ≥ `sobraMinimaMm` (padrão 300).
- Nunca usa mais chapas novas do que a heurística de faixas (testado).

## 3.3 Parâmetros

`web_vidro_config` (uma linha): `serra_mm`, `sobra_minima_mm`. Editáveis com `corte.parametros`. Não há tamanho de chapa por modelo.

## 3.4 Tabelas (em `seguranca/instalacao.js`, mm inteiros, sem FK para o VB)

- `web_vidro_config` — acima.
- `web_vidro_retalhos`: `id, produto_codigo, produto_nome, altura_mm, largura_mm, status (disponivel|reservado|usado|descartado), plano_id, origem_plano_id, criado_por, criado_em`.
- `web_vidro_planos`: `id, numero, status (gerado|conferido|cancelado), parametros, resultado, progresso (JSON texto), criado_por, criado_em, conferido_por, conferido_em, excluido_em`. `desatualizado` NÃO é gravado: é calculado na leitura pela impressão digital das peças do pedido.

## 3.5 Rotas (`rotas/corte_vidros.js`, registradas por `registro.rota`)

- `GET /corte_vidros/pedido/:n` — pré-visualização (não grava nem reserva): grupos, pendências, produtos de vidro candidatos (código, nome, altura, largura, `qtdEstoque`) e pré-seleção por nome. Recebe a escolha de produto por grupo (query `produtos=chave:codigo,...`) e devolve o plano calculado.
- `POST /corte_vidros/pedido/:n/salvar` — recalcula no servidor com retalhos travados (`FOR UPDATE`); 409 se a impressão das peças ou os retalhos usados diferirem da pré-visualização; reserva retalhos; substitui o plano `gerado` anterior.
- `GET /corte_vidros/plano/:id`; `PUT /corte_vidros/plano/:id/pecas` — marcação em lote (até 500; também uma só), como em `/corte/plano/:id/pecas`; tela guarda em `localStorage` `corte_vidros_marcas_<plano>` e envia depois de 3 s, ao sair e antes de qualquer ação do plano.
- `POST /corte_vidros/plano/:id/confirmar` — só plano `gerado` (trava a linha; duas vezes = 409). Corpo: `sobras` conferidas (medida real ≤ calculada, lados ≥ sobra mínima → retalhos novos), `retalhosNaoUsados` voltam a disponível, retalho usado → usado, **`baixas: [{chave, produtoCodigo}]`** (ver 3.6).
- `POST /corte_vidros/plano/:id/cancelar`; `DELETE /corte_vidros/pedido/:numero` (apaga planos do pedido e solta reservas; plano conferido exige `incluirConferidos: true` + `corte.parametros`; auditoria `corte_vidros_dados_pedido_excluidos`).
- `GET/PUT /corte_vidros/config`; retalhos: `GET/POST/PUT /corte_vidros/retalhos`, `POST .../descartar`.
- `GET /corte_vidros/estoque/produtos` — produtos `CLASSE = 'Revestimento'`, `SITUACAO = 'Ativo'`, `ALTURA > 0` e `LARGURA > 0`; devolve código, nome, unidade, altura, largura, `qtdEstoque`, sem dinheiro.
- Exportar `liberarPlanosVidroDoPedido`, usada ao cancelar/excluir pedido em `rotas/ped_orc.js` na mesma transação (também para plano conferido: soltar com `excluido_em`, porque o NUMERO é reaproveitado, MAX+1).

## 3.6 Baixa de chapas no estoque

- Dentro da transação de confirmar, conta as chapas **novas** (não retalho) por grupo; soma por produto (dois grupos com o mesmo produto somam, não são recusados).
- Exige `baixas` com uma escolha por grupo com chapa nova. 400 com mensagem clara: `baixas` ausente, produto faltando, chave desconhecida ou repetida, código inválido, produto inexistente, produto fora da lista de vidros, ou **produto diferente do usado na geração do plano** (o produto da baixa é o mesmo que definiu a chapa; a escolha da geração fica gravada no plano).
- Reaproveita `rotas/estoque_saida.js` (`travarProdutos`, `conferirSaldo`, `gravarSaidas`): `FOR UPDATE`, saldo negativo = 400 com a mesma mensagem de `/estoque/saida`, grava `saida_estoque` e abate `QTD_ESTOQUE` em chapas. `USUARIO = req.user.nome`.
- Plano só com retalhos confirma sem baixa e sem exigir permissões de estoque.
- Falha em qualquer etapa (inclusive retalho que perdeu a reserva) = rollback total: estoque, saídas, retalhos e plano.
- Auditoria `corte_vidros_baixa_estoque` com `itens: [{produto, qtd}]`; nenhum nome de campo pode casar com `REGEX_VALOR` (`seguranca/valores.js`): usar `qtd*`/`chapas`.

## 3.7 Permissões

`corte.ver`, `corte.planejar` (rotas de plano e retalhos), `corte.parametros` (config, excluir plano conferido). Confirmar plano com chapa nova exige também `estoque.ver` e `estoque.movimentar`; o `GET /corte_vidros/estoque/produtos` exige as quatro (`corte.ver`, `corte.planejar`, `estoque.ver`, `estoque.movimentar`), como o do corte de perfis. Sem permissões novas. Nada aqui é dinheiro: rotas não exigem `valores.ver`.

## 3.8 Tela (`corte_vidros.html` / `corte_vidros.js`)

- Mesmo estilo e menu do corte de perfis (acrescentar item no `layout.js`, sem nova permissão de menu).
- Abas Plano, Retalhos, Parâmetros.
- Plano: busca o Pedido; lista pendências; por grupo mostra o seletor do produto de vidro (pré-selecionado por nome quando único); cada chapa desenhada em escala em CSS (peças numeradas por item, indicação de giro, retalhos em destaque, sobras); lista de cortes; clique marca a peça cortada.
- Conferência: sobras com a medida real digitada, bloco "Baixa no estoque" (uma linha por produto com o nº de chapas) e validação antes de enviar.
- Sem biblioteca de gráficos.

## 4. Erros e casos-limite

- Pedido sem vidros = 404 "Este pedido não tem vidros."; só Pedido (como `desenharVidros`).
- Grupo sem produto escolhido na pré-visualização = grupo "aguardando produto" (não entra no plano, sem erro); salvar exige todos os grupos com produto ou pendência explícita.
- Retalho só serve ao mesmo produto; dois planos disputando o mesmo retalho: o segundo falha (409).
- Exclusão feita direto pelo VB deixa reserva órfã; a aba Retalhos tem "Cancelar plano N" (igual aos perfis).
- Estoque com `ALTURA`/`LARGURA` zeradas não aparece como candidato.

## 5. Testes (node:test, sem MySQL; bancos falsos em `test/apoio/`)

- `test/vidro_pecas.test.js`, `test/vidro_otimizacao.test.js` (inclui: nunca mais chapas que a heurística de faixas; rotação; peça maior que a chapa; serra; sobras), `test/vidro_validacao.test.js`.
- `test/corte_vidros_rotas.test.js`, `test/corte_vidros_plano_rotas.test.js` (salvar/409/confirmar/cancelar/excluir/retalhos, banco `test/apoio/bancoVidros.js`).
- `test/corte_vidros_baixa_estoque.test.js`: baixa correta em chapas, soma de dois grupos no mesmo produto, saldo insuficiente (400, nada muda), produto faltando, produto diferente do da geração, retalho não baixa, rollback total, confirmar 2x = 409, 403 sem permissão de estoque.
- `test/corte_vidros_tela.test.js` (HTML estático) e teste de cancelar/excluir pedido com plano de vidros.
- A tela real no navegador e o MySQL real não entram nos testes automáticos.
- Verificação final: `npm test`.

## 6. Documentação

Acrescentar ao `CLAUDE.md` uma seção "Plano de corte de vidros" e atualizar a lista de pastas.

## 7. Pontos em aberto para o usuário

1. Padrões iniciais: folga de serra 0 mm e sobra mínima de retalho 300 mm — ajustar na aba Parâmetros.
2. ~~Regra de conferência de `vidros`~~ — derivada e fixada na seção 3.1 (modelo + cor por item, sem comparar quantidades).
3. ~~Confirmar se `vidros.TAMANHO` é a medida de corte~~ — **confirmado pelo usuário**: a tabela `vidros` são as peças de produção, com medidas exatas e finais; `TAMANHO` já é a medida de corte (nenhuma folga a descontar).
