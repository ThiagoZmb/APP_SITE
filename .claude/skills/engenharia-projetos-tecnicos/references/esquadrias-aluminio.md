# Esquadrias de alumínio: do projeto ao item da tela

Domínio `portas-aluminio` (mapa em `config/regras-por-dominio/portas-aluminio.json`). A skill lê o projeto, monta o **item no formato que a tela de orçamentos/pedidos usa** e entrega só medidas lidas do projeto. **Preço, descontos de fabricação e cálculo de peças ficam no sistema web** (decisão D3, ver `regras-fabricacao.md`). Saída: decisão D4.

Citações no formato `arquivo:linha`, conferidas em 2026-10-26 no repositório. Se esses arquivos mudarem, o teste `montar-itens.test.mjs` só confere a lista de frentes; o restante precisa de revisão manual.

## Onde o item nasce e como o servidor o consome

| Etapa | Onde |
|---|---|
| Tela monta o item | `orcamentos.html:1918-1981` (`coletarForm`) |
| Tela envia os itens ao salvar | `orcamentos.html:2710-2716` (`itens.map(...)` em `POST /ped_orc/salvar`) |
| Servidor valida o corpo | `rotas/ped_orc.js:72-100` (`validar`) |
| Servidor prepara cada item (preço + engenharia) | `rotas/ped_orc.js:129-197` (`prepararItem`) |
| Item → folhas | `calculo/engenharia.js:27-62` (`folhasDoItem`) |
| Folhas iguais agrupadas | `calculo/engenharia.js:70-78` (`agruparFolhas`) |
| Linha comercial (descrição) | `calculo/linhas_vb.js:199-211` (`linhaComercial`) |

Não existe função de validação de item reutilizável: `validar` (`rotas/ped_orc.js:72`) é interna, não exportada (`rotas/ped_orc.js:556` exporta só `registrarPedOrc`, `lerSistemaCorrer`, `lerDocumento`) e valida o documento inteiro. `prepararItem` depende de banco. Por isso a skill **não duplica** essas regras: limites e valores aceitos que ela confere (frente, qtd 1 a 500) estão no mapa, com teste que compara a lista de frentes com `FRENTES_PORTA`. A prova de que a web consegue consumir o item é o teste que chama `folhasDoItem` e `agruparFolhas` de `calculo/engenharia.js` (puras) com os itens montados.

## Formato do item (portas)

Frentes de porta aceitas: `Porta de giro`, `Porta basculante`, `Frente de gaveta`, `Porta de Correr` (`rotas/ped_orc.js:15`). Qualquer outra (exceto `Serralheria` e `Avulso`, que têm payload próprio e **não** são cobertas por este domínio) dá "tipo de produto inválido" (`rotas/ped_orc.js:132`). Note o `C` maiúsculo em `Porta de Correr`; é assim que a web compara (`calculo/engenharia.js:31`, `rotas/ped_orc.js:147`).

| Campo do item | Tipo | Obrig. | Origem no projeto (`atributos.*` salvo indicação) | Citação |
|---|---|---|---|---|
| `frente` | texto (4 valores acima) | sim | `tipo` do item, por tabela de tradução | `orcamentos.html:1945`; `rotas/ped_orc.js:15,131-132`; `calculo/linhas_vb.js:208-210` |
| `qtd` | inteiro 1 a 500 | sim | `quantidade` | `orcamentos.html:1946`; `rotas/ped_orc.js:17,96-97` (`MAX_QTD_ITEM`); `calculo/engenharia.js:29` |
| `altura` | número, mm | sim | `dimensoes.altura` | `orcamentos.html:1948`; `calculo/engenharia.js:30` |
| `largura` | número, mm | sim | `dimensoes.largura` | `orcamentos.html:1949`; `calculo/engenharia.js:30` |
| `detalhes.perfil` | texto | sim | `perfil` | `orcamentos.html:1959`; `rotas/ped_orc.js:186` ("Perfil não informado"); `calculo/engenharia.js:49` |
| `detalhes.acabamento` | texto | sim (*) | `acabamentoPerfil` | `orcamentos.html:1959`; `calculo/engenharia.js:49`; `calculo/precos.js:186` |
| `detalhes.cor` | texto | não | `corPerfil` | `orcamentos.html:1959`; `calculo/engenharia.js:49` |
| `detalhes.puxador` | texto | não | `puxador` | `orcamentos.html:1960`; `calculo/engenharia.js:46,51` |
| `detalhes.tipoPuxador` | texto | não | `tipoPuxador` | `orcamentos.html:1960,1409-1414`; `calculo/engenharia.js:52` |
| `detalhes.acabPux` | texto | não | `acabamentoPuxador` | `orcamentos.html:1962`; `calculo/engenharia.js:51` |
| `detalhes.corPux` | texto | não | `corPuxador` | `orcamentos.html:1962`; `calculo/engenharia.js:51` |
| `detalhes.tamanhoPux` | número, mm | não | `tamanhoPuxador` | `orcamentos.html:1962`; `calculo/engenharia.js:51` (`num`) |
| `detalhes.posicoesFolhas` | lista de texto (uma posição por folha) | não | `posicoesPuxador`, separado por `;` | `orcamentos.html:1961`; `calculo/engenharia.js:41,45,53-54` |
| `detalhes.revestimento` | texto | não | `revestimento` | `orcamentos.html:1963`; `calculo/engenharia.js:50` |
| `detalhes.corRevest` | texto | não | `corRevestimento` | `orcamentos.html:1963`; `calculo/engenharia.js:50` |
| `detalhes.divisor` | texto | não | `divisor` | `orcamentos.html:1964`; `calculo/engenharia.js:55` |
| `detalhes.divH` / `detalhes.divV` | inteiro >= 0 | não | `divisoresHorizontais` / `divisoresVerticais` | `orcamentos.html:1965`; `calculo/engenharia.js:40,56` |
| `detalhes.sistema` | texto (`Sem sistema` = sem sistema) | só em `Porta de Correr` | `sistema` | `orcamentos.html:1968,2495`; `calculo/engenharia.js:24,31`; `rotas/ped_orc.js:147-150` |
| `detalhes.transpasse` | número, mm | não | `transpasse` | `orcamentos.html:1968`; `calculo/engenharia.js:34` |
| `furos.lista` | lista de números, mm | não | `furos`, separado por `;` | `orcamentos.html:1955-1957`; `calculo/engenharia.js:22,38` |
| `furos.lados` | lista de texto (um lado por folha) | não | `ladosFuros`, separado por `;` | `orcamentos.html:1956,1355-1362`; `calculo/engenharia.js:42,57` |
| `furos.referenciaInvertida` | booleano | não | fixo `false` (base do mapa) | `orcamentos.html:1956` |
| `acessorios` | lista | não | fixo `[]` (base do mapa) | `orcamentos.html:1977`; `rotas/ped_orc.js:135-145` |
| `obs` | texto | não | `observacao` | `orcamentos.html:1979`; `calculo/engenharia.js:58` |

(*) `acabamento` é obrigatório no mapa por precaução: sem ele a web calcula a taxa de acabamento como 0 sem avisar (`calculo/precos.js:25` devolve 0 para nome vazio; `calculo/precos.js:186`), o que daria preço menor sem erro. Decisão da skill, não regra da web.

`detalhes.sistema` é obrigatório **quando** `frente = Porta de Correr` (`obrigatorioQuando` no mapa): sem ele a web trata a medida como a da porta; com sistema, como o vão (próxima seção). O projeto precisa dizer o sistema ou `Sem sistema` explicitamente; omissão vira pendência.

Campos que a tela envia e a skill **não** preenche (ver divergências): `valor`, `descricao`, `historico`, `valorTela`, `profundidade`, `soldas`, `qtdAltura`..., `detalhes.pares`, `detalhes.todaExt`, `detalhes.desempenador`, `detalhes.tipoPuxadorNativo`, `detalhes.posicao`, campos de serralheria e avulso, `origem`.

## Porta de correr: a medida é o VÃO

Com sistema, `altura` e `largura` do item são o **vão**; a web calcula a porta (`calculo/engenharia.js:31-36`): `alturaVao = altura`, `larguraVao = largura`, `altura = round(alturaVao - descontoAlturaSistema)`, `largura = round((larguraVao + transpasse * (n - 1)) / n)` para `n > 1`. O desconto vem do banco (`sistema_correr.DESCONTO_ALTURA`, `rotas/ped_orc.js:314,319`). A tela faz a mesma conta (`orcamentos.html:2497-2503`) e rotula os campos "Altura do vão" / "Largura do vão" (`orcamentos.html:2517-2518`). A skill, portanto, entrega a medida do vão **sem descontar nada**. Sem sistema (`Sem sistema`), a medida é a de cada porta.

Quantidade em correr: `qtd` é o **número de folhas do conjunto** (`calculo/engenharia.js:29,36`; `rotas/ped_orc.js:148`), e a linha comercial grava 1 conjunto (`calculo/linhas_vb.js:209`; `rotas/ped_orc.js:239`). Dois conjuntos iguais em vãos diferentes são dois itens. Quem estrutura o projeto deve respeitar isso.

## Traduções do mapa

`tipo` do item no projeto-tecnico → `frente` (comparação sem diferença de maiúsculas e espaços; tudo fora da tabela vira pendência `traducao_sem_correspondencia`, nunca é adivinhado):

| `tipo` no projeto | `frente` |
|---|---|
| `porta_giro` | `Porta de giro` |
| `porta_basculante` | `Porta basculante` |
| `frente_gaveta` | `Frente de gaveta` |
| `porta_correr` | `Porta de Correr` |

Para acrescentar um sinônimo (por exemplo `porta_de_giro`), edite o mapa, atualize `metadados` e o `CHANGELOG.md`.

## Divergências: o que a web espera e o PDF não fornece

1. **Preço.** A tela só adiciona item com valor > 0 (`orcamentos.html:904-908`) e o servidor recusa com 409 se o `valorTela` não bater com o preço recalculado (`rotas/ped_orc.js:437-439`). O item da skill não tem `valor` nem `valorTela`: o preço nasce na tela (`/calcular_preco`) ao lançar o item. **O item não pode ser enviado direto a `POST /ped_orc/salvar` sem passar pela tela.**
2. **Nomes do cadastro.** Perfil, puxador, revestimento, divisor e sistema precisam ser exatamente os nomes do banco (`rotas/ped_orc.js:149-150,187-190`; `calculo/precos.js:181`). O PDF traz texto livre; a skill não tem acesso ao banco e **não valida** esses nomes. A conferência é feita na tela (listas do cadastro).
3. **Cabeçalho do documento.** Cliente, tipo (Pedido/Orçamento), data de entrega, situação e financeiro (`rotas/ped_orc.js:73-81`) não fazem parte do item nem do projeto.
4. **Acessórios.** Manuais vêm de `acessorios_permitidos` e os do sistema de correr são calculados no servidor (`rotas/ped_orc.js:135-163`). Nunca vêm do PDF; `acessorios` sai sempre vazio.
5. **Tipo do puxador.** A tela o deriva do cadastro do produto (`orcamentos.html:1063-1072`) e acrescenta " Total" em toda extensão (`orcamentos.html:1409-1414`). O PDF pode trazer o tipo, mas o cadastro prevalece; confira na tela.
6. **Posições e lados.** `posicoesFolhas` usa nomes comerciais normalizados pela tela (`Lateral Esquerda Centro`, `Topo Total`..., `orcamentos.html:1390-1403`) e `lados` aceita variações (`Esquerdo`/`Direito`/`Superior`/`Inferior`, `orcamentos.html:1355-1362`). A skill repassa o texto confirmado sem validar o vocabulário.
7. **Furos.** Só giro e basculante têm furos na tela (`orcamentos.html:1351`); a skill não impede furos em outras frentes.
8. **Serralheria e venda avulsa.** Não cobertas (payloads com `pecas`, `categoria`, `avProduto`...; `rotas/ped_orc.js:102-126`).
9. **Limite de itens.** No máximo 200 por documento (`rotas/ped_orc.js:16,74`); a skill não divide documentos.
10. **Pares de porta.** `qtd` é a fonte da quantidade (`orcamentos.html:896-900`); o marcador `pares` não é enviado.

## Pendências por campo

- Obrigatório ausente: `obrigatorio_ausente` (bloqueante).
- Inferido: nunca entra no item; vira `sugestoes` e pendência `inferido` (bloqueante se o campo é obrigatório).
- Conflitante: nunca entra; pendência `conflitante` (bloqueante), a decisão é humana.
- Confirmado com tipo ou faixa inválidos (texto onde se espera número, `qtd` fora de 1 a 500, medida <= 0, lista com item não numérico): `valor_invalido` (bloqueante).
- Tipo sem tradução: `traducao_sem_correspondencia` (bloqueante).
- Pendências do documento (soma de cotas divergente, unidade ambígua, texto suspeito, domínio diferente do mapa) ficam em `pendenciasDocumento` e impedem o `prontoParaLancar` global.
