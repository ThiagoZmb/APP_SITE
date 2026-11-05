# Calendário de previsão de finalização dos pedidos

Telas: `calendario.html` / `calendario.js` (mês inteiro) e `calendario_dia.html` / `calendario_dia.js` (um dia), com `calendario_comum.js` (funções puras de tela, menu) e `calendario.css`.
Servidor: `rotas/calendario.js` (registrado em `index.js`) e `calculo/calendario.js` (funções puras). Testes: `test/calendario_calculo.test.js`, `test/calendario_rotas.test.js`, `test/calendario_tela.test.js`.
Somente leitura: o calendário nunca grava; quem grava são as ações do menu do botão direito, que já existiam (`POST /ped_orc/Pedido/:n/data_pronto` e `.../situacao`).

## Data usada
- `ped_orc.DATA_PRONTO` (a data prometida de ficar pronto): a mesma que o cartão "Previsão de finalização de pedidos" de `inicio.html` mostra e que "Alterar data de pronto" muda. Só `TIPO = 'Pedido'`; orçamento nunca entra.
- A coluna é tratada como DATE/DATETIME (a rota de alterar grava `AAAA-MM-DD`): a consulta é `DATA_PRONTO >= início AND DATA_PRONTO < fim` (mês: do dia 1 ao dia 1 do mês seguinte; dia: do dia ao dia seguinte). Pedido sem data (o VB grava `01/01/0001`) fica fora de qualquer mês/dia: não aparece no calendário. Se um dia essa coluna aparecer como texto `dd/mm/aaaa` no banco real, a consulta precisa mudar (não confirmado em MySQL real).
- "Hoje" é a data de Brasília no servidor (`hojeLocal`), nunca a do navegador, para o atraso ser igual para todos.

## O que é "em aberto" (filtro `situacao=abertos`, o padrão)
Classificação da situação (`classificarSituacao`, os mesmos grupos de `painel_inicial.html`): cancelado, produção, pronto, entregue, retirado, outro.
- **Em aberto** = produção, pronto ou situação desconhecida ("outro"). Ou seja, tudo que não é Entregue, Retirado nem Cancelado (mesmo critério do cartão "Entregas da semana" do Início). Pedido `Pronto` continua em aberto: ainda aguarda entrega.
- **Todos** (`situacao=todos`) inclui também Entregue, Retirado e Cancelado; a situação aparece em cada etiqueta/linha.
- A classificação é feita no servidor em JS (não em SQL, por causa de acentos/variações): a consulta busca os pedidos do mês e o agrupamento filtra. Uma consulta por chamada, sem N+1.

## Atraso
`atrasado` = a data de pronto é anterior a hoje **e** o pedido ainda está em produção ou em situação desconhecida. Pedido `Pronto`, `Entregue`, `Retirado` ou `Cancelado` nunca é atrasado (já cumpriu a promessa de finalizar ou saiu). Vence hoje = ainda não atrasado. Decisão do desenvolvimento a partir de "data passou e o pedido não foi finalizado"; se o dono quiser que `Pronto` não entregue também apareça como atrasado, mudar `atrasado()` em `calculo/calendario.js`. O atraso é sempre mostrado com texto ("Atrasado"), não só cor.

## Rotas (ambas `pedidos.ver`, a mesma de `/dados_lista`; nenhuma permissão nova)
- `GET /calendario/pedidos?mes=AAAA-MM&situacao=abertos|todos` -> `{ mes, situacao, hoje, qtdPedidos, qtdAtrasados, dias: [{ data, qtdPedidos, qtdAtrasados, pedidos }] }`.
- `GET /calendario/dia?data=AAAA-MM-DD&situacao=...` -> `{ data, situacao, hoje, qtdPedidos, qtdAtrasados, pedidos }`.
- Mês/data/situação inválidos: 400 sem consultar o banco (data real: 29/02 só em ano bissexto; anos 2000 a 2100). Situação ausente = `abertos`.
- Cada pedido: `numero, cliente, clienteFinal, situacao, classe, atrasado, prontoEm, dataEntrega, valor`. `prontoEm`/`dataEntrega` em `AAAA-MM-DD` (vazio se sem data); é o formato que o menu do botão direito espera.
- **Estados**: usuário com estados restritos só vê pedidos de clientes desses estados (`filtroEstados`, `INNER JOIN cadastro_clientes` só quando há restrição, como `/dados_lista`).
- **Dinheiro**: `valor` só com `valores.ver` (`semValores`); sem a permissão o campo nem existe. Contagens usam `qtd*`.

## Telas
- Mês: grade domingo a sábado, setas de mês, "Hoje", alternador "Em aberto | Todos" (botões com `aria-pressed`). Cada dia mostra até 3 etiquetas (`#número`, cliente abreviado, selo "Atrasado") e "+N mais"; dia atual destacado. Clique no dia (número, célula, etiqueta ou "+N mais") abre `calendario_dia.html?data=...&situacao=...`. Até 900 px de largura a grade vira uma lista só dos dias com pedido.
- Dia: lista completa (número, cliente, cliente final, situação, selo de atraso, valor só se a API mandou), dia anterior/próximo/hoje, "Voltar ao calendário" (volta para o mês e filtro do dia). Botão "Ações" em cada linha abre o mesmo menu (celular/teclado).
- Mês e filtro ficam na URL (`?mes=`, `?data=`, `?situacao=`), mantidos por `history.replaceState`.
- Menu lateral: "Calendário de pedidos" logo depois de "Minhas entregas" (seção Comercial); `calendario.html` e `calendario_dia.html` exigem `pedidos.ver` em `layout.js` (`PAGINAS`); o dia acende o item do calendário (`PAGINA_PAI`). `minhas_entregas.html` continua por último em `PAGINAS`.
- Etiqueta de pedido: classe `etq` (a classe `chip` já é do `tema.css`). Cores só por variáveis do tema (selos).

## Menu do botão direito (reuso de `inicio_menu.js`)
As duas telas usam o `InicioMenu` da página Início (não há cópia): `<li data-numero tabindex="0">` aceita botão direito, tecla de menu e Shift+F10 (o navegador dispara `contextmenu` no elemento focado). Itens e permissões vêm de lá: Abrir PDF, Guia de produção, Vidros, DANFE (`danfe.ver`), imprimir e etiquetas Zebra (`pedidos.pdf`), checklist (`pedidos.checklist`), Abrir para editar (`orcamentos.criar valores.ver`), Corte de perfil/vidros (`corte.ver`), Alterar data de pronto e Mudar situação (`pedidos.situacao`; Entregue/Retirado abrem o diálogo `escolha_data_entrega.js`). Pedido cancelado não mostra cortes, data de pronto nem situação. "Ver entrega" só aparece se o pedido trouxer `entregaStatus` (o calendário não manda). Depois de salvar, a tela recarrega e o pedido muda de dia.
Mudança feita em `inicio_menu.js`: opção `voltar` (página para a qual "Abrir para editar" volta; padrão `inicio.html`, então o Início não mudou). O calendário passa a própria página com a query.
Scripts que o menu exige em cada tela: `inicio_menu.js`, `escolha_data_entrega.js`, `alterar_data_pronto.js`, `danfe_pedido.js`, `etiqueta_zebra.js`, `checklist_pedido.js` (e `entregas_comum.js`, de onde vêm a API autenticada, o toast e `esc`). A CSP é a mesma do Início (iframe de blob para imprimir; serviço local 127.0.0.1:3917 para a Zebra).

## Não verificado
Telas não foram abertas em navegador real; consulta não rodou em MySQL real; Zebra/DANFE/checklist pelo calendário só por teste do menu.
