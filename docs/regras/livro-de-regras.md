# Livro de regras de orçamentos e pedidos

_Spec: `docs/superpowers/specs/2026-11-23-livro-de-regras-design.md` (inclui a seção "Respostas da revisão"). O CLAUDE.md guarda só o resumo._

O Livro é a lista única das regras que o sistema confere ao **adicionar um item** na tela de orçamentos e ao **salvar** um orçamento ou pedido. As regras só LEEM o item: nunca alteram valor, preço nem campo.

## Onde fica cada peça

- `calculo/regras_item.js` (puro): `REGRAS`, `NIVEIS`, `ESCOPOS`, `LIMITES`, `CAMPOS_INTEIROS`, `avaliar(item)`, `avaliarDocumento(corpo)`, `livro()`.
- `rotas/regras.js`: `POST /regras/verificar_item` (permissão `orcamentos.criar`; corpo = o item como a tela envia; resposta `{ regras: [{ codigo, nivel, mensagem }] }`; item cópia devolve lista vazia; corpo que não é objeto = 400) e `GET /regras/livro` (permissão `administrativo.ver`; `{ regras: [{ codigo, nivel, escopo, titulo }], limites }`). Só leitura, sem dinheiro, nada gravado.
- `rotas/ped_orc.js`, função `validar()`: aplica as regras de item a cada item não-cópia ao salvar (barreira final); a regra de documento (`itens_minimo`) é aplicada no servidor (`avaliarDocumento`).
- `regras_tela.js` (puro, testado no Node): `soDigitos`, `camposComNaoDigito`, `avaliar`, `decidirConsulta`, `comConfirmacoes`. As ligações ficam em `orcamentos.html`: `consultarRegras`, `adicionarItem`, o filtro de dígitos (ouvinte de `input` em fase de captura nos campos `data-inteiro`) e `textoCruNaoInteiro`.
- `regras.html` / `regras.js` / `regras.css`: página de leitura do Livro (código, nível, onde vale, regra, mais os limites). Permissão `administrativo.ver`; item "Livro de regras" no menu (`layout.js`, subitem de Usuários).

## Níveis

| Nível | Na tela (adicionar item) | No servidor (salvar) |
|---|---|---|
| `bloqueia` | alert com a lista de mensagens; o item NÃO entra na lista; nada é perguntado | `validar()` recusa o salvamento (`Item N: <mensagem>`) |
| `confirma` | `confirm()` por regra ("OK = continuar assim · Cancelar = corrigir"); cancelar interrompe tudo | recusa ("confirmação pendente") se o código não estiver em `item.confirmacoes` |
| `avisa` | `confirm()` igual ao `confirma` (o código aceito vai em `confirmacoes`) | nunca bloqueia nem exige confirmação |

Falha de rede, 401, 403 ou 500 na consulta: o item NÃO é adicionado (`decidirConsulta`); 401 leva ao login.

## Regras da v1 (9)

| Código | Nível | Escopo | Condição |
|---|---|---|---|
| `itens_minimo` | bloqueia | documento | `itens` vazio ou ausente: "Favor inserir pelomenos 1 item no pedido!" |
| `acabamento_perfil` | bloqueia | item | porta com perfil escolhido e sem acabamento do perfil |
| `acabamento_puxador` | bloqueia | item | porta com puxador escolhido e sem acabamento do puxador |
| `cor_obrigatoria` | bloqueia | item | porta cujo acabamento do perfil (ou do puxador) é do tipo "pintado" (`tipoCorDoAcabamento`, `calculo/cores.js`) e sem a cor correspondente |
| `sem_revestimento` | confirma | item | porta sem revestimento: "Sem revestimento escolhido. Inserir na lista mesmo assim?" |
| `porta_medida_pequena` | avisa | item | porta com altura ou largura maior que 0 e menor que `LIMITES.portaMedidaAlertaMm` (300 mm) |
| `puxador_embutido_limites` | bloqueia | item | `tipoPuxador` contendo "embutido" (sem diferenciar caixa) com tamanho fora de 50 a 400 mm (`LIMITES`) |
| `puxador_maior_que_porta` | bloqueia | item | tamanho do puxador maior que a dimensão da porta; não vale para "toda extensão" (`todaExt`). A dimensão segue o motor de preço: posição TOPO/BASE = largura, outra posição = altura, sem posição = a maior das duas |
| `numero_inteiro` | bloqueia | item | qualquer campo da lista `CAMPOS_INTEIROS` com algo além de dígitos; uma mensagem por campo: "<rótulo>: só números inteiros, sem vírgula nem ponto." |

"Porta" = `item.frente` (sem diferenciar caixa) em: porta de giro, porta basculante, frente de gaveta, porta de correr. Serralheria e Avulso não entram nas regras de porta (só em `numero_inteiro`).

`CAMPOS_INTEIROS` cobre altura, largura, profundidade, soldas, quantidades (`qtd`, `qtdAltura`, `qtdLargura`, `qtdProfundidade`), tamanho do puxador, divisores H/V, transpasse, larguras das folhas, furos, e os arrays de acessórios, peças e complementos (rótulo com a posição, ex. "Peça 2 (altura)"). Campo vazio ou ausente não dispara (obrigatoriedade é de outras regras).

## Onde ficam os limites

`LIMITES` em `calculo/regras_item.js` (`portaMedidaAlertaMm`, `puxadorEmbutidoMinMm`, `puxadorEmbutidoMaxMm`): fonte única; as mensagens, os títulos e a página do Livro (via `GET /regras/livro`) leem dali. É a base para um dia virarem tabela editável (caminho B da spec; **NÃO feito**: hoje mudar um limite é mudar o código).

## Como acrescentar uma regra nova

1. Uma entrada em `REGRAS` (`calculo/regras_item.js`) com `codigo`, `nivel`, `escopo` (`item` ou `documento`), `titulo` e `verifica` (devolve `null`, uma mensagem ou uma lista de mensagens).
2. Testes em `test/regras_item.test.js`.

Nada mais: a tela, o servidor e a página do Livro já consomem a lista e se atualizam sozinhos. **Regra nova de orçamento/pedido entra no Livro, não em `if` solto na tela.**

## O que nunca é revalidado (itens cópia)

Item cópia = `origem.estado` em `intacto`, `so_pct` ou `travado` (`ehCopia`, em `rotas/ped_orc.js` e em `rotas/regras.js`): vem do banco sem ser refeito e não é revalidado ao salvar; a consulta devolve lista vazia. Item `editado` e item novo SÃO revalidados (chamada do construtor: ao editar um item antigo ele passa a seguir as regras).

## Decisões do dono (2026-11-23)

- **Não existe "embutido total"**: o "total" só existe no sobreposto ("Sobreposto Total"). O embutido nunca é "toda extensão" e a regra de 50 a 400 mm vale sempre para ele.
- **Tamanhos e quantidades só inteiros** (sem vírgula, ponto, sinal ou letra). Não vale para dinheiro (valor, desconto, %). Na tela, os campos `data-inteiro` descartam o que não for dígito ao digitar e colar, e `adicionarItem` confere o texto cru antes de coletar o item (o `parseFloat`/`parseInt` esconderia um decimal).

## `confirmacoes`

Lista de códigos em `item.confirmacoes`, enviada pela tela com SÓ as confirmações aceitas naquele momento (`comConfirmacoes`; na edição de item nunca herda as do item antigo). Vale apenas para aquele salvamento e não é gravada. As mensagens vêm sempre do servidor (a tela não tem texto de regra próprio).

## Ainda não validado / atenção

- **A tela de orçamentos e a página do Livro NÃO foram testadas em navegador real** (digitação, colar, teclado numérico do celular, `confirm()`); só as funções puras e as rotas têm teste.
- **Item importado por JSON/PDF** com puxador sem acabamento do puxador (`bloqueia`) ou sem revestimento (`confirma`) é recusado ao salvar até o item ser reeditado e confirmado na tela.
- `layout.js` ganhou o item de menu "Livro de regras" sem mudar o `?v=` nas páginas: decidir no lançamento, por causa do cache do navegador e do GitHub Pages.
- Na suíte: dois testes intermitentes sob carga (SEFAZ "sincronizar: 138 em dois lotes…" e "lote do painel") e duas falhas pré-existentes não relacionadas ("modo atendimento: desligar o modo devolve as telas…" e "selo de entrega: marcada…").
- Testes: `test/regras_item.test.js`, `test/regras_rotas.test.js`, `test/ped_orc_regras.test.js`, `test/regras_tela.test.js`, `test/regras_pagina.test.js`.
