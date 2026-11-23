# Livro de regras de orçamentos e pedidos

_Spec: `docs/superpowers/specs/2026-11-23-livro-de-regras-design.md` (inclui a seção "Respostas da revisão"). O CLAUDE.md guarda só o resumo._

O Livro é a lista única das regras que o sistema confere ao **adicionar um item** na tela de orçamentos e ao **salvar** um orçamento ou pedido. As regras só LEEM o item: nunca alteram valor, preço nem campo.

## Onde fica cada peça

- `calculo/regras_item.js` (puro): `REGRAS`, `NIVEIS`, `ESCOPOS`, `LIMITES`, `CAMPOS_INTEIROS`, `avaliar(item)`, `avaliarDocumento(corpo)`, `livro()`.
- `rotas/regras.js`: `POST /regras/verificar_item` (permissão `orcamentos.criar`; corpo = o item como a tela envia; resposta `{ regras: [{ codigo, nivel, mensagem }] }`; item cópia devolve lista vazia; corpo que não é objeto = 400) e `GET /regras/livro` (permissão `administrativo.ver`; `{ regras: [{ codigo, nivel, escopo, titulo }], limites }`). Só leitura, sem dinheiro, nada gravado.
- `rotas/ped_orc.js`, função `validar()`: aplica as regras de item a cada item não-cópia ao salvar (barreira final); a regra de documento (`itens_minimo`) é aplicada no servidor (`avaliarDocumento`), com guarda explícita de `itens` não ser lista (nunca 500, qualquer que seja o nível de `itens_minimo`). Recusa ao salvar: `Item N: <mensagem> Para resolver, abra o item N (✏️) e clique em Atualizar.` (bloqueio) e `Item N: confirmação pendente — <mensagem> Para resolver, ...` (confirmação).
- `regras_tela.js` (puro, testado no Node): `filtrarInteiro`/`soDigitos`/`textoFiltroInteiro` (filtro dos campos inteiros), `origemNoCorpo` (campos de origem do item no salvar), `camposComNaoDigito`, `avaliar`, `decidirConsulta`, `colocarNaLista` (põe o item conferido na lista pelo objeto capturado ANTES da consulta), `comConfirmacoes`. As ligações ficam em `orcamentos.html`: `consultarRegras`, `adicionarItem`, o filtro de dígitos (ouvinte de `input` em fase de captura nos campos `data-inteiro`) e `textoCruNaoInteiro`.
- `regras.html` / `regras.js` / `regras.css`: página de leitura do Livro (código, nível, onde vale, regra, mais os limites). Permissão `administrativo.ver`; item "Livro de regras" no menu (`layout.js`, subitem de Usuários).

## Níveis

| Nível | Na tela (adicionar item) | No servidor (salvar) |
|---|---|---|
| `bloqueia` | alert com a lista de mensagens; o item NÃO entra na lista; nada é perguntado | `validar()` recusa o salvamento (`Item N: <mensagem> Para resolver, abra o item N (✏️) e clique em Atualizar.`) |
| `confirma` | `confirm()` por regra ("OK = continuar assim · Cancelar = corrigir"); cancelar interrompe tudo | recusa ("confirmação pendente") se o código não estiver em `item.confirmacoes` |
| `avisa` | `confirm()` igual ao `confirma` (o código aceito vai em `confirmacoes`) | nunca bloqueia nem exige confirmação |

Falha de rede, 401, 403 ou 500 na consulta: o item NÃO é adicionado (`decidirConsulta`); 401 leva ao login.

## Regras da v1 (9)

| Código | Nível | Escopo | Condição |
|---|---|---|---|
| `itens_minimo` | bloqueia | documento | `itens` vazio ou ausente: "Favor inserir pelomenos 1 item no pedido!" |
| `acabamento_perfil` | bloqueia | item | porta com perfil escolhido e sem acabamento do perfil |
| `acabamento_puxador` | bloqueia | item | porta com puxador escolhido e SEM acabamento nem no puxador nem no perfil (com o do perfil o sistema completa: o motor usa o acabamento do perfil para o puxador, `acabamentoDoPuxador` em `calculo/precos.js` e `acabPuxadorDoPerfil` em `calculo/engenharia.js`; na prática já coberta por `acabamento_perfil`) |
| `cor_obrigatoria` | bloqueia | item | porta cujo acabamento do perfil é do tipo "pintado" (`tipoCorDoAcabamento`, `calculo/cores.js`) sem `cor`, ou cujo acabamento EFETIVO do puxador (`acabamentoEfetivoDoPuxador`: com puxador, o do perfil e, sem ele, o do puxador, como o motor) é pintado sem `corPux` (o motor grava a cor do puxador = `corPux`, sem cair na do perfil) |
| `sem_revestimento` | confirma | item | porta sem revestimento: "Sem revestimento escolhido. Inserir na lista mesmo assim?" |
| `porta_medida_pequena` | avisa | item | porta com altura ou largura maior que 0 e menor que `LIMITES.portaMedidaAlertaMm` (300 mm). **Não vale para "Frente de gaveta"** (decisão do dono, 2026-11-23: gavetas costumam ter 120 a 250 mm e avisariam sempre); vale para porta de giro, basculante e de correr |
| `puxador_embutido_limites` | bloqueia | item | `tipoPuxador` contendo "embutido" (sem diferenciar caixa) com tamanho fora de 50 a 400 mm (`LIMITES`) |
| `puxador_maior_que_porta` | bloqueia | item | tamanho do puxador maior que a dimensão da porta; não vale para "toda extensão" (`todaExt`). A dimensão segue o motor de preço: posição TOPO/BASE = largura, outra posição = altura, sem posição = a maior das duas |
| `numero_inteiro` | bloqueia | item | qualquer campo da lista `CAMPOS_INTEIROS` com algo além de dígitos; uma mensagem por campo: "<rótulo>: só números inteiros, sem vírgula nem ponto." |

"Porta" = `item.frente` (sem diferenciar caixa) em: porta de giro, porta basculante, frente de gaveta, porta de correr. Serralheria e Avulso não entram nas regras de porta (só em `numero_inteiro`). Exceção: `porta_medida_pequena` deixa de fora a "Frente de gaveta"; as demais regras a tratam como porta.

`CAMPOS_INTEIROS` cobre altura, largura, profundidade, soldas, quantidades (`qtd`, `qtdAltura`, `qtdLargura`, `qtdProfundidade`), tamanho do puxador, divisores H/V, transpasse, larguras das folhas, furos, e os arrays de acessórios, peças e complementos (rótulo com a posição, ex. "Peça 2 (altura)"). Campo vazio ou ausente não dispara (obrigatoriedade é de outras regras).

## Onde ficam os limites

`LIMITES` em `calculo/regras_item.js` (`portaMedidaAlertaMm`, `puxadorEmbutidoMinMm`, `puxadorEmbutidoMaxMm`): fonte única; as mensagens, os títulos e a página do Livro (via `GET /regras/livro`) leem dali. É a base para um dia virarem tabela editável (caminho B da spec; **NÃO feito**: hoje mudar um limite é mudar o código).

## Como acrescentar uma regra nova

1. Uma entrada em `REGRAS` (`calculo/regras_item.js`) com `codigo`, `nivel`, `escopo` (`item` ou `documento`), `titulo` e `verifica` (devolve `null`, uma mensagem ou uma lista de mensagens).
2. Testes em `test/regras_item.test.js`.

Nada mais: a tela, o servidor e a página do Livro já consomem a lista e se atualizam sozinhos. **Regra nova de orçamento/pedido entra no Livro, não em `if` solto na tela.**

## O que nunca é revalidado (itens cópia)

Item cópia = `origem.estado` em `intacto`, `so_pct` ou `travado` (`ehCopia`, em `rotas/ped_orc.js` e em `rotas/regras.js`): vem do banco sem ser refeito e não é revalidado ao salvar; a consulta devolve lista vazia. Item `editado` e item novo SÃO revalidados (chamada do construtor: ao editar um item antigo ele passa a seguir as regras).

**Transformar orçamento em pedido** (revisão final, 2026-11-23): os itens são GERADOS do zero (vidros/perfis do pedido), não copiados, mas também não são revalidados quando vêm sem mudança de um documento já gravado:

- `POST /ped_orc/orcamentos/:numero/virar_pedido`: o servidor monta o corpo a partir do orçamento gravado e chama `gravarDocumento(..., { origemServidor: true })`; a opção é interna (argumento da função, nunca lida do corpo: um `origemServidor` no corpo não muda nada). Só `itens_minimo` continua valendo. Decisão: orçamento antigo que viole um `bloqueia` (ex.: gravado pelo VB sem acabamento) vira pedido mesmo assim.
- Tela (tipo trocado de Orçamento para Pedido e salvo, `converte` em `gravar()`): cada item do banco SEM edição (`intacto` ou `so_pct`) vai como `conversaoDe: { item, estado }` (`RegrasTela.origemNoCorpo`) e o corpo leva `origemConversao: { tipo, numero, impressao }`. O servidor (`remontarConversao` em `rotas/ped_orc.js`) confere a impressão digital (diferente = 409 `alterado`, como no salvar de sempre) e os estados do usuário, REMONTA o item a partir do documento gravado (o corpo só contribui com a % e o valor do `so_pct`) e não o revalida. Item editado ou novo segue as regras normalmente. Antes desta correção, toda porta sem revestimento era recusada na conversão.

## Decisões do dono (2026-11-23)

- **Não existe "embutido total"**: o "total" só existe no sobreposto ("Sobreposto Total"). O embutido nunca é "toda extensão" e a regra de 50 a 400 mm vale sempre para ele.
- **Tamanhos e quantidades só inteiros** (sem vírgula, ponto, sinal ou letra). Não vale para dinheiro (valor, desconto, %). Na tela, os campos `data-inteiro` filtram ao digitar e colar: o PRIMEIRO vírgula ou ponto FICA no campo e o que vem depois dele é descartado (`2100,5` vira `2100,`, nunca `21005`; `1.234` vira `1.`) e letra, sinal e espaço só são tirados (`12 a 3` vira `123`); quando há separador no campo ou algo é tirado aparece um aviso curto no canto ("Só números inteiros: apague a vírgula/ponto."; `#toasts`, aparência `.toast` do `tema.css`), que não bloqueia. Como o separador fica no campo, `adicionarItem` confere o texto cru antes de coletar o item e recusa com a mensagem do campo até a pessoa apagar a vírgula/ponto (o `parseFloat`/`parseInt` esconderia um decimal); digitar mais algarismos depois do separador não muda nada (são descartados).
- **Quantidade decimal de acessório** (ex.: 2,5 numa linha do sistema de correr) não "volta à tabela" mais: a regra `numero_inteiro` recusa o item com 400 "Acessório n (quantidade)" e nada é gravado (`test/ped_orc_salvar.test.js`).

## `confirmacoes`

Lista de códigos em `item.confirmacoes`, enviada pela tela com SÓ as confirmações aceitas naquele momento (`comConfirmacoes`; na edição de item nunca herda as do item antigo). Vale apenas para aquele salvamento e não é gravada. As mensagens vêm sempre do servidor (a tela não tem texto de regra próprio).

## Ordem de publicação

Sem trava no servidor para versões antigas da tela (decisão R12: nada que enfraqueça o servidor). Por isso a ordem importa:

1. **Back-end primeiro** (Render): publicar e esperar o serviço ficar saudável (o login responde e um orçamento abre).
2. **Depois o front-end** (GitHub Pages).

Ordem errada:

- **Front primeiro**: a tela nova chama `POST /regras/verificar_item`, que ainda não existe; ninguém consegue adicionar nem atualizar item até o servidor ter a rota (a tela avisa "Não foi possível conferir as regras do item" e não adiciona).
- **Servidor primeiro com páginas antigas no cache** (até uns 10 min do GitHub Pages/navegador): a tela antiga não manda `confirmacoes` nem `conversaoDe`, então porta sem revestimento não salva a partir dela (recusa "confirmação pendente") e decimal digitado nos campos antigos (ainda `type=number`) é recusado ao salvar com a mensagem do campo. Basta recarregar a página.

O `?v=` do `layout.js` NÃO foi trocado (mexeria em todas as páginas): o item "Livro de regras" no menu pode levar uns 10 min para aparecer por causa do cache do GitHub Pages. O `regras_tela.js` tem `?v=` próprio em `orcamentos.html` (trocado nesta correção).

**Teste manual depois de publicar** (Chrome no computador e no Android):

- Filtro de inteiros: digitar letras, digitar `2100,5` e `150.5` (o campo termina em `2100,`/`150.` com o aviso "apague a vírgula/ponto" no canto; "Adicionar item" recusa com a mensagem do campo até apagar a vírgula/ponto), colar `12 a 3` (fica `123`).
- `confirm()` da porta sem revestimento: OK adiciona; Cancelar não adiciona e deixa corrigir.
- Editar um item antigo que tinha medida decimal: a tela pede o inteiro antes de atualizar.
- Importar itens por JSON e salvar: item que viole regra é recusado com "Para resolver, abra o item N (✏️) e clique em Atualizar."
- Transformar em pedido (botão/menu e trocando o tipo na tela) um orçamento de porta de correr sem revestimento: deve gerar o pedido.
- Página do Livro: abre para um administrativo; um Operador fica sem acesso (403).

## Ainda não validado / atenção

- **A tela de orçamentos e a página do Livro NÃO foram testadas em navegador real** (digitação, colar, teclado numérico do celular, `confirm()`); só as funções puras e as rotas têm teste.
- **Item importado por JSON/PDF** ou copiado (📋) de um item antigo sem revestimento (`confirma`) ou que viole um `bloqueia` é recusado ao salvar até o item ser reeditado e confirmado na tela; a mensagem diz como resolver. A consulta das regras já na prévia da importação ficou para depois.
- Durante a consulta das regras (ida ao servidor) os botões ✏️, 📋 e 🗑️ da lista não fazem nada (`consultandoRegras`), e o item em edição e o desenho são capturados antes da consulta.
- Na suíte: dois testes intermitentes sob carga (SEFAZ "sincronizar: 138 em dois lotes…" e "lote do painel") e duas falhas pré-existentes não relacionadas ("modo atendimento: desligar o modo devolve as telas…" e "selo de entrega: marcada…").
- Testes: `test/regras_item.test.js`, `test/regras_rotas.test.js`, `test/ped_orc_regras.test.js`, `test/regras_tela.test.js`, `test/regras_pagina.test.js`, `test/virar_pedido.test.js` (conversão), `test/ped_orc_salvar.test.js` (acessório decimal).
