# Regras de fabricação: a skill não as aplica

Decisão D3 do usuário (2026-10-26), opção (b): **a skill não aplica descontos de fabricação.** Os descontos permanecem no banco e são aplicados pelo sistema web (e pelo VB). A skill entrega apenas as medidas de folha ou de vão lidas do projeto, em mm, sem alteração.

## Por que

- Os descontos são parâmetros de cadastro que mudam por perfil, puxador e sistema. Se a skill os copiasse, haveria duas fontes de verdade e, cedo ou tarde, medidas de corte diferentes entre a skill e o sistema.
- Essas regras são "fiéis ao VB" e já estão testadas no sistema. Reescrevê-las na skill seria arriscado e sem ganho.
- Aplicar o desconto também esconderia do usuário a medida realmente lida do projeto. A skill preserva a medida original e rastreável.

## Onde estão as regras (consulte, não copie)

| Regra | Onde |
|---|---|
| Desconto de vidro por perfil (`DESCONTO_VIDRO`) e desconto do perfil com puxador (`DESC_PERF_PUX`) | colunas de `cadastro_de_produtos`, lidas em `calculo/precos.js:14-20` |
| Medidas de vidro (descontos, posição do puxador, arredondamento `CInt` do VB) | `calculo/engenharia.js:100-120` (`medidasVidro`) |
| Medidas e quantidades de perfil | `calculo/engenharia.js:122-134` (`medidasPerfil`) |
| Desconto de altura do sistema de correr (`DESCONTO_ALTURA`) | tabela `sistema_correr`, lida em `rotas/ped_orc.js:314-319`; aplicado em `calculo/engenharia.js:31-36` |
| Transpasse e largura de cada folha de correr | `calculo/engenharia.js:34-36` |
| Acessórios e trilhos do sistema de correr | `calculo/engenharia.js:136-156` (`acessoriosDoSistema`) |
| Gravação das tabelas de vidros e perfis do pedido | `rotas/ped_orc.js:282-298` |

## Consequências para a skill

- **Não** chama `medidasVidro` nem `medidasPerfil` e **não** cria configuração de descontos em `config/`.
- Nenhuma fórmula de `calculo/engenharia.js` é reescrita. O único uso do arquivo é em teste, para provar que a web consegue consumir o item montado (`tests/montar-itens.test.mjs`).
- Porta de correr com sistema: a medida entregue é a do **vão**; a web desconta (ver `esquadrias-aluminio.md`).
- Cálculo de peças (vidro, perfil) e preço acontecem no sistema web quando o item é lançado.
- Por isso o `calcular-pecas.mjs`, previsto no plano original, virou `montar-itens.mjs`.

## Plano de corte (Fase 2, ainda não implementado)

Decisão D5: barra comercial de 6000 mm, registrada em `config/barras-comerciais.json`. Perda de serra (`kerfMm`) = 3 mm, decisão do usuário em 2026-10-26. `sobraMinimaMm` continua `null`, **pendente de definição**; ninguém deve assumir valor típico. Nenhum script lê esse arquivo ainda.
